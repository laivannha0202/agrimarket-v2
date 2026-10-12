// QA: summarise probe.json — the real payloads the storefront depends on.
//
// Run from apps/customer-web:  node qa/probe.mjs && node qa/summarize.mjs
// Same path convention as qa/probe.mjs and qa/report.mjs (CWD-relative,
// QA_OUT override). No machine-specific absolute paths.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const probeFile = resolve(process.env.QA_OUT ?? "qa/out/probe.json");

const p = JSON.parse(readFileSync(probeFile, "utf8"));

const line = (k) => `\n=== ${k} ===`;

console.log(line("sort=price_asc (400?)"), JSON.stringify(p["products-sort-price-asc"].body));

console.log(line("search 'rau'"), "total:", p["products-search-rau"].body.meta?.total);
for (const d of p["products-search-rau"].body.data ?? []) console.log("  -", d.name);

console.log(line("search 'gao' (khong dau)"), "total:", p["products-search-khongdau"].body.meta?.total);
for (const d of p["products-search-khongdau"].body.data ?? []) console.log("  -", d.name);

console.log(line("search empty"), JSON.stringify(p["products-search-empty"].body.meta));

console.log(line("flash sales"));
for (const s of p["flash-sales"].body.data ?? []) {
  const days = Math.round((new Date(s.endsAt) - new Date(s.startsAt)) / 86400000);
  console.log(`  fs#${s.id} "${s.name}" status=${s.status} ${s.startsAt} -> ${s.endsAt} (span ${days}d) items=${(s.items ?? []).length}`);
  for (const it of (s.items ?? []).slice(0, 3)) {
    console.log(`     item variant#${it.productVariant?.id} ${it.productVariant?.product?.name} salePrice=${it.salePrice ?? it.promoPrice} base=${it.productVariant?.basePrice}`);
  }
}

console.log(line("product discounts"));
for (const d of p["product-discounts"].body.data ?? []) {
  console.log(`  pd#${d.id} variant#${d.productVariantId} value=${d.discountValue} type=${d.discountType} ${d.startsAt} -> ${d.endsAt}`);
}

console.log(line("farms"));
for (const f of p["farms"].body.data ?? []) console.log(`  farm#${f.id} ${f.name} | ${f.address} | status=${f.status}`);

console.log(line("partners"));
for (const pt of p["partners"].body.data ?? []) console.log(`  partner#${pt.id} ${pt.name} status=${pt.status}`);

console.log(line("categories"));
for (const c of p["categories"].body.data ?? []) console.log(`  cat#${c.id} ${c.slug} "${c.name}" ${c.status}`);

console.log(line("products page1 (first 4)"));
for (const pr of p["products-page1"].body.data ?? []) {
  console.log(`  prod#${pr.id} "${pr.name}" cat=${pr.category?.slug} farm=${pr.farmId}`);
  for (const v of pr.variants ?? []) {
    console.log(`     var#${v.id} "${v.name}" w=${v.weight}${v.weightUnit} saleUnit=${v.saleUnit} base=${v.basePrice} eff=${JSON.stringify(v.effectivePrice)} stock=${v.availableQuantity}`);
  }
}
