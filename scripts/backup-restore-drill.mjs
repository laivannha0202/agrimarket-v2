#!/usr/bin/env node
/**
 * C-19 backup + restore drill.
 *
 *   1. verify the source is a disposable schema and snapshot its row counts
 *      and CHECKSUM TABLE values;
 *   2. run `scripts/backup-db.mjs` (gzip + SHA-256 sidecar);
 *   3. restore the dump into a unique `*_drill_<token>` schema;
 *   4. compare every table count and checksum, replay the migration ledger and
 *      read the restored data through the generated Prisma client;
 *   5. drop the drill schema (unless --keep-drill).
 *
 * The application database (`DATABASE_URL`) is never a source or target.
 *
 *   node scripts/backup-restore-drill.mjs --url <isolated-url> [--out-dir <dir>]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_DIR,
  ROOT,
  assertRunDatabase,
  createDatabase,
  databaseLabel,
  dropDatabase,
  ensureDir,
  isMain,
  loadProjectEnv,
  manifestDirectory,
  nowIso,
  parseDatabaseUrl,
  readJson,
  redactUrl,
  resolveMysqlBinary,
  runCommand,
  sha256File,
  tableStats,
  writeJson,
} from './lib/verify-common.mjs';
import { verifyMigrations } from './verify-migrations.mjs';

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function prismaReadSmoke(drillUrl) {
  const clientModule = await import('../apps/api/dist/generated/prisma/client.js');
  const adapterModule = await import('@prisma/adapter-mariadb');
  const { PrismaClient } = clientModule;
  const { PrismaMariaDb } = adapterModule;
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(drillUrl) });
  try {
    const [users, orders, payments, lots, recoveries] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.payment.count(),
      prisma.productLot.count(),
      prisma.settlementRecovery.count(),
    ]);
    const latestOrder = await prisma.order.findFirst({
      orderBy: { id: 'desc' },
      include: { payments: true },
    });
    if (!latestOrder) throw new Error('Restored schema has no order to read');
    const paid = await prisma.payment.aggregate({
      where: { status: 'PAID' },
      _sum: { amount: true },
    });
    const lot = await prisma.productLot.findFirst({
      orderBy: { id: 'asc' },
      include: { traceEvents: true },
    });
    if (!lot) throw new Error('Restored schema has no product lot to read');
    return {
      counts: { users, orders, payments, productLots: lots, settlementRecoveries: recoveries },
      latestOrder: {
        id: latestOrder.id,
        code: latestOrder.code,
        status: latestOrder.status,
        grandTotal: String(latestOrder.grandTotal),
        payments: latestOrder.payments.length,
      },
      paidTotal: paid._sum.amount ? String(paid._sum.amount) : '0',
      trace: {
        lotCode: lot.code,
        traceCode: lot.traceCode,
        events: lot.traceEvents.length,
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function runBackupRestoreDrill(url, options = {}) {
  const parsed = assertRunDatabase(url, '--url');
  const outDir = ensureDir(options.outDir ?? join(ROOT, '.tmp-verify', 'c19', 'backup-restore'));
  const drillToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // A unique backup directory per drill makes "exactly one dump" deterministic
  // even when the same evidence root is reused.
  const backupDir = ensureDir(join(outDir, `backup-${drillToken}`));
  const logsDir = ensureDir(join(outDir, 'logs'));
  const logFile = join(logsDir, `backup-restore-${drillToken}.log`);
  const drillName = `${parsed.database}_drill_${drillToken}`;
  if (drillName.length > 63) throw new Error('Drill schema name is too long.');

  const drillUrl = new URL(url);
  drillUrl.pathname = `/${drillName}`;
  const result = {
    generatedAt: nowIso(),
    source: databaseLabel(parsed),
    sourceUrl: redactUrl(url),
    drillSchema: drillName,
    checks: [],
    failures: [],
    warnings: [],
    result: 'FAIL',
  };
  const check = (name, ok, detail) => {
    result.checks.push({ name, ok, detail });
    if (!ok) result.failures.push(`${name}: ${detail}`);
  };

  let drillCreated = false;
  try {
    // Source snapshot BEFORE the dump.
    const sourceTables = await tableStats(parsed, parsed.database, await listAllTables(parsed));
    result.tables = sourceTables;
    result.tableCount = Object.keys(sourceTables).length;
    result.sourceRows = Object.values(sourceTables).reduce((sum, table) => sum + table.rows, 0);

    const mysqlDump = resolveMysqlBinary('mysqldump');
    const mysqlClient = resolveMysqlBinary('mysql');
    check('mysql-client-tools', Boolean(mysqlDump && mysqlClient), mysqlDump && mysqlClient
      ? `mysqldump + mysql resolved`
      : 'mysqldump/mysql not found; set MYSQLDUMP_PATH and MYSQL_PATH');

    const backup = await runCommand(process.execPath, [join(ROOT, 'scripts', 'backup-db.mjs'), '--out', backupDir], {
      cwd: ROOT,
      env: {
        BACKUP_DATABASE_URL: url,
        NODE_ENV: 'test',
        ...(mysqlDump ? { MYSQLDUMP_PATH: mysqlDump } : {}),
      },
      logFile,
      timeoutMs: 300_000,
      displayName: 'backup-db.mjs',
    });
    check('backup-command', backup.code === 0, `exit ${backup.code}, ${backup.durationMs} ms`);
    if (backup.code !== 0) throw new Error('Backup command failed; see the log.');

    const dumps = readdirSync(backupDir)
      .filter((name) => name.endsWith('.sql.gz'))
      .map((name) => join(backupDir, name));
    if (dumps.length !== 1) throw new Error(`Expected exactly one dump, found ${dumps.length}.`);
    const dumpPath = dumps[0];
    const sidecar = readJson(`${dumpPath}.json`);
    if (!sidecar) throw new Error('Backup sidecar is missing or unreadable.');
    const dumpSha = await sha256File(dumpPath);
    check('backup-checksum', sidecar.sha256 === dumpSha, sidecar.sha256 === dumpSha ? dumpSha : 'sidecar mismatch');
    check(
      'backup-not-encrypted',
      sidecar.encryption?.startsWith('not applied'),
      'encryption remains an operator responsibility (documented limitation)',
    );
    result.backup = {
      file: dumpPath,
      bytes: statSync(dumpPath).size,
      sha256: dumpSha,
      createdAt: sidecar.createdAt,
      tool: sidecar.tool,
    };

    // Restore into a brand-new drill schema.
    await dropDatabase(parsed, drillName);
    const restore = await runCommand(
      process.execPath,
      [
        join(ROOT, 'scripts', 'restore-db.mjs'),
        '--file',
        dumpPath,
        '--create-database',
      ],
      {
        cwd: ROOT,
        env: {
          RESTORE_DATABASE_URL: drillUrl.toString(),
          RESTORE_CONFIRM: 'RESTORE',
          NODE_ENV: 'test',
          ...(mysqlClient ? { MYSQL_PATH: mysqlClient } : {}),
        },
        logFile,
        timeoutMs: 300_000,
        displayName: 'restore-db.mjs (drill schema)',
      },
    );
    drillCreated = restore.code === 0;
    check('restore-command', restore.code === 0, `exit ${restore.code}, ${restore.durationMs} ms`);
    if (restore.code !== 0) throw new Error('Restore command failed; see the log.');

    // Source must not have changed while the dump was taken.
    const sourceAfter = await tableStats(parsed, parsed.database, Object.keys(sourceTables));
    const sourceChanged = Object.keys(sourceTables).filter(
      (table) =>
        sourceTables[table].rows !== sourceAfter[table].rows ||
        sourceTables[table].checksum !== sourceAfter[table].checksum,
    );
    check(
      'source-stable-during-drill',
      sourceChanged.length === 0,
      sourceChanged.length ? `changed: ${sourceChanged.join(', ')}` : 'no source writes during drill',
    );

    const drillParsed = parseDatabaseUrl(drillUrl.toString());
    const drillStats = await tableStats(drillParsed, drillName, Object.keys(sourceTables));
    const missingTables = Object.keys(sourceTables).filter((table) => !drillStats[table]);
    check(
      'all-tables-restored',
      missingTables.length === 0,
      missingTables.length ? `missing: ${missingTables.join(', ')}` : `${Object.keys(sourceTables).length} tables`,
    );

    const rowMismatches = [];
    const checksumMismatches = [];
    for (const table of Object.keys(sourceTables)) {
      if (!drillStats[table]) continue;
      if (sourceTables[table].rows !== drillStats[table].rows) {
        rowMismatches.push(
          `${table}: ${sourceTables[table].rows} -> ${drillStats[table].rows}`,
        );
      }
      if (sourceTables[table].checksum !== drillStats[table].checksum) {
        checksumMismatches.push(
          `${table}: ${sourceTables[table].checksum} -> ${drillStats[table].checksum}`,
        );
      }
    }
    check(
      'row-counts-match',
      rowMismatches.length === 0,
      rowMismatches.length ? rowMismatches.join('; ') : `${result.sourceRows} rows matched`,
    );
    check(
      'table-checksums-match',
      checksumMismatches.length === 0,
      checksumMismatches.length ? checksumMismatches.join('; ') : 'all CHECKSUM TABLE values matched',
    );
    result.drill = {
      tables: drillStats,
      rows: Object.values(drillStats).reduce((sum, table) => sum + table.rows, 0),
    };

    // Migration ledger replay on the restored database.
    const migrations = await verifyMigrations(drillUrl.toString(), {
      token: `${drillToken}mv`,
      driftLogFile: join(logsDir, 'drill-migration-drift.log'),
    });
    check(
      'drill-migration-ledger',
      migrations.result === 'PASS',
      migrations.failures.length ? migrations.failures.join('; ') : `${migrations.migrations.count} migrations`,
    );
    result.drillMigrations = {
      result: migrations.result,
      count: migrations.migrations.count,
      latest: migrations.migrations.latest,
    };

    // Application-level read smoke through the real Prisma client.
    const readSmoke = await prismaReadSmoke(drillUrl.toString());
    check('prisma-read-smoke', readSmoke.counts.orders > 0 && readSmoke.trace.events > 0, JSON.stringify(readSmoke));
    result.prismaReadSmoke = readSmoke;

    result.result = result.failures.length === 0 ? 'PASS' : 'FAIL';
  } catch (error) {
    result.failures.push(error.message);
    result.result = 'FAIL';
  } finally {
    if (drillCreated || (await databaseMayExist(parsed, drillName))) {
      if (options.keepDrill) {
        result.warnings.push(`Drill schema ${drillName} kept by request.`);
      } else {
        try {
          await dropDatabase(parsed, drillName);
          result.warnings.push(`Drill schema ${drillName} dropped after verification.`);
        } catch (error) {
          result.warnings.push(`Could not drop drill schema ${drillName}: ${error.message}`);
        }
      }
    }
    try {
      const files = await manifestDirectory(logsDir);
      result.logManifest = files;
    } catch {
      // Evidence is best-effort; the result is already recorded.
    }
    result.completedAt = nowIso();
    result.logFile = logFile;
  }

  return result;
}

async function listAllTables(parsed) {
  const { listTables } = await import('./lib/verify-common.mjs');
  return listTables(parsed, parsed.database, { includeMigrations: true });
}

async function databaseMayExist(parsed, name) {
  const { databaseExists } = await import('./lib/verify-common.mjs');
  try {
    return await databaseExists(parsed, name);
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/backup-restore-drill.mjs --url <isolated-mysql-url> [options]

Options:
  --url <url>        Source schema (required; must be disposable)
  --out-dir <dir>    Evidence directory (default: .tmp-verify/c19/backup-restore)
  --json-out <file>  Write the full result as JSON
  --keep-drill       Keep the restored drill schema for inspection
  --help             Show this help

The dump is created with mysqldump --single-transaction and verified against
its SHA-256 sidecar before the restore. The drill schema is created from
scratch, compared table-by-table, then dropped. No real database is touched.`);
    process.exit(0);
  }
  loadProjectEnv();
  const url = valueOf(args, '--url') ?? process.env.VERIFY_DATABASE_URL;
  if (!url) throw new Error('--url (or VERIFY_DATABASE_URL) is required.');
  const result = await runBackupRestoreDrill(url, {
    outDir: valueOf(args, '--out-dir', undefined),
    keepDrill: args.includes('--keep-drill'),
  });
  const jsonOut = valueOf(args, '--json-out');
  if (jsonOut) writeJson(jsonOut, result);

  console.log(`Backup/restore drill: ${result.result}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`);
  }
  for (const warning of result.warnings) console.log(`  INFO  ${warning}`);
  if (result.backup) {
    console.log(`  Backup: ${result.backup.file} (${result.backup.bytes} bytes, sha256 ${result.backup.sha256})`);
  }
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`Backup/restore drill failed: ${redactUrl(error.message)}`);
    process.exit(1);
  });
}
