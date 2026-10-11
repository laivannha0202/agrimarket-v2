import { describe, expect, it, beforeEach } from 'vitest';
import { ReportsService } from '../../src/reports/reports.service.js';
import { PaymentStatus, RefundStatus } from '../../generated/prisma/enums.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * Export detail grain: exactly one row per order.
 *
 * A multi-partner order must not multiply its money columns — the "Đơn hàng"
 * table sums reconcile with the summary KPIs only when `grandTotal` appears
 * once per order. Cash columns use the same event-time basis as the KPIs
 * (`paidAt` / `completedAt` inside the window).
 */
describe('ReportsService.detailRows', () => {
  let prisma: MockPrisma;
  let service: ReportsService;

  const FROM = new Date('2026-10-01T00:00:00Z');
  const TO = new Date('2026-10-07T00:00:00Z');

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ReportsService(prisma as never);
    prisma.returnRequest.findMany.mockResolvedValue([]);
    prisma.complaint.findMany.mockResolvedValue([]);
  });

  function orderRow(overrides: Record<string, unknown> = {}) {
    return {
      code: 'ORD-20261003-0001',
      createdAt: new Date('2026-10-03T02:00:00Z'),
      status: 'DELIVERED',
      subtotal: '130000',
      discountTotal: '0',
      shippingFee: '20000',
      grandTotal: '150000',
      payments: [],
      _count: { partnerOrders: 1 },
      ...overrides,
    };
  }

  it('emits one row per order even with several partner orders (no money duplication)', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({ _count: { partnerOrders: 3 } }),
    ]);

    const { orders } = await service.detailRows(FROM, TO);

    expect(orders).toHaveLength(1);
    expect(orders[0].partnerCount).toBe(3);
    expect(orders[0].grandTotal).toBe(150000);
    // One row of 150.000, not three rows of 150.000.
    expect(orders.reduce((s, o) => s + o.grandTotal, 0)).toBe(150000);
  });

  it('counts cash by paidAt/completedAt inside the window, not by creation', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        payments: [
          {
            id: 1,
            method: 'COD',
            amount: '150000',
            status: PaymentStatus.PAID,
            paidAt: new Date('2026-10-03T05:00:00Z'),
            refunds: [
              {
                amount: '50000',
                status: RefundStatus.COMPLETED,
                completedAt: new Date('2026-10-05T05:00:00Z'),
              },
              {
                amount: '20000',
                status: RefundStatus.PENDING,
                completedAt: null,
              },
            ],
          },
          {
            id: 2,
            method: 'VNPAY',
            amount: '999000',
            status: PaymentStatus.PAID,
            // Collected AFTER the window: must not count.
            paidAt: new Date('2026-10-20T05:00:00Z'),
            refunds: [],
          },
        ],
      }),
    ]);

    const { orders } = await service.detailRows(FROM, TO);

    expect(orders).toHaveLength(1);
    expect(orders[0].collectedInWindow).toBe(150000);
    // Only the COMPLETED refund inside the window counts.
    expect(orders[0].refundedInWindow).toBe(50000);
    expect(orders[0].paymentMethod).toBe('VNPAY');
    expect(orders[0].paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('ignores money on non-collected payment statuses', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        payments: [
          {
            id: 1,
            method: 'COD',
            amount: '150000',
            status: PaymentStatus.PENDING,
            paidAt: null,
            refunds: [],
          },
        ],
      }),
    ]);

    const { orders } = await service.detailRows(FROM, TO);
    expect(orders[0].collectedInWindow).toBe(0);
    expect(orders[0].paymentStatus).toBe(PaymentStatus.PENDING);
  });

  it('returns return/complaint rows with their order codes', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.returnRequest.findMany.mockResolvedValue([
      {
        order: { code: 'ORD-20261003-0001' },
        quantity: '1',
        status: 'REQUESTED',
        reason: 'Hàng dập',
        createdAt: new Date('2026-10-04T01:00:00Z'),
      },
    ]);
    prisma.complaint.findMany.mockResolvedValue([
      {
        order: { code: 'ORD-20261003-0001' },
        type: 'PRODUCT_QUALITY',
        status: 'OPEN',
        createdAt: new Date('2026-10-04T02:00:00Z'),
      },
    ]);

    const res = await service.detailRows(FROM, TO);
    expect(res.orders).toEqual([]);
    expect(res.returns).toEqual([
      {
        orderCode: 'ORD-20261003-0001',
        quantity: 1,
        status: 'REQUESTED',
        reason: 'Hàng dập',
        createdAt: new Date('2026-10-04T01:00:00Z'),
      },
    ]);
    expect(res.complaints).toEqual([
      {
        orderCode: 'ORD-20261003-0001',
        type: 'PRODUCT_QUALITY',
        status: 'OPEN',
        createdAt: new Date('2026-10-04T02:00:00Z'),
      },
    ]);
  });

  it('rejects an inverted window like summary() does', async () => {
    await expect(service.detailRows(TO, FROM)).rejects.toThrow(/from/);
  });
});
