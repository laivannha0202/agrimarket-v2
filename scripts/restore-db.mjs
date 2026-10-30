#!/usr/bin/env node
/**
 * Restore a compressed MySQL dump into an isolated schema.
 *
 *   node scripts/restore-db.mjs --file backups/<dump>.sql.gz [--create-database]
 *
 * Safety interlocks:
 *   - target comes from RESTORE_DATABASE_URL only; DATABASE_URL is never used
 *     as a restore target;
 *   - the target schema must end with _test, _restore, _drill or
 *     _drill_<token> unless ALLOW_NON_TEST_RESTORE=YES;
 *   - it must not be the same host/schema as DATABASE_URL unless
 *     ALLOW_NON_TEST_RESTORE=YES;
 *   - NODE_ENV=production always refuses;
 *   - RESTORE_CONFIRM=RESTORE is required for a real restore;
 *   - the dump checksum is verified against its .json sidecar when present.
 *
 * This is the only supported way to perform a restore drill in this repository.
 * Never run it against development, staging or production.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { basename, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveMysqlBinary } from './lib/verify-common.mjs';

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage: node scripts/restore-db.mjs --file <dump.sql.gz> [options]

Options:
  --file <path>        Dump file to restore (required)
  --create-database    Create the target schema if it does not exist
  --dry-run            Validate the plan and checksum without writing
  --help               Show this help

Environment:
  RESTORE_DATABASE_URL      Required target URL (isolated schema)
  MYSQL_PATH                Path to mysql (default: PATH, then standard MySQL/MariaDB installs)
  RESTORE_CONFIRM=RESTORE   Required for a real restore
  ALLOW_NON_TEST_RESTORE=YES  Override the test-schema-name guard (owner approval only)`);
}

if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

function valueOf(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

const dryRun = args.includes('--dry-run');
const createDatabase = args.includes('--create-database');
const fileArg = valueOf('--file', null);
if (!fileArg) {
  console.error('--file is required.');
  usage();
  process.exit(1);
}
const dumpPath = resolve(fileArg);
if (!existsSync(dumpPath)) {
  console.error(`Dump file not found: ${dumpPath}`);
  process.exit(1);
}
if (!/\.sql(\.gz)?$/i.test(dumpPath)) {
  console.error('Refusing a dump that is not .sql or .sql.gz.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to restore while NODE_ENV=production. Use an isolated environment.');
  process.exit(1);
}

const targetUrl = (process.env.RESTORE_DATABASE_URL || '').trim();
if (!targetUrl) {
  console.error('RESTORE_DATABASE_URL is required; DATABASE_URL is never used as a restore target.');
  process.exit(1);
}

let target;
try {
  target = new URL(targetUrl);
} catch {
  console.error('RESTORE_DATABASE_URL is not parseable.');
  process.exit(1);
}

const database = decodeURIComponent(target.pathname.replace(/^\//, ''));
const host = target.hostname;
const port = target.port || '3306';
const user = decodeURIComponent(target.username || 'root');
const password = decodeURIComponent(target.password || '');
if (!database || !host) {
  console.error('RESTORE_DATABASE_URL must include a host and a database name.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_$-]+$/.test(database)) {
  console.error('Refusing an unexpected database name; expected letters, digits, _, $ or -.');
  process.exit(1);
}

const allowNonTest = process.env.ALLOW_NON_TEST_RESTORE === 'YES';
// `_drill_<token>` keeps repeated drills in unique schemas while still making
// the disposable purpose obvious in the name.
const looksIsolated = /_(?:test|restore|drill)(?:_[a-z0-9]+)?$/i.test(database);
if (!looksIsolated && !allowNonTest) {
  console.error(
    `Refusing target "${database}": name must end with _test, _restore, _drill or _drill_<token>.`,
  );
  console.error('Create an isolated schema (for example agrimarket_v2_restore) and retry.');
  process.exit(1);
}

function parseTarget(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    };
  } catch {
    return null;
  }
}

const appTarget = parseTarget(process.env.DATABASE_URL || '');
if (appTarget && appTarget.host === (host === 'localhost' ? '127.0.0.1' : host) && appTarget.database === database && !allowNonTest) {
  console.error('Refusing to restore over the schema referenced by DATABASE_URL.');
  process.exit(1);
}

if (!dryRun && process.env.RESTORE_CONFIRM !== 'RESTORE') {
  console.error('Set RESTORE_CONFIRM=RESTORE to confirm this restore.');
  process.exit(1);
}

const mysql = process.env.MYSQL_PATH || resolveMysqlBinary('mysql') || 'mysql';
const maskedTarget = `${host}:${port}/${database}`;

function sha256File(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', rejectPromise)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

const sidecarPath = `${dumpPath}.json`;
let sidecar = null;
if (existsSync(sidecarPath)) {
  try {
    sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  } catch {
    console.error(`Cannot parse checksum sidecar: ${sidecarPath}`);
    process.exit(1);
  }
}
const checksum = await sha256File(dumpPath);
if (sidecar?.sha256 && sidecar.sha256 !== checksum) {
  console.error('Checksum mismatch: the dump does not match its .json sidecar.');
  console.error(`  expected ${sidecar.sha256}`);
  console.error(`  actual   ${checksum}`);
  process.exit(1);
}
if (sidecar?.database && sidecar.database === database) {
  console.error(`Refusing to restore ${sidecar.database} onto itself. Choose a separate drill schema.`);
  process.exit(1);
}

if (dryRun) {
  console.log('Restore dry run:');
  console.log(`  dump:   ${dumpPath} (${statSync(dumpPath).size} bytes)`);
  console.log(`  sha256: ${checksum}${sidecar?.sha256 ? ' (sidecar verified)' : ' (no sidecar)'}`);
  console.log(`  target: ${maskedTarget}${looksIsolated ? ' [isolated name]' : ' [NON-TEST OVERRIDE]'}`);
  console.log(`  create database: ${createDatabase ? 'yes' : 'no'}`);
  console.log(`  tool:   ${mysql}`);
  console.log(`  executable present: ${existsSync(mysql) || spawnSync(mysql, ['--version'], { encoding: 'utf8' }).status === 0 ? 'yes' : 'no (check MYSQL_PATH)'}`);
  process.exit(0);
}

const version = spawnSync(mysql, ['--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(`Cannot execute ${mysql}. Install the MySQL client or set MYSQL_PATH.`);
  process.exit(2);
}

if (createDatabase) {
  const created = spawnSync(mysql, [
    '--host', host,
    '--port', port,
    '--user', user,
    '--protocol=TCP',
    '--default-character-set=utf8mb4',
    `--execute=CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ], {
    env: { ...process.env, MYSQL_PWD: password },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (created.error || created.status !== 0) {
    console.error('Could not create the target schema.');
    if (created.stderr?.trim()) console.error(created.stderr.trim().replaceAll(password, '[redacted]'));
    process.exit(1);
  }
}

console.log(`Restoring ${basename(dumpPath)} -> ${maskedTarget}`);
const child = spawn(mysql, [
  '--host', host,
  '--port', port,
  '--user', user,
  '--protocol=TCP',
  '--default-character-set=utf8mb4',
  '--binary-mode',
  `--database=${database}`,
], {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ['pipe', 'inherit', 'pipe'],
  windowsHide: true,
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  const restoreDone = new Promise((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`mysql exited with ${code ?? signal}`));
    });
  });
  const input = createReadStream(dumpPath);
  const stages = /\.gz$/i.test(dumpPath) ? [input, createGunzip(), child.stdin] : [input, child.stdin];
  await Promise.all([pipeline(...stages), restoreDone]);
} catch (error) {
  child.kill();
  console.error(`Restore failed: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim().replaceAll(password, '[redacted]'));
  process.exit(1);
}

console.log('Restore completed. Verify row counts, constraints and application smoke tests before accepting it.');
console.log('Record the drill result in docs/BACKUP-RESTORE-RUNBOOK.md; a completed restore is not the same as verified data.');
