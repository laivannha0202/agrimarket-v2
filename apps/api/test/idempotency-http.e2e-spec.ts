import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { IDEMPOTENCY_SCOPES } from '../src/common/idempotency/idempotency.constants.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  E2E_PREFIX,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';
import { createTestApp, login } from './helpers/test-app.js';

/**
 * HTTP contract of the idempotency ledger (round 4).
 *
 * The service-level matrix lives in `idempotency.e2e-spec.ts`; this suite
 * proves the request path:
 *
 *  - the `Idempotency-Key` header is mandatory (400 before any write);
 *  - a retry with the same key + payload returns the SAME JSON body with 201;
 *  - the same key with a different payload is a 409 and changes nothing;
 *  - different keys are independent operations;
 *  - the key is endpoint-scoped (one string can key an adjust and a payout);
 *  - a retry still replays after the parent state changed (payment REFUNDED).
 *
 * Every row is tagged with the `e2e…` run prefix and removed in `afterAll`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2ei');

describe.skipIf(!hasTestDb)('AgriMarket API — idempotency HTTP contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let confirmedSettlementId: number;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    // A dedicated CONFIRMED settlement: the seeded one is DRAFT and already
    // carries a PENDING payout of its full payable amount.
    const settlement = await prisma.settlement.create({
      data: {
        code: `${RUN_ID}-IDEM-SET`,
        partnerId: fixtures.partnerAId,
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(),
        grossAmount: 100000,
        refundAmount: 0,
        commissionAmount: 0,
        adjustmentAmount: 0,
        payableAmount: 100000,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
    confirmedSettlementId = settlement.id;

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
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

  const post = (path: string, body: unknown, idempotencyKey?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${adminToken}`);
    if (idempotencyKey !== undefined) req.set('Idempotency-Key', idempotencyKey);
    return req.send(body as object);
  };

  const keyRow = (scope: string, key: string) =>
    prisma.appIdempotencyKey.findUnique({
      where: {
        scope_actorUserId_key: {
          scope,
          actorUserId: fixtures.adminId,
          key,
        },
      },
    });

  const adjustmentCount = () =>
    prisma.inventoryMovement.count({
      where: {
        warehouseId: fixtures.warehouseId,
        productLotId: fixtures.lotAId,
        productVariantId: fixtures.variantAId,
        type: 'ADJUSTMENT',
        createdByUserId: fixtures.adminId,
      },
    });

  const adjustBody = (quantityDelta: number) => ({
    warehouseId: fixtures.warehouseId,
    productLotId: fixtures.lotAId,
    productVariantId: fixtures.variantAId,
    quantityDelta,
    note: 'HTTP idempotency',
  });

  describe('inventory adjust over HTTP', () => {
    const key = `${RUN_ID}-http-adjust-1`;

    it('refuses a request without the Idempotency-Key header before writing', async () => {
      const res = await post('/api/v1/inventory/adjust', adjustBody(10)).expect(400);
      expect(res.body.message).toMatch(/Idempotency-Key header is required/i);
      expect(await adjustmentCount()).toBe(0);
      expect(await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, key)).toBeNull();
    });

    it('replays the exact same JSON body for one key + payload', async () => {
      const first = await post('/api/v1/inventory/adjust', adjustBody(10), key).expect(201);
      expect(Number(first.body.onHand)).toBe(210);

      const retry = await post('/api/v1/inventory/adjust', adjustBody(10), key).expect(201);
      expect(retry.body).toEqual(first.body);
      expect(await adjustmentCount()).toBe(1);
      expect(Number((await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      })).onHand)).toBe(210);

      const row = await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, key);
      expect(row?.responseStatus).toBe(201);
      expect(row?.responseJson).toEqual(first.body);
    });

    it('rejects the same key with a different payload (409) without touching stock', async () => {
      const res = await post('/api/v1/inventory/adjust', adjustBody(11), key).expect(409);
      expect(res.body.message).toMatch(/different request payload/i);
      expect(await adjustmentCount()).toBe(1);
      const balance = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: fixtures.balanceAId },
      });
      expect(Number(balance.onHand)).toBe(210);
    });

    it('treats a different key as an independent operation', async () => {
      const res = await post(
        '/api/v1/inventory/adjust',
        adjustBody(10),
        `${RUN_ID}-http-adjust-2`,
      ).expect(201);
      expect(Number(res.body.onHand)).toBe(220);
      expect(await adjustmentCount()).toBe(2);
    });

    it('rejects an over-long key (400)', async () => {
      const res = await post(
        '/api/v1/inventory/adjust',
        adjustBody(1),
        'k'.repeat(101),
      ).expect(400);
      expect(res.body.message).toMatch(/too long/i);
      expect(await adjustmentCount()).toBe(2);
    });
  });

  describe('payout create over HTTP', () => {
    const key = `${RUN_ID}-http-payout-1`;
    const payoutCount = (settlementId: number) =>
      prisma.payout.count({ where: { settlementId } });
    const payoutSum = async (settlementId: number) => {
      const sum = await prisma.payout.aggregate({
        where: { settlementId },
        _sum: { amount: true },
      });
      return Number(sum._sum.amount ?? 0);
    };

    it('refuses a request without the Idempotency-Key header before writing', async () => {
      const res = await post(
        '/api/v1/payouts',
        { settlementId: confirmedSettlementId, amount: 30000 },
      ).expect(400);
      expect(res.body.message).toMatch(/Idempotency-Key header is required/i);
      expect(await payoutCount(confirmedSettlementId)).toBe(0);
    });

    it('replays the exact same payout for one key + payload', async () => {
      const body = { settlementId: confirmedSettlementId, amount: 30000, reference: 'HTTP-1' };
      const first = await post('/api/v1/payouts', body, key).expect(201);
      const retry = await post('/api/v1/payouts', body, key).expect(201);

      expect(retry.body).toEqual(first.body);
      expect(retry.body.id).toBe(first.body.id);
      expect(await payoutCount(confirmedSettlementId)).toBe(1);
      expect(await payoutSum(confirmedSettlementId)).toBe(30000);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'PAYOUT_CREATE',
            entityType: 'Payout',
            entityId: String(first.body.id),
          },
        }),
      ).toBe(1);
    });

    it('rejects the same key with a different amount (409)', async () => {
      const res = await post(
        '/api/v1/payouts',
        { settlementId: confirmedSettlementId, amount: 20000 },
        key,
      ).expect(409);
      expect(res.body.message).toMatch(/different request payload/i);
      expect(await payoutCount(confirmedSettlementId)).toBe(1);
      expect(await payoutSum(confirmedSettlementId)).toBe(30000);
    });

    it('is endpoint-scoped: the adjust key can also key a payout', async () => {
      // Same string as the adjust key used above, but a different endpoint
      // scope. Both operations must exist and both key rows must be present.
      const sharedKey = `${RUN_ID}-http-adjust-1`;
      const res = await post(
        '/api/v1/payouts',
        { settlementId: confirmedSettlementId, amount: 10000 },
        sharedKey,
      ).expect(201);
      expect(Number(res.body.amount)).toBe(10000);

      expect(await keyRow(IDEMPOTENCY_SCOPES.inventoryAdjust, sharedKey)).not.toBeNull();
      expect(await keyRow(IDEMPOTENCY_SCOPES.payoutCreate, sharedKey)).not.toBeNull();
      expect(await payoutCount(confirmedSettlementId)).toBe(2);
      expect(await payoutSum(confirmedSettlementId)).toBe(40000);
    });
  });

  describe('refund create over HTTP', () => {
    const key = `${RUN_ID}-http-refund-1`;
    const refundCount = () =>
      prisma.refund.count({ where: { paymentId: fixtures.paymentId } });
    const refundSum = async () => {
      const sum = await prisma.refund.aggregate({
        where: { paymentId: fixtures.paymentId },
        _sum: { amount: true },
      });
      return Number(sum._sum.amount ?? 0);
    };

    it('refuses a request without the Idempotency-Key header before writing', async () => {
      const res = await post(
        '/api/v1/refunds',
        { paymentId: fixtures.paymentId, amount: 25000, reason: 'HTTP' },
      ).expect(400);
      expect(res.body.message).toMatch(/Idempotency-Key header is required/i);
      expect(await refundCount()).toBe(0);
    });

    it('replays the exact same refund for one key + payload', async () => {
      const body = { paymentId: fixtures.paymentId, amount: 25000, reason: 'HTTP' };
      const first = await post('/api/v1/refunds', body, key).expect(201);
      const retry = await post('/api/v1/refunds', body, key).expect(201);

      expect(retry.body).toEqual(first.body);
      expect(await refundCount()).toBe(1);
      expect(await refundSum()).toBe(25000);
    });

    it('rejects the same key with a different amount (409)', async () => {
      const res = await post(
        '/api/v1/refunds',
        { paymentId: fixtures.paymentId, amount: 30000, reason: 'HTTP' },
        key,
      ).expect(409);
      expect(res.body.message).toMatch(/different request payload/i);
      expect(await refundCount()).toBe(1);
      expect(await refundSum()).toBe(25000);
    });

    it('still replays the first refund after the payment became REFUNDED', async () => {
      const second = await post(
        '/api/v1/refunds',
        { paymentId: fixtures.paymentId, amount: 75000, reason: 'HTTP rest' },
        `${RUN_ID}-http-refund-2`,
      ).expect(201);
      expect(Number(second.body.amount)).toBe(75000);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: fixtures.paymentId },
      });
      expect(payment.status).toBe('REFUNDED');
      expect(await refundCount()).toBe(2);
      expect(await refundSum()).toBe(100000);

      const replay = await post(
        '/api/v1/refunds',
        { paymentId: fixtures.paymentId, amount: 25000, reason: 'HTTP' },
        key,
      ).expect(201);
      expect(Number(replay.body.amount)).toBe(25000);
      expect(await refundCount()).toBe(2);
      expect(await refundSum()).toBe(100000);
    });
  });

  describe('ledger invariants over HTTP', () => {
    it('every committed key belongs to its endpoint scope and carries a response', async () => {
      const rows = await prisma.appIdempotencyKey.findMany({
        where: { actorUserId: fixtures.adminId },
      });
      expect(rows.length).toBeGreaterThan(0);
      const scopes = new Set(rows.map((r) => r.scope));
      expect(scopes).toEqual(
        new Set([
          IDEMPOTENCY_SCOPES.inventoryAdjust,
          IDEMPOTENCY_SCOPES.payoutCreate,
          IDEMPOTENCY_SCOPES.refundCreate,
        ]),
      );
      for (const row of rows) {
        expect(row.responseStatus, `key ${row.scope}/${row.key}`).toBe(201);
        expect(row.responseJson, `key ${row.scope}/${row.key}`).not.toBeNull();
      }
    });
  });
});
