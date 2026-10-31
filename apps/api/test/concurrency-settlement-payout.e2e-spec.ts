import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { PayoutsService, SettlementsService } from '../src/finance/settlements.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import {
  cleanupConcurrencyWorld,
  createConcurrencyPrisma,
  createConcurrencyWorld,
  makeConcurrencyRunId,
  purgeStaleConcurrencyFixtures,
  type ConcurrencyBase,
  type ConcurrencyWorld,
} from './helpers/concurrency-fixtures.js';

/**
 * Settlement / payout money-race acceptance.
 *
 * Every scenario drives the REAL services against the REAL MySQL
 * `TEST_DATABASE_URL` (never the development database) and asserts the
 * invariants in the database — row counts, money totals, final statuses and
 * the settlement/refund reconciliation ledger — not just HTTP statuses.
 *
 * Coverage map (report 25, section 2):
 *  - 2 and 10 concurrent settlement creates for one obligation
 *  - 2 and 10 concurrent payouts (full size), plus 10 partial payouts
 *  - settlement create racing a refund completion
 *  - a refund completing after the settlement (statement must not be rewritten)
 *  - payout racing a recovery record
 *  - client timeout + retry
 *  - duplicate transaction reference on a COD collection
 *  - uncollected / paidAt-less payment is not settled
 *  - partial refund and full refund before settlement
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 3);
const RUN_ID = makeConcurrencyRunId();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasTestDb)('AgriMarket API — settlement & payout concurrency (e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;
  let payments: PaymentsService;
  let settlements: SettlementsService;
  let payouts: PayoutsService;

  const address = {
    recipientName: 'K',
    phone: '0900000000',
    province: 'Hưng Yên',
    detail: 'x',
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createConcurrencyPrisma(TEST_URL as string);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);

    const audit = new AuditService(prisma as never);
    payments = new PaymentsService(prisma as never, audit as never);
    settlements = new SettlementsService(prisma as never, audit as never);
    payouts = new PayoutsService(prisma as never, audit as never);
  });

  afterAll(async () => {
    if (world) {
      await cleanupConcurrencyWorld(world);
      const leftovers = await prisma.user.count({
        where: { email: { startsWith: `${RUN_ID}-` } },
      });
      expect(leftovers).toBe(0);
      await prisma.$disconnect();
    }
  });

  const period = () => ({
    periodStart: new Date(Date.now() - 3_600_000).toISOString(),
    periodEnd: new Date(Date.now() + 3_600_000).toISOString(),
  });

  /**
   * One delivered order + partner order + item, optionally with a payment.
   * `paidAt` defaults to now for a collected status and is forced to null for
   * PENDING — the settlement filter requires BOTH the status and `paidAt`.
   */
  const makeOrder = async (
    b: Pick<ConcurrencyBase, 'partnerId' | 'variantId'>,
    customerId: number,
    tag: string,
    opts: {
      quantity?: number;
      paymentStatus?: 'PENDING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | null;
      paidAt?: Date | null;
    } = {},
  ) => {
    const quantity = opts.quantity ?? 1;
    const amount = 30_000 * quantity;
    const order = await prisma.order.create({
      data: {
        code: world.t(`SO${tag}`),
        customerId,
        shippingAddressSnapshot: address,
        subtotal: amount,
        discountTotal: 0,
        shippingFee: 0,
        grandTotal: amount,
        status: 'DELIVERED',
      },
    });
    const partnerOrder = await prisma.partnerOrder.create({
      data: {
        code: world.t(`SPO${tag}`),
        orderId: order.id,
        partnerId: b.partnerId,
        subtotal: amount,
        discountTotal: 0,
        commissionAmount: 0,
        payableAmount: amount,
        status: 'DELIVERED',
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        partnerOrderId: partnerOrder.id,
        productVariantId: b.variantId,
        productNameSnapshot: 'p',
        skuSnapshot: 's',
        unitPriceSnapshot: 30_000,
        quantity,
        subtotal: amount,
        discountAmount: 0,
      },
    });

    let payment = null;
    if (opts.paymentStatus) {
      const collected = opts.paymentStatus !== 'PENDING';
      payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          method: 'COD',
          amount,
          status: opts.paymentStatus,
          paidAt:
            opts.paidAt !== undefined
              ? opts.paidAt
              : collected
                ? new Date()
                : null,
        },
      });
    }
    return { order, partnerOrder, item, payment };
  };

  /** A CONFIRMED settlement with a chosen payable, for payout-only scenarios. */
  const confirmedSettlement = async (partnerId: number, tag: string, payable = 100_000) =>
    prisma.settlement.create({
      data: {
        code: world.t(`SET${tag}`),
        partnerId,
        periodStart: new Date(Date.now() - 3_600_000),
        periodEnd: new Date(Date.now() + 3_600_000),
        grossAmount: payable,
        refundAmount: 0,
        commissionAmount: 0,
        adjustmentAmount: 0,
        payableAmount: payable,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });

  const committedPayouts = async (settlementId: number) => {
    const sum = await prisma.payout.aggregate({
      where: { settlementId, status: { in: ['PENDING', 'PAID'] } },
      _sum: { amount: true },
    });
    return Number(sum._sum.amount ?? 0);
  };

  // -------------------------------------------------------------------------
  // Settlement creation
  // -------------------------------------------------------------------------

  describe('settlement create', () => {
    it('two concurrent creates never claim the same partner order twice', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `S2${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`s2${r}`);
        const first = await makeOrder(b, cid, `S2${r}A`, { paymentStatus: 'PAID' });
        const second = await makeOrder(b, cid, `S2${r}B`, { paymentStatus: 'PAID' });
        const orderIds = [first.partnerOrder.id, second.partnerOrder.id].sort((a, c) => a - c);

        const res = await Promise.allSettled([
          settlements.create({ partnerId: b.partnerId, ...period() } as never, adminId),
          settlements.create({ partnerId: b.partnerId, ...period() } as never, adminId),
        ]);

        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        for (const rejected of res.filter((x) => x.status === 'rejected')) {
          expect([400, 409]).toContain((rejected as PromiseRejectedResult).reason?.status);
        }

        const lines = await prisma.settlementLine.findMany({
          where: { partnerOrderId: { in: orderIds } },
          select: { partnerOrderId: true, settlementId: true, payableAmount: true },
        });
        expect(lines.length).toBe(2);
        expect(new Set(lines.map((l) => l.partnerOrderId)).size).toBe(2);
        expect(new Set(lines.map((l) => l.settlementId)).size).toBe(1);
        expect(lines.reduce((sum, l) => sum + Number(l.payableAmount), 0)).toBe(60_000);

        const statements = await prisma.settlement.count({ where: { partnerId: b.partnerId } });
        expect(statements).toBe(1);
      }
    });

    it('ten concurrent creates: exactly one statement, every order claimed once', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `S10${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`s10${r}`);
        const first = await makeOrder(b, cid, `S10${r}A`, { paymentStatus: 'PAID' });
        const second = await makeOrder(b, cid, `S10${r}B`, { paymentStatus: 'PAID' });

        const res = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            settlements.create({ partnerId: b.partnerId, ...period() } as never, adminId),
          ),
        );

        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        for (const rejected of res.filter((x) => x.status === 'rejected')) {
          expect([400, 409]).toContain((rejected as PromiseRejectedResult).reason?.status);
        }

        const statements = await prisma.settlement.findMany({
          where: { partnerId: b.partnerId },
          include: { lines: true },
        });
        expect(statements.length).toBe(1);
        expect(statements[0].lines.length).toBe(2);
        expect(statements[0].lines.map((l) => l.partnerOrderId).sort((a, c) => a - c)).toEqual(
          [first.partnerOrder.id, second.partnerOrder.id].sort((a, c) => a - c),
        );
        expect(Number(statements[0].grossAmount)).toBe(60_000);
        expect(Number(statements[0].refundAmount)).toBe(0);
        expect(Number(statements[0].payableAmount)).toBe(60_000);
      }
    });

    it('rejects a settlement with no delivered, collected order', async () => {
      const b = await world.base(1, 'SE');
      const [cid] = await world.customers(1);
      const adminId = await world.admin('se');
      const { partnerOrder } = await makeOrder(b, cid, 'SE', { paymentStatus: 'PENDING' });

      await expect(
        settlements.create({ partnerId: b.partnerId, ...period() } as never, adminId),
      ).rejects.toThrow(/No delivered, paid partner orders/);

      expect(await prisma.settlement.count({ where: { partnerId: b.partnerId } })).toBe(0);
      expect(
        await prisma.settlementLine.count({ where: { partnerOrderId: partnerOrder.id } }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Payout creation
  // -------------------------------------------------------------------------

  describe('payout create', () => {
    it('two concurrent full-size payouts: one row, never above payable', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `P2${r}`);
        const adminId = await world.admin(`p2${r}`);
        const settlement = await confirmedSettlement(b.partnerId, `P2${r}`);

        const res = await Promise.allSettled([
          payouts.create({ settlementId: settlement.id, amount: 100_000 } as never, adminId),
          payouts.create({ settlementId: settlement.id, amount: 100_000 } as never, adminId),
        ]);

        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        expect(await committedPayouts(settlement.id)).toBe(100_000);
        expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
      }
    });

    it('ten concurrent full-size payouts: one row, the rest refused, sum = payable', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `P10${r}`);
        const adminId = await world.admin(`p10${r}`);
        const settlement = await confirmedSettlement(b.partnerId, `P10${r}`);

        const res = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            payouts.create({ settlementId: settlement.id, amount: 100_000 } as never, adminId),
          ),
        );

        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        for (const rejected of res.filter((x) => x.status === 'rejected')) {
          expect((rejected as PromiseRejectedResult).reason?.message).toMatch(
            /exceed settlement payable|greater than zero/,
          );
        }

        expect(await committedPayouts(settlement.id)).toBe(100_000);
        expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
      }
    });

    it('ten concurrent partial payouts all land and sum exactly to payable', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PP${r}`);
        const adminId = await world.admin(`pp${r}`);
        const settlement = await confirmedSettlement(b.partnerId, `PP${r}`);

        const res = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            payouts.create({ settlementId: settlement.id, amount: 10_000 } as never, adminId),
          ),
        );

        // Ten legal 10k payouts fill a 100k payable exactly: every one must land
        // (a lost update would silently drop money the partner is owed).
        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(10);
        expect(await committedPayouts(settlement.id)).toBe(100_000);
        const rows = await prisma.payout.findMany({
          where: { settlementId: settlement.id },
          select: { code: true, amount: true },
        });
        expect(rows.length).toBe(10);
        expect(new Set(rows.map((x) => x.code)).size).toBe(10);
        expect(rows.every((x) => Number(x.amount) === 10_000)).toBe(true);
      }
    });

    it('a payout is refused when the settlement is still DRAFT', async () => {
      const b = await world.base(1, 'PD');
      const adminId = await world.admin('pd');
      const settlement = await prisma.settlement.create({
        data: {
          code: world.t('SETPD'),
          partnerId: b.partnerId,
          periodStart: new Date(Date.now() - 3_600_000),
          periodEnd: new Date(Date.now() + 3_600_000),
          grossAmount: 100_000,
          refundAmount: 0,
          commissionAmount: 0,
          adjustmentAmount: 0,
          payableAmount: 100_000,
          status: 'DRAFT',
        },
      });

      await expect(
        payouts.create({ settlementId: settlement.id, amount: 100_000 } as never, adminId),
      ).rejects.toThrow(/CONFIRMED/);
      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Settlement vs refund
  // -------------------------------------------------------------------------

  describe('settlement vs refund', () => {
    it('a refund completing while the settlement is created is counted exactly once', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `SR${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`sr${r}`);
        const { partnerOrder, payment } = await makeOrder(b, cid, `SR${r}`, {
          paymentStatus: 'PAID',
        });
        const refund = await payments.refund(
          { paymentId: payment!.id, amount: 10_000, reason: 'hàng lỗi' } as never,
          adminId,
        );
        await payments.approveRefund(refund.id, adminId);

        const [settleRes, refundRes] = await Promise.allSettled([
          settlements.create({ partnerId: b.partnerId, ...period() } as never, adminId),
          payments.completeRefund(
            refund.id,
            { reference: `RF-SR-${r}` } as never,
            adminId,
          ),
        ]);

        expect(settleRes.status).toBe('fulfilled');
        expect(refundRes.status).toBe('fulfilled');

        const line = await prisma.settlementLine.findUniqueOrThrow({
          where: { partnerOrderId: partnerOrder.id },
        });
        const adjustments = await prisma.settlementAdjustment.aggregate({
          where: { partnerOrderId: partnerOrder.id },
          _sum: { amount: true },
        });
        const deducted = Number(line.refundAmount);
        const reconciled = Number(adjustments._sum.amount ?? 0);

        // The 10,000 refund is either already deducted from the line (refund
        // committed first) or recorded as a reconciliation adjustment
        // (settlement committed first). It can never be in neither place.
        expect(deducted + reconciled).toBe(10_000);
        expect(Number(line.payableAmount)).toBe(30_000 - deducted);
        expect(deducted === 0 || deducted === 10_000).toBe(true);
        if (deducted === 10_000) expect(reconciled).toBe(0);

        const header = await prisma.settlement.findUniqueOrThrow({
          where: { id: line.settlementId },
        });
        expect(Number(header.refundAmount)).toBe(deducted);
        expect(Number(header.payableAmount)).toBe(30_000 - deducted);
      }
    });

    it('a refund completing after the settlement never rewrites it, only opens an adjustment', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `SL${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`sl${r}`);
        const { partnerOrder, payment } = await makeOrder(b, cid, `SL${r}`, {
          paymentStatus: 'PAID',
        });

        const settlement = await settlements.create(
          { partnerId: b.partnerId, ...period() } as never,
          adminId,
        );
        const before = await prisma.settlement.findUniqueOrThrow({
          where: { id: settlement.id },
        });

        const refund = await payments.refund(
          { paymentId: payment!.id, amount: 12_000, reason: 'thiếu cân' } as never,
          adminId,
        );
        await payments.approveRefund(refund.id, adminId);
        await payments.completeRefund(
          refund.id,
          { reference: `RF-SL-${r}` } as never,
          adminId,
        );

        const after = await prisma.settlement.findUniqueOrThrow({
          where: { id: settlement.id },
        });
        expect(Number(after.grossAmount)).toBe(Number(before.grossAmount));
        expect(Number(after.refundAmount)).toBe(Number(before.refundAmount));
        expect(Number(after.payableAmount)).toBe(Number(before.payableAmount));
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

        const adjustments = await prisma.settlementAdjustment.findMany({
          where: { partnerOrderId: partnerOrder.id, refundId: refund.id },
        });
        expect(adjustments.length).toBe(1);
        expect(adjustments[0].status).toBe('OPEN');
        expect(Number(adjustments[0].amount)).toBe(12_000);
      }
    });

    it('a partial refund before settlement is deducted from the line', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `SP${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`sp${r}`);
        const { partnerOrder, payment } = await makeOrder(b, cid, `SP${r}`, {
          paymentStatus: 'PAID',
        });

        const refund = await payments.refund(
          { paymentId: payment!.id, amount: 10_000, reason: 'partial' } as never,
          adminId,
        );
        await payments.approveRefund(refund.id, adminId);
        await payments.completeRefund(
          refund.id,
          { reference: `RF-SP-${r}` } as never,
          adminId,
        );

        const settlement = await settlements.create(
          { partnerId: b.partnerId, ...period() } as never,
          adminId,
        );
        const line = await prisma.settlementLine.findUniqueOrThrow({
          where: { partnerOrderId: partnerOrder.id },
        });
        expect(Number(line.refundAmount)).toBe(10_000);
        expect(Number(line.payableAmount)).toBe(20_000);
        expect(Number(settlement.refundAmount)).toBe(10_000);
        expect(Number(settlement.payableAmount)).toBe(20_000);
        expect(
          await prisma.settlementAdjustment.count({
            where: { partnerOrderId: partnerOrder.id },
          }),
        ).toBe(0);
      }
    });

    it('a full refund before settlement settles at zero payable', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `SF${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`sf${r}`);
        const { partnerOrder, payment } = await makeOrder(b, cid, `SF${r}`, {
          paymentStatus: 'PAID',
        });

        const refund = await payments.refund(
          { paymentId: payment!.id, amount: 30_000, reason: 'full' } as never,
          adminId,
        );
        await payments.approveRefund(refund.id, adminId);
        await payments.completeRefund(
          refund.id,
          { reference: `RF-SF-${r}` } as never,
          adminId,
        );
        const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment!.id } });
        expect(paid.status).toBe('REFUNDED');

        const settlement = await settlements.create(
          { partnerId: b.partnerId, ...period() } as never,
          adminId,
        );
        const line = await prisma.settlementLine.findUniqueOrThrow({
          where: { partnerOrderId: partnerOrder.id },
        });
        expect(Number(line.grossAmount)).toBe(30_000);
        expect(Number(line.refundAmount)).toBe(30_000);
        expect(Number(line.payableAmount)).toBe(0);
        expect(Number(settlement.payableAmount)).toBe(0);
      }
    });

    it('a PAID status without paidAt is not treated as collected money', async () => {
      const b = await world.base(1, 'SN');
      const [cid] = await world.customers(1);
      const adminId = await world.admin('sn');
      await makeOrder(b, cid, 'SN', { paymentStatus: 'PAID', paidAt: null });

      await expect(
        settlements.create({ partnerId: b.partnerId, ...period() } as never, adminId),
      ).rejects.toThrow(/No delivered, paid partner orders/);
      expect(await prisma.settlement.count({ where: { partnerId: b.partnerId } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Payout vs recovery, timeout and duplicate reference
  // -------------------------------------------------------------------------

  describe('payout guards', () => {
    it('a payout racing a recovery record never pays while the recovery is unresolved', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PR${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`pr${r}`);
        const { partnerOrder, payment } = await makeOrder(b, cid, `PR${r}`, {
          paymentStatus: 'PAID',
        });

        const settlement = await settlements.create(
          { partnerId: b.partnerId, ...period() } as never,
          adminId,
        );
        await settlements.confirm(settlement.id, adminId);

        // A late refund creates an OPEN adjustment; DEDUCT_NEXT turns it into
        // a recovery that must be recorded before the partner is paid.
        const refund = await payments.refund(
          { paymentId: payment!.id, amount: 10_000, reason: 'late' } as never,
          adminId,
        );
        await payments.approveRefund(refund.id, adminId);
        await payments.completeRefund(
          refund.id,
          { reference: `RF-PR-${r}` } as never,
          adminId,
        );
        const adjustment = await prisma.settlementAdjustment.findFirstOrThrow({
          where: { partnerOrderId: partnerOrder.id, refundId: refund.id },
        });
        await settlements.reviewAdjustment(
          adjustment.id,
          { resolution: 'DEDUCT_NEXT', note: 'trừ kỳ sau' } as never,
          adminId,
        );
        const recovery = await prisma.settlementRecovery.findFirstOrThrow({
          where: { adjustmentId: adjustment.id },
        });
        await settlements.approveRecovery(
          recovery.id,
          { note: 'đồng ý' } as never,
          adminId,
        );

        const [payoutRes, recoveryRes] = await Promise.allSettled([
          payouts.create({ settlementId: settlement.id, amount: 30_000 } as never, adminId),
          settlements.recordRecovery(
            recovery.id,
            { reference: `RC-PR-${r}` } as never,
            adminId,
          ),
        ]);

        const finalRecovery = await prisma.settlementRecovery.findUniqueOrThrow({
          where: { id: recovery.id },
        });
        expect(recoveryRes.status).toBe('fulfilled');
        expect(finalRecovery.status).toBe('RECORDED');

        const paid = await committedPayouts(settlement.id);
        expect(paid).toBeLessThanOrEqual(30_000);
        if (payoutRes.status === 'fulfilled') {
          // Money may only move once the recovery was recorded; the partner
          // lock serialises the two operations.
          expect(paid).toBe(30_000);
        } else {
          expect(paid).toBe(0);
          expect((payoutRes as PromiseRejectedResult).reason?.message).toMatch(
            /unresolved recovery/,
          );
        }
        // The historical statement is untouched by the late refund.
        const header = await prisma.settlement.findUniqueOrThrow({
          where: { id: settlement.id },
        });
        expect(Number(header.payableAmount)).toBe(30_000);
      }
    });

    it('a client timeout and retry produce exactly one payout', async () => {
      const b = await world.base(1, 'PT');
      const adminId = await world.admin('pt');
      const settlement = await confirmedSettlement(b.partnerId, 'PT');
      const holder = createConcurrencyPrisma(TEST_URL as string);

      // Record the outcome instead of leaving a bare promise: the requests are
      // created while the lock is held and only settle after it is released, so
      // an unhandled rejection must be impossible even if that changes.
      const outcome = (p: Promise<unknown>) =>
        p.then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        );
      let first: Promise<'fulfilled' | 'rejected'> | undefined;
      let retry: Promise<'fulfilled' | 'rejected'> | undefined;
      try {
        await holder.$transaction(async (tx) => {
          // Hold the settlement row so both requests queue on the same lock,
          // exactly like a slow payout that outlives the client timeout.
          await tx.$queryRaw`SELECT id FROM settlements WHERE id = ${settlement.id} FOR UPDATE`;
          first = outcome(
            payouts.create(
              { settlementId: settlement.id, amount: 100_000 } as never,
              adminId,
            ),
          );
          await sleep(80);
          // The client gave up after its timeout and retried while the first
          // request is still in flight.
          retry = outcome(
            payouts.create(
              { settlementId: settlement.id, amount: 100_000 } as never,
              adminId,
            ),
          );
          await sleep(80);
        });

        const res = await Promise.all([first!, retry!]);
        expect(res.filter((x) => x === 'fulfilled').length).toBe(1);
        expect(await committedPayouts(settlement.id)).toBe(100_000);
        expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
      } finally {
        await holder.$disconnect();
      }
    });

    it('ten concurrent COD confirmations with the same reference book the money once', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PTR${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`ptr${r}`);
        const { order, partnerOrder, payment } = await makeOrder(b, cid, `PTR${r}`, {
          paymentStatus: 'PENDING',
        });

        const reference = `COURIER-${RUN_ID}-${r}`;
        const res = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            payments.updateStatus(
              payment!.id,
              { status: 'PAID', transactionReference: reference } as never,
              adminId,
            ),
          ),
        );

        // At most one request may claim the collection; late readers see PAID
        // and return the row untouched (idempotent no-op), never a second audit
        // row or a second money movement.
        expect(res.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
        const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment!.id } });
        expect(paid.status).toBe('PAID');
        expect(paid.paidAt).not.toBeNull();
        expect(paid.transactionReference).toBe(reference);

        const auditRows = await prisma.auditLog.count({
          where: {
            entityType: 'Payment',
            entityId: String(payment!.id),
            action: 'PAYMENT_PAID',
          },
        });
        expect(auditRows).toBe(1);

        // The collected order is settled exactly once, for its real total.
        const settlement = await settlements.create(
          { partnerId: b.partnerId, ...period() } as never,
          adminId,
        );
        const lines = await prisma.settlementLine.findMany({
          where: { partnerOrderId: partnerOrder.id },
        });
        expect(lines.length).toBe(1);
        expect(lines[0].settlementId).toBe(settlement.id);
        expect(Number(lines[0].grossAmount)).toBe(30_000);
        expect(Number(settlement.grossAmount)).toBe(30_000);
        expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
      }
    });
  });
});
