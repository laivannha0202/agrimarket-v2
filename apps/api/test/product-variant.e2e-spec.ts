import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login } from './helpers/test-app.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  E2E_CUSTOMER_PASSWORD,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * Variant lifecycle acceptance (e2e, MySQL TEST).
 *
 * - `PATCH /products/variants/:id` updates name/price/status (ADMIN), with
 *   an audit record; SKU and unit fields are not updatable (whitelist 400).
 * - A price change applies to NEW orders only: an order placed before the
 *   change keeps its `unitPriceSnapshot`.
 * - Setting status INACTIVE blocks preview AND checkout with 400 and reserves
 *   nothing; reactivating restores the flow.
 * - A customer gets 403 on the admin endpoint.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2evar');

const ADDRESS = {
  recipientName: 'E2E Khách',
  phone: '0911111111',
  province: 'Hưng Yên',
  detail: 'Số 1 đường E2E',
};

describe.skipIf(!hasTestDb)('Product variant lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  const adminPatch = (id: number, body: object) =>
    request(app.getHttpServer())
      .patch(`/api/v1/products/variants/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  const preview = (variantId: number, quantity = 1) =>
    request(app.getHttpServer())
      .post('/api/v1/orders/checkout-preview')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ productVariantId: variantId, quantity }] });
  const checkout = (variantId: number, quantity = 1) =>
    request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shippingAddress: ADDRESS, items: [{ productVariantId: variantId, quantity }] });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL!);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
  }, 60000);

  afterAll(async () => {
    await cleanupFixtures(prisma, fixtures).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
  });

  it('updates name and price, keeps the SKU, and audits the change', async () => {
    const res = await adminPatch(fixtures.variantAId, { name: 'Túi 500g mới', basePrice: 26000 }).expect(200);
    expect(res.body.name).toBe('Túi 500g mới');
    expect(Number(res.body.basePrice)).toBe(26000);
    expect(res.body.sku).toBe(`${RUN_ID}-SKU-CAI`);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'ProductVariant', entityId: String(fixtures.variantAId), action: 'UPDATE_VARIANT' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(fixtures.adminId);
  });

  it('rejects SKU and unit changes (immutable identity)', async () => {
    await adminPatch(fixtures.variantAId, { sku: 'HACKED' }).expect(400);
    await adminPatch(fixtures.variantAId, { saleUnit: 'thùng' }).expect(400);
    await adminPatch(fixtures.variantAId, { basePrice: -5 }).expect(400);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: fixtures.variantAId } });
    expect(variant.sku).toBe(`${RUN_ID}-SKU-CAI`);
    expect(variant.saleUnit).toBe('túi');
  });

  it('keeps the old price snapshot on orders placed before the change', async () => {
    // Whatever the current price is, an order placed now snapshots it.
    const current = await prisma.productVariant.findUniqueOrThrow({ where: { id: fixtures.variantAId } });
    const oldPrice = Number(current.basePrice);
    const newPrice = oldPrice === 99000 ? 98000 : 99000;

    const created = await checkout(fixtures.variantAId, 2).expect(201);
    const orderId = created.body.id as number;
    const before = await prisma.orderItem.findFirstOrThrow({
      where: { partnerOrder: { orderId } },
    });
    expect(Number(before.unitPriceSnapshot)).toBe(oldPrice);

    await adminPatch(fixtures.variantAId, { basePrice: newPrice }).expect(200);

    const after = await prisma.orderItem.findFirstOrThrow({ where: { id: before.id } });
    expect(Number(after.unitPriceSnapshot)).toBe(oldPrice);

    // …while a new preview already sees the new price.
    const prev = await preview(fixtures.variantAId, 1).expect(201);
    expect(Number(prev.body.subtotal)).toBe(newPrice);

    // Restore for the following tests.
    await adminPatch(fixtures.variantAId, { basePrice: 25000 }).expect(200);
  });

  it('blocks preview and checkout for an INACTIVE variant and reserves nothing', async () => {
    await adminPatch(fixtures.variantAId, { status: 'INACTIVE' }).expect(200);

    const before = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: fixtures.balanceAId } });
    await preview(fixtures.variantAId, 1).expect(400);
    await checkout(fixtures.variantAId, 1).expect(400);
    const after = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: fixtures.balanceAId } });
    expect(Number(after.reserved)).toBe(Number(before.reserved));

    const product = await request(app.getHttpServer())
      .get(`/api/v1/products/${fixtures.productAId}`)
      .expect(200);
    const variant = (product.body.variants as Array<{ id: number; inStock: boolean }>).find(
      (v) => v.id === fixtures.variantAId,
    );
    expect(variant?.inStock).toBe(false);
  });

  it('restores the flow on reactivation', async () => {
    await adminPatch(fixtures.variantAId, { status: 'ACTIVE' }).expect(200);
    await preview(fixtures.variantAId, 1).expect(201);
  });

  it('forbids customers from touching variants', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/products/variants/${fixtures.variantAId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ basePrice: 1 })
      .expect(403);
  });
});
