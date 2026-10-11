import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { CommissionService } from '../src/finance/commission.service.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { WarehouseDocumentsService } from '../src/inventory/warehouse-documents.service.js';
import {
  cleanupConcurrencyWorld,
  createConcurrencyPrisma,
  createConcurrencyWorld,
  makeConcurrencyRunId,
  purgeStaleConcurrencyFixtures,
  type ConcurrencyWorld,
} from './helpers/concurrency-fixtures.js';

/**
 * Concurrency & race-condition acceptance suite.
 *
 * These scenarios used to live in throwaway `scratch-*.mts` harnesses. They are
 * promoted here so the concurrency guarantees are enforced by the official test
 * suite, not by a manual script: they drive the REAL service methods against the
 * REAL MySQL `TEST_DATABASE_URL` and assert the invariants directly in the
 * database (order rows, allocations, `on_hand`, `reserved`, `blocked`, voucher
 * redemptions, flash `sold_quantity`, payments).
 *
 * The suite is skipped entirely when `TEST_DATABASE_URL` is not configured, and
 * every row it creates is tagged with a `cc…` run prefix and removed in
 * `afterAll`, so the demo seed and the dev database are never touched.
 *
 * Rounds default to 5 (enough to expose a lost race reliably while keeping the
 * suite fast) and can be raised with `CONCURRENCY_ROUNDS`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 5);
const RUN_ID = makeConcurrencyRunId();

describe.skipIf(!hasTestDb)('AgriMarket API — concurrency acceptance (e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;
  let orders: OrdersService;
  let docs: WarehouseDocumentsService;
  let inventory: InventoryService;
  let promotions: PromotionsService;

  const address = { recipientName: 'K', phone: '0900000000', province: 'Hưng Yên', detail: 'x' };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createConcurrencyPrisma(TEST_URL as string);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);

    const audit = { record: async () => undefined };
    inventory = new InventoryService(prisma as never, audit as never);
    promotions = new PromotionsService(prisma as never);
    const commission = new CommissionService(prisma as never);
    orders = new OrdersService(
      prisma as never,
      inventory,
      promotions,
      commission,
      audit as never,
      new LocationsService(prisma as never),
    );
    docs = new WarehouseDocumentsService(prisma as never, inventory, audit as never);
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

  const co = (
    customerId: number,
    variantId: number,
    quantity: number,
    extra: Record<string, unknown> = {},
  ) =>
    orders.checkout(customerId, {
      shippingAddress: address,
      items: [{ productVariantId: variantId, quantity }],
      ...extra,
    } as never);

  it('never oversells: 10 concurrent buyers, 1 unit', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(1, `INV${r}`);
      const custs = await world.customers(10);
      const res = await Promise.allSettled(custs.map((cid) => co(cid, b.variantId, 1)));
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      const allocSum = (
        await prisma.inventoryAllocation.findMany({ where: { inventoryBalanceId: b.balanceId } })
      ).reduce((s, a) => s + Number(a.quantity), 0);
      const dbOrders = await prisma.order.count({ where: { customerId: { in: custs } } });

      expect(ok).toBe(1);
      expect(dbOrders).toBe(1);
      expect(Number(bal.reserved)).toBe(1);
      expect(allocSum).toBe(1);
      expect(Number(bal.reserved)).toBeLessThanOrEqual(Number(bal.onHand));
    }
  });

  it('never loses a reservation: 10 concurrent buyers, 5 units', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(5, `INV5${r}`);
      const custs = await world.customers(10);
      await Promise.allSettled(custs.map((cid) => co(cid, b.variantId, 1)));
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      const allocSum = (
        await prisma.inventoryAllocation.findMany({ where: { inventoryBalanceId: b.balanceId } })
      ).reduce((s, a) => s + Number(a.quantity), 0);

      expect(Number(bal.reserved)).toBe(5);
      expect(allocSum).toBe(5);
      expect(Number(bal.reserved)).toBeLessThanOrEqual(Number(bal.onHand));
    }
  });

  it('flash sale quota: 2 concurrent checkouts, quota=1, exactly 1 sold', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FQ${r}`);
      const cs = await world.customers(2);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSQ${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 1,
          perCustomerLimit: 99,
        },
      });
      const res = await Promise.allSettled([co(cs[0], b.variantId, 1), co(cs[1], b.variantId, 1)]);
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });

      expect(ok).toBe(1);
      expect(after.soldQuantity).toBe(1);
      expect(after.soldQuantity).toBeLessThanOrEqual(after.quota);
    }
  });

  it('flash per-customer limit: 2 concurrent orders, same customer, limit=1', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FC${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSC${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 100,
          perCustomerLimit: 1,
        },
      });
      const res = await Promise.allSettled([co(cid, b.variantId, 1), co(cid, b.variantId, 1)]);
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const items = await prisma.orderItem.aggregate({
        where: { productVariantId: b.variantId, partnerOrder: { order: { customerId: cid } } },
        _sum: { quantity: true },
      });

      expect(ok).toBe(1);
      expect(Number(items._sum.quantity ?? 0)).toBe(1);
    }
  });

  it('flash per-customer limit: sequential purchases respect the limit (2 ok, 3rd rejected)', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FS${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSS${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 100,
          perCustomerLimit: 2,
        },
      });
      const results: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        try {
          await co(cid, b.variantId, 1);
          results.push('ok');
        } catch {
          results.push('rejected');
        }
      }
      const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });

      expect(results).toEqual(['ok', 'ok', 'rejected']);
      expect(after.soldQuantity).toBe(2);
    }
  });

  it('overlapping flash sales with different prices: price and quota come from the same item', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FOV${r}`);
      const [cid] = await world.customers(1);
      const window = { startsAt: new Date(Date.now() - 36e5), endsAt: new Date(Date.now() + 36e5) };
      // Two sales cover the SAME variant at the SAME time but different prices.
      const saleA = await prisma.flashSale.create({
        data: { name: world.t(`FOVA${r}`), ...window, status: 'ACTIVE' },
      });
      const itemA = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: saleA.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });
      const saleB = await prisma.flashSale.create({
        data: { name: world.t(`FOVB${r}`), ...window, status: 'ACTIVE' },
      });
      const itemB = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: saleB.id,
          productVariantId: b.variantId,
          flashPrice: 8000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });

      await co(cid, b.variantId, 1);

      const orderItem = await prisma.orderItem.findFirstOrThrow({
        where: { productVariantId: b.variantId, partnerOrder: { order: { customerId: cid } } },
      });
      const afterA = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: itemA.id } });
      const afterB = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: itemB.id } });

      // The cheapest price was charged AND attributed to that exact item.
      expect(Number(orderItem.unitPriceSnapshot)).toBe(8000);
      expect(orderItem.flashSaleItemId).toBe(itemB.id);
      // Quota was consumed from item B only — item A is untouched.
      expect(afterB.soldQuantity).toBe(1);
      expect(afterA.soldQuantity).toBe(0);
    }
  });

  it('flash quota exhaustion: quota=1, second checkout is rejected and nothing oversells', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FQE${r}`);
      const cs = await world.customers(2);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FQEX${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 1,
          perCustomerLimit: 99,
        },
      });

      const first = await co(cs[0], b.variantId, 1);
      expect(Number(first.grandTotal)).toBe(10000 + 20000); // flash price + flat shipping
      await expect(co(cs[1], b.variantId, 1)).rejects.toThrow(/quota exceeded/);

      const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
      const orders = await prisma.order.count({ where: { customerId: { in: cs } } });
      expect(after.soldQuantity).toBe(1);
      expect(orders).toBe(1);
    }
  });

  it('a flash price that is not below the base price is not applied and consumes no quota', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FNH${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FNHI${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      // flashPrice == basePrice (30000): not a discount, so must be ignored.
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 30000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });

      const order = await co(cid, b.variantId, 2);
      const orderItem = await prisma.orderItem.findFirstOrThrow({
        where: { productVariantId: b.variantId, partnerOrder: { order: { customerId: cid } } },
      });
      const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });

      expect(Number(orderItem.unitPriceSnapshot)).toBe(30000);
      expect(orderItem.flashSaleItemId).toBeNull();
      expect(after.soldQuantity).toBe(0);
      expect(Number(order.grandTotal)).toBe(2 * 30000 + 20000);
    }
  });

  it('two flash sales sharing a price are independent per-customer programs', async () => {
    // The per-customer limit is counted per flash-sale *item*, not per price:
    // buying the same variant at the same price in two different sales must not
    // be conflated. Under the old price-match heuristic the second purchase
    // would have been wrongly counted against the first sale's limit.
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FSP${r}`);
      const [cid] = await world.customers(1);
      const window = { startsAt: new Date(Date.now() - 36e5), endsAt: new Date(Date.now() + 36e5) };
      const saleA = await prisma.flashSale.create({
        data: { name: world.t(`FSPA${r}`), ...window, status: 'ACTIVE' },
      });
      const itemA = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: saleA.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 1,
        },
      });
      const saleB = await prisma.flashSale.create({
        data: { name: world.t(`FSPB${r}`), ...window, status: 'ACTIVE' },
      });
      const itemB = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: saleB.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 1,
        },
      });

      // Both purchases succeed: one unit against each independent program.
      await co(cid, b.variantId, 1);
      await co(cid, b.variantId, 1);

      const afterA = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: itemA.id } });
      const afterB = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: itemB.id } });
      const items = await prisma.orderItem.findMany({
        where: { productVariantId: b.variantId, partnerOrder: { order: { customerId: cid } } },
        select: { flashSaleItemId: true },
      });

      expect(items.map((i) => i.flashSaleItemId).sort()).toEqual([itemA.id, itemB.id].sort());
      expect(afterA.soldQuantity).toBe(1);
      expect(afterB.soldQuantity).toBe(1);
    }
  });

  it('voucher usageLimit: 2 concurrent checkouts, limit=1', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `VU${r}`);
      const cs = await world.customers(2);
      const voucher = await prisma.voucher.create({
        data: {
          code: world.t(`VU${r}`),
          name: 'v',
          discountType: 'FIXED',
          discountValue: 1000,
          minOrderAmount: 0,
          usageLimit: 1,
          perCustomerLimit: 1,
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const res = await Promise.allSettled([
        co(cs[0], b.variantId, 1, { voucherCode: voucher.code }),
        co(cs[1], b.variantId, 1, { voucherCode: voucher.code }),
      ]);
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const after = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
      const redemptions = await prisma.voucherRedemption.count({ where: { voucherId: voucher.id } });

      expect(ok).toBe(1);
      expect(after.usedCount).toBe(1);
      expect(redemptions).toBe(1);
    }
  });

  it('voucher claim rolls back when the checkout fails afterwards', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(1, `VR${r}`);
      const [cid] = await world.customers(1);
      const voucher = await prisma.voucher.create({
        data: {
          code: world.t(`VR${r}`),
          name: 'v',
          discountType: 'FIXED',
          discountValue: 1000,
          minOrderAmount: 0,
          usageLimit: 5,
          perCustomerLimit: 5,
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      // Ask for 3 units when only 1 exists: the voucher is claimed first, then
      // the reservation fails, so the whole transaction must roll back.
      await expect(co(cid, b.variantId, 3, { voucherCode: voucher.code })).rejects.toThrow();
      const after = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
      const redemptions = await prisma.voucherRedemption.count({ where: { voucherId: voucher.id } });
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });

      expect(after.usedCount).toBe(0);
      expect(redemptions).toBe(0);
      expect(Number(bal.reserved)).toBe(0);
    }
  });

  it('double cancel releases exactly once and leaves other reservations intact', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `CA${r}`);
      const [cid] = await world.customers(1);
      const order = await prisma.order.create({
        data: {
          code: world.t(`OC${r}`),
          customerId: cid,
          shippingAddressSnapshot: address,
          subtotal: 30000,
          discountTotal: 0,
          shippingFee: 0,
          grandTotal: 30000,
          status: 'PENDING_CONFIRMATION',
        },
      });
      const po = await prisma.partnerOrder.create({
        data: {
          code: world.t(`POC${r}`),
          orderId: order.id,
          partnerId: b.partnerId,
          subtotal: 30000,
          discountTotal: 0,
          commissionAmount: 0,
          payableAmount: 30000,
          status: 'PENDING_CONFIRMATION',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          partnerOrderId: po.id,
          productVariantId: b.variantId,
          productNameSnapshot: 'p',
          skuSnapshot: 's',
          unitPriceSnapshot: 30000,
          quantity: 3,
          subtotal: 90000,
          discountAmount: 0,
        },
      });
      // Another live order holds 2 of the 5 reserved units on the same balance.
      await prisma.inventoryBalance.update({
        where: { id: b.balanceId },
        data: { reserved: 5 },
      });
      await prisma.inventoryAllocation.create({
        data: {
          orderItemId: item.id,
          inventoryBalanceId: b.balanceId,
          productLotId: b.lotId,
          quantity: 3,
        },
      });

      const res = await Promise.allSettled([
        orders.cancelForCustomer(order.id, cid, cid),
        orders.cancelForCustomer(order.id, cid, cid),
      ]);
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      const movements = await prisma.inventoryMovement.count({
        where: { referenceType: 'OrderCancel', referenceId: order.id },
      });
      const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

      expect(ok).toBe(1);
      expect(Number(bal.reserved)).toBe(2);
      expect(movements).toBe(1);
      expect(final.status).toBe('CANCELLED');
    }
  });

  it('cancel vs deliver: exactly one wins and the state stays consistent', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `CD${r}`);
      const [cid] = await world.customers(1);
      const adminId = await world.admin(`cd${r}`);
      const order = await prisma.order.create({
        data: {
          code: world.t(`OD${r}`),
          customerId: cid,
          shippingAddressSnapshot: address,
          subtotal: 30000,
          discountTotal: 0,
          shippingFee: 0,
          grandTotal: 30000,
          status: 'SHIPPING',
        },
      });
      const po = await prisma.partnerOrder.create({
        data: {
          code: world.t(`POD${r}`),
          orderId: order.id,
          partnerId: b.partnerId,
          subtotal: 30000,
          discountTotal: 0,
          commissionAmount: 0,
          payableAmount: 30000,
          status: 'SHIPPING',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          partnerOrderId: po.id,
          productVariantId: b.variantId,
          productNameSnapshot: 'p',
          skuSnapshot: 's',
          unitPriceSnapshot: 30000,
          quantity: 3,
          subtotal: 90000,
          discountAmount: 0,
        },
      });
      await prisma.inventoryBalance.update({
        where: { id: b.balanceId },
        data: { reserved: 3 },
      });
      await prisma.inventoryAllocation.create({
        data: {
          orderItemId: item.id,
          inventoryBalanceId: b.balanceId,
          productLotId: b.lotId,
          quantity: 3,
        },
      });
      await prisma.payment.create({
        data: { orderId: order.id, method: 'COD', amount: 30000, status: 'PENDING' },
      });

      await Promise.allSettled([
        orders.updateStatus(order.id, 'DELIVERED' as never, adminId),
        orders.cancelForCustomer(order.id, cid, cid),
      ]);
      const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      const released = await prisma.inventoryMovement.count({
        where: { referenceType: 'OrderCancel', referenceId: order.id, type: 'RELEASE' },
      });

      // Exactly one outcome must hold, and it must be internally consistent.
      if (final.status === 'DELIVERED') {
        // Delivery consumes the reservation: on_hand 10 -> 7, reserved 3 -> 0,
        // and an OUTBOUND movement records the goods leaving the warehouse.
        expect(Number(bal.reserved)).toBe(0);
        expect(Number(bal.onHand)).toBe(7);
        expect(released).toBe(0);
        // Delivery never settles COD by itself: cash is confirmed separately.
        expect(payment.status).toBe('PENDING');
        const outbound = await prisma.inventoryMovement.count({
          where: { referenceType: 'Order', referenceId: order.id, type: 'OUTBOUND' },
        });
        expect(outbound).toBe(1);
      } else {
        expect(final.status).toBe('CANCELLED');
        expect(Number(bal.reserved)).toBe(0);
        expect(Number(bal.onHand)).toBe(10);
        expect(released).toBe(1);
      }
    }
  });

  it('cancelling a SHIPPING order quarantines stock instead of re-selling it', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `CQ${r}`);
      const [cid] = await world.customers(1);
      const order = await prisma.order.create({
        data: {
          code: world.t(`OQ${r}`),
          customerId: cid,
          shippingAddressSnapshot: address,
          subtotal: 30000,
          discountTotal: 0,
          shippingFee: 0,
          grandTotal: 30000,
          status: 'SHIPPING',
        },
      });
      const po = await prisma.partnerOrder.create({
        data: {
          code: world.t(`POQ${r}`),
          orderId: order.id,
          partnerId: b.partnerId,
          subtotal: 30000,
          discountTotal: 0,
          commissionAmount: 0,
          payableAmount: 30000,
          status: 'SHIPPING',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          partnerOrderId: po.id,
          productVariantId: b.variantId,
          productNameSnapshot: 'p',
          skuSnapshot: 's',
          unitPriceSnapshot: 30000,
          quantity: 4,
          subtotal: 120000,
          discountAmount: 0,
        },
      });
      await prisma.inventoryBalance.update({
        where: { id: b.balanceId },
        data: { reserved: 4 },
      });
      await prisma.inventoryAllocation.create({
        data: {
          orderItemId: item.id,
          inventoryBalanceId: b.balanceId,
          productLotId: b.lotId,
          quantity: 4,
        },
      });

      const cancelled = await orders.cancelForCustomer(order.id, cid, cid);
      expect(cancelled.status).toBe('CANCELLED');

      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      // The units moved from reserved to blocked: available is unchanged (10-4-0
      // before, 10-0-4 after), so they are never offered for resale again.
      expect(Number(bal.reserved)).toBe(0);
      expect(Number(bal.blocked)).toBe(4);
      const quarantineMoves = await prisma.inventoryMovement.count({
        where: { referenceType: 'OrderCancel', referenceId: order.id, type: 'QUARANTINE' },
      });
      const releaseMoves = await prisma.inventoryMovement.count({
        where: { referenceType: 'OrderCancel', referenceId: order.id, type: 'RELEASE' },
      });
      expect(quarantineMoves).toBe(1);
      expect(releaseMoves).toBe(0);
    }
  });

  it('quarantineStock refuses a move larger than the reserved quantity (no invented blocked stock)', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `QR${r}`);
      // Only 2 units are reserved, but a caller asks to quarantine 5.
      await prisma.inventoryBalance.update({
        where: { id: b.balanceId },
        data: { reserved: 2 },
      });

      const moved = await prisma.$transaction((tx) =>
        inventory.quarantineStock(tx, b.balanceId, 5),
      );

      // The guard (`reserved >= quantity`) matches 0 rows, so the move is
      // refused and the balance is untouched — no blocked stock is fabricated.
      expect(moved).toBeNull();
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      expect(Number(bal.reserved)).toBe(2);
      expect(Number(bal.blocked)).toBe(0);
    }
  });

  it('quarantineStock moves exactly the reserved quantity when it is sufficient', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `QK${r}`);
      await prisma.inventoryBalance.update({
        where: { id: b.balanceId },
        data: { reserved: 4, blocked: 1 },
      });

      const moved = await prisma.$transaction((tx) =>
        inventory.quarantineStock(tx, b.balanceId, 4),
      );

      expect(moved).not.toBeNull();
      expect(moved?.before).toBe(4);
      expect(moved?.after).toBe(0);
      expect(moved?.blocked).toBe(5);
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      // available unchanged: 10-4-1 == 10-0-5.
      expect(Number(bal.reserved)).toBe(0);
      expect(Number(bal.blocked)).toBe(5);
    }
  });

  it('two concurrent quarantineStock calls cannot both claim the same reserved units', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `QC${r}`);
      // Exactly one unit is reserved; two callers each want to quarantine 1.
      await prisma.inventoryBalance.update({
        where: { id: b.balanceId },
        data: { reserved: 1 },
      });

      const [a, c] = await Promise.all([
        prisma.$transaction((tx) => inventory.quarantineStock(tx, b.balanceId, 1)),
        prisma.$transaction((tx) => inventory.quarantineStock(tx, b.balanceId, 1)),
      ]);

      // The guarded UPDATE serialises on the row lock: exactly one succeeds.
      const winners = [a, c].filter((x) => x !== null).length;
      expect(winners).toBe(1);
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      expect(Number(bal.reserved)).toBe(0);
      expect(Number(bal.blocked)).toBe(1);
    }
  });

  it('cancelling a SHIPPING order whose reservation was already taken fails atomically', async () => {
    // A concurrent writer (e.g. another release) has already emptied the
    // reservation the order's allocation points at. The quarantine guard must
    // reject the move and the whole cancellation must roll back — the order is
    // NOT cancelled and no blocked stock is invented.
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `QF${r}`);
      const [cid] = await world.customers(1);
      const order = await prisma.order.create({
        data: {
          code: world.t(`OF${r}`),
          customerId: cid,
          shippingAddressSnapshot: address,
          subtotal: 30000,
          discountTotal: 0,
          shippingFee: 0,
          grandTotal: 30000,
          status: 'SHIPPING',
        },
      });
      const po = await prisma.partnerOrder.create({
        data: {
          code: world.t(`POF${r}`),
          orderId: order.id,
          partnerId: b.partnerId,
          subtotal: 30000,
          discountTotal: 0,
          commissionAmount: 0,
          payableAmount: 30000,
          status: 'SHIPPING',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          partnerOrderId: po.id,
          productVariantId: b.variantId,
          productNameSnapshot: 'p',
          skuSnapshot: 's',
          unitPriceSnapshot: 30000,
          quantity: 3,
          subtotal: 90000,
          discountAmount: 0,
        },
      });
      await prisma.inventoryAllocation.create({
        data: {
          orderItemId: item.id,
          inventoryBalanceId: b.balanceId,
          productLotId: b.lotId,
          quantity: 3,
        },
      });
      // The balance shows NO reservation: the allocation and the balance disagree.
      // (reserved defaults to 0.)

      await expect(orders.cancelForCustomer(order.id, cid, cid)).rejects.toThrow(
        /stock changed/,
      );

      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const moves = await prisma.inventoryMovement.count({
        where: { referenceType: 'OrderCancel', referenceId: order.id },
      });
      expect(Number(bal.reserved)).toBe(0);
      expect(Number(bal.blocked)).toBe(0);
      expect(moves).toBe(0);
      // The cancellation was rolled back, so the order is still SHIPPING.
      expect(final.status).toBe('SHIPPING');
    }
  });

  it('double complete of one INBOUND document applies stock exactly once', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(0, `WD${r}`);
      const adminId = await world.admin(`wd${r}`);
      const doc = await prisma.warehouseDocument.create({
        data: {
          code: world.t(`DOC${r}`),
          warehouseId: b.warehouseId,
          type: 'INBOUND',
          status: 'DRAFT',
          createdByUserId: adminId,
          lines: {
            create: [{ productLotId: b.lotId, productVariantId: b.variantId, quantity: 7, unit: 'kg' }],
          },
        },
      });
      const res = await Promise.allSettled([docs.complete(doc.id, adminId), docs.complete(doc.id, adminId)]);
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      const final = await prisma.warehouseDocument.findUniqueOrThrow({ where: { id: doc.id } });

      expect(ok).toBe(1);
      expect(Number(bal.onHand)).toBe(7);
      expect(final.status).toBe('COMPLETED');
    }
  });

  it('12 concurrent checkouts produce 12 distinct order codes', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(100, `CODE${r}`);
      const custs = await world.customers(12);
      const res = await Promise.allSettled(custs.map((cid) => co(cid, b.variantId, 1)));
      const codes = res.flatMap((x) => (x.status === 'fulfilled' ? [x.value.code] : []));

      expect(codes).toHaveLength(12);
      expect(new Set(codes).size).toBe(12);
    }
  });

  it('preview totals equal checkout totals', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(50, `PV${r}`);
      const [cid] = await world.customers(1);
      const voucher = await prisma.voucher.create({
        data: {
          code: world.t(`PV${r}`),
          name: 'v',
          discountType: 'PERCENT',
          discountValue: 10,
          minOrderAmount: 0,
          maxDiscount: 5000,
          usageLimit: 10,
          perCustomerLimit: 10,
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const preview = await orders.checkoutPreview(cid, {
        items: [{ productVariantId: b.variantId, quantity: 3 }],
        voucherCode: voucher.code,
      } as never);
      const order = await co(cid, b.variantId, 3, { voucherCode: voucher.code });

      expect(Number(order.subtotal)).toBe(preview.subtotal);
      expect(Number(order.discountTotal)).toBe(preview.discountTotal);
      expect(Number(order.shippingFee)).toBe(preview.shippingFee);
      expect(Number(order.grandTotal)).toBe(preview.grandTotal);
    }
  });

  it('idempotency: 3 concurrent retries with the same key create one order', async () => {
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `ID${r}`);
      const [cid] = await world.customers(1);
      const dto = {
        shippingAddress: address,
        items: [{ productVariantId: b.variantId, quantity: 1 }],
        idempotencyKey: world.t(`K${r}`),
      };
      const res = await Promise.allSettled([
        orders.checkout(cid, dto as never),
        orders.checkout(cid, dto as never),
        orders.checkout(cid, dto as never),
      ]);
      const ok = res.filter((x) => x.status === 'fulfilled').length;
      const dbOrders = await prisma.order.count({ where: { customerId: cid } });
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });

      expect(ok).toBe(3);
      expect(dbOrders).toBe(1);
      expect(Number(bal.reserved)).toBe(1);
    }
  });

  it('the preview/confirm guard rejects a stale total (409) without creating an order', async () => {
    const b = await world.base(20, 'GUARD');
    const [cid] = await world.customers(1);
    // subtotal 2 * 30000 = 60000 + flat shipping 20000 = 80000.
    await expect(
      co(cid, b.variantId, 2, { expectedGrandTotal: 12345 }),
    ).rejects.toMatchObject({ status: 409 });
    const dbOrders = await prisma.order.count({ where: { customerId: cid } });
    const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
    expect(dbOrders).toBe(0);
    expect(Number(bal.reserved)).toBe(0);

    // With the correct total the same checkout succeeds.
    const ok = await co(cid, b.variantId, 2, { expectedGrandTotal: 80000 });
    expect(Number(ok.grandTotal)).toBe(80000);
  });

  it('flash sale disabled between preview and confirm rolls back Order/Payment/Inventory/Voucher/quota', async () => {
    // Simulates an Admin deactivation landing in the preview→confirm window.
    // The confirm must fail (stale total) and leave no side effect behind.
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FSD${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSD${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });
      const voucher = await prisma.voucher.create({
        data: {
          code: world.t(`FSDV${r}`),
          name: 'v',
          discountType: 'FIXED',
          discountValue: 1000,
          minOrderAmount: 0,
          usageLimit: 10,
          perCustomerLimit: 10,
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });

      const preview = await orders.checkoutPreview(cid, {
        items: [{ productVariantId: b.variantId, quantity: 1 }],
        voucherCode: voucher.code,
      } as never);
      // 10000 - 1000 + 20000 flat shipping.
      expect(Number(preview.grandTotal)).toBe(29000);

      // Admin disables the sale before the customer confirms.
      await prisma.flashSale.update({ where: { id: sale.id }, data: { status: 'INACTIVE' } });

      await expect(
        co(cid, b.variantId, 1, {
          voucherCode: voucher.code,
          expectedGrandTotal: preview.grandTotal,
        }),
      ).rejects.toMatchObject({ status: 409 });

      // Full rollback: no order, no payment, no reservation, no voucher claim,
      // no flash quota consumed.
      expect(await prisma.order.count({ where: { customerId: cid } })).toBe(0);
      expect(
        await prisma.payment.count({ where: { order: { customerId: cid } } }),
      ).toBe(0);
      expect(
        await prisma.orderItem.count({
          where: { partnerOrder: { order: { customerId: cid } } },
        }),
      ).toBe(0);
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      expect(Number(bal.reserved)).toBe(0);
      const vAfter = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
      expect(Number(vAfter.usedCount)).toBe(0);
      expect(await prisma.voucherRedemption.count({ where: { voucherId: voucher.id } })).toBe(0);
      const itemAfter = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(itemAfter.soldQuantity).toBe(0);
    }
  });

  it('flash sale price edited between preview and confirm rolls back everything', async () => {
    // Simulates an Admin price edit landing in the preview→confirm window.
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FSE${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSE${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });
      const voucher = await prisma.voucher.create({
        data: {
          code: world.t(`FSEV${r}`),
          name: 'v',
          discountType: 'FIXED',
          discountValue: 1000,
          minOrderAmount: 0,
          usageLimit: 10,
          perCustomerLimit: 10,
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });

      const preview = await orders.checkoutPreview(cid, {
        items: [{ productVariantId: b.variantId, quantity: 1 }],
        voucherCode: voucher.code,
      } as never);
      expect(Number(preview.grandTotal)).toBe(29000);

      // Admin changes the flash price before confirm.
      await prisma.flashSaleItem.update({
        where: { id: item.id },
        data: { flashPrice: 15000 },
      });

      await expect(
        co(cid, b.variantId, 1, {
          voucherCode: voucher.code,
          expectedGrandTotal: preview.grandTotal,
        }),
      ).rejects.toMatchObject({ status: 409 });

      expect(await prisma.order.count({ where: { customerId: cid } })).toBe(0);
      expect(
        await prisma.payment.count({ where: { order: { customerId: cid } } }),
      ).toBe(0);
      const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: b.balanceId } });
      expect(Number(bal.reserved)).toBe(0);
      const vAfter = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
      expect(Number(vAfter.usedCount)).toBe(0);
      expect(await prisma.voucherRedemption.count({ where: { voucherId: voucher.id } })).toBe(0);
      const itemAfter = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(itemAfter.soldQuantity).toBe(0);
      // The price edit itself survived; the failed checkout did not consume quota.
      expect(Number(itemAfter.flashPrice)).toBe(15000);
    }
  });

  it('consumeFlashSaleQuota rejects a stale item instead of succeeding silently (MySQL)', async () => {
    // Direct regression for the `if (!item) return` branch: quota must never be
    // skipped while a flash price is charged. Here the sale is disabled after
    // pricing, then the stale claim is attempted inside a transaction.
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FSQ${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSQS${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });

      await prisma.flashSale.update({ where: { id: sale.id }, data: { status: 'INACTIVE' } });

      await expect(
        prisma.$transaction((tx) =>
          promotions.consumeFlashSaleQuota(tx as never, {
            flashSaleItemId: item.id,
            quantity: 1,
            customerId: cid,
            expectedUnitPrice: 10000,
          }),
        ),
      ).rejects.toThrow(/no longer available/);

      const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(after.soldQuantity).toBe(0);
    }
  });

  it('flash sale disabled inside the checkout window fails atomically (MySQL)', async () => {
    // The exact race from the acceptance criteria: the in-transaction re-price
    // sees an ACTIVE sale, an Admin deactivation commits before the quota claim,
    // and the claim must then fail instead of charging the stale flash price
    // with no quota. Price, item id, quota and order rows stay consistent
    // because the whole transaction rolls back.
    for (let r = 0; r < ROUNDS; r += 1) {
      const b = await world.base(10, `FSW${r}`);
      const [cid] = await world.customers(1);
      const sale = await prisma.flashSale.create({
        data: {
          name: world.t(`FSWS${r}`),
          startsAt: new Date(Date.now() - 36e5),
          endsAt: new Date(Date.now() + 36e5),
          status: 'ACTIVE',
        },
      });
      const item = await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productVariantId: b.variantId,
          flashPrice: 10000,
          quota: 50,
          perCustomerLimit: 50,
        },
      });

      await expect(
        prisma.$transaction(
          async (tx) => {
            const price = await promotions.resolvePriceForCustomer(
              b.variantId,
              cid,
              1,
              new Date(),
              tx as never,
            );
            expect(price.flashSaleItemId).toBe(item.id);
            // Admin commits the deactivation on another connection while this
            // transaction is still open. Like the real checkout this runs at
            // READ COMMITTED, so the claim below observes the deactivation.
            await prisma.flashSale.update({
              where: { id: sale.id },
              data: { status: 'INACTIVE' },
            });
            await promotions.consumeFlashSaleQuota(tx as never, {
              flashSaleItemId: item.id,
              quantity: 1,
              customerId: cid,
              expectedUnitPrice: price.unitPrice,
            });
          },
          { isolationLevel: 'ReadCommitted' },
        ),
      ).rejects.toThrow(/no longer available/);

      const after = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(after.soldQuantity).toBe(0);
    }
  });
});
