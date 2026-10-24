import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { IDEMPOTENCY_SCOPES } from '../src/common/idempotency/idempotency.constants.js';
import {
  hashIdempotencyPayload,
  IdempotencyService,
} from '../src/common/idempotency/idempotency.service.js';
import { PayoutsService } from '../src/finance/settlements.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
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
 * Idempotency ledger acceptance suite (round 4).
 *
 * Every scenario drives the REAL production services against the REAL MySQL
 * `TEST_DATABASE_URL`. The assertions are made directly in the database, so a
 * replay can never be confused with a second business effect:
 *
 *  - same actor + scope + key + payload  → the original response is replayed,
 *    and exactly one movement / payout / refund / audit row exists;
 *  - same actor + scope + key, different payload → 409 and no new effect;
 *  - concurrent requests with one key → exactly one transaction commits;
 *  - a failed transaction leaves no key row (the key is immediately reusable);
 *  - keys are actor-scoped and endpoint-scoped;
 *  - keys expire after the retention horizon and can then be reused;
 *  - a committed key row always carries its response (no visible PENDING).
 *
 * The suite is skipped entirely without `TEST_DATABASE_URL`, and every row it
 * creates carries the `cc…` run prefix and is removed in `afterAll`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeConcurrencyRunId();
/** Deliberately larger than the Prisma pool: proves DB serialisation, not luck. */
const CONCURRENT_CALLS = 30;

describe.skipIf(!hasTestDb)('AgriMarket API — idempotency ledger (e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;
  let idempotency: IdempotencyService;
  let inventory: InventoryService;
  let payouts: PayoutsService;
  let payments: PaymentsService;

  const address = { recipientName: 'K', phone: '0900000000', province: 'Hưng Yên', detail: 'x' };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createConcurrencyPrisma(TEST_URL as string);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);

    const audit = new AuditService(prisma as never);
    idempotency = new IdempotencyService(prisma as never);
    inventory = new InventoryService(prisma as never, audit as never, idempotency);
    payouts = new PayoutsService(prisma as never, audit as never, idempotency);
    payments = new PaymentsService(prisma as never, audit as never, idempotency);
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

  /** A DELIVERED order with one item, the shape refunds require. */
  const deliveredOrder = async (
    base: ConcurrencyBase,
    customerId: number,
    tag: string,
  ) => {
    const order = await prisma.order.create({
      data: {
        code: world.t(`IO${tag}`),
        customerId,
        shippingAddressSnapshot: address,
        subtotal: 100000,
        discountTotal: 0,
        shippingFee: 0,
        grandTotal: 100000,
        status: 'DELIVERED',
      },
    });
    const partnerOrder = await prisma.partnerOrder.create({
      data: {
        code: world.t(`IPO${tag}`),
        orderId: order.id,
        partnerId: base.partnerId,
        subtotal: 100000,
        discountTotal: 0,
        commissionAmount: 0,
        payableAmount: 100000,
        status: 'DELIVERED',
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        partnerOrderId: partnerOrder.id,
        productVariantId: base.variantId,
        productNameSnapshot: 'p',
        skuSnapshot: 's',
        unitPriceSnapshot: 100000,
        quantity: 1,
        subtotal: 100000,
        discountAmount: 0,
      },
    });
    return { order, partnerOrder, item };
  };

  const paidPayment = async (orderId: number, amount = 100000) =>
    prisma.payment.create({
      data: {
        orderId,
        method: 'COD',
        amount,
        status: 'PAID',
        paidAt: new Date(),
      },
    });

  /** A CONFIRMED settlement with a known payable; no lines are needed here. */
  const confirmedSettlement = async (partnerId: number, tag: string, payable = 100000) =>
    prisma.settlement.create({
      data: {
        code: world.t(`ISET${tag}`),
        partnerId,
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(),
        grossAmount: payable,
        refundAmount: 0,
        commissionAmount: 0,
        adjustmentAmount: 0,
        payableAmount: payable,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });

  const adjustDto = (base: ConcurrencyBase, quantityDelta: number, note = 'idem') => ({
    warehouseId: base.warehouseId,
    productLotId: base.lotId,
    productVariantId: base.variantId,
    quantityDelta,
    note,
  });

  const adjustPayload = (dto: ReturnType<typeof adjustDto>) => ({
    warehouseId: dto.warehouseId,
    productLotId: dto.productLotId,
    productVariantId: dto.productVariantId,
    quantityDelta: dto.quantityDelta,
    note: dto.note ?? null,
  });

  const keyRow = async (scope: string, actorUserId: number, key: string) =>
    prisma.appIdempotencyKey.findUnique({
      where: { scope_actorUserId_key: { scope, actorUserId, key } },
    });

  const movementCount = async (base: ConcurrencyBase, actorUserId: number) =>
    prisma.inventoryMovement.count({
      where: {
        warehouseId: base.warehouseId,
        productLotId: base.lotId,
        productVariantId: base.variantId,
        type: 'ADJUSTMENT',
        createdByUserId: actorUserId,
      },
    });

  const adjustmentAuditCount = async (base: ConcurrencyBase) =>
    prisma.auditLog.count({
      where: {
        action: 'INVENTORY_ADJUSTMENT',
        entityType: 'InventoryBalance',
        entityId: String(base.balanceId),
      },
    });

  const currentOnHand = async (base: ConcurrencyBase) => {
    const row = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: base.balanceId } });
    return Number(row.onHand);
  };

  // -------------------------------------------------------------------------
  // Inventory adjustment
  // -------------------------------------------------------------------------

  describe('inventory adjust', () => {
    it('replays one +5 adjustment for one key, while two independent keys still add +10', async () => {
      const base = await world.base(100, 'IA1');
      const adminId = await world.admin('ia1');
      const dto = adjustDto(base, 5, 'one adjustment');
      const firstKey = `${RUN_ID}-adjust-replay`;

      const first = await inventory.adjust(dto as never, adminId, firstKey);
      expect(Number(first.onHand)).toBe(105);

      const retried = await inventory.adjust(dto as never, adminId, firstKey);
      expect(Number(retried.onHand)).toBe(105);
      expect(await currentOnHand(base)).toBe(105);
      expect(await movementCount(base, adminId)).toBe(1);
      expect(await adjustmentAuditCount(base)).toBe(1);

      // A different key is a different logical operation, even with the same
      // payload: +5 twice is +10 and two movements.
      const second = await inventory.adjust(dto as never, adminId, `${RUN_ID}-adjust-second`);
      expect(Number(second.onHand)).toBe(110);
      expect(await currentOnHand(base)).toBe(110);
      expect(await movementCount(base, adminId)).toBe(2);

      const row = await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, adminId, firstKey);
      expect(row?.responseStatus).toBe(201);
      expect(row?.responseJson).not.toBeNull();
    });

    it('rejects the same key with a different payload (409) and changes nothing', async () => {
      const base = await world.base(100, 'IA2');
      const adminId = await world.admin('ia2');
      const key = `${RUN_ID}-adjust-conflict`;

      await inventory.adjust(adjustDto(base, 5) as never, adminId, key);
      await expect(
        inventory.adjust(adjustDto(base, 7) as never, adminId, key),
      ).rejects.toMatchObject({ status: 409 });

      expect(await currentOnHand(base)).toBe(105);
      expect(await movementCount(base, adminId)).toBe(1);
    });

    it('leaves no key behind when the business write rolls back, so the same key can be retried safely', async () => {
      const base = await world.base(10, 'IA3');
      const adminId = await world.admin('ia3');
      const key = `${RUN_ID}-adjust-rollback`;

      await expect(
        inventory.adjust(adjustDto(base, -9999) as never, adminId, key),
      ).rejects.toThrow(/negative/i);

      expect(await currentOnHand(base)).toBe(10);
      expect(await movementCount(base, adminId)).toBe(0);
      expect(
        await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, adminId, key),
      ).toBeNull();

      // The failed attempt is not a committed response; the key was never
      // burned, so a corrected payload can use it immediately.
      const recovered = await inventory.adjust(adjustDto(base, 5) as never, adminId, key);
      expect(Number(recovered.onHand)).toBe(15);
      expect(await currentOnHand(base)).toBe(15);
      expect(await movementCount(base, adminId)).toBe(1);
    });

    it('replays exactly once when 30 requests race with the same key', async () => {
      const base = await world.base(100, 'IA4');
      const adminId = await world.admin('ia4');
      const dto = adjustDto(base, 5, 'concurrent');
      const key = `${RUN_ID}-adjust-concurrent`;

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          inventory.adjust(dto as never, adminId, key),
        ),
      );
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(failures, failures.map((f) => String(f.reason)).join('\n')).toHaveLength(0);

      const values = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof inventory.adjust>>> =>
          r.status === 'fulfilled',
        )
        .map((r) => Number(r.value.onHand));
      expect(values).toHaveLength(CONCURRENT_CALLS);
      expect(new Set(values)).toEqual(new Set([105]));

      expect(await currentOnHand(base)).toBe(105);
      expect(await movementCount(base, adminId)).toBe(1);
      expect(await adjustmentAuditCount(base)).toBe(1);
      expect(
        await prisma.appIdempotencyKey.count({
          where: {
            scope: IDEMPOTENCY_SCOPES.inventoryAdjust,
            actorUserId: adminId,
            key,
          },
        }),
      ).toBe(1);
    }, 120_000);

    it('is actor-scoped: the same key and payload from two admins are two operations', async () => {
      const base = await world.base(100, 'IA5');
      const firstAdmin = await world.admin('ia5a');
      const secondAdmin = await world.admin('ia5b');
      const dto = adjustDto(base, 5);
      const key = `${RUN_ID}-adjust-actor`;

      await inventory.adjust(dto as never, firstAdmin, key);
      await inventory.adjust(dto as never, secondAdmin, key);

      expect(await currentOnHand(base)).toBe(110);
      expect(await movementCount(base, firstAdmin)).toBe(1);
      expect(await movementCount(base, secondAdmin)).toBe(1);
    });

    it('is endpoint-scoped: the same key may be used by adjust and by payout', async () => {
      const base = await world.base(100, 'IA6');
      const adminId = await world.admin('ia6');
      const settlement = await confirmedSettlement(base.partnerId, 'IA6', 100000);
      const key = `${RUN_ID}-shared-scope`;

      await inventory.adjust(adjustDto(base, 5) as never, adminId, key);
      const payout = await payouts.create(
        { settlementId: settlement.id, amount: 10000 } as never,
        adminId,
        key,
      );

      expect(Number(payout.amount)).toBe(10000);
      expect(
        await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, adminId, key),
      ).not.toBeNull();
      expect(
        await keyRow(IDEMPOTENCY_SCOPES.payoutCreate, adminId, key),
      ).not.toBeNull();
    });

    it('treats an expired key as unused, then purges it', async () => {
      const base = await world.base(100, 'IA7');
      const adminId = await world.admin('ia7');
      const dto = adjustDto(base, 5, 'expired');
      const key = `${RUN_ID}-adjust-expired`;
      const payload = adjustPayload(dto);

      await prisma.appIdempotencyKey.create({
        data: {
          scope: IDEMPOTENCY_SCOPES.inventoryAdjust,
          actorUserId: adminId,
          key,
          requestHash: hashIdempotencyPayload(payload),
          responseStatus: 201,
          responseJson: { onHand: '999999', fake: true },
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const result = await inventory.adjust(dto as never, adminId, key);
      expect(Number(result.onHand)).toBe(105);
      expect(await currentOnHand(base)).toBe(105);
      expect(await movementCount(base, adminId)).toBe(1);

      const refreshed = await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, adminId, key);
      expect(refreshed).not.toBeNull();
      expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const staleKey = `${RUN_ID}-adjust-purge`;
      await prisma.appIdempotencyKey.create({
        data: {
          scope: IDEMPOTENCY_SCOPES.inventoryAdjust,
          actorUserId: adminId,
          key: staleKey,
          requestHash: hashIdempotencyPayload(payload),
          responseStatus: 201,
          responseJson: { ok: true },
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      expect(await idempotency.purgeExpired()).toBeGreaterThanOrEqual(1);
      expect(
        await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, adminId, staleKey),
      ).toBeNull();
    });

    it('rejects an empty or over-long key without writing stock', async () => {
      const base = await world.base(100, 'IA8');
      const adminId = await world.admin('ia8');
      const dto = adjustDto(base, 5);

      await expect(inventory.adjust(dto as never, adminId, '   ')).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        inventory.adjust(dto as never, adminId, 'k'.repeat(101)),
      ).rejects.toMatchObject({ status: 400 });

      expect(await currentOnHand(base)).toBe(100);
      expect(await movementCount(base, adminId)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Payout creation
  // -------------------------------------------------------------------------

  describe('payout create', () => {
    it('replays one payout for one key instead of paying twice', async () => {
      const base = await world.base(1, 'IP1');
      const adminId = await world.admin('ip1');
      const settlement = await confirmedSettlement(base.partnerId, 'IP1', 100000);
      const key = `${RUN_ID}-payout-replay`;
      const dto = { settlementId: settlement.id, amount: 30000, reference: 'REF-1' };

      const first = await payouts.create(dto as never, adminId, key);
      const retried = await payouts.create(dto as never, adminId, key);

      expect(retried.id).toBe(first.id);
      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'PAYOUT_CREATE',
            entityType: 'Payout',
            entityId: String(first.id),
          },
        }),
      ).toBe(1);
      const sum = await prisma.payout.aggregate({
        where: { settlementId: settlement.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(30000);
    });

    it('rejects the same key with a different payout payload (409)', async () => {
      const base = await world.base(1, 'IP2');
      const adminId = await world.admin('ip2');
      const settlement = await confirmedSettlement(base.partnerId, 'IP2', 100000);
      const key = `${RUN_ID}-payout-conflict`;

      const created = await payouts.create(
        { settlementId: settlement.id, amount: 30000 } as never,
        adminId,
        key,
      );
      await expect(
        payouts.create({ settlementId: settlement.id, amount: 20000 } as never, adminId, key),
      ).rejects.toMatchObject({ status: 409 });

      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
      expect(await prisma.payout.count({ where: { id: created.id } })).toBe(1);
    });

    it('rolls the key back with a refused payout and lets the same key succeed afterwards', async () => {
      const base = await world.base(1, 'IP3');
      const adminId = await world.admin('ip3');
      const settlement = await confirmedSettlement(base.partnerId, 'IP3', 100000);
      const key = `${RUN_ID}-payout-rollback`;

      await expect(
        payouts.create({ settlementId: settlement.id, amount: 200000 } as never, adminId, key),
      ).rejects.toThrow(/exceed settlement payable/i);

      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(0);
      expect(await keyRow(IDEMPOTENCY_SCOPES.payoutCreate, adminId, key)).toBeNull();

      const recovered = await payouts.create(
        { settlementId: settlement.id, amount: 40000 } as never,
        adminId,
        key,
      );
      expect(Number(recovered.amount)).toBe(40000);
      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
    });

    it('creates exactly one payout when 30 requests race with the same key', async () => {
      const base = await world.base(1, 'IP4');
      const adminId = await world.admin('ip4');
      const settlement = await confirmedSettlement(base.partnerId, 'IP4', 100000);
      const key = `${RUN_ID}-payout-concurrent`;
      const dto = { settlementId: settlement.id, amount: 25000, reference: 'RACE' };

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          payouts.create(dto as never, adminId, key),
        ),
      );
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(failures, failures.map((f) => String(f.reason)).join('\n')).toHaveLength(0);

      const ids = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof payouts.create>>> =>
          r.status === 'fulfilled',
        )
        .map((r) => r.value.id);
      expect(ids).toHaveLength(CONCURRENT_CALLS);
      expect(new Set(ids).size).toBe(1);

      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
      const sum = await prisma.payout.aggregate({
        where: { settlementId: settlement.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(25000);
      expect(
        await prisma.auditLog.count({
          where: { action: 'PAYOUT_CREATE', entityId: String(ids[0]) },
        }),
      ).toBe(1);
    }, 120_000);

    it('replays the original payout after it was marked PAID (state change does not break the retry)', async () => {
      const base = await world.base(1, 'IP5');
      const adminId = await world.admin('ip5');
      const settlement = await confirmedSettlement(base.partnerId, 'IP5', 100000);
      const key = `${RUN_ID}-payout-after-paid`;
      const dto = { settlementId: settlement.id, amount: 50000 };

      const created = await payouts.create(dto as never, adminId, key);
      await payouts.markPaid(created.id, adminId);
      const paid = await prisma.payout.findUniqueOrThrow({ where: { id: created.id } });
      expect(paid.status).toBe('PAID');

      const retried = await payouts.create(dto as never, adminId, key);
      expect(retried.id).toBe(created.id);
      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(1);
    });

    it('allows two independent payouts with different keys up to the payable amount', async () => {
      const base = await world.base(1, 'IP6');
      const adminId = await world.admin('ip6');
      const settlement = await confirmedSettlement(base.partnerId, 'IP6', 100000);

      await payouts.create(
        { settlementId: settlement.id, amount: 60000 } as never,
        adminId,
        `${RUN_ID}-payout-independent-1`,
      );
      await payouts.create(
        { settlementId: settlement.id, amount: 40000 } as never,
        adminId,
        `${RUN_ID}-payout-independent-2`,
      );

      expect(await prisma.payout.count({ where: { settlementId: settlement.id } })).toBe(2);
      const sum = await prisma.payout.aggregate({
        where: { settlementId: settlement.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(100000);
    });
  });

  // -------------------------------------------------------------------------
  // Refunds
  // -------------------------------------------------------------------------

  describe('refund create', () => {
    it('replays one refund for one key, even after the payment became REFUNDED', async () => {
      const base = await world.base(1, 'IR1');
      const adminId = await world.admin('ir1');
      const [customerId] = await world.customers(1);
      const { order } = await deliveredOrder(base, customerId, 'IR1');
      const payment = await paidPayment(order.id);
      const key = `${RUN_ID}-refund-replay`;
      const dto = { paymentId: payment.id, amount: 100000, reason: 'full refund' };

      const first = await payments.refund(dto as never, adminId, key);
      await payments.approveRefund(first.id, adminId);
      await payments.completeRefund(
        first.id,
        { reference: `RF-${first.id}` } as never,
        adminId,
      );
      const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(afterFirst.status).toBe('REFUNDED');

      const retried = await payments.refund(dto as never, adminId, key);
      expect(retried.id).toBe(first.id);
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { action: 'REFUND_CREATE', entityType: 'Refund', entityId: String(first.id) },
        }),
      ).toBe(1);
      const sum = await prisma.refund.aggregate({
        where: { paymentId: payment.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(100000);
    });

    it('rejects the same key with a different refund payload (409)', async () => {
      const base = await world.base(1, 'IR2');
      const adminId = await world.admin('ir2');
      const [customerId] = await world.customers(1);
      const { order } = await deliveredOrder(base, customerId, 'IR2');
      const payment = await paidPayment(order.id);
      const key = `${RUN_ID}-refund-conflict`;

      await payments.refund(
        { paymentId: payment.id, amount: 25000, reason: 'first' } as never,
        adminId,
        key,
      );
      await expect(
        payments.refund(
          { paymentId: payment.id, amount: 30000, reason: 'first' } as never,
          adminId,
          key,
        ),
      ).rejects.toMatchObject({ status: 409 });

      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
      const sum = await prisma.refund.aggregate({
        where: { paymentId: payment.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(25000);
    });

    it('rolls the key back with a refused refund and lets the same key succeed afterwards', async () => {
      const base = await world.base(1, 'IR3');
      const adminId = await world.admin('ir3');
      const [customerId] = await world.customers(1);
      const { order } = await deliveredOrder(base, customerId, 'IR3');
      const payment = await paidPayment(order.id);
      const key = `${RUN_ID}-refund-rollback`;

      await expect(
        payments.refund(
          { paymentId: payment.id, amount: 200000, reason: 'too much' } as never,
          adminId,
          key,
        ),
      ).rejects.toThrow(/exceed paid amount/i);

      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(0);
      expect(await keyRow(IDEMPOTENCY_SCOPES.refundCreate, adminId, key)).toBeNull();

      const recovered = await payments.refund(
        { paymentId: payment.id, amount: 10000, reason: 'valid' } as never,
        adminId,
        key,
      );
      expect(Number(recovered.amount)).toBe(10000);
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    });

    it('creates exactly one refund when 30 requests race with the same key', async () => {
      const base = await world.base(1, 'IR4');
      const adminId = await world.admin('ir4');
      const [customerId] = await world.customers(1);
      const { order } = await deliveredOrder(base, customerId, 'IR4');
      const payment = await paidPayment(order.id);
      const key = `${RUN_ID}-refund-concurrent`;
      const dto = { paymentId: payment.id, amount: 40000, reason: 'race' };

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          payments.refund(dto as never, adminId, key),
        ),
      );
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(failures, failures.map((f) => String(f.reason)).join('\n')).toHaveLength(0);

      const ids = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof payments.refund>>> =>
          r.status === 'fulfilled',
        )
        .map((r) => r.value.id);
      expect(ids).toHaveLength(CONCURRENT_CALLS);
      expect(new Set(ids).size).toBe(1);

      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
      const sum = await prisma.refund.aggregate({
        where: { paymentId: payment.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(40000);

      // Completion is the step that moves money; the replay guarantee is about
      // the PENDING row created above.
      await payments.approveRefund(ids[0], adminId);
      await payments.completeRefund(
        ids[0],
        { reference: `RF-${ids[0]}` } as never,
        adminId,
      );
      const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(current.status).toBe('PARTIALLY_REFUNDED');
      expect(
        await prisma.auditLog.count({
          where: { action: 'REFUND_CREATE', entityType: 'Refund', entityId: String(ids[0]) },
        }),
      ).toBe(1);
    }, 120_000);

    it('allows independent partial refunds whose total equals the paid amount', async () => {
      const base = await world.base(1, 'IR5');
      const adminId = await world.admin('ir5');
      const [customerId] = await world.customers(1);
      const { order } = await deliveredOrder(base, customerId, 'IR5');
      const payment = await paidPayment(order.id);

      const first = await payments.refund(
        { paymentId: payment.id, amount: 60000, reason: 'first' } as never,
        adminId,
        `${RUN_ID}-refund-independent-1`,
      );
      const second = await payments.refund(
        { paymentId: payment.id, amount: 40000, reason: 'second' } as never,
        adminId,
        `${RUN_ID}-refund-independent-2`,
      );

      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(2);

      await payments.approveRefund(first.id, adminId);
      await payments.completeRefund(
        first.id,
        { reference: `RF-${first.id}` } as never,
        adminId,
      );
      let current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(current.status).toBe('PARTIALLY_REFUNDED');

      await payments.approveRefund(second.id, adminId);
      await payments.completeRefund(
        second.id,
        { reference: `RF-${second.id}` } as never,
        adminId,
      );
      current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(current.status).toBe('REFUNDED');
      const sum = await prisma.refund.aggregate({
        where: { paymentId: payment.id },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount ?? 0)).toBe(100000);
    });
  });

  // -------------------------------------------------------------------------
  // Ledger invariants
  // -------------------------------------------------------------------------

  describe('ledger invariants', () => {
    it('never leaves a committed row without a response (no stuck PENDING state)', async () => {
      const rows = await prisma.appIdempotencyKey.findMany({
        where: { actorUserId: { in: world.created.users } },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.responseStatus, `key ${row.scope}/${row.key}`).toBe(201);
        expect(row.responseJson, `key ${row.scope}/${row.key}`).not.toBeNull();
        expect(row.expiresAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
      }
    });
  });
});
