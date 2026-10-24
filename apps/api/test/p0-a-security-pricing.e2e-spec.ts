import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { FLAT_SHIPPING_FEE } from '../src/orders/shipping-policy.js';
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
 * P0-A acceptance suite (real HTTP + real TEST_DATABASE_URL).
 *
 * Covers:
 *   P0-A1 — login, token verification, role authorization, no refresh endpoint.
 *            (Startup refusal is covered by `jwt-config.spec.ts`.)
 *   P0-A2 — public partner list/detail/search and nested routes never expose
 *            tax/bank fields; ADMIN still receives the full row; the update
 *            audit snapshot keeps the full pre-image.
 *   P0-A3 — create/update rejection for invalid discounts; 0/50/100%; a
 *            DB-injected legacy 200% row; real checkouts with non-negative
 *            final totals.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2ep0a');

const SENSITIVE_PARTNER_FIELDS = [
  'taxCode',
  'bankAccountName',
  'bankAccountNumber',
  'bankName',
] as const;

function expectNoSensitivePartnerFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const field of SENSITIVE_PARTNER_FIELDS) {
    expect(value as Record<string, unknown>).not.toHaveProperty(field);
    expect(serialized).not.toContain(`"${field}"`);
  }
}

describe.skipIf(!hasTestDb)('P0-A security & pricing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;
  let wrongSecretToken: string;

  const createdDiscountIds: number[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);

    // A structurally valid token signed with a DIFFERENT key: verification must
    // happen against the configured secret, not merely decode the payload.
    wrongSecretToken = await new JwtService({
      secret: 'wrong-test-secret-0123456789abcdef0123456789abcdef',
    }).signAsync({
      sub: fixtures.customerId,
      email: fixtures.customerEmail,
      role: 'CUSTOMER',
    });
  });

  afterEach(async () => {
    if (createdDiscountIds.length > 0) {
      await prisma.productDiscount.deleteMany({
        where: { id: { in: createdDiscountIds.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    if (prisma && fixtures) {
      await cleanupFixtures(prisma, fixtures);
      // Vouchers are not part of the fixture graph; remove the run's own codes
      // after the redemption rows (deleted by cleanupFixtures) are gone.
      await prisma.voucher.deleteMany({ where: { code: { startsWith: RUN_ID } } });
      const leftovers = await prisma.voucher.count({
        where: { code: { startsWith: RUN_ID } },
      });
      expect(leftovers).toBe(0);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const post = (path: string, token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const patch = (path: string, token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const address = {
    recipientName: 'P0-A Khách',
    phone: '0911111111',
    province: 'Hưng Yên',
    detail: 'Số 1, đường P0-A',
  };

  async function createProductDiscount(
    discountValue: number,
    discountType: 'PERCENT' | 'FIXED' = 'PERCENT',
  ) {
    const res = await post('/api/v1/product-discounts', adminToken, {
      productVariantId: fixtures.variantAId,
      discountType,
      discountValue,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'ACTIVE',
    }).expect(201);
    createdDiscountIds.push(res.body.id as number);
    return res.body;
  }

  function createVoucher(overrides: Record<string, unknown>) {
    return post('/api/v1/vouchers', adminToken, {
      code: `${RUN_ID}-V${Date.now()}`,
      name: `P0-A voucher ${RUN_ID}`,
      discountType: 'PERCENT',
      discountValue: 50,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'ACTIVE',
      ...overrides,
    });
  }

  async function preview(quantity: number, voucherCode?: string) {
    return post('/api/v1/orders/checkout-preview', customerToken, {
      items: [{ productVariantId: fixtures.variantAId, quantity }],
      ...(voucherCode ? { voucherCode } : {}),
    }).expect(201);
  }

  async function checkout(
    quantity: number,
    expectedGrandTotal: number,
    voucherCode?: string,
  ) {
    return post('/api/v1/orders/checkout', customerToken, {
      shippingAddress: address,
      items: [{ productVariantId: fixtures.variantAId, quantity }],
      paymentMethod: 'COD',
      expectedGrandTotal,
      ...(voucherCode ? { voucherCode } : {}),
    }).expect(201);
  }

  // ------------------------------------------------------------------ P0-A1

  describe('P0-A1 — JWT login, verification and authorization', () => {
    it('logs in and accepts a token signed with the configured test secret', async () => {
      const res = await get('/api/v1/auth/me', adminToken).expect(200);
      expect(res.body).toMatchObject({ email: fixtures.adminEmail, role: 'ADMIN' });
    });

    it('rejects a missing token', async () => {
      await get('/api/v1/auth/me').expect(401);
    });

    it('rejects a tampered token', async () => {
      await get('/api/v1/auth/me', `${customerToken}x`).expect(401);
    });

    it('rejects a token signed with a different secret', async () => {
      await get('/api/v1/auth/me', wrongSecretToken).expect(401);
    });

    it('enforces role-based authorization (customer 403, anonymous 401, admin 200)', async () => {
      await get('/api/v1/customers', customerToken).expect(403);
      await get('/api/v1/customers').expect(401);
      await get('/api/v1/customers', adminToken).expect(200);
    });

    it('has no refresh endpoint (login issues one 7-day access token only)', async () => {
      // Documented N/A: this codebase does not implement refresh tokens. The
      // route must not silently exist with weaker semantics.
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({}).expect(404);
    });
  });

  // ------------------------------------------------------------------ P0-A2

  describe('P0-A2 — public partner data', () => {
    it('returns only public fields from anonymous detail', async () => {
      const res = await get(`/api/v1/partners/${fixtures.partnerAId}`).expect(200);
      expect(res.body).toMatchObject({
        id: fixtures.partnerAId,
        code: `${RUN_ID}-PARTNER-A`,
        name: `HTX Rau sạch ${RUN_ID}`,
        representativeName: 'Nguyễn Văn A',
        phone: '0987654321',
        email: `${RUN_ID}-a@partner.vn`,
        address: 'Hưng Yên',
        status: 'ACTIVE',
      });
      expectNoSensitivePartnerFields(res.body);
      expect(JSON.stringify(res.body)).not.toContain('9704000000000001');
    });

    it('applies the public projection to customer list/search results', async () => {
      const res = await get(
        `/api/v1/partners?search=${encodeURIComponent(RUN_ID)}&limit=100`,
        customerToken,
      ).expect(200);

      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data.some((p: { id: number }) => p.id === fixtures.partnerAId)).toBe(true);
      for (const partner of res.body.data) expectNoSensitivePartnerFields(partner);
      expect(JSON.stringify(res.body)).not.toContain('9704000000000001');
    });

    it('still returns the full row to an ADMIN (detail and list)', async () => {
      const detail = await get(`/api/v1/partners/${fixtures.partnerAId}`, adminToken).expect(200);
      expect(detail.body).toMatchObject({
        taxCode: `${RUN_ID}-TAX-A`,
        bankAccountName: 'E2E Partner A',
        bankAccountNumber: '9704000000000001',
        bankName: 'VietinBank E2E',
      });

      const list = await get(
        `/api/v1/partners?search=${encodeURIComponent(RUN_ID)}&limit=100`,
        adminToken,
      ).expect(200);
      const adminPartner = list.body.data.find(
        (p: { id: number }) => p.id === fixtures.partnerAId,
      );
      expect(adminPartner).toMatchObject({
        taxCode: `${RUN_ID}-TAX-A`,
        bankAccountNumber: '9704000000000001',
      });
    });

    it('keeps the full pre-image (tax/bank) in the update audit snapshot', async () => {
      const originalName = `HTX Rau sạch ${RUN_ID}`;
      await patch(`/api/v1/partners/${fixtures.partnerAId}`, adminToken, {
        name: `${originalName} (updated)`,
      }).expect(200);

      const audit = await prisma.auditLog.findFirst({
        where: {
          actorUserId: fixtures.adminId,
          action: 'UPDATE',
          entityType: 'Partner',
          entityId: String(fixtures.partnerAId),
        },
        orderBy: { id: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.beforeJson).toMatchObject({
        taxCode: `${RUN_ID}-TAX-A`,
        bankAccountName: 'E2E Partner A',
        bankAccountNumber: '9704000000000001',
        bankName: 'VietinBank E2E',
      });

      // Restore the fixture name for the remaining assertions.
      await patch(`/api/v1/partners/${fixtures.partnerAId}`, adminToken, {
        name: originalName,
      }).expect(200);
    });

    it('does not leak the partner bank/tax fields through nested public routes', async () => {
      const lot = await get(`/api/v1/lots/${fixtures.lotAId}`).expect(200);
      expect(lot.body.product.partner).toMatchObject({
        id: fixtures.partnerAId,
        code: `${RUN_ID}-PARTNER-A`,
        name: `HTX Rau sạch ${RUN_ID}`,
      });
      expectNoSensitivePartnerFields(lot.body.product.partner);

      const season = await get(`/api/v1/seasons/${fixtures.seasonAId}`).expect(200);
      expectNoSensitivePartnerFields(season.body.farm.partner);

      const lotRow = await prisma.productLot.findUniqueOrThrow({
        where: { id: fixtures.lotAId },
        select: { traceCode: true },
      });
      const trace = await get(`/api/v1/trace/${lotRow.traceCode}`).expect(200);
      expect(trace.body.partner).toMatchObject({
        name: `HTX Rau sạch ${RUN_ID}`,
        representativeName: 'Nguyễn Văn A',
      });
      expect(JSON.stringify(trace.body)).not.toContain('9704000000000001');
      expect(JSON.stringify(trace.body)).not.toContain(`${RUN_ID}-TAX-A`);
    });
  });

  // ------------------------------------------------------------------ P0-A3

  describe('P0-A3 — promotion validation', () => {
    it.each([101, 1000])('rejects PERCENT %i on voucher create', async (value) => {
      const code = `${RUN_ID}-REJECT-${value}`;
      const res = await createVoucher({ code, discountValue: value }).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/must not exceed 100/);
      expect(await prisma.voucher.findUnique({ where: { code } })).toBeNull();
    });

    it.each([101, -1, 'abc', null])(
      'rejects an invalid product discount value (%s) on create',
      async (value) => {
        const before = await prisma.productDiscount.count({
          where: { productVariantId: fixtures.variantAId },
        });
        const res = await post('/api/v1/product-discounts', adminToken, {
          productVariantId: fixtures.variantAId,
          discountType: 'PERCENT',
          discountValue: value,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
          status: 'ACTIVE',
        }).expect(400);
        expect(JSON.stringify(res.body.message)).toMatch(/discountValue|PERCENT/);
        const after = await prisma.productDiscount.count({
          where: { productVariantId: fixtures.variantAId },
        });
        expect(after).toBe(before);
      },
    );

    it('rejects the old conditional-validator hole: FIXED -5 / "abc" / null', async () => {
      for (const value of [-5, 'abc', null]) {
        await createVoucher({
          code: `${RUN_ID}-FIXED-${String(value)}`,
          discountType: 'FIXED',
          discountValue: value,
        }).expect(400);
      }
    });

    it('rejects any attempt to change discountValue through the status-only PATCH', async () => {
      const discount = await createProductDiscount(50);

      await patch(`/api/v1/product-discounts/${discount.id}`, adminToken, {
        status: 'INACTIVE',
        discountValue: 101,
      }).expect(400);
      await patch(`/api/v1/product-discounts/${discount.id}`, adminToken, {
        discountValue: 101,
      }).expect(400);

      const off = await patch(`/api/v1/product-discounts/${discount.id}`, adminToken, {
        status: 'INACTIVE',
      }).expect(200);
      expect(off.body.status).toBe('INACTIVE');
      const row = await prisma.productDiscount.findUniqueOrThrow({
        where: { id: discount.id },
      });
      expect(Number(row.discountValue)).toBe(50);
    });

    it('accepts 0% without changing the price', async () => {
      await createProductDiscount(0);
      const res = await preview(1);
      expect(Number(res.body.items[0].unitPrice)).toBe(25000);
      expect(Number(res.body.items[0].discountAmount)).toBe(0);
      expect(Number(res.body.subtotal)).toBe(25000);
    });

    it('prices and checks out a real 50% product discount', async () => {
      await createProductDiscount(50);

      const previewRes = await preview(1);
      expect(Number(previewRes.body.items[0].unitPrice)).toBe(12500);
      expect(Number(previewRes.body.subtotal)).toBe(12500);
      expect(Number(previewRes.body.shippingFee)).toBe(FLAT_SHIPPING_FEE);
      expect(Number(previewRes.body.grandTotal)).toBe(12500 + FLAT_SHIPPING_FEE);

      const order = await checkout(1, Number(previewRes.body.grandTotal));
      expect(Number(order.body.subtotal)).toBe(12500);
      expect(Number(order.body.discountTotal)).toBe(0);
      expect(Number(order.body.grandTotal)).toBe(12500 + FLAT_SHIPPING_FEE);
      expect(Number(order.body.grandTotal)).toBeGreaterThanOrEqual(0);

      const item = await prisma.orderItem.findFirstOrThrow({
        where: { partnerOrder: { orderId: order.body.id } },
      });
      expect(Number(item.unitPriceSnapshot)).toBe(12500);
    });

    it('prices and checks out a real 100% voucher (final total non-negative)', async () => {
      const code = `${RUN_ID}-V100`;
      const created = await createVoucher({
        code,
        discountType: 'PERCENT',
        discountValue: 100,
      }).expect(201);
      expect(Number(created.body.discountValue)).toBe(100);

      const previewRes = await preview(2, code);
      expect(Number(previewRes.body.subtotal)).toBe(50000);
      expect(Number(previewRes.body.discountTotal)).toBe(50000);
      expect(Number(previewRes.body.shippingFee)).toBe(FLAT_SHIPPING_FEE);
      expect(Number(previewRes.body.grandTotal)).toBe(FLAT_SHIPPING_FEE);

      const order = await checkout(2, Number(previewRes.body.grandTotal), code);
      expect(Number(order.body.discountTotal)).toBe(50000);
      expect(Number(order.body.grandTotal)).toBe(FLAT_SHIPPING_FEE);
      expect(Number(order.body.grandTotal)).toBeGreaterThanOrEqual(0);

      const redemption = await prisma.voucherRedemption.findFirstOrThrow({
        where: { orderId: order.body.id, voucherId: created.body.id },
      });
      expect(Number(redemption.discountAmount)).toBe(50000);
    });

    it('clamps a DB-injected legacy PERCENT 200 row and still checks out at 0', async () => {
      // Simulates a row created before validation existed. This test must not
      // modify historical data in production; it only injects into TEST_DB.
      const legacy = await prisma.productDiscount.create({
        data: {
          productVariantId: fixtures.variantAId,
          discountType: 'PERCENT',
          discountValue: 200,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 86_400_000),
          status: 'ACTIVE',
        },
      });
      createdDiscountIds.push(legacy.id);

      const previewRes = await preview(1);
      expect(Number(previewRes.body.items[0].unitPrice)).toBe(0);
      expect(Number(previewRes.body.items[0].discountAmount)).toBe(25000);
      expect(Number(previewRes.body.subtotal)).toBe(0);
      expect(Number(previewRes.body.shippingFee)).toBe(0);
      expect(Number(previewRes.body.grandTotal)).toBe(0);

      const order = await checkout(1, 0);
      expect(Number(order.body.grandTotal)).toBe(0);
      expect(Number(order.body.grandTotal)).toBeGreaterThanOrEqual(0);
    });
  });
});
