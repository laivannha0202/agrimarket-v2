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
 * HTTP end-to-end tests.
 *
 * They run against an isolated database given by TEST_DATABASE_URL and are
 * skipped entirely when that variable is not configured, so `npm run test:e2e`
 * never touches the development database and never hardcodes credentials.
 *
 * The suite provisions its own tagged fixtures and removes them afterwards, so
 * it neither depends on nor pollutes the demo seed.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2ef');

describe.skipIf(!hasTestDb)('AgriMarket API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    // Point the application at the dedicated test database before the module
    // is compiled (PrismaService reads DATABASE_URL in its constructor).
    process.env.DATABASE_URL = TEST_URL;

    prisma = createFixturePrisma(TEST_URL as string);
    // Heal any leftovers from a previous run that was killed before cleanup.
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
  });

  afterAll(async () => {
    if (prisma && fixtures) {
      await cleanupFixtures(prisma, fixtures);
      // The fixture run must leave nothing behind.
      const leftovers = await prisma.user.count({
        where: { email: { startsWith: E2E_PREFIX } },
      });
      expect(leftovers).toBe(0);
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  const asAdmin = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);
  const asCustomer = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${customerToken}`);

  describe('auth & baseline', () => {
    it('rejects an unauthenticated request to a protected route with a clean 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      expect(res.body).toMatchObject({ statusCode: 401 });
      expect(res.body).not.toHaveProperty('stack');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
    });

    it('rejects invalid login payloads with a 400 validation error', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    it('rejects wrong credentials with a generic 401 (no user enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixtures.adminEmail, password: 'WrongPassword@1' })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('logs in an admin and returns a bearer token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixtures.adminEmail, password: E2E_ADMIN_PASSWORD })
        .expect(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user).toMatchObject({ email: fixtures.adminEmail, role: 'ADMIN' });
    });

    it('returns the current user for a valid token', async () => {
      const res = await asAdmin('/api/v1/auth/me').expect(200);
      expect(res.body).toMatchObject({ email: fixtures.adminEmail, role: 'ADMIN' });
    });

    it('lists public products with a paginated envelope', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/products').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
    });

    it('caps the page limit at 100', async () => {
      await request(app.getHttpServer()).get('/api/v1/products?limit=200').expect(400);
    });

    it('rejects unknown query params instead of ignoring them', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?totallyUnknown=1')
        .expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    it('returns a clean 404 for an unknown public trace code', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/trace/TRC-DOES-NOT-EXIST')
        .expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, message: 'Trace code not found' });
      expect(res.body).not.toHaveProperty('stack');
    });
  });

  describe('server-side filters', () => {
    it('filters products by categoryId and narrows meta.total', async () => {
      const all = await request(app.getHttpServer()).get('/api/v1/products').expect(200);
      const filtered = await request(app.getHttpServer())
        .get(`/api/v1/products?categoryId=${fixtures.categoryAId}`)
        .expect(200);

      expect(filtered.body.data.length).toBeGreaterThan(0);
      expect(filtered.body.data.every((p: { categoryId: number }) => p.categoryId === fixtures.categoryAId)).toBe(true);
      expect(filtered.body.meta.total).toBeLessThan(all.body.meta.total);
    });

    it('filters products by partnerId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products?partnerId=${fixtures.partnerAId}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((p: { partnerId: number }) => p.partnerId === fixtures.partnerAId)).toBe(true);
    });

    it('filters products by status', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/products?status=INACTIVE').expect(200);
      expect(res.body.data.every((p: { status: string }) => p.status === 'INACTIVE')).toBe(true);
      expect(res.body.data.some((p: { id: number }) => p.id === fixtures.productBId)).toBe(true);
    });

    it('searches products by name token', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products?search=${encodeURIComponent(fixtures.searchToken)}`)
        .expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.every((p: { name: string }) => p.name.includes(fixtures.searchToken)),
      ).toBe(true);
    });

    it('filters categories by search (name/slug) and status', async () => {
      const bySearch = await request(app.getHttpServer())
        .get(`/api/v1/categories?search=${encodeURIComponent(fixtures.searchToken)}`)
        .expect(200);
      expect(bySearch.body.meta.total).toBe(2);

      const bySlug = await request(app.getHttpServer())
        .get(`/api/v1/categories?search=${encodeURIComponent(`${fixtures.searchToken}-trai`)}`)
        .expect(200);
      expect(bySlug.body.meta.total).toBe(1);
      expect(bySlug.body.data[0].id).toBe(fixtures.categoryBId);

      const inactive = await request(app.getHttpServer())
        .get('/api/v1/categories?status=INACTIVE')
        .expect(200);
      expect(inactive.body.data.every((c: { status: string }) => c.status === 'INACTIVE')).toBe(true);
    });

    it('filters lots by productId and status', async () => {
      const byProduct = await request(app.getHttpServer())
        .get(`/api/v1/lots?productId=${fixtures.productAId}`)
        .expect(200);
      expect(byProduct.body.data.every((l: { productId: number }) => l.productId === fixtures.productAId)).toBe(true);
      expect(byProduct.body.data.some((l: { id: number }) => l.id === fixtures.lotAId)).toBe(true);

      const sellable = await request(app.getHttpServer()).get('/api/v1/lots?status=SELLABLE').expect(200);
      expect(sellable.body.data.every((l: { status: string }) => l.status === 'SELLABLE')).toBe(true);
      expect(sellable.body.data.some((l: { id: number }) => l.id === fixtures.lotAId)).toBe(true);
    });

    it('filters QC inspections by productLotId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/qc?productLotId=${fixtures.lotBId}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((i: { productLotId: number }) => i.productLotId === fixtures.lotBId),
      ).toBe(true);
    });

    it('filters inventory balances by warehouseId and productVariantId', async () => {
      const byWarehouse = await asAdmin(
        `/api/v1/inventory?warehouseId=${fixtures.warehouseId}`,
      ).expect(200);
      expect(
        byWarehouse.body.data.every(
          (b: { warehouseId: number }) => b.warehouseId === fixtures.warehouseId,
        ),
      ).toBe(true);
      expect(byWarehouse.body.meta.total).toBe(2);

      const byVariant = await asAdmin(
        `/api/v1/inventory?productVariantId=${fixtures.variantAId}`,
      ).expect(200);
      expect(byVariant.body.meta.total).toBe(1);
      expect(byVariant.body.data[0].productVariantId).toBe(fixtures.variantAId);
    });

    it('filters inventory movements by productLotId', async () => {
      const res = await asAdmin(`/api/v1/inventory/movements?productLotId=${fixtures.lotAId}`).expect(
        200,
      );
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((m: { productLotId: number }) => m.productLotId === fixtures.lotAId),
      ).toBe(true);
    });

    it('filters warehouse documents by status and type', async () => {
      const draft = await asAdmin('/api/v1/warehouse-documents?status=DRAFT').expect(200);
      expect(draft.body.data.every((d: { status: string }) => d.status === 'DRAFT')).toBe(true);
      expect(draft.body.data.some((d: { id: number }) => d.id === fixtures.docDraftId)).toBe(true);

      const outbound = await asAdmin('/api/v1/warehouse-documents?type=OUTBOUND').expect(200);
      expect(outbound.body.data.every((d: { type: string }) => d.type === 'OUTBOUND')).toBe(true);
      expect(outbound.body.data.some((d: { id: number }) => d.id === fixtures.docCompletedId)).toBe(true);

      const both = await asAdmin(
        '/api/v1/warehouse-documents?status=COMPLETED&type=OUTBOUND',
      ).expect(200);
      expect(both.body.data.some((d: { id: number }) => d.id === fixtures.docCompletedId)).toBe(true);
    });

    it('filters customers by search, status and role', async () => {
      const bySearch = await asAdmin(
        `/api/v1/customers?search=${encodeURIComponent(fixtures.searchToken)}`,
      ).expect(200);
      expect(bySearch.body.meta.total).toBeGreaterThan(0);

      const byRole = await asAdmin('/api/v1/customers?role=ADMIN').expect(200);
      expect(byRole.body.data.every((u: { role: string }) => u.role === 'ADMIN')).toBe(true);
      expect(byRole.body.data.some((u: { id: number }) => u.id === fixtures.adminId)).toBe(true);

      const byStatus = await asAdmin('/api/v1/customers?status=INACTIVE').expect(200);
      expect(byStatus.body.data.every((u: { status: string }) => u.status === 'INACTIVE')).toBe(true);
    });

    it('filters farms by partnerId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/farms?partnerId=${fixtures.partnerAId}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((f: { partnerId: number }) => f.partnerId === fixtures.partnerAId)).toBe(true);
      expect(res.body.data.some((f: { id: number }) => f.id === fixtures.farmAId)).toBe(true);
    });

    it('filters partners by status', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/partners?status=INACTIVE').expect(200);
      expect(res.body.data.every((p: { status: string }) => p.status === 'INACTIVE')).toBe(true);
      expect(res.body.data.some((p: { id: number }) => p.id === fixtures.partnerBId)).toBe(true);
    });

    it('filters orders by status', async () => {
      const res = await asAdmin('/api/v1/orders?status=DELIVERED').expect(200);
      expect(res.body.data.every((o: { status: string }) => o.status === 'DELIVERED')).toBe(true);
      expect(res.body.data.some((o: { id: number }) => o.id === fixtures.orderId)).toBe(true);
    });

    it('filters settlements and payouts by status', async () => {
      const settlements = await asAdmin('/api/v1/settlements?status=DRAFT').expect(200);
      expect(settlements.body.data.every((s: { status: string }) => s.status === 'DRAFT')).toBe(true);
      expect(settlements.body.data.some((s: { id: number }) => s.id === fixtures.settlementId)).toBe(
        true,
      );

      const payouts = await asAdmin('/api/v1/payouts?status=PENDING').expect(200);
      expect(payouts.body.data.every((p: { status: string }) => p.status === 'PENDING')).toBe(true);
      expect(payouts.body.data.some((p: { id: number }) => p.id === fixtures.payoutId)).toBe(true);
    });

    it('filters payments, complaints, returns and reviews by status', async () => {
      const payments = await asAdmin('/api/v1/payments?status=PAID').expect(200);
      expect(payments.body.data.every((p: { status: string }) => p.status === 'PAID')).toBe(true);

      const complaints = await asAdmin('/api/v1/complaints?status=OPEN').expect(200);
      expect(complaints.body.data.every((c: { status: string }) => c.status === 'OPEN')).toBe(true);
      expect(complaints.body.data.some((c: { id: number }) => c.id === fixtures.complaintId)).toBe(
        true,
      );

      const returns = await asAdmin('/api/v1/returns?status=REQUESTED').expect(200);
      expect(returns.body.data.every((r: { status: string }) => r.status === 'REQUESTED')).toBe(true);

      const reviews = await asAdmin('/api/v1/reviews?status=APPROVED').expect(200);
      expect(reviews.body.data.every((r: { status: string }) => r.status === 'APPROVED')).toBe(true);
    });

    it('filters certificates by farmId and verification status', async () => {
      const byFarm = await request(app.getHttpServer())
        .get(`/api/v1/certificates?farmId=${fixtures.farmAId}`)
        .expect(200);
      expect(byFarm.body.data.every((c: { farmId: number }) => c.farmId === fixtures.farmAId)).toBe(
        true,
      );

      const verified = await request(app.getHttpServer())
        .get('/api/v1/certificates?status=VERIFIED')
        .expect(200);
      expect(
        verified.body.data.every(
          (c: { verificationStatus: string }) => c.verificationStatus === 'VERIFIED',
        ),
      ).toBe(true);
    });

    it('filters seasons by farmId and status', async () => {
      const byFarm = await request(app.getHttpServer())
        .get(`/api/v1/seasons?farmId=${fixtures.farmAId}`)
        .expect(200);
      expect(byFarm.body.data.every((s: { farmId: number }) => s.farmId === fixtures.farmAId)).toBe(
        true,
      );

      const completed = await request(app.getHttpServer())
        .get('/api/v1/seasons?status=COMPLETED')
        .expect(200);
      expect(completed.body.data.every((s: { status: string }) => s.status === 'COMPLETED')).toBe(
        true,
      );
    });

    it('filters vouchers by status', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/vouchers?status=INACTIVE').expect(200);
      expect(res.body.data.every((v: { status: string }) => v.status === 'INACTIVE')).toBe(true);
    });

    it('filters commission rules by status', async () => {
      const res = await asAdmin('/api/v1/commission-rules?status=ACTIVE').expect(200);
      expect(res.body.data.every((r: { status: string }) => r.status === 'ACTIVE')).toBe(true);
    });
  });

  describe('server-side pagination', () => {
    it('honours page/limit and reports a consistent meta.total', async () => {
      const first = await asAdmin('/api/v1/customers?limit=1&page=1').expect(200);
      const second = await asAdmin('/api/v1/customers?limit=1&page=2').expect(200);

      expect(first.body.data).toHaveLength(1);
      expect(first.body.meta).toMatchObject({ page: 1, limit: 1 });
      expect(second.body.meta).toMatchObject({ page: 2, limit: 1 });
      expect(first.body.meta.total).toBe(second.body.meta.total);
      expect(first.body.meta.totalPages).toBe(first.body.meta.total);
      expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
    });

    it('returns an empty page past the end without changing meta.total', async () => {
      const res = await asAdmin('/api/v1/customers?limit=1&page=9999').expect(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('keeps meta.total filtered (not the unfiltered count)', async () => {
      const all = await request(app.getHttpServer()).get('/api/v1/products').expect(200);
      const filtered = await request(app.getHttpServer())
        .get(`/api/v1/products?partnerId=${fixtures.partnerAId}`)
        .expect(200);
      expect(filtered.body.meta.total).toBeLessThan(all.body.meta.total);
      expect(filtered.body.meta.total).toBe(filtered.body.data.length);
    });
  });

  describe('invalid enum filters return 400 (never 500)', () => {
    const adminEndpoints = [
      '/api/v1/settlements?status=NOT_A_STATUS',
      '/api/v1/payouts?status=NOT_A_STATUS',
      '/api/v1/orders?status=NOT_A_STATUS',
      '/api/v1/complaints?status=NOT_A_STATUS',
      '/api/v1/returns?status=NOT_A_STATUS',
      '/api/v1/reviews?status=NOT_A_STATUS',
      '/api/v1/payments?status=NOT_A_STATUS',
      '/api/v1/shipments?status=NOT_A_STATUS',
      '/api/v1/customers?status=NOT_A_STATUS',
      '/api/v1/customers?role=NOT_A_ROLE',
      '/api/v1/warehouse-documents?status=NOT_A_STATUS',
      '/api/v1/warehouse-documents?type=NOT_A_TYPE',
      '/api/v1/commission-rules?status=NOT_A_STATUS',
    ];

    const publicEndpoints = [
      '/api/v1/products?status=NOT_A_STATUS',
      '/api/v1/categories?status=NOT_A_STATUS',
      '/api/v1/lots?status=NOT_A_STATUS',
      '/api/v1/farms?status=NOT_A_STATUS',
      '/api/v1/partners?status=NOT_A_STATUS',
      '/api/v1/certificates?status=NOT_A_STATUS',
      '/api/v1/seasons?status=NOT_A_STATUS',
      '/api/v1/vouchers?status=NOT_A_STATUS',
      '/api/v1/product-discounts?status=NOT_A_STATUS',
      '/api/v1/flash-sales?status=NOT_A_STATUS',
    ];

    it.each(adminEndpoints)('%s → 400', async (path) => {
      const res = await asAdmin(path).expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body).not.toHaveProperty('stack');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
    });

    it.each(publicEndpoints)('%s → 400', async (path) => {
      const res = await request(app.getHttpServer()).get(path).expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body).not.toHaveProperty('stack');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
    });

    it('still accepts a valid settlement status', async () => {
      const res = await asAdmin('/api/v1/settlements?status=DRAFT').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('still accepts a valid payout status', async () => {
      const res = await asAdmin('/api/v1/payouts?status=PENDING').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('rejects a non-numeric id filter with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?categoryId=abc')
        .expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    /**
     * `/qc`, `/inventory` and `/inventory/movements` have no status column of
     * their own and are not searched, so those inherited params are omitted
     * from their DTOs. `forbidNonWhitelisted` turns a stray `status`/`search`
     * into a 400 instead of a misleading 200 that silently ignores it.
     */
    it.each([
      '/api/v1/qc?status=NOT_A_STATUS',
      '/api/v1/qc?search=x',
      '/api/v1/inventory?status=NOT_A_STATUS',
      '/api/v1/inventory?search=x',
      '/api/v1/inventory/movements?status=NOT_A_STATUS',
      '/api/v1/inventory/movements?search=x',
    ])('%s → 400 (param is not advertised)', async (path) => {
      const res = await asAdmin(path).expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body).not.toHaveProperty('stack');
    });

    it('still accepts the real qc/inventory/movement filters', async () => {
      await asAdmin(`/api/v1/qc?productLotId=${fixtures.lotBId}`).expect(200);
      await asAdmin(`/api/v1/inventory?warehouseId=${fixtures.warehouseId}`).expect(200);
      await asAdmin(`/api/v1/inventory/movements?productLotId=${fixtures.lotAId}`).expect(200);
    });
  });

  describe('customer-facing endpoints', () => {
    it('lists the customer’s own orders only', async () => {
      const res = await asCustomer('/api/v1/orders/me').expect(200);
      expect(res.body.data.every((o: { customerId: number }) => o.customerId === fixtures.customerId)).toBe(
        true,
      );
      expect(res.body.data.some((o: { id: number }) => o.id === fixtures.orderId)).toBe(true);
    });

    it('forbids a customer from listing all orders', async () => {
      await asCustomer('/api/v1/orders').expect(403);
    });

    it('forbids a customer from reading the admin customer list', async () => {
      await asCustomer('/api/v1/customers').expect(403);
    });
  });
});
