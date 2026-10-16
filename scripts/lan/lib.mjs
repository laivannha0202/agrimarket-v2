/**
 * Shared helpers for AgriMarket V2 stable-LAN demo scripts.
 *
 * Plain Node.js only (no dependencies). All functions are pure or do explicit
 * I/O so they can be unit-tested with `node --test`.
 */

import { execFileSync } from "node:child_process";
import * as dgram from "node:dgram";
import * as net from "node:net";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

export const API_DEFAULT_PORT = 3000;
export const EXPO_DEFAULT_PORT = 8081;

/** Names that are never the phone-reachable LAN (case-insensitive substrings). */
const VIRTUAL_NAME_PATTERNS = [
  /vbox/i,
  /vmware/i,
  /docker/i,
  /\bwsl\b/i,
  /hyper-?v/i,
  /vethernet/i,
  /tailscale/i,
  /zerotier/i,
  /wireguard/i,
  /openvpn/i,
  /\bvgate/i,
  /wintun/i,
  /\btap\b/i,
  /bluetooth/i,
  /loopback/i,
  /pseudo/i,
  /miniport/i,
];

export function isValidIPv4(ip) {
  if (typeof ip !== "string") return false;
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((oct) => {
    if (oct.length > 1 && oct.startsWith("0")) return false; // reject 01, 001
    const n = Number(oct);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function isApipa(ip) {
  return typeof ip === "string" && ip.trim().startsWith("169.254.");
}

export function isLoopbackIp(ip) {
  if (!isValidIPv4(ip)) return false;
  const t = ip.trim();
  return t === "127.0.0.1" || t.startsWith("127.");
}

export function isVirtualInterfaceName(name) {
  if (!name) return false;
  return VIRTUAL_NAME_PATTERNS.some((re) => re.test(name));
}

/** `http://host:port/api/v1` without trailing slash. Throws on bad input. */
export function buildApiBaseUrl(ip, port = API_DEFAULT_PORT) {
  if (!isValidIPv4(ip)) throw new Error(`Invalid LAN IP: ${ip}`);
  if (isLoopbackIp(ip)) throw new Error(`Refusing loopback IP for phone use: ${ip}`);
  if (isApipa(ip)) throw new Error(`Refusing APIPA address (not a usable LAN): ${ip}`);
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Invalid port: ${port}`);
  if (p === EXPO_DEFAULT_PORT) {
    throw new Error(`Port ${p} is Metro/Expo, not the backend API (expected ${API_DEFAULT_PORT}).`);
  }
  return `http://${ip.trim()}:${p}/api/v1`;
}

/** Validate a full EXPO_PUBLIC_API_BASE_URL value. Returns { ok, errors }. */
export function validateApiBaseUrl(url) {
  const errors = [];
  const raw = (url ?? "").trim();
  if (!raw) errors.push("empty URL");
  if (/localhost|127\.0\.0\.1/i.test(raw)) errors.push("points at localhost (unreachable from a real phone)");
  if (/\/api\/v1\/api\/v1|\/api\/v1\/?\/api\/v1/.test(raw)) errors.push("duplicated /api/v1 path");
  if (!/\/api\/v1\/?$/.test(raw)) errors.push("must end with /api/v1");
  const m = raw.match(/^https?:\/\/([^/:]+)(:(\d+))?/i);
  if (!m) {
    errors.push("not a valid http(s) URL");
  } else {
    const host = m[1];
    const port = m[3] ? Number(m[3]) : 80;
    if (!isValidIPv4(host)) errors.push(`host is not an IPv4 LAN address: ${host}`);
    else {
      if (isLoopbackIp(host)) errors.push("host is loopback");
      if (isApipa(host)) errors.push("host is APIPA 169.254.x.x");
    }
    if (port === EXPO_DEFAULT_PORT) errors.push(`port ${port} is Metro, not the API (expected ${API_DEFAULT_PORT})`);
  }
  return { ok: errors.length === 0, errors };
}

/** Minimal .env parser that preserves line order/comments for safe rewrites. */
export function parseEnvText(text) {
  const lines = text.split(/\r?\n/);
  const vars = new Map();
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) vars.set(m[1], m[2]);
  }
  return { lines, vars };
}

/**
 * Update (or append) a single KEY in a .env file, preserving every other
 * line byte-for-byte. Creates the file with a short header when missing.
 * Never touches other keys. Returns { changed, action, path }.
 */
export function syncEnvVar(filePath, key, value, headerLines = []) {
  const newLine = `${key}=${value}`;
  if (!fs.existsSync(filePath)) {
    const header = headerLines.length > 0 ? headerLines.join("\n") + "\n" : "";
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${header}${newLine}\n`, "utf8");
    return { changed: true, action: "created", path: filePath };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const hasKey = new RegExp(`^\\s*${key}\\s*=`, "m").test(text);
  if (!hasKey) {
    const sep = text.endsWith("\n") || text.length === 0 ? "" : "\n";
    fs.writeFileSync(filePath, `${text}${sep}${newLine}\n`, "utf8");
    return { changed: true, action: "appended", path: filePath };
  }
  const keyRe = new RegExp(`^\\s*${key}\\s*=`);
  const updated = text
    .split(/\r?\n/)
    .map((line) => (keyRe.test(line) ? newLine : line))
    .join("\n");
  // Only non-comment lines match `^\s*KEY=`; commented lines (`# KEY=...`)
  // never match and are preserved byte-for-byte.
  const normalized = updated.endsWith("\n") ? updated : `${updated}\n`;
  const current = text.endsWith("\n") ? text : `${text}\n`;
  if (normalized === current) return { changed: false, action: "unchanged", path: filePath };
  fs.writeFileSync(filePath, normalized, "utf8");
  return { changed: true, action: "updated", path: filePath };
}

/** UDP trick: which local address would reach the Internet (default route). */
export function getOutboundIp(target = "8.8.8.8", port = 80, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const done = (value) => {
      try {
        sock.close();
      } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
    sock.connect(port, target, () => {
      try {
        const addr = sock.address();
        clearTimeout(timer);
        done(typeof addr === "object" && addr.address ? addr.address : null);
      } catch {
        clearTimeout(timer);
        done(null);
      }
    });
  });
}

/** Candidates from Node's view (no admin rights needed). */
export function candidatesFromOs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      out.push({ name, address: a.address, netmask: a.netmask, cidr: a.cidr, source: "os" });
    }
  }
  return out;
}

function runPowershellJson(command) {
  const raw = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Detailed Windows view: alias + description + IPv4 + gateway, plus the
 * IPv4 default-route table (metric decides Wi-Fi vs Ethernet).
 * Returns null when PowerShell is unavailable (non-Windows CI).
 */
export function windowsNetDetail() {
  if (process.platform !== "win32") return null;
  try {
    const configs = runPowershellJson(
      "Get-NetIPConfiguration | Where-Object { $_.IPv4Address -ne $null } | " +
        "Select-Object InterfaceAlias, InterfaceDescription, " +
        "@{n='Addrs';e={@($_.IPv4Address | Select-Object IPAddress, PrefixLength)}}, " +
        "@{n='Gw';e={@($_.IPv4DefaultGateway | Select-Object NextHop)}} | ConvertTo-Json -Depth 4 -Compress",
    );
    const routes = runPowershellJson(
      "Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' } | " +
        "Select-Object InterfaceAlias, NextHop, RouteMetric | ConvertTo-Json -Depth 3 -Compress",
    );
    return { configs, routes };
  } catch {
    return null;
  }
}

/**
 * Discover the phone-reachable LAN IPv4.
 *
 * Rules (no cache, no hardcode):
 * - drop loopback/internal, APIPA 169.254.x.x, /32 tunnel addresses
 * - drop virtual/VPN/WSl/Docker/Hyper-V/Bluetooth names
 * - rank remaining by: has IPv4 default gateway, lowest route metric,
 *   outbound-interface match, Wi-Fi/Ethernet preference
 * - 0 candidates -> error; >1 without a clear default route -> ambiguous error
 * - AGRIMARKET_LAN_IP / --lan-ip override must be a local, usable IPv4
 */
export async function discoverLan(options = {}) {
  const overrideRaw = (options.overrideIp ?? process.env.AGRIMARKET_LAN_IP ?? "").trim();

  const collectCandidates = () => {
    const detail = windowsNetDetail();
    if (detail) {
      const metricByAlias = new Map();
      for (const r of detail.routes ?? []) {
        if (r?.InterfaceAlias == null) continue;
        const m = Number(r.RouteMetric);
        if (!metricByAlias.has(r.InterfaceAlias) || m < metricByAlias.get(r.InterfaceAlias)) {
          metricByAlias.set(r.InterfaceAlias, m);
        }
      }
      const out = [];
      const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      for (const c of detail.configs ?? []) {
        const alias = c?.InterfaceAlias ?? "";
        const descr = c?.InterfaceDescription ?? "";
        for (const a of asArray(c?.Addrs)) {
          const ip = a?.IPAddress;
          if (!ip || typeof ip !== "string") continue;
          out.push({
            name: alias,
            description: descr,
            address: ip,
            prefixLength: a?.PrefixLength,
            gateway: asArray(c?.Gw)[0]?.NextHop ?? null,
            metric: metricByAlias.get(alias) ?? null,
            source: "netip",
          });
        }
      }
      return out;
    }
    return candidatesFromOs();
  };

  const all = collectCandidates();
  const localAddresses = new Set(all.map((c) => c.address));

  if (overrideRaw) {
    if (!isValidIPv4(overrideRaw)) throw new Error(`Invalid override IP "${overrideRaw}" (expected dotted IPv4).`);
    if (isLoopbackIp(overrideRaw)) throw new Error(`Override IP "${overrideRaw}" is loopback (unreachable from a phone).`);
    if (isApipa(overrideRaw)) throw new Error(`Override IP "${overrideRaw}" is APIPA 169.254.x.x (not a usable LAN).`);
    if (!localAddresses.has(overrideRaw)) {
      throw new Error(
        `Override IP "${overrideRaw}" is not assigned to this machine (local: ${[...localAddresses].join(", ") || "none"}).`,
      );
    }
    const hit = all.find((c) => c.address === overrideRaw);
    return {
      ip: overrideRaw,
      interface: hit?.name ?? "override",
      description: hit?.description ?? "",
      method: "override",
      gateway: hit?.gateway ?? null,
      candidates: all,
      warnings: [],
    };
  }

  const usable = all.filter((c) => {
    if (!isValidIPv4(c.address)) return false;
    if (isLoopbackIp(c.address) || isApipa(c.address)) return false;
    if (isVirtualInterfaceName(c.name) || isVirtualInterfaceName(c.description)) return false;
    if (c.prefixLength === 32) return false; // point-to-point tunnels (VPN/Wintun)
    return true;
  });

  if (usable.length === 0) {
    const seen = all.map((c) => `${c.name}=${c.address}`).join(", ") || "none";
    throw new Error(`No usable LAN IPv4 found (seen: ${seen}). Connect to Wi-Fi/Ethernet first.`);
  }

  const outbound = await getOutboundIp().catch(() => null);
  const warnings = [];

  // Prefer the interface that owns the default route (lowest metric), which is
  // what actually reaches the LAN/internet. The UDP outbound address confirms it.
  const withGateway = usable.filter((c) => c.gateway);
  const pool = withGateway.length > 0 ? withGateway : usable;
  if (withGateway.length === 0) {
    warnings.push("no IPv4 default gateway found; hotspot/hosted-network mode suspected — verify the phone uses this IP as its gateway");
  }

  const byMetric = [...pool].sort((a, b) => {
    const ma = a.metric ?? 1_000_000;
    const mb = b.metric ?? 1_000_000;
    if (ma !== mb) return ma - mb;
    const rank = (n) => (/wi-?fi/i.test(n) ? 0 : /ethernet/i.test(n) ? 1 : 2);
    return rank(a.name) - rank(b.name);
  });

  if (outbound && usable.some((c) => c.address === outbound)) {
    const hit = usable.find((c) => c.address === outbound);
    if (withGateway.length > 0 && !hit.gateway) {
      // Outbound points at a gateway-less interface while a gateway interface
      // exists (e.g. hotspot sharing): do not guess, ask for an override.
      throw ambiguousError(usable, `outbound ${outbound} has no gateway while gateway interfaces exist`);
    }
    const others = usable.filter((c) => c.address !== outbound);
    if (others.length > 0) {
      warnings.push(`also present: ${others.map((c) => `${c.name}=${c.address}`).join(", ")} (selected outbound ${outbound}; override with --lan-ip if the phone is on another segment)`);
    }
    return {
      ip: outbound,
      interface: hit.name,
      description: hit.description ?? "",
      method: "outbound-route",
      gateway: hit.gateway ?? null,
      candidates: all,
      warnings,
    };
  }

  if (byMetric.length > 1 && byMetric[0].metric != null && byMetric[1].metric != null && byMetric[0].metric === byMetric[1].metric) {
    throw ambiguousError(usable, "two interfaces share the lowest route metric");
  }
  if (byMetric.length > 1 && withGateway.length === 0) {
    throw ambiguousError(usable, "no default gateway to disambiguate");
  }
  const top = byMetric[0];
  const others = byMetric.slice(1);
  if (others.length > 0) {
    warnings.push(`also present: ${others.map((c) => `${c.name}=${c.address}`).join(", ")} (selected ${top.address} by lowest route metric; override with --lan-ip if wrong)`);
  }
  return {
    ip: top.address,
    interface: top.name,
    description: top.description ?? "",
    method: withGateway.length > 0 ? "default-route" : "single-candidate",
    gateway: top.gateway ?? null,
    candidates: all,
    warnings,
  };
}

function ambiguousError(usable, reason) {
  const list = usable.map((c) => `${c.name}=${c.address}`).join(", ");
  const err = new Error(
    `Multiple usable LAN addresses (${list}); ${reason}. Re-run with --lan-ip=<one-of-them> or AGRIMARKET_LAN_IP=<ip>.`,
  );
  err.code = "AMBIGUOUS_LAN";
  err.candidates = usable;
  return err;
}

export function checkTcpOpen(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (value) => {
      try {
        sock.destroy();
      } catch {}
      resolve(value);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

export async function fetchWithTimeout(url, { timeoutMs = 10000, headers } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-only API readiness probe. Never writes, never kills, never seeds.
 * Returns { ok, checks[], mysqlTcpOpen, portOwner, errorKind }.
 * errorKind: null | 'network' (status 0 class) | 'http' (server answered 4xx/5xx)
 */
export async function checkApiReadiness({ lanIp, port = API_DEFAULT_PORT, timeoutMs = 10000 } = {}) {
  const base = `http://127.0.0.1:${port}/api/v1`;
  const lanBase = lanIp ? `http://${lanIp}:${port}/api/v1` : null;
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const mysqlTcpOpen = await checkTcpOpen("127.0.0.1", 3306, 3000);
  push("mysql:3306 reachable", mysqlTcpOpen, mysqlTcpOpen ? "TCP connect ok" : "TCP refused — MySQL service is down or firewalled");

  const portOpen = await checkTcpOpen("127.0.0.1", port, 3000);
  push(`port ${port} listening`, portOpen, portOpen ? "TCP connect ok" : `nothing listens on ${port} — start with npm run dev:api`);

  let portOwner = null;
  if (process.platform === "win32") portOwner = getWindowsPortOwner(port);

  const get = async (url) => {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs });
      const text = await res.text();
      return { networkOk: true, status: res.status, text, headers: res.headers };
    } catch (e) {
      return { networkOk: false, error: e?.message ?? String(e) };
    }
  };

  let health = null;
  let errorKind = null;
  if (portOpen) {
    const r = await get(`${base}/health`);
    if (!r.networkOk) {
      push("GET /api/v1/health", false, `network failure (${r.error}) — Wi-Fi/API-down class (status 0)`);
      errorKind = "network";
    } else if (r.status !== 200) {
      push("GET /api/v1/health", false, `HTTP ${r.status} ${r.text.slice(0, 160)}`);
      errorKind = "http";
      if (r.status === 503) push("database via health", false, "health reports database unreachable — check MySQL, do NOT report Wi-Fi success");
    } else {
      try {
        health = JSON.parse(r.text);
      } catch {
        health = null;
      }
      const dbUp = health?.database === "up" && health?.status === "ok";
      push("GET /api/v1/health", dbUp, dbUp ? `ok (${JSON.stringify(health).slice(0, 120)})` : `unexpected body ${r.text.slice(0, 160)}`);
      if (!dbUp) errorKind = "http";
    }

    const want = [
      ["GET /api/v1/categories", "/categories?limit=1"],
      ["GET /api/v1/products", "/products?page=1&limit=1"],
      ["GET /api/v1/locations/provinces/33/wards", "/locations/provinces/33/wards?limit=1"],
    ];
    for (const [name, p] of want) {
      const r2 = await get(`${base}${p}`);
      if (!r2.networkOk) {
        push(name, false, `network failure (${r2.error})`);
        errorKind = errorKind ?? "network";
      } else if (r2.status >= 200 && r2.status < 300) {
        push(name, true, `HTTP ${r2.status}`);
      } else {
        // A 401/409/500 means the server ANSWERED: never misreport as Wi-Fi.
        push(name, false, `HTTP ${r2.status} (server answered — not a Wi-Fi failure) ${r2.text.slice(0, 120)}`);
        errorKind = errorKind ?? "http";
      }
    }

    const docs = await get(`http://127.0.0.1:${port}/docs`);
    push(
      "GET /docs",
      docs.networkOk && docs.status === 200,
      docs.networkOk ? `HTTP ${docs.status}` : `network failure (${docs.error})`,
    );

    if (lanIp) {
      const rl = await get(`${lanBase}/health`);
      push(
        `LAN GET http://${lanIp}:${port}/api/v1/health`,
        rl.networkOk && rl.status === 200,
        rl.networkOk ? `HTTP ${rl.status}` : `network failure (${rl.error}) — phone would see status-0 here`,
      );
      if (!rl.networkOk) errorKind = errorKind ?? "network";
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, mysqlTcpOpen, portOwner, health, errorKind };
}

/** Best-effort owner of a listening TCP port on Windows (read-only). */
export function getWindowsPortOwner(port) {
  try {
    const conns = runPowershellJson(
      `Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess | ConvertTo-Json -Depth 2 -Compress`,
    );
    if (conns.length === 0) return { listening: false };
    const pid = conns[0]?.OwningProcess;
    let proc = null;
    try {
      const procs = runPowershellJson(
        `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object Name, CommandLine | ConvertTo-Json -Depth 2 -Compress`,
      );
      proc = procs[0] ?? null;
    } catch {}
    const cmd = proc?.CommandLine ?? "";
    const isAgrimarket = /agrimarket|apps[\\/]api|dist[\\/]src[\\/]main/i.test(cmd);
    return { listening: true, pid, processName: proc?.Name ?? null, commandLine: cmd.slice(0, 220), isAgrimarket };
  } catch {
    return { listening: null, note: "port-owner lookup unavailable" };
  }
}

/** Redact secrets for console output (keys only, never values). */
export function redactEnvLine(line) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!m) return line;
  if (/SECRET|PASSWORD|DATABASE_URL|SMTP_USER|SMTP_PASSWORD|JWT/i.test(m[1])) return `${m[1]}=***`;
  return line;
}

export function parseCliArgs(argv) {
  const out = { _: [] };
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) {
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = m[2];
    } else if (raw.startsWith("--no-")) {
      const key = raw.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = false;
    } else if (raw.startsWith("--")) {
      const key = raw.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = true;
    } else {
      out._.push(raw);
    }
  }
  return out;
}
