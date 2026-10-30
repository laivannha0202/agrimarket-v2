#!/usr/bin/env node
/**
 * C-19 migration verification.
 *
 * Proves, against ONE isolated schema, that:
 *   1. every local migration folder is recorded as applied exactly once;
 *   2. no extra or rolled-back migration is recorded;
 *   3. each recorded Prisma checksum matches the SHA-256 of its `migration.sql`;
 *   4. applying the migration history to a throwaway shadow schema produces the
 *      same schema as the target database (no drift);
 *   5. the C-08 recovery table and the C-14 authoring tables exist with the
 *      constraints the application relies on.
 *
 * It never writes to `DATABASE_URL`. The shadow schema is created and dropped
 * by this script.
 *
 *   node scripts/verify-migrations.mjs --url <isolated-url> [--out <json>]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_DIR,
  ROOT,
  assertRunDatabase,
  createDatabase,
  databaseLabel,
  dropDatabase,
  isMain,
  loadProjectEnv,
  nowIso,
  parseDatabaseUrl,
  queryRows,
  redactUrl,
  runPrisma,
  sha256File,
  writeJson,
} from './lib/verify-common.mjs';

export function localMigrations() {
  const migrationsDir = join(API_DIR, 'prisma', 'migrations');
  if (!existsSync(migrationsDir)) throw new Error(`Missing migrations directory: ${migrationsDir}`);
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function schemaObjects(parsed, database) {
  return queryRows(
    parsed,
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (
          'settlement_recoveries','settlement_adjustments','settlements','payouts',
          'seasons','farming_events','harvests','trace_events','qc_inspections'
        )
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
    database,
  );
}

async function schemaIndexes(parsed, database) {
  return queryRows(
    parsed,
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns,
            NON_UNIQUE AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN ('settlement_recoveries','farming_events','harvests')
      GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
      ORDER BY TABLE_NAME, INDEX_NAME`,
    [database],
    database,
  );
}

async function foreignKeys(parsed, database) {
  return queryRows(
    parsed,
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
            REFERENCED_TABLE_NAME AS referencedTable
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
        AND TABLE_NAME = 'settlement_recoveries'
      ORDER BY CONSTRAINT_NAME`,
    [database],
    database,
  );
}

export async function verifyMigrations(url, options = {}) {
  const parsed = assertRunDatabase(url, '--url');
  const failures = [];
  const warnings = [];
  const checks = [];

  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  // 1-3. Local files vs Prisma ledger ------------------------------------
  const local = localMigrations();
  const rows = await queryRows(
    parsed,
    `SELECT migration_name AS name, checksum, finished_at AS finishedAt,
            rolled_back_at AS rolledBackAt, started_at AS startedAt
       FROM _prisma_migrations
      ORDER BY started_at, migration_name`,
    [],
    parsed.database,
  );
  const applied = new Map();
  for (const row of rows) {
    const name = String(row.name);
    if (applied.has(name)) {
      failures.push(`_prisma_migrations contains duplicate rows for ${name}`);
    }
    applied.set(name, row);
  }

  check(
    'migration-count',
    local.length === rows.length,
    `local=${local.length}, recorded=${rows.length}`,
  );

  const missingLocally = [...applied.keys()].filter((name) => !local.includes(name));
  check(
    'no-unknown-applied-migrations',
    missingLocally.length === 0,
    missingLocally.length ? `recorded but no folder: ${missingLocally.join(', ')}` : 'none',
  );

  const missingInDatabase = local.filter((name) => !applied.has(name));
  check(
    'all-local-migrations-applied',
    missingInDatabase.length === 0,
    missingInDatabase.length ? `folder without ledger row: ${missingInDatabase.join(', ')}` : 'none',
  );

  const unfinished = rows
    .filter((row) => !row.finishedAt || row.rolledBackAt)
    .map((row) => `${row.name} (finished=${row.finishedAt ?? 'null'}, rolledBack=${row.rolledBackAt ?? 'null'})`);
  check(
    'no-failed-or-rolled-back-migrations',
    unfinished.length === 0,
    unfinished.length ? unfinished.join(', ') : 'none',
  );

  let checksumMismatches = 0;
  const checksumDetails = [];
  for (const name of local) {
    const file = join(API_DIR, 'prisma', 'migrations', name, 'migration.sql');
    if (!existsSync(file)) {
      failures.push(`missing migration.sql for ${name}`);
      continue;
    }
    const actual = await sha256File(file);
    const recorded = applied.get(name)?.checksum;
    if (recorded && String(recorded) !== actual) {
      checksumMismatches += 1;
      checksumDetails.push(`${name} recorded=${recorded} file=${actual}`);
    }
  }
  check(
    'migration-checksums-match-files',
    checksumMismatches === 0,
    checksumMismatches ? checksumDetails.join('; ') : `${local.length} files verified`,
  );

  // 4. Drift: replay the migration history into a disposable shadow schema.
  // Keep the name short: MySQL caps identifiers at 64 characters and the run
  // schema may already be near that limit.
  const shadowToken = String(options.token ?? Date.now().toString(36)).slice(-24);
  const shadowName = `agrimarket_shadow_${shadowToken}`;
  if (shadowName.length > 63) {
    throw new Error('Shadow schema name is too long; use a shorter --schema-token.');
  }
  const shadowUrl = new URL(url);
  shadowUrl.pathname = `/${shadowName}`;
  const shadow = parseDatabaseUrl(shadowUrl.toString());
  if (!shadow) throw new Error('Could not build a shadow database URL.');

  let drift = null;
  try {
    await dropDatabase(parsed, shadowName);
    await createDatabase(parsed, shadowName);
    drift = await runPrisma(
      [
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-config-datasource',
        '--exit-code',
      ],
      {
        cwd: API_DIR,
        env: {
          DATABASE_URL: url,
          SHADOW_DATABASE_URL: shadowUrl.toString(),
        },
        logFile: options.driftLogFile,
        timeoutMs: 180_000,
        displayName: 'prisma migrate diff (history vs database)',
      },
    );
  } finally {
    try {
      await dropDatabase(parsed, shadowName);
    } catch (error) {
      warnings.push(`Could not drop shadow schema ${shadowName}: ${error.message}`);
    }
  }

  if (drift.error) {
    check('migration-drift', false, drift.error);
  } else if (drift.code === 0) {
    check('migration-drift', true, 'No difference detected.');
  } else if (drift.code === 2) {
    check(
      'migration-drift',
      false,
      `Database differs from migration history. ${drift.stdout.trim() || drift.stderr.trim()}`.slice(0, 4000),
    );
  } else {
    check(
      'migration-drift',
      false,
      `prisma migrate diff exited ${drift.code}: ${drift.stderr.trim() || drift.stdout.trim()}`.slice(0, 2000),
    );
  }

  // 5. C-08 / C-14 schema objects ---------------------------------------
  const columns = await schemaObjects(parsed, parsed.database);
  const indexes = await schemaIndexes(parsed, parsed.database);
  const fks = await foreignKeys(parsed, parsed.database);

  const tableNames = new Set(columns.map((row) => String(row.tableName)));
  const requiredTables = [
    'settlement_recoveries',
    'settlement_adjustments',
    'settlements',
    'payouts',
    'seasons',
    'farming_events',
    'harvests',
    'trace_events',
    'qc_inspections',
  ];
  const missingTables = requiredTables.filter((table) => !tableNames.has(table));
  check(
    'c08-c14-tables-present',
    missingTables.length === 0,
    missingTables.length ? `missing: ${missingTables.join(', ')}` : requiredTables.join(', '),
  );

  const column = (table, name) =>
    columns.find((row) => row.tableName === table && row.columnName === name);

  const recoveryStatus = column('settlement_recoveries', 'status');
  const statusEnum = String(recoveryStatus?.columnType ?? '');
  const expectedStatuses = ['PENDING_APPROVAL', 'APPROVED', 'RECORDED', 'REJECTED'];
  check(
    'c08-recovery-status-enum',
    expectedStatuses.every((status) => statusEnum.includes(`'${status}'`)),
    statusEnum || 'column missing',
  );

  const recoveryAmount = column('settlement_recoveries', 'amount');
  check(
    'c08-recovery-amount-decimal',
    /^decimal\(18,2\)$/i.test(String(recoveryAmount?.columnType ?? '')),
    recoveryAmount?.columnType ?? 'column missing',
  );

  const recoveryAdjustmentUnique = indexes.some(
    (row) =>
      row.tableName === 'settlement_recoveries' &&
      Number(row.nonUnique) === 0 &&
      String(row.columns) === 'adjustment_id',
  );
  check(
    'c08-one-recovery-per-adjustment',
    recoveryAdjustmentUnique,
    recoveryAdjustmentUnique ? 'unique(adjustment_id)' : 'unique index missing',
  );

  const recoveryFks = fks.map((row) => `${row.referencedTable}`);
  check(
    'c08-recovery-foreign-keys',
    recoveryFks.includes('partners') && recoveryFks.includes('settlement_adjustments'),
    recoveryFks.length ? recoveryFks.join(', ') : 'none',
  );

  const harvestQuantity = column('harvests', 'quantity');
  check(
    'c14-harvest-quantity-decimal',
    /^decimal\(18,3\)$/i.test(String(harvestQuantity?.columnType ?? '')),
    harvestQuantity?.columnType ?? 'column missing',
  );

  const seasonIndexes = indexes.filter((row) => row.tableName === 'farming_events' || row.tableName === 'harvests');
  const seasonIndexOk = ['farming_events', 'harvests'].every((table) =>
    seasonIndexes.some((row) => row.tableName === table && String(row.columns) === 'season_id'),
  );
  check(
    'c14-season-child-indexes',
    seasonIndexOk,
    seasonIndexes.map((row) => `${row.tableName}(${row.columns})`).join(', ') || 'none',
  );

  // Required relation columns are NOT NULL where the service depends on them.
  const requiredNotNull = [
    ['seasons', 'farm_id'],
    ['seasons', 'crop_name'],
    ['farming_events', 'season_id'],
    ['farming_events', 'occurred_at'],
    ['farming_events', 'content'],
    ['harvests', 'season_id'],
    ['harvests', 'harvest_date'],
    ['harvests', 'grade'],
  ];
  const wrongNullability = requiredNotNull.filter(([table, name]) => {
    const row = column(table, name);
    return !row || String(row.isNullable).toUpperCase() !== 'NO';
  });
  check(
    'c14-required-columns-not-null',
    wrongNullability.length === 0,
    wrongNullability.length
      ? wrongNullability.map(([table, name]) => `${table}.${name}`).join(', ')
      : `${requiredNotNull.length} columns verified`,
  );

  return {
    generatedAt: nowIso(),
    database: databaseLabel(parsed),
    url: redactUrl(url),
    migrations: {
      count: local.length,
      latest: local.at(-1) ?? null,
      checksumsVerified: local.length - checksumMismatches,
    },
    drift: drift ? { exitCode: drift.code, durationMs: drift.durationMs } : null,
    checks,
    warnings,
    failures,
    result: failures.length === 0 ? 'PASS' : 'FAIL',
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/verify-migrations.mjs --url <isolated-mysql-url> [--out <json>]

Checks the Prisma migration ledger, file checksums, replay drift against a
temporary shadow schema, and the C-08/C-14 schema objects. The target and the
shadow schema must be disposable; DATABASE_URL is always refused.`);
    process.exit(0);
  }
  loadProjectEnv();
  const url = valueOf(args, '--url') ?? process.env.VERIFY_DATABASE_URL;
  if (!url) throw new Error('--url (or VERIFY_DATABASE_URL) is required.');
  const out = valueOf(args, '--out');
  const result = await verifyMigrations(url, {
    driftLogFile: valueOf(args, '--log'),
    token: optionsToken(args),
  });
  if (out) writeJson(out, result);

  console.log(`Migration verification: ${result.result}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`);
  }
  for (const warning of result.warnings) console.log(`  WARN  ${warning}`);
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

function optionsToken(args) {
  const value = valueOf(args, '--schema-token', null);
  if (value) return value;
  return `c19${Date.now().toString(36)}`;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`Migration verification failed: ${redactUrl(error.message)}`);
    process.exit(1);
  });
}
