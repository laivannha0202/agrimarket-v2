import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

/**
 * Loads the local environment for the e2e suite so that `pnpm test:e2e` picks
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
