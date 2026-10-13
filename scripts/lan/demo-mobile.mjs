#!/usr/bin/env node
/**
 * `pnpm demo:mobile` — one-command stable LAN startup for API + Expo Go.
 *
 * 1. Discovers the current LAN IPv4 (no cache, no hardcode; --lan-ip override).
 * 2. Checks Backend health (reuses a healthy API, starts `pnpm dev:api` when
 *    the port is free, refuses to kill foreign processes).
 * 3. Writes ONLY EXPO_PUBLIC_API_BASE_URL into apps/mobile/.env (gitignored),
 *    preserving every other line, then launches `expo start --lan` with the
 *    variable also injected into the Expo process environment (so the bundle
 *    is guaranteed to embed the fresh URL even if Metro reuses a cache).
 *
 * Ctrl+C stops every child this script started (API if it started it + Expo).
 *
 * Usage:
 *   pnpm demo:mobile [--lan-ip=10.0.0.5] [--port=3000] [--no-start-api] [--expo-args="--clear"]
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
const expoExtra = (args.expoArgs ?? "").split(" ").filter(Boolean);

if (args.help || args.h) {
  console.log(`Usage: pnpm demo:mobile [--lan-ip=10.0.0.5] [--port=3000] [--no-start-api] [--expo-args="--clear"]\n\nDiscovers the LAN IP, ensures the API is healthy, syncs apps/mobile/.env and starts Expo Go (LAN).`);
  process.exit(0);
}

const children = new Set();
let stopping = false;

function log(msg) {
  console.log(`[demo:mobile] ${msg}`);
}

function spawnTracked(cmd, argv, opts) {
  const child = spawn(cmd, argv, opts);
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal} — stopping ${children.size} child process(es)...`);
  for (const c of children) {
    try {
      c.kill("SIGINT");
    } catch {}
  }
  setTimeout(() => {
    for (const c of children) {
      try {
        c.kill("SIGTERM");
      } catch {}
    }
    process.exit(0);
  }, 5000).unref();
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

try {
  // ---- 1. LAN discovery ----
  const lan = await discoverLan({ overrideIp });
  log(`LAN IP: ${lan.ip} (iface ${lan.interface}, method ${lan.method})`);
  for (const w of lan.warnings ?? []) log(`WARN: ${w}`);
  const apiBaseUrl = buildApiBaseUrl(lan.ip, port);
  const v = validateApiBaseUrl(apiBaseUrl);
  if (!v.ok) throw new Error(`Generated URL invalid: ${v.errors.join("; ")}`);

  // ---- 2. Backend readiness ----
  let ready = await checkApiReadiness({ lanIp: lan.ip, port });
  const portOpen = ready.checks.find((c) => c.name === `port ${port} listening`)?.ok;
  if (ready.ok) {
    log(`API already healthy at ${apiBaseUrl} — reusing (no restart).`);
  } else if (!portOpen && wantStartApi) {
    log(`Port ${port} is free — starting backend with "pnpm dev:api"...`);
    const apiChild = spawnTracked("pnpm", ["dev:api"], { stdio: "inherit", shell: true });
    log(`API starting (pid ${apiChild.pid})...`);
    const healthy = await waitFor(
      async () => (await checkApiReadiness({ lanIp: lan.ip, port })).ok,
      { label: "API readiness" },
    );
    if (!healthy) {
      try { apiChild.kill("SIGINT"); } catch {}
      throw new Error(`Backend did not become healthy on port ${port}. Check MySQL + apps/api/.env, then retry.`);
    }
    ready = await checkApiReadiness({ lanIp: lan.ip, port });
    log("Backend is healthy.");
  } else if (!portOpen && !wantStartApi) {
    throw new Error(`Backend is down and --no-start-api was given. Start it manually with "pnpm dev:api".`);
  } else {
    const owner = getWindowsPortOwner(port);
    for (const c of ready.checks.filter((c) => !c.ok)) log(`CHECK FAIL: ${c.name} — ${c.detail}`);
    if (owner?.listening && !owner.isAgrimarket) {
      throw new Error(
        `Port ${port} is held by a foreign process (pid ${owner.pid} ${owner.processName ?? ""}). Refusing to kill it — stop it yourself or free the port, then retry.`,
      );
    }
    if (ready.errorKind === "http") {
      throw new Error("API answered with HTTP errors (NOT a Wi-Fi failure). Fix the backend before starting Expo.");
    }
    throw new Error(`API on port ${port} is unhealthy (not a foreign port-takeover). Fix it, then retry. Refusing to kill anything.`);
  }

  // ---- 3. Expo env (file + process injection) ----
  const envPath = "apps/mobile/.env";
  const res = syncEnvVar(envPath, "EXPO_PUBLIC_API_BASE_URL", apiBaseUrl, [
    "# Local-only config (git-ignored). Managed by `pnpm demo:mobile` — do not commit.",
    "# Re-generated on every demo start from the current LAN IP; safe to delete.",
  ]);
  log(`apps/mobile/.env: ${res.action} EXPO_PUBLIC_API_BASE_URL=${apiBaseUrl}`);

  // ---- 4. Warn when Metro already runs with a stale URL ----
  if (await checkTcpOpen("127.0.0.1", EXPO_DEFAULT_PORT, 1500)) {
    log(
      `WARN: something already listens on Metro port ${EXPO_DEFAULT_PORT} — it may serve a bundle with the OLD API URL. ` +
        `Stop that Expo instance first (Ctrl+C there), or the phone keeps calling the stale backend. Not killing it for you.`,
    );
  }

  // ---- 5. Launch Expo LAN ----
  log(`Starting Expo (LAN) with EXPO_PUBLIC_API_BASE_URL=${apiBaseUrl}`);
  log("If the Wi-Fi/hotspot changes later, stop (Ctrl+C) and re-run: the bundle does NOT pick up a new IP by itself.");
  const expoChild = spawnTracked(
    "pnpm",
    ["--filter", "@agrimarket/mobile", "exec", "expo", "start", "--lan", ...expoExtra],
    {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, EXPO_PUBLIC_API_BASE_URL: apiBaseUrl },
    },
  );
  const code = await new Promise((resolve) => expoChild.on("close", resolve));
  process.exit(typeof code === "number" ? code : 0);
} catch (e) {
  console.error(`[demo:mobile] ERROR: ${e?.message ?? e}`);
  if (e?.code === "AMBIGUOUS_LAN") console.error("[demo:mobile] Hint: re-run with --lan-ip=<one-of-the-listed-IPs>.");
  for (const c of children) {
    try { c.kill("SIGINT"); } catch {}
  }
  process.exit(1);
}
