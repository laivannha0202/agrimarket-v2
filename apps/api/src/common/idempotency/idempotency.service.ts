import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { isUniqueViolationOn } from '../utils/code.util.js';
import {
  DEFAULT_IDEMPOTENCY_RETENTION_DAYS,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from './idempotency.constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * How many times a request may re-attempt the claim after losing a concurrent
 * race whose winner then rolled back. In the normal paths the loser either
 * replays the winner's response or finds the key row gone; one retry is
 * enough. The small bound only prevents a pathological loop.
 */
const CLAIM_ATTEMPTS = 3;

/**
 * Internal signal used to abort a losing transaction after the UNIQUE INSERT
 * on `app_idempotency_keys` reports a duplicate. It never escapes this service.
 */
class IdempotencyReplaySignal extends Error {}

export interface IdempotencyContext {
  scope: string;
  actorUserId: number;
  key: string;
  payload: unknown;
}

/**
 * Shared DB-backed idempotency executor for state-changing admin/finance
 * endpoints.
 *
 * The mechanism is intentionally a database UNIQUE constraint, not an
 * in-process map or mutex:
 *
 *  1. the request INSERTs `(scope, actor_user_id, key, request_hash)` inside the
 *     same transaction as the business write;
 *  2. the database serialises concurrent inserts on that unique key, so exactly
 *     one transaction runs the business work;
 *  3. the winning transaction stores its response body before committing, and
 *     the loser (duplicate key) reads and replays it;
 *  4. if the business work throws, the claim rolls back with it, so there is no
 *     committed PENDING row and the same key can be retried immediately.
 *
 * The key is actor-scoped and endpoint-scoped by construction, and expires
 * after the retention period (30 days by default). Expired keys are purged and
 * may be reused.
 */
@Injectable()
export class IdempotencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private purgeTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Opportunistic maintenance: never block startup, never crash the app.
    void this.purgeExpired().catch((error: unknown) => {
      this.logger.warn(`Idempotency purge at startup failed: ${messageOf(error)}`);
    });
    this.purgeTimer = setInterval(() => {
      void this.purgeExpired().catch((error: unknown) => {
        this.logger.warn(`Idempotency purge failed: ${messageOf(error)}`);
      });
    }, PURGE_INTERVAL_MS);
    // Do not keep a test runner / CLI process alive just for maintenance.
    this.purgeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  /**
   * Fast-path replay check. Services call this BEFORE their business
   * preconditions, because a retry must replay even when the first attempt
   * changed the state the precondition looks at (e.g. a fully-refunded payment
   * is no longer PAID, but its retry must still return the original refund).
   *
   * Returns `null` when the key was never committed or has expired.
   */
  async replay<T>(context: IdempotencyContext): Promise<T | null> {
    const key = this.validateKey(context.key);
    const row = await this.prisma.appIdempotencyKey.findUnique({
      where: {
        scope_actorUserId_key: {
          scope: context.scope,
          actorUserId: context.actorUserId,
          key,
        },
      },
    });
    if (!row) return null;

    if (this.isExpired(row.expiresAt)) {
      await this.deleteExpiredRow(row.id);
      return null;
    }
    this.assertSamePayload(row.requestHash, context.payload);
    if (row.responseJson === null) throw this.inFlightConflict();
    return row.responseJson as T;
  }

  /**
   * Runs `work` exactly once per `(scope, actor, key)`.
   *
   * `work` MUST perform every business write through the supplied transaction
   * client; anything written outside it would not roll back with the claim.
   */
  async run<T>(
    context: IdempotencyContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    const key = this.validateKey(context.key);
    const requestHash = hashIdempotencyPayload(context.payload);

    for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
      try {
        const execute = async (tx: Prisma.TransactionClient): Promise<T> => {
          try {
            await tx.appIdempotencyKey.create({
              data: {
                scope: context.scope,
                actorUserId: context.actorUserId,
                key,
                requestHash,
                expiresAt: new Date(Date.now() + this.retentionMs()),
              },
            });
          } catch (error) {
            if (isIdempotencyClaimConflict(error)) throw new IdempotencyReplaySignal();
            throw error;
          }

          const result = await work(tx);

          // Written before the transaction commits: a committed key row always
          // carries the exact response that the business write produced.
          await tx.appIdempotencyKey.update({
            where: {
              scope_actorUserId_key: {
                scope: context.scope,
                actorUserId: context.actorUserId,
                key,
              },
            },
            data: {
              responseStatus: 201,
              responseJson: toJsonValue(result),
            },
          });
          return result;
        };

        return options
          ? await this.prisma.$transaction(execute, options)
          : await this.prisma.$transaction(execute);
      } catch (error) {
        if (!(error instanceof IdempotencyReplaySignal)) throw error;

        // The losing transaction has rolled back (it never ran `work`). Read
        // the winner's committed row in a fresh transaction.
        const row = await this.prisma.appIdempotencyKey.findUnique({
          where: {
            scope_actorUserId_key: {
              scope: context.scope,
              actorUserId: context.actorUserId,
              key,
            },
          },
        });

        if (!row) continue; // The winner rolled back: the key is free again.

        if (this.isExpired(row.expiresAt)) {
          await this.deleteExpiredRow(row.id);
          continue;
        }
        this.assertSamePayload(row.requestHash, context.payload);
        if (row.responseJson === null) throw this.inFlightConflict();
        return row.responseJson as T;
      }
    }

    throw this.inFlightConflict();
  }

  /**
   * Deletes keys past their retention horizon. Called on startup and every six
   * hours; also exported for maintenance/tests.
   */
  async purgeExpired(): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM app_idempotency_keys
       WHERE expires_at < UTC_TIMESTAMP(3)
    `;
  }

  private validateKey(raw: string): string {
    const key = raw.trim();
    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required for this operation');
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key header is too long (max ${MAX_IDEMPOTENCY_KEY_LENGTH} characters)`,
      );
    }
    return key;
  }

  private retentionMs(): number {
    const configured = Number(process.env.IDEMPOTENCY_RETENTION_DAYS ?? '');
    const days =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_IDEMPOTENCY_RETENTION_DAYS;
    return Math.round(days * MS_PER_DAY);
  }

  private isExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() <= Date.now();
  }

  private async deleteExpiredRow(id: number): Promise<void> {
    await this.prisma.appIdempotencyKey.deleteMany({
      where: { id, expiresAt: { lte: new Date() } },
    });
  }

  private assertSamePayload(storedHash: string, payload: unknown): void {
    if (storedHash !== hashIdempotencyPayload(payload)) {
      throw new ConflictException(
        'This Idempotency-Key was already used with a different request payload',
      );
    }
  }

  private inFlightConflict(): ConflictException {
    return new ConflictException(
      'This Idempotency-Key is still being processed, please retry the request',
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stable JSON used for the payload hash: object keys are sorted, `undefined`
 * members are dropped (JSON semantics), arrays keep their order (line order is
 * part of the request). Dates become ISO strings.
 */
export function hashIdempotencyPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const member = source[key];
      if (member !== undefined) out[key] = canonicalize(member);
    }
    return out;
  }
  return value;
}

/**
 * Converts the service result to exactly what the HTTP layer would serialise
 * (Date -> ISO string, Prisma Decimal -> string) so a replay has the same JSON
 * shape as the original response.
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('An idempotent response must be JSON-serialisable');
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

/**
 * True when the error is the UNIQUE violation of `app_idempotency_keys`, i.e.
 * this request lost the claim race. Other unique violations must propagate.
 */
export function isIdempotencyClaimConflict(error: unknown): boolean {
  return isUniqueViolationOn(error, 'app_idempotency_keys');
}
