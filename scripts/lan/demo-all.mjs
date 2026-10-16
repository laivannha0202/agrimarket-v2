#!/usr/bin/env node
/**
 * `npm run demo:all` — API + Admin Web + Customer Web + Expo Go on one LAN IP.
 *
 * Same discovery/readiness/env rules as demo:mobile, plus:
 * - starts Admin Web (3001) and Customer Web (3002) bound to 0.0.0.0 so other
 *   LAN devices can open them (Next `dev -H 0.0.0.0` default is already 0.0.0.0).
 * - API CORS for LAN Expo-Web origins is reported (not silently rewritten):
 *   when the current LAN IP is missing from CORS_ORIGIN the script prints the
 *   exact value to add and continues (Expo Go native needs no CORS).
 *
 * Ctrl+C stops every child this script started.
 *
 * Usage:
 *   npm run demo:all [--lan-ip=10.0.0.5] [--port=3000] [--no-start-api]
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import {
  API_DEFAULT_PORT,
  EXPO_DEFAULT_PORT,
  buildApiBaseUrl,
  checkApiReadiness,
  checkTcpOpen,
  discoverLan,
  getWindowsPortOwner,
  parseCliArgs,
  syncEnvVar,
  validateApiBaseUrl,
} from "./lib.mjs";

const args = parseCliArgs(process.argv.slice(2));
const port = Number(args.port ?? args.apiPort ?? API_DEFAULT_PORT);
const overrideIp = args.lanIp ?? args.lan ?? undefined;
const wantStartApi = args.startApi !== false && args.noStartApi !== true && args.noApi !== true;
const ADMIN_PORT = Number(args.adminPort ?? 3001);
const CUSTOMER_PORT = Number(args.customerPort ?? 3002);

if (args.help || args.h) {
  console.log(`Usage: npm run demo:all [--lan-ip=10.0.0.5] [--port=3000] [--no-start-api]\n\nStarts API + Admin Web + Customer Web + Expo Go on the discovered LAN IP.`);
  process.exit(0);
}

const children = new Map(); // name -> child
let stopping = false;

function log(msg) {
  console.log(`[demo:all] ${msg}`);
}

function spawnNamed(name, cmd, argv, opts) {
  const child = spawn(cmd, argv, opts);
  children.set(name, child);
  child.on("exit", () => {
    if (children.get(name) === child) children.delete(name);
  });
  return child;
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal} — stopping ${children.size} child process(es)...`);
  for (const [, c] of children) {
    try { c.kill("SIGINT"); } catch {}
  }
  setTimeout(() => {
    for (const [, c] of children) {
      try { c.kill("SIGTERM"); } catch {}
    }
    process.exit(0);
  }, 6000).unref();
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(sig));

async function waitFor(cond, { tries = 40, delayMs = 3000, label = "condition" } = {}) {
  for (let i = 1; i <= tries; i += 1) {
    if (await cond()) return true;
    log(`waiting for ${label} (${i}/${tries})...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function ensurePortFreeOrOurs(portToCheck, label) {
  const open = await checkTcpOpen("127.0.0.1", portToCheck, 1500);
  if (!open) return true;
  const owner = getWindowsPortOwner(portToCheck);
  if (owner?.listening && owner.isAgrimarket) {
    log(`${label} port ${portToCheck} already serves AgriMarket (pid ${owner.pid}) — reusing.`);
    return false;
  }
  if (owner?.listening) {
    throw new Error(
      `${label} port ${portToCheck} is held by a foreign process (pid ${owner.pid} ${owner.processName ?? ""}). Refusing to kill — free it and retry.`,
    );
  }
  log(`${label} port ${portToCheck} is busy (owner unknown) — refusing to kill. Free it and retry.`);
  throw new Error(`${label} port ${portToCheck} busy.`);
}

try {
  const lan = await discoverLan({ overrideIp });
  log(`LAN IP: ${lan.ip} (iface ${lan.interface}, method ${lan.method})`);
  for (const w of lan.warnings ?? []) log(`WARN: ${w}`);
  const apiBaseUrl = buildApiBaseUrl(lan.ip, port);
  const v = validateApiBaseUrl(apiBaseUrl);
  if (!v.ok) throw new Error(`Generated URL invalid: ${v.errors.join("; ")}`);

  // ---- API ----
  let ready = await checkApiReadiness({ lanIp: lan.ip, port });
  const portOpen = ready.checks.find((c) => c.name === `port ${port} listening`)?.ok;
  if (ready.ok) {
    log(`API already healthy at ${apiBaseUrl} — reusing.`);
  } else if (!portOpen && wantStartApi) {
    log('Starting backend "npm run dev:api"...');
    spawnNamed("api", "npm", ["run", "dev:api"], { stdio: "inherit", shell: true });
    const healthy = await waitFor(async () => (await checkApiReadiness({ lanIp: lan.ip, port })).ok, {
      label: "API readiness",
    });
    if (!healthy) throw new Error("Backend did not become healthy. Check MySQL + apps/api/.env.");
    ready = await checkApiReadiness({ lanIp: lan.ip, port });
  } else if (!portOpen) {
    throw new Error('Backend is down and --no-start-api was given. Run "npm run dev:api" first.');
  } else {
    const owner = getWindowsPortOwner(port);
    if (owner?.listening && !owner.isAgrimarket) {
      throw new Error(`Port ${port} held by foreign pid ${owner.pid} — refusing to kill.`);
    }
    throw new Error("API unhealthy — fix it before starting the web/Expo stack. Refusing to kill anything.");
  }

  // ---- CORS notice for LAN Expo-Web (native Expo Go needs no CORS) ----
  try {
    const apiEnv = fs.readFileSync("apps/api/.env", "utf8");
    const hasLanExpo = apiEnv.includes(`${lan.ip}:8081`);
    if (!hasLanExpo) {
      log(
        `NOTE: apps/api/.env CORS_ORIGIN lacks http://${lan.ip}:8081 — Expo *Web* opened from another LAN device will be blocked by CORS. ` +
          `To allow it, add "http://${lan.ip}:8081,http://${lan.ip}:8082" to CORS_ORIGIN (exact origins, never "*") and restart the API. ` +
          `Expo Go native is unaffected. Continuing without changing CORS.`,
      );
    }
  } catch {}

  // ---- Mobile env ----
  const envPath = "apps/mobile/.env";
  const res = syncEnvVar(envPath, "EXPO_PUBLIC_API_BASE_URL", apiBaseUrl, [
    "# Local-only config (git-ignored). Managed by `npm run demo:all` — do not commit.",
  ]);
  log(`apps/mobile/.env: ${res.action} EXPO_PUBLIC_API_BASE_URL=${apiBaseUrl}`);

  // ---- Admin + Customer ----
  if (await ensurePortFreeOrOurs(ADMIN_PORT, "Admin Web")) {
    log(`Starting Admin Web on :${ADMIN_PORT}...`);
    spawnNamed("admin", "npm", ["run", "dev:admin"], { stdio: "inherit", shell: true });
  }
  if (await ensurePortFreeOrOurs(CUSTOMER_PORT, "Customer Web")) {
    log(`Starting Customer Web on :${CUSTOMER_PORT}...`);
    spawnNamed("customer", "npm", ["run", "dev:customer"], { stdio: "inherit", shell: true });
  }

  // ---- Expo ----
  if (await checkTcpOpen("127.0.0.1", EXPO_DEFAULT_PORT, 1500)) {
    log(`WARN: Metro port ${EXPO_DEFAULT_PORT} busy — may serve a stale bundle. Not killing it for you.`);
  }
  log(`Starting Expo (LAN) with EXPO_PUBLIC_API_BASE_URL=${apiBaseUrl}`);
  log(`LAN URLs: API http://${lan.ip}:${port}/api/v1 · Admin http://${lan.ip}:${ADMIN_PORT} · Customer http://${lan.ip}:${CUSTOMER_PORT}`);
  log("On this PC the webs keep using http://localhost:3000/api/v1. Only phones/other LAN devices use the LAN IP.");
  spawnNamed("expo", "npm", ["run", "dev:lan", "--workspace", "@agrimarket/mobile"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, EXPO_PUBLIC_API_BASE_URL: apiBaseUrl },
  });

  // Stay alive until Ctrl+C; surface the first child exit.
  const firstExit = await new Promise((resolve) => {
    const timer = setInterval(() => {
      for (const [name, c] of children) {
        if (c.exitCode !== null) {
          clearInterval(timer);
          resolve({ name, code: c.exitCode });
        }
      }
      if (children.size === 0) {
        clearInterval(timer);
        resolve({ name: "(all exited)", code: 0 });
      }
    }, 1000);
  });
  log(`child "${firstExit.name}" exited with code ${firstExit.code} — stopping the rest.`);
  shutdown("child-exit");
} catch (e) {
  console.error(`[demo:all] ERROR: ${e?.message ?? e}`);
  for (const [, c] of children) {
    try { c.kill("SIGINT"); } catch {}
  }
  process.exit(1);
}
