/** Longest accepted `Idempotency-Key` (same limit as the checkout key). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** How long a committed idempotency key can replay its response. */
export const DEFAULT_IDEMPOTENCY_RETENTION_DAYS = 30;

/**
 * Endpoint scopes. They are part of the unique key, so the same client key
 * used on two different endpoints is deliberately treated as two different
 * operations.
 */
export const IDEMPOTENCY_SCOPES = {
  inventoryAdjust: 'inventory.adjust',
  payoutCreate: 'finance.payout.create',
  refundCreate: 'payment.refund',
} as const;
