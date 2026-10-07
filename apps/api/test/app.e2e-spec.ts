import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * HTTP end-to-end tests.
 *
 * They run against an isolated database given by TEST_DATABASE_URL and are
 * skipped entirely when that variable is not configured, so `pnpm test:e2e`
 * never touches the development database and never hardcodes credentials.
 *
 * The suite provisions its own minimal fixtures (one admin user) and removes
 * them afterwards, so it does not depend on the demo seed being present.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const E2E_ADMIN_EMAIL = 'e2e.admin@agrimarket.vn';
const E2E_ADMIN_PASSWORD = 'E2eAdmin@12345';

describe.skipIf(!hasTestDb)('AgriMarket API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Point the application at the dedicated test database before the module
    // is compiled (PrismaService reads DATABASE_URL in its constructor).
    process.env.DATABASE_URL = TEST_URL;

    prisma = new PrismaClient({ adapter: new PrismaMariaDb(TEST_URL as string) });

    await prisma.user.upsert({
      where: { email: E2E_ADMIN_EMAIL },
      update: { role: 'ADMIN', status: 'ACTIVE' },
      create: {
        email: E2E_ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(E2E_ADMIN_PASSWORD, 10),
        fullName: 'E2E Admin',
        phone: '0900000000',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: E2E_ADMIN_EMAIL } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  it('rejects an unauthenticated request to a protected route with a clean 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({ statusCode: 401 });
    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
  });

  it('rejects invalid login payloads with a 400 validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('rejects wrong credentials with a generic 401 (no user enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: E2E_ADMIN_EMAIL, password: 'WrongPassword@1' })
      .expect(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('logs in an admin and returns a bearer token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD })
      .expect(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user).toMatchObject({ email: E2E_ADMIN_EMAIL, role: 'ADMIN' });
  });

  it('returns the current user for a valid token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(res.body).toMatchObject({ email: E2E_ADMIN_EMAIL, role: 'ADMIN' });
  });

  it('lists public products with a paginated envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/products').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
  });

  it('caps the page limit at 100', async () => {
    await request(app.getHttpServer()).get('/api/v1/products?limit=200').expect(400);
  });

  it('returns a clean 404 for an unknown public trace code', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/trace/TRC-DOES-NOT-EXIST')
      .expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, message: 'Trace code not found' });
    expect(res.body).not.toHaveProperty('stack');
  });
});
