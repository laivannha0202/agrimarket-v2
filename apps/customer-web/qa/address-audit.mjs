/**
 * QA: cross-check the farm addresses stored in the DB against the official
 * 2025 Hưng Yên ward catalogue served by the API.
 *
 * WHY: the storefront shows farm addresses verbatim. If a farm still carries a
 * pre-reorganisation district name ("huyện Văn Lâm"), the page displays an
 * administrative unit that no longer exists. This script reports the situation
 * — it NEVER rewrites data.
 *
 *   node qa/address-audit.mjs
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = process.env.QA_API ?? "http://localhost:3000/api/v1";
const out = resolve("qa/out/probe.json");

const probe = JSON.parse(await readFile(out, "utf8"));
const farms = probe.farms.body.data;

const wardsRes = await fetch(`${BASE}/locations/provinces/33/wards?limit=200`);
const wards = (await wardsRes.json()).data;

const fold = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();

console.log(`Official 2025 Hưng Yên catalogue: ${wards.length} xã/phường\n`);
console.log("=== FARM ADDRESS AUDIT ===");
for (const f of farms) {
  const address = f.address ?? "";
  const hasOldDistrict = /huyện|quận|thị xã|thành phố\s+\w+\s*,/i.test(address);
  const districtMatch = address.match(/huyện\s+([^,]+)/i);
  // Does any official ward name appear in the stored address?
  const matchedWard = wards.find((w) => fold(address).includes(fold(w.name)));

  console.log(`\nfarm#${f.id} ${f.name}`);
  console.log(`  stored: "${address}"`);
  console.log(`  contains old district level: ${hasOldDistrict}${districtMatch ? ` ("huyện ${districtMatch[1]}")` : ""}`);
  console.log(`  matches official ward: ${matchedWard ? `${matchedWard.name} (${matchedWard.code})` : "NONE"}`);
}

console.log("\n=== WARD NAME SAMPLE (first 12) ===");
console.log(wards.slice(0, 12).map((w) => `${w.code}=${w.name}`).join(" | "));

console.log("\n=== Does the catalogue still contain the old district names as wards? ===");
for (const needle of ["Minh Châu", "Đình Dù", "Phú Cường", "Hồng Nam", "Văn Lâm", "Kim Động"]) {
  const hits = wards.filter((w) => fold(w.name).includes(fold(needle)));
  console.log(`  "${needle}": ${hits.length ? hits.map((h) => `${h.code}=${h.name}`).join(", ") : "not a ward"}`);
}
