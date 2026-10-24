import { loadTestEnvironment, useIsolatedTestDatabase } from './test-env.js';

/**
 * Unit-test environment.
 *
 * `loadTestEnvironment` replaces any inherited JWT secret with the dedicated
 * non-production test secret, so a machine/CI production value is never used.
 * `useIsolatedTestDatabase` then points `DATABASE_URL` at `TEST_DATABASE_URL`
 * when available (for the read-only CORS bootstrap) or removes it, so a unit
 * run cannot reach the development database.
 */
loadTestEnvironment();
useIsolatedTestDatabase();
