#!/usr/bin/env node
/**
 * C-19 local security scan.
 *
 * Runs three independent gates and writes one redacted JSON result:
 *
 *   1. `scripts/security-smoke.mjs` - the repository guardrails (tracked env
 *      files, private keys, fail-closed JWT config, closed CORS, source secret
 *      patterns, CI workflow constraints).
 *   2. A working-tree scan that also covers untracked source files, so a new
 *      file cannot bypass the tracked-only smoke check. Only high-confidence
 *      credential patterns are reported; the matched value is never printed.
 *   3. `npm audit --omit=dev` for production dependencies. High/critical
 *      findings fail the gate. When the registry is unreachable the audit is
 *      recorded as a warning (the rest of the local pipeline stays runnable
 *      offline) and must be repeated before release.
 *
 * This is a guardrail, not a penetration test. Runtime authorization, pricing
 * and data-leak checks live in the API e2e suites.
 *
 *   node scripts/security-scan.mjs [--out <json>] [--log-dir <dir>]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  ensureDir,
  isMain,
  loadProjectEnv,
  manifestDirectory,
  nowIso,
  redactText,
  runCommand,
  runNpm,
  sha256File,
  tail,
  writeJson,
} from './lib/verify-common.mjs';

const SECRET_PATTERNS = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { id: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-live-key', re: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    id: 'hardcoded-secret-assignment',
    re: /(?:JWT_SECRET|SMTP_PASSWORD|SMTP_PASS|DATABASE_PASSWORD)\s*[:=]\s*['"`][^'"`\r\n]{8,}['"`]/,
  },
  {
    id: 'mysql-url-with-inline-credentials',
    re: /mysql(?:s)?:\/\/[^/\s:'"`]+:(?!PASSWORD|<|CHANGE|example)[^@\s'"`]{6,}@/i,
  },
];

/**
 * Production dependency audit scope.
 *
 * `npm audit --workspace` is used instead of a repository-wide audit so the
 * deployed Node services and the Expo build tooling are judged separately.
 * The Expo CLI advisories below have no patched SDK 57/58 release and are only
 * reachable from `expo start` / prebuild tooling, never from the shipped app
 * bundle. They are recorded as accepted risks on every run; anything outside
 * this list still fails the gate.
 */
const AUDIT_WORKSPACES = [
  { id: 'api', spec: '@agrimarket/api', gate: 'strict' },
  { id: 'admin-web', spec: '@agrimarket/admin-web', gate: 'strict' },
  { id: 'customer-web', spec: '@agrimarket/customer-web', gate: 'strict' },
  { id: 'mobile', spec: '@agrimarket/mobile', gate: 'expo-tooling' },
];

const EXPO_TOOLING_ADVISORIES = new Set([
  'expo',
  '@expo/cli',
  '@expo/code-signing-certificates',
  'node-forge',
  'zod',
]);

const SCANNABLE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|prisma|sql|sh|ps1)$/i;
const EXCLUDED = [
  /^node_modules\//,
  /^apps\/[^/]+\/node_modules\//,
  /^packages\/[^/]+\/node_modules\//,
  /^apps\/api\/(?:generated|dist|uploads)\//,
  /^apps\/[^/]+\/\.next\//,
  /^audit-reports\//,
  /^docs\//,
  /^scripts\//,
  /^\.tmp-verify\//,
  /^backups\//,
  /^\.kilo\//,
  /^\.playwright-mcp\//,
  /(?:^|\/)(?:test|tests|__tests__|spec)\//,
  /\.(?:spec|test)\.[cm]?[jt]sx?$/,
  /\.env\.example$/,
  /^package-lock\.json$/,
];

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function gitFiles(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || 'unknown error'}`);
  }
  return result.stdout.split('\0').filter(Boolean);
}

function isTextFile(file) {
  try {
    if (statSync(file).size > 2 * 1024 * 1024) return false;
    const buffer = readFileSync(file);
    return !buffer.includes(0);
  } catch {
    return false;
  }
}

function scanFile(relPath) {
  const absolute = join(ROOT, relPath);
  if (!existsSync(absolute) || !isTextFile(absolute)) return [];
  const findings = [];
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 20_000) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(line)) {
        findings.push({ file: relPath, line: index + 1, pattern: pattern.id });
      }
    }
  }
  return findings;
}

function parseAuditJson(stdout) {
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

async function runSecurityScan(options = {}) {
  const startedAt = nowIso();
  const outDir = ensureDir(options.outDir ?? join(ROOT, '.tmp-verify', 'c19', 'security'));
  const logDir = ensureDir(options.logDir ?? join(outDir, 'logs'));
  const smokeLog = join(logDir, 'security-smoke.log');

  const checks = [];
  const warnings = [];
  const failures = [];
  const findings = [];

  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  // 1. Existing repository guardrails --------------------------------------
  const smoke = await runCommand(
    process.execPath,
    [join(ROOT, 'scripts', 'security-smoke.mjs')],
    {
      cwd: ROOT,
      logFile: smokeLog,
      timeoutMs: 120_000,
      displayName: 'security-smoke.mjs',
      env: { NODE_ENV: 'test' },
    },
  );
  check(
    'security-smoke',
    smoke.code === 0,
    smoke.code === 0
      ? 'repository guardrails passed'
      : `exit ${smoke.code}: ${tail(smoke.stderr || smoke.stdout, 8) || 'no output'}`,
  );

  // 2. Working tree, including untracked source files -----------------------
  let tracked = [];
  try {
    tracked = gitFiles(['ls-files', '-z']);
  } catch (error) {
    check('git-tracked-files', false, error.message);
  }
  let working = [];
  try {
    working = gitFiles(['ls-files', '-co', '--exclude-standard', '-z']);
  } catch (error) {
    check('git-working-tree-files', false, error.message);
  }

  const trackedEnv = tracked
    .map((file) => file.split(sep).join('/'))
    .filter((file) => {
      const base = file.split('/').pop() ?? file;
      return base !== '.env.example' && (base === '.env' || base.startsWith('.env.'));
    });
  check(
    'no-tracked-env-files',
    trackedEnv.length === 0,
    trackedEnv.length ? trackedEnv.join(', ') : 'none',
  );

  const trackedKeys = tracked
    .map((file) => file.split(sep).join('/'))
    .filter((file) => {
      const base = file.split('/').pop() ?? file;
      return /\.(?:pem|key|p12|pfx)$/i.test(base) || /^id_(?:rsa|ecdsa|ed25519)$/i.test(base);
    });
  check(
    'no-tracked-private-keys',
    trackedKeys.length === 0,
    trackedKeys.length ? trackedKeys.join(', ') : 'none',
  );

  const scanned = new Set();
  for (const file of working) {
    const relPath = file.split(sep).join('/');
    if (!SCANNABLE.test(relPath)) continue;
    if (EXCLUDED.some((pattern) => pattern.test(relPath))) continue;
    scanned.add(relPath);
    findings.push(...scanFile(relPath));
  }
  check(
    'working-tree-secret-patterns',
    findings.length === 0,
    findings.length
      ? `${findings.length} finding(s); values are not printed`
      : `${scanned.size} file(s) scanned`,
  );

  // 3. Production dependency audits, scoped per workspace ------------------
  let audit = {
    status: 'NOT_RUN',
    vulnerabilities: null,
    workspaces: {},
    acceptedRisks: [],
    logs: {},
  };
  if (!options.skipAudit) {
    let anyUnavailable = false;
    let anyFailed = false;
    const totals = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

    for (const workspace of AUDIT_WORKSPACES) {
      const auditLog = join(logDir, `npm-audit-${workspace.id}.json`);
      audit.logs[workspace.id] = auditLog;
      const result = await runNpm(
        [
          'audit',
          '--omit=dev',
          '--audit-level=high',
          '--json',
          '--workspace',
          workspace.spec,
        ],
        {
          cwd: ROOT,
          logFile: auditLog,
          timeoutMs: 180_000,
          displayName: `npm audit --omit=dev --workspace ${workspace.spec}`,
          env: { NODE_ENV: 'test' },
        },
      );
      const parsed = parseAuditJson(result.stdout);
      if (parsed?.metadata?.vulnerabilities) {
        const vulnerabilities = parsed.metadata.vulnerabilities;
        for (const key of Object.keys(totals)) {
          totals[key] += Number(vulnerabilities[key] ?? 0);
        }
        const highCritical = Object.entries(parsed.vulnerabilities ?? {})
          .filter(([, entry]) => entry.severity === 'high' || entry.severity === 'critical')
          .map(([name, entry]) => ({
            name,
            severity: entry.severity,
            direct: Boolean(entry.isDirect),
            via: (entry.via ?? []).map((item) =>
              typeof item === 'string' ? item : item.title ?? item.name ?? 'unknown advisory',
            ),
          }));
        const accepted =
          workspace.gate === 'expo-tooling'
            ? highCritical.filter((entry) => EXPO_TOOLING_ADVISORIES.has(entry.name))
            : [];
        const violations = highCritical.filter(
          (entry) => !accepted.some((acceptedEntry) => acceptedEntry.name === entry.name),
        );

        audit.workspaces[workspace.id] = {
          workspace: workspace.spec,
          gate: workspace.gate,
          vulnerabilities,
          highCritical: highCritical.map((entry) => entry.name),
          violations: violations.map((entry) => entry.name),
          accepted: accepted.map((entry) => entry.name),
          totalDependencies: parsed.metadata.dependencies?.total ?? null,
          exitCode: result.code,
        };
        if (accepted.length > 0) {
          audit.acceptedRisks.push({
            workspace: workspace.spec,
            packages: accepted,
            reason:
              'Reachable only through Expo CLI/build tooling (not the shipped app bundle); ' +
              'no patched Expo SDK 57/58 release exists. Track upstream before native builds.',
          });
          warnings.push(
            `${workspace.id}: ${accepted.length} accepted Expo build-tooling advisory row(s) ` +
              `(${accepted.map((entry) => entry.name).join(', ')}); no runtime bundle path, ` +
              'no patched SDK release.',
          );
        }

        check(
          `production-dependency-audit:${workspace.id}`,
          violations.length === 0,
          violations.length === 0
            ? `0 high/critical${accepted.length ? ` (${accepted.length} accepted tooling row(s))` : ''}`
            : `${violations.length} high/critical: ${violations.map((entry) => entry.name).join(', ')}`,
        );
        if (violations.length > 0) anyFailed = true;
      } else {
        const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|audit endpoint/i.test(
          `${result.stdout}\n${result.stderr}`,
        );
        audit.workspaces[workspace.id] = {
          workspace: workspace.spec,
          gate: workspace.gate,
          status: offline ? 'UNAVAILABLE' : 'FAIL',
          exitCode: result.code,
          detail: offline ? 'registry unreachable' : 'could not parse npm audit JSON',
        };
        if (offline) {
          anyUnavailable = true;
          checks.push({
            name: `production-dependency-audit:${workspace.id}`,
            ok: true,
            detail: 'UNAVAILABLE (registry unreachable) - recorded as a warning',
          });
        } else {
          anyFailed = true;
          check(
            `production-dependency-audit:${workspace.id}`,
            false,
            tail(result.stderr || result.stdout, 6) || `exit ${result.code}`,
          );
        }
      }
    }

    audit.vulnerabilities = totals;
    audit.status = anyFailed ? 'FAIL' : anyUnavailable ? 'UNAVAILABLE' : 'PASS';
    if (anyUnavailable) {
      warnings.push(
        'At least one npm audit workspace could not reach the registry; repeat the audit before release.',
      );
    }
  } else {
    warnings.push('npm audit skipped by --skip-audit.');
  }

  // 4. High-signal runtime configuration guardrails ------------------------
  const mainPath = join(ROOT, 'apps', 'api', 'src', 'main.ts');
  if (existsSync(mainPath)) {
    const source = readFileSync(mainPath, 'utf8');
    const code = source
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    check(
      'cors-fails-closed',
      !/origin\s*:\s*true/.test(code) &&
        !/origin\s*:\s*['"`]\*['"`]/.test(code) &&
        code.includes('credentials: false'),
      'no reflected wildcard origin; credentials disabled',
    );
  } else {
    check('cors-fails-closed', false, 'apps/api/src/main.ts is missing');
  }

  const logManifest = await manifestDirectory(logDir);
  const result = {
    generatedAt: nowIso(),
    startedAt,
    completedAt: nowIso(),
    result: failures.length === 0 ? 'PASS' : 'FAIL',
    checks,
    findings,
    audit,
    warnings,
    versions: {
      node: process.version,
      npm: (() => {
        const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
          encoding: 'utf8',
          windowsHide: true,
          shell: process.platform === 'win32',
        });
        return npm.status === 0 ? npm.stdout.trim() : null;
      })(),
    },
    logs: {
      securitySmoke: relative(ROOT, smokeLog).split(sep).join('/'),
      audits: Object.fromEntries(
        Object.entries(audit.logs ?? {}).map(([id, file]) => [
          id,
          relative(ROOT, file).split(sep).join('/'),
        ]),
      ),
    },
    logManifest,
    failureCount: failures.length,
    failures,
  };
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/security-scan.mjs [options]

Options:
  --out <file>       Write the full result JSON here
  --log-dir <dir>    Directory for smoke/audit logs
                     (default: .tmp-verify/c19/security/logs)
  --skip-audit       Skip the network dependency audit (recorded as a warning)
  --help             Show this help

Exits 1 on a failed guardrail, a high/critical production dependency outside
the documented Expo build-tooling allowlist, or a working-tree secret pattern.
Matched secret values are never printed.`);
    process.exit(0);
  }
  loadProjectEnv();
  const result = await runSecurityScan({
    outDir: valueOf(args, '--out-dir', undefined),
    logDir: valueOf(args, '--log-dir', undefined),
    skipAudit: args.includes('--skip-audit'),
  });
  const out = valueOf(args, '--out');
  if (out) writeJson(out, result);

  console.log(`Security scan: ${result.result}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} - ${check.detail}`);
  }
  for (const warning of result.warnings) console.log(`  WARN  ${redactText(warning)}`);
  for (const finding of result.findings) {
    console.log(`  FAIL  ${finding.pattern} at ${finding.file}:${finding.line}`);
  }
  console.log(
    `  INFO  ${result.audit.status} production dependency audit` +
      (result.audit.vulnerabilities
        ? ` (${result.audit.vulnerabilities.total ?? 0} total advisory rows)`
        : ''),
  );
  for (const [id, workspace] of Object.entries(result.audit.workspaces ?? {})) {
    console.log(
      `    ${id}: ${workspace.violations?.length ?? 0} high/critical violation(s)` +
        (workspace.accepted?.length ? `, ${workspace.accepted.length} accepted tooling row(s)` : ''),
    );
  }
  process.exit(result.result === 'PASS' ? 0 : 1);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`Security scan failed: ${redactText(error.message)}`);
    process.exit(1);
  });
}
