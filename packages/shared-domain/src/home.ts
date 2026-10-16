/**
 * Home-page product selection, shared by Customer Web and Mobile.
 *
 * Both platforms must answer the same questions the same way:
 *  - which variant's price a card may advertise (a REAL discount, active only);
 *  - which flash sale is running right now, and how many of its slots remain;
 *  - which products belong to which home section, with no product shown twice
 *    (deduped by product ID, never by name).
 *
 * Everything here is a pure function of API data — no prices, stock or totals
 * are invented; the backend already decided them.
 */

import { isRealDiscount } from "./format";

/* -------------------------------------------------------- priced variants -- */

export interface VariantPriceLike {
  source?: string | null;
  basePrice?: string | number | null;
  unitPrice?: string | number | null;
}

export interface PricedVariantLike {
  status?: string | null;
  inStock?: boolean | null;
  effectivePrice?: VariantPriceLike | null;
}

/**
 * The cheapest ACTIVE variant whose backend price really is a discount, or
 * `null` when the product is not on sale.
 *
 * "Really is a discount" is strict (`unitPrice < basePrice`): the backend can
 * report `source: PRODUCT_DISCOUNT` with an unrounded price equal to the base,
 * and advertising "đang giảm giá" for a 0% cut is a fake discount. Inactive
 * variants are never advertised — a deactivated variant cannot be bought.
 */
export function discountedVariantPrice(
  variants?: readonly PricedVariantLike[] | null,
): VariantPriceLike | null {
  let best: VariantPriceLike | null = null;
  for (const variant of variants ?? []) {
    if (variant.status !== undefined && variant.status !== "ACTIVE") continue;
    const price = variant.effectivePrice;
    if (!price) continue;
    if (!isRealDiscount(price.basePrice, price.unitPrice)) continue;
    if (best === null || Number(price.unitPrice) < Number(best.unitPrice)) best = price;
  }
  return best;
}

/** True when the product belongs in the "Đang giảm giá" section. */
export function isProductOnSale(product: { variants?: readonly PricedVariantLike[] | null }): boolean {
  return discountedVariantPrice(product.variants) !== null;
}

/* --------------------------------------------------------------- sections -- */

export interface HomeSectionOptions<T> {
  /** Product ID from the API — dedup and exclusion are ID-based, never name-based. */
  getId: (item: T) => number;
  /** Products that must not appear (e.g. already shown in the flash-sale block). */
  excludeIds?: ReadonlySet<number>;
  /** True when the product belongs in the discounted section. */
  isDiscounted?: (item: T) => boolean;
  discountedLimit: number;
  featuredLimit: number;
}

export interface HomeSections<T> {
  discounted: T[];
  featured: T[];
}

/**
 * Split one catalogue page into the discounted and featured sections.
 *
 * Rules, in order:
 * 1. a product that is excluded (flash sale) never appears;
 * 2. a product appears in AT MOST one section — first match wins, by ID;
 * 3. the discounted section fills first (it is the stronger signal), the
 *    featured section takes what remains, both capped by their limits;
 * 4. duplicate rows with the same product ID collapse into one.
 */
export function partitionHomeProducts<T>(
  products: readonly T[],
  options: HomeSectionOptions<T>,
): HomeSections<T> {
  const excluded = options.excludeIds ?? new Set<number>();
  const isDiscounted = options.isDiscounted ?? (() => false);
  const seen = new Set<number>(excluded);
  const discounted: T[] = [];
  const featured: T[] = [];

  for (const product of products) {
    if (discounted.length >= options.discountedLimit && featured.length >= options.featuredLimit) {
      break;
    }
    const id = options.getId(product);
    if (seen.has(id)) continue;

    if (discounted.length < options.discountedLimit && isDiscounted(product)) {
      seen.add(id);
      discounted.push(product);
      continue;
    }
    if (featured.length < options.featuredLimit) {
      seen.add(id);
      featured.push(product);
    }
  }

  return { discounted, featured };
}

/* -------------------------------------------------------------- flash sale -- */

export interface FlashSaleItemLike {
  quota: number | string;
  soldQuantity: number | string;
}

export interface FlashSaleLike {
  status?: string | null;
  startsAt: string | Date;
  endsAt: string | Date;
  items?: readonly FlashSaleItemLike[] | null;
}

/** Slots left in one flash item, clamped at 0 (`quota - soldQuantity`). */
export function flashItemRemaining(item: FlashSaleItemLike): number {
  const quota = Number(item.quota);
  const sold = Number(item.soldQuantity);
  if (!Number.isFinite(quota) || !Number.isFinite(sold)) return 0;
  return Math.max(0, quota - sold);
}

/** True when every slot of the flash item was sold. */
export function isFlashItemSoldOut(item: FlashSaleItemLike): boolean {
  return flashItemRemaining(item) <= 0;
}

/** Total slots left across a sale. */
export function flashSaleRemainingTotal(sale: FlashSaleLike): number {
  return (sale.items ?? []).reduce((sum, item) => sum + flashItemRemaining(item), 0);
}

/**
 * True when the sale is live at `now`: ACTIVE, has items and the window covers
 * the moment. Before the clock is known (`now === 0` — server render) the
 * window check is skipped and the ACTIVE status decides, matching the previous
 * web behaviour; a sale whose window already passed is never "live".
 */
export function isFlashSaleLive(sale: FlashSaleLike, now = Date.now()): boolean {
  if (sale.status !== undefined && sale.status !== "ACTIVE") return false;
  if ((sale.items?.length ?? 0) === 0) return false;
  if (now === 0) {
    // Clock unknown: trust ACTIVE, but still reject a window that is provably
    // over relative to the data we have (startsAt after endsAt is malformed).
    return new Date(sale.startsAt).getTime() <= new Date(sale.endsAt).getTime();
  }
  const starts = new Date(sale.startsAt).getTime();
  const ends = new Date(sale.endsAt).getTime();
  if (Number.isNaN(starts) || Number.isNaN(ends)) return false;
  return starts <= now && ends >= now;
}
