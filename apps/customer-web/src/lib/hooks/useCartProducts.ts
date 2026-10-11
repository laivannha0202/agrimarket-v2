"use client";

/**
 * Resolves the product details a cart line needs but the cart API does not send.
 *
 * `GET /carts/me` embeds only the plain product row (`include: { product: true }`):
 * no `partner`, `images`, `category` or `variants`. The cart UI nevertheless has
 * to show the partner name (the order is split per partner) and the product
 * image, so those are read from the public product resource, keyed by the
 * `productId` the cart does provide.
 *
 * This is a read-only join against real endpoints — nothing is invented, and the
 * product detail query key is shared with the product pages, so visiting a
 * product after viewing the cart (or the reverse) hits the cache.
 *
 * The returned map is rebuilt on every render on purpose: it holds a handful of
 * entries, and giving it a stable identity would require memoising on data that
 * React Query already keeps stable. Consumers therefore index it directly rather
 * than depending on its identity.
 */

import { useQueries } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import type { Product } from "@/lib/api/types";

/**
 * Fetches each distinct product once and returns a `productId -> Product` map.
 * Products still loading (or that failed) are simply absent from the map.
 */
export function useCartProducts(productIds: number[]): Map<number, Product> {
  const unique = Array.from(new Set(productIds.filter((id) => Number.isFinite(id))));

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: queryKeys.products.detail(id),
      queryFn: () => resources.getProduct(id),
      staleTime: 5 * 60_000,
    })),
  });

  const map = new Map<number, Product>();
  results.forEach((result, index) => {
    if (result.data) map.set(unique[index], result.data);
  });
  return map;
}

/** Primary image url of a resolved product, or null when it has none. */
export function primaryImageUrl(product: Product | undefined): string | null {
  if (!product) return null;
  return (
    product.images.find((image) => image.isPrimary)?.url ?? product.images[0]?.url ?? null
  );
}
