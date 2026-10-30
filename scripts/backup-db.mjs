#!/usr/bin/env node
/**
 * Logical MySQL backup for AgriMarket V2.
 *
 * Creates a compressed, checksummed dump of ONE database:
 *   node scripts/backup-db.mjs [--out backups] [--keep-days 30] [--dry-run]
 *
 * Connection:
 *   BACKUP_DATABASE_URL (preferred) or DATABASE_URL.
 *   The password is passed to mysqldump through MYSQL_PWD and is never printed.
 *
 * The dump deliberately does not contain CREATE DATABASE / USE statements, so
 * it can be restored into a differently named isolated schema (see
 * scripts/restore-db.mjs and docs/BACKUP-RESTORE-RUNBOOK.md).
 *
 * This script does not prove a restore. A backup is only considered verified
 * after a restore drill on an isolated test database.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveMysqlBinary } from './lib/verify-common.mjs';

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage: node scripts/backup-db.mjs [options]

Options:
  --out <dir>       Output directory (default: backups)
  --keep-days <n>   Delete dumps for the same database older than n days (default: keep)
  --dry-run         Validate config and print the plan without running mysqldump
  --help            Show this help

Environment:
  BACKUP_DATABASE_URL   Source database URL (preferred)
  DATABASE_URL          Fallback source database URL
  MYSQLDUMP_PATH        Path to mysqldump (default: PATH, then standard MySQL/MariaDB installs)
  BACKUP_CONFIRM=YES    Required when NODE_ENV=production`);
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
const outDir = resolve(valueOf('--out', 'backups'));
const keepDaysRaw = valueOf('--keep-days', null);
const keepDays = keepDaysRaw === null ? null : Number(keepDaysRaw);
if (keepDays !== null && (!Number.isInteger(keepDays) || keepDays < 1)) {
  console.error('--keep-days must be a positive integer.');
  process.exit(1);
}

const sourceUrl = (process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL || '').trim();
if (!sourceUrl) {
  console.error('BACKUP_DATABASE_URL (or DATABASE_URL) is required.');
  process.exit(1);
}

let source;
try {
  source = new URL(sourceUrl);
} catch {
  console.error('The database URL is not parseable.');
  process.exit(1);
}

const database = decodeURIComponent(source.pathname.replace(/^\//, ''));
const host = source.hostname;
const port = source.port || '3306';
const user = decodeURIComponent(source.username || 'root');
const password = decodeURIComponent(source.password || '');

if (!database || !host) {
  console.error('The database URL must include a host and a database name.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_$-]+$/.test(database)) {
  console.error('Refusing an unexpected database name; expected letters, digits, _, $ or -.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && process.env.BACKUP_CONFIRM !== 'YES') {
  console.error('Refusing to back up a production database without BACKUP_CONFIRM=YES.');
  process.exit(1);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

const stamp = timestamp();
const dumpPath = join(outDir, `${database}-${stamp}.sql.gz`);
const metadataPath = `${dumpPath}.json`;
const mysqldump = process.env.MYSQLDUMP_PATH || resolveMysqlBinary('mysqldump') || 'mysqldump';
const toolArgs = [
  '--host', host,
  '--port', port,
  '--user', user,
  '--protocol=TCP',
  '--single-transaction',
  '--quick',
  '--routines',
  '--triggers',
  '--events',
  '--no-tablespaces',
  '--default-character-set=utf8mb4',
  database,
];

const maskedTarget = `${host}:${port}/${database}`;

if (dryRun) {
  console.log('Backup dry run:');
  console.log(`  source: ${maskedTarget}`);
  console.log(`  output: ${dumpPath}`);
  console.log(`  tool:   ${mysqldump}`);
  console.log(`  prune:  ${keepDays === null ? 'disabled' : `dumps older than ${keepDays} day(s)`}`);
  console.log(`  executable present: ${existsSync(mysqldump) || spawnSync(mysqldump, ['--version'], { encoding: 'utf8' }).status === 0 ? 'yes' : 'no (check MYSQLDUMP_PATH)'}`);
  process.exit(0);
}

const version = spawnSync(mysqldump, ['--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(`Cannot execute ${mysqldump}. Install the MySQL client or set MYSQLDUMP_PATH.`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const startedAt = Date.now();
console.log(`Backing up ${maskedTarget} -> ${dumpPath}`);

const child = spawn(mysqldump, toolArgs, {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
const output = createWriteStream(dumpPath, { flags: 'wx' });
const gzip = createGzip({ level: 9 });
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  const dumpDone = new Promise((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`mysqldump exited with ${code ?? signal}`));
    });
  });
  await Promise.all([
    pipeline(child.stdout, gzip, output),
    dumpDone,
  ]);
} catch (error) {
  child.kill();
  try { unlinkSync(dumpPath); } catch { /* best effort */ }
  console.error(`Backup failed: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim().replaceAll(password, '[redacted]'));
  process.exit(1);
}

function sha256File(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', rejectPromise)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

const sha256 = await sha256File(dumpPath);
const bytes = statSync(dumpPath).size;
const metadata = {
  database,
  host,
  port,
  createdAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  file: basename(dumpPath),
  bytes,
  sha256,
  compressed: true,
  encryption: 'not applied by this script; encrypt before offsite storage',
  tool: version.stdout.trim(),
  backupMethod: 'mysqldump --single-transaction',
  restoreVerified: false,
};
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });

if (keepDays !== null) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const entry of readdirSync(outDir)) {
    if (!entry.startsWith(`${database}-`) || !entry.endsWith('.sql.gz')) continue;
    const candidate = join(outDir, entry);
    if (candidate === dumpPath) continue;
    if (statSync(candidate).mtimeMs < cutoff) {
      try {
        unlinkSync(candidate);
        try { unlinkSync(`${candidate}.json`); } catch { /* sidecar may be absent */ }
        console.log(`Pruned old backup ${entry}`);
      } catch (error) {
        console.warn(`Could not prune ${entry}: ${error.message}`);
      }
    }
  }
}

// Re-read the metadata so a corrupted sidecar is caught immediately.
JSON.parse(readFileSync(metadataPath, 'utf8'));
console.log(`Backup complete: ${bytes} bytes, sha256 ${sha256}`);
console.log('Restore verification is still required: docs/BACKUP-RESTORE-RUNBOOK.md');
