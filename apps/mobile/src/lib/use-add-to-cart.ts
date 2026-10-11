/**
 * One add-to-cart behaviour for every screen that shows a product card.
 *
 * Home, Catalogue and Product detail all offer the same button, so they must
 * behave the same way: same endpoint, same cache invalidation, same signed-out
 * handling. Duplicating that per screen is how one of them quietly drifts.
 *
 * Nothing is invented here — the quantity is always 1 and the price is whatever
 * the backend returns in the cart payload.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { displayVariant } from "./product-variant";
import { resources } from "./resources";
import type { Product } from "./types";

export interface AddToCart {
  /** Adds the variant the card is displaying. No-op when the card is sold out. */
  add: (product: Product) => void;
  /** Product id currently being added, so only that card shows a spinner. */
  pendingId: number | null;
  /** Last message to show the customer (success or failure). */
  notice: string | null;
  clearNotice: () => void;
  /** True when the customer must sign in before a cart write can succeed. */
  needsSignIn: boolean;
}

/**
 * @param token   the bearer token from `useAuth()`, or null when signed out
 * @param hydrated false while the stored session is still being read
 * @param onRequireSignIn called instead of adding when the customer is signed out
 */
export function useAddToCart({
  token,
  hydrated,
  onRequireSignIn,
}: {
  token: string | null;
  hydrated: boolean;
  onRequireSignIn?: () => void;
}): AddToCart {
  const client = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: ({ variantId }: { variantId: number }) => resources.addCartItem(variantId, 1),
    onSuccess: () => {
      setNotice("Đã thêm vào giỏ hàng.");
      void client.invalidateQueries({ queryKey: ["cart"] });
    },
    onError: () => {
      // The backend owns the reason (stock, variant status, session). Showing
      // its message verbatim beats inventing one here.
      setNotice("Không thêm được vào giỏ. Vui lòng thử lại.");
    },
    onSettled: () => setPendingId(null),
  });

  const add = useCallback(
    (product: Product) => {
      const variant = displayVariant(product);
      if (!variant) return;
      if (!hydrated) return;
      if (!token) {
        onRequireSignIn?.();
        return;
      }
      setNotice(null);
      setPendingId(product.id);
      mutation.mutate({ variantId: variant.id });
    },
    [hydrated, token, mutation, onRequireSignIn],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  return { add, pendingId, notice, clearNotice, needsSignIn: hydrated && !token };
}
