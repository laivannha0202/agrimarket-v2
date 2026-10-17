import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { assertIsolatedTestDatabase } from './helpers/db-safety.js';

/**
 * Loads the local environment for the e2e suite so that `npm run test:e2e` picks
 * up TEST_DATABASE_URL from apps/api/.env without hardcoding credentials.
 *
 * Real environment variables always win over the file, and the suite stays
 * skipped when no TEST_DATABASE_URL is available.
 */
for (const file of ['.env', '.env.local']) {
  if (existsSync(file)) {
    loadEnv({ path: file, override: false, quiet: true });
  }
}

/**
 * Hard interlock before any destructive SQL: a "test" database that is in fact
 * the application database aborts the run (see `helpers/db-safety.ts`).
 */
assertIsolatedTestDatabase(process.env);
