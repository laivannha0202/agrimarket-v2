/**
 * The single definition of "money actually collected" for one order.
 *
 * Two readers depend on it and must agree, or an order can be settleable and
 * "under-collected" at the same time:
 *   - `SettlementsService.create` decides which delivered orders may be paid;
 *   - `PaymentReconciliationService` reports orders whose records disagree.
 *
 * A payment moved money only when `paidAt` is set and the status is not
 * FAILED: a failed attempt moved nothing, and a status without a timestamp is
 * a claim without evidence.
 */

/** Money comparisons ignore sub-cent drift (Decimal(18,2) storage). */
export const MONEY_EPSILON = 0.01;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CollectiblePayment {
  /** Prisma `Decimal` or a plain number; both convert through `Number()`. */
  amount: unknown;
  status: string;
  paidAt: Date | null;
}

export function collectedAmount(payments: readonly CollectiblePayment[]): number {
  return round2(
    payments
      .filter((payment) => payment.paidAt !== null && payment.status !== 'FAILED')
      .reduce((sum, payment) => sum + Number(payment.amount), 0),
  );
}

/** Whether the collected money covers the order obligation. */
export function hasFullCollection(collected: number, obligation: number): boolean {
  return collected + MONEY_EPSILON >= obligation;
}
