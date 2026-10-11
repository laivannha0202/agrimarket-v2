"use client";

/**
 * Shared hooks for the promotion index.
 *
 * The two public promotion endpoints are fetched once and reused by every
 * price display, instead of being requested per card.
 *
 * The promotion window is evaluated against the `useNow` clock store, not
 * against a `Date.now()` read during render, so price rendering stays pure.
 * While the clock is unknown (`0`, i.e. the server/hydration render) the index
 * is built with the window check disabled and is rebuilt as soon as the real
 * time arrives.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useNow } from "@/lib/hooks/useNow";
import { buildPromotionIndex, type PromotionIndex } from "@/lib/promotions";
import type { FlashSale, ProductDiscount } from "@/lib/api/types";

export function usePromotionIndex() {
  const now = useNow();

  const flashQuery = useQuery({
    queryKey: queryKeys.flashSales.list(10),
    queryFn: () => resources.listFlashSales(10),
    staleTime: 60_000,
  });

  const discountQuery = useQuery({
    queryKey: queryKeys.productDiscounts.list(100),
    queryFn: () => resources.listProductDiscounts(100),
    staleTime: 60_000,
  });

  const index: PromotionIndex | undefined = useMemo(() => {
    if (!flashQuery.data && !discountQuery.data) return undefined;
    return buildPromotionIndex(flashQuery.data?.data, discountQuery.data?.data, now);
  }, [flashQuery.data, discountQuery.data, now]);

  return {
    index,
    isLoading: flashQuery.isLoading || discountQuery.isLoading,
    isError: flashQuery.isError && discountQuery.isError,
    flashSales: flashQuery.data?.data ?? [],
  };
}

/** Same shape, but built from already-fetched lists (e.g. product detail). */
export function usePromotionIndexFrom(
  flashSales: FlashSale[] | undefined,
  discounts: ProductDiscount[] | undefined,
) {
  const now = useNow();
  return useMemo(
    () => buildPromotionIndex(flashSales, discounts, now),
    [flashSales, discounts, now],
  );
}
