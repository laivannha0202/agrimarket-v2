/**
 * Which variant a product card is *showing*.
 *
 * Pure and shared on purpose. The card prints the price of this variant, so the
 * cart button on that same card must add **this** variant — picking "the first
 * one" in two different places is how a customer ends up charged for a variant
 * whose price they never saw.
 *
 * Preference order:
 * 1. cheapest ACTIVE variant that is in stock — so a card is only marked "Hết
 *    hàng" when nothing on it can actually be bought;
 * 2. otherwise the cheapest ACTIVE variant — the card then shows a real price
 *    and the sold-out overlay, rather than hiding a product that exists;
 * 3. otherwise (no ACTIVE variant at all) the cheapest of whatever is there.
 *
 * Only *selects* what the server already priced: no price or stock is computed.
 */

import type { PricedVariant, Product } from "./types";

function cheapest(variants: PricedVariant[]): PricedVariant | null {
  if (variants.length === 0) return null;
  let best = variants[0]!;
  for (const v of variants) {
    if (v.effectivePrice.unitPrice < best.effectivePrice.unitPrice) best = v;
  }
  return best;
}

export function displayVariant(product: Pick<Product, "variants">): PricedVariant | null {
  const active = product.variants.filter((v) => v.status === "ACTIVE");
  if (active.length > 0) {
    return cheapest(active.filter((v) => v.inStock)) ?? cheapest(active);
  }
  return cheapest(product.variants);
}

/** True when the variant on display cannot currently be ordered. */
export function isSoldOut(product: Pick<Product, "variants">): boolean {
  const variant = displayVariant(product);
  return variant !== null && !variant.inStock;
}
