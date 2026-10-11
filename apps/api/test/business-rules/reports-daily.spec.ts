import { describe, expect, it, beforeEach } from 'vitest';
import { ReportsService, LOW_STOCK_THRESHOLD } from '../../src/reports/reports.service.js';
import {
  buildDayKeys,
  resolveReportWindow,
  shiftDayKey,
  vnDayKey,
  vnDayStartUtc,
} from '../../src/reports/daily.util.js';
import { PaymentStatus, RefundStatus } from '../../generated/prisma/enums.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * Bucketing rule: the business day is the Vietnam day (UTC+7), so a row written
 * at 20:00 UTC belongs to the NEXT Vietnam day. These pure helpers back the SQL
 * `DATE(paid_at + 7h)` key, so getting them right keeps the chart aligned.
 */
describe('VN day bucketing', () => {
  it('shifts a late-UTC instant into the next Vietnam day', () => {
    // 2026-10-08 20:00 UTC == 2026-10-09 03:00 VN
    expect(vnDayKey(new Date('2026-10-08T20:00:00Z'))).toBe('2026-10-09');
    // 2026-10-08 16:00 UTC == 2026-10-08 23:00 VN (same day)
    expect(vnDayKey(new Date('2026-10-08T16:00:00Z'))).toBe('2026-10-08');
  });

  it('maps a VN day key back to its UTC midnight', () => {
    // 00:00 VN on 2026-10-09 == 17:00 UTC on 2026-10-08
    expect(vnDayStartUtc('2026-10-09').toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });

  it('builds an inclusive zero-filled key range', () => {
    expect(buildDayKeys('2026-10-01', '2026-10-04')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('returns an empty range when from is after to', () => {
    expect(buildDayKeys('2026-10-05', '2026-10-01')).toEqual([]);
  });

  it('shifts day keys across a month boundary', () => {
    expect(shiftDayKey('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
  });
});

/**
 * `summary()` and `daily()` share `resolveReportWindow`, which is what makes a
 * KPI total and the chart sum reconcile for the same period: identical bounds.
 */
describe('resolveReportWindow', () => {
  it('uses explicit from/to verbatim', () => {
    const from = new Date('2026-10-01T03:00:00Z');
    const to = new Date('2026-10-05T09:30:00Z');
    expect(resolveReportWindow(from, to)).toEqual({ start: from, end: to });
  });

  it('defaults to the last 30 Vietnam days ending at `to`', () => {
    const to = new Date('2026-10-30T05:00:00Z'); // 12:00 VN on 2026-10-30
    const { start, end } = resolveReportWindow(undefined, to);
    expect(end).toBe(to);
    // 30 whole VN days ending 2026-10-30 start at 00:00 VN on 2026-10-01.
    expect(vnDayKey(start)).toBe('2026-10-01');
    expect(start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });

  it('honours an explicit days window (7 days => 7 whole VN days)', () => {
    const to = new Date('2026-10-30T05:00:00Z');
    const { start } = resolveReportWindow(undefined, to, 7);
    expect(vnDayKey(start)).toBe('2026-10-24');
  });
});

describe('ReportsService.daily', () => {
  let prisma: MockPrisma;
  let service: ReportsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ReportsService(prisma as never);
  });

  it('zero-fills every day and derives netCollected = collected - refunds', async () => {
    // $queryRaw is called in order: orders, payments, refunds.
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { day: '2026-10-08', n: 3n, value: '90000' },
        { day: '2026-10-10', n: 1n, value: '30000' },
      ])
      .mockResolvedValueOnce([
        { day: '2026-10-08', total: '80000' },
        { day: '2026-10-10', total: '30000' },
      ])
      .mockResolvedValueOnce([{ day: '2026-10-08', total: '5000' }]);

    const res = await service.daily(
      new Date('2026-10-08T00:00:00Z'),
      new Date('2026-10-10T16:00:00Z'),
    );

    expect(res.points.map((p) => p.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    expect(res.points[0]).toEqual({
      date: '2026-10-08',
      orderCount: 3,
      orderValue: 90000,
      grossCollected: 80000,
      refundTotal: 5000,
      netCollected: 75000,
    });
    // The empty middle day is present and zero, never a hole.
    expect(res.points[1]).toEqual({
      date: '2026-10-09',
      orderCount: 0,
      orderValue: 0,
      grossCollected: 0,
      refundTotal: 0,
      netCollected: 0,
    });
  });

  it('buckets collected money by paidAt and refunds by completedAt (SQL basis)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await service.daily(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-07T00:00:00Z'),
    );

    const paymentSql = prisma.$queryRaw.mock.calls[1][0] as string[];
    const refundSql = prisma.$queryRaw.mock.calls[2][0] as string[];
    // The raw tagged template arrives as [strings, ...values].
    const paymentText = paymentSql.join(' ');
    const refundText = refundSql.join(' ');
    expect(paymentText).toContain('paid_at');
    expect(paymentText).not.toContain('created_at');
    expect(paymentText).toContain('REFUNDED');
    expect(refundText).toContain('completed_at');
    expect(refundText).not.toContain('created_at');
  });

  it('defaults to a 30-day window ending today when only `days` is given', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await service.daily(undefined, undefined, 7);
    expect(res.points).toHaveLength(7);
    // Last point is today's Vietnam day.
    expect(res.points[res.points.length - 1].date).toBe(vnDayKey(new Date()));
  });

  it('rejects an inverted window', async () => {
    await expect(
      service.daily(new Date('2026-10-10T00:00:00Z'), new Date('2026-10-01T00:00:00Z')),
    ).rejects.toThrow(/from/);
  });
});

/** Wire the mock so `summary()` resolves; tests override what they assert. */
function mockSummaryDefaults(prisma: MockPrisma) {
  prisma.$queryRaw.mockResolvedValue([{ n: 0n }]);
  prisma.order.groupBy.mockResolvedValue([]);
  prisma.order.aggregate.mockResolvedValue({ _sum: { grandTotal: 0 }, _count: 0 });
  prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  prisma.partnerOrder.aggregate.mockResolvedValue({ _sum: { commissionAmount: 0 } });
  prisma.returnRequest.groupBy.mockResolvedValue([]);
  prisma.complaint.groupBy.mockResolvedValue([]);
  prisma.productLot.findMany.mockResolvedValue([]);
  prisma.certificate.count.mockResolvedValue(0);
  prisma.orderItem.groupBy.mockResolvedValue([]);
}

describe('ReportsService.summary', () => {
  let prisma: MockPrisma;
  let service: ReportsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ReportsService(prisma as never);
    mockSummaryDefaults(prisma);
  });

  it('counts collected money as PAID/PARTIALLY_REFUNDED/REFUNDED by paidAt', async () => {
    await service.summary(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'));

    const paymentWhere = prisma.payment.aggregate.mock.calls[0][0].where;
    expect(paymentWhere).toHaveProperty('paidAt');
    expect(paymentWhere).not.toHaveProperty('createdAt');
    expect(paymentWhere.status.in).toEqual(
      expect.arrayContaining([
        PaymentStatus.PAID,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ]),
    );

    const refundWhere = prisma.refund.aggregate.mock.calls[0][0].where;
    expect(refundWhere).toHaveProperty('completedAt');
    expect(refundWhere).not.toHaveProperty('createdAt');
    expect(refundWhere.status).toBe(RefundStatus.COMPLETED);
  });

  it('nets a fully refunded payment exactly once (never negative from double-subtraction)', async () => {
    // A 200k payment fully refunded: it stays in gross (money was collected)
    // and the 200k refund is subtracted once => net 0, not -200k.
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 200000 } });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 200000 } });

    const res = await service.summary(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T00:00:00Z'),
    );

    expect(res.revenue.grossCollected).toBe(200000);
    expect(res.revenue.refundTotal).toBe(200000);
    expect(res.revenue.netCollected).toBe(0);
  });

  it('nets a partial refund exactly once', async () => {
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 30000 } });

    const res = await service.summary(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T00:00:00Z'),
    );

    expect(res.revenue.netCollected).toBe(70000);
  });

  it('exposes the low-stock line count and its threshold', async () => {
    prisma.$queryRaw.mockResolvedValue([{ n: 3n }]);

    const res = await service.summary(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T00:00:00Z'),
    );

    expect(res.inventory.lowStockLines).toBe(3);
    expect(res.inventory.lowStockThreshold).toBe(LOW_STOCK_THRESHOLD);
  });

  it('rejects an inverted window', async () => {
    await expect(
      service.summary(new Date('2026-10-31T00:00:00Z'), new Date('2026-10-01T00:00:00Z')),
    ).rejects.toThrow(/from/);
  });
});
