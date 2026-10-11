import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
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
 * Product image upload flow + reports summary, end to end on the TEST database.
 *
 * Covers: auto slug, duplicate-slug 409, auth (401/403), real upload,
 * fake-image rejection, 6-image cap, primary switching, reorder, replace,
 * delete (row + file), static serving of the stored file, and the aggregate
 * summary endpoint that replaces the 100-row client-side KPIs.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2eimg');

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 140, b: 70 } },
  })
    .png()
    .toBuffer();
}

async function webp(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 60, b: 60 } },
  })
    .webp()
    .toBuffer();
}

describe.skipIf(!hasTestDb)('Product images & reports summary (e2e)', () => {
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
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  const server = () => request(app.getHttpServer());
  const adminPost = (url: string) =>
    server().post(url).set('Authorization', `Bearer ${adminToken}`);

  describe('slug handling', () => {
    it('creates a product without a slug and derives it from the name', async () => {
      const res = await adminPost('/api/v1/products')
        .send({
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Rau cải thìa ${RUN_ID}`,
          description: 'Sản phẩm kiểm thử upload ảnh',
        })
        .expect(201);
      expect(res.body.slug).toMatch(/^[a-z0-9-]+$/);
      await prisma.product.delete({ where: { id: res.body.id } });
    });

    it('rejects a duplicate slug with a business message', async () => {
      const res = await adminPost('/api/v1/products')
        .send({
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: 'Tên khác',
          slug: `${RUN_ID}-cai-bo-xoi`,
        })
        .expect(409);
      expect(String(res.body.message)).toMatch(/Đường dẫn/);
    });
  });

  describe('upload authorisation', () => {
    it('rejects unauthenticated uploads with 401', async () => {
      const buf = await png(400, 400);
      await server()
        .post(`/api/v1/products/${fixtures.productAId}/images`)
        .attach('file', buf, 'anh.png')
        .expect(401);
    });

    it('rejects customer uploads with 403', async () => {
      const buf = await png(400, 400);
      await server()
        .post(`/api/v1/products/${fixtures.productAId}/images`)
        .set('Authorization', `Bearer ${customerToken}`)
        .attach('file', buf, 'anh.png')
        .expect(403);
    });
  });

  describe('image lifecycle', () => {
    it('uploads, promotes, reorders, replaces and deletes images', async () => {
      // Create an isolated product so parallel suites never share image rows.
      const created = await adminPost('/api/v1/products')
        .send({
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Ảnh vòng đời ${RUN_ID}`,
        })
        .expect(201);
      const productId = created.body.id as number;

      // 1. First upload becomes the cover and is served back as a file.
      const first = await adminPost(`/api/v1/products/${productId}/images`)
        .attach('file', await png(800, 600), 'anh-1.png')
        .expect(201);
      expect(first.body.isPrimary).toBe(true);
      expect(first.body.sortOrder).toBe(0);
      expect(String(first.body.url)).toMatch(/^https?:\/\//);
      expect(first.body.mimeType).toBe('image/png');
      const firstPath = new URL(first.body.url as string).pathname;
      const served = await server().get(firstPath).expect(200);
      expect(String(served.headers['content-type'])).toMatch(/image/);

      // 2. Second upload is not the cover; switching cover works.
      const second = await adminPost(`/api/v1/products/${productId}/images`)
        .attach('file', await webp(500, 500), 'anh-2.webp')
        .expect(201);
      expect(second.body.isPrimary).toBe(false);
      await server()
        .patch(`/api/v1/products/${productId}/images/${second.body.id}/primary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // 3. Reorder swaps positions.
      const reordered = await server()
        .patch(`/api/v1/products/${productId}/images/order`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderedIds: [second.body.id, first.body.id] })
        .expect(200);
      expect((reordered.body as unknown[]).map((r) => (r as { id: number }).id)).toEqual([
        second.body.id,
        first.body.id,
      ]);

      // 4. Replace keeps id/order/cover but changes the file.
      const replaced = await adminPost(
        `/api/v1/products/${productId}/images/${first.body.id}/replace`,
      )
        .attach('file', await png(700, 700), 'anh-moi.png')
        .expect(201);
      expect(replaced.body.id).toBe(first.body.id);
      expect(replaced.body.url).not.toBe(first.body.url);
      await server().get(firstPath).expect(404);

      // 5. A renamed script is rejected as a fake image.
      await adminPost(`/api/v1/products/${productId}/images`)
        .attach('file', Buffer.from('not-an-image'), 'fake.jpg')
        .expect(400);

      // 6. Delete removes the row and the file; the product keeps its cover.
      await server()
        .delete(`/api/v1/products/${productId}/images/${first.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const detail = await server().get(`/api/v1/products/${productId}`).expect(200);
      const ids = (detail.body.images as { id: number }[]).map((i) => i.id);
      expect(ids).not.toContain(first.body.id);
      expect(ids).toContain(second.body.id);

      // Cleanup: delete the remaining image through the API (removes the file),
      // then the product row directly.
      await server()
        .delete(`/api/v1/products/${productId}/images/${second.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await prisma.product.delete({ where: { id: productId } });
    });

    it('enforces the 6-image cap', async () => {
      const created = await adminPost('/api/v1/products')
        .send({
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Ảnh giới hạn ${RUN_ID}`,
        })
        .expect(201);
      const productId = created.body.id as number;
      const ids: number[] = [];
      try {
        for (let i = 0; i < 6; i++) {
          const res = await adminPost(`/api/v1/products/${productId}/images`)
            .attach('file', await png(300, 300), `a${i}.png`)
            .expect(201);
          ids.push(res.body.id as number);
        }
        await adminPost(`/api/v1/products/${productId}/images`)
          .attach('file', await png(300, 300), 'a7.png')
          .expect(400);
      } finally {
        for (const id of ids) {
          await server()
            .delete(`/api/v1/products/${productId}/images/${id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        }
        await prisma.product.delete({ where: { id: productId } });
      }
    });

    it('keeps product edits from wiping images', async () => {
      const created = await adminPost('/api/v1/products')
        .send({
          partnerId: fixtures.partnerAId,
          categoryId: fixtures.categoryAId,
          name: `Giữ ảnh khi sửa ${RUN_ID}`,
        })
        .expect(201);
      const productId = created.body.id as number;
      try {
        const img = await adminPost(`/api/v1/products/${productId}/images`)
          .attach('file', await png(300, 300), 'giu.png')
          .expect(201);
        await server()
          .patch(`/api/v1/products/${productId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `Tên đã sửa ${RUN_ID}` })
          .expect(200);
        const detail = await server().get(`/api/v1/products/${productId}`).expect(200);
        expect((detail.body.images as unknown[])).toHaveLength(1);
        await server()
          .delete(`/api/v1/products/${productId}/images/${img.body.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      } finally {
        await prisma.product.delete({ where: { id: productId } });
      }
    });
  });

  describe('reports summary', () => {
    it('returns full-set aggregates for admins', async () => {
      const res = await server()
        .get('/api/v1/reports/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.orders.count).toBeGreaterThanOrEqual(1);
      expect(res.body.orders.totalOrderValue).toBeGreaterThanOrEqual(0);
      expect(res.body.revenue).toMatchObject({
        grossCollected: expect.any(Number),
        refundTotal: expect.any(Number),
        netCollected: expect.any(Number),
      });
      expect(res.body.commissionRecorded).toEqual(expect.any(Number));
      expect(Array.isArray(res.body.topProducts)).toBe(true);
      const statusSum = Object.values(res.body.orders.byStatus as Record<string, number>).reduce(
        (a, b) => a + b,
        0,
      );
      expect(statusSum).toBe(res.body.orders.count);
    });

    it('rejects customers and anonymous callers', async () => {
      await server()
        .get('/api/v1/reports/summary')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
      await server().get('/api/v1/reports/summary').expect(401);
    });

    it('counts beyond 100 rows (no list-cap truncation)', async () => {
      // 110 fresh orders: a capped list query would stop at 100, the
      // aggregate must see every row.
      const codes = Array.from({ length: 110 }, (_, i) => `${RUN_ID}-bulk-${i}`);
      await prisma.order.createMany({
        data: codes.map((code) => ({
          code,
          customerId: fixtures.customerId,
          shippingAddressSnapshot: { recipientName: 'Kiểm thử', phone: '0900000000', province: 'HN', detail: '...' },
          subtotal: 10000,
          grandTotal: 10000,
          status: 'PENDING_CONFIRMATION',
        })),
      });
      try {
        const res = await server()
          .get('/api/v1/reports/summary')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        expect(res.body.orders.count).toBeGreaterThan(100);
        expect(res.body.orders.byStatus.PENDING_CONFIRMATION).toBeGreaterThanOrEqual(110);
        const sum = Object.values(
          res.body.orders.byStatus as Record<string, number>,
        ).reduce((a, b) => a + b, 0);
        expect(sum).toBe(res.body.orders.count);
      } finally {
        await prisma.order.deleteMany({ where: { code: { startsWith: `${RUN_ID}-bulk-` } } });
      }
    });
  });

  describe('reports daily series', () => {
    it('returns a zero-filled, VN-day-bucketed 7-day series for admins', async () => {
      const res = await server()
        .get('/api/v1/reports/daily?days=7')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.points).toHaveLength(7);
      for (const p of res.body.points as Array<Record<string, unknown>>) {
        expect(String(p.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(p.netCollected).toBe((p.grossCollected as number) - (p.refundTotal as number));
      }
      // The fixture's delivered order + PAID payment land on today's VN day.
      const total = (res.body.points as Array<{ orderCount: number }>).reduce(
        (a, p) => a + p.orderCount,
        0,
      );
      expect(total).toBeGreaterThanOrEqual(1);
    });

    it('accepts the 30-day window too', async () => {
      const res = await server()
        .get('/api/v1/reports/daily?days=30')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.points).toHaveLength(30);
    });

    it('rejects an unsupported days value with 400', async () => {
      await server()
        .get('/api/v1/reports/daily?days=14')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('rejects customers and anonymous callers', async () => {
      await server()
        .get('/api/v1/reports/daily')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
      await server().get('/api/v1/reports/daily').expect(401);
    });
  });
});
