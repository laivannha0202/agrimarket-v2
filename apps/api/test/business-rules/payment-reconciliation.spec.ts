import { beforeEach, describe, expect, it } from 'vitest';
import {
  PaymentReconciliationService,
  RECONCILIATION_BATCH_SIZE,
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
    partnerOrders: overrides.settled
      ? [
          {
            settlementLines: [
              { settlement: { id: 9, code: 'STL-2026-09', status: 'CONFIRMED' } },
            ],
          },
        ]
      : [],
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
      originalValue: 100000,
      obligation: 100000,
      collected: 100000,
      refunded: 0,
      outstanding: 0,
      refundDue: 0,
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
    expect(report.findings[0].refundDue).toBe(20000);
    expect(report.summary.totals.refundDue).toBe(20000);
  });

  it('does not net an over-collected order against another order still owing', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 71,
        grandTotal: 100000,
        payments: [{ amount: 50000, status: 'PAID', paidAt: PAID_AT }],
      }),
      orderRow({
        id: 72,
        grandTotal: 100000,
        payments: [{ amount: 130000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    // 50k is still owed on order 71 and 30k must be returned on order 72.
    // Netting them would understate the receivable to 20k and hide the refund.
    expect(report.summary.totals).toMatchObject({
      originalValue: 200000,
      obligation: 200000,
      collected: 180000,
      outstanding: 50000,
      refundDue: 30000,
    });
  });

  it('keeps the original value of a cancelled order and reports the refund due', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 61,
        status: 'CANCELLED',
        grandTotal: 100000,
        payments: [{ amount: 40000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    // The order value is not rewritten to 0: it stays on the row as the
    // original value, while the effective obligation is 0.
    expect(report.findings[0]).toMatchObject({
      originalValue: 100000,
      obligation: 0,
      collected: 40000,
      refunded: 0,
      outstanding: 0,
      refundDue: 40000,
      collection: 'OVER',
    });
    expect(report.findings[0].issues).toContain('OVER_COLLECTED');
    expect(report.summary.totals).toMatchObject({
      originalValue: 100000,
      obligation: 0,
      refundDue: 40000,
    });
  });

  it('treats a fully refunded cancellation as clean, not over-collected', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 62,
        status: 'CANCELLED',
        grandTotal: 100000,
        payments: [
          {
            amount: 40000,
            status: 'REFUNDED',
            paidAt: PAID_AT,
            refunds: [{ amount: 40000, status: 'COMPLETED' }],
          },
        ],
      }),
    ]);

    const report = await service.report();

    expect(report.findings).toEqual([]);
    expect(report.summary.byCollection.NONE).toBe(1);
    expect(report.summary.totals).toMatchObject({
      originalValue: 100000,
      obligation: 0,
      collected: 40000,
      refunded: 40000,
      refundDue: 0,
    });
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

  it('covers more than 2,000 orders in bounded keyset batches', async () => {
    const total = 2_345;
    const orders = Array.from({ length: total }, (_, index) =>
      orderRow({
        id: total - index,
        grandTotal: 100000,
        payments: [{ amount: 50000, status: 'PAID', paidAt: PAID_AT }],
      }),
    );
    const batches: number[][] = [];
    prisma.order.findMany.mockImplementation(
      async (args: { where?: { id?: { lt?: number } }; take?: number }) => {
        const take = args.take ?? total;
        const cursor = args.where?.id?.lt;
        const matching =
          cursor === undefined ? orders : orders.filter((row) => row.id < cursor);
        const batch = matching.slice(0, take);
        batches.push(batch.map((row) => row.id));
        return batch;
      },
    );

    const report = await service.report({ page: 118, limit: 20 });

    expect(report.scanned).toBe(total);
    expect(report.summary.ordersWithFindings).toBe(total);
    expect(report.summary.byIssue.UNDER_COLLECTED).toBe(total);
    expect(report.summary.totals).toMatchObject({
      obligation: total * 100000,
      collected: total * 50000,
      outstanding: total * 50000,
    });
    expect(report.meta).toMatchObject({ page: 118, limit: 20, total, totalPages: 118 });
    // 2,345 findings = 117 full pages + 5 rows on the last page.
    expect(report.findings).toHaveLength(5);

    // Every read was bounded, and each cursor moved strictly below the
    // previous batch — no order is read twice and none is skipped.
    expect(batches).toHaveLength(Math.ceil(total / RECONCILIATION_BATCH_SIZE));
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(RECONCILIATION_BATCH_SIZE);
    }
    for (let index = 1; index < batches.length; index += 1) {
      expect(Math.max(...batches[index])).toBeLessThan(Math.min(...batches[index - 1]));
    }
  });

  it('classifies every scanned order by how much of the obligation was collected', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({ id: 1, grandTotal: 100000 }),
      orderRow({
        id: 2,
        grandTotal: 100000,
        payments: [{ amount: 40000, status: 'PAID', paidAt: PAID_AT }],
      }),
      orderRow({
        id: 3,
        grandTotal: 100000,
        payments: [{ amount: 100000, status: 'PAID', paidAt: PAID_AT }],
      }),
      orderRow({
        id: 4,
        grandTotal: 100000,
        payments: [{ amount: 130000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    // The summary is a statement about the period, including clean orders.
    expect(report.summary.byCollection).toEqual({ NONE: 1, PARTIAL: 1, FULL: 1, OVER: 1 });
    // Only the discrepancies are listed by default.
    expect(report.findings.map((row) => row.orderId).sort()).toEqual([2, 4]);
    expect(report.findings.find((row) => row.orderId === 2)?.collection).toBe('PARTIAL');
    expect(report.findings.find((row) => row.orderId === 4)?.collection).toBe('OVER');
  });

  it('flags a payment that claims money moved but carries no paid_at evidence', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 11,
        grandTotal: 100000,
        payments: [{ amount: 100000, status: 'PAID', paidAt: null }],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].issues).toEqual(['MISSING_COLLECTION_EVIDENCE']);
    // The money is NOT counted: a status without a timestamp is a claim.
    expect(report.findings[0].collected).toBe(0);
    expect(report.summary.byIssue.MISSING_COLLECTION_EVIDENCE).toBe(1);
  });

  it('does not treat a pending or failed payment as missing evidence', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 12,
        grandTotal: 100000,
        payments: [
          { amount: 100000, status: 'PENDING', paidAt: null },
          { amount: 100000, status: 'FAILED', paidAt: null },
        ],
      }),
    ]);

    const report = await service.report();

    expect(report.findings).toEqual([]);
    expect(report.summary.byIssue.MISSING_COLLECTION_EVIDENCE).toBe(0);
  });

  it('lists matched orders only when includeMatched is requested', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 21,
        grandTotal: 100000,
        payments: [{ amount: 100000, status: 'PAID', paidAt: PAID_AT }],
      }),
      orderRow({
        id: 22,
        grandTotal: 100000,
        payments: [{ amount: 50000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const clean = await service.report();
    expect(clean.findings.map((row) => row.orderId)).toEqual([22]);
    expect(clean.meta.total).toBe(1);

    const widened = await service.report({ includeMatched: true });
    expect(widened.findings.map((row) => row.orderId)).toEqual([21, 22]);
    expect(widened.meta.total).toBe(2);
    // Widening the list does not change what the period looks like.
    expect(widened.summary.ordersWithFindings).toBe(1);
  });

  it('filters the list by issue, collection, status and order code', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 31,
        code: 'ORD-AAA',
        status: 'DELIVERED',
        grandTotal: 100000,
        payments: [{ amount: 50000, status: 'PAID', paidAt: PAID_AT }],
      }),
      orderRow({
        id: 32,
        code: 'ORD-BBB',
        status: 'SHIPPING',
        grandTotal: 100000,
        payments: [{ amount: 120000, status: 'PAID', paidAt: PAID_AT }],
      }),
      orderRow({
        id: 33,
        code: 'ORD-CCC',
        status: 'DELIVERED',
        grandTotal: 100000,
        payments: [{ amount: 50000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const byIssue = await service.report({ issue: 'OVER_COLLECTED' });
    expect(byIssue.findings.map((row) => row.orderId)).toEqual([32]);
    // The period totals still count every finding, not just the filtered page.
    expect(byIssue.summary.ordersWithFindings).toBe(3);
    expect(byIssue.meta.total).toBe(1);

    const byStatus = await service.report({ status: 'DELIVERED' });
    expect(byStatus.findings.map((row) => row.orderId)).toEqual([31, 33]);

    const bySearch = await service.report({ search: 'ord-bb' });
    expect(bySearch.findings.map((row) => row.orderId)).toEqual([32]);

    const byCollection = await service.report({ collection: 'PARTIAL' });
    expect(byCollection.findings.map((row) => row.orderId)).toEqual([31, 33]);
  });

  it('reports the settlements that already claimed the order', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderRow({
        id: 41,
        grandTotal: 100000,
        settled: true,
        payments: [{ amount: 40000, status: 'PAID', paidAt: PAID_AT }],
      }),
    ]);

    const report = await service.report();

    expect(report.findings[0].settled).toBe(true);
    expect(report.findings[0].settlements).toEqual([
      { id: 9, code: 'STL-2026-09', status: 'CONFIRMED' },
    ]);
  });
});
