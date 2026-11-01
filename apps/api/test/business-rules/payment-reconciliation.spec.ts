import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECONCILIATION_SCAN,
  PaymentReconciliationService,
} from '../../src/finance/payment-reconciliation.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

const PAID_AT = new Date('2026-10-05T10:00:00.000Z');

interface OrderRow {
  id: number;
  code?: string;
  status?: string;
  grandTotal: number;
  createdAt?: Date;
  payments?: Array<{
    amount: number;
    status: string;
    paidAt: Date | null;
    refunds?: Array<{ amount: number; status: string }>;
  }>;
  settled?: boolean;
}

function orderRow(overrides: OrderRow) {
  return {
    id: overrides.id,
    code: overrides.code ?? `ORD-${overrides.id}`,
    status: overrides.status ?? 'DELIVERED',
    grandTotal: overrides.grandTotal,
    createdAt: overrides.createdAt ?? new Date('2026-10-01T00:00:00.000Z'),
    payments: (overrides.payments ?? []).map((payment) => ({
      amount: payment.amount,
      status: payment.status,
      paidAt: payment.paidAt,
      refunds: payment.refunds ?? [],
    })),
    partnerOrders: overrides.settled ? [{ settlementLines: [{ id: 1 }] }] : [],
  };
}

describe('PaymentReconciliationService', () => {
  let prisma: MockPrisma;
  let service: PaymentReconciliationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PaymentReconciliationService(prisma as never);
  });

  it('reports nothing when collected money matches the order obligation', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 1,
        grandTotal: 100000,
        payments: [{ amount: 100000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    expect(report.findings).toEqual([]);
    expect(report.summary.ordersWithFindings).toBe(0);
    expect(report.summary.totals).toEqual({
      obligation: 100000,
      collected: 100000,
      refunded: 0,
      outstanding: 0,
    });
  });

  it('flags an order that was only partly collected', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 2,
        grandTotal: 100000,
        payments: [{ amount: 60000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].issues).toContain('UNDER_COLLECTED');
    expect(report.findings[0].outstanding).toBe(40000);
    expect(report.summary.byIssue.UNDER_COLLECTED).toBe(1);
  });

  it('flags a payment that collected more than the order total', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 3,
        grandTotal: 100000,
        payments: [{ amount: 120000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].issues).toContain('OVER_COLLECTED');
  });

  it('flags a settled order whose collection is incomplete', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 4,
        grandTotal: 200000,
        settled: true,
        payments: [{ amount: 100000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].settled).toBe(true);
    expect(report.findings[0].issues).toEqual(
      expect.arrayContaining(['UNDER_COLLECTED', 'SETTLED_WITHOUT_FULL_COLLECTION']),
    );
  });

  it('does not flag a settled order that was fully collected and then fully refunded', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 5,
        grandTotal: 100000,
        settled: true,
        payments: [
          {
            amount: 100000,
            status: 'REFUNDED',
            paidAt: PAID_AT,
            refunds: [{ amount: 100000, status: 'COMPLETED' }],
          },
        ],
      }),
    ]);

    const report = await service.report();

    // The money did arrive and did go back; the settlement line nets to zero.
    // That is a correct statement, not a discrepancy.
    expect(report.findings).toEqual([]);
    expect(report.summary.totals).toMatchObject({ collected: 100000, refunded: 100000 });
  });

  it('distinguishes a refunded order from an under-collected one', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 51,
        grandTotal: 100000,
        settled: true,
        payments: [
          {
            amount: 100000,
            status: 'PARTIALLY_REFUNDED',
            paidAt: PAID_AT,
            refunds: [{ amount: 40000, status: 'COMPLETED' }],
          },
        ],
      }),
      orderRow({
        id: 52,
        grandTotal: 100000,
        payments: [{ amount: 40000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    const under = report.findings.find((row) => row.orderId === 52);
    expect(under?.refundState).toBe('NONE');
    expect(under?.issues).toContain('UNDER_COLLECTED');
    // The refunded order is clean: same "less than grand total" look in a
    // totals column, opposite meaning.
    expect(report.findings.some((row) => row.orderId === 51)).toBe(false);
  });

  it('reports the refund state on a row that also has a real problem', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 53,
        grandTotal: 100000,
        payments: [
          {
            amount: 100000,
            status: 'PAID',
            paidAt: PAID_AT,
            refunds: [{ amount: 25000, status: 'COMPLETED' }],
          },
        ],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].refundState).toBe('PARTIAL');
    expect(report.findings[0].issues).toContain('REFUND_STATUS_MISMATCH');
  });

  it('treats PENDING/APPROVED refunds as decisions, not money', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 6,
        grandTotal: 100000,
        payments: [
          {
            amount: 100000,
            status: 'PAID',
            paidAt: PAID_AT,
            refunds: [
              { amount: 40000, status: 'PENDING' },
              { amount: 20000, status: 'APPROVED' },
            ],
          },
        ],
      }),
    ]);

    const report = await service.report();

    expect(report.summary.totals.refunded).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it('flags a completed refund on a payment that was never collected', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 7,
        grandTotal: 100000,
        payments: [
          {
            amount: 100000,
            status: 'PENDING',
            paidAt: null,
            refunds: [{ amount: 100000, status: 'COMPLETED' }],
          },
        ],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].issues).toContain('REFUND_WITHOUT_COLLECTION');
    expect(report.summary.totals.refunded).toBe(100000);
  });

  it('flags a PAID payment that already carries a completed refund', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 8,
        grandTotal: 100000,
        payments: [
          {
            amount: 100000,
            status: 'PAID',
            paidAt: PAID_AT,
            refunds: [{ amount: 30000, status: 'COMPLETED' }],
          },
        ],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].issues).toContain('REFUND_STATUS_MISMATCH');
  });

  it('is read-only: it never writes to the database', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.report();

    for (const model of ['payment', 'refund', 'settlement', 'settlementLine'] as const) {
      const delegate = prisma[model] as unknown as Record<string, { mock: { calls: unknown[] } }>;
      for (const method of ['create', 'update', 'updateMany', 'delete', 'deleteMany']) {
        expect(delegate[method].mock.calls).toHaveLength(0);
      }
    }
  });

  it('paginates findings and reports the total separately', async () => {
    prisma.order.findMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) =>
        orderRow({
          id: index + 1,
          grandTotal: 100000,
          payments: [{ amount: 50000, status: 'PAID', paidAt: PAID_AT }],
        }),
      ),
    );

    const report = await service.report({ page: 2, limit: 2 });

    expect(report.findings).toHaveLength(1);
    expect(report.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('says when the scan limit clipped the report', async () => {
    prisma.order.findMany.mockResolvedValue(
      Array.from({ length: MAX_RECONCILIATION_SCAN + 1 }, (_, index) =>
        orderRow({ id: index + 1, grandTotal: 1000 }),
      ),
    );

    const report = await service.report({ limit: 5 });

    expect(report.truncated).toBe(true);
    expect(report.scanned).toBe(MAX_RECONCILIATION_SCAN);
  });
});
