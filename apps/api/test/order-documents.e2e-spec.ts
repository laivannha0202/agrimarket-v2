import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login } from './helpers/test-app.js';
import { extractPdfText } from './helpers/pdf-text.js';
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
 * Order document acceptance (e2e, MySQL TEST).
 *
 * The PDF endpoints stream bytes, so they are asserted as bytes: a real
 * `%PDF-` header, the right content type, and Vietnamese text that decodes
 * back to the order it belongs to. Authorization is part of the document's
 * contract:
 *
 * - a customer may download their OWN order confirmation (200);
 * - another customer's order is a 404, not a 403 — the id must not be
 *   confirmable by probing;
 * - the packing slip is internal (admin only), so a customer gets 403;
 * - no token at all is 401.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeRunId('e2edoc');

interface BinaryResponse {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
}

async function getBytes(
  app: INestApplication,
  path: string,
  token?: string,
): Promise<BinaryResponse> {
  let req = request(app.getHttpServer()).get(path);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  const res = await req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k] = String(v);
  return { status: res.status, headers, bytes: res.body as Buffer };
}

/** Kerning splits runs, so whitespace inside extracted text is not meaningful. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

describe.skipIf(!hasTestDb)('Order documents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;
  let otherCustomerToken: string;
  let otherCustomerId: number | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);

    // A second, unrelated customer with the same password hash: proves that
    // ownership is checked against the row, not merely against the role.
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: fixtures.customerId } });
    const other = await prisma.user.create({
      data: {
        email: `${RUN_ID}-other@agrimarket.vn`,
        passwordHash: owner.passwordHash,
        fullName: `E2E Khách khác ${RUN_ID}`,
        phone: '0922222222',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });
    otherCustomerId = other.id;
    otherCustomerToken = await login(app, other.email, E2E_CUSTOMER_PASSWORD);
  });

  afterAll(async () => {
    if (prisma && fixtures) {
      if (otherCustomerId) {
        await prisma.user.delete({ where: { id: otherCustomerId } }).catch(() => undefined);
      }
      await cleanupFixtures(prisma, fixtures);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  it('serves the order confirmation PDF to its owner', async () => {
    const res = await getBytes(app, `/api/v1/orders/${fixtures.orderId}/pdf`, customerToken);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`order-${fixtures.orderId}.pdf`);
    expect(res.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const text = squash(extractPdfText(res.bytes));
    expect(text).toContain('PHIẾUXÁCNHẬNĐƠNHÀNG');
    expect(text).toContain(`${RUN_ID}-ORD`);
  });

  it('hides another customer\'s order behind the same 404 as a missing one', async () => {
    const res = await getBytes(app, `/api/v1/orders/${fixtures.orderId}/pdf`, otherCustomerToken);

    expect(res.status).toBe(404);
    expect(res.bytes.subarray(0, 5).toString('latin1')).not.toBe('%PDF-');
  });

  it('refuses the packing slip to a customer', async () => {
    const res = await getBytes(
      app,
      `/api/v1/orders/${fixtures.orderId}/packing-slip`,
      customerToken,
    );

    expect(res.status).toBe(403);
  });

  it('serves both documents to an admin', async () => {
    const pdf = await getBytes(app, `/api/v1/orders/${fixtures.orderId}/pdf`, adminToken);
    const slip = await getBytes(
      app,
      `/api/v1/orders/${fixtures.orderId}/packing-slip`,
      adminToken,
    );

    expect(pdf.status).toBe(200);
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(slip.status).toBe(200);
    expect(slip.headers['content-type']).toContain('application/pdf');
    expect(slip.headers['content-disposition']).toContain(`packing-${fixtures.orderId}.pdf`);

    const text = squash(extractPdfText(slip.bytes));
    expect(text).toContain('PHIẾUSOẠNHÀNG');
    expect(text).toContain(`${RUN_ID}-LOT-A`);
  });

  it('requires a token', async () => {
    const pdf = await getBytes(app, `/api/v1/orders/${fixtures.orderId}/pdf`);
    const slip = await getBytes(app, `/api/v1/orders/${fixtures.orderId}/packing-slip`);

    expect(pdf.status).toBe(401);
    expect(slip.status).toBe(401);
  });
});
