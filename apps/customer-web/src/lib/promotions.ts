/**
 * Display-price projection and promotion helpers.
 *
 * IMPORTANT — the AUTHORITATIVE price is always the server's.
 *
 * `GET /products` and `GET /products/:id` return each variant with
 * `effectivePrice` (resolved by the same backend code the checkout uses:
 * flash sale > product discount > base) plus `availableQuantity`. Those are used
 * directly wherever the catalog response is available — the client no longer
 * computes the customer price for catalog screens.
 *
 * `resolveDisplayPrice` remains only as a FALLBACK for responses that carry a
 * bare variant (e.g. `GET /carts/me` embeds the plain `productVariant` row, and
 * flash-sale items embed their own variant). It applies the documented
 * precedence from `docs/BUSINESS-RULES.md` §9:
 *
 *   1. an active FlashSale item wins, but only when `flashPrice < basePrice`
 *   2. otherwise the latest active ProductDiscount applies
 *   3. otherwise the base price stands
 *
 * TIME HANDLING: the promotion window (`startsAt`/`endsAt`) is applied ONCE,
 * when the index is built, so `resolveDisplayPrice` is a pure function of its
 * arguments and never reads the clock during render. The index builder takes
 * `now` explicitly; callers pass the value from the `useNow` clock store.
 * `now === 0` means "clock not known yet" (server / hydration render) and the
 * window check is skipped rather than filtering every promotion out.
 *
 * Even in the fallback path the amount actually charged is decided server-side
 * at checkout: the client never sends a price, and the order snapshot comes from
 * the backend. Any drift is therefore cosmetic and corrected on checkout.
 */

import type {
  FlashSale,
  ProductDiscount,
  ProductVariant,
  VariantPrice,
} from "@/lib/api/types";

export type PriceSource = "NONE" | "PRODUCT_DISCOUNT" | "FLASH_SALE";

export interface EffectivePrice {
  basePrice: number;
  unitPrice: number;
  discountAmount: number;
  source: PriceSource;
  /** Populated for FLASH_SALE so the UI can show quota / end time. */
  flash?: {
    flashSaleId: number;
    name: string;
    endsAt: string;
    startsAt: string;
    quota: number;
    soldQuantity: number;
    remaining: number;
    perCustomerLimit: number;
  };
}

export interface PromotionIndex {
  flashByVariant: Map<number, FlashSale>;
  discountByVariant: Map<number, ProductDiscount>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds a variantId -> promotion lookup from the public promotion lists.
 *
 * @param now epoch milliseconds, or `0` when the clock is not known yet.
 */
export function buildPromotionIndex(
  flashSales: FlashSale[] | undefined,
  productDiscounts: ProductDiscount[] | undefined,
  now: number,
): PromotionIndex {
  const flashByVariant = new Map<number, FlashSale>();
  const discountByVariant = new Map<number, ProductDiscount>();
  const clockKnown = now > 0;

  const inWindow = (startsAt: string, endsAt: string): boolean => {
    if (!clockKnown) return true;
    return new Date(startsAt).getTime() <= now && new Date(endsAt).getTime() >= now;
  };

  for (const sale of flashSales ?? []) {
    if (sale.status !== "ACTIVE") continue;
    if (!inWindow(sale.startsAt, sale.endsAt)) continue;
    for (const item of sale.items ?? []) {
      // Prefer the cheapest active flash price for the same variant, matching
      // the backend's `orderBy: { flashPrice: 'asc' }`.
      const existing = flashByVariant.get(item.productVariantId);
      if (!existing) {
        flashByVariant.set(item.productVariantId, sale);
        continue;
      }
      const existingItem = existing.items.find((i) => i.productVariantId === item.productVariantId);
      if (existingItem && num(item.flashPrice) < num(existingItem.flashPrice)) {
        flashByVariant.set(item.productVariantId, sale);
      }
    }
  }

  for (const discount of productDiscounts ?? []) {
    if (discount.status !== "ACTIVE") continue;
    if (!inWindow(discount.startsAt, discount.endsAt)) continue;
    // The backend picks the newest active discount (`orderBy: { id: 'desc' }`).
    const existing = discountByVariant.get(discount.productVariantId);
    if (!existing || discount.id > existing.id) {
      discountByVariant.set(discount.productVariantId, discount);
    }
  }

  return { flashByVariant, discountByVariant };
}

/**
 * Applies the documented precedence for one variant.
 *
 * Pure: the promotion window was already applied when the index was built.
 */
export function resolveDisplayPrice(
  variant: Pick<ProductVariant, "id" | "basePrice">,
  index: PromotionIndex | undefined,
): EffectivePrice {  const basePrice = num(variant.basePrice);

  const flashSale = index?.flashByVariant.get(variant.id);
  if (flashSale) {
    const item = flashSale.items.find((i) => i.productVariantId === variant.id);
    if (item) {
      const flashPrice = num(item.flashPrice);
      if (flashPrice < basePrice) {
        return {
          basePrice,
          unitPrice: flashPrice,
          discountAmount: round2(basePrice - flashPrice),
          source: "FLASH_SALE",
          flash: {
            flashSaleId: flashSale.id,
            name: flashSale.name,
            startsAt: flashSale.startsAt,
            endsAt: flashSale.endsAt,
            quota: item.quota,
            soldQuantity: item.soldQuantity,
            remaining: Math.max(0, item.quota - item.soldQuantity),
            perCustomerLimit: item.perCustomerLimit,
          },
        };
      }
    }
  }

  const discount = index?.discountByVariant.get(variant.id);
  if (discount) {
    const value = num(discount.discountValue);
    const unitPrice =
      discount.discountType === "PERCENT"
        ? basePrice * (1 - value / 100)
        : Math.max(0, basePrice - value);
    const rounded = round2(unitPrice);
    if (rounded < basePrice) {
      return {
        basePrice,
        unitPrice: rounded,
        discountAmount: round2(basePrice - rounded),
        source: "PRODUCT_DISCOUNT",
      };
    }
  }

  return { basePrice, unitPrice: basePrice, discountAmount: 0, source: "NONE" };
}

/**
 * Converts the server-resolved `effectivePrice` into the display shape.
 *
 * Preferred over `resolveDisplayPrice` whenever the variant came from a
 * catalog response: the numbers are the backend's own, so the card can never
 * disagree with what the checkout will charge.
 */
export function serverPrice(variant: {
  effectivePrice?: VariantPrice;
  basePrice: string;
}): EffectivePrice | null {
  const price = variant.effectivePrice;
  if (!price) return null;
  return {
    basePrice: price.basePrice,
    unitPrice: price.unitPrice,
    discountAmount: price.discountAmount,
    source: price.source,
  };
}

/**
 * Display price of one variant, preferring the server's `effectivePrice` and
 * falling back to the client projection for bare variants (cart lines,
 * flash-sale items).
 */
export function variantDisplayPrice(
  variant: Pick<ProductVariant, "id" | "basePrice"> & { effectivePrice?: VariantPrice },
  index: PromotionIndex | undefined,
): EffectivePrice {
  return serverPrice(variant) ?? resolveDisplayPrice(variant, index);
}

/** Cheapest variant price of a product, used for "từ ..." list prices. */
export function cheapestVariantPrice(
  variants: Array<Pick<ProductVariant, "id" | "basePrice" | "status"> & { effectivePrice?: VariantPrice }> | undefined,
  index: PromotionIndex | undefined,
): EffectivePrice | null {
  const active = (variants ?? []).filter((v) => v.status === "ACTIVE");
  if (active.length === 0) return null;
  let best: EffectivePrice | null = null;
  for (const variant of active) {
    const price = variantDisplayPrice(variant, index);
    if (!best || price.unitPrice < best.unitPrice) best = price;
  }
  return best;
}

/** True when the product has at least one variant on a real promotion. */
export function hasPromotion(
  variants: Array<Pick<ProductVariant, "id" | "basePrice"> & { effectivePrice?: VariantPrice }> | undefined,
  index: PromotionIndex | undefined,
): boolean {
  return (variants ?? []).some(
    (v) => variantDisplayPrice(v, index).source !== "NONE",
  );
}

/** True when at least one variant can actually be bought right now. */
export function hasSellableVariant(
  variants: Array<{ inStock?: boolean }> | undefined,
): boolean {
  return (variants ?? []).some((v) => v.inStock === true);
}
