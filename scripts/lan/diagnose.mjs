#!/usr/bin/env node
/**
 * Diagnose the stable-LAN setup without starting or changing anything.
 *
 * Read-only: prints network detail, LAN discovery result, API readiness,
 * Expo/Metro port state, firewall profile and CORS config. Never writes
 * files, never kills processes, never touches the database.
 *
 * Usage:
 *   node scripts/lan/diagnose.mjs [--lan-ip=10.0.0.5] [--port=3000]
 *   AGRIMARKET_LAN_IP=10.0.0.5 node scripts/lan/diagnose.mjs
 */

import {
  API_DEFAULT_PORT,
  checkApiReadiness,
  checkTcpOpen,
  discoverLan,
  getWindowsPortOwner,
  parseCliArgs,
  redactEnvLine,
} from "./lib.mjs";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

const args = parseCliArgs(process.argv.slice(2));
const port = Number(args.port ?? args.apiPort ?? API_DEFAULT_PORT);
const overrideIp = args.lanIp ?? args.lan ?? undefined;

if (args.help || args.h) {
  console.log(`Usage: pnpm lan:diagnose [--lan-ip=10.0.0.5] [--port=3000]\n\nRead-only diagnosis: LAN discovery, API readiness, Metro ports, firewall profile, CORS. Changes nothing.`);
  process.exit(0);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`FAIL: ${msg}`);
};

try {
  section("1. LAN discovery (no cache, no hardcode)");
  const lan = await discoverLan({ overrideIp });
  console.log(`LAN IP: ${lan.ip} (iface ${lan.interface}, method ${lan.method})`);
  if (lan.gateway) console.log(`Gateway: ${lan.gateway}`);
  for (const w of lan.warnings ?? []) console.log(`WARN: ${w}`);

  section("2. API readiness (read-only probes)");
  const ready = await checkApiReadiness({ lanIp: lan.ip, port });
  for (const c of ready.checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name} — ${c.detail}`);
  if (ready.portOwner?.listening) {
    const o = ready.portOwner;
    console.log(
      `Port ${port} owner: pid=${o.pid} ${o.processName ?? ""} agrimarket=${o.isAgrimarket ? "yes" : "no (foreign process — will not kill)"}`,
    );
    if (o.commandLine) console.log(`  cmd: ${o.commandLine}`);
  }
  if (ready.errorKind === "network") console.log("NOTE: failures are network-class (status 0) — Wi-Fi/API-down, not business errors.");
  if (ready.errorKind === "http") console.log("NOTE: server answered with HTTP errors — NOT a Wi-Fi failure. Do not report as network.");
  if (!ready.ok) fail("API readiness has failing checks (see above).");

  section("3. Expo / Metro ports");
  for (const p of [8081, 8082]) {
    const open = await checkTcpOpen("127.0.0.1", p, 1500);
    const owner = getWindowsPortOwner(p);
    console.log(
      `Port ${p}: ${open ? "LISTENING" : "free"}` +
        (owner?.listening ? ` (pid ${owner.pid} ${owner.processName ?? ""})` : ""),
    );
  }
  console.log(`EXPO_PUBLIC_API_BASE_URL for this LAN: http://${lan.ip}:${port}/api/v1`);

  section("4. Firewall + network profile (diagnose only, no changes)");
  try {
    const profile = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory | ConvertTo-Json -Compress"],
      { encoding: "utf8", timeout: 15000 },
    ).trim();
    console.log(`Connection profiles: ${profile}`);
    const rules = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-NetFirewallRule -Direction Inbound | Where-Object { $_.DisplayName -match 'node\\.exe|Node\\.js' } | Select-Object DisplayName, Enabled, Action | ConvertTo-Json -Compress"],
      { encoding: "utf8", timeout: 15000 },
    ).trim();
    console.log(`Inbound node rules: ${rules || "(none found)"}`);
  } catch {
    console.log("(firewall lookup unavailable — non-Windows or restricted shell)");
  }

  section("5. CORS config (keys only, secrets redacted)");
  if (fs.existsSync("apps/api/.env")) {
    for (const line of fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)) {
      if (/^\s*(CORS_ORIGIN|PORT|PUBLIC_API_BASE_URL|UPLOADS_DIR)\s*=/.test(line)) console.log(redactEnvLine(line));
    }
    console.log(`CORS covers http://${lan.ip}:8081: ${fs.readFileSync("apps/api/.env", "utf8").includes(`${lan.ip}:8081`) ? "yes" : "no (Expo Web from LAN needs it; Expo Go native does not)"}`);
  } else {
    console.log("(apps/api/.env missing)");
  }
} catch (e) {
  fail(e?.message ?? String(e));
  if (e?.code === "AMBIGUOUS_LAN") console.log("Hint: re-run with --lan-ip=<one-of-the-listed-IPs>.");
}

console.log(failed ? "\nDIAGNOSE: ISSUES FOUND" : "\nDIAGNOSE: OK");
process.exit(failed ? 1 : 0);
