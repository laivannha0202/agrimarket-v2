import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { CommissionService } from '../src/finance/commission.service.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { PayoutsService, SettlementsService } from '../src/finance/settlements.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { ReturnsService } from '../src/returns/returns.service.js';
import {
  cleanupConcurrencyWorld,
  createConcurrencyPrisma,
  createConcurrencyWorld,
  makeConcurrencyRunId,
  purgeStaleConcurrencyFixtures,
  type ConcurrencyWorld,
} from './helpers/concurrency-fixtures.js';

/**
 * Money & stock race acceptance suite (audit round 1).
 *
 * These scenarios drive the REAL services against the REAL MySQL
 * `TEST_DATABASE_URL` and assert the invariants directly in the database, the
 * same way `concurrency.e2e-spec.ts` does. They exist because reports 03/05
 * found four read-then-write paths in after-sales/finance/inventory that the
 * older suite did not cover:
 *
 *  - BL-01: two concurrent refunds can exceed the paid amount (P1, fixed here)
 *  - BL-02: two concurrent return requests can over-claim the delivered
 *    quantity (P1, fixed here)
 *  - SETTLEMENT-CREATE: two concurrent settlements for one partner/period can
 *    each claim the same partner order (candidate, fixed here with a DB unique
 *    index — policy: one partner order belongs to at most one settlement)
 *  - BL-06: two concurrent payouts can exceed the settlement payable (P2,
 *    fixed in round 2 — the payout create now serialises on a
 *    `FOR UPDATE` claim of the settlement row before re-reading the payout
 *    total; audited sum can never exceed payable)
 *  - BL-07: two concurrent admin `adjust` calls used to lose one increment
 *    (P2, fixed in round 2 — `adjust` writes through a guarded
 *    read-modify-write UPDATE, reconciling the balance arithmetic in SQL
 *    rather than from a stale snapshot read)
 *
 * The suite is skipped entirely without `TEST_DATABASE_URL` and every row it
 * creates is tagged with the `cc…` run prefix and removed in `afterAll`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 5);
const RUN_ID = makeConcurrencyRunId();

/** Unwrap the fulfilled result of a race, failing the test on a rejection. */
function fulfilledValue<T>(result: PromiseSettledResult<T> | undefined): T {
  if (!result || result.status !== 'fulfilled') {
    throw result?.status === 'rejected' ? result.reason : new Error('No fulfilled result');
  }
  return result.value;
}

describe.skipIf(!hasTestDb)('AgriMarket API — money & stock race acceptance (e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;
  let payments: PaymentsService;
  let returns: ReturnsService;
  let settlements: SettlementsService;
  let payouts: PayoutsService;
  let inventory: InventoryService;
  let orders: OrdersService;

  const address = { recipientName: 'K', phone: '0900000000', province: 'Hưng Yên', detail: 'x' };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createConcurrencyPrisma(TEST_URL as string);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);

    // The REAL AuditService so the audit rows can be asserted in the database;
    // the other services under test are the production classes.
    const audit = new AuditService(prisma as never);
    const evidence = new EvidenceService(prisma as never, undefined as never);
    payments = new PaymentsService(prisma as never, audit as never);
    returns = new ReturnsService(prisma as never, audit as never, evidence as never);
    settlements = new SettlementsService(prisma as never, audit as never);
    payouts = new PayoutsService(prisma as never, audit as never);
    inventory = new InventoryService(prisma as never, audit as never);
    orders = new OrdersService(
      prisma as never,
      inventory,
      new PromotionsService(prisma as never),
      new CommissionService(prisma as never),
      audit as never,
      new LocationsService(prisma as never),
    );
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

  /**
   * Minimal order that satisfies the FKs a refund/return touches. Returns the
   * order, its partner order, one order item, and the row ids needed by the
   * assertions. `status` is DELIVERED because returns reject anything else.
   */
  const deliveredOrder = async (
    b: { partnerId: number; variantId: number },
    customerId: number,
    tag: string,
    quantity: number,
  ) => {
    const order = await prisma.order.create({
      data: {
        code: world.t(`MO${tag}`),
        customerId,
        shippingAddressSnapshot: address,
        subtotal: 30000 * quantity,
        discountTotal: 0,
        shippingFee: 0,
        grandTotal: 30000 * quantity,
        status: 'DELIVERED',
      },
    });
    const po = await prisma.partnerOrder.create({
      data: {
        code: world.t(`MPO${tag}`),
        orderId: order.id,
        partnerId: b.partnerId,
        subtotal: 30000 * quantity,
        discountTotal: 0,
        commissionAmount: 0,
        payableAmount: 30000 * quantity,
        status: 'DELIVERED',
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        partnerOrderId: po.id,
        productVariantId: b.variantId,
        productNameSnapshot: 'p',
        skuSnapshot: 's',
        unitPriceSnapshot: 30000,
        quantity,
        subtotal: 30000 * quantity,
        discountAmount: 0,
      },
    });
    return { order, po, item };
  };

  /**
   * Refunds are now a two-step money movement: the create only records the
   * decision (PENDING), and only approve -> complete moves the payment and the
   * settlement. Tests that assert a refunded balance must walk both steps.
   */
  const completeRefund = async (
    refundId: number,
    adminId: number,
    reference = `RF-${refundId}`,
  ) => {
    await payments.approveRefund(refundId, adminId);
    return payments.completeRefund(refundId, { reference } as never, adminId);
  };

  // -------------------------------------------------------------------------
  // BL-01 — refund serialisation on the parent payment
  // -------------------------------------------------------------------------

  describe('BL-01 refund', () => {
    it('two concurrent refunds of 70% on one payment: exactly one succeeds, sum ≤ paid', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `RF${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`rf${r}`);
        const { order } = await deliveredOrder(b, cid, `RF${r}`, 1);
        const payment = await prisma.payment.create({
          data: { orderId: order.id, method: 'COD', amount: 100000, status: 'PAID', paidAt: new Date() },
        });

        const res = await Promise.allSettled([
          payments.refund({ paymentId: payment.id, amount: 70000, reason: 'r1' }, adminId),
          payments.refund({ paymentId: payment.id, amount: 70000, reason: 'r2' }, adminId),
        ]);

        const ok = res.filter((x) => x.status === 'fulfilled').length;
        const rejected = res.filter(
          (x): x is PromiseRejectedResult => x.status === 'rejected',
        );
        expect(ok).toBe(1);
        expect(rejected[0]?.reason?.message).toMatch(/would exceed paid amount/);

        const winner = fulfilledValue(res.find((x) => x.status === 'fulfilled'));
        await completeRefund(winner.id, adminId);

        const sum = await prisma.refund.aggregate({
          where: { paymentId: payment.id, status: 'COMPLETED' },
          _sum: { amount: true },
        });
        expect(Number(sum._sum.amount ?? 0)).toBe(70000);

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('PARTIALLY_REFUNDED');

        // The audit trail must describe exactly the refund that committed.
        expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
        const completionAudits = await prisma.auditLog.count({
          where: {
            entityType: 'Refund',
            entityId: String(winner.id),
            action: 'REFUND_COMPLETE',
          },
        });
        expect(completionAudits).toBe(1);
      }
    });

    it('complete and fail racing on one APPROVED refund: exactly one wins and the payment matches it', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `RC${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`rc${r}`);
        const { order } = await deliveredOrder(b, cid, `RC${r}`, 1);
        const payment = await prisma.payment.create({
          data: { orderId: order.id, method: 'COD', amount: 100000, status: 'PAID', paidAt: new Date() },
        });
        const refund = await payments.refund(
          { paymentId: payment.id, amount: 40000, reason: 'race' },
          adminId,
        );
        await payments.approveRefund(refund.id, adminId);

        const res = await Promise.allSettled([
          payments.completeRefund(
            refund.id,
            { reference: `RC-${refund.id}` } as never,
            adminId,
          ),
          payments.failRefund(
            refund.id,
            { failureReason: 'Ngân hàng từ chối' } as never,
            adminId,
          ),
        ]);
        expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);

        const finalRefund = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
        const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (finalRefund.status === 'COMPLETED') {
          expect(finalRefund.reference).toBe(`RC-${refund.id}`);
          expect(finalPayment.status).toBe('PARTIALLY_REFUNDED');
        } else {
          expect(finalRefund.status).toBe('FAILED');
          expect(finalPayment.status).toBe('PAID');
        }
        // Either outcome is a decision, never a settlement liability.
        expect(
          await prisma.settlementAdjustment.count({ where: { refundId: refund.id } }),
        ).toBe(0);
      }
    });

    it('a retried/staggered 70% refund cannot over-refund either (the second request used to read a stale total)', async () => {
      // The pure-simultaneous variant above is partly masked by an InnoDB
      // deadlock: when both transactions hold the FK shared lock on the
      // payment, only one survives. The realistic variant is a second operator
      // clicking (or a retry arriving) a few milliseconds later: the second
      // request's aggregate then runs before the first commits while its
      // insert runs after — pre-fix this committed BOTH refunds (measured
      // 8/20 rounds at 4–7 ms stagger, sum 140000). Post-fix the loser must be
      // refused by the business rule.
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `RG${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`rg${r}`);
        const { order } = await deliveredOrder(b, cid, `RG${r}`, 1);
        const payment = await prisma.payment.create({
          data: { orderId: order.id, method: 'COD', amount: 100000, status: 'PAID', paidAt: new Date() },
        });

        const delay = 4 + (r % 4);
        const res = await Promise.allSettled([
          payments.refund({ paymentId: payment.id, amount: 70000, reason: 'a' }, adminId),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return payments.refund({ paymentId: payment.id, amount: 70000, reason: 'b' }, adminId);
          })(),
        ]);

        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        const winner = fulfilledValue(res.find((x) => x.status === 'fulfilled'));
        await completeRefund(winner.id, adminId);
        const sum = await prisma.refund.aggregate({
          where: { paymentId: payment.id, status: 'COMPLETED' },
          _sum: { amount: true },
        });
        expect(Number(sum._sum.amount ?? 0)).toBeLessThanOrEqual(100000);
        expect(Number(sum._sum.amount ?? 0)).toBe(70000);
        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('PARTIALLY_REFUNDED');
      }
    });

    it('two concurrent refunds racing for the remainder: exactly one wins, sum = paid', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `RR${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`rr${r}`);
        const { order } = await deliveredOrder(b, cid, `RR${r}`, 1);
        const payment = await prisma.payment.create({
          data: { orderId: order.id, method: 'COD', amount: 100000, status: 'PAID', paidAt: new Date() },
        });

        // 60k goes through first (sequential), leaving 40k.
        const firstRefund = await payments.refund(
          { paymentId: payment.id, amount: 60000, reason: 'first' },
          adminId,
        );
        await completeRefund(firstRefund.id, adminId);

        const res = await Promise.allSettled([
          payments.refund({ paymentId: payment.id, amount: 40000, reason: 'r1' }, adminId),
          payments.refund({ paymentId: payment.id, amount: 40000, reason: 'r2' }, adminId),
        ]);
        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        const winner = fulfilledValue(res.find((x) => x.status === 'fulfilled'));
        await completeRefund(winner.id, adminId);

        const sum = await prisma.refund.aggregate({
          where: { paymentId: payment.id, status: 'COMPLETED' },
          _sum: { amount: true },
        });
        expect(Number(sum._sum.amount ?? 0)).toBe(100000);
        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('REFUNDED');
      }
    });

    it('sequential 50% + 50% refunds are both valid and end fully REFUNDED', async () => {
      const b = await world.base(1, 'RS');
      const [cid] = await world.customers(1);
      const adminId = await world.admin('rs');
      const { order } = await deliveredOrder(b, cid, 'RS', 1);
      const payment = await prisma.payment.create({
        data: { orderId: order.id, method: 'COD', amount: 100000, status: 'PAID', paidAt: new Date() },
      });

      const firstHalf = await payments.refund(
        { paymentId: payment.id, amount: 50000, reason: 'half 1' },
        adminId,
      );
      await completeRefund(firstHalf.id, adminId);
      let current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(current.status).toBe('PARTIALLY_REFUNDED');

      const secondHalf = await payments.refund(
        { paymentId: payment.id, amount: 50000, reason: 'half 2' },
        adminId,
      );
      await completeRefund(secondHalf.id, adminId);
      current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(current.status).toBe('REFUNDED');

      // Nothing is left to refund on a fully refunded payment.
      await expect(
        payments.refund({ paymentId: payment.id, amount: 1, reason: 'again' }, adminId),
      ).rejects.toThrow(/Only PAID or PARTIALLY_REFUNDED/);
      const sum = await prisma.refund.aggregate({
        where: { paymentId: payment.id, status: 'COMPLETED' },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(100000);
    });
  });

  // -------------------------------------------------------------------------
  // BL-02 — return claims serialised on the order item
  // -------------------------------------------------------------------------

  describe('BL-02 return requests', () => {
    it('two concurrent full-quantity return requests: exactly one is accepted', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `RT${r}`);
        const [cid] = await world.customers(1);
        const { item } = await deliveredOrder(b, cid, `RT${r}`, 5);

        const res = await Promise.allSettled([
          returns.create(cid, { orderItemId: item.id, quantity: 5, reason: 'r1' } as never),
          returns.create(cid, { orderItemId: item.id, quantity: 5, reason: 'r2' } as never),
        ]);

        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        const rejected = res.filter(
          (x): x is PromiseRejectedResult => x.status === 'rejected',
        );
        expect(rejected[0]?.reason?.message).toMatch(/already been fully claimed|at most/);

        // The claim ledger must never exceed the delivered quantity.
        const claims = await prisma.returnRequest.findMany({
          where: { orderItemId: item.id },
          select: { quantity: true, status: true },
        });
        const total = claims.reduce((s, c) => s + Number(c.quantity), 0);
        expect(total).toBeLessThanOrEqual(5);
        expect(total).toBe(5);
      }
    });

    it('sequential partial claims cannot exceed the delivered quantity', async () => {
      const b = await world.base(1, 'RP');
      const [cid] = await world.customers(1);
      const { item } = await deliveredOrder(b, cid, 'RP', 5);

      await returns.create(cid, { orderItemId: item.id, quantity: 3, reason: 'first' } as never);
      await expect(
        returns.create(cid, { orderItemId: item.id, quantity: 3, reason: 'too much' } as never),
      ).rejects.toThrow(/at most 2/);
      await returns.create(cid, { orderItemId: item.id, quantity: 2, reason: 'rest' } as never);

      const claims = await prisma.returnRequest.findMany({ where: { orderItemId: item.id } });
      expect(claims.reduce((s, c) => s + Number(c.quantity), 0)).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // SETTLEMENT-CREATE — one partner order, at most one settlement line
  // -------------------------------------------------------------------------

  describe('settlement create', () => {
    it('two concurrent settlement creates for one partner/period never claim an order twice', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `ST${r}`);
        const [cid] = await world.customers(1);
        const adminId = await world.admin(`st${r}`);
        const first = await deliveredOrder(b, cid, `ST${r}A`, 1);
        const second = await deliveredOrder(b, cid, `ST${r}B`, 1);
        const orderIds = [first.po.id, second.po.id].sort((a, b2) => a - b2);

        // Settlement only claims orders with an actual payment (paidAt set).
        for (const row of [first, second]) {
          await prisma.payment.create({
            data: {
              orderId: row.order.id,
              method: 'COD',
              amount: 30000,
              status: 'PAID',
              paidAt: new Date(),
            },
          });
        }

        const periodStart = new Date(Date.now() - 3600_000).toISOString();
        const periodEnd = new Date(Date.now() + 3600_000).toISOString();
        const res = await Promise.allSettled([
          settlements.create(
            { partnerId: b.partnerId, periodStart, periodEnd } as never,
            adminId,
          ),
          settlements.create(
            { partnerId: b.partnerId, periodStart, periodEnd } as never,
            adminId,
          ),
        ]);

        // At least one create must succeed. The loser is either a 409 (both
        // read the same unclaimed set and the unique guard fired) or a 400
        // ("no eligible orders" — it started after the winner committed and
        // the orders were already claimed). Neither may silently double-claim.
        expect(res.some((x) => x.status === 'fulfilled')).toBe(true);
        for (const rejected of res.filter((x) => x.status === 'rejected')) {
          expect([400, 409]).toContain((rejected as PromiseRejectedResult).reason?.status);
        }

        const lines = await prisma.settlementLine.findMany({
          where: { partnerOrderId: { in: orderIds } },
          select: { partnerOrderId: true, settlementId: true },
        });
        // Every order is claimed exactly once, by exactly one settlement.
        expect(lines.length).toBe(2);
        expect(new Set(lines.map((l) => l.partnerOrderId)).size).toBe(2);
        const claimCount = new Map<number, number>();
        for (const line of lines) {
          claimCount.set(line.partnerOrderId, (claimCount.get(line.partnerOrderId) ?? 0) + 1);
        }
        expect([...claimCount.values()]).toEqual([1, 1]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // OPEN reconciliation — a late refund-after-settlement adjustment must stop
  // confirmation, payout creation and marking an already-requested payout paid
  // until a human records the recovery decision.
  // -------------------------------------------------------------------------

  describe('OPEN reconciliation guards', () => {
    it('blocks confirm, payout create and mark-paid until the adjustment is reviewed', async () => {
      const b = await world.base(1, 'OR');
      const adminId = await world.admin('or');
      const settlement = await prisma.settlement.create({
        data: {
          code: world.t('SETOR'),
          partnerId: b.partnerId,
          periodStart: new Date(Date.now() - 3600_000),
          periodEnd: new Date(Date.now() + 3600_000),
          grossAmount: 100000,
          refundAmount: 0,
          commissionAmount: 0,
          adjustmentAmount: 0,
          payableAmount: 100000,
          status: 'DRAFT',
        },
      });

      // 1. A DRAFT settlement with an OPEN adjustment cannot be confirmed.
      const confirmBlocker = await prisma.settlementAdjustment.create({
        data: {
          partnerId: b.partnerId,
          settlementId: settlement.id,
          amount: 30000,
          type: 'REFUND_AFTER_SETTLEMENT',
          status: 'OPEN',
          reason: 'Hoàn tiền sau khi lập bảng kê',
        },
      });
      await expect(settlements.confirm(settlement.id, adminId)).rejects.toThrow(
        /OPEN reconciliation adjustment/,
      );
      expect(
        (await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } })).status,
      ).toBe('DRAFT');

      // 2. After the human decision the settlement still cannot confirm while
      // the DEDUCT_NEXT recovery waits for its second approval, and only an
      // explicit approve + record releases it.
      await settlements.reviewAdjustment(
        confirmBlocker.id,
        { resolution: 'DEDUCT_NEXT', note: 'Trừ vào kỳ sau' },
        adminId,
      );
      const recovery = await prisma.settlementRecovery.findUniqueOrThrow({
        where: { adjustmentId: confirmBlocker.id },
      });
      expect(recovery.status).toBe('PENDING_APPROVAL');
      await expect(settlements.confirm(settlement.id, adminId)).rejects.toThrow(
        /unresolved recovery/,
      );
      await settlements.approveRecovery(
        recovery.id,
        { note: 'Kế toán trưởng phê duyệt' },
        adminId,
      );
      await expect(settlements.confirm(settlement.id, adminId)).rejects.toThrow(
        /unresolved recovery/,
      );
      await settlements.recordRecovery(
        recovery.id,
        { reference: world.t('RECOVERY') },
        adminId,
      );
      const confirmed = await settlements.confirm(settlement.id, adminId);
      expect(confirmed.status).toBe('CONFIRMED');

      const payout = await payouts.create(
        { settlementId: settlement.id, amount: 40000 } as never,
        adminId,
      );
      expect(payout.status).toBe('PENDING');

      // 3. A late refund arrives after the payout was requested: creating a
      // second payout and paying the first must both be refused.
      const payoutBlocker = await prisma.settlementAdjustment.create({
        data: {
          partnerId: b.partnerId,
          settlementId: settlement.id,
          amount: 20000,
          type: 'REFUND_AFTER_SETTLEMENT',
          status: 'OPEN',
          reason: 'Hoàn tiền muộn sau khi đã tạo lệnh chi',
        },
      });
      await expect(
        payouts.create({ settlementId: settlement.id, amount: 10000 } as never, adminId),
      ).rejects.toThrow(/OPEN reconciliation adjustment/);
      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);

      await expect(payouts.markPaid(payout.id, adminId)).rejects.toThrow(
        /OPEN reconciliation adjustment/,
      );
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
        'PENDING',
      );
      expect(
        (await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } })).status,
      ).toBe('CONFIRMED');

      // 4. Reviewing the second adjustment releases the hold.
      await settlements.reviewAdjustment(
        payoutBlocker.id,
        { resolution: 'MANUAL', note: 'Kế toán thu hồi thủ công' },
        adminId,
      );
      const paid = await payouts.markPaid(payout.id, adminId);
      expect(paid.status).toBe('PAID');
    });

    it('approve vs reject racing on one recovery: exactly one decision wins', async () => {
      const b = await world.base(1, 'RR');
      const adminId = await world.admin('rr');
      const adjustment = await prisma.settlementAdjustment.create({
        data: {
          partnerId: b.partnerId,
          amount: 15000,
          type: 'REFUND_AFTER_SETTLEMENT',
          status: 'REVIEWED',
          resolution: 'DEDUCT_NEXT',
          reason: 'Hoàn tiền chờ quyết định thu hồi',
          reviewedAt: new Date(),
        },
      });
      const recovery = await prisma.settlementRecovery.create({
        data: {
          partnerId: b.partnerId,
          adjustmentId: adjustment.id,
          amount: 15000,
          status: 'PENDING_APPROVAL',
          reason: adjustment.reason,
          requestedByUserId: adminId,
        },
      });

      const results = await Promise.allSettled([
        settlements.approveRecovery(recovery.id, { note: 'Duyệt thu hồi' }, adminId),
        settlements.rejectRecovery(recovery.id, { note: 'Từ chối thu hồi' }, adminId),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

      const row = await prisma.settlementRecovery.findUniqueOrThrow({
        where: { id: recovery.id },
      });
      expect(['APPROVED', 'REJECTED']).toContain(row.status);
      const decisions = await prisma.auditLog.count({
        where: {
          entityType: 'SettlementRecovery',
          entityId: String(recovery.id),
          action: { in: ['SETTLEMENT_RECOVERY_APPROVE', 'SETTLEMENT_RECOVERY_REJECT'] },
        },
      });
      expect(decisions).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // BL-06 — payout over-payment (fixed round 2: settlement row claimed FOR
  // UPDATE, payout total re-read under that lock, insert + audit in one tx)
  // -------------------------------------------------------------------------

  describe('BL-06 payouts', () => {
    /** PENDING + PAID payout sum, the money that must never exceed payable. */
    const committedPayouts = async (settlementId: number) => {
      const sum = await prisma.payout.aggregate({
        where: { settlementId, status: { in: ['PENDING', 'PAID'] } },
        _sum: { amount: true },
      });
      return Number(sum._sum.amount ?? 0);
    };

    // (was `it.fails` while BL-06 was an open gap — flipped after the fix)
    it('two concurrent full-size payouts cannot exceed the settlement payable', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PY${r}`);
        const adminId = await world.admin(`py${r}`);
        const settlement = await prisma.settlement.create({
          data: {
            code: world.t(`SET${r}`),
            partnerId: b.partnerId,
            periodStart: new Date(Date.now() - 3600_000),
            periodEnd: new Date(Date.now() + 3600_000),
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 0,
            adjustmentAmount: 0,
            payableAmount: 100000,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });

        const res = await Promise.allSettled([
          payouts.create({ settlementId: settlement.id, amount: 100000 } as never, adminId),
          payouts.create({ settlementId: settlement.id, amount: 100000 } as never, adminId),
        ]);
        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);

        const sum = await committedPayouts(settlement.id);
        expect(sum).toBeLessThanOrEqual(100000);
        expect(sum).toBe(100000);
      }
    });

    it('two concurrent payouts that together match payable exactly both land', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PZ${r}`);
        const adminId = await world.admin(`pz${r}`);
        const settlement = await prisma.settlement.create({
          data: {
            code: world.t(`SETPZ${r}`),
            partnerId: b.partnerId,
            periodStart: new Date(Date.now() - 3600_000),
            periodEnd: new Date(Date.now() + 3600_000),
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 0,
            adjustmentAmount: 0,
            payableAmount: 100000,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });

        const res = await Promise.allSettled([
          payouts.create({ settlementId: settlement.id, amount: 60000 } as never, adminId),
          payouts.create({ settlementId: settlement.id, amount: 40000 } as never, adminId),
        ]);
        // Both are legal op the moment each runs — nothing may be rejected.
        for (const x of res) {
          expect(x.status).toBe('fulfilled');
        }
        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(2);

        const sum = await committedPayouts(settlement.id);
        expect(sum).toBe(100000);
      }
    });

    it('refuses a payout larger than the remainder and leaves nothing in the Db', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PX${r}`);
        const adminId = await world.admin(`px${r}`);
        const settlement = await prisma.settlement.create({
          data: {
            code: world.t(`SETPX${r}`),
            partnerId: b.partnerId,
            periodStart: new Date(Date.now() - 3600_000),
            periodEnd: new Date(Date.now() + 3600_000),
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 0,
            adjustmentAmount: 0,
            payableAmount: 100000,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });
        // 60k rides first (sequential), leaving 40k.
        await payouts.create({ settlementId: settlement.id, amount: 60000 } as never, adminId);

        await expect(
          payouts.create({ settlementId: settlement.id, amount: 50000 } as never, adminId),
        ).rejects.toThrow(/exceed settlement payable/);

        const sum = await committedPayouts(settlement.id);
        expect(sum).toBe(60000);
        const count = await prisma.payout.count({ where: { settlementId: settlement.id } });
        expect(count).toBe(1);
      }
    });

    it('retry after a lost race pays the true remainder only', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PW${r}`);
        const adminId = await world.admin(`pw${r}`);
        const settlement = await prisma.settlement.create({
          data: {
            code: world.t(`SETPW${r}`),
            partnerId: b.partnerId,
            periodStart: new Date(Date.now() - 3600_000),
            periodEnd: new Date(Date.now() + 3600_000),
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 0,
            adjustmentAmount: 0,
            payableAmount: 100000,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });

        // Two concurrent 70k requests: exactly one lands, one is refused.
        const first = await Promise.allSettled([
          payouts.create({ settlementId: settlement.id, amount: 70000 } as never, adminId),
          payouts.create({ settlementId: settlement.id, amount: 70000 } as never, adminId),
        ]);
        expect(first.filter((x) => x.status === 'fulfilled').length).toBe(1);

        // The loser's "retry" replaying the SAME amount must be refused —
        // the winner already consumed part of the payable.
        await expect(
          payouts.create({ settlementId: settlement.id, amount: 70000 } as never, adminId),
        ).rejects.toThrow(/exceed settlement payable/);

        // A retry modelled after a client timeout asking for the default
        // (everything still owed) is allowed and lands exactly the remainder.
        await payouts.create({ settlementId: settlement.id } as never, adminId);
        const sum = await committedPayouts(settlement.id);
        expect(sum).toBe(100000);
      }
    });

    it('one burst of same-remainder payouts: a single payout wins, the rest are refused', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PV${r}`);
        const adminId = await world.admin(`pv${r}`);
        const settlement = await prisma.settlement.create({
          data: {
            code: world.t(`SETPV${r}`),
            partnerId: b.partnerId,
            periodStart: new Date(Date.now() - 3600_000),
            periodEnd: new Date(Date.now() + 3600_000),
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 0,
            adjustmentAmount: 0,
            payableAmount: 100000,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });

        const res = await Promise.allSettled(
          Array.from({ length: 4 }, () =>
            payouts.create({ settlementId: settlement.id, amount: 100000 } as never, adminId),
          ),
        );
        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        for (const x of res.filter((x) => x.status === 'rejected')) {
          expect((x as PromiseRejectedResult).reason?.message).toMatch(/exceed settlement payable/);
        }

        const sum = await committedPayouts(settlement.id);
        expect(sum).toBe(100000);
        const rows = await prisma.payout.count({ where: { settlementId: settlement.id } });
        expect(rows).toBe(1);
      }
    });

    it('staggered default (pay-remainder) payouts: each lands the true remaining, never overdrafted', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(1, `PU${r}`);
        const adminId = await world.admin(`pu${r}`);
        const settlement = await prisma.settlement.create({
          data: {
            code: world.t(`SETPU${r}`),
            partnerId: b.partnerId,
            periodStart: new Date(Date.now() - 3600_000),
            periodEnd: new Date(Date.now() + 3600_000),
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 0,
            adjustmentAmount: 0,
            payableAmount: 100000,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });

        // 4 staggered default amounts: the first takes all 100k, the rest see
        // remaining = 0 and must be refused empty.
        const res = await Promise.allSettled([
          payouts.create({ settlementId: settlement.id } as never, adminId),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return payouts.create({ settlementId: settlement.id } as never, adminId);
          })(),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 12));
            return payouts.create({ settlementId: settlement.id } as never, adminId);
          })(),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return payouts.create({ settlementId: settlement.id } as never, adminId);
          })(),
        ]);
        expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
        for (const x of res.filter((x) => x.status === 'rejected')) {
          // A refused staggered payout sees remaining = 0: the business rule,
          // not an infra failure.
          expect((x as PromiseRejectedResult).reason?.message).toMatch(
            /greater than zero|exceed settlement payable/,
          );
        }

        const sum = await committedPayouts(settlement.id);
        expect(sum).toBe(100000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // BL-07 — admin quick stock ops (fixed round 2: guarded atomic on-hand UPDATE)
  // -------------------------------------------------------------------------

  describe('BL-07 admin quick stock ops', () => {
    it('two concurrent inbounds do not lose an increment', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(10, `IB${r}`);
        const adminId = await world.admin(`ib${r}`);

        await Promise.allSettled([
          inventory.inbound(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantity: 5,
            } as never,
            adminId,
          ),
          inventory.inbound(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantity: 5,
            } as never,
            adminId,
          ),
        ]);

        const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
        expect(Number(bal.onHand)).toBe(20);
        const movements = await prisma.inventoryMovement.aggregate({
          where: { productVariantId: b.variantId, type: 'INBOUND' },
          _sum: { quantityDelta: true },
        });
        expect(Number(movements._sum.quantityDelta ?? 0)).toBe(10);
      }
    });

    // (was `it.fails` while BL-07 was an open gap — flipped after the fix)
    it('two concurrent adjustments do not lose an increment', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(10, `AD${r}`);
        const adminId = await world.admin(`ad${r}`);

        await Promise.allSettled([
          inventory.adjust(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantityDelta: 5,
              note: 'a1',
            } as never,
            adminId,
          ),
          inventory.adjust(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantityDelta: 5,
              note: 'a2',
            } as never,
            adminId,
          ),
        ]);

        const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
        // Both adjustments must be present in the balance AND the ledger.
        expect(Number(bal.onHand)).toBe(20);
        const movements = await prisma.inventoryMovement.aggregate({
          where: { productVariantId: b.variantId, type: 'ADJUSTMENT' },
          _sum: { quantityDelta: true },
        });
        expect(Number(movements._sum.quantityDelta ?? 0)).toBe(10);
      }
    });

    it('staggered mixed +/− adjustments keep the balance and the ledger in step', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(10, `AE${r}`);
        const adminId = await world.admin(`ae${r}`);

        // +8 → −3 → +5, sequential-but-loose: intermediate rejections are
        // exactly what the guard is for; the final balance must be base + 10.
        await inventory.adjust(
          {
            warehouseId: b.warehouseId,
            productLotId: b.lotId,
            productVariantId: b.variantId,
            quantityDelta: 8,
            note: 'ae1',
          } as never,
          adminId,
        );
        await inventory.adjust(
          {
            warehouseId: b.warehouseId,
            productLotId: b.lotId,
            productVariantId: b.variantId,
            quantityDelta: -3,
            note: 'ae2',
          } as never,
          adminId,
        );
        await expect(
          inventory.adjust(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantityDelta: -999,
              note: 'ae3',
            } as never,
            adminId,
          ),
        ).rejects.toThrow(/negative/);
        await inventory.adjust(
          {
            warehouseId: b.warehouseId,
            productLotId: b.lotId,
            productVariantId: b.variantId,
            quantityDelta: 5,
            note: 'ae4',
          } as never,
          adminId,
        );

        const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
        expect(Number(bal.onHand)).toBe(20);

        const movements = await prisma.inventoryMovement.findMany({
          where: { productVariantId: b.variantId, type: 'ADJUSTMENT' },
          orderBy: { id: 'asc' },
        });
        const entries = movements.map((m) => ({
          delta: Number(m.quantityDelta),
          before: Number(m.beforeQuantity),
          after: Number(m.afterQuantity),
        }));
        // Each committed movement must describe exactly what the balance did.
        expect(entries.length).toBe(3);
        expect(entries[0]).toEqual({ delta: 8, before: 10, after: 18 });
        expect(entries[1]).toEqual({ delta: -3, before: 18, after: 15 });
        expect(entries[2]).toEqual({ delta: 5, before: 15, after: 20 });
      }
    });

    it('a retried adjustment records every applied occurrence, never a half one', async () => {
      const b = await world.base(10, 'AF');
      const adminId = await world.admin('af');

      // The operator's client retries the same +5 twice: each occurrence is a
      // real business op and both must survive, with a consistent ledger.
      await inventory.adjust(
        {
          warehouseId: b.warehouseId,
          productLotId: b.lotId,
          productVariantId: b.variantId,
          quantityDelta: 5,
          note: 'af-first',
        } as never,
        adminId,
      );
      await inventory.adjust(
        {
          warehouseId: b.warehouseId,
          productLotId: b.lotId,
          productVariantId: b.variantId,
          quantityDelta: 5,
          note: 'af-retry',
        } as never,
        adminId,
      );

      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      expect(Number(bal.onHand)).toBe(20);
      const movements = await prisma.inventoryMovement.findMany({
        where: { productVariantId: b.variantId, type: 'ADJUSTMENT' },
      });
      expect(movements.length).toBe(2);
      for (const m of movements) {
        expect(Number(m.quantityDelta)).toBe(5);
      }

      // A rejected adjust must leave no movement and no balance change behind:
      // the transaction rolls back as a whole. Reserve 5 first so commitments
      // exist (on-hand 20, reserved 5); then under-cutting is refused.
      await inventory.reserve(
        {
          warehouseId: b.warehouseId,
          productLotId: b.lotId,
          productVariantId: b.variantId,
          quantity: 5,
        } as never,
        adminId,
      );
      const onHandBefore = 20;
      const movementsBefore = await prisma.inventoryMovement.count({
        where: { productVariantId: b.variantId, type: 'ADJUSTMENT' },
      });
      // −200 → on-hand would go negative.
      await expect(
        inventory.adjust(
          {
            warehouseId: b.warehouseId,
            productLotId: b.lotId,
            productVariantId: b.variantId,
            quantityDelta: -200,
          } as never,
          adminId,
        ),
      ).rejects.toThrow(/negative/);
      // −20 → on-hand 0 would undercut the 5 reserved units.
      await expect(
        inventory.adjust(
          {
            warehouseId: b.warehouseId,
            productLotId: b.lotId,
            productVariantId: b.variantId,
            quantityDelta: -20,
          } as never,
          adminId,
        ),
      ).rejects.toThrow(/lower than reserved \+ blocked/);
      expect(
        await prisma.inventoryMovement.count({
          where: { productVariantId: b.variantId, type: 'ADJUSTMENT' },
        }),
      ).toBe(movementsBefore);
      const untouched = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: b.balanceId },
      });
      expect(Number(untouched.onHand)).toBe(onHandBefore);
      expect(Number(untouched.reserved)).toBe(5);
    });

    it('adjust interleaved with a real checkout: stock can never be oversold nor a movement lost', async () => {
      // adjust(-4) against on-hand 10 while a 10-unit checkout competes for
      // the same balance: the balance only has ONE way to serve both —
      //   * adjust commits first  → on-hand 6 → checkout is refused (10 > 6)
      //   * checkout reserves 10  → adjust would leave 6 < reserved 10 → refused
      // Either kingdom, but never both, and never a lost increment.
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(10, `AG${r}`);
        const adminId = await world.admin(`ag${r}`);
        const [cid] = await world.customers(1);

        const res = await Promise.allSettled([
          inventory.adjust(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantityDelta: -4,
              note: 'ag-admin',
            } as never,
            adminId,
          ),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 3));
            return orders.checkout(cid, {
              shippingAddress: address,
              items: [{ productVariantId: b.variantId, quantity: 10 }],
            } as never);
          })(),
        ]);

        const adjustOk = res[0]?.status === 'fulfilled';
        const checkoutOk = res[1]?.status === 'fulfilled';
        // Exactly one of the two gets the stock (10 units cannot serve both −4
        // and a 10-unit reservation); any refusal is a 400-class business
        // refusal, never an unexplained infra crash.
        expect(adjustOk).not.toBe(checkoutOk);
        for (const x of res.filter((x) => x.status === 'rejected')) {
          expect((x as PromiseRejectedResult).reason?.message).toMatch(/Cannot reserve|not enough|Negative|negative|short by|available/);
        }

        const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
        const onHand = Number(bal.onHand);
        const reserved = Number(bal.reserved);
        const blocked = Number(bal.blocked);

        const adjustMoves = await prisma.inventoryMovement.count({
          where: { productVariantId: b.variantId, type: 'ADJUSTMENT' },
        });
        const ordersInDb = await prisma.order.count({ where: { customerId: cid } });
        const allocations = await prisma.inventoryAllocation.findMany({
          where: { inventoryBalanceId: b.balanceId },
        });
        const allocSum = allocations.reduce((s, a) => s + Number(a.quantity), 0);

        if (adjustOk) {
          expect(onHand).toBe(6);
          expect(checkoutOk).toBe(false);
          expect(ordersInDb).toBe(0);
          expect(reserved).toBe(0);
          expect(allocSum).toBe(0);
          expect(adjustMoves).toBe(1);
        } else {
          expect(onHand).toBe(10);
          expect(ordersInDb).toBe(1);
          expect(reserved).toBe(10);
          expect(allocSum).toBe(10);
          expect(adjustMoves).toBe(0);
        }
        // The ledger never contradicts the balance, and commitments never
        // exceed the stock.
        expect(onHand).toBeGreaterThanOrEqual(reserved + blocked);
      }
    });

    it('adjust interleaved with an inbound: both increments survive in balance and ledger', async () => {
      for (let r = 0; r < ROUNDS; r += 1) {
        const b = await world.base(10, `AH${r}`);
        const adminId = await world.admin(`ah${r}`);

        const res = await Promise.allSettled([
          inventory.inbound(
            {
              warehouseId: b.warehouseId,
              productLotId: b.lotId,
              productVariantId: b.variantId,
              quantity: 5,
            } as never,
            adminId,
          ),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 3));
            return inventory.adjust(
              {
                warehouseId: b.warehouseId,
                productLotId: b.lotId,
                productVariantId: b.variantId,
                quantityDelta: 5,
                note: 'ah-admin',
              } as never,
              adminId,
            );
          })(),
        ]);
        // Both are legal increments on this balance — both must commit.
        for (const x of res) {
          expect(x.status).toBe('fulfilled');
        }

        const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
        expect(Number(bal.onHand)).toBe(20);

        const movements = await prisma.inventoryMovement.findMany({
          where: { productVariantId: b.variantId },
          select: { type: true, quantityDelta: true },
        });
        // One INBOUND +5 and one ADJUSTMENT +5, both applied exactly once.
        const inbound = movements.filter((m) => m.type === 'INBOUND');
        const adjust = movements.filter((m) => m.type === 'ADJUSTMENT');
        expect(inbound.length).toBe(1);
        expect(adjust.length).toBe(1);
        expect(Number(inbound[0]!.quantityDelta)).toBe(5);
        expect(Number(adjust[0]!.quantityDelta)).toBe(5);
      }
    });
  });
});
