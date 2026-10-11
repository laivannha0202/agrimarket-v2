import { Injectable } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';

/**
 * Rate limiter that tracks by IP *and* by the submitted identifier.
 *
 * The stock `ThrottlerGuard` keys on IP alone, which has two problems for
 * authentication endpoints:
 *
 *   1. A shared NAT (a whole office, a mobile carrier) shares one budget, so a
 *      legitimate crowd locks each other out.
 *   2. Conversely, a single attacker with a pool of addresses gets a fresh
 *      budget per address while hammering ONE account.
 *
 * Adding the e-mail / phone from the body to the key means attempts against one
 * account are counted together no matter where they come from, while the IP
 * stays in the key so one address still cannot spray many accounts.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip =
      (req.ip as string | undefined) ??
      (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ??
      'unknown';

    const body = (req.body ?? {}) as Record<string, unknown>;
    const identifier = firstString(body.email, body.phone);

    return identifier ? `${ip}:${identifier.toLowerCase()}` : ip;
  }

  /**
   * Answers a throttled request with a plain "too many attempts" message.
   *
   * The default text names the internal route and the configured limit, which
   * is noise for a customer and free reconnaissance for an attacker.
   */
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottlerException('Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.');
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}
