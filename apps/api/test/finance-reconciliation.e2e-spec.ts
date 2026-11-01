import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login } from './helpers/test-app.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  E2E_CUSTOMER_PASSWORD,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * `GET /finance/reconciliation` over real HTTP (ADMIN only, read-only).
 *
 * The report is the operator's worklist, so the assertions are about what an
 * operator must be able to see: the four money states, the evidence gap, the
 * filters that narrow the list, and the fact that the summary describes the
 * period even while a filter is applied.
 *
 * Every order this suite creates carries the run prefix, so `search` isolates
 * them from the rest of the test schema and `cleanupFixtures` removes them.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2erc');

describe.skipIf(!hasTestDb)('Finance reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  /** Orders created for this suite, keyed by the scenario they represent. */
  const created: Record<string, number> = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);

    const makeOrder = async (suffix: string, grandTotal: number) => {
      const order = await prisma.order.create({
        data: {
          code: `${RUN_ID}-RECON-${suffix}`,
          customerId: fixtures.customerId,
          shippingAddressSnapshot: {
            recipientName: 'E2E Khách',
            phone: '0911111111',
            province: 'Hưng Yên',
            detail: 'Số 1, đường E2E',
          },
          subtotal: grandTotal,
          discountTotal: 0,
          shippingFee: 0,
          grandTotal,
          status: 'DELIVERED',
        },
      });
      created[suffix] = order.id;
      return order.id;
    };

    // PARTIAL — 40.000 of 100.000 collected.
    const partialId = await makeOrder('PARTIAL', 100000);
    await prisma.payment.create({
      data: {
        orderId: partialId,
        method: 'COD',
        amount: 40000,
        status: 'PAID',
        paidAt: new Date(),
      },
    });

    // OVER — 120.000 collected for a 100.000 order.
    const overId = await makeOrder('OVER', 100000);
    await prisma.payment.create({
      data: {
        orderId: overId,
        method: 'COD',
        amount: 120000,
        status: 'PAID',
        paidAt: new Date(),
      },
    });

    // EVIDENCE — PAID without `paid_at`: money claimed, never evidenced.
    const evidenceId = await makeOrder('EVIDENCE', 100000);
    await prisma.payment.create({
      data: {
        orderId: evidenceId,
        method: 'VNPAY',
        amount: 100000,
        status: 'PAID',
        paidAt: null,
      },
    });

    // PARTIAL_REFUND — fully collected, 40.000 returned. A correct row.
    const partialRefundId = await makeOrder('PARTIAL-REFUND', 100000);
    const partialRefundPayment = await prisma.payment.create({
      data: {
        orderId: partialRefundId,
        method: 'COD',
        amount: 100000,
        status: 'PARTIALLY_REFUNDED',
        paidAt: new Date(),
      },
    });
    await prisma.refund.create({
      data: {
        paymentId: partialRefundPayment.id,
        amount: 40000,
        reason: 'Hàng dập một phần',
        status: 'COMPLETED',
        reference: 'BANK-E2E-PARTIAL',
        approvedAt: new Date(),
        completedAt: new Date(),
      },
    });

    // FULL_REFUND — fully collected and fully returned. Also a correct row.
    const fullRefundId = await makeOrder('FULL-REFUND', 100000);
    const fullRefundPayment = await prisma.payment.create({
      data: {
        orderId: fullRefundId,
        method: 'COD',
        amount: 100000,
        status: 'REFUNDED',
        paidAt: new Date(),
      },
    });
    await prisma.refund.create({
      data: {
        paymentId: fullRefundPayment.id,
        amount: 100000,
        reason: 'Khách trả toàn bộ',
        status: 'COMPLETED',
        reference: 'BANK-E2E-FULL',
        approvedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }, 60_000);

  afterAll(async () => {
    await cleanupFixtures(prisma, fixtures).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
  });

  const get = (query: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1/finance/reconciliation?${query}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const search = `${RUN_ID}-RECON`;

  it('rejects anonymous callers and CUSTOMERs', async () => {
    expect((await get(`search=${search}`)).status).toBe(401);
    const asCustomer = await get(`search=${search}`, customerToken);
    expect(asCustomer.status).toBe(403);
  });

  it('returns the documented shape for ADMIN', async () => {
    const res = await get(`search=${search}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      scanned: expect.any(Number),
      truncated: false,
      scanLimit: expect.any(Number),
      range: { from: null, to: null },
      meta: { page: 1, limit: 20, total: expect.any(Number), totalPages: expect.any(Number) },
    });
    expect(res.body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(res.body.summary.byIssue).sort()).toEqual([
      'MISSING_COLLECTION_EVIDENCE',
      'OVER_COLLECTED',
      'REFUND_STATUS_MISMATCH',
      'REFUND_WITHOUT_COLLECTION',
      'SETTLED_WITHOUT_FULL_COLLECTION',
      'UNDER_COLLECTED',
    ]);
    expect(res.body.summary.byCollection).toMatchObject({
      NONE: expect.any(Number),
      PARTIAL: expect.any(Number),
      FULL: expect.any(Number),
      OVER: expect.any(Number),
    });
    expect(res.body.summary.totals).toMatchObject({
      obligation: expect.any(Number),
      collected: expect.any(Number),
      refunded: expect.any(Number),
      outstanding: expect.any(Number),
    });
    expect(res.body.note).toMatch(/Read-only/);
  });

  it('classifies each money state and names the evidence gap', async () => {
    const res = await get(`search=${search}`, adminToken);
    expect(res.status).toBe(200);

    const row = (orderId: number) =>
      res.body.findings.find((finding: { orderId: number }) => finding.orderId === orderId);

    const partial = row(created.PARTIAL);
    expect(partial).toMatchObject({
      collection: 'PARTIAL',
      obligation: 100000,
      collected: 40000,
      outstanding: 60000,
      refundState: 'NONE',
      settled: false,
    });
    expect(partial.issues).toContain('UNDER_COLLECTED');

    expect(row(created.OVER)).toMatchObject({ collection: 'OVER', collected: 120000 });
    expect(row(created.OVER).issues).toContain('OVER_COLLECTED');

    const evidence = row(created.EVIDENCE);
    expect(evidence.collection).toBe('NONE');
    // The claimed money is NOT counted: status without `paid_at` is not proof.
    expect(evidence.collected).toBe(0);
    expect(evidence.issues).toEqual(['MISSING_COLLECTION_EVIDENCE']);
    expect(evidence.paymentStatuses).toEqual(['PAID']);

    // Correct refund rows are absent from the default worklist.
    expect(row(created['PARTIAL-REFUND'])).toBeUndefined();
    expect(row(created['FULL-REFUND'])).toBeUndefined();
  });

  it('lists fully collected and refunded orders only when includeMatched is set', async () => {
    const res = await get(
      `search=${search}&includeMatched=true&collection=FULL&limit=100`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const ids = res.body.findings.map((finding: { orderId: number }) => finding.orderId);
    expect(ids).toEqual(
      expect.arrayContaining([created['PARTIAL-REFUND'], created['FULL-REFUND']]),
    );
    // PARTIAL / OVER / NONE are not "fully collected".
    expect(ids).not.toContain(created.PARTIAL);
    expect(ids).not.toContain(created.OVER);
    expect(ids).not.toContain(created.EVIDENCE);

    const partialRefund = res.body.findings.find(
      (finding: { orderId: number }) => finding.orderId === created['PARTIAL-REFUND'],
    );
    expect(partialRefund).toMatchObject({
      refundState: 'PARTIAL',
      refunded: 40000,
      issues: [],
    });

    const fullRefund = res.body.findings.find(
      (finding: { orderId: number }) => finding.orderId === created['FULL-REFUND'],
    );
    expect(fullRefund).toMatchObject({ refundState: 'FULL', refunded: 100000, issues: [] });
  });

  it('filters by issue without shrinking the period summary', async () => {
    const res = await get(`search=${search}&issue=UNDER_COLLECTED`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.findings.map((finding: { orderId: number }) => finding.orderId)).toEqual([
      created.PARTIAL,
    ]);
    // Three findings exist in the period (partial, over, evidence gap); the
    // filter narrows the page, not the summary.
    expect(res.body.summary.ordersWithFindings).toBe(3);
    expect(res.body.meta.total).toBe(1);
  });

  it('filters by order status and rejects an unknown enum value', async () => {
    const delivered = await get(`search=${search}&status=DELIVERED`, adminToken);
    expect(delivered.status).toBe(200);
    expect(delivered.body.findings).toHaveLength(3);

    const shipping = await get(`search=${search}&status=SHIPPING`, adminToken);
    expect(shipping.status).toBe(200);
    expect(shipping.body.findings).toHaveLength(0);

    expect((await get(`search=${search}&status=NOT_A_STATUS`, adminToken)).status).toBe(400);
    expect((await get(`search=${search}&issue=NOT_AN_ISSUE`, adminToken)).status).toBe(400);
    expect((await get(`search=${search}&collection=SOMETIMES`, adminToken)).status).toBe(400);
  });

  it('applies the creation-date window', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const res = await get(`search=${search}&from=${future}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([]);
    expect(res.body.range.from).toBe(future);
  });

  it('is read-only: the payments and refunds are byte-identical afterwards', async () => {
    const orderIds = Object.values(created);
    const before = await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, amount: true, status: true, paidAt: true },
      orderBy: { id: 'asc' },
    });
    const refundsBefore = await prisma.refund.findMany({
      where: { payment: { orderId: { in: orderIds } } },
      select: { id: true, amount: true, status: true },
      orderBy: { id: 'asc' },
    });

    expect((await get(`search=${search}&includeMatched=true`, adminToken)).status).toBe(200);

    const after = await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, amount: true, status: true, paidAt: true },
      orderBy: { id: 'asc' },
    });
    const refundsAfter = await prisma.refund.findMany({
      where: { payment: { orderId: { in: orderIds } } },
      select: { id: true, amount: true, status: true },
      orderBy: { id: 'asc' },
    });

    expect(after).toEqual(before);
    expect(refundsAfter).toEqual(refundsBefore);
  });

  it('reports the settlement that already claimed a fully collected order', async () => {
    const res = await get(`search=${RUN_ID}-ORD&includeMatched=true`, adminToken);
    expect(res.status).toBe(200);
    const fixtureOrder = res.body.findings.find(
      (finding: { orderId: number }) => finding.orderId === fixtures.orderId,
    );
    expect(fixtureOrder).toMatchObject({ collection: 'FULL', settled: true, issues: [] });
    expect(fixtureOrder.settlements).toEqual([
      { id: fixtures.settlementId, code: expect.stringContaining(RUN_ID), status: 'DRAFT' },
    ]);
  });
});
