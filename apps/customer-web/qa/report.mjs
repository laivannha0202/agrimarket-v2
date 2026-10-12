/**
 * QA report: summarise the probe dump (search correctness, promotion windows,
 * farm addresses, category icon coverage). Read-only.
 *
 *   node qa/probe.mjs && node qa/report.mjs
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve(process.env.QA_OUT ?? "qa/out/probe.json");
const d = JSON.parse(await readFile(file, "utf8"));
const line = (t) => console.log(`\n=== ${t} ===`);

line("SEARCH: search=rau (must not return unrelated products)");
const rau = d["products-search-rau"].body;
console.log(`total=${rau.meta.total} returned=${rau.data.length}`);
for (const p of rau.data) console.log(` - [${p.id}] ${p.name}  (category: ${p.category?.name})`);

line("SEARCH: search=gao (no-diacritic)");
const gao = d["products-search-khongdau"].body;
console.log(`total=${gao.meta.total}`);
for (const p of gao.data) console.log(` - [${p.id}] ${p.name}`);

line("SEARCH: nonsense term");
const none = d["products-search-empty"].body;
console.log(`total=${none.meta.total} returned=${none.data.length}`);

line("CATEGORY payload keys");
console.log(Object.keys(d.categories.body.data[0]).join(", "));
console.log("slugs:", d.categories.body.data.map((c) => c.slug).join(", "));

line("PRODUCT variant shape (first product)");
const p0 = d["products-page1"].body.data[0];
console.log("product keys:", Object.keys(p0).join(", "));
console.log("variant keys:", Object.keys(p0.variants[0]).join(", "));
console.log("sample variant:", JSON.stringify(p0.variants[0], null, 1).slice(0, 900));

line("FLASH SALES: window vs name (the 27-day finding)");
for (const s of d["flash-sales"].body.data) {
  console.log(
    ` - "${s.name}" status=${s.status} ${s.startsAt} -> ${s.endsAt} items=${s.items?.length ?? 0}`,
  );
}

line("FARMS: address fields (old district names?)");
for (const f of d.farms.body.data) {
  console.log(` - [${f.id}] ${f.name}`);
  console.log(`     address=${JSON.stringify(f.address ?? f.location ?? null)}`);
  console.log(`     keys=${Object.keys(f).join(", ")}`);
}

line("PARTNERS shape");
console.log("keys:", Object.keys(d.partners.body.data[0] ?? {}).join(", "));

line("LOCATIONS: provinces + ward sample");
console.log("provinces:", JSON.stringify(d.provinces.body).slice(0, 400));
const wards = d["wards-hungyen"].body;
console.log(`wards meta=${JSON.stringify(wards.meta)}`);
console.log("ward keys:", Object.keys(wards.data?.[0] ?? {}).join(", "));
console.log("first wards:", wards.data?.slice(0, 3).map((w) => `${w.code}:${w.name}`).join(" | "));
