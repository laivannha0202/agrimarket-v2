import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildApiBaseUrl,
  candidatesFromOs,
  isApipa,
  isLoopbackIp,
  isValidIPv4,
  isVirtualInterfaceName,
  parseEnvText,
  syncEnvVar,
  validateApiBaseUrl,
} from "./lib.mjs";

// ---- IPv4 validation ----
describe("isValidIPv4", () => {
  it("accepts the current LAN address", () => assert.equal(isValidIPv4("10.218.208.43"), true));
  it("flags loopback via the loopback helper only", () => {
    assert.equal(isValidIPv4("127.0.0.1"), true);
    assert.equal(isLoopbackIp("127.0.0.1"), true);
    assert.equal(isLoopbackIp("10.218.208.43"), false);
  });
  it("rejects octets > 255 and leading zeros", () => {
    assert.equal(isValidIPv4("999.1.1.1"), false);
    assert.equal(isValidIPv4("192.168.01.10"), false);
    assert.equal(isValidIPv4("not-an-ip"), false);
    assert.equal(isValidIPv4(""), false);
    assert.equal(isApipa("169.254.95.85"), true);
    assert.equal(isApipa("10.218.208.43"), false);
  });
});

describe("isVirtualInterfaceName", () => {
  it("flags VPN/WSL/Docker/Hyper-V/Bluetooth/tunnel names", () => {
    for (const n of ["vgate0", "Wintun", "vEthernet (WSL)", "DockerNAT", "Bluetooth Network Connection", "Tailscale", "Loopback Pseudo-Interface 1"]) {
      assert.equal(isVirtualInterfaceName(n), true);
    }
  });
  it("keeps Wi-Fi and Ethernet", () => {
    assert.equal(isVirtualInterfaceName("Wi-Fi"), false);
    assert.equal(isVirtualInterfaceName("Ethernet"), false);
  });
});

// ---- URL builders ----
describe("buildApiBaseUrl", () => {
  it("builds the exact Expo URL shape", () => {
    assert.equal(buildApiBaseUrl("10.218.208.43", 3000), "http://10.218.208.43:3000/api/v1");
  });
  it("refuses localhost, APIPA and the Metro port", () => {
    assert.throws(() => buildApiBaseUrl("127.0.0.1", 3000));
    assert.throws(() => buildApiBaseUrl("localhost", 3000));
    assert.throws(() => buildApiBaseUrl("169.254.95.85", 3000));
    assert.throws(() => buildApiBaseUrl("10.218.208.43", 8081));
  });
});

describe("validateApiBaseUrl", () => {
  it("accepts a good LAN URL", () => {
    assert.equal(validateApiBaseUrl("http://10.218.208.43:3000/api/v1").ok, true);
  });
  it("rejects localhost / missing suffix / doubled path / Metro port", () => {
    assert.equal(validateApiBaseUrl("http://localhost:3000/api/v1").ok, false);
    assert.equal(validateApiBaseUrl("http://10.218.208.43:3000").ok, false);
    assert.equal(validateApiBaseUrl("http://10.218.208.43:3000/api/v1/api/v1").ok, false);
    assert.equal(validateApiBaseUrl("http://10.218.208.43:8081/api/v1").ok, false);
    assert.equal(validateApiBaseUrl("").ok, false);
  });
});

// ---- .env surgery ----
describe("syncEnvVar", () => {
  it("updates only the target key and preserves comments/neighbours", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-env-"));
    const file = path.join(dir, ".env");
    fs.writeFileSync(
      file,
      "# header comment\nEXPO_PUBLIC_API_BASE_URL=http://192.168.100.155:3000/api/v1\nOTHER_VAR=keep-me\n# EXPO_PUBLIC_API_BASE_URL=commented-out\n",
      "utf8",
    );
    const res = syncEnvVar(file, "EXPO_PUBLIC_API_BASE_URL", "http://10.218.208.43:3000/api/v1");
    assert.equal(res.action, "updated");
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.includes("EXPO_PUBLIC_API_BASE_URL=http://10.218.208.43:3000/api/v1"));
    assert.ok(text.includes("OTHER_VAR=keep-me"));
    assert.ok(text.includes("# EXPO_PUBLIC_API_BASE_URL=commented-out"));
    assert.ok(!text.includes("192.168.100.155"));
    const second = syncEnvVar(file, "EXPO_PUBLIC_API_BASE_URL", "http://10.218.208.43:3000/api/v1");
    assert.equal(second.action, "unchanged");
    const { vars } = parseEnvText(text);
    assert.equal(vars.get("OTHER_VAR"), "keep-me");
  });
});

// ---- environment propagation: Expo must embed the fresh URL ----
describe("expo env propagation contract", () => {
  it("mobile config reads EXPO_PUBLIC_API_BASE_URL from the process env (single source of truth)", async () => {
    const src = fs.readFileSync("apps/mobile/src/lib/config.ts", "utf8");
    assert.ok(src.includes("process.env.EXPO_PUBLIC_API_BASE_URL"));
    assert.ok(!/192\.168\.\d+\.\d+/.test(src));
    assert.ok(!/10\.\d+\.\d+\.\d+/.test(src));
  });
  it("reads the LIVE OS interface list, not a cached address (no stale cache)", () => {
    // Machine-independent on purpose: asserting one hard-coded address would
    // only pass on the machine the suite was written on, while a cache bug is
    // what this test exists to catch. Enumerate the interfaces independently of
    // `candidatesFromOs` and require the two views to agree — a cached result
    // (an old IP after switching networks) shows up as a mismatch.
    const live = Object.values(os.networkInterfaces())
      .flatMap((list) => list ?? [])
      .filter((a) => a.family === "IPv4" && !a.internal)
      .map((a) => a.address);
    assert.deepEqual(
      new Set(candidatesFromOs().map((c) => c.address)),
      new Set(live),
      "candidatesFromOs() must mirror the OS interface list",
    );

    // Whatever this machine does have must be a real, usable LAN address.
    for (const candidate of candidatesFromOs()) {
      assert.equal(isValidIPv4(candidate.address), true, candidate.address);
      assert.equal(isLoopbackIp(candidate.address), false, candidate.address);
    }
  });
});
