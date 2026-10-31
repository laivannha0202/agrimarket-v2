import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

/**
 * Seeds the isolated test schema with the demo dataset the browser tests use
 * (admin + customers + products + one voucher).
 *
 * Safety interlocks:
 *  - the URL must come from `TEST_DATABASE_URL`;
 *  - it must contain `_test` as the database name suffix (the same rule the
 *    Vitest suites enforce);
 *  - the seed is executed with `DATABASE_URL` overwritten in the child process,
 *    so the script cannot fall back to the development database from `.env`.
 */
export default async function globalSetup(): Promise<void> {
  const apiDir = path.resolve(__dirname, '../apps/api');
  loadEnv({ path: path.join(apiDir, '.env'), override: false, quiet: true });

  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required for browser E2E. Refusing to run against an unset/development database.',
    );
  }
  let dbName = '';
  try {
    dbName = new URL(testUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection URL.');
  }
  if (!/_test$/i.test(dbName)) {
    throw new Error(
      `Refusing to seed "${dbName}": the browser E2E database name must end with "_test".`,
    );
  }

  // Re-runnable: the seed wipes and re-inserts its own dataset.
  execFileSync('npx', ['prisma', 'db', 'seed'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  // The seed wipes and re-inserts users, so their ids change. `support/api.ts`
  // caches bearer tokens per e-mail across runs; a token minted for the previous
  // dataset still has a valid signature but points at a user id that no longer
  // exists, and every authenticated helper call answers 401 "Invalid token".
  // Tokens cannot survive a re-seed, so the cache is dropped with it.
  rmSync(path.resolve(__dirname, '.auth', 'api-tokens.json'), { force: true });
}
