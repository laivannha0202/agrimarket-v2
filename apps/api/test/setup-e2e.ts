import { loadTestEnvironment, useIsolatedTestDatabase } from './test-env.js';

/**
 * E2E environment.
 *
 * Order matters:
 *   1. load `.env`/`.env.local`, force `NODE_ENV=test`, install the dedicated
 *      test JWT secret (never the production/development one);
 *   2. refuse a `TEST_DATABASE_URL` that aliases `DATABASE_URL`;
 *   3. point the application at the isolated test schema.
 *
 * Step 2 runs before `DATABASE_URL` is overwritten (see
 * `useIsolatedTestDatabase`), so the interlock cannot be bypassed by the setup
 * itself. Without `TEST_DATABASE_URL`, all destructive E2E suites skip and
 * `DATABASE_URL` is removed rather than left pointing at development.
 */
loadTestEnvironment();
useIsolatedTestDatabase();
