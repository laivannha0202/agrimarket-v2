import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../../generated/prisma/enums.js';

/**
 * The order state machine, on its own.
 *
 * Every status write in the service goes through `assertOrderTransition`, so the
 * legal edges live in one table instead of being re-derived at each call site.
 * Extracted from `orders.service.ts` because it is a pure business rule: no
 * database, no request context, and it can be exercised directly.
 */

/** Legal edges. Terminal statuses (`DELIVERED`, `CANCELLED`) have none. */
export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY_TO_SHIP, OrderStatus.CANCELLED],
  READY_TO_SHIP: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  SHIPPING: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

/** True when `to` is a legal next status for `from` (a no-op is legal only off a terminal state). */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return ALLOWED_ORDER_TRANSITIONS[from].length > 0;
  return (ALLOWED_ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  // Re-applying the current status is a no-op, but the two terminal statuses
  // (DELIVERED, CANCELLED) must not be re-entered: re-cancelling a cancelled
  // order would release the reservations a second time.
  if (!canTransitionOrder(from, to)) {
    throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
  }
}
