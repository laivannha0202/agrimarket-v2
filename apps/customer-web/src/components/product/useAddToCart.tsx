"use client";

/**
 * One quick-add-to-cart behaviour for every screen that shows a product card
 * (home strips, catalog grid) — the web twin of the Mobile `useAddToCart`.
 *
 * Same endpoint, same cache write, same signed-out handling everywhere: the
 * variant the card displays, always quantity 1. The cart payload the backend
 * returns is written straight into the React Query cache; no price, stock or
 * total is computed here.
 */

import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuth } from "@/lib/auth/useAuth";
import { displayVariant } from "@/lib/product-variant";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import type { Product } from "@/lib/api/types";

export function useAddToCart({ redirectPath = "/" }: { redirectPath?: string } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, isCustomer } = useAuth();
  const { index } = usePromotionIndex();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: ({ variantId }: { variantId: number; productName: string }) =>
      resources.addCartItem(variantId, 1),
    onSuccess: (cart, variables) => {
      queryClient.setQueryData(queryKeys.cart.me(), cart);
      queryClient.invalidateQueries({ queryKey: queryKeys.cart.all });
      notifications.show({
        title: "Đã thêm vào giỏ",
        message: `${variables.productName} đã có trong giỏ hàng.`,
        color: "agri",
        icon: <IconCheck size={16} />,
      });
    },
    onError: (error) => {
      notifications.show({
        title: "Không thêm được vào giỏ",
        message:
          error instanceof ApiError
            ? error.message
            : "Sản phẩm hiện không thể thêm vào giỏ. Vui lòng thử lại.",
        color: "red",
        icon: <IconAlertTriangle size={16} />,
      });
    },
    onSettled: () => setPendingId(null),
  });

  const add = useCallback(
    (product: Product) => {
      const displayed = displayVariant(product, index);
      // No-op when nothing on the card can be bought — mirrors the Mobile hook.
      if (!displayed || !displayed.variant.inStock) return;
      if (!isAuthenticated) {
        router.push(`/dang-nhap?tiep-theo=${encodeURIComponent(redirectPath)}`);
        return;
      }
      if (!isCustomer) {
        notifications.show({
          title: "Tài khoản không phù hợp",
          message: "Vui lòng đăng nhập bằng tài khoản khách hàng để mua hàng.",
          color: "orange",
        });
        return;
      }
      setPendingId(product.id);
      mutation.mutate({ variantId: displayed.variant.id, productName: product.name });
    },
    [index, isAuthenticated, isCustomer, mutation, router, redirectPath],
  );

  return { add, pendingId };
}
