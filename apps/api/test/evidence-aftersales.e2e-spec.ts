import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
 * After-sales evidence + eligibility, end to end on the TEST database.
 *
 * Covers the rules that make the three flows safe:
 *
 *  - upload is authenticated, validates real bytes (not just the extension) and
 *    rejects a file whose name lies about its content;
 *  - an unbound upload is readable by NOBODY, including its own uploader;
 *  - binding only accepts the caller's own unbound upload: a foreign id and an
 *    already-bound id are both refused;
 *  - a complaint image stays invisible to the public and to other customers;
 *  - a review image becomes public ONLY while the review is APPROVED, so a
 *    PENDING review leaks nothing — which is what makes moderation meaningful;
 *  - the eligible-items endpoints only ever return the caller's own items;
 *  - a return cannot claim more than what is left after active requests.
 *
 * Files are written under a TEST-only uploads directory that is removed in
 * `afterAll`, so a run can never read or delete the deployment's real media.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2eev');

/** Isolated uploads root so the suite cannot see or delete real media. */
const TEST_UPLOADS = path.join(process.cwd(), 'uploads-e2e');

/** Password for the second customer created by this suite. */
const OTHER_PASSWORD = 'E2eOther@12345';

async function png(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 70, g: 130, b: 90 } },
  })
    .png()
    .toBuffer();
}

describe.skipIf(!hasTestDb)('After-sales evidence & eligibility (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;
  /** A second customer, used to prove cross-account isolation. */
  let otherCustomerId: number;
  let otherCustomerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    process.env.UPLOADS_DIR = TEST_UPLOADS;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);

    /**
     * A second customer is created here rather than in the shared fixture: only
     * this suite needs a "somebody else" to attempt reading and binding, and
     * adding it to the shared seeder would slow every other suite down.
     */
    const other = await prisma.user.create({
      data: {
        email: `${RUN_ID}-other@agrimarket.vn`,
        passwordHash: await bcrypt.hash(OTHER_PASSWORD, 10),
        fullName: `E2E Khách khác ${RUN_ID}`,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        customerProfile: { create: {} },
      },
    });
    otherCustomerId = other.id;
    otherCustomerToken = await login(app, other.email, OTHER_PASSWORD);
  });

  afterAll(async () => {
    if (prisma) {
      /**
       * The extra customer is removed BEFORE `cleanupFixtures`, because that
       * helper deletes users by the ids it was given and does not know about
       * this one. `evidence_images.uploaded_by_id` is `ON DELETE RESTRICT`, so
       * its uploads go first.
       */
      if (otherCustomerId) {
        await prisma.evidenceImage.deleteMany({ where: { uploadedById: otherCustomerId } });
        await prisma.user.delete({ where: { id: otherCustomerId } }).catch(() => undefined);
      }
      if (fixtures) await cleanupFixtures(prisma, fixtures);
      await prisma.$disconnect();
    }
    if (app) await app.close();
    // Only the suite's own directory is removed.
    await fs.rm(TEST_UPLOADS, { recursive: true, force: true }).catch(() => undefined);
  });

  const server = () => request(app.getHttpServer());

  const uploadEvidence = (token: string, buffer: Buffer, name = 'bang-chung.png') =>
    server()
      .post('/api/v1/evidence')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, name);

  describe('upload', () => {
    it('rejects an anonymous upload with 401', async () => {
      await server().post('/api/v1/evidence').attach('file', await png(), 'x.png').expect(401);
    });

    it('accepts a real image and returns an unbound id', async () => {
      const res = await uploadEvidence(customerToken, await png()).expect(201);
      expect(res.body.id).toBeGreaterThan(0);
      // The storage key must never leave the server: a client that knew it
      // would know the file name, and the file is not publicly served.
      expect(res.body.storageKey).toBeUndefined();
      expect(res.body.mimeType).toBe('image/png');
    });

    it('rejects a file whose extension lies about its content', async () => {
      const notAnImage = Buffer.from('#!/bin/sh\necho not an image\n');
      await uploadEvidence(customerToken, notAnImage, 'trojan.png').expect(400);
    });

    it('rejects an unsupported extension', async () => {
      await uploadEvidence(customerToken, await png(), 'evidence.gif').expect(400);
    });
  });

  describe('unbound uploads are unreachable', () => {
    it('returns 404 to the uploader, an admin and the public', async () => {
      const uploaded = await uploadEvidence(customerToken, await png()).expect(201);
      const id = uploaded.body.id;

      await server().get(`/api/v1/evidence/${id}/file`).expect(404);
      await server()
        .get(`/api/v1/evidence/${id}/file`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(404);
      await server()
        .get(`/api/v1/evidence/${id}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('binding', () => {
    it('refuses an id the caller did not upload', async () => {
      // Uploaded by the customer, then used by the other account.
      const uploaded = await uploadEvidence(customerToken, await png()).expect(201);
      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .send({
          orderId: fixtures.orderId,
          type: 'PRODUCT_QUALITY',
          content: 'Thuộc tài khoản khác',
          evidenceIds: [uploaded.body.id],
        })
        .expect(400);
    });

    it('refuses an id that does not exist', async () => {
      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: fixtures.orderId,
          type: 'PRODUCT_QUALITY',
          content: 'Ảnh không tồn tại',
          evidenceIds: [99999999],
        })
        .expect(400);
    });

    it('refuses the same upload twice', async () => {
      const uploaded = await uploadEvidence(customerToken, await png()).expect(201);
      const id = uploaded.body.id;

      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: fixtures.orderId,
          type: 'DELIVERY',
          content: 'Lần một',
          evidenceIds: [id],
        })
        .expect(201);

      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: fixtures.orderId,
          type: 'DELIVERY',
          content: 'Lần hai, tái sử dụng ảnh',
          evidenceIds: [id],
        })
        .expect(400);
    });

    it('rejects more than five images in one request', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const r = await uploadEvidence(customerToken, await png(120, 120)).expect(201);
        ids.push(r.body.id);
      }
      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: fixtures.orderId,
          type: 'OTHER',
          content: 'Quá nhiều ảnh',
          evidenceIds: ids,
        })
        .expect(400);
    });
  });

  describe('complaint evidence privacy', () => {
    let complaintId: number;
    let imageId: number;

    beforeAll(async () => {
      const uploaded = await uploadEvidence(customerToken, await png()).expect(201);
      imageId = uploaded.body.id;
      const created = await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: fixtures.orderId,
          type: 'PRODUCT_QUALITY',
          content: `Khiếu nại có ảnh ${RUN_ID}`,
          evidenceIds: [imageId],
        })
        .expect(201);
      complaintId = created.body.id;
    });

    it('is readable by the owner', async () => {
      await server()
        .get(`/api/v1/evidence/${imageId}/file`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200)
        .expect('Content-Type', /image\/png/);
    });

    it('is readable by an ADMIN', async () => {
      await server()
        .get(`/api/v1/evidence/${imageId}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('is NOT readable anonymously', async () => {
      await server().get(`/api/v1/evidence/${imageId}/file`).expect(404);
    });

    it('is NOT readable by another customer', async () => {
      await server()
        .get(`/api/v1/evidence/${imageId}/file`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(404);
    });

    it('appears in the owner detail and the admin detail', async () => {
      const mine = await server()
        .get(`/api/v1/complaints/me/${complaintId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(mine.body.evidence.map((e: { id: number }) => e.id)).toContain(imageId);

      const admin = await server()
        .get(`/api/v1/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(admin.body.evidence.map((e: { id: number }) => e.id)).toContain(imageId);
    });

    it('never lists another customer complaint', async () => {
      const theirs = await server()
        .get('/api/v1/complaints/me')
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(200);
      const ids = theirs.body.data.map((c: { id: number }) => c.id);
      expect(ids).not.toContain(complaintId);
    });
  });

  describe('review evidence follows moderation', () => {
    let reviewId: number;
    let imageId: number;

    beforeAll(async () => {
      /**
       * A fresh order item is needed: the fixture's reviewable item is consumed
       * by the review created here, and `reviews_order_item_id_key` makes a
       * second review on the same item impossible by design.
       */
      const uploaded = await uploadEvidence(customerToken, await png()).expect(201);
      imageId = uploaded.body.id;
      const created = await server()
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderItemId: fixtures.orderItemBId,
          rating: 4,
          content: `Đánh giá có ảnh ${RUN_ID}`,
          evidenceIds: [imageId],
        })
        .expect(201);
      reviewId = created.body.id;
    });

    it('is readable by the reviewer and an ADMIN while PENDING', async () => {
      // Force PENDING so the public case below is a real transition.
      await server()
        .patch(`/api/v1/reviews/${reviewId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PENDING' })
        .expect(200);

      await server()
        .get(`/api/v1/evidence/${imageId}/file`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      await server()
        .get(`/api/v1/evidence/${imageId}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('is NOT public while the review is PENDING', async () => {
      await server().get(`/api/v1/evidence/${imageId}/file`).expect(404);
    });

    it('is NOT public while the review is HIDDEN', async () => {
      await server()
        .patch(`/api/v1/reviews/${reviewId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'HIDDEN' })
        .expect(200);

      await server().get(`/api/v1/evidence/${imageId}/file`).expect(404);
    });

    it('becomes public once the review is APPROVED', async () => {
      await server()
        .patch(`/api/v1/reviews/${reviewId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      await server().get(`/api/v1/evidence/${imageId}/file`).expect(200);
    });

    it('exposes the image ids on the public product reviews feed', async () => {
      const feed = await server()
        .get(`/api/v1/reviews/product/${fixtures.productAId}`)
        .expect(200);
      const mine = feed.body.data.find((r: { id: number }) => r.id === reviewId);
      expect(mine).toBeDefined();
      expect(mine.evidence.map((e: { id: number }) => e.id)).toContain(imageId);
    });
  });

  describe('eligible-items endpoints', () => {
    it('requires authentication', async () => {
      await server().get('/api/v1/reviews/me/eligible-items').expect(401);
      await server().get('/api/v1/returns/me/eligible-items').expect(401);
    });

    it('rejects an ADMIN (customer-only routes)', async () => {
      await server()
        .get('/api/v1/reviews/me/eligible-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('never returns another customer items', async () => {
      const theirs = await server()
        .get('/api/v1/reviews/me/eligible-items')
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(200);
      expect(theirs.body.data).toHaveLength(0);

      const theirReturns = await server()
        .get('/api/v1/returns/me/eligible-items')
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(200);
      expect(theirReturns.body.data).toHaveLength(0);
    });

    it('lists a returnable item with its remaining quantity', async () => {
      const res = await server()
        .get('/api/v1/returns/me/eligible-items')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const item = res.body.data.find(
        (i: { orderItemId: number }) => i.orderItemId === fixtures.orderItemId,
      );
      expect(item).toBeDefined();
      expect(Number(item.returnableQuantity)).toBeGreaterThan(0);
      expect(Number(item.returnableQuantity)).toBeLessThanOrEqual(
        Number(item.purchasedQuantity),
      );
    });

    it('does not offer an item that was already fully claimed', async () => {
      /**
       * A dedicated order item is created for this test so the shared fixture
       * keeps its own state for the other suites.
       */
      const full = await prisma.orderItem.create({
        data: {
          partnerOrderId: fixtures.partnerOrderId,
          productVariantId: fixtures.variantAId,
          productNameSnapshot: `Hết hạn trả ${RUN_ID}`,
          skuSnapshot: `${RUN_ID}-FULL`,
          unitPriceSnapshot: 10000,
          quantity: 2,
          subtotal: 20000,
        },
      });
      await prisma.returnRequest.create({
        data: {
          orderId: fixtures.orderId,
          orderItemId: full.id,
          customerId: fixtures.customerId,
          quantity: 2,
          reason: 'Đã yêu cầu trả toàn bộ',
          status: 'REQUESTED',
        },
      });

      const res = await server()
        .get('/api/v1/returns/me/eligible-items')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const ids = res.body.data.map((i: { orderItemId: number }) => i.orderItemId);
      expect(ids).not.toContain(full.id);
    });

    it('refuses a return that exceeds what is left, not the purchased amount', async () => {
      const partial = await prisma.orderItem.create({
        data: {
          partnerOrderId: fixtures.partnerOrderId,
          productVariantId: fixtures.variantAId,
          productNameSnapshot: `Trả một phần ${RUN_ID}`,
          skuSnapshot: `${RUN_ID}-PART`,
          unitPriceSnapshot: 10000,
          quantity: 5,
          subtotal: 50000,
        },
      });

      // Claim 4 of 5 first.
      await server()
        .post('/api/v1/returns')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ orderItemId: partial.id, quantity: 4, reason: 'Trả 4' })
        .expect(201);

      // 2 is <= the purchased 5, but more than the 1 that is left.
      await server()
        .post('/api/v1/returns')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ orderItemId: partial.id, quantity: 2, reason: 'Vượt số còn lại' })
        .expect(400);

      // The remaining 1 is accepted.
      await server()
        .post('/api/v1/returns')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ orderItemId: partial.id, quantity: 1, reason: 'Trả nốt' })
        .expect(201);
    });

    it('refuses a complaint line that belongs to a different order', async () => {
      /**
       * A SECOND order is needed for this test. Reusing the fixture's partner
       * order would not prove anything: an `orderItem` reached through
       * `partnerOrderId` belongs to that partner order, and therefore to the
       * fixture order, so the check would rightly accept it.
       */
      const otherOrder = await prisma.order.create({
        data: {
          code: `${RUN_ID}-ORDER2`,
          customerId: fixtures.customerId,
          shippingAddressSnapshot: { detail: 'X', province: 'Hưng Yên' },
          subtotal: 10000,
          shippingFee: 0,
          grandTotal: 10000,
          status: 'DELIVERED',
        },
      });
      const otherPartnerOrder = await prisma.partnerOrder.create({
        data: {
          code: `${RUN_ID}-PO2`,
          orderId: otherOrder.id,
          partnerId: fixtures.partnerAId,
          subtotal: 10000,
          payableAmount: 10000,
        },
      });
      const foreign = await prisma.orderItem.create({
        data: {
          partnerOrderId: otherPartnerOrder.id,
          productVariantId: fixtures.variantAId,
          productNameSnapshot: `Dòng đơn khác ${RUN_ID}`,
          skuSnapshot: `${RUN_ID}-FOREIGN`,
          unitPriceSnapshot: 10000,
          quantity: 1,
          subtotal: 10000,
        },
      });

      /**
       * `orderItemId` and `orderId` are both sent, but the line belongs to a
       * DIFFERENT order. The FK alone would accept this; the service must
       * reject it, which is what stops a complaint from citing goods the
       * customer did not buy on that order.
       */
      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: fixtures.orderId,
          orderItemId: foreign.id,
          type: 'PRODUCT_QUALITY',
          content: 'Dòng đơn không thuộc đơn này',
        })
        .expect(400);

      // The same line IS accepted against the order it really belongs to, which
      // proves the rejection above came from the mismatch and not from an
      // over-broad rule.
      await server()
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId: otherOrder.id,
          orderItemId: foreign.id,
          type: 'PRODUCT_QUALITY',
          content: 'Đúng đơn của dòng này',
        })
        .expect(201);
    });
  });
});


