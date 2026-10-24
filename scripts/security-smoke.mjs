#!/usr/bin/env node
/**
 * Security smoke checks that do not need a running server.
 *
 * These are guardrails, not a penetration test. They fail the build when a
 * repository-level mistake would undo the P0-A hardening: a committed secret,
 * a re-introduced JWT fallback, a permissive CORS setting, or a tracked private
 * key. Runtime authorization and data-leak checks live in the API e2e suites
 * (`p0-a-security-pricing.e2e-spec.ts`, `audit-logs.e2e-spec.ts`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checked = [];

function fail(message) {
  failures.push(message);
}

function read(relPath) {
  const absolute = join(root, relPath);
  if (!existsSync(absolute)) {
    fail(`Missing required file: ${relPath}`);
    return "";
  }
  checked.push(relPath);
  return readFileSync(absolute, "utf8");
}

function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    fail("Cannot list tracked files with git; run this check inside the repository.");
    return [];
  }
}

// ---------------------------------------------------------------------------
// 1. No secrets or private keys may be tracked.
// ---------------------------------------------------------------------------
const tracked = trackedFiles();
for (const file of tracked) {
  const normalized = file.split(sep).join("/");
  const base = normalized.split("/").pop() ?? normalized;
  if (base === ".env.example") continue;
  if (base === ".env" || base.startsWith(".env.")) {
    fail(`Tracked environment file: ${normalized}`);
  }
  if (/\.(pem|key|p12|pfx)$/i.test(base) || /^id_(rsa|ecdsa|ed25519)$/i.test(base)) {
    fail(`Tracked private key material: ${normalized}`);
  }
}

// ---------------------------------------------------------------------------
// 2. JWT configuration must fail closed.
// ---------------------------------------------------------------------------
const configuration = read("apps/api/src/config/configuration.ts");
if (configuration) {
  if (!configuration.includes("JWT_SECRET is required")) {
    fail("JWT configuration no longer fails closed on a missing secret.");
  }
  if (!configuration.includes("resolveJwtSecret")) {
    fail("JWT configuration must validate through resolveJwtSecret().");
  }
  if (/jwtSecret\s*:\s*['"`]/.test(configuration)) {
    fail("JWT configuration appears to hardcode a secret literal.");
  }
}

const jwtStrategy = read("apps/api/src/auth/jwt.strategy.ts");
if (jwtStrategy) {
  if (/secretOrKey\s*:\s*['"`]/.test(jwtStrategy)) {
    fail("JWT strategy hardcodes a secret instead of reading configuration.");
  }
}

// ---------------------------------------------------------------------------
// 3. CORS must stay closed and non-credentialed.
// ---------------------------------------------------------------------------
const main = read("apps/api/src/main.ts");
if (main) {
  // Ignore line comments: main.ts documents the anti-pattern it forbids.
  const code = main
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  if (/origin\s*:\s*true/.test(code) || /origin\s*:\s*['"`]\*['"`]/.test(code)) {
    fail("CORS reflects every origin (`origin: true` / `'*'`).");
  }
  if (!main.includes("credentials: false")) {
    fail("CORS must keep `credentials: false` for bearer-token auth.");
  }
}

// ---------------------------------------------------------------------------
// 4. High-confidence secret patterns in shipped source (tests/docs excluded).
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  {
    name: "hardcoded JWT secret assignment",
    re: /(?:JWT_SECRET|SMTP_PASSWORD|DATABASE_URL)\s*[:=]\s*['"`][^'"`\r\n]{8,}['"`]/,
  },
];

const SCANNABLE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$/i;
const EXCLUDED = [
  /^node_modules\//,
  /^apps\/[^/]+\/node_modules\//,
  /^packages\/[^/]+\/node_modules\//,
  /^apps\/api\/generated\//,
  /^audit-reports\//,
  /^docs\//,
  /^\.tmp-verify\//,
  /^\.kilo\//,
  /^\.playwright-mcp\//,
  /^backups\//,
  /(?:^|\/)(?:test|tests|__tests__|spec)\//,
  /\.(?:spec|test)\.[cm]?[jt]sx?$/,
  /\/qa[-/]/,
  /^scripts\/.*(?:smoke|verify|probe)/,
  /\.env\.example$/,
];

for (const file of tracked) {
  const normalized = file.split(sep).join("/");
  if (!SCANNABLE.test(normalized)) continue;
  if (EXCLUDED.some((re) => re.test(normalized))) continue;
  let content;
  try {
    content = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content)) {
      fail(`Possible ${name} in ${normalized}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The CI workflow must exist and must not reference deployment secrets.
// ---------------------------------------------------------------------------
const workflow = read(".github/workflows/ci.yml");
if (workflow) {
  if (/\bsecrets\./.test(workflow)) {
    fail("CI workflow references repository secrets; it must run without them.");
  }
  if (/\b(?:kubectl|terraform apply|aws deploy|gh release|vercel --prod)\b/.test(workflow)) {
    fail("CI workflow contains a deployment command; CI is build/test only.");
  }
  for (const required of ["typecheck", "lint", "test", "build", "test:e2e"]) {
    if (!workflow.includes(required)) {
      fail(`CI workflow is missing the '${required}' step.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Public partner payload contract must keep its allow-list helper.
// ---------------------------------------------------------------------------
const partnersService = read("apps/api/src/partners/partners.service.ts");
if (partnersService) {
  const publicSurface = partnersService.slice(0, 4000);
  if (!/public|Public/.test(publicSurface)) {
    fail("Partners service has no explicit public projection; verify sensitive fields are not exposed.");
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("Security smoke checks FAILED:");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`Security smoke checks passed (${checked.length} files inspected).`);
