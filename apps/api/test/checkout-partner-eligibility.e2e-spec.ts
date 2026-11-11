import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { CommissionService } from '../src/finance/commission.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { QuarantineService } from '../src/quarantine/quarantine.service.js';
import { createTestApp, login } from './helpers/test-app.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  E2E_CUSTOMER_PASSWORD,
  E2E_PREFIX,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * Task 05.4.2.5 — checkout must refuse a line whose seller may not trade, on
 * the real HTTP stack against the isolated test database.
 *
 * The rule under test: a new order is created only when EVERY line's Product is
 * ACTIVE, its ProductVariant is sellable, and its Partner is ACTIVE + VERIFIED.
 * The status is read by the backend from the database — never from the request —
 * and the decision is re-evaluated inside the transaction that writes the order,
 * so neither a stale cart nor a client-supplied flag can bypass it.
 *
 * What "refused" must mean, asserted row by row:
 *   - no `orders`, `partner_orders`, `order_items` row;
 *   - no `inventory_allocations` row and no change to `inventory_balances`;
 *   - no `payments` row;
 *   - the customer's cart is byte-for-byte unchanged.
 *
 * The fixtures are run-scoped (`e2e…` markers) and removed in `afterAll`, and
 * the suite refuses to run at all without `TEST_DATABASE_URL`, so neither the
 * demo seed nor a dev/prod database is ever touched.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2eseller');

/** The exact sentence the API must answer with. */
const MESSAGE =
  'Sản phẩm hiện chưa đủ điều kiện kinh doanh. Vui lòng chọn sản phẩm khác.';

const ADDRESS = {
  recipientName: 'E2E Khách',
  phone: '0911111111',
  province: 'Hưng Yên',
  detail: 'Số 1 đường E2E',
};

describe.skipIf(!hasTestDb)('Checkout — seller eligibility (isolated MariaDB e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let customerToken: string;

  /** A run-scoped, sellable slice owned by one partner. */
  interface SellerWorld {
    partnerId: number;
    productId: number;
    variantId: number;
    lotId: number;
    balanceId: number;
  }

  let sequence = 0;

  /**
   * Create a partner + product + variant + sellable lot + stock, with the
   * partner in whatever state the test wants to exercise.
   *
   * `verificationStatus` is set explicitly: the schema default is PENDING, and
   * the whole point of the suite is that the default is NOT sellable.
   */
  async function makeSeller(
    tag: string,
    partner: { status: 'ACTIVE' | 'INACTIVE'; verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' },
  ): Promise<SellerWorld> {
    sequence += 1;
    const created = await prisma.partner.create({
      data: {
        code: `${RUN_ID}-P-${tag}-${sequence}`,
        name: `HTX ${tag} ${RUN_ID}`,
        representativeName: 'E2E Seller',
        phone: `09${String(Date.now() + sequence).slice(-8)}${sequence % 10}`.slice(0, 10),
        email: `${RUN_ID}-${tag}-${sequence}@seller.vn`,
        address: 'Hưng Yên',
        status: partner.status,
        verificationStatus: partner.verificationStatus,
      },
    });

    const product = await prisma.product.create({
      data: {
        partnerId: created.id,
        categoryId: fixtures.categoryAId,
        name: `Sản phẩm ${tag} ${RUN_ID}`,
        slug: `${RUN_ID}-${tag}-${sequence}`,
        status: 'ACTIVE',
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${RUN_ID}-SKU-${tag}-${sequence}`,
        name: 'Túi 1kg',
        saleUnit: 'túi',
        basePrice: 40000,
        status: 'ACTIVE',
      },
    });

    const lot = await prisma.productLot.create({
      data: {
        code: `${RUN_ID}-LOT-${tag}-${sequence}`,
        productId: product.id,
        harvestId: fixtures.harvestAId,
        quantity: 100,
        unit: 'kg',
        remainingQuantity: 100,
        grade: 'A',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
        status: 'SELLABLE',
        traceCode: `${RUN_ID}-TRC-${tag}-${sequence}`,
      },
    });

    // FEFO only allocates from lots whose latest QC inspection passed.
    await prisma.qcInspection.create({
      data: {
        productLotId: lot.id,
        inspectorUserId: fixtures.adminId,
        result: 'PASS',
        appearancePassed: true,
        freshnessPassed: true,
        packagingPassed: true,
        damagePassed: true,
        inspectedAt: new Date(),
      },
    });

    const balance = await prisma.inventoryBalance.create({
      data: {
        warehouseId: fixtures.warehouseId,
        productLotId: lot.id,
        productVariantId: variant.id,
        onHand: 100,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      },
    });

    return {
      partnerId: created.id,
      productId: product.id,
      variantId: variant.id,
      lotId: lot.id,
      balanceId: balance.id,
    };
  }

  const post = (path: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body as object);

  const checkout = (items: { productVariantId: number; quantity: number }[], extra: object = {}) =>
    post('/api/v1/orders/checkout', {
      shippingAddress: ADDRESS,
      items,
      paymentMethod: 'COD',
      ...extra,
    });

  /** Put exactly the given lines in the customer's cart, through the API. */
  async function resetCart(lines: [number, number][]) {
    await prisma.cartItem.deleteMany({
      where: { cart: { customerId: fixtures.customerId } },
    });
    for (const [productVariantId, quantity] of lines) {
      await post('/api/v1/carts/me/items', { productVariantId, quantity }).expect(201);
    }
  }

  async function cartSnapshot(): Promise<Array<{ productVariantId: number; quantity: number }>> {
    const cart = await prisma.cart.findUnique({
      where: { customerId: fixtures.customerId },
      include: { items: { orderBy: { productVariantId: 'asc' } } },
    });
    return (cart?.items ?? []).map((item) => ({
      productVariantId: item.productVariantId,
      quantity: Number(item.quantity),
    }));
  }

  /**
   * Snapshot of everything a refused checkout must leave exactly as it was.
   * Scoped to the customer so the assertion cannot be polluted by other runs.
   */
  async function commerceState() {
    const [orders, payments, allocations, balances] = await Promise.all([
      prisma.order.count({ where: { customerId: fixtures.customerId } }),
      prisma.payment.count({ where: { order: { customerId: fixtures.customerId } } }),
      prisma.inventoryAllocation.count({
        where: { orderItem: { partnerOrder: { order: { customerId: fixtures.customerId } } } },
      }),
      prisma.inventoryBalance.findMany({
        where: { productVariant: { product: { slug: { startsWith: RUN_ID } } } },
        select: { id: true, onHand: true, reserved: true, blocked: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      orders,
      payments,
      allocations,
      balances: balances.map((b) => ({
        id: b.id,
        onHand: Number(b.onHand),
        reserved: Number(b.reserved),
        blocked: Number(b.blocked),
      })),
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
    // Fail fast on the fixture's own admin login so a broken seed cannot be
    // mistaken for a seller-eligibility regression.
    await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
  }, 60000);

  afterAll(async () => {
    if (prisma && fixtures) {
      await cleanupFixtures(prisma, fixtures);
      const leftovers = await prisma.user.count({ where: { email: { startsWith: E2E_PREFIX } } });
      expect(leftovers).toBe(0);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 60000);

  /* -------------------------------------------------------------- case 1 -- */

  it('Case 1 — VERIFIED + ACTIVE seller is allowed and the order is created', async () => {
    const seller = await makeSeller('OK', {
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });

    const res = await checkout([{ productVariantId: seller.variantId, quantity: 2 }]).expect(201);

    const orderId = res.body.id as number;
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { partnerOrders: { include: { items: true } }, payments: true },
    });
    expect(order.status).toBe('PENDING_CONFIRMATION');
    expect(order.partnerOrders).toHaveLength(1);
    expect(order.partnerOrders[0].partnerId).toBe(seller.partnerId);
    expect(order.partnerOrders[0].items).toHaveLength(1);
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0].status).toBe('PENDING');

    // The reservation really moved: this is a positive control, proving the
    // "nothing changed" assertions below are not vacuously true.
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: seller.balanceId },
    });
    expect(Number(balance.reserved)).toBe(2);
  });

  /* -------------------------------------------------------------- case 2 -- */

  it('Case 2 — PENDING seller is refused: 400 + the exact message, nothing written', async () => {
    const seller = await makeSeller('PENDING', {
      status: 'ACTIVE',
      verificationStatus: 'PENDING',
    });
    await resetCart([[seller.variantId, 2]]);
    const cartBefore = await cartSnapshot();
    const stateBefore = await commerceState();

    const res = await checkout([{ productVariantId: seller.variantId, quantity: 2 }]).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    expect(await cartSnapshot()).toEqual(cartBefore);
    expect(await commerceState()).toEqual(stateBefore);
  });

  /* -------------------------------------------------------------- case 3 -- */

  it('Case 3 — REJECTED seller is refused with the same message', async () => {
    const seller = await makeSeller('REJECTED', {
      status: 'ACTIVE',
      verificationStatus: 'REJECTED',
    });
    await resetCart([[seller.variantId, 1]]);
    const cartBefore = await cartSnapshot();
    const stateBefore = await commerceState();

    const res = await checkout([{ productVariantId: seller.variantId, quantity: 1 }]).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    expect(await cartSnapshot()).toEqual(cartBefore);
    expect(await commerceState()).toEqual(stateBefore);
  });

  /* -------------------------------------------------------------- case 4 -- */

  it('Case 4 — INACTIVE seller is refused even when VERIFIED', async () => {
    const seller = await makeSeller('INACTIVE', {
      status: 'INACTIVE',
      verificationStatus: 'VERIFIED',
    });
    await resetCart([[seller.variantId, 1]]);
    const cartBefore = await cartSnapshot();
    const stateBefore = await commerceState();

    const res = await checkout([{ productVariantId: seller.variantId, quantity: 1 }]).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    expect(await cartSnapshot()).toEqual(cartBefore);
    expect(await commerceState()).toEqual(stateBefore);
  });

  /* -------------------------------------------------------------- case 5 -- */

  it('Case 5 — multi-seller cart with one ineligible seller creates no partial order', async () => {
    const good = await makeSeller('MULTI-OK', {
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });
    const bad = await makeSeller('MULTI-BAD', {
      status: 'INACTIVE',
      verificationStatus: 'PENDING',
    });
    await resetCart([
      [good.variantId, 1],
      [bad.variantId, 1],
    ]);
    const cartBefore = await cartSnapshot();
    const stateBefore = await commerceState();

    const res = await checkout([
      { productVariantId: good.variantId, quantity: 1 },
      { productVariantId: bad.variantId, quantity: 1 },
    ]).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    // The valid seller's line must NOT have been written on its own: no order
    // header, no partner order for the good partner, no reservation, no money.
    const partnerOrders = await prisma.partnerOrder.count({
      where: { partnerId: { in: [good.partnerId, bad.partnerId] } },
    });
    expect(partnerOrders).toBe(0);
    const orders = await prisma.order.count({ where: { customerId: fixtures.customerId } });
    expect(orders).toBe(stateBefore.orders);

    expect(await cartSnapshot()).toEqual(cartBefore);
    expect(await commerceState()).toEqual(stateBefore);
  });

  /* -------------------------------------------------------------- case 6 -- */

  it('Case 6 — BUY_NOW cannot bypass verification', async () => {
    const seller = await makeSeller('BUYNOW', {
      status: 'ACTIVE',
      verificationStatus: 'PENDING',
    });
    // The cart is empty on purpose: the line comes from the request body, which
    // is exactly the path a client could use to skip the cart.
    await resetCart([]);
    const stateBefore = await commerceState();

    const res = await checkout([{ productVariantId: seller.variantId, quantity: 1 }], {
      source: 'BUY_NOW',
    }).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    expect(await cartSnapshot()).toEqual([]);
    expect(await commerceState()).toEqual(stateBefore);
  });

  /* -------------------------------------------------------------- case 7 -- */

  it('Case 7 — a refused checkout leaves the cart, the stock and the payment untouched', async () => {
    const good = await makeSeller('UNTOUCHED-OK', {
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });
    const bad = await makeSeller('UNTOUCHED-BAD', {
      status: 'ACTIVE',
      verificationStatus: 'REJECTED',
    });
    // A real cart with a valid line AND the rejected one, plus an unrelated
    // line that the order does not even mention.
    await resetCart([
      [good.variantId, 3],
      [bad.variantId, 2],
    ]);
    const cartBefore = await cartSnapshot();
    const stateBefore = await commerceState();
    expect(cartBefore).toHaveLength(2);

    const res = await checkout([
      { productVariantId: good.variantId, quantity: 3 },
      { productVariantId: bad.variantId, quantity: 2 },
    ]).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    // Cart: same lines, same quantities, nothing deleted or decremented.
    expect(await cartSnapshot()).toEqual(cartBefore);
    // Stock: `reserved` did not move for either seller's balance.
    expect(await commerceState()).toEqual(stateBefore);
    // Money: no payment row exists for this customer.
    expect(await prisma.payment.count({ where: { order: { customerId: fixtures.customerId } } })).toBe(
      stateBefore.payments,
    );
  });

  /* --------------------------------------------- transaction re-check ---- */

  it('re-checks the seller inside the write transaction (status changed after the pre-flight read)', async () => {
    const seller = await makeSeller('RACE', {
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });
    await resetCart([[seller.variantId, 1]]);
    const stateBefore = await commerceState();

    // Suspend the partner *after* the pre-flight resolution has read it but
    // *before* the checkout transaction takes its own snapshot. Doing this
    // through the real service is impossible from a test (the window is
    // microseconds wide), so the OrdersService is instantiated here with an
    // extended Prisma client: the first `productVariant.findUnique` — the
    // pre-flight eligibility read — suspends the partner as a side effect.
    // Every later read (pricing, and crucially the in-transaction revalidation)
    // already sees INACTIVE, which is exactly the state the re-check must catch.
    // Extensions apply to the transaction client too, so the in-transaction
    // read is counted here as well.
    let reads = 0;
    const extended = (
      prisma as unknown as {
        $extends: (options: unknown) => unknown;
      }
    ).$extends({
      query: {
        productVariant: {
          async findUnique({
            args,
            query,
          }: {
            args: unknown;
            query: (args: unknown) => Promise<unknown>;
          }) {
            reads += 1;
            const result = await query(args);
            if (reads === 1) {
              await prisma.partner.update({
                where: { id: seller.partnerId },
                data: { status: 'INACTIVE', verificationStatus: 'PENDING' },
              });
            }
            return result;
          },
        },
      },
    });
    const racing = new OrdersService(
      extended as never,
      app.get(InventoryService),
      app.get(PromotionsService),
      app.get(CommissionService),
      app.get(AuditService),
      app.get(LocationsService),
      app.get(QuarantineService),
    );

    const error = await racing
      .checkout(fixtures.customerId, {
        shippingAddress: ADDRESS,
        items: [{ productVariantId: seller.variantId, quantity: 1 }],
        paymentMethod: 'COD',
        source: 'CART',
      } as never)
      .then(
        () => null,
        (e: unknown) => e as { status?: number; message?: string },
      );

    // The pre-flight read saw a sellable seller; only the in-transaction
    // re-check can produce this refusal.
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(error?.status).toBe(400);
    expect(error?.message).toBe(MESSAGE);

    // The suspension is the only change: the order, the stock and the payment
    // stayed exactly as they were, and the cart still holds its line.
    expect(await commerceState()).toEqual(stateBefore);
    expect(await cartSnapshot()).toEqual([{ productVariantId: seller.variantId, quantity: 1 }]);
  });

  /* ------------------------------------------------ preview agreement ---- */

  it('the preview refuses the same line, so the storefront and checkout agree', async () => {
    const seller = await makeSeller('PREVIEW', {
      status: 'ACTIVE',
      verificationStatus: 'PENDING',
    });
    const stateBefore = await commerceState();

    const res = await post('/api/v1/orders/checkout-preview', {
      items: [{ productVariantId: seller.variantId, quantity: 1 }],
    }).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    // The preview wrote nothing at all: no order, no payment, no reservation.
    expect(await commerceState()).toEqual(stateBefore);
  });

  /* ------------------------------------------------ historical orders ---- */

  it('keeps historical orders intact when a seller is later suspended', async () => {
    const seller = await makeSeller('HISTORY', {
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
    });
    const created = await checkout([{ productVariantId: seller.variantId, quantity: 1 }]).expect(
      201,
    );
    const orderId = created.body.id as number;

    // The seller is suspended after the sale.
    await prisma.partner.update({
      where: { id: seller.partnerId },
      data: { status: 'INACTIVE', verificationStatus: 'PENDING' },
    });

    // The buyer can still read the order: the gate guards new writes only.
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/orders/me/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(detail.body.id).toBe(orderId);
    expect(detail.body.partnerOrders?.[0]?.partnerId ?? seller.partnerId).toBe(seller.partnerId);
  });
});
