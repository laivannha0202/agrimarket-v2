import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrdersService } from '../../src/orders/orders.service.js';
import { OrderReservationExpiryService } from '../../src/orders/order-reservation-expiry.service.js';
import {
  DEFAULT_ORDER_RESERVATION_TTL_MINUTES,
  MAX_RESERVATION_SWEEP_INTERVAL_MS,
  orderReservationTtlMs,
  reservationSweepIntervalMs,
  resolveOrderReservationTtlMinutes,
} from '../../src/orders/reservation-policy.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/enums.js';

/**
 * Reservation expiry (C-17).
 *
 * A PENDING_CONFIRMATION order holds stock. The sweep may only cancel orders
 * that are still pending, past their deadline, unpaid and unshipped — and it
 * must use the same compare-and-set as an operator cancellation so a race
 * cannot release stock twice.
 */
describe('Order reservation policy', () => {
  it('defaults to 30 minutes when unset or blank', () => {
    expect(resolveOrderReservationTtlMinutes(undefined)).toBe(
      DEFAULT_ORDER_RESERVATION_TTL_MINUTES,
    );
    expect(resolveOrderReservationTtlMinutes('   ')).toBe(
      DEFAULT_ORDER_RESERVATION_TTL_MINUTES,
    );
  });

  it('parses a positive integer from the environment', () => {
    expect(resolveOrderReservationTtlMinutes('45')).toBe(45);
    expect(orderReservationTtlMs('2')).toBe(120_000);
  });

  it('fails closed on an invalid configured value', () => {
    for (const raw of ['0', '-5', '1.5', 'soon', 'NaN']) {
      expect(() => resolveOrderReservationTtlMinutes(raw)).toThrow(
        /ORDER_RESERVATION_TTL_MINUTES/,
      );
    }
  });

  it('sweeps at most once a minute even with a long TTL', () => {
    expect(reservationSweepIntervalMs('120')).toBe(MAX_RESERVATION_SWEEP_INTERVAL_MS);
    expect(reservationSweepIntervalMs('1')).toBe(60_000);
  });
});

describe('OrdersService.expireReservation', () => {
  let prisma: MockPrisma;
  let service: OrdersService;
  const audit = { record: vi.fn(async () => undefined) };
  const now = new Date('2026-10-24T10:00:00Z');

  const pendingOrder = {
    id: 10,
    status: OrderStatus.PENDING_CONFIRMATION,
    reservationExpiresAt: new Date('2026-10-24T09:59:00Z'),
    payments: [{ status: PaymentStatus.PENDING }],
    partnerOrders: [],
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never,
    );
    vi.clearAllMocks();
  });

  it('returns NOT_FOUND for a missing order', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    expect(await service.expireReservation(10, now)).toEqual({
      expired: false,
      reason: 'NOT_FOUND',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never touches an order that already moved past PENDING_CONFIRMATION', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingOrder,
      status: OrderStatus.CONFIRMED,
    });
    expect(await service.expireReservation(10, now)).toEqual({
      expired: false,
      reason: 'NOT_PENDING',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('waits until the deadline has actually passed', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingOrder,
      reservationExpiresAt: new Date('2026-10-24T10:00:01Z'),
    });
    expect(await service.expireReservation(10, now)).toEqual({
      expired: false,
      reason: 'NOT_DUE',
    });
  });

  it('leaves an order alone once any payment is PAID', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingOrder,
      payments: [{ status: PaymentStatus.PAID }],
    });
    expect(await service.expireReservation(10, now)).toEqual({
      expired: false,
      reason: 'PAID',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('leaves an order alone when a shipment exists', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingOrder,
      partnerOrders: [{ shipments: [{ id: 1 }] }],
    });
    expect(await service.expireReservation(10, now)).toEqual({
      expired: false,
      reason: 'SHIPMENT',
    });
  });

  it('cancels a due, unpaid, unshipped order through the guarded transition', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      ...pendingOrder,
      status: OrderStatus.CANCELLED,
      reservationExpiresAt: null,
    });

    expect(await service.expireReservation(10, now)).toEqual({ expired: true });

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: OrderStatus.PENDING_CONFIRMATION },
      data: { status: OrderStatus.CANCELLED, reservationExpiresAt: null },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_RESERVATION_EXPIRED',
        entityType: 'Order',
        entityId: '10',
      }),
      prisma,
    );
  });

  it('reports RACED instead of throwing when a concurrent confirm won', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.expireReservation(10, now)).toEqual({
      expired: false,
      reason: 'RACED',
    });
  });
});

describe('OrderReservationExpiryService.sweep', () => {
  let prisma: MockPrisma;
  let orders: { expireReservation: ReturnType<typeof vi.fn> };
  let service: OrderReservationExpiryService;

  beforeEach(() => {
    prisma = createMockPrisma();
    orders = { expireReservation: vi.fn() };
    service = new OrderReservationExpiryService(prisma as never, orders as never);
  });

  it('only selects PENDING_CONFIRMATION orders whose deadline has passed', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.sweep(new Date('2026-10-24T10:00:00Z'));

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        status: OrderStatus.PENDING_CONFIRMATION,
        reservationExpiresAt: { lte: new Date('2026-10-24T10:00:00Z') },
      },
      select: { id: true },
      orderBy: [{ reservationExpiresAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  });

  it('counts expired and skipped rows and continues past a failing row', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    orders.expireReservation
      .mockResolvedValueOnce({ expired: true })
      .mockResolvedValueOnce({ expired: false, reason: 'PAID' })
      .mockRejectedValueOnce(new Error('deadlock'));

    expect(await service.sweep()).toEqual({ expired: 1, skipped: 2 });
    expect(orders.expireReservation).toHaveBeenCalledTimes(3);
  });

  it('never lets a housekeeping failure escape', async () => {
    prisma.order.findMany.mockRejectedValue(new Error('db down'));

    expect(await service.sweep()).toEqual({ expired: 0, skipped: 0 });
  });
});
