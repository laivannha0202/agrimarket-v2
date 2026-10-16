/**
 * Which variant a product card is *showing*.
 *
 * Pure, and the single place that decides it — the card prints this variant's
 * price, so the cart button on that same card must add **this** variant.
 * Picking "the first one" in two different places is how a customer ends up
 * charged for a variant whose price they never saw.
 *
 * Preference order (identical to the Mobile app's `displayVariant`):
 * 1. cheapest ACTIVE variant that is in stock — so a card is only marked
 *    "Hết hàng" when nothing on it can actually be bought;
 * 2. otherwise the cheapest ACTIVE variant — the card then shows a real price
 *    and the sold-out overlay, rather than hiding a product that exists;
 * 3. otherwise (no ACTIVE variant at all) the cheapest of whatever is there.
 *
 * Only *selects* what the server already priced: no price or stock is computed.
 */

import { variantDisplayPrice, type EffectivePrice, type PromotionIndex } from "@/lib/promotions";
import type { PricedVariant, Product } from "@/lib/api/types";

export interface DisplayedVariant {
  /** The public catalog pricing is part of the variant (`inStock`, price). */
  variant: PricedVariant;
  price: EffectivePrice;
}

export function displayVariant(
  product: Pick<Product, "variants">,
  index?: PromotionIndex,
): DisplayedVariant | null {
  const variants = product.variants ?? [];
  const active = variants.filter((v) => v.status === "ACTIVE");
  const pool = active.length > 0 ? active : variants;
  if (pool.length === 0) return null;

  // When the catalogue has ACTIVE variants, only those may be displayed (and
  // only an in-stock one can skip the sold-out overlay).
  const candidates =
    active.length > 0 && active.some((v) => v.inStock)
      ? pool.filter((v) => v.inStock)
      : pool;

  let best: DisplayedVariant = {
    variant: candidates[0]!,
    price: variantDisplayPrice(candidates[0]!, index),
  };
  for (const variant of candidates.slice(1)) {
    const price = variantDisplayPrice(variant, index);
    if (price.unitPrice < best.price.unitPrice) best = { variant, price };
  }
  return best;
}
