// Inspect the first flash-sale payload from qa/out/probe.json.
//
// Run from apps/customer-web:  node qa/probe.mjs && node qa/inspect-fs.mjs
// Same path convention as qa/probe.mjs (CWD-relative, QA_OUT override).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const probeFile = resolve(process.env.QA_OUT ?? "qa/out/probe.json");

const p = JSON.parse(readFileSync(probeFile, "utf8"));

const fs0 = p["flash-sales"].body.data[0];
console.log("=== flash sale #0 (trimmed) ===");
console.log(
  JSON.stringify(
    {
      id: fs0.id,
      name: fs0.name,
      status: fs0.status,
      startsAt: fs0.startsAt,
      endsAt: fs0.endsAt,
      perCustomerLimit: fs0.perCustomerLimit,
      items: (fs0.items ?? []).map((it) => ({
        keys: Object.keys(it),
        variantKeys: Object.keys(it.productVariant ?? {}),
        id: it.id,
        variantId: it.productVariant?.id,
        sku: it.productVariant?.sku,
        base: it.productVariant?.basePrice,
        salePrice: it.salePrice,
        promoPrice: it.promoPrice,
        discountType: it.discountType,
        discountValue: it.discountValue,
        limit: it.perCustomerLimit ?? it.limitPerCustomer,
      })),
    },
    null,
    1,
  ),
);
