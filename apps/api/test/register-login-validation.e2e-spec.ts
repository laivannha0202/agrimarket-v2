import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login, resetThrottler } from './helpers/test-app.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_CUSTOMER_PASSWORD,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * HTTP end-to-end coverage for the customer register → login matrix, focused on
 * the validation contract that the Mobile and Customer Web clients rely on.
 *
 * The bug this locks down: the Mobile form once accepted a one-character name,
 * sent it, and the server answered 400 with `["Vui lòng nhập họ và tên"]` — which
 * the app surfaced as one generic banner. Here we assert the BACKEND half of the
 * contract the client now mirrors: exactly which inputs are 400 vs 201 vs 409,
 * and that the response `message` is the field-attributable Vietnamese text the
 * clients map back onto a field. The client-side mirror + mapping is covered by
 * the Mobile unit tests (`validation.test.ts`).
 *
 * Runs against TEST_DATABASE_URL only; skipped when it is unset.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2ereg');

describe.skipIf(!hasTestDb)('Register / login validation matrix (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;

  /** Every e-mail this suite registers, so cleanup is exact. */
  const registered: string[] = [];

  const reg = (suffix: string) => `${RUN_ID}-${suffix}@agrimarket.vn`;

  const GOOD = {
    password: 'MatKhau@12345',
    fullName: 'E2E Người dùng',
    phone: '0912345678',
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL as string);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
  }, 60_000);

  beforeEach(() => {
    resetThrottler(app);
  });

  afterAll(async () => {
    if (prisma) {
      for (const email of registered) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
          await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
          await prisma.address.deleteMany({ where: { customer: { userId: user.id } } });
          await prisma.customerProfile.deleteMany({ where: { userId: user.id } });
          await prisma.user.delete({ where: { id: user.id } });
        }
      }
      await cleanupFixtures(prisma, fixtures);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 60_000);

  /* --------------------------------------------------------------- B.1 400s -- */
  describe('rejected inputs (400) with field-attributable messages', () => {
    it('rejects a one-character full name and names the fullName rule', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: reg('shortname'), ...GOOD, fullName: 'A' })
        .expect(400);
      // The exact Vietnamese message the client maps onto the fullName field.
      expect(res.body.message).toContain('Vui lòng nhập họ và tên');
      expect(res.body).not.toHaveProperty('stack');
    });

    it('rejects a malformed e-mail', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'khong-phai-email', ...GOOD })
        .expect(400);
      expect(res.body.message).toContain('Email chưa hợp lệ');
    });

    it('rejects a phone number that is not a Vietnamese mobile', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: reg('badphone'), ...GOOD, phone: '123' })
        .expect(400);
      expect(res.body.message).toContain('Số điện thoại chưa hợp lệ');
    });

    it('rejects a password shorter than 10 characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: reg('shortpw'), ...GOOD, password: 'Ab@1' })
        .expect(400);
      expect(String(res.body.message)).toContain('10 ký tự');
    });

    it('rejects a password with no digit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: reg('nodigit'), ...GOOD, password: 'MatKhauKhongSo' })
        .expect(400);
      expect(String(res.body.message)).toContain('chữ số');
    });

    it('rejects a forged role field instead of creating an account (no escalation)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: reg('attacker'), ...GOOD, role: 'ADMIN' })
        .expect(400);
      expect(res.body.statusCode).toBe(400);
      const stored = await prisma.user.findUnique({ where: { email: reg('attacker') } });
      expect(stored).toBeNull();
    });
  });

  /* ------------------------------------------------------ B.2 success + 409 -- */
  describe('successful registration and the duplicate-address race', () => {
    const email = reg('newbie');

    afterAll(async () => {
      registered.push(email);
    });

    it('creates an ACTIVE CUSTOMER with a profile and issues no session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, ...GOOD })
        .expect(201);

      expect(res.body.email).toBe(email);
      expect(res.body.role).toBe('CUSTOMER');
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('passwordHash');

      const stored = await prisma.user.findUnique({
        where: { email },
        include: { customerProfile: true },
      });
      expect(stored?.status).toBe('ACTIVE');
      expect(stored?.customerProfile).not.toBeNull();
    });

    it('rejects a second registration of the same e-mail with 409 (lost-response retry)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, ...GOOD, password: 'MatKhauKhac@12345' })
        .expect(409);
      // The client maps this exact sentence onto the e-mail field.
      expect(res.body.message).toContain('Email này đã được đăng ký');
      const count = await prisma.user.count({ where: { email } });
      expect(count).toBe(1);
    });
  });

  /* -------------------------------------------------- B.3 login after register */
  describe('login after registration', () => {
    const email = reg('signer');
    const password = 'MatKhau@12345';

    afterAll(async () => {
      registered.push(email);
    });

    it('signs in the freshly registered account and GET /auth/me verifies it', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password, fullName: 'E2E Người đăng nhập', phone: '0933333333' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user.role).toBe('CUSTOMER');

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe(email);
      expect(me.body).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password with 401 and leaks nothing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'SaiMatKhau@12345' })
        .expect(401);
      // The server answers in English; the CLIENT translates this to
      // "Email hoặc mật khẩu chưa đúng." (see mobile `messages.ts`). What matters
      // at the API boundary is the status and that no credential/hash leaks.
      expect(res.body.statusCode).toBe(401);
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('stack');
    });
  });

  /* --------------------------------------------- B.4 web and mobile share one account */
  describe('one account for Web and Mobile', () => {
    it('the shared /auth/me returns the signed-in customer identity', async () => {
      const token = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.email).toBe(fixtures.customerEmail);
      expect(me.body.role).toBe('CUSTOMER');
    });
  });

  /* ------------------------------------------------ B.5 two customers do not cross */
  describe('two customers do not share a session', () => {
    it("a customer's token only ever returns that customer's own id", async () => {
      const token = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.id).toBe(fixtures.customerId);
    });
  });

  /* -------------------------------------------------------- B.6 double submit */
  describe('double submit', () => {
    it('two rapid registrations of one address yield exactly one account', async () => {
      const email = reg('double');
      const payload = { email, ...GOOD };
      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/auth/register').send(payload),
        request(app.getHttpServer()).post('/api/v1/auth/register').send(payload),
      ]);
      const codes = [a.status, b.status].sort((x, y) => x - y);
      // Exactly one 201; the loser is a 409 (unique constraint), never two 201s.
      expect(codes).toEqual([201, 409]);
      registered.push(email);
      const count = await prisma.user.count({ where: { email } });
      expect(count).toBe(1);
    });
  });

  /* -------------------------------------------------------- B.7 password hash */
  describe('stored credentials', () => {
    it('never stores the plaintext password', async () => {
      const email = reg('hashcheck');
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, ...GOOD })
        .expect(201);
      registered.push(email);

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.passwordHash).toBeTruthy();
      expect(stored?.passwordHash).not.toContain('MatKhau');
      expect(await bcrypt.compare('MatKhau@12345', stored!.passwordHash)).toBe(true);
    });
  });
});

