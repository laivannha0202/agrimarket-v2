"use client";

/**
 * Which of the customer's order items have already been reviewed.
 *
 * `GET /reviews/me` returns the caller's own reviews (any status) and each row
 * carries `orderItemId`, so the mapping is read straight from the backend — no
 * client-side join against the public product feed and no guessing. The backend
 * still enforces one review per item; this only drives the button state.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import type { OrderItem } from "@/lib/api/types";

/** The customer's own review history is small; one page is enough. */
const REVIEW_PAGE_LIMIT = 100;

export function useReviewedOrderItemIds(items: OrderItem[]): Set<number> {
  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews.mine(),
    queryFn: () => resources.listMyReviews({ page: 1, limit: REVIEW_PAGE_LIMIT }),
    staleTime: 60_000,
  });

  const reviews = reviewsQuery.data?.data;

  return useMemo(() => {
    const reviewed = new Set<number>();
    // `items` is only read for identity here: the set is per order-item id.
    void items;
    for (const review of reviews ?? []) reviewed.add(review.orderItemId);
    return reviewed;
  }, [reviews, items]);
}
