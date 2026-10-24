import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { assertIsolatedTestDatabase } from './helpers/db-safety.js';

/**
 * Dedicated, non-production JWT secret used by the automated suites.
 *
 * It is intentionally committed: it only ever signs throwaway test tokens. The
 * setup below overwrites any production/development `JWT_SECRET` inherited from
 * the shell or `.env`, so the suites can never exercise the real signing key.
 * A CI environment can override it with `TEST_JWT_SECRET`.
 */
export const TEST_JWT_SECRET_FALLBACK =
  'agrimarket-automated-tests-only-9f4c2a7b1d8e6f3a5c0b';

/**
 * Loads `.env`/`.env.local`, forces `NODE_ENV=test`, and installs the dedicated
 * test JWT secret. Real environment variables win over the files, but the JWT
 * secret is always replaced unless it came from `TEST_JWT_SECRET` — a production
 * value must never be used by a test run.
 */
export function loadTestEnvironment(): void {
  for (const file of ['.env', '.env.local']) {
    if (existsSync(file)) {
      loadEnv({ path: file, override: false, quiet: true });
    }
  }

  process.env.NODE_ENV = 'test';

  const dedicated = process.env.TEST_JWT_SECRET?.trim();
  process.env.JWT_SECRET = dedicated && dedicated.length > 0 ? dedicated : TEST_JWT_SECRET_FALLBACK;
}

/**
 * Points the application at the isolated test schema before any module is
 * compiled. The isolation interlock runs BEFORE `DATABASE_URL` is overwritten,
 * so a `TEST_DATABASE_URL` that aliases the application database still aborts
 * the run instead of being silently "fixed".
 *
 * When no test database is configured, `DATABASE_URL` is removed: the unit CORS
 * suite then skips its live branch and no suite can accidentally touch the
 * development schema.
 */
export function useIsolatedTestDatabase(): void {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    delete process.env.DATABASE_URL;
    return;
  }

  assertIsolatedTestDatabase(process.env);
  process.env.DATABASE_URL = testUrl;
}
