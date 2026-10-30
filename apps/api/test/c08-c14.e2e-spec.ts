import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * C-08 / C-14 acceptance against the real HTTP app and an isolated TEST_DATABASE_URL.
 *
 *   C-08 — a late refund resolved as DEDUCT_NEXT opens a recovery that blocks
 *          confirmation and payouts until a SECOND human approves it and a
 *          third step records the actual recovery. No money moves automatically
 *          and the historical settlement is never rewritten.
 *   C-14 — seasons/farming logs/harvests validate real input, terminal seasons
 *          are closed to new writes, and the Admin trace audit reports missing
 *          links without fabricating events.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2ec8');

describe.skipIf(!hasTestDb)('C-08 recovery approval + C-14 traceability (e2e)', () => {
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

  // ------------------------------------------------------------------- C-08

  describe('C-08 — post-settlement recovery requires a second approval', () => {
    let adjustmentId: number;
    let recoveryId: number;

    it('creates the test reconciliation row (OPEN adjustment)', async () => {
      const adjustment = await prisma.settlementAdjustment.create({
        data: {
          partnerId: fixtures.partnerAId,
          settlementId: fixtures.settlementId,
          amount: 25_000,
          type: 'REFUND_AFTER_SETTLEMENT',
          reason: `Hoàn tiền sau đối soát ${RUN_ID}`,
        },
      });
      adjustmentId = adjustment.id;
      expect(adjustment.status).toBe('OPEN');
    });

    it('blocks settlement confirmation while an adjustment is OPEN', async () => {
      const res = await post(
        `/api/v1/settlements/${fixtures.settlementId}/confirm`,
        adminToken,
        {},
      ).expect(409);
      expect(res.body.message).toMatch(/OPEN reconciliation/);
    });

    it('DEDUCT_NEXT records a PENDING_APPROVAL recovery but moves no money', async () => {
      const res = await post(
        `/api/v1/settlement-adjustments/${adjustmentId}/review`,
        adminToken,
        { resolution: 'DEDUCT_NEXT', note: 'Trừ vào kỳ đối soát kế tiếp' },
      ).expect(201);

      expect(res.body.status).toBe('REVIEWED');
      expect(res.body.resolution).toBe('DEDUCT_NEXT');

      const recovery = await prisma.settlementRecovery.findUniqueOrThrow({
        where: { adjustmentId },
      });
      recoveryId = recovery.id;
      expect(recovery.status).toBe('PENDING_APPROVAL');
      expect(Number(recovery.amount)).toBe(25_000);
      expect(recovery.approvedAt).toBeNull();
      expect(recovery.recordedAt).toBeNull();

      // The historical settlement is not rewritten by the decision.
      const settlement = await prisma.settlement.findUniqueOrThrow({
        where: { id: fixtures.settlementId },
      });
      expect(Number(settlement.payableAmount)).toBe(95_000);
      expect(settlement.status).toBe('DRAFT');

      const list = await get(
        `/api/v1/settlement-recoveries?partnerId=${fixtures.partnerAId}&status=PENDING_APPROVAL`,
        adminToken,
      ).expect(200);
      expect(list.body.data.some((row: { id: number }) => row.id === recoveryId)).toBe(true);
    });

    it('keeps confirmation and payouts blocked while approval is pending', async () => {
      await post(`/api/v1/settlements/${fixtures.settlementId}/confirm`, adminToken, {}).expect(
        409,
      );
      const paid = await post(`/api/v1/payouts/${fixtures.payoutId}/pay`, adminToken, {}).expect(
        400,
      );
      expect(paid.body.message).toMatch(/unresolved recovery/);
      const freshPayout = await prisma.payout.findUniqueOrThrow({
        where: { id: fixtures.payoutId },
      });
      expect(freshPayout.status).toBe('PENDING');
    });

    it('approval alone still blocks payouts until the recovery is recorded', async () => {
      const res = await post(
        `/api/v1/settlement-recoveries/${recoveryId}/approve`,
        adminToken,
        { note: 'Kế toán trưởng phê duyệt trừ kỳ sau' },
      ).expect(201);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approvedAt).toBeTruthy();

      await post(`/api/v1/payouts/${fixtures.payoutId}/pay`, adminToken, {}).expect(400);
      await post(`/api/v1/settlements/${fixtures.settlementId}/confirm`, adminToken, {}).expect(
        409,
      );
    });

    it('recording the recovery closes the block, then confirmation and payout succeed', async () => {
      const recorded = await post(
        `/api/v1/settlement-recoveries/${recoveryId}/record`,
        adminToken,
        { reference: `FT-${RUN_ID}-01`, note: 'Đã bù trừ vào kỳ đối soát tháng 11' },
      ).expect(201);
      expect(recorded.body.status).toBe('RECORDED');
      expect(recorded.body.recoveryReference).toBe(`FT-${RUN_ID}-01`);

      const confirmed = await post(
        `/api/v1/settlements/${fixtures.settlementId}/confirm`,
        adminToken,
        {},
      ).expect(201);
      expect(confirmed.body.status).toBe('CONFIRMED');

      const paid = await post(`/api/v1/payouts/${fixtures.payoutId}/pay`, adminToken, {}).expect(
        201,
      );
      expect(paid.body.status).toBe('PAID');

      const settlement = await prisma.settlement.findUniqueOrThrow({
        where: { id: fixtures.settlementId },
      });
      // The original payable was never rewritten by the recovery workflow.
      expect(Number(settlement.grossAmount)).toBe(100_000);
      expect(Number(settlement.payableAmount)).toBe(95_000);

      const actions = await prisma.auditLog.findMany({
        where: {
          entityType: 'SettlementRecovery',
          entityId: String(recoveryId),
        },
        select: { action: true },
        orderBy: { id: 'asc' },
      });
      expect(actions.map((row) => row.action)).toEqual([
        'SETTLEMENT_RECOVERY_REQUEST',
        'SETTLEMENT_RECOVERY_APPROVE',
        'SETTLEMENT_RECOVERY_RECORD',
      ]);
    });

    it('rejects a recovery instead when the decision is not accepted', async () => {
      const adjustment = await prisma.settlementAdjustment.create({
        data: {
          partnerId: fixtures.partnerAId,
          settlementId: fixtures.settlementId,
          amount: 10_000,
          type: 'REFUND_AFTER_SETTLEMENT',
          reason: `Hoàn tiền cần từ chối ${RUN_ID}`,
        },
      });
      await post(
        `/api/v1/settlement-adjustments/${adjustment.id}/review`,
        adminToken,
        { resolution: 'DEDUCT_NEXT', note: 'Đề xuất trừ kỳ sau' },
      ).expect(201);
      const recovery = await prisma.settlementRecovery.findUniqueOrThrow({
        where: { adjustmentId: adjustment.id },
      });

      const rejected = await post(
        `/api/v1/settlement-recoveries/${recovery.id}/reject`,
        adminToken,
        { note: 'Đối tác đã hoàn tiền trực tiếp, không trừ kỳ sau' },
      ).expect(201);
      expect(rejected.body.status).toBe('REJECTED');

      const unresolved = await prisma.settlementRecovery.count({
        where: {
          partnerId: fixtures.partnerAId,
          status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
        },
      });
      expect(unresolved).toBe(0);

      // A closed recovery cannot be approved afterwards.
      await post(`/api/v1/settlement-recoveries/${recovery.id}/approve`, adminToken, {
        note: 'Duyệt lại',
      }).expect(409);
    });
  });

  // ------------------------------------------------------------------- C-14

  describe('C-14 — season/farming/harvest authoring and trace audit', () => {
    let createdSeasonId: number;
    let farmingEventId: number;
    let createdHarvestId: number;

    it('rejects a season for an inactive farm and an impossible date range', async () => {
      await post('/api/v1/seasons', adminToken, {
        farmId: fixtures.farmBId,
        cropName: `Vụ trên trại khóa ${RUN_ID}`,
      }).expect(400);

      const badRange = await post('/api/v1/seasons', adminToken, {
        farmId: fixtures.farmAId,
        cropName: `Vụ sai ngày ${RUN_ID}`,
        plantingDate: '2026-05-01',
        expectedHarvestDate: '2026-04-01',
      }).expect(400);
      expect(badRange.body.message).toMatch(/expectedHarvestDate/);

      await post('/api/v1/seasons', adminToken, {
        farmId: 999_999,
        cropName: `Vụ không có trại ${RUN_ID}`,
      }).expect(400);
    });

    it('creates a season from real input and rejects empty text edits', async () => {
      const res = await post('/api/v1/seasons', adminToken, {
        farmId: fixtures.farmAId,
        cropName: `Vụ kiểm thử C-14 ${RUN_ID}`,
        variety: 'F1',
        plantingDate: '2026-01-01',
        expectedHarvestDate: '2026-04-01',
        expectedYield: 5.5,
        yieldUnit: 'tấn',
      }).expect(201);
      createdSeasonId = res.body.id;
      expect(res.body.status).toBe('PLANNED');

      await patch(`/api/v1/seasons/${createdSeasonId}`, adminToken, { cropName: '   ' }).expect(
        400,
      );
      await patch(`/api/v1/seasons/${createdSeasonId}`, adminToken, {
        plantingDate: '2026-06-01',
        expectedHarvestDate: '2026-05-01',
      }).expect(400);
    });

    it('closes a completed season and refuses later edits, harvests and logs', async () => {
      const completed = await patch(`/api/v1/seasons/${createdSeasonId}`, adminToken, {
        status: 'COMPLETED',
      }).expect(200);
      expect(completed.body.status).toBe('COMPLETED');

      await patch(`/api/v1/seasons/${createdSeasonId}`, adminToken, { cropName: 'Đổi tên' }).expect(
        400,
      );
      await post('/api/v1/farming-events', adminToken, {
        seasonId: createdSeasonId,
        type: 'CARE',
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        content: 'Ghi sau khi kết thúc vụ',
      }).expect(400);
      await post('/api/v1/harvests', adminToken, {
        seasonId: createdSeasonId,
        harvestDate: new Date().toISOString(),
        quantity: 10,
        unit: 'kg',
        grade: 'Loại 1',
      }).expect(400);
    });

    it('validates farming-log content, future timestamps and updates the audit trail', async () => {
      await post('/api/v1/farming-events', adminToken, {
        seasonId: fixtures.seasonAId,
        type: 'CARE',
        occurredAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        content: 'Việc chưa xảy ra',
      }).expect(400);

      const created = await post('/api/v1/farming-events', adminToken, {
        seasonId: fixtures.seasonAId,
        type: 'WATERING',
        occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        content: `Tưới nhỏ giọt 30 phút ${RUN_ID}`,
        isPublic: true,
      }).expect(201);
      farmingEventId = created.body.id;

      const publicList = await get(
        `/api/v1/farming-events/season/${fixtures.seasonAId}`,
      ).expect(200);
      expect(
        publicList.body.some((event: { id: number }) => event.id === farmingEventId),
      ).toBe(true);

      await patch(`/api/v1/farming-events/${farmingEventId}`, adminToken, {
        content: '   ',
      }).expect(400);
      await patch(`/api/v1/farming-events/${farmingEventId}`, adminToken, {
        occurredAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).expect(400);

      const updated = await patch(
        `/api/v1/farming-events/${farmingEventId}`,
        adminToken,
        { content: `Tưới nhỏ giọt 45 phút ${RUN_ID}`, isPublic: false },
      ).expect(200);
      expect(updated.body.content).toContain('45 phút');
      expect(updated.body.isPublic).toBe(false);

      const auditRows = await prisma.auditLog.findMany({
        where: { entityType: 'FarmingEvent', entityId: String(farmingEventId) },
        select: { action: true },
        orderBy: { id: 'asc' },
      });
      expect(auditRows.map((row) => row.action)).toEqual([
        'FARMING_EVENT_CREATE',
        'FARMING_EVENT_UPDATE',
      ]);
    });

    it('validates harvest dates, quantities and the allocated-lot ceiling', async () => {
      await patch(`/api/v1/seasons/${fixtures.seasonAId}`, adminToken, {
        plantingDate: '2026-01-01',
      }).expect(200);

      await post('/api/v1/harvests', adminToken, {
        seasonId: fixtures.seasonAId,
        harvestDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        quantity: 10,
        unit: 'kg',
        grade: 'Loại 1',
      }).expect(400);

      await post('/api/v1/harvests', adminToken, {
        seasonId: fixtures.seasonAId,
        harvestDate: '2025-12-31',
        quantity: 10,
        unit: 'kg',
        grade: 'Loại 1',
      }).expect(400);

      const created = await post('/api/v1/harvests', adminToken, {
        seasonId: fixtures.seasonAId,
        harvestDate: '2026-10-01',
        quantity: 100,
        unit: 'kg',
        grade: 'Loại 1',
        note: `Thu hoạch kiểm thử ${RUN_ID}`,
      }).expect(201);
      createdHarvestId = created.body.id;

      const season = await get(`/api/v1/seasons/${fixtures.seasonAId}`).expect(200);
      expect(
        season.body.harvests.some((row: { id: number }) => row.id === createdHarvestId),
      ).toBe(true);

      // Fixture harvest A already allocated 500kg to lot A.
      const belowAllocated = await patch(
        `/api/v1/harvests/${fixtures.harvestAId}`,
        adminToken,
        { quantity: 100 },
      ).expect(400);
      expect(belowAllocated.body.message).toMatch(/allocated/);

      const raised = await patch(`/api/v1/harvests/${fixtures.harvestAId}`, adminToken, {
        quantity: 1200,
      }).expect(200);
      expect(Number(raised.body.quantity)).toBe(1200);

      await patch(`/api/v1/harvests/${fixtures.harvestAId}`, adminToken, { unit: '   ' }).expect(
        400,
      );

      // Harvest B belongs to a COMPLETED season.
      await patch(`/api/v1/harvests/${fixtures.harvestBId}`, adminToken, {
        quantity: 2100,
      }).expect(400);
    });

    it('reports trace-chain gaps without inventing events', async () => {
      const before = await prisma.traceEvent.count({
        where: { productLotId: fixtures.lotAId },
      });

      const audit = await get(
        `/api/v1/trace/admin/lot/${fixtures.lotAId}`,
        adminToken,
      ).expect(200);

      expect(audit.body.lot.id).toBe(fixtures.lotAId);
      expect(audit.body.product.id).toBe(fixtures.productAId);
      expect(audit.body.farm.id).toBe(fixtures.farmAId);
      expect(audit.body.complete).toBe(false);
      expect(audit.body.missing).toBeGreaterThan(0);

      const byKey = new Map<string, { status: string; detail: string }>(
        audit.body.checks.map((check: { key: string; status: string; detail: string }) => [
          check.key,
          check,
        ]),
      );
      expect(byKey.get('trace-harvest')?.status).toBe('MISSING');
      expect(byKey.get('qc')?.status).toBe('OK');
      expect(byKey.get('farming-public')?.status).toBe('WARNING');
      expect(byKey.get('qc-sellable')?.status).toBe('OK');

      // The audit is read-only: no trace event was fabricated to make it pass.
      expect(
        await prisma.traceEvent.count({ where: { productLotId: fixtures.lotAId } }),
      ).toBe(before);

      await get(`/api/v1/trace/admin/lot/${fixtures.lotAId}`, customerToken).expect(403);
      await get('/api/v1/trace/admin/lot/999999', adminToken).expect(404);
    });
  });
});
