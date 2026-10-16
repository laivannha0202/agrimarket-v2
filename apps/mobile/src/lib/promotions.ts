/**
 * Price + image helpers.
 *
 * PRICING RULE: the server is the single source of truth. `effectivePrice` on
 * each variant already resolves the flash-sale / product-discount / base-price
 * precedence, and `POST /orders/checkout-preview` returns the authoritative
 * totals. Nothing in this app recomputes a price, a discount or a stock level —
 * these helpers only *select* or *reformat* values the backend already decided.
 */

import { getApiOrigin } from "./config";
import type { Product } from "./types";

export function cheapestVariantPrice(product: Product): { unitPrice: number; basePrice: number } | null {
  if (product.variants.length === 0) return null;
  let best: { unitPrice: number; basePrice: number } | null = null;
  for (const v of product.variants) {
    const unit = v.effectivePrice.unitPrice;
    if (best === null || unit < best.unitPrice) {
      best = { unitPrice: unit, basePrice: v.effectivePrice.basePrice };
    }
  }
  return best;
}

export function primaryImage(product: Pick<Product, "images">): string | null {
  if (product.images.length === 0) return null;
  const primary = product.images.find((img) => img.isPrimary);
  return (primary ?? product.images[0])?.url ?? null;
}

/**
 * Every uploaded image, ordered for display: the backend's `isPrimary` first,
 * then the rest by `sortOrder`.
 *
 * Two reasons the primary leads rather than just `sortOrder`:
 * 1. The card cover is `primaryImage()`. If the gallery opened on a different
 *    photo, tapping a card would land the customer on an image they never saw.
 * 2. `sortOrder` is display order, not cover order — the two flags are
 *    independent in the schema, so a product can legitimately have its primary
 *    upload at `sortOrder` 1.
 *
 * The API already embeds them sorted, but the app does not depend on that: an
 * out-of-order payload would otherwise silently change the first slide.
 */
export function galleryImages(product: Pick<Product, "images">): Product["images"] {
  const sorted = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const primary = sorted.find((img) => img.isPrimary);
  if (!primary) return sorted;
  return [primary, ...sorted.filter((img) => img.id !== primary.id)];
}

/**
 * Rewrite an image URL so Expo Go on the phone can load it:
 * - `localhost` / `127.0.0.1` (dev-machine origin baked into stored URLs)
 *   becomes the configured API origin (LAN IP).
 * - Relative paths are resolved against the API origin.
 * - Absolute LAN/CDN URLs pass through untouched.
 *
 * String surgery on purpose. React Native ships a *partial* `URL` polyfill
 * (`Libraries/Blob/URL.js`, installed via `setUpXHR`) whose `protocol` / `host`
 * / `href` are getter-only. Assigning them throws
 * `TypeError: Cannot set property protocol of [object Object] which has only a getter`,
 * which used to crash the whole product list (no image, no card, no products).
 * A regex origin swap is the only Expo Go safe way to do this.
 */
export function resolveImageUrl(url: string | null | undefined, apiOrigin: string = getApiOrigin()): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const origin = apiOrigin.replace(/\/+$/, "");
  if (trimmed.startsWith("/")) return origin ? `${origin}${trimmed}` : trimmed;
  // Swap a dev-machine origin (localhost / 127.0.0.1) for the configured one.
  // The lookahead pins the host boundary so a different host that merely
  // starts with "localhost" (e.g. localhost.evil.com) is left untouched.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?=\/|$)/i.test(trimmed)) {
    if (!origin) return trimmed;
    return trimmed.replace(/^https?:\/\/[^/]+/i, origin);
  }
  return trimmed;
}

/** One idempotency key per checkout payload signature; regenerated on change. */
export function newIdempotencyKey(): string {
  const bytes = new Array<string>(32);
  const hex = "0123456789abcdef";
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = hex[Math.floor(Math.random() * 16)] ?? "0";
  }
  const s = bytes.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const IDEMPOTENCY_KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_RE.test(value);
}
