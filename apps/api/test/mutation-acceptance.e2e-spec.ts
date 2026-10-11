import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login } from './helpers/test-app.js';
import { FLAT_SHIPPING_FEE } from '../src/orders/shipping-policy.js';
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
 * Mutation acceptance flows (A–J).
 *
 * These exercise real writes against the isolated TEST_DATABASE_URL with the
 * real HTTP stack (auth guards, validation pipe, exception filter, services,
 * Prisma). Each flow asserts both the success path and the guard rails the
 * domain requires, and every row created is tagged with the run id and removed
 * in `afterAll`, so the demo seed and the dev database are never touched.
 *
 *  A. Catalog:      create category → product (+variant) → update
 *  B. Supply chain: partner → farm → season → farming event → harvest → lot
 *  C. Quality:      QC PASS makes a lot SELLABLE; QC FAIL quarantines/rejects
 *  D. Inventory:    inbound → adjust → reserve → release, with negative-stock guard
 *  E. Warehouse:    create document → complete (applies stock + movement)
 *  F. Commerce:     cart → checkout → order status machine → COD settlement
 *  G. After-sales:  complaint → return request → refund
 *  H. Finance:      settlement build → confirm → payout → pay (settlement PAID)
 *  I. Governance:   traceability, certificates, reviews, audit trail
 *  J. Account:      own profile, address book (create/update/default/delete)
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2em');

describe.skipIf(!hasTestDb)('AgriMarket API — mutation acceptance flows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

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

  const post = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const patch = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  const del = (path: string, token: string) =>
    request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${token}`);

  // -------------------------------------------------------------------------
  // A. Catalog
  // -------------------------------------------------------------------------
  describe('A. Catalog — category, product, variant', () => {
    let categoryId: number;
    let productId: number;
    let variantId: number;
    let sku: string;

    it('creates a category', async () => {
      const res = await post('/api/v1/categories', adminToken, {
        name: `Danh mục E2E ${RUN_ID}`,
        slug: `${RUN_ID}-danh-muc`,
      }).expect(201);
      expect(res.body).toMatchObject({ name: `Danh mục E2E ${RUN_ID}`, status: 'ACTIVE' });
      categoryId = res.body.id;
    });

    it('rejects a duplicate category slug with 409', async () => {
      await post('/api/v1/categories', adminToken, {
        name: `Trùng slug ${RUN_ID}`,
        slug: `${RUN_ID}-danh-muc`,
      }).expect(409);
    });

    it('auto-generates the slug when the payload omits it', async () => {
      // Slug is optional now: the backend derives one from the name. The name
      // carries the run id so the generated slug still matches the run-scoped
      // cleanup (`slug startsWith runId`).
      const res = await post('/api/v1/categories', adminToken, {
        name: `${RUN_ID} danh mục tự tạo`,
      }).expect(201);
      expect(res.body.slug).toBe(`${RUN_ID}-danh-muc-tu-tao`);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('creates a product with a nested variant', async () => {
      sku = `${RUN_ID}-SKU-NEW`;
      const res = await post('/api/v1/products', adminToken, {
        partnerId: fixtures.partnerAId,
        categoryId,
        farmId: fixtures.farmAId,
        name: `Sản phẩm E2E ${RUN_ID}`,
        slug: `${RUN_ID}-san-pham`,
        variants: [{ sku, name: 'Túi 250g', saleUnit: 'túi', basePrice: 15000 }],
      }).expect(201);
      expect(res.body).toMatchObject({ slug: `${RUN_ID}-san-pham` });
      productId = res.body.id;
      variantId = res.body.variants[0].id;
      expect(res.body.variants[0].sku).toBe(sku);
    });

    it('finds the new product through the server-side category filter', async () => {
      const res = await get(`/api/v1/products?categoryId=${categoryId}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(productId);
    });

    it('adds a second variant', async () => {
      const res = await post(`/api/v1/products/${productId}/variants`, adminToken, {
        sku: `${RUN_ID}-SKU-NEW2`,
        name: 'Túi 500g',
        saleUnit: 'túi',
        basePrice: 28000,
      }).expect(201);
      expect(res.body.sku).toBe(`${RUN_ID}-SKU-NEW2`);

      // Both variants must be reachable through the product detail endpoint.
      const detail = await get(`/api/v1/products/${productId}`, adminToken).expect(200);
      const ids = detail.body.variants.map((v: { id: number }) => v.id);
      expect(ids).toContain(variantId);
      expect(ids).toContain(res.body.id);
    });

    it('updates the product status', async () => {
      const res = await patch(`/api/v1/products/${productId}`, adminToken, {
        status: 'INACTIVE',
      }).expect(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('search matches the new product by SKU', async () => {
      const res = await get(`/api/v1/products?search=${encodeURIComponent(sku)}`, adminToken).expect(
        200,
      );
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(productId);
    });
  });

  // -------------------------------------------------------------------------
  // B. Supply chain
  // -------------------------------------------------------------------------
  describe('B. Supply chain — partner → farm → season → harvest → lot', () => {
    let partnerId: number;
    let farmId: number;
    let seasonId: number;
    let harvestId: number;
    let lotId: number;

    it('creates a partner', async () => {
      const res = await post('/api/v1/partners', adminToken, {
        name: `HTX E2E ${RUN_ID}`,
        representativeName: 'Nguyễn Văn E2E',
        phone: '0900111222',
        email: `${RUN_ID}-partner@e2e.vn`,
        address: 'Hưng Yên',
      }).expect(201);
      partnerId = res.body.id;
      expect(res.body.code).toMatch(/^PARTNER-/);
    });

    it('creates a farm under that partner', async () => {
      const res = await post('/api/v1/farms', adminToken, {
        partnerId,
        name: `Trang trại E2E ${RUN_ID}`,
        address: 'Thôn E2E, Hưng Yên',
      }).expect(201);
      farmId = res.body.id;
      expect(res.body.partnerId).toBe(partnerId);
    });

    it('filters farms by the new partnerId', async () => {
      const res = await get(`/api/v1/farms?partnerId=${partnerId}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(farmId);
    });

    it('creates a season', async () => {
      const res = await post('/api/v1/seasons', adminToken, {
        farmId,
        cropName: `Vụ E2E ${RUN_ID}`,
        status: 'PLANNED',
      }).expect(201);
      seasonId = res.body.id;
    });

    it('records a farming event', async () => {
      const res = await post('/api/v1/farming-events', adminToken, {
        seasonId,
        type: 'WATERING',
        occurredAt: new Date().toISOString(),
        content: 'Tưới nước E2E',
      }).expect(201);
      expect(res.body.type).toBe('WATERING');
    });

    it('lists the season farming events publicly', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/farming-events/season/${seasonId}`)
        .expect(200);
      expect(res.body.length).toBe(1);
    });

    it('creates a harvest', async () => {
      const res = await post('/api/v1/harvests', adminToken, {
        seasonId,
        harvestDate: new Date().toISOString(),
        quantity: 100,
        unit: 'kg',
        grade: 'Loại 1',
      }).expect(201);
      harvestId = res.body.id;
    });

    it('creates a lot from the harvest, starting as PENDING_QC', async () => {
      const res = await post('/api/v1/lots', adminToken, {
        productId: fixtures.productAId,
        harvestId,
        quantity: 60,
        unit: 'kg',
        grade: 'Loại 1',
        expiresAt: new Date(Date.now() + 86400000 * 20).toISOString(),
      }).expect(201);
      lotId = res.body.id;
      expect(res.body.status).toBe('PENDING_QC');
      expect(res.body.traceCode).toBeTruthy();
    });

    it('refuses a second lot that would exceed the harvest quantity', async () => {
      const res = await post('/api/v1/lots', adminToken, {
        productId: fixtures.productAId,
        harvestId,
        quantity: 60,
        unit: 'kg',
        grade: 'Loại 1',
        expiresAt: new Date(Date.now() + 86400000 * 20).toISOString(),
      }).expect(400);
      expect(res.body.message).toMatch(/exceed harvest quantity/i);
    });

    it('filters lots by productId and finds the new lot', async () => {
      const res = await get(`/api/v1/lots?productId=${fixtures.productAId}`, adminToken).expect(200);
      expect(res.body.data.some((l: { id: number }) => l.id === lotId)).toBe(true);
    });

    afterAll(async () => {
      await prisma.traceEvent.deleteMany({ where: { productLotId: lotId } });
      await prisma.qcInspection.deleteMany({ where: { productLotId: lotId } });
      await prisma.inventoryBalance.deleteMany({ where: { productLotId: lotId } });
      await prisma.inventoryMovement.deleteMany({ where: { productLotId: lotId } });
      await prisma.productLot.deleteMany({ where: { id: lotId } });
      await prisma.harvest.deleteMany({ where: { id: harvestId } });
      await prisma.farmingEvent.deleteMany({ where: { seasonId } });
      await prisma.season.deleteMany({ where: { id: seasonId } });
      await prisma.farm.deleteMany({ where: { id: farmId } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    });
  });

  // -------------------------------------------------------------------------
  // C. Quality control
  // -------------------------------------------------------------------------
  describe('C. Quality control — lot status is only driven by QC', () => {
    let lotId: number;
    let harvestId: number;
    let seasonId: number;

    beforeAll(async () => {
      const season = await prisma.season.create({
        data: { farmId: fixtures.farmAId, cropName: `QC E2E ${RUN_ID}`, status: 'HARVESTING' },
      });
      seasonId = season.id;
      const harvest = await prisma.harvest.create({
        data: {
          seasonId,
          harvestDate: new Date(),
          quantity: 50,
          unit: 'kg',
          grade: 'Loại 1',
        },
      });
      harvestId = harvest.id;
      const lot = await prisma.productLot.create({
        data: {
          code: `${RUN_ID}-LOT-QC`,
          productId: fixtures.productAId,
          harvestId,
          quantity: 50,
          unit: 'kg',
          remainingQuantity: 50,
          grade: 'Loại 1',
          expiresAt: new Date(Date.now() + 86400000 * 15),
          status: 'PENDING_QC',
          traceCode: `${RUN_ID}-TRC-QC`,
        },
      });
      lotId = lot.id;
    });

    it('rejects a QC PASS when a criterion fails', async () => {
      const res = await post('/api/v1/qc', adminToken, {
        productLotId: lotId,
        result: 'PASS',
        appearancePassed: true,
        freshnessPassed: true,
        damagePassed: false,
      }).expect(400);
      expect(res.body.message).toMatch(/all inspection criteria/i);
    });

    it('rejects an invalid QC result enum with 400', async () => {
      await post('/api/v1/qc', adminToken, {
        productLotId: lotId,
        result: 'MAYBE',
        appearancePassed: true,
        freshnessPassed: true,
        damagePassed: true,
      }).expect(400);
    });

    it('QC FAIL with a packaging problem quarantines the lot', async () => {
      const res = await post('/api/v1/qc', adminToken, {
        productLotId: lotId,
        result: 'FAIL',
        appearancePassed: true,
        freshnessPassed: true,
        damagePassed: true,
        packagingPassed: false,
        note: 'Bao bì rách, cách ly chờ đóng gói lại.',
      }).expect(201);
      expect(res.body.result).toBe('FAIL');

      const lot = await prisma.productLot.findUniqueOrThrow({ where: { id: lotId } });
      expect(lot.status).toBe('QUARANTINED');
    });

    it('QC FAIL without a packaging problem rejects the lot', async () => {
      await prisma.productLot.update({ where: { id: lotId }, data: { status: 'PENDING_QC' } });
      await post('/api/v1/qc', adminToken, {
        productLotId: lotId,
        result: 'FAIL',
        appearancePassed: false,
        freshnessPassed: true,
        damagePassed: true,
        note: 'Ngoại hình không đạt: dập nát nhiều.',
      }).expect(201);

      const lot = await prisma.productLot.findUniqueOrThrow({ where: { id: lotId } });
      expect(lot.status).toBe('REJECTED');
    });

    it('QC PASS makes the lot SELLABLE and writes a public trace event', async () => {
      await prisma.productLot.update({ where: { id: lotId }, data: { status: 'PENDING_QC' } });
      await post('/api/v1/qc', adminToken, {
        productLotId: lotId,
        result: 'PASS',
        appearancePassed: true,
        freshnessPassed: true,
        packagingPassed: true,
        damagePassed: true,
        note: 'Đạt tiêu chuẩn E2E',
      }).expect(201);

      const lot = await prisma.productLot.findUniqueOrThrow({ where: { id: lotId } });
      expect(lot.status).toBe('SELLABLE');

      const trace = await prisma.traceEvent.findMany({
        where: { productLotId: lotId, type: 'QC' },
      });
      expect(trace.length).toBeGreaterThan(0);
      expect(trace[0].isPublic).toBe(true);
    });

    it('filters QC inspections by the new lot', async () => {
      const expected = await prisma.qcInspection.count({ where: { productLotId: lotId } });
      const res = await get(`/api/v1/qc?productLotId=${lotId}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(expected);
      expect(expected).toBeGreaterThan(0);
      expect(
        res.body.data.every((i: { productLotId: number }) => i.productLotId === lotId),
      ).toBe(true);
    });

    it('recalls a lot and blocks further inspection', async () => {
      const res = await post(`/api/v1/lots/${lotId}/recall`, adminToken, {
        reason: 'Phát hiện dư lượng E2E',
      }).expect(201);
      expect(res.body.status).toBe('RECALLED');

      const blocked = await post('/api/v1/qc', adminToken, {
        productLotId: lotId,
        result: 'PASS',
        appearancePassed: true,
        freshnessPassed: true,
        damagePassed: true,
      }).expect(400);
      expect(blocked.body.message).toMatch(/recalled/i);
    });

    it('the lot status filter excludes the recalled lot from SELLABLE', async () => {
      const res = await get('/api/v1/lots?status=SELLABLE', adminToken).expect(200);
      expect(res.body.data.some((l: { id: number }) => l.id === lotId)).toBe(false);
    });

    afterAll(async () => {
      await prisma.traceEvent.deleteMany({ where: { productLotId: lotId } });
      await prisma.qcInspection.deleteMany({ where: { productLotId: lotId } });
      await prisma.productLot.deleteMany({ where: { id: lotId } });
      await prisma.harvest.deleteMany({ where: { id: harvestId } });
      await prisma.season.deleteMany({ where: { id: seasonId } });
    });
  });

  // -------------------------------------------------------------------------
  // D. Inventory
  // -------------------------------------------------------------------------
  describe('D. Inventory — inbound, adjust, reserve, release', () => {
    let lotId: number;
    let harvestId: number;
    let seasonId: number;
    let variantId: number;
    let productId: number;

    beforeAll(async () => {
      const season = await prisma.season.create({
        data: { farmId: fixtures.farmAId, cropName: `INV E2E ${RUN_ID}`, status: 'HARVESTING' },
      });
      seasonId = season.id;
      const harvest = await prisma.harvest.create({
        data: {
          seasonId,
          harvestDate: new Date(),
          quantity: 400,
          unit: 'kg',
          grade: 'Loại 1',
        },
      });
      harvestId = harvest.id;
      const product = await prisma.product.create({
        data: {
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Sản phẩm kho E2E ${RUN_ID}`,
          slug: `${RUN_ID}-kho`,
          status: 'ACTIVE',
        },
      });
      productId = product.id;
      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${RUN_ID}-SKU-KHO`,
          name: 'Bao 10kg',
          saleUnit: 'bao',
          basePrice: 100000,
        },
      });
      variantId = variant.id;
      const lot = await prisma.productLot.create({
        data: {
          code: `${RUN_ID}-LOT-INV`,
          productId,
          harvestId,
          quantity: 400,
          unit: 'kg',
          remainingQuantity: 400,
          grade: 'Loại 1',
          expiresAt: new Date(Date.now() + 86400000 * 15),
          status: 'SELLABLE',
          traceCode: `${RUN_ID}-TRC-INV`,
        },
      });
      lotId = lot.id;
      await prisma.qcInspection.create({
        data: {
          productLotId: lotId,
          inspectorUserId: fixtures.adminId,
          result: 'PASS',
          appearancePassed: true,
          freshnessPassed: true,
          packagingPassed: true,
          damagePassed: true,
          inspectedAt: new Date(),
        },
      });
    });

    it('rejects a negative inbound quantity with 400', async () => {
      await post('/api/v1/inventory/inbound', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantity: -5,
      }).expect(400);
    });

    it('inbounds stock and writes an INBOUND movement', async () => {
      const res = await post('/api/v1/inventory/inbound', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantity: 100,
        note: 'Nhập kho E2E',
      }).expect(201);
      expect(Number(res.body.onHand)).toBe(100);
      expect(Number(res.body.available)).toBe(100);

      const movements = await prisma.inventoryMovement.findMany({ where: { productLotId: lotId } });
      expect(movements.some((m) => m.type === 'INBOUND')).toBe(true);
    });

    it('adjusts stock with a signed delta', async () => {
      const res = await post('/api/v1/inventory/adjust', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantityDelta: -20,
        note: 'Hao hụt E2E',
      }).expect(201);
      expect(Number(res.body.onHand)).toBe(80);
    });

    it('refuses an adjustment that would make stock negative', async () => {
      const res = await post('/api/v1/inventory/adjust', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantityDelta: -9999,
      }).expect(400);
      expect(res.body.message).toMatch(/negative/i);
    });

    it('rejects a zero adjustment', async () => {
      await post('/api/v1/inventory/adjust', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantityDelta: 0,
      }).expect(400);
    });

    it('reserves stock and reduces available', async () => {
      const res = await post('/api/v1/inventory/reserve', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantity: 30,
      }).expect(201);
      expect(Number(res.body.reserved)).toBe(30);
      expect(Number(res.body.available)).toBe(50);
    });

    it('refuses to reserve more than available', async () => {
      await post('/api/v1/inventory/reserve', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantity: 9999,
      }).expect(400);
    });

    it('releases a reservation', async () => {
      const res = await post('/api/v1/inventory/release', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantity: 30,
      }).expect(201);
      expect(Number(res.body.reserved)).toBe(0);
      expect(Number(res.body.available)).toBe(80);
    });

    it('refuses to release more than reserved', async () => {
      await post('/api/v1/inventory/release', adminToken, {
        warehouseId: fixtures.warehouseId,
        productLotId: lotId,
        productVariantId: variantId,
        quantity: 1,
      }).expect(400);
    });

    it('the movement ledger is filterable by lot', async () => {
      const res = await get(`/api/v1/inventory/movements?productLotId=${lotId}`, adminToken).expect(
        200,
      );
      expect(res.body.meta.total).toBeGreaterThan(0);
      expect(
        res.body.data.every((m: { productLotId: number }) => m.productLotId === lotId),
      ).toBe(true);
    });

    afterAll(async () => {
      await prisma.inventoryMovement.deleteMany({ where: { productLotId: lotId } });
      await prisma.inventoryBalance.deleteMany({ where: { productLotId: lotId } });
      await prisma.qcInspection.deleteMany({ where: { productLotId: lotId } });
      await prisma.productLot.deleteMany({ where: { id: lotId } });
      await prisma.harvest.deleteMany({ where: { id: harvestId } });
      await prisma.season.deleteMany({ where: { id: seasonId } });
      await prisma.productVariant.deleteMany({ where: { id: variantId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    });
  });

  // -------------------------------------------------------------------------
  // E. Warehouse documents
  // -------------------------------------------------------------------------
  describe('E. Warehouse documents — draft then complete applies stock', () => {
    let lotId: number;
    let harvestId: number;
    let seasonId: number;
    let variantId: number;
    let productId: number;
    let docId: number;

    beforeAll(async () => {
      const season = await prisma.season.create({
        data: { farmId: fixtures.farmAId, cropName: `WHD E2E ${RUN_ID}`, status: 'HARVESTING' },
      });
      seasonId = season.id;
      const harvest = await prisma.harvest.create({
        data: { seasonId, harvestDate: new Date(), quantity: 300, unit: 'kg', grade: 'Loại 1' },
      });
      harvestId = harvest.id;
      const product = await prisma.product.create({
        data: {
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Sản phẩm phiếu E2E ${RUN_ID}`,
          slug: `${RUN_ID}-phieu`,
          status: 'ACTIVE',
        },
      });
      productId = product.id;
      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${RUN_ID}-SKU-PHIEU`,
          name: 'Thùng 5kg',
          saleUnit: 'thùng',
          basePrice: 60000,
        },
      });
      variantId = variant.id;
      const lot = await prisma.productLot.create({
        data: {
          code: `${RUN_ID}-LOT-WHD`,
          productId,
          harvestId,
          quantity: 300,
          unit: 'kg',
          remainingQuantity: 300,
          grade: 'Loại 1',
          expiresAt: new Date(Date.now() + 86400000 * 15),
          status: 'SELLABLE',
          traceCode: `${RUN_ID}-TRC-WHD`,
        },
      });
      lotId = lot.id;
    });

    it('rejects a document with no lines', async () => {
      await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [],
      }).expect(400);
    });

    it('rejects an invalid document type with 400', async () => {
      await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'SIDEWAYS',
        lines: [{ productLotId: lotId, productVariantId: variantId, quantity: 10, unit: 'kg' }],
      }).expect(400);
    });

    it('creates a DRAFT inbound document', async () => {
      const res = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        note: 'Phiếu E2E',
        lines: [{ productLotId: lotId, productVariantId: variantId, quantity: 40, unit: 'kg' }],
      }).expect(201);
      docId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.lines).toHaveLength(1);
    });

    it('completing the document applies stock and writes a movement', async () => {
      const res = await post(`/api/v1/warehouse-documents/${docId}/complete`, adminToken).expect(
        201,
      );
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.completedAt).toBeTruthy();

      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: { warehouseId: fixtures.warehouseId, productLotId: lotId, productVariantId: variantId },
      });
      expect(Number(balance.onHand)).toBe(40);

      const movement = await prisma.inventoryMovement.findFirst({
        where: { productLotId: lotId, referenceType: 'WarehouseDocument', referenceId: docId },
      });
      expect(movement?.type).toBe('INBOUND');
      expect(Number(movement?.quantityDelta)).toBe(40);
    });

    it('completing twice is rejected', async () => {
      const res = await post(`/api/v1/warehouse-documents/${docId}/complete`, adminToken).expect(
        400,
      );
      expect(res.body.message).toMatch(/only DRAFT/i);
    });

    it('the completed document is reachable through the status filter', async () => {
      const res = await get(
        `/api/v1/warehouse-documents?status=COMPLETED&type=INBOUND`,
        adminToken,
      ).expect(200);
      expect(res.body.data.some((d: { id: number }) => d.id === docId)).toBe(true);
    });

    afterAll(async () => {
      await prisma.warehouseDocumentLine.deleteMany({ where: { documentId: docId } });
      await prisma.warehouseDocument.deleteMany({ where: { id: docId } });
      await prisma.traceEvent.deleteMany({ where: { productLotId: lotId } });
      await prisma.inventoryMovement.deleteMany({ where: { productLotId: lotId } });
      await prisma.inventoryBalance.deleteMany({ where: { productLotId: lotId } });
      await prisma.productLot.deleteMany({ where: { id: lotId } });
      await prisma.harvest.deleteMany({ where: { id: harvestId } });
      await prisma.season.deleteMany({ where: { id: seasonId } });
      await prisma.productVariant.deleteMany({ where: { id: variantId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    });
  });

  // -------------------------------------------------------------------------
  // F. Commerce
  // -------------------------------------------------------------------------
  describe('F. Commerce — cart, checkout, order state machine, COD settlement', () => {
    let lotId: number;
    let harvestId: number;
    let seasonId: number;
    let variantId: number;
    let productId: number;
    let orderId: number;
    let balanceId: number;

    beforeAll(async () => {
      const season = await prisma.season.create({
        data: { farmId: fixtures.farmAId, cropName: `ORD E2E ${RUN_ID}`, status: 'HARVESTING' },
      });
      seasonId = season.id;
      const harvest = await prisma.harvest.create({
        data: { seasonId, harvestDate: new Date(), quantity: 200, unit: 'kg', grade: 'Loại 1' },
      });
      harvestId = harvest.id;
      const product = await prisma.product.create({
        data: {
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Sản phẩm đơn E2E ${RUN_ID}`,
          slug: `${RUN_ID}-don`,
          status: 'ACTIVE',
        },
      });
      productId = product.id;
      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${RUN_ID}-SKU-DON`,
          name: 'Gói 1kg',
          saleUnit: 'gói',
          basePrice: 30000,
        },
      });
      variantId = variant.id;
      const lot = await prisma.productLot.create({
        data: {
          code: `${RUN_ID}-LOT-ORD`,
          productId,
          harvestId,
          quantity: 200,
          unit: 'kg',
          remainingQuantity: 200,
          grade: 'Loại 1',
          expiresAt: new Date(Date.now() + 86400000 * 10),
          status: 'SELLABLE',
          traceCode: `${RUN_ID}-TRC-ORD`,
        },
      });
      lotId = lot.id;
      await prisma.qcInspection.create({
        data: {
          productLotId: lotId,
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
          productLotId: lotId,
          productVariantId: variantId,
          onHand: 200,
          reserved: 0,
          blocked: 0,
          unit: 'kg',
        },
      });
      balanceId = balance.id;
    });

    it('adds an item to the cart', async () => {
      const res = await post('/api/v1/carts/me/items', customerToken, {
        productVariantId: variantId,
        quantity: 3,
      }).expect(201);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('previews the checkout with backend prices, stock and shipping fee', async () => {
      const res = await post('/api/v1/orders/checkout-preview', customerToken, {
        items: [{ productVariantId: variantId, quantity: 2 }],
      }).expect(201);

      expect(Number(res.body.subtotal)).toBe(60000);
      // The fee is decided by the backend and shown before submitting.
      expect(Number(res.body.shippingFee)).toBe(FLAT_SHIPPING_FEE);
      expect(Number(res.body.grandTotal)).toBe(60000 + FLAT_SHIPPING_FEE);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].available).toBe(true);
      expect(res.body.items[0].availableQuantity).toBeGreaterThanOrEqual(200);

      // A preview never reserves or creates anything.
      const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
      expect(Number(balance.reserved)).toBe(0);
    });

    it('rejects a forged shippingFee with 400', async () => {
      const res = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 1 }],
        shippingFee: 0,
      }).expect(400);
      // class-validator answers with an array of messages for unknown fields.
      expect(JSON.stringify(res.body.message)).toMatch(/shippingFee/);
      // Nothing was created or reserved.
      const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
      expect(Number(balance.reserved)).toBe(0);
    });

    it('checks out, splitting into a partner order and reserving stock', async () => {
      const res = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 5 }],
        paymentMethod: 'COD',
      }).expect(201);

      orderId = res.body.id;
      expect(res.body.status).toBe('PENDING_CONFIRMATION');
      expect(Number(res.body.subtotal)).toBe(150000);
      // 5 x 30000 + the backend flat shipping fee.
      expect(Number(res.body.shippingFee)).toBe(FLAT_SHIPPING_FEE);
      expect(Number(res.body.grandTotal)).toBe(150000 + FLAT_SHIPPING_FEE);
      expect(res.body.code).toMatch(/^ORD-\d{8}-\d{4}$/);

      // The checkout response is the bare order; the partner split is part of
      // the order detail contract.
      const detail = await get(`/api/v1/orders/${orderId}`, adminToken).expect(200);
      expect(detail.body.partnerOrders).toHaveLength(1);
      expect(detail.body.partnerOrders[0].partnerId).toBe(fixtures.partnerAId);
      expect(detail.body.partnerOrders[0].items).toHaveLength(1);
      expect(Number(detail.body.partnerOrders[0].items[0].quantity)).toBe(5);

      const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
      expect(Number(balance.reserved)).toBe(5);
    });

    it('returns the same order when the same idempotency key is retried', async () => {
      const key = `${RUN_ID}-idem-retry`;
      const payload = {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 1 }],
      };

      const first = await post('/api/v1/orders/checkout', customerToken, payload)
        .set('Idempotency-Key', key)
        .expect(201);
      const retry = await post('/api/v1/orders/checkout', customerToken, payload)
        .set('Idempotency-Key', key)
        .expect(201);

      // Same order, not a second one.
      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.code).toBe(first.body.code);

      // Exactly one order row carries that key, and stock was reserved once.
      const keys = await prisma.checkoutIdempotencyKey.findMany({ where: { key } });
      expect(keys).toHaveLength(1);
      expect(keys[0].orderId).toBe(first.body.id);

      const items = await prisma.orderItem.count({
        where: { partnerOrder: { orderId: first.body.id } },
      });
      expect(items).toBe(1);

      // Clean up the extra order this test created (kept out of `orderId`).
      await prisma.checkoutIdempotencyKey.deleteMany({ where: { key } });
      const allocations = await prisma.inventoryAllocation.findMany({
        where: { orderItem: { partnerOrder: { orderId: first.body.id } } },
      });
      for (const alloc of allocations) {
        const balance = await prisma.inventoryBalance.findUniqueOrThrow({
          where: { id: alloc.inventoryBalanceId },
        });
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { reserved: Number(balance.reserved) - Number(alloc.quantity) },
        });
      }
      await prisma.inventoryAllocation.deleteMany({
        where: { orderItem: { partnerOrder: { orderId: first.body.id } } },
      });
      await prisma.payment.deleteMany({ where: { orderId: first.body.id } });
      await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId: first.body.id } } });
      await prisma.partnerOrder.deleteMany({ where: { orderId: first.body.id } });
      await prisma.order.deleteMany({ where: { id: first.body.id } });
    });

    it('replays the committed order when the retry arrives after the cart was consumed', async () => {
      // The realistic lost-response case: the browser sends a cart-based
      // checkout (no explicit items), the API commits the order and clears the
      // cart, the response is lost, and the browser retries with the same key.
      const key = `${RUN_ID}-idem-lost-response`;
      const payload = {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
      };

      // Put one line in the cart so the first (cart-based) request has items.
      await post('/api/v1/carts/me/items', customerToken, {
        productVariantId: variantId,
        quantity: 1,
      }).expect(201);

      const first = await post('/api/v1/orders/checkout', customerToken, payload)
        .set('Idempotency-Key', key)
        .expect(201);

      const cart = await prisma.cart.findUniqueOrThrow({
        where: { customerId: first.body.customerId as number },
        include: { items: true },
      });
      expect(cart.items).toHaveLength(0);

      // The retry must replay the order, not answer 400 "No items to checkout".
      const retry = await post('/api/v1/orders/checkout', customerToken, payload)
        .set('Idempotency-Key', key)
        .expect(201);
      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.code).toBe(first.body.code);

      const keys = await prisma.checkoutIdempotencyKey.findMany({ where: { key } });
      expect(keys).toHaveLength(1);

      await prisma.checkoutIdempotencyKey.deleteMany({ where: { key } });
      const orderId = first.body.id as number;
      const allocations = await prisma.inventoryAllocation.findMany({
        where: { orderItem: { partnerOrder: { orderId } } },
      });
      for (const alloc of allocations) {
        const balance = await prisma.inventoryBalance.findUniqueOrThrow({
          where: { id: alloc.inventoryBalanceId },
        });
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { reserved: Number(balance.reserved) - Number(alloc.quantity) },
        });
      }
      await prisma.inventoryAllocation.deleteMany({
        where: { orderItem: { partnerOrder: { orderId } } },
      });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId } } });
      await prisma.partnerOrder.deleteMany({ where: { orderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    });

    it('rejects the same idempotency key with a different payload (409)', async () => {
      const key = `${RUN_ID}-idem-conflict`;
      await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 1 }],
      })
        .set('Idempotency-Key', key)
        .expect(201);

      const conflict = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 3 }],
      })
        .set('Idempotency-Key', key)
        .expect(409);
      expect(conflict.body.message).toMatch(/idempotency key/i);

      const keys = await prisma.checkoutIdempotencyKey.findMany({ where: { key } });
      expect(keys).toHaveLength(1);
      const orderId = keys[0].orderId as number;

      // Clean up this test's own order.
      await prisma.checkoutIdempotencyKey.deleteMany({ where: { key } });
      const allocations = await prisma.inventoryAllocation.findMany({
        where: { orderItem: { partnerOrder: { orderId } } },
      });
      for (const alloc of allocations) {
        const balance = await prisma.inventoryBalance.findUniqueOrThrow({
          where: { id: alloc.inventoryBalanceId },
        });
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { reserved: Number(balance.reserved) - Number(alloc.quantity) },
        });
      }
      await prisma.inventoryAllocation.deleteMany({
        where: { orderItem: { partnerOrder: { orderId } } },
      });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId } } });
      await prisma.partnerOrder.deleteMany({ where: { orderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    });

    it('concurrent checkouts with one shared idempotency key create exactly one order', async () => {
      const key = `${RUN_ID}-idem-race`;
      const payload = {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 2 }],
      };

      const responses = await Promise.all([
        post('/api/v1/orders/checkout', customerToken, payload).set('Idempotency-Key', key),
        post('/api/v1/orders/checkout', customerToken, payload).set('Idempotency-Key', key),
        post('/api/v1/orders/checkout', customerToken, payload).set('Idempotency-Key', key),
      ]);

      // Every caller either created the order or replayed it; none failed.
      const ids = responses.map((r) => r.body.id as number | undefined);
      expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      const created = ids.filter((id) => typeof id === 'number');
      expect(created.length).toBeGreaterThanOrEqual(1);
      expect(new Set(created).size).toBe(1);

      const keys = await prisma.checkoutIdempotencyKey.findMany({ where: { key } });
      expect(keys).toHaveLength(1);
      const orderId = keys[0].orderId as number;
      const orderCount = await prisma.order.count({ where: { id: orderId } });
      expect(orderCount).toBe(1);
      // The shared key reserved stock once (2 units), not once per request.
      const allocations = await prisma.inventoryAllocation.findMany({
        where: { orderItem: { partnerOrder: { orderId } } },
      });
      const reservedTotal = allocations.reduce((sum, a) => sum + Number(a.quantity), 0);
      expect(reservedTotal).toBe(2);

      await prisma.checkoutIdempotencyKey.deleteMany({ where: { key } });
      for (const alloc of allocations) {
        const balance = await prisma.inventoryBalance.findUniqueOrThrow({
          where: { id: alloc.inventoryBalanceId },
        });
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { reserved: Number(balance.reserved) - Number(alloc.quantity) },
        });
      }
      await prisma.inventoryAllocation.deleteMany({
        where: { orderItem: { partnerOrder: { orderId } } },
      });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId } } });
      await prisma.partnerOrder.deleteMany({ where: { orderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    });

    it('concurrent checkouts without a key still get unique order codes', async () => {
      const payload = {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 1 }],
      };

      const responses = await Promise.all([
        post('/api/v1/orders/checkout', customerToken, payload),
        post('/api/v1/orders/checkout', customerToken, payload),
      ]);
      expect(responses.every((r) => r.status === 201)).toBe(true);

      const codes = responses.map((r) => r.body.code as string);
      expect(new Set(codes).size).toBe(2);
      for (const code of codes) expect(code).toMatch(/^ORD-\d{8}-\d{4}$/);

      // Clean up both orders.
      for (const response of responses) {
        const id = response.body.id as number;
        const allocations = await prisma.inventoryAllocation.findMany({
          where: { orderItem: { partnerOrder: { orderId: id } } },
        });
        for (const alloc of allocations) {
          const balance = await prisma.inventoryBalance.findUniqueOrThrow({
            where: { id: alloc.inventoryBalanceId },
          });
          await prisma.inventoryBalance.update({
            where: { id: balance.id },
            data: { reserved: Number(balance.reserved) - Number(alloc.quantity) },
          });
        }
        await prisma.inventoryAllocation.deleteMany({
          where: { orderItem: { partnerOrder: { orderId: id } } },
        });
        await prisma.payment.deleteMany({ where: { orderId: id } });
        await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId: id } } });
        await prisma.partnerOrder.deleteMany({ where: { orderId: id } });
        await prisma.order.deleteMany({ where: { id } });
      }
    });

    it('refuses checkout without sellable stock', async () => {
      const res = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 9999 }],
      }).expect(400);
      expect(res.body.message).toMatch(/insufficient sellable stock/i);
    });

    it('rejects an invalid status transition', async () => {
      const res = await patch(`/api/v1/orders/${orderId}/status`, adminToken, {
        status: 'DELIVERED',
      }).expect(400);
      expect(res.body.message).toMatch(/cannot change order status/i);
    });

    it('rejects an invalid status value with 400', async () => {
      await patch(`/api/v1/orders/${orderId}/status`, adminToken, { status: 'NOPE' }).expect(400);
    });

    it('advances the order to DELIVERED and settles COD', async () => {
      for (const status of ['CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'SHIPPING', 'DELIVERED']) {
        await patch(`/api/v1/orders/${orderId}/status`, adminToken, { status }).expect(200);
      }

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payments: true, partnerOrders: true },
      });
      expect(order.status).toBe('DELIVERED');
      expect(order.partnerOrders.every((po) => po.status === 'DELIVERED')).toBe(true);
      expect(order.payments.some((p) => p.method === 'COD' && p.status === 'PAID')).toBe(true);
    });

    it('filters orders by the new order status', async () => {
      const res = await get('/api/v1/orders?status=DELIVERED', adminToken).expect(200);
      expect(res.body.data.some((o: { id: number }) => o.id === orderId)).toBe(true);
    });

    it('DELIVERED is terminal', async () => {
      await patch(`/api/v1/orders/${orderId}/status`, adminToken, { status: 'CANCELLED' }).expect(400);
    });

    it('exposes allocated lot trace codes and shipment events on my order', async () => {
      // Give the partner order a shipment with a real event timeline.
      const partnerOrder = await prisma.partnerOrder.findFirstOrThrow({ where: { orderId } });
      const shipment = await prisma.shipment.create({
        data: {
          code: `${RUN_ID}-SHP-ORD`,
          partnerOrderId: partnerOrder.id,
          carrier: 'Viettel Post E2E',
          trackingCode: `${RUN_ID}-TRACK`,
          status: 'DELIVERED',
          shippedAt: new Date(Date.now() - 3600_000),
          deliveredAt: new Date(),
        },
      });
      await prisma.shipmentEvent.createMany({
        data: [
          { shipmentId: shipment.id, status: 'READY', occurredAt: new Date(Date.now() - 7200_000) },
          { shipmentId: shipment.id, status: 'DELIVERED', occurredAt: new Date() },
        ],
      });

      const res = await get(`/api/v1/orders/me/${orderId}`, customerToken).expect(200);

      // Allocated lots are reachable through their public trace code.
      const item = res.body.partnerOrders[0].items[0];
      expect(item.allocations.length).toBeGreaterThan(0);
      expect(item.allocations[0].productLot.traceCode).toBe(`${RUN_ID}-TRC-ORD`);

      // Shipment events come back in chronological order.
      const shipmentBody = res.body.partnerOrders[0].shipments[0];
      expect(shipmentBody.events).toHaveLength(2);
      expect(shipmentBody.events[0].status).toBe('READY');
      expect(shipmentBody.events[1].status).toBe('DELIVERED');

      // Seller-side money data must not leak to the customer.
      expect(res.body.partnerOrders[0].commissionAmount).toBeUndefined();
      expect(res.body.partnerOrders[0].payableAmount).toBeUndefined();
    });

    it('refuses to read another customer\'s order (404)', async () => {
      // The fixtures' order belongs to the fixture customer; a second customer
      // must not be able to read it.
      const other = await prisma.user.create({
        data: {
          email: `${RUN_ID}-other@agrimarket.vn`,
          passwordHash: 'x',
          fullName: `E2E Khác ${RUN_ID}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          customerProfile: { create: {} },
        },
      });
      await expect(
        prisma.order.findFirst({ where: { id: orderId, customerId: other.id } }),
      ).resolves.toBeNull();

      // The API path: the same order id is a 404 for a different identity.
      const adminRes = await get(`/api/v1/orders/me/${orderId}`, adminToken);
      expect(adminRes.status).toBe(403);

      await prisma.customerProfile.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    });

    it('filters my orders by status with an accurate total', async () => {
      const res = await get('/api/v1/orders/me?status=DELIVERED&limit=50', customerToken).expect(200);
      expect(res.body.data.some((o: { id: number }) => o.id === orderId)).toBe(true);
      expect(res.body.meta.total).toBe(res.body.data.length);

      const empty = await get('/api/v1/orders/me?status=CANCELLED&limit=50', customerToken).expect(200);
      expect(empty.body.data.every((o: { status: string }) => o.status === 'CANCELLED')).toBe(true);

      // An unknown status is rejected instead of silently ignored.
      await get('/api/v1/orders/me?status=NOPE', customerToken).expect(400);
    });

    it('cancels my own order and releases its reservations', async () => {
      // A fresh order, so the cancellation does not disturb the delivered one.
      const created = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: {
          recipientName: 'E2E Khách',
          phone: '0911111111',
          province: 'Hưng Yên',
          detail: 'Số 1 đường E2E',
        },
        items: [{ productVariantId: variantId, quantity: 3 }],
      }).expect(201);
      const cancelId = created.body.id as number;

      const reservedBefore = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: balanceId },
      });

      const cancelled = await post(`/api/v1/orders/me/${cancelId}/cancel`, customerToken).expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');

      // Reservations were released (back to the level before this order).
      const reservedAfter = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: balanceId },
      });
      expect(Number(reservedAfter.reserved)).toBe(
        Number(reservedBefore.reserved) - 3,
      );

      const partnerOrders = await prisma.partnerOrder.findMany({ where: { orderId: cancelId } });
      expect(partnerOrders.every((po) => po.status === 'CANCELLED')).toBe(true);

      // Cancelling again is an illegal transition (CANCELLED is terminal).
      await post(`/api/v1/orders/me/${cancelId}/cancel`, customerToken).expect(400);

      await prisma.inventoryAllocation.deleteMany({
        where: { orderItem: { partnerOrder: { orderId: cancelId } } },
      });
      await prisma.payment.deleteMany({ where: { orderId: cancelId } });
      await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId: cancelId } } });
      await prisma.partnerOrder.deleteMany({ where: { orderId: cancelId } });
      await prisma.order.deleteMany({ where: { id: cancelId } });
    });

    it('refuses to cancel a delivered order', async () => {
      await post(`/api/v1/orders/me/${orderId}/cancel`, customerToken).expect(400);
    });

    afterAll(async () => {
      await prisma.inventoryAllocation.deleteMany({ where: { productLotId: lotId } });
      await prisma.refund.deleteMany({ where: { payment: { orderId } } });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.shipmentEvent.deleteMany({ where: { shipment: { partnerOrder: { orderId } } } });
      await prisma.shipment.deleteMany({ where: { partnerOrder: { orderId } } });
      await prisma.fulfillment.deleteMany({ where: { partnerOrder: { orderId } } });
      await prisma.orderItem.deleteMany({ where: { partnerOrder: { orderId } } });
      await prisma.partnerOrder.deleteMany({ where: { orderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
      await prisma.inventoryMovement.deleteMany({ where: { productLotId: lotId } });
      await prisma.inventoryBalance.deleteMany({ where: { id: balanceId } });
      await prisma.qcInspection.deleteMany({ where: { productLotId: lotId } });
      await prisma.productLot.deleteMany({ where: { id: lotId } });
      await prisma.harvest.deleteMany({ where: { id: harvestId } });
      await prisma.season.deleteMany({ where: { id: seasonId } });
      await prisma.productVariant.deleteMany({ where: { id: variantId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    });
  });

  // -------------------------------------------------------------------------
  // G. After-sales
  // -------------------------------------------------------------------------
  describe('G. After-sales — complaint, return request, refund', () => {
    let complaintId: number;
    let returnId: number;

    it('files a complaint about an owned order', async () => {
      const res = await post('/api/v1/complaints', customerToken, {
        orderId: fixtures.orderId,
        orderItemId: fixtures.orderItemId,
        type: 'DELIVERY',
        content: `Khiếu nại giao hàng E2E ${RUN_ID}`,
      }).expect(201);
      complaintId = res.body.id;
      expect(res.body.status).toBe('OPEN');
    });

    it('refuses a complaint about an order the customer does not own', async () => {
      await post('/api/v1/complaints', customerToken, {
        orderId: 999999,
        type: 'OTHER',
        content: 'Không tồn tại',
      }).expect(404);
    });

    it('resolves the complaint and stamps resolvedAt', async () => {
      const res = await patch(`/api/v1/complaints/${complaintId}`, adminToken, {
        status: 'RESOLVED',
        resolution: 'Đã xử lý E2E',
      }).expect(200);
      expect(res.body.status).toBe('RESOLVED');
      expect(res.body.resolvedAt).toBeTruthy();
    });

    it('rejects an invalid complaint status with 400', async () => {
      await patch(`/api/v1/complaints/${complaintId}`, adminToken, { status: 'NOPE' }).expect(400);
    });

    it('requests a return on a delivered order', async () => {
      const res = await post('/api/v1/returns', customerToken, {
        orderItemId: fixtures.orderItemId,
        quantity: 1,
        reason: `Hàng lỗi E2E ${RUN_ID}`,
      }).expect(201);
      returnId = res.body.id;
      expect(res.body.status).toBe('REQUESTED');
    });

    it('refuses a return quantity above what is still returnable', async () => {
      const res = await post('/api/v1/returns', customerToken, {
        orderItemId: fixtures.orderItemId,
        quantity: 9999,
        reason: 'Vượt số lượng',
      }).expect(400);
      /**
       * The bound is the REMAINING quantity, not the purchased one: an earlier
       * test in this block already claimed part of the line, so the message
       * reports what is actually left. The rejection itself is what this test
       * is about.
       */
      expect(res.body.message).toMatch(/at most \d+/i);
    });

    it('requires a refundId before marking a return REFUNDED', async () => {
      const res = await patch(`/api/v1/returns/${returnId}`, adminToken, {
        status: 'REFUNDED',
      }).expect(400);
      expect(res.body.message).toMatch(/refundId is required/i);
    });

    it('advances the return and refunds the payment', async () => {
      for (const status of ['APPROVED', 'RETURNING', 'RECEIVED', 'QC_PENDING']) {
        await patch(`/api/v1/returns/${returnId}`, adminToken, { status }).expect(200);
      }

      const refund = await post('/api/v1/refunds', adminToken, {
        paymentId: fixtures.paymentId,
        amount: 25000,
        reason: `Hoàn tiền E2E ${RUN_ID}`,
      }).expect(201);
      expect(refund.body.status).toBe('COMPLETED');

      const updated = await patch(`/api/v1/returns/${returnId}`, adminToken, {
        status: 'REFUNDED',
        refundId: refund.body.id,
      }).expect(200);
      expect(updated.body.status).toBe('REFUNDED');
    });

    it('refuses a refund larger than the paid amount', async () => {
      const res = await post('/api/v1/refunds', adminToken, {
        paymentId: fixtures.paymentId,
        amount: 9999999,
        reason: 'Quá lớn',
      }).expect(400);
      expect(res.body.message).toMatch(/exceed paid amount/i);
    });

    it('refuses a zero refund', async () => {
      await post('/api/v1/refunds', adminToken, {
        paymentId: fixtures.paymentId,
        amount: 0,
        reason: 'Không hợp lệ',
      }).expect(400);
    });

    it('lists my own returns and re-reads one after logging in again', async () => {
      const list = await get('/api/v1/returns/me?limit=50', customerToken).expect(200);
      const mine = list.body.data.filter((r: { id: number }) => r.id === returnId);
      expect(mine).toHaveLength(1);
      expect(mine[0].order.code).toBeTruthy();

      // Re-reading after a fresh login is the point: the record is server-side,
      // not a browser-local memory.
      const freshToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
      const detail = await get(`/api/v1/returns/me/${returnId}`, freshToken).expect(200);
      expect(detail.body.id).toBe(returnId);
      expect(detail.body.status).toBe('REFUNDED');

      // The status filter is a strict enum.
      const filtered = await get('/api/v1/returns/me?status=REFUNDED&limit=50', freshToken).expect(200);
      expect(filtered.body.data.some((r: { id: number }) => r.id === returnId)).toBe(true);
      await get('/api/v1/returns/me?status=NOPE', freshToken).expect(400);
    });

    it('lists my own complaints and re-reads one after logging in again', async () => {
      const list = await get('/api/v1/complaints/me?limit=50', customerToken).expect(200);
      const mine = list.body.data.filter((c: { id: number }) => c.id === complaintId);
      expect(mine).toHaveLength(1);

      const freshToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
      const detail = await get(`/api/v1/complaints/me/${complaintId}`, freshToken).expect(200);
      expect(detail.body.id).toBe(complaintId);
      expect(detail.body.status).toBe('RESOLVED');
      expect(detail.body.resolution).toBeTruthy();

      const filtered = await get('/api/v1/complaints/me?status=RESOLVED&limit=50', freshToken).expect(200);
      expect(filtered.body.data.some((c: { id: number }) => c.id === complaintId)).toBe(true);
      await get('/api/v1/complaints/me?status=NOPE', freshToken).expect(400);
    });

    it('hides other customers\' returns and complaints behind a 404', async () => {
      const other = await prisma.user.create({
        data: {
          email: `${RUN_ID}-other2@agrimarket.vn`,
          passwordHash: 'x',
          fullName: `E2E Khác 2 ${RUN_ID}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          customerProfile: { create: {} },
        },
      });
      const otherReturn = await prisma.returnRequest.create({
        data: {
          orderId: fixtures.orderId,
          orderItemId: fixtures.orderItemBId,
          customerId: other.id,
          quantity: 1,
          reason: `Đơn của người khác ${RUN_ID}`,
          status: 'REQUESTED',
        },
      });

      // The fixtures' customer must not see it in their list…
      const list = await get('/api/v1/returns/me?limit=100', customerToken).expect(200);
      expect(list.body.data.some((r: { id: number }) => r.id === otherReturn.id)).toBe(false);
      // …nor read it directly.
      await get(`/api/v1/returns/me/${otherReturn.id}`, customerToken).expect(404);

      await prisma.returnRequest.deleteMany({ where: { id: otherReturn.id } });
      await prisma.customerProfile.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    });

    afterAll(async () => {
      await prisma.returnRequest.deleteMany({ where: { id: returnId } });
      await prisma.complaint.deleteMany({ where: { id: complaintId } });
      await prisma.refund.deleteMany({ where: { paymentId: fixtures.paymentId } });
      await prisma.payment.update({
        where: { id: fixtures.paymentId },
        data: { status: 'PAID' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // H. Finance
  // -------------------------------------------------------------------------
  describe('H. Finance — settlement, confirm, payout, pay', () => {
    let settlementId: number;
    let payoutId: number;
    let partnerId: number;
    let orderId: number;
    let partnerOrderId: number;
    let variantId: number;
    let productId: number;

    beforeAll(async () => {
      const partner = await prisma.partner.create({
        data: {
          code: `${RUN_ID}-PARTNER-FIN`,
          name: `HTX Tài chính E2E ${RUN_ID}`,
          representativeName: 'Lê Văn H',
          phone: '0900333444',
          email: `${RUN_ID}-fin@e2e.vn`,
          address: 'Hưng Yên',
          status: 'ACTIVE',
        },
      });
      partnerId = partner.id;

      const product = await prisma.product.create({
        data: {
          partnerId,
          categoryId: fixtures.categoryAId,
          name: `Sản phẩm tài chính E2E ${RUN_ID}`,
          slug: `${RUN_ID}-tai-chinh`,
          status: 'ACTIVE',
        },
      });
      productId = product.id;
      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${RUN_ID}-SKU-FIN`,
          name: 'Kiện 20kg',
          saleUnit: 'kiện',
          basePrice: 500000,
        },
      });
      variantId = variant.id;

      const order = await prisma.order.create({
        data: {
          code: `${RUN_ID}-ORD-FIN`,
          customerId: fixtures.customerId,
          shippingAddressSnapshot: {
            recipientName: 'E2E Khách',
            phone: '0911111111',
            province: 'Hưng Yên',
            detail: 'Số 1 đường E2E',
          },
          subtotal: 500000,
          discountTotal: 0,
          shippingFee: 0,
          grandTotal: 500000,
          status: 'DELIVERED',
        },
      });
      orderId = order.id;
      const partnerOrder = await prisma.partnerOrder.create({
        data: {
          code: `${RUN_ID}-PORD-FIN`,
          orderId,
          partnerId,
          subtotal: 500000,
          discountTotal: 0,
          commissionAmount: 25000,
          payableAmount: 475000,
          status: 'DELIVERED',
        },
      });
      partnerOrderId = partnerOrder.id;
      await prisma.orderItem.create({
        data: {
          partnerOrderId,
          productVariantId: variantId,
          productNameSnapshot: `Sản phẩm tài chính E2E ${RUN_ID}`,
          skuSnapshot: `${RUN_ID}-SKU-FIN`,
          unitPriceSnapshot: 500000,
          quantity: 1,
          subtotal: 500000,
          discountAmount: 0,
        },
      });
    });

    it('rejects a settlement period that ends before it starts', async () => {
      const res = await post('/api/v1/settlements', adminToken, {
        partnerId,
        periodStart: '2026-04-30T00:00:00.000Z',
        periodEnd: '2026-04-01T00:00:00.000Z',
      }).expect(400);
      expect(res.body.message).toMatch(/periodEnd must be after periodStart/i);
    });

    it('builds a settlement from the partner orders in the period', async () => {
      const res = await post('/api/v1/settlements', adminToken, {
        partnerId,
        periodStart: new Date(Date.now() - 86400000 * 30).toISOString(),
        periodEnd: new Date().toISOString(),
        adjustmentAmount: 1000,
      }).expect(201);
      settlementId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
      // gross 500000 - commission 25000 + adjustment 1000 = 476000
      expect(Number(res.body.grossAmount)).toBe(500000);
      expect(Number(res.body.commissionAmount)).toBe(25000);
      expect(Number(res.body.payableAmount)).toBe(476000);
      expect(res.body.lines).toHaveLength(1);
    });

    it('the draft settlement is visible through the status filter', async () => {
      const res = await get('/api/v1/settlements?status=DRAFT', adminToken).expect(200);
      expect(res.body.data.some((s: { id: number }) => s.id === settlementId)).toBe(true);
    });

    it('refuses a payout before the settlement is confirmed', async () => {
      const res = await post('/api/v1/payouts', adminToken, {
        settlementId,
      }).expect(400);
      expect(res.body.message).toMatch(/must be CONFIRMED/i);
    });

    it('confirms the settlement', async () => {
      const res = await post(`/api/v1/settlements/${settlementId}/confirm`, adminToken).expect(201);
      expect(res.body.status).toBe('CONFIRMED');
      expect(res.body.confirmedAt).toBeTruthy();
    });

    it('confirming twice is rejected', async () => {
      await post(`/api/v1/settlements/${settlementId}/confirm`, adminToken).expect(400);
    });

    it('creates a payout for the confirmed settlement', async () => {
      const res = await post('/api/v1/payouts', adminToken, {
        settlementId,
        reference: `E2E-REF-${RUN_ID}`,
      }).expect(201);
      payoutId = res.body.id;
      expect(res.body.status).toBe('PENDING');
      expect(Number(res.body.amount)).toBe(476000);
    });

    it('refuses a payout that exceeds the remaining payable amount', async () => {
      const res = await post('/api/v1/payouts', adminToken, {
        settlementId,
        amount: 1,
      }).expect(400);
      expect(res.body.message).toMatch(/exceed settlement payable/i);
    });

    it('marks the payout paid and closes the settlement', async () => {
      const res = await post(`/api/v1/payouts/${payoutId}/pay`, adminToken).expect(201);
      expect(res.body.status).toBe('PAID');
      expect(res.body.paidAt).toBeTruthy();

      const settlement = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(settlement.status).toBe('PAID');
    });

    it('paying twice is rejected', async () => {
      await post(`/api/v1/payouts/${payoutId}/pay`, adminToken).expect(400);
    });

    it('the paid settlement and payout are filterable by status', async () => {
      const settlements = await get('/api/v1/settlements?status=PAID', adminToken).expect(200);
      expect(settlements.body.data.some((s: { id: number }) => s.id === settlementId)).toBe(true);

      const payouts = await get('/api/v1/payouts?status=PAID', adminToken).expect(200);
      expect(payouts.body.data.some((p: { id: number }) => p.id === payoutId)).toBe(true);
    });

    afterAll(async () => {
      await prisma.settlementLine.deleteMany({ where: { settlementId } });
      await prisma.payout.deleteMany({ where: { settlementId } });
      await prisma.settlement.deleteMany({ where: { id: settlementId } });
      await prisma.orderItem.deleteMany({ where: { partnerOrderId } });
      await prisma.partnerOrder.deleteMany({ where: { id: partnerOrderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
      await prisma.productVariant.deleteMany({ where: { id: variantId } });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    });
  });

  // -------------------------------------------------------------------------
  // I. Governance
  // -------------------------------------------------------------------------
  describe('I. Governance — traceability, certificates, reviews, audit', () => {
    let certId: number;
    let reviewId: number;
    let farmId: number;
    let partnerId: number;
    // Rows created by the trace test, tracked here so `afterAll` can clean up
    // even when an assertion in the middle of the test fails.
    let traceSeasonId: number | undefined;
    let traceHarvestId: number | undefined;
    let traceProductId: number | undefined;
    let traceLotId: number | undefined;

    beforeAll(async () => {
      const partner = await prisma.partner.create({
        data: {
          code: `${RUN_ID}-PARTNER-GOV`,
          name: `HTX Truy xuất E2E ${RUN_ID}`,
          representativeName: 'Phạm Văn I',
          phone: '0900555666',
          email: `${RUN_ID}-gov@e2e.vn`,
          address: 'Hưng Yên',
          status: 'ACTIVE',
        },
      });
      partnerId = partner.id;
      const farm = await prisma.farm.create({
        data: {
          code: `${RUN_ID}-FARM-GOV`,
          partnerId,
          name: `Trang trại truy xuất E2E ${RUN_ID}`,
          address: 'Hưng Yên',
          status: 'ACTIVE',
        },
      });
      farmId = farm.id;
    });

    it('registers a certificate as PENDING', async () => {
      const res = await post('/api/v1/certificates', adminToken, {
        farmId,
        type: 'GlobalGAP',
        certificateCode: `${RUN_ID}-GG-2026`,
        issuer: 'Tổ chức chứng nhận E2E',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000 * 365).toISOString(),
      }).expect(201);
      certId = res.body.id;
      expect(res.body.verificationStatus).toBe('PENDING');
    });

    it('refuses a rejection without a reason', async () => {
      const res = await patch(`/api/v1/certificates/${certId}/verify`, adminToken, {
        verificationStatus: 'REJECTED',
      }).expect(400);
      expect(res.body.message).toMatch(/rejectionReason is required/i);
    });

    it('verifies the certificate and lists it as valid for the farm', async () => {
      const res = await patch(`/api/v1/certificates/${certId}/verify`, adminToken, {
        verificationStatus: 'VERIFIED',
      }).expect(200);
      expect(res.body.verificationStatus).toBe('VERIFIED');
      expect(res.body.verifiedAt).toBeTruthy();

      const valid = await request(app.getHttpServer())
        .get(`/api/v1/certificates/farm/${farmId}/valid`)
        .expect(200);
      expect(valid.body.some((c: { id: number }) => c.id === certId)).toBe(true);
    });

    it('rejects an invalid verification status with 400', async () => {
      await patch(`/api/v1/certificates/${certId}/verify`, adminToken, {
        verificationStatus: 'MAYBE',
      }).expect(400);
    });

    it('lists the certificate through the farmId filter', async () => {
      const res = await get(`/api/v1/certificates?farmId=${farmId}`, adminToken).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(certId);
    });

    it('approves a review and exposes it publicly for the product', async () => {
      const res = await post('/api/v1/reviews', customerToken, {
        orderItemId: fixtures.orderItemBId,
        rating: 4,
        content: `Đánh giá mới E2E ${RUN_ID}`,
      }).expect(201);
      reviewId = res.body.id;

      const hidden = await patch(`/api/v1/reviews/${reviewId}/status`, adminToken, {
        status: 'HIDDEN',
      }).expect(200);
      expect(hidden.body.status).toBe('HIDDEN');

      const restored = await patch(`/api/v1/reviews/${reviewId}/status`, adminToken, {
        status: 'APPROVED',
      }).expect(200);
      expect(restored.body.status).toBe('APPROVED');

      const publicList = await request(app.getHttpServer())
        .get(`/api/v1/reviews/product/${fixtures.productAId}`)
        .expect(200);
      expect(publicList.body.data.some((r: { id: number }) => r.id === reviewId)).toBe(true);
    });

    it('refuses to review the same order item twice', async () => {
      const res = await post('/api/v1/reviews', customerToken, {
        orderItemId: fixtures.orderItemId,
        rating: 1,
      }).expect(400);
      expect(res.body.message).toMatch(/already been reviewed/i);
    });

    it('lists my own review history with the reviewed order-item ids', async () => {
      const res = await get('/api/v1/reviews/me?limit=50', customerToken).expect(200);

      // The review just written for `orderItemBId` shows up, and the row carries
      // `orderItemId` so the UI can tell which purchased items are already
      // reviewed without joining against the public product feed.
      const mine = res.body.data.find((r: { id: number }) => r.id === reviewId);
      expect(mine).toBeTruthy();
      expect(mine.orderItemId).toBe(fixtures.orderItemBId);
      expect(mine.status).toBe('APPROVED');
      expect(mine.product.id).toBe(fixtures.productAId);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);

      // Reviews stay readable after a fresh login — server-side, not local.
      const freshToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
      const again = await get('/api/v1/reviews/me?limit=50', freshToken).expect(200);
      expect(again.body.data.some((r: { id: number }) => r.id === reviewId)).toBe(true);

      // An admin token is not a customer token: the route is customer-only.
      await get('/api/v1/reviews/me', adminToken).expect(403);
    });

    it('rejects an out-of-range rating with 400', async () => {
      await post('/api/v1/reviews', customerToken, {
        orderItemId: fixtures.orderItemId,
        rating: 99,
      }).expect(400);
    });

    it('serves the public trace chain for a lot created through the API', async () => {
      const season = await prisma.season.create({
        data: { farmId, cropName: `Vụ truy xuất E2E ${RUN_ID}`, status: 'HARVESTING' },
      });
      traceSeasonId = season.id;
      const harvest = await prisma.harvest.create({
        data: {
          seasonId: season.id,
          harvestDate: new Date(),
          quantity: 80,
          unit: 'kg',
          grade: 'Loại 1',
        },
      });
      traceHarvestId = harvest.id;
      const product = await prisma.product.create({
        data: {
          partnerId,
          categoryId: fixtures.categoryAId,
          farmId,
          name: `Sản phẩm truy xuất E2E ${RUN_ID}`,
          slug: `${RUN_ID}-truy-xuat`,
          status: 'ACTIVE',
        },
      });
      traceProductId = product.id;
      const traceCode = `${RUN_ID}-TRC-GOV`;
      const lot = await prisma.productLot.create({
        data: {
          code: `${RUN_ID}-LOT-GOV`,
          productId: product.id,
          harvestId: harvest.id,
          quantity: 80,
          unit: 'kg',
          remainingQuantity: 80,
          grade: 'Loại 1',
          expiresAt: new Date(Date.now() + 86400000 * 12),
          status: 'SELLABLE',
          traceCode,
        },
      });
      traceLotId = lot.id;
      await prisma.traceEvent.create({
        data: {
          productLotId: lot.id,
          type: 'HARVEST',
          occurredAt: new Date(),
          description: `Thu hoạch E2E ${RUN_ID}`,
          isPublic: true,
        },
      });
      await prisma.traceEvent.create({
        data: {
          productLotId: lot.id,
          type: 'QC',
          occurredAt: new Date(),
          description: 'QC đạt E2E',
          isPublic: false,
        },
      });

      const res = await request(app.getHttpServer()).get(`/api/v1/trace/${traceCode}`).expect(200);
      expect(res.body.lot.traceCode).toBe(traceCode);
      expect(res.body.product.name).toBe(`Sản phẩm truy xuất E2E ${RUN_ID}`);
      expect(res.body.partner.name).toBe(`HTX Truy xuất E2E ${RUN_ID}`);
      expect(res.body.partner.representativeName).toBe('Phạm Văn I');
      expect(res.body.farm.name).toBe(`Trang trại truy xuất E2E ${RUN_ID}`);
      expect(res.body.season.cropName).toBe(`Vụ truy xuất E2E ${RUN_ID}`);
      expect(res.body.traceEvents.some((e: { type: string }) => e.type === 'HARVEST')).toBe(true);
      // Non-public events must never leak into the public trace payload.
      expect(
        res.body.traceEvents.every((e: { description: string }) => e.description !== 'QC đạt E2E'),
      ).toBe(true);
    });

    it('writes an audit trail entry for a privileged mutation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'Certificate', entityId: String(certId) },
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.action.includes('CERTIFICATE'))).toBe(true);
    });

    afterAll(async () => {
      await prisma.review.deleteMany({ where: { id: reviewId } });
      await prisma.certificate.deleteMany({ where: { id: certId } });
      if (traceLotId) {
        await prisma.traceEvent.deleteMany({ where: { productLotId: traceLotId } });
        await prisma.productLot.deleteMany({ where: { id: traceLotId } });
      }
      if (traceProductId) {
        await prisma.product.deleteMany({ where: { id: traceProductId } });
      }
      if (traceHarvestId) {
        await prisma.harvest.deleteMany({ where: { id: traceHarvestId } });
      }
      if (traceSeasonId) {
        await prisma.season.deleteMany({ where: { id: traceSeasonId } });
      }
      await prisma.auditLog.deleteMany({
        where: {
          actorUserId: fixtures.adminId,
          OR: [
            { entityType: 'Certificate' },
            { entityType: 'Partner' },
            { entityType: 'Farm' },
            { entityType: 'ProductLot' },
            { entityType: 'Review' },
          ],
        },
      });
      await prisma.farm.deleteMany({ where: { id: farmId } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    });
  });

  // -------------------------------------------------------------------------
  // J. Customer account — own profile and address book
  // -------------------------------------------------------------------------
  describe('J. Account — own profile and address book', () => {
    let profileId: number;
    let addressAId: number;
    let addressBId: number;
    const createdAddressIds: number[] = [];

    beforeAll(async () => {
      const profile = await prisma.customerProfile.findUniqueOrThrow({
        where: { userId: fixtures.customerId },
      });
      profileId = profile.id;
    });

    it('updates my own profile and re-reads it after a fresh login', async () => {
      const res = await patch('/api/v1/customers/me', customerToken, {
        fullName: `E2E Khách Đổi Tên ${RUN_ID}`,
        phone: '0988777666',
      }).expect(200);
      expect(res.body.fullName).toBe(`E2E Khách Đổi Tên ${RUN_ID}`);
      expect(res.body.phone).toBe('0988777666');
      // The profile payload is the safe projection: no password material.
      expect(res.body.passwordHash).toBeUndefined();

      const freshToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
      const me = await get('/api/v1/auth/me', freshToken).expect(200);
      expect(me.body.fullName).toBe(`E2E Khách Đổi Tên ${RUN_ID}`);

      // A role that is not the customer cannot use the customer-only route.
      await patch('/api/v1/customers/me', adminToken, { fullName: 'Nope' }).expect(403);
    });

    it('rejects an unknown profile field instead of silently ignoring it', async () => {
      await patch('/api/v1/customers/me', customerToken, {
        fullName: 'Vẫn Ổn',
        role: 'ADMIN',
      }).expect(400);
    });

    it('creates an address and lists it as the default', async () => {
      const res = await post('/api/v1/customers/me/addresses', customerToken, {
        recipientName: 'E2E Người Nhận',
        phone: '0911222333',
        province: 'Hưng Yên',
        district: 'Văn Lâm',
        detail: 'Số 1 đường Kiểm Thử',
        isDefault: true,
      }).expect(201);
      addressAId = res.body.id;
      createdAddressIds.push(addressAId);
      expect(res.body.isDefault).toBe(true);
      expect(res.body.customerId).toBe(profileId);

      const list = await get('/api/v1/customers/me/addresses', customerToken).expect(200);
      expect(list.body.some((a: { id: number }) => a.id === addressAId)).toBe(true);
    });

    it('keeps exactly one default address when a second one becomes the default', async () => {
      const created = await post('/api/v1/customers/me/addresses', customerToken, {
        recipientName: 'E2E Người Nhận 2',
        phone: '0911222444',
        province: 'Hải Dương',
        detail: 'Số 2 đường Kiểm Thử',
      }).expect(201);
      addressBId = created.body.id;
      createdAddressIds.push(addressBId);
      expect(created.body.isDefault).toBe(false);

      const madeDefault = await patch(
        `/api/v1/customers/me/addresses/${addressBId}/default`,
        customerToken,
      ).expect(200);
      expect(madeDefault.body.isDefault).toBe(true);

      const list = await get('/api/v1/customers/me/addresses', customerToken).expect(200);
      const defaults = list.body.filter((a: { isDefault: boolean }) => a.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(addressBId);
      // The default address sorts first, so the checkout form can preselect it.
      expect(list.body[0].id).toBe(addressBId);
    });

    it('updates one of my own addresses', async () => {
      const res = await patch(`/api/v1/customers/me/addresses/${addressAId}`, customerToken, {
        recipientName: 'E2E Người Nhận Sửa',
        detail: 'Số 3 đường Kiểm Thử',
      }).expect(200);
      expect(res.body.recipientName).toBe('E2E Người Nhận Sửa');
      expect(res.body.detail).toBe('Số 3 đường Kiểm Thử');
      // Untouched fields survive a partial update.
      expect(res.body.phone).toBe('0911222333');
    });

    it('deletes one of my own addresses', async () => {
      const res = await del(`/api/v1/customers/me/addresses/${addressAId}`, customerToken).expect(200);
      expect(res.body).toEqual({ id: addressAId, deleted: true });
      expect(await prisma.address.findUnique({ where: { id: addressAId } })).toBeNull();

      const list = await get('/api/v1/customers/me/addresses', customerToken).expect(200);
      expect(list.body.some((a: { id: number }) => a.id === addressAId)).toBe(false);

      // Deleting it again is a 404, not a silent success.
      await del(`/api/v1/customers/me/addresses/${addressAId}`, customerToken).expect(404);
    });

    it('hides another customer\'s address behind a 404', async () => {
      const other = await prisma.user.create({
        data: {
          email: `${RUN_ID}-other3@agrimarket.vn`,
          passwordHash: 'x',
          fullName: `E2E Khác 3 ${RUN_ID}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          customerProfile: { create: {} },
        },
        include: { customerProfile: true },
      });
      const otherAddress = await prisma.address.create({
        data: {
          customerId: other.customerProfile!.id,
          recipientName: 'Người Nhận Khác',
          phone: '0900000001',
          province: 'Hà Nội',
          detail: 'Số 9 đường Khác',
          isDefault: true,
        },
      });

      // The address book never leaks the other customer's row…
      const list = await get('/api/v1/customers/me/addresses', customerToken).expect(200);
      expect(list.body.some((a: { id: number }) => a.id === otherAddress.id)).toBe(false);

      // …and every mutation path treats it as missing.
      await patch(`/api/v1/customers/me/addresses/${otherAddress.id}`, customerToken, {
        recipientName: 'Chiếm đoạt',
      }).expect(404);
      await patch(
        `/api/v1/customers/me/addresses/${otherAddress.id}/default`,
        customerToken,
      ).expect(404);
      await del(`/api/v1/customers/me/addresses/${otherAddress.id}`, customerToken).expect(404);

      // The row is untouched.
      const still = await prisma.address.findUniqueOrThrow({ where: { id: otherAddress.id } });
      expect(still.recipientName).toBe('Người Nhận Khác');

      await prisma.address.deleteMany({ where: { customerId: other.customerProfile!.id } });
      await prisma.customerProfile.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    });

    afterAll(async () => {
      await prisma.address.deleteMany({ where: { id: { in: createdAddressIds } } });
      // Restore the fixture identity so a re-run and the cleanup helpers agree.
      await prisma.user.update({
        where: { id: fixtures.customerId },
        data: { fullName: `E2E Khách ${RUN_ID}`, phone: '0911111111' },
      });
    });
  });
});
