/**
 * How long a PENDING_CONFIRMATION order keeps its stock reservation.
 *
 * The final duration is a business decision; 30 minutes is the proposed
 * default and is configurable through `ORDER_RESERVATION_TTL_MINUTES`. The
 * resolver fails closed on an explicit invalid value: silently falling back to
 * a different lifetime would make a deployment's behaviour depend on a typo.
 */
export const DEFAULT_ORDER_RESERVATION_TTL_MINUTES = 30;

/** The sweep runs at most once a minute, even with a long TTL. */
export const MAX_RESERVATION_SWEEP_INTERVAL_MS = 60_000;

export function resolveOrderReservationTtlMinutes(raw?: string | null): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_ORDER_RESERVATION_TTL_MINUTES;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      'Invalid configuration: ORDER_RESERVATION_TTL_MINUTES must be a positive integer',
    );
  }
  return parsed;
}

export function orderReservationTtlMs(raw?: string | null): number {
  return resolveOrderReservationTtlMinutes(raw) * 60_000;
}

export function reservationSweepIntervalMs(raw?: string | null): number {
  return Math.min(orderReservationTtlMs(raw), MAX_RESERVATION_SWEEP_INTERVAL_MS);
}
