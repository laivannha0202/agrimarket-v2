/**
 * QA probe: dump the real payloads the Customer Web depends on.
 *
 * Run with no shell-quoting hazards:  node qa/probe.mjs
 * Optional env:
 *   QA_API   base url (default http://localhost:3000/api/v1)
 *   QA_TOKEN customer bearer token
 *   QA_OUT   file to write (default qa/out/probe.json)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE = process.env.QA_API ?? "http://localhost:3000/api/v1";
const TOKEN = process.env.QA_TOKEN ?? "";
const OUT = resolve(process.env.QA_OUT ?? "qa/out/probe.json");

/** [label, path] — every route the storefront actually calls. */
const TARGETS = [
  ["health", "/health"],
  ["categories", "/categories?limit=100"],
  ["products-page1", "/products?page=1&limit=4"],
  ["products-search-rau", "/products?search=rau&limit=5"],
  ["products-search-khongdau", "/products?search=gao&limit=5"],
  ["products-search-empty", "/products?search=zzzzkhongco&limit=5"],
  ["products-sort-price-asc", "/products?sort=price_asc&limit=3"],
  ["flash-sales", "/flash-sales?limit=10"],
  ["product-discounts", "/product-discounts?limit=10"],
  ["partners", "/partners?limit=50"],
  ["farms", "/farms?limit=10"],
  ["provinces", "/locations/provinces"],
  ["wards-hungyen", "/locations/provinces/33/wards?limit=200"],
  ["me-unauth", "/auth/me"],
];

const results = {};
for (const [label, path] of TARGETS) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 300);
    }
    results[label] = { path, status: res.status, body };
  } catch (err) {
    results[label] = { path, status: "FETCH_FAILED", error: String(err) };
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(results, null, 1), "utf8");

for (const [label, r] of Object.entries(results)) {
  console.log(String(r.status).padEnd(6), label, `(${r.path})`);
}
console.log(`\nwrote ${OUT}`);
