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
 * Audit-trail read endpoint (P0 admin completion).
 *
 * The writer has always existed (every money/stock state change records a
 * row); this suite covers the missing read side: an ADMIN can find a row and
 * see who caused it, filters narrow correctly, and a CUSTOMER can never read
 * the trail.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2eaudit');

describe.skipIf(!hasTestDb)('Audit logs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  const ACTION = `E2E_AUDIT_${RUN_ID}`;
  const OTHER_ACTION = `E2E_AUDIT_OTHER_${RUN_ID}`;
  const ENTITY_TYPE = `E2eAudit${RUN_ID}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    await prisma.auditLog.createMany({
      data: [
        {
          actorUserId: fixtures.adminId,
          action: ACTION,
          entityType: ENTITY_TYPE,
          entityId: '1',
          afterJson: { status: 'COMPLETED' },
          reason: 'e2e audit read',
        },
        {
          actorUserId: null,
          action: OTHER_ACTION,
          entityType: ENTITY_TYPE,
          entityId: '2',
          afterJson: { status: 'FAILED' },
        },
      ],
    });

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
  });

  afterAll(async () => {
    if (prisma && fixtures) {
      await prisma.auditLog.deleteMany({ where: { entityType: ENTITY_TYPE } });
      await cleanupFixtures(prisma, fixtures);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('lets an ADMIN list audit rows with their actor', async () => {
    const res = await get(
      `/api/v1/audit-logs?entityType=${ENTITY_TYPE}&page=1&limit=20`,
      adminToken,
    ).expect(200);

    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(res.body.data).toHaveLength(2);
    const withActor = res.body.data.find(
      (row: { action: string }) => row.action === ACTION,
    );
    expect(withActor).toMatchObject({
      actorUserId: fixtures.adminId,
      entityType: ENTITY_TYPE,
      entityId: '1',
      reason: 'e2e audit read',
      afterJson: { status: 'COMPLETED' },
    });
    expect(withActor.actorUser).toMatchObject({ id: fixtures.adminId });
    expect(typeof withActor.actorUser.fullName).toBe('string');
    // Newest first: both rows are created in one call, id desc breaks the tie.
    expect(res.body.data[0].id).toBeGreaterThan(res.body.data[1].id);
  });

  it('filters by action and free-text search', async () => {
    const byAction = await get(
      `/api/v1/audit-logs?action=${ACTION}&entityType=${ENTITY_TYPE}`,
      adminToken,
    ).expect(200);
    expect(byAction.body.meta.total).toBe(1);
    expect(byAction.body.data[0].action).toBe(ACTION);

    const bySearch = await get(
      `/api/v1/audit-logs?search=${encodeURIComponent(RUN_ID)}&entityType=${ENTITY_TYPE}`,
      adminToken,
    ).expect(200);
    expect(bySearch.body.meta.total).toBe(2);
  });

  it('supports a date range and never mutates the trail', async () => {
    const future = await get(
      `/api/v1/audit-logs?entityType=${ENTITY_TYPE}&from=2099-01-01T00:00:00.000Z`,
      adminToken,
    ).expect(200);
    expect(future.body.meta.total).toBe(0);

    const count = await prisma.auditLog.count({ where: { entityType: ENTITY_TYPE } });
    expect(count).toBe(2);
  });

  it('rejects a CUSTOMER (403) and an anonymous request (401)', async () => {
    await get(`/api/v1/audit-logs?entityType=${ENTITY_TYPE}`, customerToken).expect(403);
    await get(`/api/v1/audit-logs?entityType=${ENTITY_TYPE}`).expect(401);
  });

  it('rejects an invalid date filter with 400', async () => {
    await get('/api/v1/audit-logs?from=not-a-date', adminToken).expect(400);
  });
});
