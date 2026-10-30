/**
 * Shared helpers for the local C-19 release-verification scripts.
 *
 * Rules enforced here:
 *   - every database URL used for a destructive operation must name an
 *     isolated schema (`*_test`, `*_restore`, `*_drill` or `*_drill_<token>`);
 *   - the schema referenced by `DATABASE_URL` is never a target;
 *   - `NODE_ENV=production` refuses to run destructive verification;
 *   - credentials are redacted from every line this module prints or writes.
 *
 * This module deliberately has no dependency on the API build so it can run
 * before the first `prisma generate`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const API_DIR = join(ROOT, 'apps', 'api');
export const EVIDENCE_ROOT = join(ROOT, '.tmp-verify', 'c19');

export const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function nowIso() {
  return new Date().toISOString();
}

/** `20261024T071530Z` — safe in schema and directory names. */
export function timestampToken() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Lower-case token suitable for a MySQL schema suffix. */
export function runToken() {
  return `${timestampToken().toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256File(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', rejectPromise)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export function bytesLabel(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

/** SHA-256 manifest of a directory, relative POSIX paths, sorted. */
export async function manifestDirectory(dir) {
  const files = listFilesRecursive(dir).sort();
  const entries = [];
  for (const file of files) {
    entries.push({
      path: relative(dir, file).split(sep).join('/'),
      bytes: statSync(file).size,
      sha256: await sha256File(file),
    });
  }
  return entries;
}

export function tail(text, lines = 40) {
  const all = String(text ?? '').trimEnd().split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}

/** True when this module is the process entry point (Windows-safe). */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return importMetaUrl === pathToFileURL(resolve(entry)).href;
}

// ---------------------------------------------------------------------------
// Environment files (no dotenv dependency, values never printed)
// ---------------------------------------------------------------------------

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
  if (!match) return null;
  const key = match[1];
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    const comment = value.indexOf(' #');
    if (comment >= 0) value = value.slice(0, comment).trim();
  }
  return [key, value];
}

/** Reads an env file into an object. Missing files return {}. */
export function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) values[entry[0]] = entry[1];
  }
  return values;
}

/**
 * Loads `.env`/`.env.local` without overriding the process environment. The
 * API workspace file is loaded for direct script runs; `local-verify.mjs`
 * copies the same values explicitly into child processes.
 */
export function loadProjectEnv() {
  const candidates = [
    join(ROOT, '.env'),
    join(ROOT, '.env.local'),
    join(API_DIR, '.env'),
    join(API_DIR, '.env.local'),
  ];
  for (const file of candidates) {
    const values = readEnvFile(file);
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Masks credentials in a database URL while keeping host/schema visible. */
export function redactUrl(value) {
  if (!value) return '';
  return String(value).replace(/\/\/([^@/\s]+)@/g, '//***@');
}

/** Masks known secret values and URL credentials in free text. */
export function redactText(value) {
  let text = String(value ?? '');
  for (const key of [
    'JWT_SECRET',
    'TEST_JWT_SECRET',
    'SMTP_PASSWORD',
    'MYSQL_PWD',
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'BACKUP_DATABASE_URL',
    'RESTORE_DATABASE_URL',
  ]) {
    const secret = process.env[key];
    if (!secret || secret.length < 8) continue;
    text = text.split(secret).join(key.endsWith('_URL') ? redactUrl(secret) : `[redacted ${key}]`);
  }
  return text.replace(/mysql(?:s)?:\/\/[^\s"'`]+/gi, (match) => redactUrl(match));
}

// ---------------------------------------------------------------------------
// Database URL parsing / isolation guards
// ---------------------------------------------------------------------------

export function parseDatabaseUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!parsed.hostname || !database) return null;
    return {
      raw: value,
      protocol: parsed.protocol,
      host: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username || 'root'),
      password: decodeURIComponent(parsed.password || ''),
      database,
      query: Object.fromEntries(parsed.searchParams.entries()),
    };
  } catch {
    return null;
  }
}

export function sameDatabase(a, b) {
  return Boolean(a && b && a.host === b.host && a.database === b.database);
}

export function databaseLabel(parsed) {
  return parsed ? `${parsed.host}:${parsed.port}/${parsed.database}` : '(unset)';
}

const ISOLATED_SCHEMA = /_(?:test|restore|drill)(?:_[a-z0-9]+)?$/i;

/** Throws unless the URL names an explicitly disposable schema. */
export function assertIsolatedDatabase(rawUrl, label = 'database URL') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing destructive verification while NODE_ENV=production.');
  }
  const parsed = parseDatabaseUrl(rawUrl);
  if (!parsed) throw new Error(`${label} is missing or not a parseable MySQL URL.`);
  if (!ISOLATED_SCHEMA.test(parsed.database)) {
    throw new Error(
      `${label} targets "${databaseLabel(parsed)}"; schema names must end with ` +
        '_test, _restore, _drill or _drill_<token>.',
    );
  }
  return parsed;
}

/** Throws when `url` is the schema the application itself uses. */
export function assertNotApplicationDatabase(rawUrl, label = 'database URL') {
  const app = parseDatabaseUrl(process.env.DATABASE_URL);
  const target = parseDatabaseUrl(rawUrl);
  if (sameDatabase(app, target)) {
    throw new Error(
      `${label} targets the application database (${databaseLabel(target)}). ` +
        'Verification must use a disposable schema.',
    );
  }
  return target;
}

export function assertRunDatabase(rawUrl, label = 'run database URL') {
  const parsed = assertIsolatedDatabase(rawUrl, label);
  assertNotApplicationDatabase(rawUrl, label);
  return parsed;
}

export function mysqlOptions(parsed, overrides = {}) {
  return {
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    ...overrides,
  };
}

/** Connect to the server (no default schema) and run `fn(connection)`. */
export async function withAdminConnection(parsed, fn) {
  const connection = await mysql.createConnection(mysqlOptions(parsed));
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

/** Connect to one schema and run `fn(connection)`. */
export async function withDatabase(parsed, fn, database = parsed.database) {
  const connection = await mysql.createConnection(mysqlOptions(parsed, { database }));
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

export function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_$-]+$/.test(value)) {
    throw new Error(`Refusing an unexpected identifier: ${value}`);
  }
  return `\`${value}\``;
}

export async function databaseExists(parsed, name) {
  return withAdminConnection(parsed, async (connection) => {
    const [rows] = await connection.query(
      'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [name],
    );
    return rows.length > 0;
  });
}

export async function createDatabase(parsed, name) {
  const identifier = quoteIdentifier(name);
  await withAdminConnection(parsed, async (connection) => {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${identifier} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  });
  return name;
}

export async function dropDatabase(parsed, name) {
  const identifier = quoteIdentifier(name);
  await withAdminConnection(parsed, async (connection) => {
    await connection.query(`DROP DATABASE IF EXISTS ${identifier}`);
  });
}

/** Sorted list of base tables in a schema, excluding Prisma's ledger. */
export async function listTables(parsed, database, { includeMigrations = false } = {}) {
  return withDatabase(parsed, async (connection) => {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [database],
    );
    return rows
      .map((row) => String(row.name))
      .filter((name) => includeMigrations || name !== '_prisma_migrations');
  }, database);
}

export async function tableStats(parsed, database, tables) {
  return withDatabase(parsed, async (connection) => {
    const result = {};
    for (const table of tables) {
      const identifier = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
      const [countRows] = await connection.query(`SELECT COUNT(*) AS c FROM ${identifier}`);
      const [checksumRows] = await connection.query(`CHECKSUM TABLE ${identifier}`);
      result[table] = {
        rows: Number(countRows[0].c),
        checksum: checksumRows[0]?.Checksum === null ? null : String(checksumRows[0]?.Checksum),
      };
    }
    return result;
  }, database);
}

export async function queryRows(parsed, sql, params = [], database = parsed.database) {
  return withDatabase(parsed, async (connection) => {
    const [rows] = await connection.query(sql, params);
    return rows;
  }, database);
}

// ---------------------------------------------------------------------------
// MySQL client binaries
// ---------------------------------------------------------------------------

export function which(command) {
  try {
    const result = spawnSync(IS_WINDOWS ? 'where.exe' : 'which', [command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    const first = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * Finds `mysql` / `mysqldump` from an explicit env override, PATH, or the
 * standard Windows MySQL/MariaDB install locations. Returns null when absent.
 */
export function resolveMysqlBinary(kind) {
  if (kind !== 'mysql' && kind !== 'mysqldump') {
    throw new Error(`Unsupported MySQL binary: ${kind}`);
  }
  const envValue = process.env[kind === 'mysql' ? 'MYSQL_PATH' : 'MYSQLDUMP_PATH'];
  if (envValue && existsSync(envValue)) return envValue;

  const onPath = which(kind === 'mysql' ? 'mysql' : 'mysqldump');
  if (onPath) return onPath;

  const suffix = IS_WINDOWS ? '.exe' : '';
  const candidates = [];
  if (IS_WINDOWS) {
    for (const version of ['9.1', '9.0', '8.4', '8.3', '8.0', '5.7']) {
      candidates.push(`C:\\Program Files\\MySQL\\MySQL Server ${version}\\bin\\${kind}${suffix}`);
    }
    for (const version of ['11.4', '11.3', '10.11', '10.6']) {
      candidates.push(`C:\\Program Files\\MariaDB ${version}\\bin\\${kind}${suffix}`);
    }
    candidates.push(
      `C:\\xampp\\mysql\\bin\\${kind}${suffix}`,
      `C:\\laragon\\bin\\mysql\\${kind}${suffix}`,
      `C:\\Program Files\\MySQL\\bin\\${kind}${suffix}`,
    );
    for (const base of ['C:\\laragon\\bin\\mysql']) {
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(join(base, entry.name, 'bin', `${kind}${suffix}`));
      }
    }
  } else {
    candidates.push(`/usr/bin/${kind}`, `/usr/local/bin/${kind}`, `/opt/homebrew/bin/${kind}`);
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// ---------------------------------------------------------------------------
// Process execution with per-step logs
// ---------------------------------------------------------------------------

function quoteForShell(value) {
  if (IS_WINDOWS) {
    if (!/[\s"&|<>^]/.test(value)) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  if (!/[\s"'$`\\!&|<>()]/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellInvocation(command, args) {
  if (IS_WINDOWS) {
    const line = [command, ...args].map(quoteForShell).join(' ');
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line]];
  }
  return ['/bin/sh', ['-c', [command, ...args].map(quoteForShell).join(' ')]];
}

export function npmBinary() {
  if (!IS_WINDOWS) return { command: 'npm', prefixArgs: [], shell: false };
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cli)) {
    return { command: process.execPath, prefixArgs: [cli], shell: false };
  }
  return { command: 'npm.cmd', prefixArgs: [], shell: true };
}

export function binPath(name) {
  const file = join(ROOT, 'node_modules', '.bin', IS_WINDOWS ? `${name}.cmd` : name);
  return existsSync(file) ? file : null;
}

/**
 * Runs a command, tee-ing redacted output to an optional log file.
 * Resolves (never rejects) with `{ code, signal, stdout, stderr, durationMs }`.
 */
export function runCommand(command, args = [], options = {}) {
  const {
    cwd = ROOT,
    env = {},
    logFile = null,
    timeoutMs = 0,
    shell = false,
    displayName = null,
  } = options;
  const mergedEnv = { ...process.env, ...env };
  const [finalCommand, finalArgs] = shell
    ? shellInvocation(command, args)
    : [command, args];
  const printable = displayName ?? [command, ...args].join(' ');

  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(finalCommand, finalArgs, {
      cwd,
      env: mergedEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (target, chunk) => {
      const text = chunk.toString();
      if (target === 'stdout') stdout += text;
      else stderr += text;
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          if (IS_WINDOWS && child.pid) {
            spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
              windowsHide: true,
            });
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          // Best effort; the close handler still resolves.
        }
      }, timeoutMs);
      timer.unref?.();
    }

    const finish = (code, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const redactedStdout = redactText(stdout);
      const redactedStderr = redactText(stderr);
      if (logFile) {
        ensureDir(dirname(logFile));
        const stream = createWriteStream(logFile, { flags: 'a' });
        stream.write(`$ ${redactText(printable)}\n`);
        if (redactedStdout) stream.write(redactedStdout);
        if (redactedStderr) stream.write(redactedStderr);
        if (spawnError) stream.write(`\n[spawn error] ${spawnError.message}\n`);
        if (timedOut) stream.write(`\n[timeout after ${timeoutMs} ms]\n`);
        stream.write(`\n[exit ${code ?? 'null'}${signal ? ` signal ${signal}` : ''} in ${durationMs} ms]\n`);
        stream.end();
      }
      resolvePromise({
        code: spawnError ? -1 : code,
        signal,
        stdout: redactedStdout,
        stderr: redactedStderr,
        durationMs,
        timedOut,
        error: spawnError ? spawnError.message : null,
        command: redactText(printable),
      });
    };

    child.on('error', (error) => finish(null, null, error));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/**
 * Starts a long-running process (API/web server) and tees its redacted output
 * to a log file. Unlike `runCommand` it resolves immediately; callers await
 * `exited` or `stop()`.
 */
export function startProcess({
  name,
  command,
  args = [],
  cwd = ROOT,
  env = {},
  logFile = null,
}) {
  const mergedEnv = { ...process.env, ...env };
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  const stream = logFile
    ? (ensureDir(dirname(logFile)), createWriteStream(logFile, { flags: 'a' }))
    : null;
  if (stream) stream.write(`$ ${redactText(name ?? [command, ...args].join(' '))}\n`);

  const child = spawn(command, args, {
    cwd,
    env: mergedEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const append = (chunk) => {
    const text = chunk.toString();
    stdout += text;
    if (stream) stream.write(redactText(text));
  };
  child.stdout.on('data', append);
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (stream) stream.write(redactText(text));
  });

  const exited = new Promise((resolvePromise) => {
    child.on('close', (code, signal) => {
      if (stream) {
        stream.write(`\n[exit ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}]\n`);
        stream.end();
      }
      resolvePromise({ code, signal, durationMs: Date.now() - startedAt });
    });
  });

  let stopping = null;
  const stop = (timeoutMs = 15_000) => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (child.exitCode !== null) return exited;
      try {
        if (IS_WINDOWS && child.pid) {
          spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
          });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // Best effort; the timeout below still resolves.
      }
      const timed = new Promise((resolvePromise) =>
        setTimeout(() => resolvePromise({ timedOut: true }), timeoutMs).unref?.(),
      );
      const result = await Promise.race([exited, timed]);
      if (result?.timedOut) {
        try {
          if (IS_WINDOWS && child.pid) {
            spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
              windowsHide: true,
            });
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // Ignore: the caller already has evidence that shutdown timed out.
        }
        return { ...(await exited), timedOut: true };
      }
      return result;
    })();
    return stopping;
  };

  return {
    child,
    pid: child.pid,
    name: name ?? command,
    startedAt,
    logFile,
    exited,
    stop,
    output: () => ({ stdout: redactText(stdout), stderr: redactText(stderr) }),
  };
}

export function runNpm(args, options = {}) {
  const npm = npmBinary();
  return runCommand(npm.command, [...npm.prefixArgs, ...args], {
    ...options,
    shell: npm.shell,
    displayName: options.displayName ?? `npm ${args.join(' ')}`,
  });
}

/** Runs a local `node_modules/.bin` tool. */
export function runBin(name, args = [], options = {}) {
  const file = binPath(name);
  if (!file) {
    return Promise.resolve({
      code: -1,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      error: `Missing local binary: ${name}`,
      command: name,
    });
  }
  return runCommand(file, args, {
    ...options,
    shell: IS_WINDOWS,
    displayName: options.displayName ?? `${name} ${args.join(' ')}`,
  });
}

/** Resolves the Prisma CLI JS entry so it can be spawned through node. */
export function prismaEntry() {
  const candidates = [
    join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
    join(API_DIR, 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function runPrisma(args, options = {}) {
  const entry = prismaEntry();
  if (!entry) {
    return Promise.resolve({
      code: -1,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      error: 'Prisma CLI entry not found under node_modules/prisma/build/index.js',
      command: 'prisma',
    });
  }
  return runCommand(process.execPath, [entry, ...args], {
    ...options,
    displayName: options.displayName ?? `prisma ${args.join(' ')}`,
  });
}

// ---------------------------------------------------------------------------
// Ports / HTTP readiness
// ---------------------------------------------------------------------------

export function portIsFree(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => server.close(() => resolvePromise(true)));
    server.listen(port, host);
  });
}

export async function waitForHttp(url, { timeoutMs = 60_000, intervalMs = 500, headers } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(Math.min(5_000, timeoutMs)),
      });
      if (response.status < 500) return { ok: true, status: response.status, response };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no response'}`);
}

export async function httpJson(url, options = {}) {
  const { timeoutMs = 15_000, token, ...fetchOptions } = options;
  const headers = {
    Accept: 'application/json',
    ...(fetchOptions.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOptions.headers ?? {}),
  };
  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, headers: response.headers, body, text };
}

/** Extracts an array from `{data,meta}` / `{items}` / plain arrays. */
export function itemsOf(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}
