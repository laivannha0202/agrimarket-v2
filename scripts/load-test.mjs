#!/usr/bin/env node
/**
 * C-19 read-path load test.
 *
 * Drives a fixed, weighted mix of the read endpoints that every session hits —
 * public catalog list/detail, public traceability, the customer order list and
 * the customer cart — at a fixed concurrency, and reports latency percentiles
 * plus throughput.
 *
 * The generator is closed-loop (each virtual user waits for its response before
 * sending the next request) and uses keep-alive sockets. It is a baseline tool:
 * the numbers describe the machine and database it runs against, so they are
 * only comparable between runs with the same `--concurrency`/`--duration` and
 * the same hardware. It is not part of `npm run verify:local` because timing
 * thresholds are not deterministic on a shared developer machine.
 *
 * Two modes:
 *   --url <mysql-url>   start the built API against an isolated seeded schema
 *                       (same rules as the other C-19 scripts: *_test, *_restore,
 *                       *_drill only, never DATABASE_URL);
 *   --base-url <url>    target an already-running API. Non-loopback hosts also
 *                       require --allow-external, because a load test against a
 *                       shared environment is a visible action.
 *
 * Nothing is written: every scenario is a GET. Thresholds fail the run (exit 1)
 * when p99 latency or the error rate is above the configured limits.
 *
 *   node scripts/load-test.mjs --url <isolated-url> [--concurrency 20]
 *     [--duration 30] [--warmup 5] [--port 3110] [--out <json>]
 *     [--max-p99 2000] [--max-error-rate 0.01]
 */
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import {
  API_DIR,
  ROOT,
  assertRunDatabase,
  databaseLabel,
  ensureDir,
  httpJson,
  isMain,
  itemsOf,
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

const DEMO = {
  customerEmail: process.env.VERIFY_CUSTOMER_EMAIL ?? 'lan.nguyen@agrimarket.vn',
  customerPassword: process.env.VERIFY_CUSTOMER_PASSWORD ?? 'Agri@12345',
};

const API_PREFIX = '/api/v1';
const MAX_SOCKETS = 128;

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function numberArg(args, flag, fallback) {
  const raw = valueOf(args, flag);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number`);
  return value;
}

function usage() {
  return `Usage: node scripts/load-test.mjs (--url <isolated-mysql-url> | --base-url <api-url>) [options]

Options:
  --url <url>            Isolated, seeded schema; the API is started on --port
  --base-url <url>       Already-running API (non-loopback needs --allow-external)
  --allow-external       Permit a non-loopback --base-url (shared environment)
  --concurrency <n>      Virtual users (default: 20)
  --duration <seconds>   Measured phase (default: 30)
  --warmup <seconds>     Unmeasured phase before measuring (default: 5)
  --port <port>          API port in --url mode (default: 3110; must be free)
  --out <file>           Write the full result JSON here
  --log-dir <dir>        Directory for the API log (--url mode)
  --max-p99 <ms>         Fail when p99 latency exceeds this (default: 2000)
  --max-error-rate <n>   Fail when the error ratio exceeds this (default: 0.01)
  --request-timeout <ms> Per-request timeout (default: 10000)
  --help                 Show this help

Environment overrides for the customer account:
  VERIFY_CUSTOMER_EMAIL, VERIFY_CUSTOMER_PASSWORD

The API is started from apps/api/dist/src/main.js, so run the workspace build
first. Every request is a GET; the script never mutates data.`;
}

/** Picks the scenario whose cumulative weight covers a random point. */
function pickScenario(scenarios, totalWeight) {
  let point = Math.random() * totalWeight;
  for (const scenario of scenarios) {
    point -= scenario.weight;
    if (point <= 0) return scenario;
  }
  return scenarios[scenarios.length - 1];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function latencySummary(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.length > 0 ? sorted[sorted.length - 1] : 0),
  };
}

/**
 * Minimal keep-alive GET client. Resolves with the status code once the body is
 * fully drained, so the measured latency covers the whole response.
 */
function createClient(baseUrl, token, timeoutMs) {
  const target = new URL(baseUrl);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;
  const agent = new (isHttps ? https.Agent : http.Agent)({
    keepAlive: true,
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_SOCKETS,
  });

  return {
    get(path, { authenticated = false } = {}) {
      return new Promise((resolve, reject) => {
        const headers = { Accept: 'application/json' };
        if (authenticated) {
          if (!token) reject(new Error('no token for an authenticated scenario'));
          headers.Authorization = `Bearer ${token}`;
        }
        const request = transport.request(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || undefined,
            path,
            method: 'GET',
            agent,
            headers,
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode ?? 0));
            response.on('error', reject);
          },
        );
        request.setTimeout(timeoutMs, () => {
          request.destroy(new Error(`request timeout after ${timeoutMs} ms`));
        });
        request.on('error', reject);
        request.end();
      });
    },
    close() {
      agent.destroy();
    },
  };
}

function emptyStats(scenarios) {
  return new Map(
    scenarios.map((scenario) => [
      scenario.name,
      { latencies: [], errors: 0, statuses: new Map(), samples: 0 },
    ]),
  );
}

async function runPhase({ client, scenarios, totalWeight, concurrency, durationMs, collect, stats }) {
  const deadline = Date.now() + durationMs;

  const worker = async () => {
    while (Date.now() < deadline) {
      const scenario = pickScenario(scenarios, totalWeight);
      const startedAt = process.hrtime.bigint();
      let status = 0;
      let failed = false;
      try {
        status = await client.get(scenario.path, { authenticated: scenario.auth === true });
        if (status >= 400) failed = true;
      } catch {
        failed = true;
      }
      if (!collect) continue;

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const entry = stats.get(scenario.name);
      entry.samples += 1;
      entry.latencies.push(elapsedMs);
      if (failed) entry.errors += 1;
      const key = status === 0 ? 'network-error' : String(status);
      entry.statuses.set(key, (entry.statuses.get(key) ?? 0) + 1);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}

function summarize(stats, scenarios, durationMs) {
  const all = [];
  let totalErrors = 0;
  const perScenario = scenarios.map((scenario) => {
    const entry = stats.get(scenario.name);
    all.push(...entry.latencies);
    totalErrors += entry.errors;
    return {
      name: scenario.name,
      weight: scenario.weight,
      samples: entry.samples,
      errors: entry.errors,
      rps: round(entry.samples / (durationMs / 1000), 2),
      latency: latencySummary(entry.latencies),
      statuses: Object.fromEntries([...entry.statuses.entries()].sort()),
    };
  });
  const total = all.length;
  return {
    scenarios: perScenario,
    totals: {
      requests: total,
      errors: totalErrors,
      errorRate: total > 0 ? round(totalErrors / total, 4) : 1,
      rps: round(total / (durationMs / 1000), 2),
      latency: latencySummary(all),
    },
  };
}

async function login(api) {
  const response = await httpJson(`${api}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: DEMO.customerEmail, password: DEMO.customerPassword }),
    timeoutMs: 20_000,
  });
  const token = response.body?.accessToken ?? response.body?.access_token ?? null;
  if (response.status !== 200 || !token) {
    throw new Error(
      `customer login failed (HTTP ${response.status}); set VERIFY_CUSTOMER_EMAIL/VERIFY_CUSTOMER_PASSWORD`,
    );
  }
  return token;
}

async function resolveFixtures(api, parsed) {
  const products = await httpJson(`${api}/products?limit=1`);
  const productId = itemsOf(products.body)[0]?.id;
  if (!productId) throw new Error('the target API returned no product; seed the schema first');

  let traceCode = null;
  if (parsed) {
    const [lot] = await queryRows(
      parsed,
      `SELECT pl.trace_code FROM product_lots pl
        WHERE pl.status = 'SELLABLE' AND pl.trace_code IS NOT NULL
        ORDER BY pl.id LIMIT 1`,
    );
    traceCode = lot ? String(lot.trace_code) : null;
  }
  return { productId, traceCode };
}

function buildScenarios(fixtures) {
  const scenarios = [
    { name: 'products-list', weight: 35, path: `${API_PREFIX}/products?page=1&limit=12` },
    { name: 'product-detail', weight: 35, path: `${API_PREFIX}/products/${fixtures.productId}` },
    { name: 'orders-me', weight: 20, path: `${API_PREFIX}/orders/me?page=1&limit=10`, auth: true },
    { name: 'carts-me', weight: 10, path: `${API_PREFIX}/carts/me`, auth: true },
  ];
  if (fixtures.traceCode) {
    scenarios.push({
      name: 'trace-public',
      weight: 15,
      path: `${API_PREFIX}/trace/${encodeURIComponent(fixtures.traceCode)}`,
    });
  }
  return scenarios;
}

function printReport(result) {
  const rows = result.scenarios.map((scenario) => [
    scenario.name,
    String(scenario.samples),
    `${scenario.rps}`,
    `${scenario.latency.p50}`,
    `${scenario.latency.p95}`,
    `${scenario.latency.p99}`,
    `${scenario.errors}`,
  ]);
  const header = ['scenario', 'requests', 'rps', 'p50', 'p95', 'p99', 'errors'];
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');

  console.log(line(header));
  for (const row of rows) console.log(line(row));
  console.log('');
  console.log(
    `total ${result.totals.requests} requests, ${result.totals.rps} rps, ` +
      `errors ${result.totals.errors} (${(result.totals.errorRate * 100).toFixed(2)}%)`,
  );
  console.log(
    `latency p50 ${result.totals.latency.p50} ms, p95 ${result.totals.latency.p95} ms, ` +
      `p99 ${result.totals.latency.p99} ms, max ${result.totals.latency.max} ms`,
  );
}

async function runLoadTest(options) {
  const startedAt = nowIso();
  const parsed = options.databaseUrl ? assertRunDatabase(options.databaseUrl, '--url') : null;
  const baseUrl = options.baseUrl;
  const api = `${baseUrl}${API_PREFIX}`;
  const outDir = ensureDir(options.outDir ?? join(ROOT, '.tmp-verify', 'c19', 'load-test'));
  const logsDir = ensureDir(options.logDir ?? join(outDir, 'logs'));
  const logFile = join(logsDir, `api-${Date.now().toString(36)}.log`);

  const result = {
    generatedAt: startedAt,
    mode: parsed ? 'spawn' : 'external',
    baseUrl,
    database: parsed ? databaseLabel(parsed) : null,
    databaseUrl: parsed ? redactUrl(options.databaseUrl) : null,
    concurrency: options.concurrency,
    durationSeconds: options.durationSeconds,
    warmupSeconds: options.warmupSeconds,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    thresholds: {
      maxP99Ms: options.maxP99,
      maxErrorRate: options.maxErrorRate,
    },
    result: 'FAIL',
  };

  let server = null;
  try {
    if (parsed) {
      if (!(await portIsFree(options.port))) {
        throw new Error(`Port ${options.port} is already in use; choose another --port.`);
      }
      server = startProcess({
        name: `api (load test) on ${options.port}`,
        command: process.execPath,
        args: [join(API_DIR, 'dist', 'src', 'main.js')],
        cwd: API_DIR,
        env: {
          DATABASE_URL: options.databaseUrl,
          PORT: String(options.port),
          NODE_ENV: 'test',
          JWT_SECRET: process.env.JWT_SECRET,
          JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1h',
          MAIL_TRANSPORT: 'test',
          CORS_ORIGIN: 'http://127.0.0.1:3111',
        },
        logFile,
      });
    }

    await waitForHttp(`${api}/health`, { timeoutMs: 90_000 });
    const token = await login(api);
    const fixtures = await resolveFixtures(api, parsed);
    const scenarios = buildScenarios(fixtures);
    const totalWeight = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);

    result.fixtures = {
      productId: fixtures.productId,
      traceCode: fixtures.traceCode,
      hasCustomerToken: true,
    };
    result.scenarioPaths = scenarios.map(({ name, weight, path }) => ({ name, weight, path }));

    const client = createClient(baseUrl, token, options.requestTimeoutMs);
    try {
      await runPhase({
        client,
        scenarios,
        totalWeight,
        concurrency: options.concurrency,
        durationMs: options.warmupSeconds * 1000,
        collect: false,
        stats: emptyStats(scenarios),
      });
      const stats = emptyStats(scenarios);
      const measuredAt = Date.now();
      await runPhase({
        client,
        scenarios,
        totalWeight,
        concurrency: options.concurrency,
        durationMs: options.durationSeconds * 1000,
        collect: true,
        stats,
      });
      result.measuredDurationMs = Date.now() - measuredAt;
      Object.assign(result, summarize(stats, scenarios, result.measuredDurationMs));
    } finally {
      client.close();
    }

    const p99 = result.totals.latency.p99;
    const checks = [
      {
        name: 'sample-size',
        ok: result.totals.requests >= 100,
        detail: `${result.totals.requests} requests (minimum 100)`,
      },
      {
        name: 'error-rate',
        ok: result.totals.errorRate <= options.maxErrorRate,
        detail: `${(result.totals.errorRate * 100).toFixed(2)}% (limit ${(options.maxErrorRate * 100).toFixed(2)}%)`,
      },
      {
        name: 'p99-latency',
        ok: p99 <= options.maxP99,
        detail: `${p99} ms (limit ${options.maxP99} ms)`,
      },
    ];
    result.checks = checks;
    result.failures = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
    result.result = result.failures.length === 0 ? 'PASS' : 'FAIL';
  } catch (error) {
    result.error = redactText(error.message);
    result.failures = [result.error];
  } finally {
    if (server) {
      result.apiExit = await server.stop();
      try {
        result.apiLogTail = tail(readFileSync(logFile, 'utf8'), 30);
      } catch {
        result.apiLogTail = '';
      }
    }
    result.logFile = parsed ? logFile : undefined;
    result.completedAt = nowIso();
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }
  loadProjectEnv();

  const databaseUrl = valueOf(args, '--url') ?? (valueOf(args, '--base-url') ? null : process.env.VERIFY_DATABASE_URL);
  const externalBase = valueOf(args, '--base-url');
  if (!databaseUrl && !externalBase) throw new Error('--url (or --base-url) is required.');

  let baseUrl = externalBase ? externalBase.replace(/\/+$/, '') : null;
  let port = null;
  if (databaseUrl) {
    if (!existsSync(join(API_DIR, 'dist', 'src', 'main.js'))) {
      throw new Error('apps/api/dist/src/main.js is missing; run `npm run build` first.');
    }
    port = Number(valueOf(args, '--port', '3110'));
    baseUrl = `http://127.0.0.1:${port}`;
  } else {
    const host = new URL(baseUrl).hostname;
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!loopback && !args.includes('--allow-external')) {
      throw new Error(
        `--base-url ${baseUrl} is not loopback; a load test against a shared environment ` +
          'needs --allow-external.',
      );
    }
  }

  const result = await runLoadTest({
    databaseUrl,
    baseUrl,
    port,
    concurrency: numberArg(args, '--concurrency', 20),
    durationSeconds: numberArg(args, '--duration', 30),
    warmupSeconds: numberArg(args, '--warmup', 5),
    requestTimeoutMs: numberArg(args, '--request-timeout', 10_000),
    maxP99: numberArg(args, '--max-p99', 2000),
    maxErrorRate: numberArg(args, '--max-error-rate', 0.01),
    outDir: valueOf(args, '--out-dir', undefined),
    logDir: valueOf(args, '--log-dir', undefined),
  });

  const out = valueOf(args, '--out');
  if (out) writeJson(out, result);

  if (result.totals) printReport(result);
  for (const check of result.checks ?? []) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} - ${check.detail}`);
  }
  console.log(`Load test: ${result.result}`);
  if (result.result !== 'PASS') {
    for (const failure of result.failures ?? []) console.error(`  - ${failure}`);
    if (result.apiLogTail) console.error(`\nAPI log tail:\n${result.apiLogTail}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`Load test failed: ${redactText(error.message)}`);
    process.exit(1);
  });
}
