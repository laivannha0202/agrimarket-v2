import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { uploadsRoot } from '../../src/products/product-images.service.js';

/**
 * Builds the real application exactly as `main.ts` does (same global prefix,
 * same ValidationPipe options, same exception filter) so the e2e suites assert
 * the runtime contract rather than a test-only variant.
 *
 * `DATABASE_URL` must already point at the isolated test database.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.useStaticAssets(join(uploadsRoot(), 'products'), {
    prefix: '/uploads/products/',
  });
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
  return app;
}

/** Logs in and returns the bearer token, failing loudly if the login breaks. */
export async function login(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  // Imported lazily so this helper stays usable from any suite ordering.
  const { default: request } = await import('supertest');
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

/**
 * Clears the in-memory rate-limit counters.
 *
 * The auth limits are deliberately tight (5 registrations, 3 recovery mails per
 * minute per IP + address) because that is what protects real deployments. A
 * functional suite legitimately exceeds them — it registers a dozen accounts
 * from one IP in a few seconds — so the counters are cleared between tests that
 * are NOT about throttling, and the limiter itself is asserted in its own test.
 *
 * The limiter is never disabled: the guard, the per-route limits and the
 * `AuthThrottlerGuard` keying all stay in the request path.
 *
 * `onApplicationShutdown()` is the only public call that resets BOTH internal
 * maps — `storage` and the private per-hit expiration list that re-seeds the
 * counts on the next request. Clearing only `storage` leaves the counts intact.
 * The sweep interval restarts by itself on the next request.
 */
export function resetThrottler(app: INestApplication): void {
  app.get<ThrottlerStorageService>(getStorageToken()).onApplicationShutdown();
}
