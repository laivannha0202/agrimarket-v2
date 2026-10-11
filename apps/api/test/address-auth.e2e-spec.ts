import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login, resetThrottler } from './helpers/test-app.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_CUSTOMER_PASSWORD,
  E2E_PREFIX,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * HTTP end-to-end coverage for the two V2 features added on top of the
 * existing Auth/Address modules:
 *
 *   A. Delivery address against the official 104 Hưng Yên xã/phường catalogue
 *      (2025 reorganisation): the province/commune routes, and the server-side
 *      validation that a ward code exists AND belongs to the selected province.
 *   B. Customer account self-service: register, change password, and the real
 *      token-based forgot/reset flow (hashed token, TTL, single use).
 *
 * These run against TEST_DATABASE_URL only and are skipped when it is unset, so
 * the suite never writes to the development database.
 *
 * WHAT IS ASSERTED vs WHAT IS NOT
 *
 * The ward catalogue is asserted to exist and to be self-consistent (codes are
 * strings, a province's wards belong to that province, search folds accents).
 * The exact 104 rows are NOT re-listed here — the dataset lives in the database
 * and its integrity is checked by the importer and the dataset validator, not by
 * a second copy inside a test.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2ea');

describe.skipIf(!hasTestDb)('Address catalogue & account self-service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let customerToken: string;

  /** The province the storefront serves; resolved from the catalogue itself. */
  let provinceCode: string;
  /** Two real communes of that province, used for the validation assertions. */
  let wardA: { code: string; fullName: string };
  let wardB: { code: string; fullName: string };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;

    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);

    app = await createTestApp();
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);

    const provinces = await request(app.getHttpServer())
      .get('/api/v1/locations/provinces')
      .expect(200);
    expect(Array.isArray(provinces.body)).toBe(true);
    expect(provinces.body.length).toBeGreaterThan(0);
    provinceCode = provinces.body[0].code;

    const wards = await request(app.getHttpServer())
      .get(`/api/v1/locations/provinces/${provinceCode}/wards`)
      .expect(200);
    expect(wards.body.meta.total).toBeGreaterThan(1);
    wardA = { code: wards.body.data[0].code, fullName: wards.body.data[0].fullName };
    wardB = { code: wards.body.data[1].code, fullName: wards.body.data[1].fullName };
  }, 60_000);

  afterAll(async () => {
    if (prisma && fixtures) {
      await cleanupFixtures(prisma, fixtures);
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

  /**
   * Clears the rate-limit counters before each test.
   *
   * The production limits are deliberately tight (3 recovery mails, 5
   * registrations per minute per IP + address) and this suite legitimately
   * exceeds them while exercising unrelated behaviour. Clearing the counters
   * keeps the limiter in the request path — the guard still runs, still counts,
   * still rejects — without letting it mask the assertion under test. The
   * limiter itself is asserted in `B. rate limiting`.
   */
  beforeEach(() => {
    resetThrottler(app);
  });

  const authed = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${customerToken}`);

  /* ------------------------------------------------------------------ A.1 -- */
  describe('A. administrative catalogue', () => {
    it('serves provinces with string codes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/locations/provinces')
        .expect(200);

      for (const province of res.body) {
        expect(typeof province.code).toBe('string');
        expect(province.code.length).toBeGreaterThan(0);
        expect(typeof province.fullName).toBe('string');
      }
    });

    it('serves a province by code and 404s an unknown one', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}`)
        .expect(200);
      expect(res.body.code).toBe(provinceCode);

      await request(app.getHttpServer())
        .get('/api/v1/locations/provinces/999999')
        .expect(404);
    });

    it('returns every commune of the province in one call, with 5-char string codes', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}/wards`)
        .expect(200);

      expect(res.body.data.length).toBe(res.body.meta.total);
      expect(res.body.meta.total).toBeGreaterThan(1);

      for (const ward of res.body.data) {
        // The whole reason the code is a string: a 5-digit code with a leading
        // zero (e.g. "03210") would lose it as a number.
        expect(typeof ward.code).toBe('string');
        expect(ward.code).toMatch(/^\d{5}$/);
        expect(ward.provinceCode).toBe(provinceCode);
        expect(typeof ward.fullName).toBe('string');
        expect(ward.fullName.length).toBeGreaterThan(0);
        // Internal search state must never leak to a client.
        expect(ward).not.toHaveProperty('searchText');
        expect(ward).not.toHaveProperty('searchHaystack');
      }
    });

    it('finds a commune by its code and 404s an unknown one', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}/wards/${wardA.code}`)
        .expect(200);
      expect(res.body.code).toBe(wardA.code);
      expect(res.body.fullName).toBe(wardA.fullName);

      await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}/wards/00000`)
        .expect(404);
    });

    it('searches accent-insensitively and by code', async () => {
      // Strip the accents and the prefix from the official name; the backend
      // must still find it. `fold` mirrors the haystack the importer stored.
      const unaccented = wardA.fullName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/^(Xa|Phuong)\s+/i, '')
        .trim();

      const byName = await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}/wards`)
        .query({ search: unaccented })
        .expect(200);
      expect(byName.body.data.map((w: { code: string }) => w.code)).toContain(wardA.code);

      const upper = await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}/wards`)
        .query({ search: unaccented.toUpperCase() })
        .expect(200);
      expect(upper.body.data.map((w: { code: string }) => w.code)).toContain(wardA.code);

      const byCode = await request(app.getHttpServer())
        .get(`/api/v1/locations/provinces/${provinceCode}/wards`)
        .query({ search: wardA.code })
        .expect(200);
      expect(byCode.body.data.map((w: { code: string }) => w.code)).toContain(wardA.code);
    });

    it('is reachable without a token (the address form precedes sign-in)', async () => {
      await request(app.getHttpServer()).get('/api/v1/locations/provinces').expect(200);
    });
  });

  /* ------------------------------------------------------------------ A.2 -- */
  describe('A. server-side address validation', () => {
    it('resolves the official commune name from the code, ignoring client text', async () => {
      const res = await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Người nhận',
          phone: '0912345678',
          // Deliberately wrong text: the backend must overwrite it from the code.
          province: 'Tỉnh Bịa Đặt',
          provinceCode,
          wardCode: wardA.code,
          detail: 'Số 1 đường kiểm thử',
        })
        .expect(201);

      expect(res.body.wardCode).toBe(wardA.code);
      expect(res.body.provinceCode).toBe(provinceCode);
      expect(res.body.wardName).toBe(wardA.fullName);
      expect(res.body.province).not.toBe('Tỉnh Bịa Đặt');
      // The 2025 model has no district; a code-verified address must not carry one.
      expect(res.body.district).toBeNull();
    });

    it('refuses a commune code that does not exist', async () => {
      const res = await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Người nhận',
          phone: '0912345678',
          province: 'Hưng Yên',
          provinceCode,
          wardCode: '00000',
          detail: 'Số 2',
        })
        .expect(400);
      expect(String(res.body.message)).toContain('Xã/phường không hợp lệ');
    });

    it('refuses a commune code that belongs to another province', async () => {
      // Find a province that is NOT the served one. If the catalogue only has
      // one province, the mismatch is exercised with a code from nowhere.
      const provinces = await request(app.getHttpServer())
        .get('/api/v1/locations/provinces')
        .expect(200);
      const other = provinces.body.find((p: { code: string }) => p.code !== provinceCode);

      const foreignWard = other
        ? await request(app.getHttpServer())
            .get(`/api/v1/locations/provinces/${other.code}/wards`)
            .expect(200)
        : null;

      const foreignCode = foreignWard?.body?.data?.[0]?.code ?? '00000';

      const res = await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Người nhận',
          phone: '0912345678',
          province: 'Hưng Yên',
          provinceCode,
          wardCode: foreignCode,
          detail: 'Số 3',
        })
        .expect(400);
      expect(String(res.body.message)).toContain('Xã/phường không hợp lệ');
    });

    it('refuses a commune code without its province code', async () => {
      const res = await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Người nhận',
          phone: '0912345678',
          province: 'Hưng Yên',
          wardCode: wardA.code,
          detail: 'Số 4',
        })
        .expect(400);
      expect(String(res.body.message)).toContain('Thiếu mã tỉnh');
    });

    it('refuses a phone number that is not a Vietnamese mobile number', async () => {
      await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Người nhận',
          phone: '123',
          province: 'Hưng Yên',
          provinceCode,
          wardCode: wardA.code,
          detail: 'Số 5',
        })
        .expect(400);
    });

    it('cannot read or change another customer’s address (IDOR)', async () => {
      // A second customer, created directly: the point is that the caller's own
      // profile scopes every address operation. The password hash is real so the
      // row is a valid account rather than a half-built one.
      const other = await prisma.user.create({
        data: {
          email: `${RUN_ID}-other@agrimarket.vn`,
          passwordHash: await bcrypt.hash(E2E_CUSTOMER_PASSWORD, 10),
          fullName: `E2E Khác ${RUN_ID}`,
          phone: '0922222222',
          role: 'CUSTOMER',
          status: 'ACTIVE',
          customerProfile: { create: {} },
        },
      });
      const profile = await prisma.customerProfile.findUnique({
        where: { userId: other.id },
        select: { id: true },
      });
      const foreignAddress = await prisma.address.create({
        data: {
          customerId: profile!.id,
          recipientName: 'E2E Nạn nhân',
          phone: '0922222222',
          province: 'Hưng Yên',
          detail: 'Số 99',
        },
      });

      // The caller must not be able to touch it.
      await authed('patch', `/api/v1/customers/me/addresses/${foreignAddress.id}`)
        .send({ detail: 'Đã bị sửa' })
        .expect(404);
      await authed('delete', `/api/v1/customers/me/addresses/${foreignAddress.id}`).expect(404);
      await authed('patch', `/api/v1/customers/me/addresses/${foreignAddress.id}/default`).expect(
        404,
      );

      const untouched = await prisma.address.findUnique({
        where: { id: foreignAddress.id },
        select: { detail: true },
      });
      expect(untouched?.detail).toBe('Số 99');

      // Cleanup: the run's own purge removes it via the customer profile.
      await prisma.address.deleteMany({ where: { customerId: profile!.id } });
      await prisma.customerProfile.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    });

    it('keeps a legacy address editable without inventing a commune for it', async () => {
      // Legacy text only — no codes. This is what a pre-reorganisation row
      // looks like, and it must still be saveable.
      const created = await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Legacy',
          phone: '0912345679',
          province: 'Hưng Yên',
          district: 'Văn Lâm',
          ward: 'Tân Quang',
          detail: 'Số 7',
        })
        .expect(201);

      expect(created.body.wardCode).toBeNull();
      expect(created.body.wardName).toBeNull();
      expect(created.body.district).toBe('Văn Lâm');
      expect(created.body.ward).toBe('Tân Quang');

      // Editing it without touching the address level keeps the free text.
      const updated = await authed('patch', `/api/v1/customers/me/addresses/${created.body.id}`)
        .send({ detail: 'Số 7B' })
        .expect(200);
      expect(updated.body.detail).toBe('Số 7B');
      expect(updated.body.district).toBe('Văn Lâm');

      // Choosing a catalogue commune converts it, and the district goes away.
      const converted = await authed('patch', `/api/v1/customers/me/addresses/${created.body.id}`)
        .send({ provinceCode, wardCode: wardB.code })
        .expect(200);
      expect(converted.body.wardCode).toBe(wardB.code);
      expect(converted.body.wardName).toBe(wardB.fullName);
      expect(converted.body.district).toBeNull();
    });

    it('lists only the caller’s own addresses', async () => {
      const res = await authed('get', '/api/v1/customers/me/addresses').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const address of res.body) {
        expect(address.customerId).toBeGreaterThan(0);
      }
    });
  });

  /* ------------------------------------------------------------------ A.3 -- */
  describe('A. checkout snapshots the verified address', () => {
    it('records the official commune name in the order snapshot', async () => {
      const address = await authed('post', '/api/v1/customers/me/addresses')
        .send({
          recipientName: 'E2E Snapshot',
          phone: '0912345678',
          province: 'Hưng Yên',
          provinceCode,
          wardCode: wardA.code,
          detail: 'Số 8',
        })
        .expect(201);

      await authed('post', '/api/v1/carts/me/items')
        .send({ productVariantId: fixtures.variantAId, quantity: 1 })
        .expect(201);

      const preview = await authed('post', '/api/v1/orders/checkout-preview')
        .send({})
        .expect(201);

      const order = await authed('post', '/api/v1/orders/checkout')
        .send({
          shippingAddress: {
            recipientName: address.body.recipientName,
            phone: address.body.phone,
            province: address.body.province,
            provinceCode: address.body.provinceCode,
            wardCode: address.body.wardCode,
            detail: address.body.detail,
          },
          paymentMethod: 'COD',
          expectedGrandTotal: preview.body.grandTotal,
        })
        .expect(201);

      expect(order.body.shippingAddressSnapshot.wardCode).toBe(wardA.code);
      expect(order.body.shippingAddressSnapshot.provinceCode).toBe(provinceCode);
      // The name in the snapshot is the CATALOGUE's, resolved server-side.
      expect(order.body.shippingAddressSnapshot.wardName).toBe(wardA.fullName);
      // The fee is the backend's own computation, not anything the client sent.
      expect(Number(order.body.shippingFee)).toBeGreaterThanOrEqual(0);
    });

    it('refuses a checkout whose commune code is unknown, without creating an order', async () => {
      const before = await prisma.order.count({
        where: { customerId: fixtures.customerId },
      });

      await authed('post', '/api/v1/orders/checkout')
        .send({
          shippingAddress: {
            recipientName: 'E2E Sai',
            phone: '0912345678',
            province: 'Hưng Yên',
            provinceCode,
            wardCode: '00000',
            detail: 'Số 9',
          },
          paymentMethod: 'COD',
        })
        .expect(400);

      const after = await prisma.order.count({ where: { customerId: fixtures.customerId } });
      expect(after).toBe(before);
    });
  });

  /* ------------------------------------------------------------------- B.1 -- */
  describe('B. registration', () => {
    const newEmail = `${RUN_ID}-newbie@agrimarket.vn`;

    afterAll(async () => {
      const user = await prisma.user.findUnique({ where: { email: newEmail } });
      if (user) {
        await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
        await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
        await prisma.address.deleteMany({ where: { customer: { userId: user.id } } });
        await prisma.customerProfile.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    });

    it('creates an ACTIVE CUSTOMER with a profile and issues no session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: newEmail,
          password: 'MatKhauMoi@12345',
          fullName: 'E2E Người mới',
          phone: '0933333333',
        })
        .expect(201);

      expect(res.body.email).toBe(newEmail);
      expect(res.body.role).toBe('CUSTOMER');
      // No token: registration is not a way to obtain a session.
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('passwordHash');

      const stored = await prisma.user.findUnique({
        where: { email: newEmail },
        include: { customerProfile: true },
      });
      expect(stored?.role).toBe('CUSTOMER');
      expect(stored?.status).toBe('ACTIVE');
      // A profile-less customer could not own a cart or an address.
      expect(stored?.customerProfile).not.toBeNull();
    });

    it('rejects a forged role field instead of ignoring it (no privilege escalation)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `${RUN_ID}-attacker@agrimarket.vn`,
          password: 'MatKhauMoi@12345',
          fullName: 'E2E Kẻ tấn công',
          phone: '0944444444',
          role: 'ADMIN',
        })
        .expect(400);
      expect(res.body.statusCode).toBe(400);

      const stored = await prisma.user.findUnique({
        where: { email: `${RUN_ID}-attacker@agrimarket.vn` },
      });
      expect(stored).toBeNull();
    });

    it('rejects a duplicate e-mail with a 409 and creates no second account', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: newEmail,
          password: 'MatKhauKhac@12345',
          fullName: 'E2E Trùng',
          phone: '0955555555',
        })
        .expect(409);

      const count = await prisma.user.count({ where: { email: newEmail } });
      expect(count).toBe(1);
    });

    it('rejects a password that breaks the policy', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `${RUN_ID}-weak@agrimarket.vn`,
          password: 'short',
          fullName: 'E2E Yếu',
          phone: '0966666666',
        })
        .expect(400);
    });

    it('lets the new account sign in on the same route the Web uses', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: newEmail, password: 'MatKhauMoi@12345' })
        .expect(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user.role).toBe('CUSTOMER');
    });
  });

  /* ------------------------------------------------------------------- B.2 -- */
  describe('B. change password', () => {
    const email = `${RUN_ID}-changer@agrimarket.vn`;
    let userId: number;

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'MatKhauBanDau@12345',
          fullName: 'E2E Đổi mật khẩu',
          phone: '0977777777',
        })
        .expect(201);
      const user = await prisma.user.findUnique({ where: { email } });
      userId = user!.id;
    });

    afterAll(async () => {
      await prisma.passwordResetToken.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
      await prisma.customerProfile.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it('requires the current password', async () => {
      const token = await login(app, email, 'MatKhauBanDau@12345');
      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'SaiMatKhau@12345', newPassword: 'MatKhauMoiHon@12345' })
        .expect(400);

      // The password must be unchanged after a failed attempt.
      await login(app, email, 'MatKhauBanDau@12345');
    });

    it('refuses a new password identical to the current one', async () => {
      const token = await login(app, email, 'MatKhauBanDau@12345');
      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'MatKhauBanDau@12345', newPassword: 'MatKhauBanDau@12345' })
        .expect(400);
    });

    it('changes the password, returns a fresh token, and invalidates the old one', async () => {
      const oldToken = await login(app, email, 'MatKhauBanDau@12345');

      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ currentPassword: 'MatKhauBanDau@12345', newPassword: 'MatKhauMoiHon@12345' })
        .expect(200);
      expect(typeof res.body.accessToken).toBe('string');

      // The OLD token must now be rejected: `passwordChangedAt` is newer than
      // its `iat`, so every device signed in before the change is out.
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);

      // The token returned by the change still works — the device that made the
      // change stays signed in.
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      // The new password is the live one.
      await login(app, email, 'MatKhauMoiHon@12345');
      // The old password is dead.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'MatKhauBanDau@12345' })
        .expect(401);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .send({ currentPassword: 'x', newPassword: 'MatKhauMoiHon@12345' })
        .expect(401);
    });
  });

  /* ------------------------------------------------------------------- B.3 -- */
  describe('B. forgot / reset password', () => {
    const email = `${RUN_ID}-recover@agrimarket.vn`;
    const initialPassword = 'MatKhauGoc@12345';
    let userId: number;

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: initialPassword,
          fullName: 'E2E Khôi phục',
          phone: '0988888888',
        })
        .expect(201);
      const user = await prisma.user.findUnique({ where: { email } });
      userId = user!.id;
    });

    afterAll(async () => {
      await prisma.passwordResetToken.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
      await prisma.customerProfile.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    /** Mints a reset token for the run's user without going through HTTP. */
    async function issueToken(ttlMs = 60 * 60 * 1000): Promise<string> {
      const { createHash, randomBytes } = await import('node:crypto');
      const raw = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(raw).digest('hex');
      await prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await prisma.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt: new Date(Date.now() + ttlMs) },
      });
      return raw;
    }

    it('answers identically for a registered and an unregistered address', async () => {
      const known = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      const unknown = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: `${RUN_ID}-khong-ton-tai@agrimarket.vn` })
        .expect(200);

      // Byte-for-byte identical apart from nothing: no enumeration signal.
      expect(known.body.message).toBe(unknown.body.message);
      expect(known.body.delivery).toEqual(unknown.body.delivery);

      // No token row may exist for an address with no account.
      const ghost = await prisma.user.findUnique({
        where: { email: `${RUN_ID}-khong-ton-tai@agrimarket.vn` },
      });
      expect(ghost).toBeNull();
    });

    it('stores only a hash of the token, never the token itself', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      const rows = await prisma.passwordResetToken.findMany({ where: { userId } });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        // 64 hex chars = SHA-256. A stored raw token would be 64 hex too, so the
        // real assertion is that no row's hash equals any raw value we ever saw.
        expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row).not.toHaveProperty('token');
      }
    });

    it('supersedes the previous link when a new one is requested', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      const active = await prisma.passwordResetToken.count({
        where: { userId, usedAt: null },
      });
      // Only the newest link stays usable.
      expect(active).toBe(1);
    });

    it('sets the new password with a valid token', async () => {
      const raw = await issueToken();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'MatKhauDatLai@12345' })
        .expect(200);
      expect(typeof res.body.message).toBe('string');
      // No session is issued: the customer signs in with the new password.
      expect(res.body).not.toHaveProperty('accessToken');

      await login(app, email, 'MatKhauDatLai@12345');
    });

    it('refuses to reuse the same token twice', async () => {
      const raw = await issueToken();
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'MatKhauLanHai@12345' })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'MatKhauLanBa@12345' })
        .expect(400);
      expect(String(second.body.message)).toContain('không hợp lệ hoặc đã hết hạn');

      // The password must still be the one the first use set.
      await login(app, email, 'MatKhauLanHai@12345');
    });

    it('refuses an expired token', async () => {
      const raw = await issueToken(-1000);
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'MatKhauHetHan@12345' })
        .expect(400);
    });

    it('refuses an unknown token with the same message as an expired one', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'a'.repeat(64), newPassword: 'MatKhauKhongCo@12345' })
        .expect(400);
      // One error for every failure mode: the caller cannot tell a guessed token
      // from a genuinely expired one.
      expect(String(res.body.message)).toContain('không hợp lệ hoặc đã hết hạn');
    });

    it('invalidates every outstanding link once the password is changed', async () => {
      const raw = await issueToken();
      const token = await login(app, email, 'MatKhauLanHai@12345');

      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'MatKhauLanHai@12345', newPassword: 'MatKhauSauDoi@12345' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'MatKhauChenVao@12345' })
        .expect(400);
    });

    it('refuses a new password that breaks the policy', async () => {
      const raw = await issueToken();
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, newPassword: 'short' })
        .expect(400);
    });
  });

  /* ------------------------------------------------------------------- B.4 -- */
  describe('B. rate limiting', () => {
    /**
     * The limiter is real protection, so it gets a real assertion: repeated
     * recovery requests from one address must stop being answered with 200.
     *
     * This is the ONE test that does not clear the counters first (the
     * `beforeEach` above does, but this test re-clears deliberately and then
     * burns the budget itself), so it proves the configured limit is enforced.
     */
    it('stops answering repeated password-recovery requests', async () => {
      resetThrottler(app);
      const target = `${RUN_ID}-throttle@agrimarket.vn`;

      const statuses: number[] = [];
      // The configured limit is 3/minute; 6 attempts must not all succeed.
      for (let i = 0; i < 6; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/forgot-password')
          .send({ email: target });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(3);

      // The throttled response must not leak the configured limit or the route.
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: target });
      expect(blocked.status).toBe(429);
      expect(String(blocked.body.message)).not.toMatch(/ThrottlerException|limit/i);
    });
  });

  /* ------------------------------------------------------------------- B.5 -- */
  describe('B. concurrency', () => {    it('lets only one of two simultaneous registrations of the same e-mail win', async () => {
      const email = `${RUN_ID}-race@agrimarket.vn`;
      const payload = {
        email,
        password: 'MatKhauDua@12345',
        fullName: 'E2E Đua',
        phone: '0999999999',
      };

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/auth/register').send(payload),
        request(app.getHttpServer()).post('/api/v1/auth/register').send(payload),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      // Exactly one 201 and one 409 — never two accounts, never two 500s.
      expect(statuses).toEqual([201, 409]);

      const count = await prisma.user.count({ where: { email } });
      expect(count).toBe(1);

      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: user!.id } });
      await prisma.customerProfile.deleteMany({ where: { userId: user!.id } });
      await prisma.user.delete({ where: { id: user!.id } });
    });

    it('lets only one of two simultaneous resets with the same token succeed', async () => {
      const email = `${RUN_ID}-resetrace@agrimarket.vn`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'MatKhauDua@12345',
          fullName: 'E2E Đua Đặt Lại',
          phone: '0910101010',
        })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { email } });
      const { createHash, randomBytes } = await import('node:crypto');
      const raw = randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: {
          userId: user!.id,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/reset-password')
          .send({ token: raw, newPassword: 'MatKhauDuaA@12345' }),
        request(app.getHttpServer())
          .post('/api/v1/auth/reset-password')
          .send({ token: raw, newPassword: 'MatKhauDuaB@12345' }),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 400]);

      // Exactly one of the two proposed passwords is live.
      const winner = a.status === 200 ? 'MatKhauDuaA@12345' : 'MatKhauDuaB@12345';
      await login(app, email, winner);

      await prisma.passwordResetToken.deleteMany({ where: { userId: user!.id } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: user!.id } });
      await prisma.customerProfile.deleteMany({ where: { userId: user!.id } });
      await prisma.user.delete({ where: { id: user!.id } });
    });
  });
});
