/**
 * Resolves the product details that cart and promotion payloads do not embed.
 *
 * Two real API shapes have this gap:
 * - `GET /carts/me` embeds only the plain product row (`include: { product: true }`):
 *   no `partner`, `images`, `category` or `variants`, so the cart line cannot
 *   show a photo without a second read.
 * - `GET /promotions/flash-sales` embeds `productVariant` only, so a flash-sale
 *   row knows "Túi 1 kg" but not which product that bag belongs to.
 *
 * Both are solved by the same read-only join against `GET /products/:id`, keyed
 * by the `productId` those payloads already provide. Nothing is invented here.
 *
 * The query key matches the product detail screen's, so opening a product from
 * the cart (or the reverse) is served from cache instead of refetching.
 *
 * A product that is still loading, or that failed, is simply absent from the
 * map; the caller then falls back to the neutral placeholder, never to a
 * different product's photo or name.
 */

import { useQueries } from "@tanstack/react-query";
import { primaryImage, resolveImageUrl } from "./promotions";
import { resources } from "./resources";
import type { Product } from "./types";

const PRODUCT_STALE_MS = 5 * 60_000;

/** `productId -> Product` map for the given ids (loading/failed ids omitted). */
export function useProductMap(productIds: number[]): Map<number, Product> {
  const unique = Array.from(new Set(productIds.filter((id) => Number.isFinite(id))));

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["product", id],
      queryFn: () => resources.getProduct(id),
      staleTime: PRODUCT_STALE_MS,
    })),
  });

  const map = new Map<number, Product>();
  results.forEach((result, index) => {
    const id = unique[index];
    if (result.data && id !== undefined) map.set(id, result.data);
  });
  return map;
}

/** Ready-to-render primary image url of a resolved product, or null. */
export function productImageUrl(product: Product | undefined): string | null {
  if (!product) return null;
  return resolveImageUrl(primaryImage(product));
}
