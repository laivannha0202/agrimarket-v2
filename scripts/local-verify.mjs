#!/usr/bin/env node
/**
 * C-19 one-command local release verification.
 *
 * Runs the complete gate on THIS machine only, against a run-specific throwaway
 * MySQL schema:
 *
 *   preflight -> prisma generate -> typecheck -> lint -> unit tests -> build
 *   -> create/migrate/seed schema -> migration+checksum+drift audit
 *   -> DB invariants -> backup/restore drill -> API E2E
 *   -> concurrency stress -> business smoke -> invariants after smoke
 *   -> security scan -> Admin/Customer UI smoke -> checksummed evidence
 *   -> drop the run schema (unless --keep-db)
 *
 * Safety:
 *   - the schema is newly created and named `agrimarket_v2_c19_<token>_test`;
 *   - `DATABASE_URL` (the application schema) is never a target;
 *   - `NODE_ENV=production` aborts before any step;
 *   - no push, GitHub Action, deployment, merge or commit is performed;
 *   - the run schema is dropped at the end unless `--keep-db` or `--reuse-db`.
 *
 * Every step is logged separately under the run's evidence directory. The run
 * writes `summary.json`, `README.txt`, `manifest.json` and `SHA256SUMS.txt`,
 * and exits non-zero if any selected step failed.
 *
 *   node scripts/local-verify.mjs [options]
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  API_DIR,
  EVIDENCE_ROOT,
  ROOT,
  assertRunDatabase,
  createDatabase,
  databaseLabel,
  dropDatabase,
  ensureDir,
  loadProjectEnv,
  manifestDirectory,
  nowIso,
  npmBinary,
  parseDatabaseUrl,
  portIsFree,
  queryRows,
  redactText,
  redactUrl,
  resolveMysqlBinary,
  runCommand,
  runNpm,
  tail,
  timestampToken,
  withAdminConnection,
  writeJson,
} from './lib/verify-common.mjs';

const ADMIN_DIR = join(ROOT, 'apps', 'admin-web');
const CUSTOMER_DIR = join(ROOT, 'apps', 'customer-web');
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const API_UI_BASE = 'http://127.0.0.1:3100/api/v1';

const STEP_ORDER = [
  'preflight',
  'generate',
  'typecheck',
  'lint',
  'unit',
  'build',
  'db-create',
  'db-migrate',
  'db-seed',
  'db-locations',
  'migrations',
  'invariants',
  'backup',
  'api-e2e',
  'stress',
  'business-smoke',
  'invariants-final',
  'security',
  'ui-smoke',
];

const DB_STEPS = new Set(['db-create', 'db-migrate', 'db-seed', 'db-locations']);

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function listOf(args, flag) {
  const value = valueOf(args, flag, null);
  if (!value) return null;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendLog(logFile, text) {
  appendFileSync(logFile, `${redactText(text)}\n`);
}

function commandDetail(result, label) {
  return `${label}: exit ${result.code} in ${result.durationMs} ms`;
}

async function runStepCommand(ctx, logFile, label, runner, { allowFailure = false } = {}) {
  appendLog(logFile, `\n$ ${label}`);
  const result = await runner();
  ctx.commands.push({
    label,
    command: result.command,
    exitCode: result.code,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    log: relative(ctx.outDir, logFile).split('\\').join('/'),
  });
  if (result.code !== 0 && !allowFailure) {
    const output = tail(result.stderr || result.stdout, 30);
    throw new Error(`${label} exited ${result.code}${result.timedOut ? ' (timeout)' : ''}\n${output}`);
  }
  return result;
}

function npmEnv(ctx, extra = {}) {
  return {
    DATABASE_URL: ctx.appUrl,
    NODE_ENV: 'test',
    NEXT_TELEMETRY_DISABLED: '1',
    ...extra,
  };
}

function nodeScript(ctx, logFile, label, script, args = [], extraEnv = {}) {
  return runStepCommand(
    ctx,
    logFile,
    label,
    () =>
      runCommand(process.execPath, [join(ROOT, 'scripts', script), ...args], {
        cwd: ROOT,
        env: npmEnv(ctx, extraEnv),
        logFile,
        timeoutMs: 30 * 60_000,
        displayName: label,
      }),
  );
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function gitInfo() {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const status = run(['status', '--porcelain']);
  return {
    head: run(['rev-parse', 'HEAD']),
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirtyFiles: status ? status.split(/\r?\n/).filter(Boolean).length : null,
  };
}

function npmVersion() {
  const npm = npmBinary();
  const result = spawnSync(npm.command, [...npm.prefixArgs, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: npm.shell,
  });
  return result.status === 0 ? result.stdout.trim() : null;
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

async function preflight(ctx, logFile) {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail: redactText(String(detail)) });
    if (!ok) throw new Error(`preflight ${name}: ${detail}`);
  };

  check('node-version', Number(process.versions.node.split('.')[0]) >= 20, process.version);
  check('app-database-configured', Boolean(ctx.appParsed), databaseLabel(ctx.appParsed));
  check('run-database-isolated', ctx.runParsed.database !== ctx.appParsed.database, ctx.runDatabase);
  check('run-database-name-length', ctx.runDatabase.length <= 63, `${ctx.runDatabase.length} chars`);
  check('prisma-cli', existsSync(join(ROOT, 'node_modules', 'prisma', 'build', 'index.js')), 'prisma CLI present');
  check('next-cli', existsSync(NEXT_BIN), 'Next.js CLI present');
  check('admin-workspace', existsSync(join(ADMIN_DIR, 'package.json')), ADMIN_DIR);
  check('customer-workspace', existsSync(join(CUSTOMER_DIR, 'package.json')), CUSTOMER_DIR);
  check('migrations-present', existsSync(join(API_DIR, 'prisma', 'migrations')), 'prisma/migrations');

  const mysql = resolveMysqlBinary('mysql');
  const mysqldump = resolveMysqlBinary('mysqldump');
  check('mysql-client', Boolean(mysql), mysql ?? 'mysql not found; set MYSQL_PATH');
  check('mysqldump-client', Boolean(mysqldump), mysqldump ?? 'mysqldump not found; set MYSQLDUMP_PATH');

  for (const port of [3100, 3101, 3102]) {
    check(`port-${port}-free`, await portIsFree(port), 'loopback port is available');
  }

  const server = await withAdminConnection(ctx.runParsed, async (connection) => {
    const [rows] = await connection.query('SELECT VERSION() AS version');
    return rows[0]?.version ?? null;
  });
  check('mysql-server', Boolean(server), `MySQL ${server ?? 'unknown'}`);

  const migrations = readdirSync(join(API_DIR, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  check('migration-count', migrations.length > 0, `${migrations.length} local migration(s)`);

  const playwright = playwrightStatus();
  if (!playwright.available) {
    ctx.warnings.push(
      'Playwright is not installed; the UI gate is HTTP-level route/asset smoke only, ' +
        'not browser interaction.',
    );
  }

  ctx.environment = {
    ...gitInfo(),
    node: process.version,
    npm: npmVersion(),
    platform: `${process.platform} ${process.arch}`,
    mysql: server,
    mysqlBinaries: { mysql, mysqldump },
    playwright,
    migrations: migrations.length,
  };
  return `${checks.length} preflight checks; MySQL ${server}; ${migrations.length} migrations; Playwright ${
    playwright.available ? 'available' : 'unavailable (recorded limitation)'
  }`;
}

async function generate(ctx, logFile) {
  await runStepCommand(ctx, logFile, 'npm run db:generate', () =>
    runNpm(['run', 'db:generate'], {
      cwd: ROOT,
      env: npmEnv(ctx),
      logFile,
      timeoutMs: 10 * 60_000,
    }),
  );
  return 'Prisma client generated';
}

async function typecheck(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run typecheck', () =>
    runNpm(['run', 'typecheck'], {
      cwd: ROOT,
      env: npmEnv(ctx),
      logFile,
      timeoutMs: 20 * 60_000,
    }),
  );
  return `all workspaces typechecked in ${result.durationMs} ms`;
}

async function lint(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run lint', () =>
    runNpm(['run', 'lint'], {
      cwd: ROOT,
      env: npmEnv(ctx),
      logFile,
      timeoutMs: 20 * 60_000,
    }),
  );
  return `all workspaces linted in ${result.durationMs} ms`;
}

async function unit(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm test (all workspaces)', () =>
    runNpm(['test'], {
      cwd: ROOT,
      env: npmEnv(ctx, { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '' }),
      logFile,
      timeoutMs: 40 * 60_000,
    }),
  );
  return `unit/component tests passed in ${result.durationMs} ms`;
}

async function build(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run build (NEXT_PUBLIC_API_BASE_URL)', () =>
    runNpm(['run', 'build'], {
      cwd: ROOT,
      env: npmEnv(ctx, {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_BASE_URL: API_UI_BASE,
        NEXT_TELEMETRY_DISABLED: '1',
      }),
      logFile,
      timeoutMs: 60 * 60_000,
    }),
  );
  for (const file of [
    join(API_DIR, 'dist', 'src', 'main.js'),
    join(ADMIN_DIR, '.next', 'BUILD_ID'),
    join(CUSTOMER_DIR, '.next', 'BUILD_ID'),
  ]) {
    if (!existsSync(file)) throw new Error(`Build artifact missing: ${file}`);
  }
  return `API + Admin + Customer built in ${result.durationMs} ms`;
}

async function dbCreate(ctx, logFile) {
  appendLog(logFile, `Dropping any leftover ${ctx.runDatabase} and creating it fresh.`);
  await dropDatabase(ctx.runParsed, ctx.runDatabase);
  await createDatabase(ctx.runParsed, ctx.runDatabase);
  const [{ tables }] = await queryRows(
    ctx.runParsed,
    `SELECT COUNT(*) AS tables FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [ctx.runDatabase],
    'information_schema',
  );
  if (Number(tables) !== 0) throw new Error(`New schema already has ${tables} table(s).`);
  return `${ctx.runDatabase} created (0 tables)`;
}

async function dbMigrate(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run db:deploy', () =>
    runNpm(['run', 'db:deploy', '--workspace', '@agrimarket/api'], {
      cwd: ROOT,
      env: npmEnv(ctx, { DATABASE_URL: ctx.runUrl }),
      logFile,
      timeoutMs: 20 * 60_000,
    }),
  );
  const [row] = await queryRows(
    ctx.runParsed,
    'SELECT COUNT(*) AS applied FROM _prisma_migrations',
  );
  return `${row?.applied ?? 0} migration(s) applied in ${result.durationMs} ms`;
}

async function dbSeed(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run db:seed', () =>
    runNpm(['run', 'db:seed', '--workspace', '@agrimarket/api'], {
      cwd: ROOT,
      env: npmEnv(ctx, { DATABASE_URL: ctx.runUrl }),
      logFile,
      timeoutMs: 30 * 60_000,
    }),
  );
  const [row] = await queryRows(
    ctx.runParsed,
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM products) AS products,
       (SELECT COUNT(*) FROM product_lots WHERE status = 'SELLABLE') AS sellable_lots,
       (SELECT COUNT(*) FROM orders) AS orders`,
  );
  if (!row || Number(row.users) === 0 || Number(row.sellable_lots) === 0) {
    throw new Error('Seed finished but the expected demo rows are missing.');
  }
  return `seeded ${row.users} users, ${row.products} products, ${row.sellable_lots} sellable lots, ${row.orders} orders in ${result.durationMs} ms`;
}

async function dbLocations(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run db:import-wards', () =>
    runNpm(['run', 'db:import-wards', '--workspace', '@agrimarket/api'], {
      cwd: ROOT,
      env: npmEnv(ctx, { DATABASE_URL: ctx.runUrl }),
      logFile,
      timeoutMs: 15 * 60_000,
    }),
  );
  const [row] = await queryRows(
    ctx.runParsed,
    `SELECT
       (SELECT COUNT(*) FROM provinces) AS provinces,
       (SELECT COUNT(*) FROM wards) AS wards`,
  );
  if (!row || Number(row.provinces) === 0 || Number(row.wards) === 0) {
    throw new Error('The official location catalogue did not import any province/ward rows.');
  }
  return `${row.provinces} province(s), ${row.wards} ward(s) imported in ${result.durationMs} ms`;
}

async function migrations(ctx, logFile) {
  const out = join(ctx.outDir, 'migrations.json');
  await nodeScript(ctx, logFile, 'verify-migrations.mjs', 'verify-migrations.mjs', [
    '--url',
    ctx.runUrl,
    '--out',
    out,
    '--schema-token',
    ctx.token,
  ]);
  const report = readJsonFile(out);
  if (!report) throw new Error('Migration report was not written.');
  if (report.result !== 'PASS') throw new Error(`Migration verification: ${report.result}`);
  return `${report.migrations.count} migrations, checksums verified, drift exit ${report.drift?.exitCode ?? '?'}`;
}

async function invariants(ctx, logFile, phase) {
  const out = join(ctx.outDir, phase === 'final' ? 'invariants-final.json' : 'invariants.json');
  await nodeScript(ctx, logFile, `db-invariant-audit.mjs (${phase})`, 'db-invariant-audit.mjs', [
    '--url',
    ctx.runUrl,
    '--out',
    out,
  ]);
  const report = readJsonFile(out);
  if (!report) throw new Error('Invariant report was not written.');
  return `${report.checks.length} invariant checks, trace coverage ${
    report.traceCoverage?.sellableLots ?? '?'
  } sellable lot(s)`;
}

async function backup(ctx, logFile) {
  const out = join(ctx.outDir, 'backup-restore.json');
  await nodeScript(ctx, logFile, 'backup-restore-drill.mjs', 'backup-restore-drill.mjs', [
    '--url',
    ctx.runUrl,
    '--out-dir',
    join(ctx.outDir, 'backup-restore'),
    '--json-out',
    out,
  ]);
  const report = readJsonFile(out);
  if (!report) throw new Error('Backup/restore report was not written.');
  if (report.result !== 'PASS') throw new Error(`Backup/restore drill: ${report.result}`);
  return `${report.tableCount} tables / ${report.sourceRows} rows; dump ${report.backup?.bytes ?? '?'} bytes, sha256 verified, restored copy matched`;
}

async function apiE2e(ctx, logFile) {
  const result = await runStepCommand(ctx, logFile, 'npm run test:e2e (API)', () =>
    runNpm(['run', 'test:e2e', '--workspace', '@agrimarket/api'], {
      cwd: ROOT,
      env: npmEnv(ctx, {
        DATABASE_URL: ctx.appUrl,
        TEST_DATABASE_URL: ctx.runUrl,
        VERIFY_DATABASE_URL: ctx.runUrl,
      }),
      logFile,
      timeoutMs: 60 * 60_000,
    }),
  );
  return `API E2E passed in ${result.durationMs} ms against ${ctx.runDatabase}`;
}

async function stress(ctx, logFile) {
  const result = await runStepCommand(
    ctx,
    logFile,
    `concurrency e2e (${ctx.rounds} rounds)`,
    () =>
      runNpm(
        [
          'run',
          'test:e2e',
          '--workspace',
          '@agrimarket/api',
          '--',
          'test/concurrency.e2e-spec.ts',
          'test/concurrency-money.e2e-spec.ts',
        ],
        {
          cwd: ROOT,
          env: npmEnv(ctx, {
            DATABASE_URL: ctx.appUrl,
            TEST_DATABASE_URL: ctx.runUrl,
            VERIFY_DATABASE_URL: ctx.runUrl,
            CONCURRENCY_ROUNDS: String(ctx.rounds),
          }),
          logFile,
          timeoutMs: 60 * 60_000,
        },
      ),
  );
  return `concurrency suites passed in ${result.durationMs} ms (CONCURRENCY_ROUNDS=${ctx.rounds})`;
}

async function businessSmoke(ctx, logFile) {
  const out = join(ctx.outDir, 'business-smoke.json');
  const args = [
    '--url',
    ctx.runUrl,
    '--port',
    '3100',
    '--out',
    out,
    '--out-dir',
    join(ctx.outDir, 'business-smoke'),
  ];
  if (ctx.noCheckout) args.push('--no-checkout');
  await nodeScript(ctx, logFile, 'business-smoke.mjs', 'business-smoke.mjs', args);
  const report = readJsonFile(out);
  if (!report) throw new Error('Business smoke report was not written.');
  if (report.result !== 'PASS') throw new Error(`Business smoke: ${report.result}`);
  return `${report.checks.length} HTTP/business checks passed; ${
    report.skipped.length ? `${report.skipped.length} skipped; ` : ''
  }${report.warnings.length} warning(s)`;
}

async function security(ctx, logFile) {
  const out = join(ctx.outDir, 'security-scan.json');
  const args = ['--out', out, '--log-dir', join(ctx.outDir, 'security', 'logs')];
  if (ctx.skipAudit) args.push('--skip-audit');
  await nodeScript(ctx, logFile, 'security-scan.mjs', 'security-scan.mjs', args);
  const report = readJsonFile(out);
  if (!report) throw new Error('Security report was not written.');
  if (report.result !== 'PASS') throw new Error(`Security scan: ${report.result}`);
  return `${report.checks.length} security checks; npm audit ${report.audit?.status ?? '?'}; ${report.findings.length} secret finding(s)`;
}

async function uiSmoke(ctx, logFile) {
  const out = join(ctx.outDir, 'ui-smoke.json');
  await nodeScript(
    ctx,
    logFile,
    'ui-smoke.mjs',
    'ui-smoke.mjs',
    ['--url', ctx.runUrl, '--out', out, '--out-dir', join(ctx.outDir, 'ui-smoke')],
    { JWT_SECRET: process.env.JWT_SECRET, JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1h' },
  );
  const report = readJsonFile(out);
  if (!report) throw new Error('UI smoke report was not written.');
  if (report.result !== 'PASS') throw new Error(`UI smoke: ${report.result}`);
  return `${report.checks.length} route/asset checks passed; Playwright ${
    report.playwright?.available ? 'available' : 'unavailable (recorded limitation)'
  }`;
}

const RUNNERS = {
  preflight,
  generate,
  typecheck,
  lint,
  unit,
  build,
  'db-create': dbCreate,
  'db-migrate': dbMigrate,
  'db-seed': dbSeed,
  'db-locations': dbLocations,
  migrations,
  invariants: (ctx, logFile) => invariants(ctx, logFile, 'seed'),
  backup,
  'api-e2e': apiE2e,
  stress,
  'business-smoke': businessSmoke,
  'invariants-final': (ctx, logFile) => invariants(ctx, logFile, 'final'),
  security,
  'ui-smoke': uiSmoke,
};

const STEP_TITLES = {
  preflight: 'Environment, isolation and tool preflight',
  generate: 'Generate Prisma client',
  typecheck: 'Typecheck every workspace',
  lint: 'Lint every workspace',
  unit: 'Unit/component tests (API, Admin, Customer, Mobile, Shared)',
  build: 'Production build (API, Admin, Customer)',
  'db-create': 'Create the disposable run schema',
  'db-migrate': 'Apply every migration to the run schema',
  'db-seed': 'Seed demo data into the run schema',
  'db-locations': 'Import the official province/ward catalogue',
  migrations: 'Migration ledger, checksums and history drift',
  invariants: 'Database invariants on the seeded schema',
  backup: 'Backup + restore drill into a disposable schema',
  'api-e2e': 'API end-to-end acceptance suites',
  stress: 'Concurrency stress (orders, inventory, money)',
  'business-smoke': 'Business HTTP smoke (RBAC, trace, checkout, Mobile API)',
  'invariants-final': 'Database invariants after E2E and smoke',
  security: 'Security guardrails, secret scan and dependency audit',
  'ui-smoke': 'Admin/Customer built-app route and asset smoke',
};

async function executeStep(ctx, id, index) {
  const logFile = join(ctx.logsDir, `${String(index).padStart(2, '0')}-${id}.log`);
  ensureDir(ctx.logsDir);
  writeFileSync(
    logFile,
    `# ${STEP_TITLES[id]}\n# started ${nowIso()}\n# database ${databaseLabel(ctx.runParsed)}\n`,
  );
  const startedAt = nowIso();
  const started = Date.now();
  const step = {
    id,
    title: STEP_TITLES[id],
    status: 'RUNNING',
    startedAt,
    durationMs: 0,
    log: relative(ctx.outDir, logFile).split('\\').join('/'),
  };
  ctx.steps.push(step);

  console.log(`\n== ${id}: ${STEP_TITLES[id]} ==`);
  try {
    const detail = await RUNNERS[id](ctx, logFile);
    step.status = 'PASS';
    step.detail = redactText(String(detail ?? ''));
    console.log(`PASS ${id} — ${step.detail}`);
  } catch (error) {
    const message = redactText(error.message);
    step.status = 'FAIL';
    step.detail = message;
    step.error = message;
    ctx.failures.push(`${id}: ${message}`);
    appendLog(logFile, `\n[step failed] ${message}`);
    console.error(`FAIL ${id} — ${message}`);
    if (!ctx.keepGoing) throw new StepAbort();
  } finally {
    step.completedAt = nowIso();
    step.durationMs = Date.now() - started;
    appendLog(logFile, `\n# ${step.status} in ${step.durationMs} ms`);
  }
  return step;
}

class StepAbort extends Error {}

async function cleanup(ctx) {
  const step = {
    id: 'cleanup',
    title: 'Drop the disposable run schema',
    status: 'SKIPPED',
    startedAt: nowIso(),
  };
  ctx.steps.push(step);
  console.log('\n== cleanup ==');
  if (ctx.reuseDb) {
    step.detail = `Reused schema ${ctx.runDatabase} was left untouched.`;
    console.log(`SKIP cleanup — ${step.detail}`);
  } else if (ctx.keepDb) {
    step.detail = `Schema ${ctx.runDatabase} kept by --keep-db.`;
    ctx.warnings.push(step.detail);
    console.log(`SKIP cleanup — ${step.detail}`);
  } else if (!ctx.runCreated) {
    step.detail = 'Run schema was never created.';
    console.log(`SKIP cleanup — ${step.detail}`);
  } else {
    try {
      await dropDatabase(ctx.runParsed, ctx.runDatabase);
      ctx.databaseDropped = true;
      step.status = 'PASS';
      step.detail = `Dropped ${ctx.runDatabase}.`;
      console.log(`PASS cleanup — ${step.detail}`);
    } catch (error) {
      step.status = 'FAIL';
      step.detail = redactText(`Could not drop ${ctx.runDatabase}: ${error.message}`);
      ctx.failures.push(`cleanup: ${step.detail}`);
      console.error(`FAIL cleanup — ${step.detail}`);
    }
  }
  step.completedAt = nowIso();
  step.durationMs = step.startedAt ? Date.now() - Date.parse(step.startedAt) : 0;
}

async function finalize(ctx) {
  const failed = ctx.steps.filter((step) => step.status === 'FAIL');
  const passed = ctx.steps.filter((step) => step.status === 'PASS');
  const skipped = ctx.steps.filter((step) => step.status === 'SKIPPED');
  const result = failed.length === 0 ? 'PASS' : 'FAIL';

  const summary = {
    generatedAt: nowIso(),
    result,
    runId: ctx.token,
    database: databaseLabel(ctx.runParsed),
    databaseUrl: redactUrl(ctx.runUrl),
    applicationDatabase: databaseLabel(ctx.appParsed),
    applicationDatabaseUrl: redactUrl(ctx.appUrl),
    databaseDropped: ctx.databaseDropped,
    options: {
      only: ctx.only,
      skip: ctx.skip,
      keepGoing: ctx.keepGoing,
      keepDb: ctx.keepDb,
      reuseDb: ctx.reuseDb,
      noCheckout: ctx.noCheckout,
      skipAudit: ctx.skipAudit,
      rounds: ctx.rounds,
    },
    environment: ctx.environment,
    totals: {
      selected: ctx.selectedSteps.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
    },
    steps: [...ctx.steps].sort((a, b) => {
      const left = STEP_ORDER.indexOf(a.id);
      const right = STEP_ORDER.indexOf(b.id);
      return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    }),
    commands: ctx.commands,
    warnings: ctx.warnings,
    failures: ctx.failures,
    logs: relative(ROOT, ctx.outDir).split('\\').join('/'),
  };

  writeJson(join(ctx.outDir, 'summary.json'), summary);
  writeFileSync(
    join(ctx.outDir, 'README.txt'),
    [
      'AgriMarket C-19 local verification evidence',
      `Run: ${ctx.token}`,
      `Result: ${result}`,
      `Database: ${databaseLabel(ctx.runParsed)} (dropped: ${summary.databaseDropped})`,
      `Application database (never written): ${databaseLabel(ctx.appParsed)}`,
      '',
      'Start with summary.json. Per-step logs are in logs/. JSON reports from the',
      'migration, invariant, backup, business, security and UI gates are in this',
      'directory. manifest.json and SHA256SUMS.txt cover every evidence file.',
      '',
      'This run did not push, deploy, merge, commit or change GitHub settings.',
      '',
    ].join('\n'),
  );

  const files = await manifestDirectory(ctx.outDir);
  const manifest = {
    generatedAt: nowIso(),
    runId: ctx.token,
    result,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  writeJson(join(ctx.outDir, 'manifest.json'), manifest);
  const sums = files
    .map((file) => `${file.sha256}  ${file.path}`)
    .join('\n');
  writeFileSync(join(ctx.outDir, 'SHA256SUMS.txt'), `${sums}\n`);

  return { summary, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/local-verify.mjs [options]

Options:
  --only <ids>          Comma-separated steps to run (default: all)
  --skip <ids>          Comma-separated steps to skip
  --keep-going          Continue after a failed step (default: stop)
  --keep-db             Keep the disposable run schema after the run
  --reuse-db <url>      Reuse an existing isolated seeded schema
  --no-checkout         Business smoke is read-only (no cart/order mutation)
  --skip-audit          Skip the network npm audit (recorded as warning)
  --rounds <n>          Concurrency rounds for the stress step (default: 10)
  --out-dir <dir>       Evidence directory (default: .tmp-verify/c19/local-<token>)
  --help                Show this help

Step ids:
  ${STEP_ORDER.join(', ')}

Examples:
  npm run verify:local
  node scripts/local-verify.mjs --skip lint,unit
  node scripts/local-verify.mjs --keep-going --skip-audit
  node scripts/local-verify.mjs --reuse-db <isolated-url> --only business-smoke,ui-smoke

The run creates agrimarket_v2_c19_<token>_test, never writes DATABASE_URL,
and drops the schema at the end unless --keep-db/--reuse-db is used.`);
    process.exit(0);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing local verification while NODE_ENV=production.');
  }
  loadProjectEnv();
  const appUrl = process.env.DATABASE_URL?.trim();
  if (!appUrl) throw new Error('DATABASE_URL is not configured in the environment or .env.');
  const appParsed = parseDatabaseUrl(appUrl);
  if (!appParsed) throw new Error('DATABASE_URL is not a parseable MySQL URL.');

  const reuseDb = valueOf(args, '--reuse-db');
  const token =
    timestampToken().toLowerCase().replace(/[^a-z0-9]/g, '') +
    Math.random().toString(36).slice(2, 6);
  const runDatabase = reuseDb
    ? assertRunDatabase(reuseDb, '--reuse-db').database
    : `agrimarket_v2_c19_${token}_test`;
  const runUrl = reuseDb
    ? reuseDb
    : (() => {
        const url = new URL(appUrl);
        url.pathname = `/${runDatabase}`;
        return url.toString();
      })();
  const runParsed = assertRunDatabase(runUrl, reuseDb ? '--reuse-db' : 'run database');
  if (runParsed.database === appParsed.database) {
    throw new Error('The run schema aliases DATABASE_URL; refusing to continue.');
  }

  const outDir = ensureDir(
    valueOf(args, '--out-dir', join(EVIDENCE_ROOT, `local-${token}`)),
  );
  const logsDir = ensureDir(join(outDir, 'logs'));
  const rounds = Number(valueOf(args, '--rounds', '10'));
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) {
    throw new Error('--rounds must be an integer between 1 and 100.');
  }

  const ctx = {
    token,
    appUrl,
    appParsed,
    runUrl,
    runParsed,
    runDatabase,
    runCreated: false,
    databaseDropped: false,
    outDir,
    logsDir,
    steps: [],
    commands: [],
    failures: [],
    warnings: [],
    environment: null,
    only: listOf(args, '--only'),
    skip: listOf(args, '--skip'),
    keepGoing: args.includes('--keep-going'),
    keepDb: args.includes('--keep-db'),
    reuseDb: Boolean(reuseDb),
    noCheckout: args.includes('--no-checkout'),
    skipAudit: args.includes('--skip-audit'),
    rounds,
    selectedSteps: [],
  };

  const unknown = [...(ctx.only ?? []), ...(ctx.skip ?? [])].filter(
    (id) => !STEP_ORDER.includes(id),
  );
  if (unknown.length > 0) throw new Error(`Unknown step id(s): ${unknown.join(', ')}`);

  ctx.selectedSteps = STEP_ORDER.filter((id) => {
    if (ctx.only && !ctx.only.includes(id)) return false;
    if (ctx.skip?.includes(id)) return false;
    if (ctx.reuseDb && DB_STEPS.has(id)) return false;
    return true;
  });
  if (ctx.selectedSteps.length === 0) throw new Error('No steps selected.');

  console.log('AgriMarket C-19 local verification');
  console.log(`  run:       ${token}`);
  console.log(`  app DB:    ${databaseLabel(appParsed)} (never written)`);
  console.log(`  run DB:    ${databaseLabel(runParsed)}${reuseDb ? ' (reused)' : ''}`);
  console.log(`  evidence:  ${outDir}`);
  console.log(`  steps:     ${ctx.selectedSteps.join(', ')}`);

  for (const id of STEP_ORDER) {
    if (!ctx.selectedSteps.includes(id)) {
      ctx.steps.push({
        id,
        title: STEP_TITLES[id],
        status: 'SKIPPED',
        detail: ctx.reuseDb && DB_STEPS.has(id) ? 'Skipped by --reuse-db.' : 'Not selected.',
        startedAt: nowIso(),
        durationMs: 0,
      });
    }
  }

  let aborted = false;
  for (const [index, id] of ctx.selectedSteps.entries()) {
    if (aborted) {
      ctx.steps.push({
        id,
        title: STEP_TITLES[id],
        status: 'SKIPPED',
        detail: 'Not run: an earlier step failed.',
        startedAt: nowIso(),
        durationMs: 0,
      });
      continue;
    }
    if (id === 'db-create') ctx.runCreated = true;
    try {
      await executeStep(ctx, id, index + 1);
      if (id === 'db-create') ctx.runCreated = true;
    } catch (error) {
      if (error instanceof StepAbort) {
        aborted = true;
        continue;
      }
      throw error;
    }
  }

  await cleanup(ctx);
  const { summary } = await finalize(ctx);

  console.log(`\nC-19 local verification: ${summary.result}`);
  console.log(
    `  ${summary.totals.passed} passed, ${summary.totals.failed} failed, ` +
      `${summary.totals.skipped} skipped`,
  );
  console.log(`  evidence: ${outDir}`);
  if (summary.warnings.length > 0) {
    for (const warning of summary.warnings) console.log(`  WARN  ${warning}`);
  }
  if (summary.failures.length > 0) {
    for (const failure of summary.failures) console.error(`  FAIL  ${failure}`);
  }
  process.exit(summary.result === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(`Local verification failed to start: ${redactText(error.message)}`);
  process.exit(1);
});
