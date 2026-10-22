import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { IDEMPOTENCY_SCOPES } from '../common/idempotency/idempotency.constants.js';
import { buildCode, buildDatedCode, datedCodePrefix, isUniqueViolationOn, nextDatedSequence, nextSequence } from '../common/utils/code.util.js';
import { buildPagination, paginate } from '../common/dto/pagination-query.dto.js';
import { CreatePayoutDto, CreateSettlementDto } from './dto/finance.dto.js';
import type { Payout, Prisma } from '../../generated/prisma/client.js';
import {
  PartnerOrderStatus,
  PayoutStatus,
  SettlementStatus,
} from '../../generated/prisma/enums.js';

const CODE_ATTEMPTS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Settlement formula:
 *   grossAmount - refundAmount - commissionAmount + adjustmentAmount = payableAmount
 *
 * Built from DELIVERED partner orders in the period only — money on an order
 * still in transit is not payable yet, and an order already claimed by another
 * settlement can never be claimed again (each partner order contributes to at
 * most one settlement line, across all periods).
 *
 * ONE ORDER, ONE SETTLEMENT
 *
 * The "already claimed" filter (`settlementLines: { none: {} }`) only works if
 * two creates cannot both read the same unclaimed set. Two concurrent creates
 * used to: both selected the same partner orders, both inserted their lines,
 * and the same order was claimed by two settlements (measured: 4 lines for 2
 * orders). The database now enforces the invariant with a UNIQUE index on
 * `settlement_lines.partner_order_id` (migration
 * `20261019000000_settlement_line_unique_partner_order`), and a losing create
 * is mapped to a 409 here instead of a raw constraint error. Corrections for
 * an already-settled period are expressed through the settlement-level
 * `adjustmentAmount`, not by claiming the same order twice.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Runs a code-generating insert, retrying when a concurrent insert claimed
   * the same code first (unique index on `code` is the final guard).
   */
  private async createWithRetry<T>(create: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await create();
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  async create(dto: CreateSettlementDto, actorUserId: number) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }

    // Only DELIVERED partner orders are settled: the goods reached the buyer,
    // so the partner's money is actually owed. A READY_TO_SHIP/SHIPPING order is
    // still in transit and including it would pay for goods that may come back.
    // `settlementLines: { none: {} }` excludes every order already claimed by a
    // settlement (DRAFT included), so the same order can never be paid twice
    // across two periods.
    const partnerOrders = await this.prisma.partnerOrder.findMany({
      where: {
        partnerId: dto.partnerId,
        status: PartnerOrderStatus.DELIVERED,
        createdAt: { gte: periodStart, lte: periodEnd },
        settlementLines: { none: {} },
      },
    });

    let gross = 0;
    let refundTotal = 0;
    let commissionTotal = 0;
    const lines = partnerOrders.map((po) => {
      const grossAmount = Number(po.subtotal) - Number(po.discountTotal);
      const commissionAmount = Number(po.commissionAmount);
      const payableAmount = round2(grossAmount - commissionAmount);
      gross += grossAmount;
      commissionTotal += commissionAmount;
      return {
        partnerOrderId: po.id,
        grossAmount: round2(grossAmount),
        refundAmount: 0,
        commissionAmount: round2(commissionAmount),
        payableAmount,
      };
    });

    const adjustment = dto.adjustmentAmount ?? 0;
    const payable = round2(gross - refundTotal - commissionTotal + adjustment);

    // Sequence from the highest existing code (never a row count), with a retry
    // when a concurrent insert wins the race for the same number.
    let settlement;
    try {
      settlement = await this.createWithRetry(async () => {
        const existing = await this.prisma.settlement.findMany({
          where: { code: { startsWith: 'SET-' } },
          select: { code: true },
        });
        const code = buildCode('SET', nextSequence(existing.map((row) => row.code), 'SET'));
        return this.prisma.settlement.create({
          data: {
            code,
            partnerId: dto.partnerId,
            periodStart,
            periodEnd,
            grossAmount: round2(gross),
            refundAmount: round2(refundTotal),
            commissionAmount: round2(commissionTotal),
            adjustmentAmount: adjustment,
            payableAmount: payable,
            status: SettlementStatus.DRAFT,
            lines: { create: lines },
          },
          include: { lines: true },
        });
      });
    } catch (error) {
      // A concurrent create claimed one of these partner orders first. The
      // nested create is one transaction, so the loser leaves no partial
      // settlement behind — it is told to reload and pick the period again.
      if (isUniqueViolationOn(error, 'partner_order_id')) {
        throw new ConflictException(
          'One or more partner orders were claimed by another settlement just now, please reload',
        );
      }
      throw error;
    }

    await this.audit.record({
      actorUserId,
      action: 'SETTLEMENT_CREATE',
      entityType: 'Settlement',
      entityId: String(settlement.id),
      afterJson: settlement,
    });
    return settlement;
  }

  async findAll(query: { page?: number; limit?: number; status?: SettlementStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SettlementWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { partner: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.settlement.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      include: {
        partner: true,
        lines: { include: { partnerOrder: { select: { id: true, code: true } } } },
        payouts: true,
      },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    return settlement;
  }

  async confirm(id: number, actorUserId: number) {
    const settlement = await this.findOne(id);
    if (settlement.status !== SettlementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT settlements can be confirmed');
    }
    const updated = await this.prisma.settlement.update({
      where: { id },
      data: { status: SettlementStatus.CONFIRMED, confirmedAt: new Date() },
    });
    await this.audit.record({
      actorUserId,
      action: 'SETTLEMENT_CONFIRM',
      entityType: 'Settlement',
      entityId: String(id),
      beforeJson: { status: settlement.status },
      afterJson: { status: updated.status },
    });
    return updated;
  }
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  /**
   * Runs a code-generating insert, retrying when a concurrent insert claimed
   * the same code first (unique index on `code` is the final guard).
   */
  private async createWithRetry<T>(create: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await create();
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  async create(dto: CreatePayoutDto, actorUserId: number, idempotencyKey?: string) {
    const payload = {
      settlementId: dto.settlementId,
      amount: dto.amount ?? null,
      reference: dto.reference ?? null,
    };

    // A retry must replay even if the first payout changed the state checked
    // below. This lookup is metadata-only; the atomic claim still happens in
    // the same transaction as the payout insert.
    if (idempotencyKey) {
      if (!this.idempotency) {
        throw new InternalServerErrorException('Idempotency service is not configured');
      }
      const replayed = await this.idempotency.replay<Payout>({
        scope: IDEMPOTENCY_SCOPES.payoutCreate,
        actorUserId,
        key: idempotencyKey,
        payload,
      });
      if (replayed !== null) return replayed;
    }

    const settlement = await this.prisma.settlement.findUnique({
      where: { id: dto.settlementId },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.CONFIRMED && settlement.status !== SettlementStatus.PAID) {
      throw new BadRequestException('Settlement must be CONFIRMED before creating a payout');
    }
    if (dto.amount != null && dto.amount <= 0) {
      throw new BadRequestException('Payout amount must be greater than zero');
    }

    /**
     * CONCURRENCY (BL-06)
     *
     * The check-then-insert used to run OUTSIDE any transaction: two requests
     * both read `paidSoFar = 0`, both passed the guard, and both inserted —
     * the settlement could be paid out more than `payableAmount` (payments a
     * partner refund could later never cover). Every payout therefore runs in
     * one transaction that:
     *
     *  1. claims the settlement row with `SELECT … FOR UPDATE` — all payouts
     *     on the same settlement queue on this lock, exactly like a refund
     *     claims its parent payment (payments.service.refund);
     *  2. RE-READS the payout total *after* the lock was granted and re-checks
     *     the remainder against the freshly locked payable;
     *  3. inserts the payout inside the same transaction (the code-collision
     *     retry keeps the `code` unique index as the final guard).
     *
     * The transaction uses `ReadCommitted` for the same doc-measured reason as
     * `refund`: under REPEATABLE READ the re-read would keep its pre-lock
     * snapshot and pass the guard again. A client retry is safe by
     * construction — the second attempt re-reads the now-committed payout, so
     * it either pays the true remainder or is refused; it can never
     * re-apply the same amount into the same gap and double-spend.
     */
    const work = async (tx: Prisma.TransactionClient) => {
        // Serialise every payout on the settlement; markPaid only needs this
        // row writer-side, so a concurrent payment marking waits here instead
        // of colliding on the guard below.
        const locked = await tx.$queryRaw<
          { id: number; payable_amount: unknown; status: SettlementStatus }[]
        >`
          SELECT id, payable_amount, status
            FROM settlements
           WHERE id = ${settlement.id} FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException('Settlement not found');
        const current = locked[0];
        if (
          current.status !== SettlementStatus.CONFIRMED &&
          current.status !== SettlementStatus.PAID
        ) {
          throw new BadRequestException('Settlement must be CONFIRMED before creating a payout');
        }

        const alreadyPaid = await tx.payout.aggregate({
          where: { settlementId: settlement.id, status: { in: [PayoutStatus.PENDING, PayoutStatus.PAID] } },
          _sum: { amount: true },
        });
        const paidSoFar = Number(alreadyPaid._sum.amount ?? 0);
        const payable = Number(current.payable_amount);
        const amount = dto.amount ?? round2(payable - paidSoFar);
        if (amount <= 0) {
          throw new BadRequestException('Payout amount must be greater than zero');
        }
        if (round2(paidSoFar + amount) > payable) {
          throw new BadRequestException(
            `Payout would exceed settlement payable amount (${payable}); remaining ${round2(payable - paidSoFar)}`,
          );
        }

        const payout = await this.createWithRetry(async () => {
          const now = new Date();
          const prefix = datedCodePrefix('PAY', now);
          const existing = await tx.payout.findMany({
            where: { code: { startsWith: prefix } },
            select: { code: true },
          });
          const code = buildDatedCode(
            'PAY',
            nextDatedSequence(
              existing.map((row) => row.code),
              'PAY',
              now,
            ),
            now,
          );
          return tx.payout.create({
            data: {
              code,
              settlementId: settlement.id,
              partnerId: settlement.partnerId,
              amount,
              status: PayoutStatus.PENDING,
              reference: dto.reference,
              requestedAt: new Date(),
            },
          });
        });
        await this.audit.record(
          {
            actorUserId,
            action: 'PAYOUT_CREATE',
            entityType: 'Payout',
            entityId: String(payout.id),
            afterJson: payout,
          },
          tx,
        );
        return payout;
    };

    if (!idempotencyKey) {
      return this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
    }
    return this.idempotency!.run(
      {
        scope: IDEMPOTENCY_SCOPES.payoutCreate,
        actorUserId,
        key: idempotencyKey,
        payload,
      },
      work,
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async markPaid(id: number, actorUserId: number) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Only PENDING payouts can be marked as paid');
    }
    const updated = await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.PAID, paidAt: new Date() },
    });

    // If the settlement is fully paid out, mark it PAID.
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: payout.settlementId },
      include: { payouts: true },
    });
    if (settlement) {
      const paidTotal = settlement.payouts
        .filter((p) => p.status === PayoutStatus.PAID)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      if (paidTotal >= Number(settlement.payableAmount)) {
        await this.prisma.settlement.update({
          where: { id: settlement.id },
          data: { status: SettlementStatus.PAID },
        });
      }
    }

    await this.audit.record({
      actorUserId,
      action: 'PAYOUT_PAID',
      entityType: 'Payout',
      entityId: String(id),
      beforeJson: { status: payout.status },
      afterJson: { status: updated.status },
    });
    return updated;
  }

  async findAll(query: { page?: number; limit?: number; status?: PayoutStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.PayoutWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { partner: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.payout.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }
}
