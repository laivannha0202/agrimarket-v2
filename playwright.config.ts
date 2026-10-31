import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// The isolated database URL lives in apps/api/.env (never in the shell).
loadEnv({ path: path.resolve(__dirname, 'apps/api/.env'), override: false, quiet: true });

/**
 * Browser E2E (local only).
 *
 * Three real servers are started from source: the Nest API, the admin Next app
 * and the customer Next app. The API is pointed at `TEST_DATABASE_URL` — the
 * same isolated schema the Vitest E2E suites use — never at the development
 * database. `e2e/global-setup.ts` refuses to run when the URL does not look
 * like a dedicated `*_test` schema.
 *
 * Run:
 *   npx playwright install chromium        (once)
 *   npx playwright test
 *
 * The admin detail suite runs twice (desktop + 390px viewport) to cover the
 * responsive layout requirement.
 */

// `localhost`, not `127.0.0.1`: the API only allows the documented dev origins
// in `DEFAULT_DEV_CORS_ORIGINS`, and a browser sends the origin the page was
// loaded from. Using the IP here made every cross-origin login fail with a CORS
// error while the same request succeeded from curl.
const API_ORIGIN = process.env.E2E_API_URL ?? 'http://localhost:3000';
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3001';
const CUSTOMER_URL = process.env.E2E_CUSTOMER_URL ?? 'http://localhost:3002';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'admin-setup',
      testDir: './e2e',
      testMatch: /auth\.admin\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL },
    },
    {
      name: 'customer-setup',
      testDir: './e2e',
      testMatch: /auth\.customer\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: CUSTOMER_URL },
    },
    {
      name: 'admin-desktop',
      testDir: './e2e/admin',
      dependencies: ['admin-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_URL,
        storageState: 'e2e/.auth/admin.json',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'admin-small',
      testDir: './e2e/admin',
      dependencies: ['admin-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_URL,
        storageState: 'e2e/.auth/admin.json',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'customer',
      testDir: './e2e/customer',
      dependencies: ['customer-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CUSTOMER_URL,
        storageState: 'e2e/.auth/customer.json',
        viewport: { width: 1366, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev --workspace @agrimarket/api',
      url: `${API_ORIGIN}/api/v1/health`,
      // Never attach to a server someone else started: it could be bound to the
      // development database instead of TEST_DATABASE_URL.
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'test',
        PORT: '3000',
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
        PAYMENTS_ONLINE_ENABLED: 'false',
      },
    },
    {
      command: 'npm run dev --workspace @agrimarket/admin-web',
      url: ADMIN_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: `${API_ORIGIN}/api/v1`,
      },
    },
    {
      command: 'npm run dev --workspace @agrimarket/customer-web',
      url: CUSTOMER_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: `${API_ORIGIN}/api/v1`,
      },
    },
  ],
});
