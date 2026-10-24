import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { OrdersService } from '../src/orders/orders.service.js';
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
 * Release-blocker acceptance (real HTTP + real TEST_DATABASE_URL).
 *
 *   C-05 — a refund that closes a return cannot exceed the returned goods value
 *          (`quantity × unitPriceSnapshot`), even when the paid amount is higher.
 *   C-06 — the Admin UI gets an eligible-refund list instead of a raw id field.
 *   C-17 — an unconfirmed reservation past its deadline is cancelled through the
 *          guarded transition and its stock is released exactly once.
 *   C-11 — an INACTIVE product is not readable through the public detail route.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2erb');

const address = {
  recipientName: 'Release Blocker Khách',
  phone: '0911111111',
  province: 'Hưng Yên',
  detail: 'Số 1, đường kiểm thử',
};

describe.skipIf(!hasTestDb)('Release blockers (e2e)', () => {
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
  }, 60_000);

  afterAll(async () => {
    await cleanupFixtures(prisma, fixtures).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
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
  const refund = (body: Record<string, unknown>, suffix: string) =>
    request(app.getHttpServer())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `${RUN_ID}-${suffix}`)
      .send(body);

  // ------------------------------------------------------------------ C-11

  describe('C-11 — public product visibility', () => {
    it('hides an INACTIVE product from the public detail route', async () => {
      await get(`/api/v1/products/${fixtures.productBId}`).expect(404);

      const admin = await get(`/api/v1/products/admin/${fixtures.productBId}`, adminToken).expect(
        200,
      );
      expect(admin.body.status).toBe('INACTIVE');
    });
  });

  // ------------------------------------------------------------- C-05/C-06

  describe('C-05/C-06 — refund capped by returned goods value', () => {
    let refundId: number;

    beforeAll(async () => {
      // The fixture return is REQUESTED; the refund-link rule only applies once
      // the goods are at QC. The transition itself is covered elsewhere, so the
      // setup moves the row directly to the state under test.
      await prisma.returnRequest.update({
        where: { id: fixtures.returnId },
        data: { status: 'QC_PENDING' },
      });
    });

    it('rejects a refund above the returned value even below the paid amount', async () => {
      // Fixture line: 1 × 25,000 = 25,000 returned; payment PAID 100,000.
      const res = await refund(
        {
          paymentId: fixtures.paymentId,
          amount: 60_000,
          reason: 'Vượt giá trị hàng trả',
          returnRequestId: fixtures.returnId,
        },
        'over-value',
      ).expect(400);

      expect(res.body.message).toMatch(/value of the returned goods/);
      expect(
        await prisma.refund.count({ where: { paymentId: fixtures.paymentId } }),
      ).toBe(0);
    });

    it('creates a PENDING refund exactly equal to the returned value', async () => {
      const res = await refund(
        {
          paymentId: fixtures.paymentId,
          amount: 25_000,
          reason: 'Hoàn đúng giá trị hàng trả',
          returnRequestId: fixtures.returnId,
        },
        'valid',
      ).expect(201);

      refundId = res.body.id;
      expect(res.body.status).toBe('PENDING');

      const linked = await prisma.returnRequest.findUniqueOrThrow({
        where: { id: fixtures.returnId },
      });
      expect(linked.refundId).toBe(refundId);
    });

    it('does not offer a PENDING refund as eligible', async () => {
      const res = await get(
        `/api/v1/returns/${fixtures.returnId}/eligible-refunds`,
        adminToken,
      ).expect(200);

      expect(res.body.returnValue).toBe('25000');
      expect(res.body.data).toHaveLength(0);
    });

    it('completes the refund and only then offers it as eligible', async () => {
      await post(`/api/v1/refunds/${refundId}/approve`, adminToken, {}).expect(201);
      await post(`/api/v1/refunds/${refundId}/complete`, adminToken, {
        reference: `${RUN_ID}-BANK-1`,
      }).expect(201);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: fixtures.paymentId },
      });
      expect(payment.status).toBe('PARTIALLY_REFUNDED');

      const res = await get(
        `/api/v1/returns/${fixtures.returnId}/eligible-refunds`,
        adminToken,
      ).expect(200);
      const row = (res.body.data as Array<Record<string, unknown>>).find(
        (r) => r.id === refundId,
      );
      expect(row).toBeDefined();
      expect(Number(row!.amount)).toBe(25_000);
      expect(row!.linkedToThisReturn).toBe(true);
    });

    it('re-checks the cap when PATCH links a COMPLETED refund', async () => {
      const return2 = await prisma.returnRequest.create({
        data: {
          orderId: fixtures.orderId,
          orderItemId: fixtures.orderItemId,
          customerId: fixtures.customerId,
          quantity: 1,
          reason: `Kiểm tra trần hoàn tiền ${RUN_ID}`,
          status: 'QC_PENDING',
        },
      });

      const created = await refund(
        {
          paymentId: fixtures.paymentId,
          amount: 30_000,
          reason: 'Hoàn không gắn return',
        },
        'unlinked',
      ).expect(201);
      await post(`/api/v1/refunds/${created.body.id}/approve`, adminToken, {}).expect(201);
      await post(`/api/v1/refunds/${created.body.id}/complete`, adminToken, {
        reference: `${RUN_ID}-BANK-2`,
      }).expect(201);

      const res = await patch(`/api/v1/returns/${return2.id}`, adminToken, {
        status: 'REFUNDED',
        refundId: created.body.id,
      }).expect(400);
      expect(res.body.message).toMatch(/exceeds the value of the returned goods/);

      const unchanged = await prisma.returnRequest.findUniqueOrThrow({
        where: { id: return2.id },
      });
      expect(unchanged.status).toBe('QC_PENDING');
      expect(unchanged.refundId).toBeNull();
    });
  });

  // ------------------------------------------------------------------ C-17

  describe('C-17 — expired reservation releases stock', () => {
    it('cancels an unconfirmed order past its deadline and releases the reservation once', async () => {
      const preview = await post('/api/v1/orders/checkout-preview', customerToken, {
        items: [{ productVariantId: fixtures.variantAId, quantity: 2 }],
      }).expect(201);

      const created = await post('/api/v1/orders/checkout', customerToken, {
        shippingAddress: address,
        items: [{ productVariantId: fixtures.variantAId, quantity: 2 }],
        paymentMethod: 'COD',
        expectedGrandTotal: Number(preview.body.grandTotal),
      }).expect(201);
      const orderId = created.body.id as number;

      const pending = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(pending.status).toBe('PENDING_CONFIRMATION');
      expect(pending.reservationExpiresAt).not.toBeNull();

      const before = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      });

      // Move the deadline into the past, exactly what the sweep sees.
      await prisma.order.update({
        where: { id: orderId },
        data: { reservationExpiresAt: new Date(Date.now() - 60_000) },
      });

      const orders = app.get(OrdersService);
      expect(await orders.expireReservation(orderId)).toEqual({ expired: true });

      const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.reservationExpiresAt).toBeNull();

      const after = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      });
      expect(Number(after.reserved)).toBe(Number(before.reserved) - 2);
      expect(Number(after.onHand)).toBe(Number(before.onHand));

      const movement = await prisma.inventoryMovement.findFirst({
        where: {
          type: 'RELEASE',
          referenceType: 'OrderCancel',
          referenceId: orderId,
        },
      });
      expect(movement).not.toBeNull();
      expect(Number(movement!.quantityDelta)).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'ORDER_RESERVATION_EXPIRED',
          entityType: 'Order',
          entityId: String(orderId),
        },
      });
      expect(audit).not.toBeNull();

      // A second sweep tick is a no-op: the status gate refuses to release twice.
      expect(await orders.expireReservation(orderId)).toEqual({
        expired: false,
        reason: 'NOT_PENDING',
      });
      const again = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      });
      expect(Number(again.reserved)).toBe(Number(after.reserved));
    });
  });
});
