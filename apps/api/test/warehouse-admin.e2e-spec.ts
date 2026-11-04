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
 * GĐ2–GĐ3 acceptance on the isolated TEST database (never DEV):
 *
 *  A. create warehouse → rename → deactivate while empty (200).
 *  B. warehouse with inbound stock refuses deactivation (409).
 *  C. DRAFT → edit quantity → COMPLETE applies stock exactly once.
 *  D. DRAFT → CANCELLED changes no stock.
 *  E. CANCELLED → COMPLETE is refused.
 *  F. COMPLETED → PATCH is refused.
 *  G. double COMPLETE applies stock exactly once.
 *  H. UPDATE DRAFT racing COMPLETE never forks stock.
 *  I. CANCEL racing COMPLETE lets exactly one branch win.
 *  L. CUSTOMER cannot call warehouse/document mutations (403).
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2ew');

describe.skipIf(!hasTestDb)('AgriMarket API — warehouse admin hardening (e2e)', () => {
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
    if (app) await app.close();
  });

  const post = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body as object);
  const patch = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token}`).send(body as object);
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  async function makeStockWorld(tag: string) {
    const season = await prisma.season.create({
      data: { farmId: fixtures.farmAId, cropName: `WH E2E ${RUN_ID} ${tag}`, status: 'HARVESTING' },
    });
    const harvest = await prisma.harvest.create({
      data: { seasonId: season.id, harvestDate: new Date(), quantity: 500, unit: 'kg', grade: 'A' },
    });
    const product = await prisma.product.create({
      data: {
        partnerId: fixtures.partnerAId,
        categoryId: fixtures.categoryAId,
        name: `SP kho E2E ${RUN_ID} ${tag}`,
        slug: `${RUN_ID}-spkho-${tag}`.toLowerCase(),
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `${RUN_ID}-SKU-WH-${tag}`, name: 'Gói 1kg', saleUnit: 'gói', basePrice: 30000 },
    });
    const lot = await prisma.productLot.create({
      data: {
        code: `${RUN_ID}-LOT-WH-${tag}`,
        productId: product.id,
        harvestId: harvest.id,
        quantity: 500,
        unit: 'kg',
        remainingQuantity: 500,
        grade: 'A',
        expiresAt: new Date(Date.now() + 86400000 * 30),
        status: 'SELLABLE',
        traceCode: `${RUN_ID}-TRC-WH-${tag}`,
      },
    });
    return { season, harvest, product, variant, lot };
  }

  async function cleanupStockWorld(w: Awaited<ReturnType<typeof makeStockWorld>>, extraWarehouseIds: number[] = []) {
    // Documents first (lines → header), then ledger rows scoped to this run's
    // lot, then the lot graph. Extra warehouses are removed only after their
    // documents/balances/movements are gone — `warehouses.id` is referenced by
    // all three with RESTRICT semantics.
    const docIds = (
      await prisma.warehouseDocument.findMany({
        where: {
          OR: [
            { lines: { some: { productLotId: w.lot.id } } },
            { warehouseId: { in: extraWarehouseIds } },
          ],
        },
        select: { id: true },
      })
    ).map((d) => d.id);
    await prisma.warehouseDocumentLine.deleteMany({
      where: { OR: [{ productLotId: w.lot.id }, { documentId: { in: docIds } }] },
    });
    await prisma.warehouseDocument.deleteMany({ where: { id: { in: docIds } } });
    await prisma.traceEvent.deleteMany({ where: { productLotId: w.lot.id } });
    await prisma.quarantineCase.deleteMany({ where: { productLotId: w.lot.id } });
    await prisma.inventoryMovement.deleteMany({
      where: {
        OR: [{ productLotId: w.lot.id }, { warehouseId: { in: extraWarehouseIds } }],
      },
    });
    await prisma.inventoryBalance.deleteMany({
      where: {
        OR: [{ productLotId: w.lot.id }, { warehouseId: { in: extraWarehouseIds } }],
      },
    });
    await prisma.productLot.deleteMany({ where: { id: w.lot.id } });
    await prisma.harvest.deleteMany({ where: { id: w.harvest.id } });
    await prisma.season.deleteMany({ where: { id: w.season.id } });
    await prisma.productVariant.deleteMany({ where: { id: w.variant.id } });
    await prisma.product.deleteMany({ where: { id: w.product.id } });
    for (const wid of extraWarehouseIds) {
      await prisma.warehouse.deleteMany({ where: { id: wid } });
    }
  }

  describe('A. create → rename → deactivate while empty', () => {
    it('creates, renames and deactivates an empty warehouse', async () => {
      const created = await post('/api/v1/warehouses', adminToken, {
        name: `Kho E2E ${RUN_ID} A`,
        address: 'Hưng Yên',
      }).expect(201);
      expect(created.body.code).toMatch(/^WH-/);
      const wid = created.body.id as number;

      const renamed = await patch(`/api/v1/warehouses/${wid}`, adminToken, {
        name: `Kho E2E ${RUN_ID} A2`,
      }).expect(200);
      expect(renamed.body.name).toContain('A2');

      await patch(`/api/v1/warehouses/${wid}`, adminToken, { status: 'INACTIVE' }).expect(200);
      const fetched = await get(`/api/v1/warehouses/${wid}`, adminToken).expect(200);
      expect(fetched.body.status).toBe('INACTIVE');

      // Reactivate for operators (allowed, audited).
      await patch(`/api/v1/warehouses/${wid}`, adminToken, { status: 'ACTIVE' }).expect(200);
      await prisma.warehouse.deleteMany({ where: { id: wid } });
    });
  });

  describe('B. deactivation refused while stock remains', () => {
    it('409 when the warehouse holds on-hand stock', async () => {
      const w = await makeStockWorld('B');
      const created = await post('/api/v1/warehouses', adminToken, {
        name: `Kho E2E ${RUN_ID} B`,
        address: 'Hưng Yên',
      }).expect(201);
      const wid = created.body.id as number;

      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: wid,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 20, unit: 'kg' }],
      }).expect(201);
      await post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken).expect(201);

      const res = await patch(`/api/v1/warehouses/${wid}`, adminToken, { status: 'INACTIVE' }).expect(409);
      expect(String(res.body.message)).toMatch(/tồn|giữ|kho/i);

      await cleanupStockWorld(w, [wid]);
    });
  });

  describe('C. DRAFT edit then COMPLETE applies stock once', () => {
    it('edits quantity and completes exactly once', async () => {
      const w = await makeStockWorld('C');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 10, unit: 'kg' }],
      }).expect(201);

      await patch(`/api/v1/warehouse-documents/${doc.body.id}`, adminToken, {
        note: 'sửa nháp E2E',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 25, unit: 'kg' }],
      }).expect(200);

      await post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken).expect(201);
      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: { warehouseId: fixtures.warehouseId, productLotId: w.lot.id, productVariantId: w.variant.id },
      });
      expect(Number(balance.onHand)).toBe(25);
      const moves = await prisma.inventoryMovement.count({
        where: { referenceType: 'WarehouseDocument', referenceId: doc.body.id },
      });
      expect(moves).toBe(1);

      await cleanupStockWorld(w);
    });
  });

  describe('C0. create validates the draft before storing it', () => {
    it('rejects duplicate lines and a lot paired with another product', async () => {
      const w = await makeStockWorld('C0');
      const other = await makeStockWorld('C0B');

      await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [
          { productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 5, unit: 'kg' },
          { productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 5, unit: 'kg' },
        ],
      }).expect(400);

      await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [
          {
            productLotId: w.lot.id,
            productVariantId: other.variant.id,
            quantity: 5,
            unit: 'kg',
          },
        ],
      }).expect(400);

      // Neither rejected request left a document behind.
      expect(
        await prisma.warehouseDocument.count({
          where: { lines: { some: { productLotId: w.lot.id } } },
        }),
      ).toBe(0);

      await cleanupStockWorld(other);
      await cleanupStockWorld(w);
    });
  });

  describe('C1. OUTBOUND document guards stock and the lot balance', () => {
    it('decrements on-hand and lot remaining, and refuses to ship reserved stock', async () => {
      const w = await makeStockWorld('C1');
      const inbound = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 20, unit: 'kg' }],
      }).expect(201);
      await post(`/api/v1/warehouse-documents/${inbound.body.id}/complete`, adminToken).expect(201);

      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: {
          warehouseId: fixtures.warehouseId,
          productLotId: w.lot.id,
          productVariantId: w.variant.id,
        },
      });
      expect(Number(balance.onHand)).toBe(20);
      const lotBefore = await prisma.productLot.findUniqueOrThrow({ where: { id: w.lot.id } });
      expect(Number(lotBefore.remainingQuantity)).toBe(500);

      const outbound = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'OUTBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 5, unit: 'kg' }],
      }).expect(201);
      await post(`/api/v1/warehouse-documents/${outbound.body.id}/complete`, adminToken).expect(201);

      const after = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } });
      expect(Number(after.onHand)).toBe(15);
      const lotAfter = await prisma.productLot.findUniqueOrThrow({ where: { id: w.lot.id } });
      expect(Number(lotAfter.remainingQuantity)).toBe(495);

      // 10 units are promised to an order. Shipping 10 more would leave 5 on
      // hand, below the reservation, so the guard must reject the document.
      await prisma.inventoryBalance.update({
        where: { id: balance.id },
        data: { reserved: 10 },
      });
      const blocked = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'OUTBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 10, unit: 'kg' }],
      }).expect(201);
      await post(`/api/v1/warehouse-documents/${blocked.body.id}/complete`, adminToken).expect(400);

      const afterBlocked = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: balance.id },
      });
      expect(Number(afterBlocked.onHand)).toBe(15);
      const lotBlocked = await prisma.productLot.findUniqueOrThrow({ where: { id: w.lot.id } });
      expect(Number(lotBlocked.remainingQuantity)).toBe(495);

      await cleanupStockWorld(w);
    });
  });

  describe('C2. RETURN document quarantines stock until QC release', () => {
    it('receives into blocked, opens a WAREHOUSE_RETURN case, and releases only after PASS', async () => {
      const w = await makeStockWorld('C2');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'RETURN',
        note: 'Khách gửi trả',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 6, unit: 'kg' }],
      }).expect(201);
      await post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken).expect(201);

      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: {
          warehouseId: fixtures.warehouseId,
          productLotId: w.lot.id,
          productVariantId: w.variant.id,
        },
      });
      expect(Number(balance.onHand)).toBe(6);
      expect(Number(balance.blocked)).toBe(6);
      expect(Number(balance.reserved)).toBe(0);

      const lot = await prisma.productLot.findUniqueOrThrow({ where: { id: w.lot.id } });
      expect(Number(lot.remainingQuantity)).toBe(506);

      const cases = await prisma.quarantineCase.findMany({
        where: { sourceType: 'WAREHOUSE_RETURN', sourceId: doc.body.id },
      });
      expect(cases).toHaveLength(1);
      expect(cases[0].status).toBe('PENDING');
      expect(cases[0].stockAddedToBalance).toBe(true);
      expect(Number(cases[0].quantity)).toBe(6);

      const list = await get(
        `/api/v1/quarantine-cases?warehouseId=${fixtures.warehouseId}&status=PENDING`,
        adminToken,
      ).expect(200);
      expect(list.body.data.some((row: { code: string }) => row.code === cases[0].code)).toBe(true);

      const traceTypes = (
        await prisma.traceEvent.findMany({
          where: { productLotId: w.lot.id },
          select: { type: true },
        })
      ).map((event) => event.type);
      expect(traceTypes).toContain('RETURNED');
      expect(traceTypes).not.toContain('WAREHOUSE_IN');

      await patch(`/api/v1/quarantine-cases/${cases[0].id}/inspect`, adminToken, {
        result: 'PASS',
      }).expect(200);

      // PASS is only the QC verdict: the units stay blocked and on-hand is
      // unchanged until the operator explicitly releases them.
      const passedCase = await prisma.quarantineCase.findUniqueOrThrow({
        where: { id: cases[0].id },
      });
      expect(passedCase.status).toBe('PASSED');
      const stillBlocked = await prisma.inventoryBalance.findFirstOrThrow({
        where: {
          warehouseId: fixtures.warehouseId,
          productLotId: w.lot.id,
          productVariantId: w.variant.id,
        },
      });
      expect(Number(stillBlocked.onHand)).toBe(6);
      expect(Number(stillBlocked.blocked)).toBe(6);

      await patch(`/api/v1/quarantine-cases/${cases[0].id}/resolve`, adminToken, {
        action: 'RELEASE',
      }).expect(200);

      const released = await prisma.inventoryBalance.findFirstOrThrow({
        where: {
          warehouseId: fixtures.warehouseId,
          productLotId: w.lot.id,
          productVariantId: w.variant.id,
        },
      });
      expect(Number(released.onHand)).toBe(6);
      expect(Number(released.blocked)).toBe(0);

      await cleanupStockWorld(w);
    });

    it('two concurrent RETURN completes apply the receipt and open one case exactly once', async () => {
      const w = await makeStockWorld('C2R');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'RETURN',
        note: 'Hai lần hoàn tất',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 4, unit: 'kg' }],
      }).expect(201);

      const [r1, r2] = await Promise.all([
        post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken),
        post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken),
      ]);
      expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([201, 400]);

      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: {
          warehouseId: fixtures.warehouseId,
          productLotId: w.lot.id,
          productVariantId: w.variant.id,
        },
      });
      expect(Number(balance.onHand)).toBe(4);
      expect(Number(balance.blocked)).toBe(4);

      const lot = await prisma.productLot.findUniqueOrThrow({ where: { id: w.lot.id } });
      expect(Number(lot.remainingQuantity)).toBe(504);

      const cases = await prisma.quarantineCase.findMany({
        where: { sourceType: 'WAREHOUSE_RETURN', sourceId: doc.body.id },
      });
      expect(cases).toHaveLength(1);
      expect(Number(cases[0].quantity)).toBe(4);

      expect(
        await prisma.inventoryMovement.count({
          where: {
            referenceType: 'WarehouseDocument',
            referenceId: doc.body.id,
            type: 'RETURN',
          },
        }),
      ).toBe(1);
      expect(
        await prisma.traceEvent.count({
          where: { productLotId: w.lot.id, type: 'RETURNED' },
        }),
      ).toBe(1);

      await cleanupStockWorld(w);
    });
  });

  describe('D/E/F. cancel semantics and immutability', () => {
    it('DRAFT → CANCELLED changes no stock; CANCELLED → COMPLETE refused; COMPLETED → PATCH refused', async () => {
      const w = await makeStockWorld('D');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 12, unit: 'kg' }],
      }).expect(201);

      await post(`/api/v1/warehouse-documents/${doc.body.id}/cancel`, adminToken).expect(201);
      const cancelled = await get(`/api/v1/warehouse-documents/${doc.body.id}`, adminToken).expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(
        await prisma.inventoryBalance.count({
          where: { warehouseId: fixtures.warehouseId, productLotId: w.lot.id },
        }),
      ).toBe(0);

      await post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken).expect(400);
      await patch(`/api/v1/warehouse-documents/${doc.body.id}`, adminToken, { note: 'x' }).expect(400);

      // A completed document is immutable too.
      const doc2 = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 7, unit: 'kg' }],
      }).expect(201);
      await post(`/api/v1/warehouse-documents/${doc2.body.id}/complete`, adminToken).expect(201);
      await patch(`/api/v1/warehouse-documents/${doc2.body.id}`, adminToken, { note: 'sửa sau hoàn tất' }).expect(400);
      await post(`/api/v1/warehouse-documents/${doc2.body.id}/cancel`, adminToken).expect(400);

      await cleanupStockWorld(w);
    });
  });

  describe('G. double COMPLETE applies stock once', () => {
    it('two concurrent completes: one wins, stock applied once', async () => {
      const w = await makeStockWorld('G');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 9, unit: 'kg' }],
      }).expect(201);

      const [r1, r2] = await Promise.all([
        post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken),
        post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 400]);

      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: { warehouseId: fixtures.warehouseId, productLotId: w.lot.id, productVariantId: w.variant.id },
      });
      expect(Number(balance.onHand)).toBe(9);

      await cleanupStockWorld(w);
    });
  });

  describe('G2. double CANCEL is idempotent with one audit row', () => {
    it('two concurrent cancels: both succeed, one audit, no movement/stock', async () => {
      const w = await makeStockWorld('G2');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 6, unit: 'kg' }],
      }).expect(201);

      const auditBefore = await prisma.auditLog.count({
        where: { entityType: 'WarehouseDocument', entityId: String(doc.body.id) },
      });
      const [c1, c2] = await Promise.all([
        post(`/api/v1/warehouse-documents/${doc.body.id}/cancel`, adminToken),
        post(`/api/v1/warehouse-documents/${doc.body.id}/cancel`, adminToken),
      ]);
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);

      const final = await get(`/api/v1/warehouse-documents/${doc.body.id}`, adminToken).expect(200);
      expect(final.body.status).toBe('CANCELLED');

      const auditAfter = await prisma.auditLog.count({
        where: { entityType: 'WarehouseDocument', entityId: String(doc.body.id) },
      });
      expect(auditAfter - auditBefore).toBe(1);
      expect(
        await prisma.inventoryMovement.count({
          where: { referenceType: 'WarehouseDocument', referenceId: doc.body.id },
        }),
      ).toBe(0);
      expect(
        await prisma.inventoryBalance.count({
          where: { warehouseId: fixtures.warehouseId, productLotId: w.lot.id },
        }),
      ).toBe(0);

      // A retried cancel after the fact stays a no-op success.
      await post(`/api/v1/warehouse-documents/${doc.body.id}/cancel`, adminToken).expect(201);
      expect(
        await prisma.auditLog.count({
          where: { entityType: 'WarehouseDocument', entityId: String(doc.body.id) },
        }),
      ).toBe(auditAfter);

      await cleanupStockWorld(w);
    });
  });

  describe('H/I. edit-vs-complete and cancel-vs-complete races', () => {
    it('UPDATE DRAFT racing COMPLETE never forks stock', async () => {
      const w = await makeStockWorld('H');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 10, unit: 'kg' }],
      }).expect(201);

      const [edit, done] = await Promise.all([
        patch(`/api/v1/warehouse-documents/${doc.body.id}`, adminToken, {
          lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 30, unit: 'kg' }],
        }),
        post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken),
      ]);
      // Complete must always succeed; the edit either won before the claim
      // (stock 30) or lost to it (stock 10, edit 400/409) — never a mix.
      expect(done.status).toBe(201);
      const balance = await prisma.inventoryBalance.findFirstOrThrow({
        where: { warehouseId: fixtures.warehouseId, productLotId: w.lot.id, productVariantId: w.variant.id },
      });
      const onHand = Number(balance.onHand);
      expect([10, 30]).toContain(onHand);
      if (edit.status !== 200) expect([400, 409]).toContain(edit.status);

      await cleanupStockWorld(w);
    });

    it('CANCEL racing COMPLETE: exactly one branch wins', async () => {
      const w = await makeStockWorld('I');
      const doc = await post('/api/v1/warehouse-documents', adminToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: w.lot.id, productVariantId: w.variant.id, quantity: 11, unit: 'kg' }],
      }).expect(201);

      const [cancel, done] = await Promise.all([
        post(`/api/v1/warehouse-documents/${doc.body.id}/cancel`, adminToken),
        post(`/api/v1/warehouse-documents/${doc.body.id}/complete`, adminToken),
      ]);
      const okCount = [cancel.status, done.status].filter((s) => s === 201).length;
      expect(okCount).toBe(1);

      const final = await get(`/api/v1/warehouse-documents/${doc.body.id}`, adminToken).expect(200);
      expect(['COMPLETED', 'CANCELLED']).toContain(final.body.status);

      await cleanupStockWorld(w);
    });
  });

  describe('L. CUSTOMER cannot mutate warehouses or documents', () => {
    it('403 on warehouse create/update and document create/complete/cancel/patch', async () => {
      await post('/api/v1/warehouses', customerToken, { name: 'x', address: 'y' }).expect(403);
      await patch(`/api/v1/warehouses/${fixtures.warehouseId}`, customerToken, { name: 'x' }).expect(403);
      await post('/api/v1/warehouse-documents', customerToken, {
        warehouseId: fixtures.warehouseId,
        type: 'INBOUND',
        lines: [{ productLotId: fixtures.lotAId, productVariantId: fixtures.variantAId, quantity: 1, unit: 'kg' }],
      }).expect(403);
      await post(`/api/v1/warehouse-documents/${fixtures.docDraftId}/complete`, customerToken).expect(403);
      await post(`/api/v1/warehouse-documents/${fixtures.docDraftId}/cancel`, customerToken).expect(403);
      await patch(`/api/v1/warehouse-documents/${fixtures.docDraftId}`, customerToken, { note: 'x' }).expect(403);
    });
  });
});
