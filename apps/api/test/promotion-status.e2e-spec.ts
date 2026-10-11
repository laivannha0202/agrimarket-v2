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
 * Status PATCH endpoints for the create-only domains (promotions + finance),
 * end to end on the TEST database.
 *
 * Before this, a voucher / product discount / flash sale / commission rule
 * could be created from the admin but never turned off, so the only options
 * were "leave it running" or edit the DB. These endpoints add an ADMIN-only,
 * status-only transition; the rate/terms/window stay frozen because they have
 * already priced recorded orders.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2est');

describe.skipIf(!hasTestDb)('Promotion & finance status updates (e2e)', () => {
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
      // Remove the promotion rows this suite created (marker-scoped).
      await prisma.voucher.deleteMany({ where: { code: { startsWith: RUN_ID } } });
      await prisma.productDiscount.deleteMany({
        where: { productVariantId: fixtures.variantAId },
      });
      await prisma.flashSaleItem.deleteMany({
        where: { productVariantId: fixtures.variantAId },
      });
      await prisma.flashSale.deleteMany({ where: { name: { startsWith: RUN_ID } } });
      await cleanupFixtures(prisma, fixtures);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  const patch = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  it('deactivates and reactivates a voucher', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/vouchers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `${RUN_ID}-VOUCHER`,
        name: `Voucher E2E ${RUN_ID}`,
        discountType: 'FIXED',
        discountValue: 10000,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        status: 'ACTIVE',
      })
      .expect(201);
    const id = created.body.id as number;

    const off = await patch(`/api/v1/vouchers/${id}`, adminToken, { status: 'INACTIVE' }).expect(200);
    expect(off.body.status).toBe('INACTIVE');

    const on = await patch(`/api/v1/vouchers/${id}`, adminToken, { status: 'ACTIVE' }).expect(200);
    expect(on.body.status).toBe('ACTIVE');
  });

  it('deactivates a product discount', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/product-discounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productVariantId: fixtures.variantAId,
        discountType: 'PERCENT',
        discountValue: 10,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        status: 'ACTIVE',
      })
      .expect(201);
    const res = await patch(`/api/v1/product-discounts/${created.body.id}`, adminToken, {
      status: 'INACTIVE',
    }).expect(200);
    expect(res.body.status).toBe('INACTIVE');
  });

  it('deactivates a flash sale', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/flash-sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `${RUN_ID} Flash`,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        status: 'ACTIVE',
        items: [{ productVariantId: fixtures.variantAId, flashPrice: 10000, quota: 5, perCustomerLimit: 1 }],
      })
      .expect(201);
    const res = await patch(`/api/v1/flash-sales/${created.body.id}`, adminToken, {
      status: 'INACTIVE',
    }).expect(200);
    expect(res.body.status).toBe('INACTIVE');
  });

  it('deactivates a commission rule without touching the rate', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/commission-rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        partnerId: fixtures.partnerAId,
        ratePercent: 5,
        effectiveFrom: new Date(Date.now() - 1000).toISOString(),
      })
      .expect(201);
    const res = await patch(`/api/v1/commission-rules/${created.body.id}`, adminToken, {
      status: 'INACTIVE',
    }).expect(200);
    expect(res.body.status).toBe('INACTIVE');
    expect(Number(res.body.ratePercent)).toBe(5);
  });

  it('rejects customers (403) and anonymous callers (401)', async () => {
    await patch('/api/v1/vouchers/1', customerToken, { status: 'INACTIVE' }).expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/vouchers/1')
      .send({ status: 'INACTIVE' })
      .expect(401);
  });

  it('rejects an unknown status with 400', async () => {
    await patch('/api/v1/vouchers/1', adminToken, { status: 'NOPE' }).expect(400);
  });

  it('404s for a missing record', async () => {
    await patch('/api/v1/vouchers/99999999', adminToken, { status: 'INACTIVE' }).expect(404);
  });
});
