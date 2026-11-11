import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
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
 * Shipment list search (GET /shipments?search=…) and the multi-partner
 * delivery evidence flow (PATCH /shipments/:id/status).
 *
 * Both suites run against the isolated TEST_DATABASE_URL with the real HTTP
 * stack. Every row is tagged with the run id and removed in `afterAll`, so the
 * pre-seeded demo rows never influence the assertions.
 *
 * The search suite pins the contract the admin UI depends on: one keyword must
 * match the shipment code, the parent order code, the partner-order code, the
 * carrier tracking code and the partner name; `status` composes with `search`
 * BEFORE pagination; `meta.total` counts the filtered set; and the pre-seeded
 * shipments of unrelated orders must never appear in the results. Deliveries
 * prove that one partner arriving first leaves the order SHIPPING, that the
 * manual DELIVERED shortcut is refused while a parcel is still out, and that
 * the second successful delivery rolls the whole order up exactly once —
 * including the inventory consumption — while COD stays PENDING.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2es');
const NONEXISTENT = `${RUN_ID}-KHONG-TON-TAI`;

describe.skipIf(!hasTestDb)('AgriMarket API — shipments search & delivery evidence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  // Run-scoped second partner. Partner B of the base fixtures is INACTIVE on
  // purpose (its own tests cover that), but a shopper needs both partners
  // ACTIVE for the checkout to split one order into two partner orders.
  let partnerBId: number;
  let variantBId: number;
  let balanceBId: number;

  let orderId: number;
  let orderCode: string;
  let partnerOrderAId: number;
  let partnerOrderBId: number;
  let shipmentAId: number;
  let shipmentACode: string;
  let shipmentBId: number;

  const patch = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  const post = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL as string;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    // Second run-scoped partner with a sellable variant and stock. Every
    // marker starts with the run id so cleanupFixtures removes them all.
    // ACTIVE + VERIFIED: this seller is the second half of a multi-partner
    // checkout, which only succeeds when every line's partner may trade.
    const partnerB = await prisma.partner.create({
      data: {
        code: `${RUN_ID}-PB`,
        name: `HTX Cam Sành ${RUN_ID}`,
        representativeName: 'Nguyễn Thị B',
        phone: '0987654399',
        email: `${RUN_ID}-pb@partner.vn`,
        address: 'Hưng Yên',
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
    });
    partnerBId = partnerB.id;
    const farmB = await prisma.farm.create({
      data: {
        code: `${RUN_ID}-FARM-CAM`,
        partnerId: partnerBId,
        name: `Trang trại cam ${RUN_ID}`,
        address: 'Hưng Yên',
        status: 'ACTIVE',
      },
    });
    const productB = await prisma.product.create({
      data: {
        partnerId: partnerBId,
        categoryId: fixtures.categoryAId,
        farmId: farmB.id,
        name: `Cam sành ${RUN_ID}`,
        slug: `${RUN_ID}-cam-sanh-e2e`,
        status: 'ACTIVE',
      },
    });
    const variantB = await prisma.productVariant.create({
      data: {
        productId: productB.id,
        sku: `${RUN_ID}-SKU-CAM2`,
        name: 'Túi 2kg',
        saleUnit: 'túi',
        basePrice: 80000,
        status: 'ACTIVE',
      },
    });
    variantBId = variantB.id;
    const lotB = await prisma.productLot.create({
      data: {
        code: `${RUN_ID}-LOT-CAM`,
        productId: productB.id,
        harvestId: fixtures.harvestAId,
        quantity: 100,
        unit: 'kg',
        remainingQuantity: 100,
        grade: 'A',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
        status: 'SELLABLE',
        traceCode: `${RUN_ID}-TRC-CAM`,
      },
    });
    // FEFO checkout allocation only counts lots whose LATEST QC inspection is
    // a PASS (allocateFefo), so the sellable lot needs one on record.
    await prisma.qcInspection.create({
      data: {
        productLotId: lotB.id,
        inspectorUserId: fixtures.adminId,
        result: 'PASS',
        appearancePassed: true,
        freshnessPassed: true,
        packagingPassed: true,
        damagePassed: true,
        inspectedAt: new Date(),
      },
    });
    const balanceB = await prisma.inventoryBalance.create({
      data: {
        warehouseId: fixtures.warehouseId,
        productLotId: lotB.id,
        productVariantId: variantBId,
        onHand: 100,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      },
    });
    balanceBId = balanceB.id;

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
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

  describe('shipment search', () => {
    it('checks out one order containing both partners and creates both shipments', async () => {
      const res = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 2 đường E2E',
        },
        items: [
          { productVariantId: fixtures.variantAId, quantity: 2 },
          { productVariantId: variantBId, quantity: 1 },
        ],
        paymentMethod: 'COD',
      }).expect(201);
      orderId = res.body.id;
      orderCode = res.body.code;

      const detail = await get(`/api/v1/orders/${orderId}`, adminToken).expect(200);
      expect(detail.body.partnerOrders).toHaveLength(2);
      // Identify the partner orders by partner id: the include has no
      // deterministic order.
      partnerOrderAId = detail.body.partnerOrders.find(
        (po: { partnerId: number }) => po.partnerId === fixtures.partnerAId,
      ).id;
      partnerOrderBId = detail.body.partnerOrders.find(
        (po: { partnerId: number }) => po.partnerId === partnerBId,
      ).id;
      expect(partnerOrderAId).toBeDefined();
      expect(partnerOrderBId).toBeDefined();
      expect(partnerOrderAId).not.toBe(partnerOrderBId);

      // Advance the order up the state machine; both partner orders follow.
      for (const status of ['CONFIRMED', 'PREPARING', 'READY_TO_SHIP']) {
        await patch(`/api/v1/orders/${orderId}/status`, adminToken, { status }).expect(200);
      }

      const shipmentA = await post('/api/v1/shipments', adminToken, {
        partnerOrderId: partnerOrderAId,
        carrier: 'E2E Giao Hàng Nhanh',
        trackingCode: `${RUN_ID}-TRACK-A`,
      }).expect(201);
      shipmentAId = shipmentA.body.id;
      shipmentACode = shipmentA.body.code;

      const shipmentB = await post('/api/v1/shipments', adminToken, {
        partnerOrderId: partnerOrderBId,
        carrier: 'E2E Giao Hàng Nhanh',
        trackingCode: `${RUN_ID}-TRACK-B`,
      }).expect(201);
      shipmentBId = shipmentB.body.id;
      expect(shipmentA.body.code).not.toBe(shipmentB.body.code);
    });

    it('an empty search lists every shipment, including this order\'s two', async () => {
      const res = await get('/api/v1/shipments', adminToken).expect(200);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('searching the order code returns exactly that order\'s shipments', async () => {
      // Acceptance: typing ORD-20261006-0003 on /shipments must list ALL the
      // linked parcels. The order code is run-scoped, so the demo shipments of
      // unrelated orders can never leak into this result.
      const res = await get(`/api/v1/shipments?search=${encodeURIComponent(orderCode)}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data).toHaveLength(2);
      for (const row of res.body.data) {
        expect(row.partnerOrder.order.code).toBe(orderCode);
      }
      expect(new Set(res.body.data.map((s: { id: number }) => s.id))).toEqual(
        new Set([shipmentAId, shipmentBId]),
      );
    });

    it('searching one shipment code returns exactly that shipment', async () => {
      const res = await get(`/api/v1/shipments?search=${encodeURIComponent(shipmentACode)}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(shipmentAId);
      expect(res.body.data[0].code).toBe(shipmentACode);
    });

    it('searching a tracking code returns its shipment', async () => {
      const res = await get(`/api/v1/shipments?search=${encodeURIComponent(`${RUN_ID}-TRACK-B`)}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(shipmentBId);
      expect(res.body.data[0].trackingCode).toBe(`${RUN_ID}-TRACK-B`);
    });

    it('searching the partner name (partial, unaccented, lowercase) finds the parcels', async () => {
      // utf8mb4_unicode_ci folds case AND diacritics: "cam sanh" matches
      // "HTX Cam Sành <runId>".
      const res = await get('/api/v1/shipments?search=cam%20sanh', adminToken).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(shipmentBId);
      expect(res.body.data[0].partnerOrder.partner.name).toBe(`HTX Cam Sành ${RUN_ID}`);
    });

    it('searching an order-code fallback in lowercase proves the case-insensitive match', async () => {
      // The codes are stored uppercase; a lowercase query must still find
      // them (utf8mb4_unicode_ci).
      const res = await get(`/api/v1/shipments?search=${encodeURIComponent(orderCode.toLowerCase())}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(2);
      for (const row of res.body.data) {
        expect([shipmentAId, shipmentBId]).toContain(row.id);
      }
    });

    it('a keyword that exists nowhere returns an empty list with meta.total 0', async () => {
      const res = await get(`/api/v1/shipments?search=${encodeURIComponent(NONEXISTENT)}`, adminToken).expect(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it('search composes with the status filter before pagination', async () => {
      // Only the first parcel is travelling: the order is still READY_TO_SHIP.
      await patch(`/api/v1/shipments/${shipmentAId}/status`, adminToken, { status: 'IN_TRANSIT' }).expect(200);

      const inTransit = await get(
        `/api/v1/shipments?search=${encodeURIComponent(orderCode)}&status=IN_TRANSIT`,
        adminToken,
      ).expect(200);
      expect(inTransit.body.meta.total).toBe(1);
      expect(inTransit.body.data[0].id).toBe(shipmentAId);

      const pending = await get(
        `/api/v1/shipments?search=${encodeURIComponent(orderCode)}&status=PENDING`,
        adminToken,
      ).expect(200);
      expect(pending.body.meta.total).toBe(1);
      expect(pending.body.data[0].id).toBe(shipmentBId);
    });

    it('pagination happens on the filtered set and meta.total stays the filtered count', async () => {
      const page = await get(
        `/api/v1/shipments?search=${encodeURIComponent(orderCode)}&page=2&limit=1`,
        adminToken,
      ).expect(200);
      expect(page.body.meta.page).toBe(2);
      expect(page.body.meta.limit).toBe(1);
      expect(page.body.meta.total).toBe(2);
      expect(page.body.data).toHaveLength(1);
      // `orderBy: id desc` — the newest shipment (partner B) is on page 1, the
      // partner-A parcel on page 2.
      expect(page.body.data[0].id).toBe(shipmentAId);

      const page1 = await get(
        `/api/v1/shipments?search=${encodeURIComponent(orderCode)}&page=1&limit=1`,
        adminToken,
      ).expect(200);
      expect(page1.body.data).toHaveLength(1);
      expect(page1.body.data[0].id).toBe(shipmentBId);
    });
  });

  describe('multi-partner delivery evidence', () => {
    it('one delivered parcel does NOT deliver the whole order', async () => {
      // The second parcel must start travelling before the first one lands:
      // only then has the order actually left the warehouse (covered above).
      await patch(`/api/v1/shipments/${shipmentBId}/status`, adminToken, { status: 'IN_TRANSIT' }).expect(200);

      // The order must now be SHIPPING (no partner order is being prepared).
      const shipping = await get(`/api/v1/orders/${orderId}`, adminToken).expect(200);
      expect(shipping.body.status).toBe('SHIPPING');

      await patch(`/api/v1/shipments/${shipmentAId}/status`, adminToken, { status: 'OUT_FOR_DELIVERY' }).expect(200);
      await patch(`/api/v1/shipments/${shipmentAId}/status`, adminToken, { status: 'DELIVERED' }).expect(200);

      const detail = await get(`/api/v1/orders/${orderId}`, adminToken).expect(200);
      expect(detail.body.status).toBe('SHIPPING');
      const statuses = Object.fromEntries(
        detail.body.partnerOrders.map((po: { id: number; status: string }) => [po.id, po.status]),
      );
      expect(statuses[partnerOrderAId]).toBe('DELIVERED');
      expect(statuses[partnerOrderBId]).toBe('SHIPPING');

      // The delivered partner order consumed NOTHING yet: the reservation is
      // only consumed when the whole order can be proven delivered.
      const balanceA = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      });
      // 2 units were reserved at checkout for partner A.
      expect(Number(balanceA.reserved)).toBe(2);
      expect(Number(balanceA.onHand)).toBe(200);
    });

    it('refuses to force the order DELIVERED while the other parcel is still out', async () => {
      const res = await patch(`/api/v1/orders/${orderId}/status`, adminToken, {
        status: 'DELIVERED',
      }).expect(409);
      expect(JSON.stringify(res.body.message)).toMatch(/bằng chứng/);
      expect(JSON.stringify(res.body.message)).toMatch(/còn vận đơn đang xử lý|chưa có vận đơn giao thành công/);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('SHIPPING');
    });

    it('the second delivered parcel completes the order under the evidence rules', async () => {
      await patch(`/api/v1/shipments/${shipmentBId}/status`, adminToken, {
        status: 'OUT_FOR_DELIVERY',
      }).expect(200);
      await patch(`/api/v1/shipments/${shipmentBId}/status`, adminToken, {
        status: 'DELIVERED',
      }).expect(200);

      const detail = await get(`/api/v1/orders/${orderId}`, adminToken).expect(200);
      expect(detail.body.status).toBe('DELIVERED');
      expect(detail.body.partnerOrders.every((po: { status: string }) => po.status === 'DELIVERED')).toBe(true);

      // Exactly one consumption per partner order: reserved cleared, on_hand
      // reduced by the allocation quantity, one OUTBOUND movement per order.
      const balanceA = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      });
      expect(Number(balanceA.reserved)).toBe(0);
      expect(Number(balanceA.onHand)).toBe(200 - 2);
      const balanceB = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balanceBId } });
      expect(Number(balanceB.reserved)).toBe(0);
      expect(Number(balanceB.onHand)).toBe(99); // 100 - 1 allocated to partner B

      const outbound = await prisma.inventoryMovement.findMany({
        where: { referenceType: 'Order', referenceId: orderId, type: 'OUTBOUND' },
      });
      expect(outbound).toHaveLength(2);

      // COD is NOT auto-collected by a delivery: collection is explicit.
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
      expect(payment.method).toBe('COD');
      expect(payment.status).toBe('PENDING');
      expect(payment.paidAt).toBeNull();
    });

    it('records the shipped-goods event chain in order per shipment', async () => {
      // POST /shipments itself writes no event; PENDING events in the seeded
      // demo data come from the seed script. What the updateStatus service
      // must guarantee is the ordered IN_TRANSIT → OUT_FOR_DELIVERY →
      // DELIVERED chain, exactly once per transition.
      const a = await prisma.shipmentEvent.findMany({
        where: { shipmentId: shipmentAId },
        orderBy: { id: 'asc' },
      });
      expect(a.map((e) => e.status)).toEqual(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']);
      const b = await prisma.shipmentEvent.findMany({
        where: { shipmentId: shipmentBId },
        orderBy: { id: 'asc' },
      });
      expect(b.map((e) => e.status)).toEqual(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    });
  });
});
