import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login } from './helpers/test-app.js';
import { vnDayKey } from '../src/reports/daily.util.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  E2E_PREFIX,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * Reports revenue & cash-flow acceptance (e2e, MySQL TEST).
 *
 * Proves the three acceptance fixes against the real HTTP stack + database:
 *
 *  1. Net-revenue formula. A fully refunded payment must stay in
 *     `grossCollected` (the money *was* collected) and the refund must be
 *     netted exactly once — never double-subtracted. Covers PAID,
 *     PARTIALLY_REFUNDED, REFUNDED, partial and full refunds.
 *  2. Cash flow is dated by when the money actually moved: `Payment.paidAt`
 *     and `Refund.completedAt` (NOT `created_at`). Covers COD collected after
 *     the order date, a refund completed on a different day from its payment,
 *     the 7/30-day windows, and the Vietnam (UTC+7) day boundary. `summary()`
 *     and `daily()` share one window resolver, so a KPI total equals the chart
 *     sum for the same period.
 *  3. `inventory.lowStockLines` counts stock **lines** (`inventory_balances`
 *     rows), not products or lots, with an explicit threshold.
 *
 * Every row is tagged with the run id and removed in `afterAll`; the demo seed
 * and the dev database are never touched. Fixtures use far-past windows
 * (2021) that the rolling demo seed never occupies, so the aggregates see only
 * the rows created here.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2erpt');

/** Number of Vietnam calendar days in an inclusive [from, to] window. */
function vnDaySpan(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = vnDayKey(new Date(fromIso)).split('-').map(Number);
  const [ty, tm, td] = vnDayKey(new Date(toIso)).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/** UTC bounds of one Vietnam calendar day, e.g. `2021-03-06` -> 17:00Z prev..16:59Z. */
function vnDayWindow(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - 7 * 3600_000);
  const to = new Date(from.getTime() + 86_400_000 - 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

describe.skipIf(!hasTestDb)('Reports revenue & cash flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  async function createOrderWithPayment(params: {
    tag: string;
    grandTotal: number;
    orderCreatedAt: Date;
    orderStatus?: string;
    payStatus: string;
    paidAt: Date;
    method?: string;
  }): Promise<{ orderId: number; paymentId: number }> {
    const order = await prisma.order.create({
      data: {
        code: `${RUN_ID}-${params.tag}`,
        customerId: fixtures.customerId,
        shippingAddressSnapshot: { recipientName: 'E2E RPT', phone: '0900000000', province: 'HN', detail: '—' },
        subtotal: params.grandTotal,
        grandTotal: params.grandTotal,
        status: (params.orderStatus ?? 'DELIVERED') as never,
        createdAt: params.orderCreatedAt,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        method: (params.method ?? 'COD') as never,
        amount: params.grandTotal,
        status: params.payStatus as never,
        paidAt: params.paidAt,
      },
    });
    return { orderId: order.id, paymentId: payment.id };
  }

  async function createRefund(paymentId: number, amount: number, completedAt: Date) {
    return prisma.refund.create({
      data: {
        paymentId,
        amount,
        reason: `Hoàn tiền e2e ${RUN_ID}`,
        status: 'COMPLETED',
        completedAt,
      },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
  });

  afterAll(async () => {
    if (prisma && fixtures) {
      await cleanupFixtures(prisma, fixtures);
      const leftovers = await prisma.user.count({ where: { email: { startsWith: E2E_PREFIX } } });
      expect(leftovers).toBe(0);
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Net-revenue formula across payment states
  // -------------------------------------------------------------------------
  describe('1. net revenue = collected − refunded, each counted once', () => {
    // March 2021 (VN): one month of controlled payments/refunds.
    const W1_FROM = '2021-02-28T17:00:00.000Z'; // 00:00 VN 2021-03-01
    const W1_TO = '2021-03-31T16:59:59.000Z'; // 23:59:59 VN 2021-03-31

    beforeAll(async () => {
      // O1: PAID, no refund.
      await createOrderWithPayment({
        tag: 'R1',
        grandTotal: 100_000,
        orderCreatedAt: new Date('2021-03-05T02:00:00Z'),
        payStatus: 'PAID',
        paidAt: new Date('2021-03-05T03:00:00Z'),
      });
      // O2: PARTIALLY_REFUNDED — 200k collected, 50k refunded.
      const o2 = await createOrderWithPayment({
        tag: 'R2',
        grandTotal: 200_000,
        orderCreatedAt: new Date('2021-03-06T02:00:00Z'),
        payStatus: 'PARTIALLY_REFUNDED',
        paidAt: new Date('2021-03-06T03:00:00Z'),
      });
      await createRefund(o2.paymentId, 50_000, new Date('2021-03-06T04:00:00Z'));
      // O3: REFUNDED in full — 300k collected, 300k refunded.
      const o3 = await createOrderWithPayment({
        tag: 'R3',
        grandTotal: 300_000,
        orderCreatedAt: new Date('2021-03-07T02:00:00Z'),
        payStatus: 'REFUNDED',
        paidAt: new Date('2021-03-07T03:00:00Z'),
      });
      await createRefund(o3.paymentId, 300_000, new Date('2021-03-07T04:00:00Z'));
    });

    it('keeps a fully refunded payment in gross and nets the refund once', async () => {
      const res = await get(`/api/v1/reports/summary?from=${W1_FROM}&to=${W1_TO}`).expect(200);
      // gross = 100k + 200k + 300k = 600k (REFUNDED payment still collected).
      // refund = 50k + 300k = 350k. net = 250k.
      // The old bug dropped the REFUNDED payment from gross AND subtracted the
      // refund: gross 300k − refund 350k = −50k. This assertion locks the fix.
      expect(res.body.revenue).toEqual({
        grossCollected: 600_000,
        refundTotal: 350_000,
        netCollected: 250_000,
      });
    });

    it('never produces a negative net for a period where collection ≥ refund', async () => {
      const res = await get(`/api/v1/reports/summary?from=${W1_FROM}&to=${W1_TO}`).expect(200);
      expect(res.body.revenue.netCollected).toBeGreaterThanOrEqual(0);
    });

    it('sums the daily chart to the same figures for the same window', async () => {
      const summary = await get(`/api/v1/reports/summary?from=${W1_FROM}&to=${W1_TO}`).expect(200);
      const daily = await get(`/api/v1/reports/daily?from=${W1_FROM}&to=${W1_TO}`).expect(200);

      const sum = (field: string) =>
        (daily.body.points as Array<Record<string, number>>).reduce((a, p) => a + p[field], 0);

      expect(sum('grossCollected')).toBe(summary.body.revenue.grossCollected);
      expect(sum('refundTotal')).toBe(summary.body.revenue.refundTotal);
      expect(sum('netCollected')).toBe(summary.body.revenue.netCollected);
      expect(sum('orderCount')).toBe(summary.body.orders.count);
      expect(sum('orderValue')).toBe(summary.body.orders.totalOrderValue);
    });

    it('reports a negative net in a refund-only period (correct cash view)', async () => {
      // A 70k payment collected in Feb; its refund completed 2021-04-05.
      const o4 = await createOrderWithPayment({
        tag: 'R4',
        grandTotal: 70_000,
        orderCreatedAt: new Date('2021-02-20T02:00:00Z'),
        payStatus: 'REFUNDED',
        paidAt: new Date('2021-02-20T03:00:00Z'),
      });
      await createRefund(o4.paymentId, 70_000, new Date('2021-04-05T03:00:00Z'));

      const w = vnDayWindow('2021-04-05');
      const res = await get(`/api/v1/reports/summary?from=${w.from}&to=${w.to}`).expect(200);
      expect(res.body.revenue.grossCollected).toBe(0);
      expect(res.body.revenue.refundTotal).toBe(70_000);
      expect(res.body.revenue.netCollected).toBe(-70_000);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Cash flow dated by paidAt / completedAt (VN timezone)
  // -------------------------------------------------------------------------
  describe('2. cash flow is dated by paidAt / completedAt, not created_at', () => {
    it('counts a COD payment on its paidAt day, not the order-created day', async () => {
      // Order created 2021-04-10, delivered/paid 2021-04-15 (COD collected later).
      await createOrderWithPayment({
        tag: 'COD1',
        grandTotal: 500_000,
        orderCreatedAt: new Date('2021-04-10T02:00:00Z'),
        payStatus: 'PAID',
        paidAt: new Date('2021-04-15T02:00:00Z'),
      });

      const orderDay = vnDayWindow('2021-04-10');
      const paidDay = vnDayWindow('2021-04-15');

      const atOrderDay = await get(
        `/api/v1/reports/daily?from=${orderDay.from}&to=${orderDay.to}`,
      ).expect(200);
      expect(atOrderDay.body.points).toHaveLength(1);
      expect(atOrderDay.body.points[0].orderCount).toBe(1);
      expect(atOrderDay.body.points[0].grossCollected).toBe(0);

      const atPaidDay = await get(
        `/api/v1/reports/daily?from=${paidDay.from}&to=${paidDay.to}`,
      ).expect(200);
      expect(atPaidDay.body.points).toHaveLength(1);
      expect(atPaidDay.body.points[0].orderCount).toBe(0);
      expect(atPaidDay.body.points[0].grossCollected).toBe(500_000);
    });

    it('buckets a refund on its completedAt day, separate from its payment day', async () => {
      // Paid 2021-04-20, refunded 2021-04-25.
      const o = await createOrderWithPayment({
        tag: 'RF1',
        grandTotal: 400_000,
        orderCreatedAt: new Date('2021-04-20T02:00:00Z'),
        payStatus: 'PARTIALLY_REFUNDED',
        paidAt: new Date('2021-04-20T03:00:00Z'),
      });
      await createRefund(o.paymentId, 100_000, new Date('2021-04-25T03:00:00Z'));

      const payDay = vnDayWindow('2021-04-20');
      const refundDay = vnDayWindow('2021-04-25');

      const atPayDay = await get(`/api/v1/reports/daily?from=${payDay.from}&to=${payDay.to}`).expect(
        200,
      );
      expect(atPayDay.body.points[0].grossCollected).toBe(400_000);
      expect(atPayDay.body.points[0].refundTotal).toBe(0);

      const atRefundDay = await get(
        `/api/v1/reports/daily?from=${refundDay.from}&to=${refundDay.to}`,
      ).expect(200);
      expect(atRefundDay.body.points[0].grossCollected).toBe(0);
      expect(atRefundDay.body.points[0].refundTotal).toBe(100_000);
    });

    it('respects the Vietnam (UTC+7) day boundary', async () => {
      // 2021-05-01 20:00 UTC == 2021-05-02 03:00 VN — belongs to the NEXT VN day.
      await createOrderWithPayment({
        tag: 'TZ1',
        grandTotal: 100_000,
        orderCreatedAt: new Date('2021-05-01T20:00:00Z'),
        payStatus: 'PAID',
        paidAt: new Date('2021-05-01T20:00:00Z'),
      });

      const d1 = vnDayWindow('2021-05-01');
      const d2 = vnDayWindow('2021-05-02');

      const day1 = await get(`/api/v1/reports/daily?from=${d1.from}&to=${d1.to}`).expect(200);
      expect(day1.body.points.map((p: { date: string }) => p.date)).toEqual(['2021-05-01']);
      expect(day1.body.points[0].grossCollected).toBe(0);

      const day2 = await get(`/api/v1/reports/daily?from=${d2.from}&to=${d2.to}`).expect(200);
      expect(day2.body.points.map((p: { date: string }) => p.date)).toEqual(['2021-05-02']);
      expect(day2.body.points[0].grossCollected).toBe(100_000);
    });

    it('makes summary and daily agree on the window for 7 and 30 days', async () => {
      const to = new Date().toISOString();

      for (const days of [7, 30] as const) {
        const summary = await get(`/api/v1/reports/summary?days=${days}&to=${to}`).expect(200);
        const daily = await get(`/api/v1/reports/daily?days=${days}&to=${to}`).expect(200);

        // Same resolver => identical bounds and identical day count.
        expect(summary.body.from).toBe(daily.body.from);
        expect(summary.body.to).toBe(daily.body.to);
        expect(daily.body.points).toHaveLength(days);
        expect(vnDaySpan(summary.body.from, summary.body.to)).toBe(days);

        const sum = (field: string) =>
          (daily.body.points as Array<Record<string, number>>).reduce((a, p) => a + p[field], 0);
        expect(sum('netCollected')).toBe(summary.body.revenue.netCollected);
      }

      // A 7-day window is narrower than a 30-day one — 30 days is NOT "all history".
      const w7 = await get(`/api/v1/reports/summary?days=7&to=${to}`).expect(200);
      const w30 = await get(`/api/v1/reports/summary?days=30&to=${to}`).expect(200);
      expect(new Date(w7.body.from).getTime()).toBeGreaterThan(new Date(w30.body.from).getTime());
      expect(vnDaySpan(w30.body.from, w30.body.to)).toBe(30);
    });

    it('defaults both endpoints to the same 30 Vietnam-day window', async () => {
      const summary = await get('/api/v1/reports/summary').expect(200);
      const daily = await get('/api/v1/reports/daily').expect(200);
      // Both default to 30 days; the returned bounds make the period explicit
      // so the UI never presents a 30-day figure as "all history".
      expect(vnDaySpan(summary.body.from, summary.body.to)).toBe(30);
      expect(daily.body.points).toHaveLength(30);
      expect(vnDayKey(new Date(summary.body.to))).toBe(vnDayKey(new Date(daily.body.to)));
    });

    it('rejects an unsupported days value with 400 on summary too', async () => {
      await get('/api/v1/reports/summary?days=14').expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Low-stock counts stock lines, not products
  // -------------------------------------------------------------------------
  describe('3. low-stock line count', () => {
    it('counts inventory_balances rows (available > 0 and ≤ threshold), not products', async () => {
      const before = await get('/api/v1/reports/summary').expect(200);
      const beforeCount = before.body.inventory.lowStockLines as number;
      expect(before.body.inventory.lowStockThreshold).toBe(20);

      // Two qualifying lines that share ONE product variant — a product/variant
      // count would read 1; a line count reads 2.
      await prisma.inventoryBalance.update({
        where: { id: fixtures.balanceAId }, // (lotA, variantA)
        data: { onHand: 15, reserved: 0, blocked: 0 }, // available 15 → counts
      });
      await prisma.inventoryBalance.update({
        where: { id: fixtures.balanceBId }, // (lotB, variantB)
        data: { onHand: 21, reserved: 0, blocked: 0 }, // available 21 → does NOT count
      });
      await prisma.inventoryBalance.create({
        data: {
          warehouseId: fixtures.warehouseId,
          productLotId: fixtures.lotBId,
          productVariantId: fixtures.variantAId, // same variant as balanceA
          onHand: 20,
          reserved: 0,
          blocked: 0, // available 20 → counts (boundary)
          unit: 'kg',
        },
      });
      await prisma.inventoryBalance.create({
        data: {
          warehouseId: fixtures.warehouseId,
          productLotId: fixtures.lotAId,
          productVariantId: fixtures.variantBId,
          onHand: 0,
          reserved: 0,
          blocked: 0, // available 0 → out of stock, NOT "running out"
          unit: 'kg',
        },
      });

      try {
        const after = await get('/api/v1/reports/summary').expect(200);
        const afterCount = after.body.inventory.lowStockLines as number;
        // +2: balanceA (15) and the new (lotB, variantA) row (20). The 21 line
        // and the 0 line do not count, so the boundary and the "depleted is a
        // different state" rule are both exercised.
        expect(afterCount - beforeCount).toBe(2);
      } finally {
        // Restore the fixture balances so cleanup stays consistent.
        await prisma.inventoryBalance.update({
          where: { id: fixtures.balanceAId },
          data: { onHand: 200, reserved: 0, blocked: 0 },
        });
        await prisma.inventoryBalance.update({
          where: { id: fixtures.balanceBId },
          data: { onHand: 150, reserved: 0, blocked: 0 },
        });
        await prisma.inventoryBalance.deleteMany({
          where: {
            warehouseId: fixtures.warehouseId,
            OR: [
              { productLotId: fixtures.lotBId, productVariantId: fixtures.variantAId },
              { productLotId: fixtures.lotAId, productVariantId: fixtures.variantBId },
            ],
          },
        });
      }
    });
  });
});
