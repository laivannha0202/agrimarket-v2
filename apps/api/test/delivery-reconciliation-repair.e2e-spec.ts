import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { OrderDeliveryReconciliationService } from '../src/orders/order-delivery-reconciliation.service.js';
import { createTestApp, login } from './helpers/test-app.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * INDEPENDENT AUDIT of the delivery-reconciliation repair (the routine behind
 * `POST /orders/delivery-reconciliation` with `dryRun: false`). Runs against
 * the isolated TEST database only — the dev database is never written.
 *
 * The routine exists to undo the legacy no-guard DELIVERED flip (an admin
 * forced DELIVERED through PATCH /orders/:id/status before the delivery
 * evidence guard existed). That legacy flip ALSO consumed the stock: the same
 * writes `consumeOrderStock` performs at a real delivery — `on_hand` and
 * `reserved` drop in one guarded UPDATE, the lot's `remaining_quantity` drops,
 * and one `OUTBOUND` movement per allocation is recorded as history.
 *
 * The exact inverse is therefore required of the repair: statuses return to
 * the evidence-backed value, `on_hand`/`reserved`/lot-return to their
 * pre-flip values, one compensating `ADJUSTMENT` movement per allocation, the
 * legacy `OUTBOUND` rows kept as history, payments untouched, and the whole
 * run atomic and non-repeatable.
 *
 * The "legacy damage" in these tests is produced by direct writes replicating
 * `consumeOrderStock` byte-for-byte — the modern path refuses to produce it,
 * which is exactly why the reconciliation service exists.
 *
 * Suite map (one scenario per test, every scenario on its own lots/balances):
 *   1. revert + endled restore on a two-parcel in-transit order (the order-3
 *      shape), COD stays PENDING, a settlement claim survives untouched
 *      (finance owns money separately), second run NOT_APPLICABLE and ZERO
 *      extra movements (idempotency / no double-count on repeat)
 *   2. HTTP contract: missing / `null` / `true` dryRun all stay read-only;
 *      only explicit `false` writes; the no-parcel shape (order-6 sys) reverts
 *      to READY_TO_SHIP; the monitoring list reflects the row before & after
 *   3. atomicity: a saturated lot cap refuses the restore AFTER the order CAS
 *      — the transaction must roll back completely (no status, no balance
 *      cell, no movement, no audit row may survive a failed run)
 *   4. a partner order with a REAL delivery is UNREPAIRABLE and changes nothing
 *   5. two concurrent repairs race: exactly one reverts; balances restored
 *      exactly once (never double-counted)
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId();

interface LedgerCell {
  id: number;
  onHand: number;
  reserved: number;
  blocked: number;
}

describe.skipIf(!hasTestDb)('AgriMarket API — delivery reconciliation repair audit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let adminId: number;
  let service: OrderDeliveryReconciliationService;

  let orderSeq = 1;

  const post = (path: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body as object);
  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  async function balancesFor(orderId: number): Promise<LedgerCell[]> {
    const rows = await prisma.inventoryBalance.findMany({
      where: { allocations: { some: { orderItem: { partnerOrder: { orderId } } } } },
      select: { id: true, onHand: true, reserved: true, blocked: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((b) => ({
      id: b.id,
      onHand: Number(b.onHand),
      reserved: Number(b.reserved),
      blocked: Number(b.blocked),
    }));
  }

  async function lotsFor(orderId: number) {
    const rows = await prisma.productLot.findMany({
      where: {
        inventoryBalances: {
          some: { allocations: { some: { orderItem: { partnerOrder: { orderId } } } } },
        },
      },
      select: { id: true, quantity: true, remainingQuantity: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((l) => ({
      id: l.id,
      quantity: Number(l.quantity),
      remainingQuantity: Number(l.remainingQuantity),
    }));
  }

  /** Full state of one corrupted order, read fresh for assertions. */
  async function snapshot(orderId: number) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const partnerOrders = await prisma.partnerOrder.findMany({
      where: { orderId },
      orderBy: { id: 'asc' },
    });
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    const outbound = await prisma.inventoryMovement.findMany({
      where: { referenceType: 'Order', referenceId: orderId, type: 'OUTBOUND' },
      orderBy: { id: 'asc' },
    });
    const adjustments = await prisma.inventoryMovement.findMany({
      where: { referenceType: 'DeliveryReconciliation', referenceId: orderId },
      orderBy: { id: 'asc' },
    });
    const reversals = await prisma.auditLog.findMany({
      where: { action: 'ORDER_DELIVERY_REVERSED', entityType: 'Order', entityId: String(orderId) },
      orderBy: { id: 'asc' },
    });
    const quarantine = await prisma.quarantineCase.count({ where: { orderId } });
    const shipments = await prisma.shipment.findMany({
      where: { partnerOrder: { orderId } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, deliveredAt: true },
    });
    return {
      orderStatus: order.status,
      reservationExpiresAt: order.reservationExpiresAt,
      poStatuses: partnerOrders.map((p) => ({ id: p.id, status: p.status })),
      payment: { status: payment.status, paidAt: payment.paidAt, method: payment.method },
      outboundCount: outbound.length,
      outboundBefore: outbound.map((m) => Number(m.beforeQuantity)),
      adjustments: adjustments.map((m) => ({
        delta: Number(m.quantityDelta),
        before: Number(m.beforeQuantity),
        after: Number(m.afterQuantity),
      })),
      reversalCount: reversals.length,
      reversal: reversals[0] ?? null,
      quarantineCount: quarantine,
      shipments: shipments.map((s) => ({ id: s.id, status: s.status, deliveredAt: s.deliveredAt })),
      balances: await balancesFor(orderId),
      lots: await lotsFor(orderId),
    };
  }

  interface PoPlan {
    /** `null` means the legacy flip happened before any parcel existed. */
    shipment: 'TRANSIT' | 'DELIVERED' | null;
    quantity: number;
  }

  /** Pre-damage ledger + everything the tests need to make assertions. */
  interface CorruptContext {
    orderId: number;
    orderCode: string;
    partnerOrderIds: number[];
    paymentId: number;
    lotIds: number[];
    quantities: number[];
    preDamage: { balances: LedgerCell[]; lots: { id: number; remainingQuantity: number; quantity: number }[] };
  }

  /**
   * Builds a damaged legacy row: an order whose statuses say DELIVERED while
   * its parcels still travel (or never existed), stock consumed, one
   * `OUTBOUND` movement per allocation — the exact footprint of the pre-guard
   * `PATCH /orders/:id/status`.
   */
  async function buildLegacyDamagedOrder(plan: PoPlan[]): Promise<CorruptContext> {
    const t = (suffix: string) => `${RUN_ID}-${suffix}`;
    const grand = plan.reduce((sum, p) => sum + p.quantity * 25_000, 0);

    const order = await prisma.order.create({
      data: {
        code: t(`ORD-KD${orderSeq}`),
        customerId: fixtures.customerId,
        shippingAddressSnapshot: {
          recipientName: 'Audit Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1, đường Kiểm định',
        },
        subtotal: grand,
        discountTotal: 0,
        shippingFee: 0,
        grandTotal: grand,
        status: 'SHIPPING',
      },
    });
    orderSeq += 1;

    const context: CorruptContext = {
      orderId: order.id,
      orderCode: order.code,
      partnerOrderIds: [],
      paymentId: 0,
      lotIds: [],
      quantities: plan.map((p) => p.quantity),
      preDamage: {
        balances: [],
        lots: [],
      },
    };

    for (let i = 0; i < plan.length; i += 1) {
      const { shipment, quantity } = plan[i];
      const partnerOrder = await prisma.partnerOrder.create({
        data: {
          code: t(`POKD-${order.id}-${i}`),
          orderId: order.id,
          partnerId: fixtures.partnerAId,
          subtotal: quantity * 25_000,
          discountTotal: 0,
          commissionAmount: quantity * 2_500,
          payableAmount: quantity * 22_500,
          status: 'SHIPPING',
        },
      });
      context.partnerOrderIds.push(partnerOrder.id);

      const orderItem = await prisma.orderItem.create({
        data: {
          partnerOrderId: partnerOrder.id,
          productVariantId: fixtures.variantAId,
          productNameSnapshot: `Kiểm định hàng ${RUN_ID}`,
          skuSnapshot: t('SKU-KD'),
          unitPriceSnapshot: 25_000,
          quantity,
          subtotal: quantity * 25_000,
          discountAmount: 0,
        },
      });

      // A dedicated lot + balance per item so scenarios never share cells and
      // the restore is provably scoped to its own allocations.
      const lot = await prisma.productLot.create({
        data: {
          code: t(`LOTKD-${order.id}-${i}`),
          productId: fixtures.productAId,
          harvestId: fixtures.harvestAId,
          quantity: quantity + 10,
          unit: 'kg',
          remainingQuantity: quantity + 10,
          grade: 'A',
          expiresAt: new Date(Date.now() + 2_000_000_000),
          status: 'SELLABLE',
          traceCode: t(`TRCKD-${order.id}-${i}`),
        },
      });
      context.lotIds.push(lot.id);
      const balance = await prisma.inventoryBalance.create({
        data: {
          warehouseId: fixtures.warehouseId,
          productLotId: lot.id,
          productVariantId: fixtures.variantAId,
          onHand: quantity + 50,
          reserved: quantity,
          blocked: 0,
          unit: 'kg',
        },
      });

      await prisma.inventoryAllocation.create({
        data: {
          orderItemId: orderItem.id,
          inventoryBalanceId: balance.id,
          productLotId: lot.id,
          quantity,
        },
      });

      if (shipment) {
        const delivered = shipment === 'DELIVERED';
        await prisma.shipment.create({
          data: {
            code: t(`SHPKD-${order.id}-${i}`),
            partnerOrderId: partnerOrder.id,
            carrier: 'Giao Hàng Nhanh',
            trackingCode: t(`GHNKD${order.id}${i}`),
            status: delivered ? 'DELIVERED' : 'IN_TRANSIT',
            shippedAt: new Date(Date.now() - 86_400_000),
            deliveredAt: delivered ? new Date(Date.now() - 3_600_000) : null,
          },
        });
      }
    }

    const payment = await prisma.payment.create({
      data: { orderId: order.id, method: 'COD', amount: grand, status: 'PENDING' },
    });
    context.paymentId = payment.id;

    // Pre-damage ledger numbers: what a never-corrupted in-flight order holds.
    context.preDamage = { balances: await balancesFor(order.id), lots: await lotsFor(order.id) };

    await damageLegacy(order.id);
    return context;
  }

  /** Replicates the legacy flip + consume, byte-for-byte. Read as: the bug. */
  async function damageLegacy(orderId: number): Promise<void> {
    const allocs = await prisma.inventoryAllocation.findMany({
      where: { orderItem: { partnerOrder: { orderId } } },
      include: {
        inventoryBalance: true,
        orderItem: { select: { partnerOrderId: true } },
      },
    });
    for (const alloc of allocs) {
      await prisma.partnerOrder.update({
        where: { id: alloc.orderItem.partnerOrderId },
        data: { status: 'DELIVERED' },
      });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', reservationExpiresAt: null },
    });
    for (const alloc of allocs) {
      const quantity = Number(alloc.quantity);
      const balance = alloc.inventoryBalance;
      const before = Number(balance.onHand);
      // Exactly `consumeStock`: one conditional UPDATE, guarded, both cells.
      await prisma.$executeRaw`
        UPDATE inventory_balances
           SET on_hand = on_hand - ${quantity},
               reserved = reserved - ${quantity},
               updated_at = UTC_TIMESTAMP(3)
         WHERE id = ${balance.id}
           AND reserved >= ${quantity}
           AND on_hand >= ${quantity}
      `;
      // Exactly the consume-side lot decrement from `consumeOrderStock`.
      await prisma.$executeRaw`
        UPDATE product_lots
           SET remaining_quantity = remaining_quantity - ${quantity},
               updated_at = UTC_TIMESTAMP(3)
         WHERE id = ${alloc.productLotId}
           AND remaining_quantity >= ${quantity}
      `;
      await prisma.inventoryMovement.create({
        data: {
          warehouseId: balance.warehouseId,
          productLotId: balance.productLotId,
          productVariantId: balance.productVariantId,
          type: 'OUTBOUND',
          quantityDelta: -quantity,
          beforeQuantity: before,
          afterQuantity: before - quantity,
          referenceType: 'Order',
          referenceId: orderId,
          note: 'Legacy forced delivery (audit scenario)',
        },
      });
    }
  }

  beforeAll(async () => {
    expect(TEST_URL).toBeDefined();
    process.env.DATABASE_URL = TEST_URL as string;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
    adminToken = await login(app, `${RUN_ID}-admin@agrimarket.vn`, E2E_ADMIN_PASSWORD);
    service = app.get(OrderDeliveryReconciliationService);

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: `${RUN_ID}-admin@agrimarket.vn` },
      select: { id: true },
    });
    adminId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await cleanupFixtures(prisma, fixtures);
    await app.close();
    await prisma.$disconnect();
  }, 60_000);

  it('1. reverts, restores the ledger exactly once, keeps COD PENDING; second run is a no-op (idempotency)', async () => {
    const ctx = await buildLegacyDamagedOrder([
      { shipment: 'TRANSIT', quantity: 2 },
      { shipment: 'TRANSIT', quantity: 2 },
    ]);
    const { orderId, partnerOrderIds, preDamage } = ctx;

    // A settlement claim over the first partner order, exactly the shape the
    // dev DB has for order 3 (SET-0001 claims its P02). The repair must NOT
    // touch it: money rows are finance-owned and this payout is PENDING.
    const settlement = await prisma.settlement.create({
      data: {
        code: `${RUN_ID}-SETKD`,
        partnerId: fixtures.partnerAId,
        periodStart: new Date(Date.now() - 2_592_000_000),
        periodEnd: new Date(),
        grossAmount: 50_000,
        refundAmount: 0,
        commissionAmount: 2_500,
        adjustmentAmount: 0,
        payableAmount: 47_500,
        status: 'DRAFT',
        lines: {
          create: [
            {
              partnerOrderId: partnerOrderIds[0],
              grossAmount: 50_000,
              refundAmount: 0,
              commissionAmount: 2_500,
              payableAmount: 47_500,
            },
          ],
        },
      },
    });
    await prisma.payout.create({
      data: {
        code: `${RUN_ID}-PAYKD`,
        settlementId: settlement.id,
        partnerId: fixtures.partnerAId,
        amount: 47_500,
        status: 'PENDING',
        requestedAt: new Date(),
      },
    });

    const before = await snapshot(orderId);
    expect(before.orderStatus).toBe('DELIVERED');
    expect(before.poStatuses.every((p) => p.status === 'DELIVERED')).toBe(true);
    expect(before.shipments.map((s) => s.status)).toEqual(['IN_TRANSIT', 'IN_TRANSIT']);
    expect(before.outboundCount).toBe(2);
    expect(before.adjustments).toHaveLength(0);
    expect(before.reversalCount).toBe(0);

    const res = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: false,
    }).expect(201);
    expect(res.body).toMatchObject({
      action: 'REVERTED',
      previousStatus: 'DELIVERED',
      nextStatus: 'SHIPPING',
      restoredUnits: 4,
      orderCode: ctx.orderCode,
    });
    expect(res.body.partnerOrders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: partnerOrderIds[0], nextStatus: 'SHIPPING' }),
        expect.objectContaining({ id: partnerOrderIds[1], nextStatus: 'SHIPPING' }),
      ]),
    );
    expect(res.body.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('chưa có vận đơn giao thành công'),
        expect.stringContaining('còn vận đơn đang xử lý'),
      ]),
    );
    expect(res.body.problems).toHaveLength(4);

    const after = await snapshot(orderId);
    // Statuses roll back to the evidence-backed value...
    expect(after.orderStatus).toBe('SHIPPING');
    expect(after.poStatuses.every((p) => p.status === 'SHIPPING')).toBe(true);
    // parcels untouched (they keep their own lifecycle):
    expect(after.shipments).toEqual(before.shipments);
    expect(after.shipments.map((s) => s.status)).toEqual(['IN_TRANSIT', 'IN_TRANSIT']);
    expect(after.shipments.every((s) => s.deliveredAt === null)).toBe(true);
    // reservation live again, deadline cleared so the sweep never resurrects it:
    expect(after.reservationExpiresAt).toBeNull();
    // ...the ledger is the exact inverse of the legacy consume: every cell
    // sits back on its pre-damage value (a double-restore would exceed it):
    expect(after.balances).toEqual(preDamage.balances);
    expect(after.balances.every((b) => b.blocked === 0)).toBe(true);
    expect(after.lots).toEqual(preDamage.lots);
    // history kept, one compensating ADJUSTMENT per allocation:
    expect(after.outboundCount).toBe(2);
    expect(after.outboundBefore).toEqual(preDamage.balances.map((b) => b.onHand));
    expect(after.adjustments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: 2, before: preDamage.balances[0].onHand - 2, after: preDamage.balances[0].onHand }),
        expect.objectContaining({ delta: 2, before: preDamage.balances[1].onHand - 2, after: preDamage.balances[1].onHand }),
      ]),
    );
    // quarantine is NOT the correct bucket: goods are "in transit reserved",
    // sellability is handled by `reserved` exactly like every other order.
    expect(after.quarantineCount).toBe(0);
    // exactly one reversal audit row, actor recorded, before/after JSON saved:
    expect(after.reversalCount).toBe(1);
    expect(after.reversal).toMatchObject({ actorUserId: adminId });
    expect(after.reversal?.beforeJson).toEqual({ status: 'DELIVERED' });
    expect(after.reversal?.afterJson).toMatchObject({ status: 'SHIPPING', restoredUnits: 4 });
    expect(after.reversal?.reason).toBeTruthy();
    // money rows are NEVER touched:
    expect(after.payment).toEqual({ status: 'PENDING', paidAt: null, method: 'COD' });
    const payoutRow = await prisma.payout.findUniqueOrThrow({ where: { code: `${RUN_ID}-PAYKD` } });
    expect(payoutRow.status).toBe('PENDING');
    const lineRow = await prisma.settlementLine.findUniqueOrThrow({
      where: { partnerOrderId: partnerOrderIds[0] },
    });
    expect(lineRow.payableAmount.toString()).toBe('47500');

    // Second run: the CAS can never claim again — NOT_APPLICABLE, no writes.
    const again = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: false,
    }).expect(201);
    expect(again.body).toMatchObject({
      action: 'NOT_APPLICABLE',
      restoredUnits: 0,
    });
    const second = await snapshot(orderId);
    expect(second.orderStatus).toBe('SHIPPING');
    expect(second.adjustments).toHaveLength(2); // no extra movements
    expect(second.balances).toEqual(preDamage.balances);
    expect(second.reversalCount).toBe(1); // no extra audit rows
  }, 45_000);

  it('2. HTTP contract: missing/null/true dryRun stay read-only; explicit false reverts the no-parcel shape to READY_TO_SHIP; the monitor list follows', async () => {
    const ctx = await buildLegacyDamagedOrder([{ shipment: null, quantity: 5 }]);
    const { orderId, preDamage } = ctx;

    // The monitoring list flags it with the would-be decision.
    const list = await get('/api/v1/orders/delivery-reconciliation').expect(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find(
      (r) => r.orderId === orderId,
    );
    expect(row).toMatchObject({
      action: 'SKIPPED',
      previousStatus: 'DELIVERED',
      nextStatus: 'READY_TO_SHIP',
      restoredUnits: 0,
    });
    expect(row?.note).toBeTruthy();

    const readOnly = await snapshot(orderId);
    expect(readOnly.orderStatus).toBe('DELIVERED');
    expect(readOnly.adjustments).toHaveLength(0);

    // `dryRun: null` (which @IsOptional lets through) must NOT flip into the
    // repair path: the controller treats anything but explicit `false` as a
    // dry run — fail closed.
    const asNull = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: null,
    }).expect(201);
    expect(asNull.body).toMatchObject({ action: 'SKIPPED', nextStatus: 'READY_TO_SHIP' });

    const asTrue = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: true,
    }).expect(201);
    expect(asTrue.body.action).toBe('SKIPPED');

    const asMissing = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
    }).expect(201);
    expect(asMissing.body.action).toBe('SKIPPED');

    const stillUntouched = await snapshot(orderId);
    expect(stillUntouched).toEqual(readOnly);

    // Explicit false: the order-6 shape (no parcel ever existed) becomes
    // READY_TO_SHIP and the stock comes back.
    const repaired = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: false,
    }).expect(201);
    expect(repaired.body).toMatchObject({
      action: 'REVERTED',
      nextStatus: 'READY_TO_SHIP',
      restoredUnits: 5,
    });

    const after = await snapshot(orderId);
    expect(after.orderStatus).toBe('READY_TO_SHIP');
    expect(after.poStatuses.every((p) => p.status === 'READY_TO_SHIP')).toBe(true);
    expect(after.balances).toEqual(preDamage.balances);
    expect(after.lots).toEqual(preDamage.lots);
    expect(after.adjustments).toEqual([
      expect.objectContaining({ delta: 5, after: preDamage.balances[0].onHand }),
    ]);
    expect(after.reversalCount).toBe(1);
    expect(after.payment).toEqual({ status: 'PENDING', paidAt: null, method: 'COD' });

    // Once repaired the row disappears from the monitoring list.
    const listAfter = await get('/api/v1/orders/delivery-reconciliation').expect(200);
    expect(
      (listAfter.body.data as Array<Record<string, unknown>>).some((r) => r.orderId === orderId),
    ).toBe(false);
  }, 45_000);

  it('3. atomicity: a saturated lot cap refuses the restore and the whole transaction rolls back (no status, no balance, no movement, no audit row)', async () => {
    const ctx = await buildLegacyDamagedOrder([{ shipment: 'TRANSIT', quantity: 2 }]);
    const { orderId, lotIds, preDamage, quantities } = ctx;

    // Fill the lot back to its cap: the restore adds +quantity and the guard
    // (`remaining + q <= quantity`) rejects — after the order CAS already ran.
    await prisma.$executeRaw`
      UPDATE product_lots SET remaining_quantity = quantity WHERE id = ${lotIds[0]}
    `;

    const res = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: false,
    }).expect(409);
    expect(String(res.body.message)).toMatch(/cannot hold/);

    const after = await snapshot(orderId);
    expect(after.orderStatus).toBe('DELIVERED');
    expect(after.poStatuses.every((p) => p.status === 'DELIVERED')).toBe(true);
    expect(after.outboundCount).toBe(1);
    expect(after.outboundBefore).toEqual([preDamage.balances[0].onHand]);
    expect(after.adjustments).toHaveLength(0);
    expect(after.reversalCount).toBe(0);
    expect(after.quarantineCount).toBe(0);
    expect(after.payment).toEqual({ status: 'PENDING', paidAt: null, method: 'COD' });
    // balances remain EXACTLY at the damaged values — nothing half-restored:
    expect(after.balances.map((b) => ({ id: b.id, onHand: b.onHand, reserved: b.reserved }))).toEqual(
      preDamage.balances.map((b) => ({ id: b.id, onHand: b.onHand - quantities[0], reserved: b.reserved - quantities[0] })),
    );
  }, 45_000);

  it('4. a partner order with a REAL delivery is UNREPAIRABLE and nothing changes', async () => {
    const ctx = await buildLegacyDamagedOrder([
      { shipment: 'DELIVERED', quantity: 1 },
      { shipment: 'TRANSIT', quantity: 2 },
    ]);
    const { orderId, preDamage, quantities } = ctx;

    const res = await post('/api/v1/orders/delivery-reconciliation', {
      orderId,
      dryRun: false,
    }).expect(201);
    expect(res.body).toMatchObject({
      action: 'UNREPAIRABLE',
      previousStatus: 'DELIVERED',
      nextStatus: null,
      restoredUnits: 0,
      note: expect.stringContaining('vận đơn giao thành công thật'),
    });

    const after = await snapshot(orderId);
    expect(after.orderStatus).toBe('DELIVERED');
    expect(after.poStatuses.every((p) => p.status === 'DELIVERED')).toBe(true);
    expect(after.adjustments).toHaveLength(0);
    expect(after.reversalCount).toBe(0);
    expect(after.outboundCount).toBe(2);
    expect(
      after.balances.map((b) => ({ id: b.id, onHand: b.onHand, reserved: b.reserved })),
    ).toEqual(
      preDamage.balances.map((b, i) => ({
        id: b.id,
        onHand: b.onHand - quantities[i],
        reserved: b.reserved - quantities[i],
      })),
    );
    expect(after.payment).toEqual({ status: 'PENDING', paidAt: null, method: 'COD' });
  }, 45_000);

  it('5. two concurrent repairs race the same order: exactly one reverts, the ledger is restored exactly once (no double-count)', async () => {
    const ctx = await buildLegacyDamagedOrder([
      { shipment: 'TRANSIT', quantity: 2 },
      { shipment: 'TRANSIT', quantity: 3 },
    ]);
    const { orderId, preDamage } = ctx;

    const attempt = () =>
      service
        .reconcileOrder(orderId, { dryRun: false, actorUserId: adminId })
        .then(
          (decision) => ({ ok: true as const, decision }),
          (error: unknown) => ({
            ok: false as const,
            message: (error as { message?: string })?.message ?? String(error),
          }),
        );

    const [a, b] = await Promise.all([attempt(), attempt()]);

    const reverted = [a, b].filter((x) => x.ok && x.decision.action === 'REVERTED');
    expect(reverted).toHaveLength(1);
    const other = [a, b].find((x) => x !== reverted[0]);
    expect(other).toBeDefined();
    if (other?.ok) {
      expect(other.decision.action).toBe('NOT_APPLICABLE');
    } else {
      // A serialised CAS miss surfaces as a reload request, never a corrupt row.
      expect(other && !other.ok ? other.message : '').toMatch(/changed|processing|Conflict/i);
    }

    const after = await snapshot(orderId);
    expect(after.orderStatus).toBe('SHIPPING');
    expect(after.poStatuses.every((p) => p.status === 'SHIPPING')).toBe(true);
    // Every cell lands exactly on its pre-damage value: restored once, and
    // never twice (a double restore would exceed preDamage by +2 / +3).
    expect(after.balances.map((b) => ({ id: b.id, onHand: b.onHand, reserved: b.reserved }))).toEqual(
      preDamage.balances.map((b) => ({ id: b.id, onHand: b.onHand, reserved: b.reserved })),
    );
    expect(after.lots).toEqual(preDamage.lots);
    expect(after.outboundCount).toBe(2);
    expect(after.outboundBefore).toEqual([
      preDamage.balances[0].onHand,
      preDamage.balances[1].onHand,
    ]);
    // one compensating ADJUSTMENT per allocation, deltas matching quantities:
    expect(after.adjustments.map((m) => m.delta).sort((x, y) => x - y)).toEqual([2, 3]);
    expect(after.reversalCount).toBe(1);
    expect(after.payment).toEqual({ status: 'PENDING', paidAt: null, method: 'COD' });
  }, 45_000);
});
