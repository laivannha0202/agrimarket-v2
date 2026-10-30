#!/usr/bin/env node
/**
 * C-19 UI smoke for the built Admin and Customer web apps.
 *
 * This is deliberately an HTTP-level smoke, not a browser automation run. It
 * starts the built API plus `next start` for both web apps and verifies that:
 *
 *   - every Admin route (including the C-08 settlements and C-14 farm/season/
 *     lot screens) is reachable through the Next router and returns the built
 *     application shell;
 *   - every Customer route, including public traceability for a real seeded
 *     trace code, renders its metadata/loading shell;
 *   - the referenced `_next/static` CSS/JS assets are served;
 *   - the built bundle carries the expected API base URL.
 *
 * Login, localStorage auth, table interactions and checkout clicks need a real
 * browser. Playwright is not installed in this repository, so the script
 * records that limitation instead of pretending the interactions were tested.
 * The API/business smoke and the web unit tests cover those flows at the
 * service/component level.
 *
 *   node scripts/ui-smoke.mjs --url <isolated-seeded-url>
 *     [--api-port 3100] [--admin-port 3101] [--customer-port 3102]
 *     [--out <json>] [--log-dir <dir>] [--no-api]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  API_DIR,
  ROOT,
  assertRunDatabase,
  databaseLabel,
  ensureDir,
  isMain,
  loadProjectEnv,
  nowIso,
  portIsFree,
  queryRows,
  redactText,
  redactUrl,
  startProcess,
  tail,
  waitForHttp,
  writeJson,
} from './lib/verify-common.mjs';

const ADMIN_DIR = join(ROOT, 'apps', 'admin-web');
const CUSTOMER_DIR = join(ROOT, 'apps', 'customer-web');
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

const ADMIN_STATIC_ROUTES = [
  '/login',
  '/',
  '/dashboard',
  '/audit',
  '/categories',
  '/certificates',
  '/commission',
  '/customers',
  '/farms',
  '/flash-sales',
  '/inventory',
  '/lots',
  '/orders',
  '/partners',
  '/product-discounts',
  '/products',
  '/products/new',
  '/quality-control',
  '/quarantine',
  '/refunds',
  '/reports',
  '/returns-complaints',
  '/reviews',
  '/settlements',
  '/shipments',
  '/vouchers',
  '/warehouse-documents',
  '/warehouses',
];

const CUSTOMER_ROUTES = [
  ['/', 'AgriMarket — Nông sản sạch, rõ nguồn gốc'],
  ['/dang-nhap', 'Đăng nhập | AgriMarket'],
  ['/dang-ky', 'Đăng ký tài khoản | AgriMarket'],
  ['/quen-mat-khau', 'Quên mật khẩu | AgriMarket'],
  ['/dat-lai-mat-khau', 'Đặt lại mật khẩu | AgriMarket'],
  ['/san-pham', 'Sản phẩm | AgriMarket'],
  ['/gio-hang', 'Giỏ hàng | AgriMarket'],
  ['/thanh-toan', 'Thanh toán | AgriMarket'],
  ['/don-hang', 'Đơn hàng của tôi | AgriMarket'],
  ['/tai-khoan', 'Tài khoản của tôi | AgriMarket'],
  ['/tai-khoan/dia-chi', 'Sổ địa chỉ | AgriMarket'],
  ['/tai-khoan/doi-mat-khau', 'Đổi mật khẩu | AgriMarket'],
  ['/tra-hang', 'Trả hàng | AgriMarket'],
  ['/khieu-nai', 'Khiếu nại | AgriMarket'],
  ['/danh-gia', 'Đánh giá sản phẩm | AgriMarket'],
  ['/ma-giam-gia', 'Mã giảm giá | AgriMarket'],
  ['/trang-trai', 'Trang trại | AgriMarket'],
  ['/truy-xuat', 'Truy xuất nguồn gốc | AgriMarket'],
];

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function titleOf(html) {
  const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).trim() : null;
}

function assetPaths(html) {
  const paths = new Set();
  for (const match of html.matchAll(/(?:href|src)="([^"]*\/_next\/static\/[^"]+)"/g)) {
    paths.add(match[1]);
  }
  return [...paths];
}

function playwrightStatus() {
  const require = createRequire(import.meta.url);
  for (const name of ['@playwright/test', 'playwright']) {
    try {
      const packageFile = require.resolve(`${name}/package.json`);
      return { available: true, package: name, packageFile };
    } catch {
      // Try the next package.
    }
  }
  return { available: false, package: null, packageFile: null };
}

/**
 * Finds the API base baked into the built client chunks. NEXT_PUBLIC_* values
 * are inlined at build time, so this is the only reliable runtime check that
 * the web apps will call the API started by this smoke.
 */
function apiBaseInBundle(appDir) {
  const staticDir = join(appDir, '.next', 'static');
  if (!existsSync(staticDir)) return { found: null, source: null };
  const stack = [staticDir];
  const pattern = /https?:\/\/[^"'`\s\\]+\/api\/v1/g;
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      let source;
      try {
        source = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const match = pattern.exec(source);
      pattern.lastIndex = 0;
      if (match) return { found: match[0], source: path };
    }
  }
  return { found: null, source: null };
}

async function loadFixtures(parsed) {
  const [farm] = await queryRows(parsed, 'SELECT id FROM farms ORDER BY id LIMIT 1');
  const [season] = await queryRows(parsed, 'SELECT id FROM seasons ORDER BY id LIMIT 1');
  const [lot] = await queryRows(
    parsed,
    `SELECT id, trace_code FROM product_lots
      WHERE status = 'SELLABLE' AND trace_code IS NOT NULL
      ORDER BY id LIMIT 1`,
  );
  const [product] = await queryRows(parsed, 'SELECT id FROM products ORDER BY id LIMIT 1');
  const [partner] = await queryRows(parsed, 'SELECT id FROM partners ORDER BY id LIMIT 1');
  const [settlement] = await queryRows(parsed, 'SELECT id FROM settlements ORDER BY id LIMIT 1');
  const [order] = await queryRows(parsed, 'SELECT id FROM orders ORDER BY id LIMIT 1');
  const [customer] = await queryRows(
    parsed,
    "SELECT id FROM users WHERE role = 'CUSTOMER' ORDER BY id LIMIT 1",
  );
  const [warehouseDocument] = await queryRows(
    parsed,
    'SELECT id FROM warehouse_documents ORDER BY id LIMIT 1',
  );
  return {
    farmId: farm ? Number(farm.id) : null,
    seasonId: season ? Number(season.id) : null,
    lotId: lot ? Number(lot.id) : null,
    traceCode: lot ? String(lot.trace_code) : null,
    productId: product ? Number(product.id) : null,
    partnerId: partner ? Number(partner.id) : null,
    settlementId: settlement ? Number(settlement.id) : null,
    orderId: order ? Number(order.id) : null,
    customerId: customer ? Number(customer.id) : null,
    warehouseDocumentId: warehouseDocument ? Number(warehouseDocument.id) : null,
  };
}

function dynamicAdminRoutes(fixtures) {
  const routes = [];
  if (fixtures.farmId) routes.push(`/farms/${fixtures.farmId}`);
  if (fixtures.seasonId) routes.push(`/seasons/${fixtures.seasonId}`);
  if (fixtures.lotId) routes.push(`/lots/${fixtures.lotId}`);
  if (fixtures.orderId) routes.push(`/orders/${fixtures.orderId}`);
  if (fixtures.settlementId) routes.push(`/settlements/${fixtures.settlementId}`);
  if (fixtures.customerId) routes.push(`/customers/${fixtures.customerId}`);
  if (fixtures.partnerId) routes.push(`/partners/${fixtures.partnerId}`);
  if (fixtures.productId) routes.push(`/products/${fixtures.productId}`);
  if (fixtures.warehouseDocumentId) {
    routes.push(`/warehouse-documents/${fixtures.warehouseDocumentId}`);
  }
  return routes;
}

export async function runUiSmoke(url, options = {}) {
  const startedAt = nowIso();
  const parsed = assertRunDatabase(url, '--url');
  const apiPort = Number(options.apiPort ?? 3100);
  const adminPort = Number(options.adminPort ?? 3101);
  const customerPort = Number(options.customerPort ?? 3102);
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const adminBase = `http://127.0.0.1:${adminPort}`;
  const customerBase = `http://127.0.0.1:${customerPort}`;
  const outDir = ensureDir(options.outDir ?? join(ROOT, '.tmp-verify', 'c19', 'ui-smoke'));
  const logsDir = ensureDir(options.logDir ?? join(outDir, 'logs'));
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const result = {
    generatedAt: startedAt,
    database: databaseLabel(parsed),
    databaseUrl: redactUrl(url),
    apiBase,
    adminBase,
    customerBase,
    playwright: playwrightStatus(),
    checks: [],
    warnings: [],
    failures: [],
    assets: [],
    result: 'FAIL',
  };
  if (!result.playwright.available) {
    result.warnings.push(
      'Browser E2E is unavailable: neither @playwright/test nor playwright is installed. ' +
        'This smoke checks built HTML, routes and static assets only; login, localStorage auth, ' +
        'table interactions and checkout clicks are covered by the API/business smoke and ' +
        'component tests, not by a real browser.',
    );
  }

  const check = (name, ok, detail) => {
    result.checks.push({ name, ok, detail: redactText(String(detail ?? '')) });
    if (!ok) result.failures.push(`${name}: ${detail}`);
    return ok;
  };
  const warn = (message) => result.warnings.push(redactText(message));

  for (const dir of [ADMIN_DIR, CUSTOMER_DIR]) {
    if (!existsSync(join(dir, '.next', 'BUILD_ID'))) {
      throw new Error(`${dir} has no production build; run ` + '`npm run build` first.');
    }
  }
  if (!existsSync(NEXT_BIN)) throw new Error(`Next.js CLI not found at ${NEXT_BIN}`);
  if (!options.noApi && !existsSync(join(API_DIR, 'dist', 'src', 'main.js'))) {
    throw new Error('apps/api/dist/src/main.js is missing; run `npm run build` first.');
  }

  for (const [label, port] of [
    ['API', apiPort],
    ['Admin', adminPort],
    ['Customer', customerPort],
  ]) {
    if (!(await portIsFree(port))) {
      throw new Error(`${label} port ${port} is already in use; choose another --*-port.`);
    }
  }

  const fixtures = await loadFixtures(parsed);
  result.fixtures = fixtures;
  if (!fixtures.traceCode) {
    warn('No SELLABLE lot with a trace code was found; the public trace route is skipped.');
  }

  const servers = [];
  try {
    if (!options.noApi) {
      servers.push(
        startProcess({
          name: `api (ui smoke) on ${apiPort}`,
          command: process.execPath,
          args: [join(API_DIR, 'dist', 'src', 'main.js')],
          cwd: API_DIR,
          env: {
            DATABASE_URL: url,
            PORT: String(apiPort),
            NODE_ENV: 'test',
            JWT_SECRET: process.env.JWT_SECRET,
            JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1h',
            MAIL_TRANSPORT: 'test',
            CORS_ORIGIN: `${adminBase},${customerBase}`,
          },
          logFile: join(logsDir, `api-${token}.log`),
        }),
      );
    }

    for (const [label, dir, port] of [
      ['admin', ADMIN_DIR, adminPort],
      ['customer', CUSTOMER_DIR, customerPort],
    ]) {
      servers.push(
        startProcess({
          name: `${label} web on ${port}`,
          command: process.execPath,
          args: [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'],
          cwd: dir,
          env: {
            NODE_ENV: 'production',
            PORT: String(port),
            HOSTNAME: '127.0.0.1',
            NEXT_TELEMETRY_DISABLED: '1',
            NEXT_PUBLIC_API_BASE_URL: `${apiBase}/api/v1`,
          },
          logFile: join(logsDir, `${label}-${token}.log`),
        }),
      );
    }

    await Promise.all([
      options.noApi ? Promise.resolve() : waitForHttp(`${apiBase}/api/v1/health`, { timeoutMs: 90_000 }),
      waitForHttp(`${adminBase}/login`, { timeoutMs: 120_000 }),
      waitForHttp(`${customerBase}/`, { timeoutMs: 120_000 }),
    ]);
    check(
      'server-readiness',
      true,
      options.noApi
        ? `reused API at ${apiBase}; Admin :${adminPort}, Customer :${customerPort}`
        : `API :${apiPort}, Admin :${adminPort}, Customer :${customerPort} ready`,
    );

    if (!options.noApi) {
      const health = await fetchJson(`${apiBase}/api/v1/health`);
      check(
        'api-health',
        health.status === 200 && health.body?.database === 'up',
        `HTTP ${health.status}, database=${health.body?.database ?? '?'}`,
      );
    }

    for (const [label, dir, base] of [
      ['admin', ADMIN_DIR, adminBase],
      ['customer', CUSTOMER_DIR, customerBase],
    ]) {
      const bundle = apiBaseInBundle(dir);
      result.assets.push({ app: label, apiBase: bundle.found, source: bundle.source });
      if (!bundle.found) {
        warn(`No /api/v1 base URL was found in the ${label} client bundle.`);
      } else if (!bundle.found.startsWith(`${apiBase}/api/v1`)) {
        warn(
          `The ${label} build targets ${bundle.found}, but this smoke started the API at ` +
            `${apiBase}/api/v1. Rebuild with NEXT_PUBLIC_API_BASE_URL=${apiBase}/api/v1 ` +
            'to exercise live browser API calls.',
        );
      }
    }

    // ---- Admin routes ---------------------------------------------------
    const adminPage = async (route, { expectMarker } = {}) => {
      const response = await fetch(`${adminBase}${route}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
      const html = await response.text();
      const title = titleOf(html);
      const hasShell = html.includes('_next/static');
      const hasError = /Application error|missing required error components/i.test(html);
      const markerOk = expectMarker ? html.includes(expectMarker) : true;
      check(
        `admin-route:${route}`,
        response.status === 200 &&
          hasShell &&
          !hasError &&
          markerOk &&
          (title === null || title.includes('AgriMarket Admin')),
        `HTTP ${response.status}, title=${title ?? '?'}${expectMarker ? `, marker=${markerOk}` : ''}`,
      );
      return html;
    };

    const adminLoginHtml = await adminPage('/login', { expectMarker: 'Đăng nhập' });
    check(
      'admin-login-form-shell',
      adminLoginHtml.includes('Email') && adminLoginHtml.includes('Mật khẩu'),
      'login labels rendered in the server HTML',
    );
    for (const route of ADMIN_STATIC_ROUTES) {
      if (route === '/login') continue;
      await adminPage(route);
    }
    for (const route of dynamicAdminRoutes(fixtures)) {
      await adminPage(route);
    }
    check(
      'admin-route-count',
      result.checks.filter((entry) => entry.name.startsWith('admin-route:')).length ===
        ADMIN_STATIC_ROUTES.length + dynamicAdminRoutes(fixtures).length,
      `${ADMIN_STATIC_ROUTES.length + dynamicAdminRoutes(fixtures).length} Admin route(s) checked`,
    );

    // ---- Customer routes ------------------------------------------------
    for (const [route, expectedTitle] of CUSTOMER_ROUTES) {
      const response = await fetch(`${customerBase}${route}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const html = await response.text();
      const title = titleOf(html);
      const hasShell = html.includes('_next/static');
      const hasError = /Application error|missing required error components/i.test(html);
      check(
        `customer-route:${route}`,
        response.status === 200 && hasShell && !hasError && title === expectedTitle,
        `HTTP ${response.status}, title=${title ?? '?'} (expected ${expectedTitle})`,
      );
    }

    if (fixtures.traceCode) {
      const tracePath = `/truy-xuat/${encodeURIComponent(fixtures.traceCode)}`;
      const response = await fetch(`${customerBase}${tracePath}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const html = await response.text();
      const title = titleOf(html);
      check(
        'customer-trace-detail',
        response.status === 200 &&
          title === 'Chi tiết truy xuất | AgriMarket' &&
          html.includes('Đang tra cứu hồ sơ lô hàng'),
        `HTTP ${response.status}, title=${title ?? '?'}, code=${fixtures.traceCode}`,
      );
    } else {
      result.warnings.push('Public trace detail was skipped: no seeded trace code.');
    }

    if (fixtures.productId) {
      const response = await fetch(`${customerBase}/san-pham/${fixtures.productId}`);
      check(
        'customer-product-detail',
        response.status === 200 && (await response.text()).includes('_next/static'),
        `HTTP ${response.status}, product=${fixtures.productId}`,
      );
    }
    if (fixtures.farmId) {
      const response = await fetch(`${customerBase}/trang-trai/${fixtures.farmId}`);
      check(
        'customer-farm-detail',
        response.status === 200 && (await response.text()).includes('_next/static'),
        `HTTP ${response.status}, farm=${fixtures.farmId}`,
      );
    }
    if (fixtures.partnerId) {
      const response = await fetch(`${customerBase}/doi-tac/${fixtures.partnerId}`);
      check(
        'customer-partner-detail',
        response.status === 200 && (await response.text()).includes('_next/static'),
        `HTTP ${response.status}, partner=${fixtures.partnerId}`,
      );
    }

    // ---- Static assets ---------------------------------------------------
    const assets = new Map();
    for (const [label, base] of [
      ['admin', adminBase],
      ['customer', customerBase],
    ]) {
      const page = label === 'admin' ? '/login' : '/';
      const html = await (await fetch(`${base}${page}`)).text();
      for (const path of assetPaths(html)) assets.set(`${label}:${path}`, { label, base, path });
    }
    let assetFailures = 0;
    for (const asset of assets.values()) {
      try {
        const response = await fetch(`${asset.base}${asset.path}`, {
          signal: AbortSignal.timeout(20_000),
        });
        const body = await response.text();
        if (response.status !== 200 || body.length === 0) assetFailures += 1;
      } catch {
        assetFailures += 1;
      }
    }
    check(
      'built-static-assets',
      assets.size > 0 && assetFailures === 0,
      `${assets.size} referenced asset(s), ${assetFailures} failure(s)`,
    );

    result.result = result.failures.length === 0 ? 'PASS' : 'FAIL';
  } catch (error) {
    result.failures.push(redactText(error.message));
    result.result = 'FAIL';
  } finally {
    for (const server of servers.reverse()) {
      try {
        await server.stop();
      } catch {
        // The shutdown is best effort; the summary records the failure.
      }
    }
    for (const [label, file] of [
      ['api', join(logsDir, `api-${token}.log`)],
      ['admin', join(logsDir, `admin-${token}.log`)],
      ['customer', join(logsDir, `customer-${token}.log`)],
    ]) {
      result[`${label}LogTail`] = tail(readLog(file), 20);
    }
    result.logs = logsDir;
    result.completedAt = nowIso();
  }

  return result;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function readLog(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/ui-smoke.mjs --url <isolated-seeded-url> [options]

Options:
  --url <url>          Disposable, seeded schema used by the API (required)
  --api-port <port>    API port (default: 3100)
  --admin-port <port>  Admin web port (default: 3101)
  --customer-port <n>  Customer web port (default: 3102)
  --no-api             Do not start the API (it must already be running)
  --out <file>         Write the full result JSON here
  --log-dir <dir>      Directory for server logs
  --help               Show this help

Both web apps must have a production build. This smoke is HTTP-level only:
browser interaction requires Playwright, which is not installed.`);
    process.exit(0);
  }
  loadProjectEnv();
  const url = valueOf(args, '--url') ?? process.env.VERIFY_DATABASE_URL;
  if (!url) throw new Error('--url (or VERIFY_DATABASE_URL) is required.');
  const result = await runUiSmoke(url, {
    apiPort: Number(valueOf(args, '--api-port', '3100')),
    adminPort: Number(valueOf(args, '--admin-port', '3101')),
    customerPort: Number(valueOf(args, '--customer-port', '3102')),
    outDir: valueOf(args, '--out-dir', undefined),
    logDir: valueOf(args, '--log-dir', undefined),
    noApi: args.includes('--no-api'),
  });
  const out = valueOf(args, '--out');
  if (out) writeJson(out, result);

  console.log(`UI smoke: ${result.result}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} - ${check.detail}`);
  }
  for (const warning of result.warnings) console.log(`  WARN  ${redactText(warning)}`);
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  - ${redactText(failure)}`);
    console.error(`\nAdmin log tail:\n${result.adminLogTail ?? ''}`);
    console.error(`\nCustomer log tail:\n${result.customerLogTail ?? ''}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`UI smoke failed: ${redactText(error.message)}`);
    process.exit(1);
  });
}
