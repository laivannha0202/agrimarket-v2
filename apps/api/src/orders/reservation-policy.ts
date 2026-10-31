import { PaymentMethod } from '../../generated/prisma/enums.js';

/**
 * How long a PENDING_CONFIRMATION order keeps its stock reservation.
 *
 * The final duration is a business decision; 30 minutes is the proposed
 * default and is configurable through `ORDER_RESERVATION_TTL_MINUTES`. The
 * resolver fails closed on an explicit invalid value: silently falling back to
 * a different lifetime would make a deployment's behaviour depend on a typo.
 */
export const DEFAULT_ORDER_RESERVATION_TTL_MINUTES = 30;

/**
 * How long a CASH-ON-DELIVERY order keeps its stock reservation.
 *
 * A COD order is confirmed by a human at the shop, not by a payment gateway.
 * Thirty minutes is meaningless for that flow: an order placed at 22:00 would
 * be cancelled before anyone opens the store in the morning, even though the
 * customer is waiting for a call. 24 hours gives one full business day to
 * confirm, and is configurable through `ORDER_RESERVATION_TTL_MINUTES_COD`.
 *
 * TRADE-OFF: a longer hold means stock stays reserved while the shop decides.
 * That is deliberate — the goods exist and are promised to a real customer; the
 * alternative (cancelling real orders) is worse. Operators can shorten the
 * window, and an order is only swept while it is still PENDING_CONFIRMATION,
 * unpaid and without a shipment, so a paid or dispatched order is never
 * released early.
 */
export const DEFAULT_COD_RESERVATION_TTL_MINUTES = 24 * 60;

/** The sweep runs at most once a minute, even with a long TTL. */
export const MAX_RESERVATION_SWEEP_INTERVAL_MS = 60_000;

function parseTtlMinutes(raw: string | null | undefined, name: string, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid configuration: ${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveOrderReservationTtlMinutes(raw?: string | null): number {
  return parseTtlMinutes(
    raw,
    'ORDER_RESERVATION_TTL_MINUTES',
    DEFAULT_ORDER_RESERVATION_TTL_MINUTES,
  );
}

export function resolveCodReservationTtlMinutes(raw?: string | null): number {
  return parseTtlMinutes(
    raw,
    'ORDER_RESERVATION_TTL_MINUTES_COD',
    DEFAULT_COD_RESERVATION_TTL_MINUTES,
  );
}

export function orderReservationTtlMs(raw?: string | null): number {
  return resolveOrderReservationTtlMinutes(raw) * 60_000;
}

export function codReservationTtlMs(raw?: string | null): number {
  return resolveCodReservationTtlMinutes(raw) * 60_000;
}

/**
 * The reservation lifetime for one order, chosen by how that order is paid.
 *
 * COD waits for a human confirmation (24 h by default); every other method
 * waits for a payment callback and keeps the short window. This is the single
 * place the decision is made, so the deadline stored at checkout and the
 * customer-facing explanation cannot drift apart.
 */
export function reservationTtlMsForMethod(
  method: PaymentMethod,
  env: { defaultTtl?: string | null; codTtl?: string | null } = {},
): number {
  if (method === PaymentMethod.COD) {
    return codReservationTtlMs(env.codTtl ?? process.env.ORDER_RESERVATION_TTL_MINUTES_COD);
  }
  return orderReservationTtlMs(env.defaultTtl ?? process.env.ORDER_RESERVATION_TTL_MINUTES);
}

export function reservationSweepIntervalMs(raw?: string | null): number {
  return Math.min(orderReservationTtlMs(raw), MAX_RESERVATION_SWEEP_INTERVAL_MS);
}
