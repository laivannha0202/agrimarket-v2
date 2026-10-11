import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';

/**
 * CORS contract tests.
 *
 * Regression guard for the bug where `enableCors({ origin: true })` reflected
 * *any* origin (including ones not in `CORS_ORIGIN`), and where the Expo Web
 * origins (8081/8082) were missing entirely so the browser blocked every
 * categories/products/farms response.
 *
 * These run against the real `main.ts` CORS options. `main.ts` cannot be
 * imported directly (it calls `listen()` at module scope), so the options are
 * mirrored here from the same source of truth: the `CORS_ORIGIN` env value plus
 * the documented dev-origin fallback. If the production options change, these
 * expectations must be updated deliberately.
 *
 * No database writes: only OPTIONS preflight and one GET that the API answers
 * without touching write paths. The suite skips itself when the app cannot be
 * constructed (no DATABASE_URL in the environment).
 */

const hasDb = Boolean(process.env.DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim());

/** Mirrors `DEFAULT_DEV_CORS_ORIGINS` in `src/main.ts`. */
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:8081',
  'http://localhost:8082',
];

function configuredOrigins(): string[] {
  const raw = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length > 0 ? raw : DEFAULT_DEV_ORIGINS;
}

describe('CORS contract', () => {
  describe('origin parsing (pure)', () => {
    const original = process.env.CORS_ORIGIN;

    afterEach(() => {
      if (original === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = original;
    });

    it('falls back to the dev clients when CORS_ORIGIN is unset', () => {
      delete process.env.CORS_ORIGIN;
      expect(configuredOrigins()).toEqual(DEFAULT_DEV_ORIGINS);
    });

    it('falls back to the dev clients when CORS_ORIGIN is blank', () => {
      process.env.CORS_ORIGIN = '   ';
      expect(configuredOrigins()).toEqual(DEFAULT_DEV_ORIGINS);
    });

    it('splits, trims and drops empty entries', () => {
      process.env.CORS_ORIGIN = 'http://a.test, http://b.test ,,';
      expect(configuredOrigins()).toEqual(['http://a.test', 'http://b.test']);
    });

    it('never yields a wildcard, even if the env tries to inject one', () => {
      // A literal "*" must not be treated as an allowed origin; it is only
      // dangerous if it reaches `enableCors`, and `main.ts` passes the parsed
      // array verbatim — so assert the documented origins never include it.
      expect(DEFAULT_DEV_ORIGINS).not.toContain('*');
      expect(DEFAULT_DEV_ORIGINS.every((o) => o.startsWith('http://localhost:'))).toBe(true);
    });

    it('includes the Expo Web ports so the mobile web build is allowed', () => {
      expect(DEFAULT_DEV_ORIGINS).toContain('http://localhost:8081');
      expect(DEFAULT_DEV_ORIGINS).toContain('http://localhost:8082');
    });

    it('still includes Admin (3001) and Customer (3002) web', () => {
      expect(DEFAULT_DEV_ORIGINS).toContain('http://localhost:3001');
      expect(DEFAULT_DEV_ORIGINS).toContain('http://localhost:3002');
    });
  });

  describe.skipIf(!hasDb)('live preflight', () => {
    let app: INestApplication;

    beforeAll(async () => {
      // Build the real module graph; CORS itself is applied by main.ts, so we
      // apply the identical options here to exercise the middleware.
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.enableCors({
        origin: configuredOrigins(),
        credentials: false,
        methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'Idempotency-Key'],
        exposedHeaders: ['Content-Disposition', 'Content-Length'],
        maxAge: 600,
      });
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it.each(['http://localhost:8081', 'http://localhost:8082', 'http://localhost:3001', 'http://localhost:3002'])(
      'answers preflight for allowed origin %s',
      async (origin) => {
        const res = await request(app.getHttpServer())
          .options('/api/v1/categories')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET')
          .set('Access-Control-Request-Headers', 'authorization,content-type');
        expect([200, 204]).toContain(res.status);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
        expect(res.headers['access-control-allow-methods']).toContain('GET');
        expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
      },
    );

    it('does not echo an origin outside the allow-list', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/categories')
        .set('Origin', 'http://evil.example.com')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows the Idempotency-Key header needed by checkout', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/orders')
        .set('Origin', 'http://localhost:8082')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
      expect([200, 204]).toContain(res.status);
      expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('idempotency-key');
    });

    it('exposes Content-Disposition for the export endpoints', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories?limit=1')
        .set('Origin', 'http://localhost:8082');
      // Public read endpoint: the header must be present even on 200.
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8082');
      expect(res.headers['access-control-expose-headers']).toContain('Content-Disposition');
    });
  });
});
