"use client";

/**
 * Cart — the web twin of the Mobile cart tab.
 *
 * Layout follows the Mobile screen: line cards with the real product photo,
 * unit price, stepper and per-line subtotal; a summary block whose every number
 * comes from the backend preview; and a bottom checkout bar.
 *
 * PRICES ARE NEVER GUESSED. `GET /carts/me` carries no money at all — only the
 * variant's list price — so a line's real unit price, its discount and the
 * order totals come from `POST /orders/checkout-preview`. Until that answer
 * arrives the line shows a placeholder rather than a number that might be
 * wrong, and the summary block stays in its loading state, so the cart and the
 * checkout always show the same amounts for the same lines.
 */

import { Button, Container, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronRight,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useCartProducts, primaryImageUrl } from "@/lib/hooks/useCartProducts";
import { ProductImage } from "@/components/common/ProductImage";
import { EmptyState, ErrorState } from "@/components/common/States";
import { AppCard, BottomBar, LoadingView, QtyStepper } from "@/components/ui/kit";
import { layout } from "@/theme";
import type { Cart, CartItem, CheckoutPreviewLine } from "@/lib/api/types";

export function CartView() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const cartQuery = useQuery({
    queryKey: queryKeys.cart.me(),
    queryFn: resources.getCart,
  });

  const items = useMemo(() => cartQuery.data?.items ?? [], [cartQuery.data]);

  /**
   * Image + name join. `GET /carts/me` sends only the bare product row, so the
   * photo has to be read from the public product resource by id (same query key
   * as the product pages, so the cache is shared).
   */
  const productIds = useMemo(
    () => items.map((item) => item.productVariant.product.id),
    [items],
  );
  const products = useCartProducts(productIds);

  const applyCart = (cart: Cart) => {
    queryClient.setQueryData(queryKeys.cart.me(), cart);
  };

  const updateQty = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      resources.updateCartItem(itemId, quantity),
    onSuccess: applyCart,
  });

  const removeItem = useMutation({
    mutationFn: (itemId: number) => resources.removeCartItem(itemId),
    onSuccess: applyCart,
  });

  const clearCart = useMutation({
    mutationFn: () => resources.clearCart(),
    onSuccess: applyCart,
  });

  /**
   * The preview prices the lines the signature encodes (`variantId:quantity`),
   * so a quantity change swaps the key and the totals are recomputed by the
   * backend before anything is shown.
   */
  const signature = items
    .map((item) => `${item.productVariantId}:${item.quantity}`)
    .join(",");

  const previewQuery = useQuery({
    queryKey: queryKeys.checkout.preview(signature),
    queryFn: () => resources.checkoutPreview({}),
    enabled: items.length > 0,
    retry: false,
  });

  /** Server-computed unit price / availability, keyed by variant. */
  const previewByVariant = useMemo(() => {
    const map = new Map<number, CheckoutPreviewLine>();
    for (const line of previewQuery.data?.items ?? []) {
      map.set(line.productVariantId, line);
    }
    return map;
  }, [previewQuery.data]);

  /* ------------------------------------------------------------- states -- */

  if (cartQuery.isLoading) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 24 }}>
        <LoadingView label="Đang tải giỏ hàng…" />
      </Container>
    );
  }

  if (cartQuery.isError) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 24 }}>
        <ErrorState error={cartQuery.error} onRetry={() => cartQuery.refetch()} />
      </Container>
    );
  }

  if (items.length === 0) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 24 }}>
        <EmptyState
          kind="cart"
          title="Giỏ hàng trống"
          description="Thêm sản phẩm để bắt đầu đặt hàng."
          action={
            <Button component={Link} href="/san-pham" radius={8}>
              Xem sản phẩm
            </Button>
          }
        />
      </Container>
    );
  }

  /* --------------------------------------------------------------- ready -- */

  const hasUnavailable = (previewQuery.data?.items ?? []).some((line) => !line.available);
  const busyItemId = updateQty.isPending
    ? updateQty.variables?.itemId
    : removeItem.isPending
      ? removeItem.variables
      : undefined;
  const mutationError = updateQty.error ?? removeItem.error ?? clearCart.error;
  const canCheckout =
    !previewQuery.isPending && previewQuery.data !== undefined && !hasUnavailable;

  const renderLine = (item: CartItem) => {
    const line = previewByVariant.get(item.productVariantId);
    const qty = Number(item.quantity);
    const busy = busyItemId === item.id;
    const product = item.productVariant.product;
    const resolved = products.get(product.id);
    const image = primaryImageUrl(resolved);
    const name = line?.productName ?? product.name;
    const maxQty = line ? Math.max(1, Math.floor(line.availableQuantity)) : undefined;
    // The price is known only once the backend preview has answered. Showing the
    // catalogue list price in the meantime would print a number the customer may
    // not be charged, so the line waits for the authoritative one.
    const priced = line !== undefined;
    const discounted = priced && line.unitPrice < line.basePrice;

    return (
      <AppCard key={item.id} className="agri-press">
        <Group align="flex-start" gap={10} wrap="nowrap">
          <Link
            href={`/san-pham/${product.id}`}
            aria-label={`Xem ${name}`}
            style={{ flexShrink: 0, width: 68, display: "block" }}
          >
            <ProductImage src={image} alt={name} ratio={1} radius={10} />
          </Link>

          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text
              component={Link}
              href={`/san-pham/${product.id}`}
              fz={14}
              fw={600}
              lh="19px"
              c="var(--agri-text)"
              className="agri-clamp-2"
            >
              {name}
            </Text>
            {/* Quy cách (pack size) comes from the API's variant row. */}
            <Text fz={12} c="var(--agri-muted)" lineClamp={1}>
              {item.productVariant.name}
              {item.productVariant.saleUnit ? ` · ${item.productVariant.saleUnit}` : ""}
            </Text>

            <Group gap={6} align="baseline" mt={1}>
              {priced ? (
                <>
                  <Text fz={14} fw={700} c="var(--agri-primary)">
                    {formatMoney(line.unitPrice)}
                  </Text>
                  {discounted ? (
                    <Text fz={12} c="var(--agri-muted-soft)" td="line-through">
                      {formatMoney(line.basePrice)}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text fz={12.5} c="var(--agri-muted-soft)" fs="italic">
                  Đang tính giá…
                </Text>
              )}
            </Group>

            {line && !line.available ? (
              <Group gap={4} align="flex-start" wrap="nowrap" mt={2}>
                <IconAlertCircle
                  size={13}
                  color="var(--agri-danger)"
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <Text fz={11.5} lh="16px" c="var(--agri-danger)" style={{ flex: 1 }}>
                  Chỉ còn {formatQuantity(line.availableQuantity, item.productVariant.saleUnit)}.
                  Vui lòng giảm số lượng.
                </Text>
              </Group>
            ) : null}

            <Group justify="space-between" align="center" gap={10} wrap="nowrap" mt={10}>
              <QtyStepper
                value={qty}
                busy={busy}
                max={maxQty}
                ariaLabel={`Số lượng ${name}`}
                onChange={(next) => updateQty.mutate({ itemId: item.id, quantity: next })}
              />
              {/* Per-line subtotal, so the customer can check the arithmetic.
                  The order totals are stated once, in the summary block. */}
              <Stack gap={0} align="flex-end">
                <Text fz={10.5} c="var(--agri-muted-soft)">
                  Tạm tính
                </Text>
                <Text fz={14.5} fw={700} c="var(--agri-text-strong)">
                  {priced ? formatMoney(line.subtotal) : "—"}
                </Text>
              </Stack>
            </Group>
          </Stack>

          <UnstyledButton
            onClick={() => removeItem.mutate(item.id)}
            disabled={busy}
            aria-label={`Xoá ${name} khỏi giỏ`}
            className="agri-press"
            style={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: 8,
              flexShrink: 0,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            <IconTrash size={18} color="var(--agri-danger)" aria-hidden />
          </UnstyledButton>
        </Group>
      </AppCard>
    );
  };

  return (
    <Container
      size={layout.containerSize}
      px={{ base: 12, sm: "lg" }}
      py={{ base: 12, sm: 24 }}
      pb={{ base: 132, sm: 24 }}
    >
      <Group justify="space-between" align="center" wrap="nowrap" mb={8} style={{ minHeight: 44 }}>
        <Text fz={{ base: 16, sm: 20 }} fw={700} c="var(--agri-text-strong)">
          Giỏ hàng ({formatQuantity(items.length)})
        </Text>
        <UnstyledButton
          onClick={() => clearCart.mutate()}
          disabled={clearCart.isPending}
          aria-label="Xoá tất cả sản phẩm trong giỏ"
          className="agri-press"
          style={{ cursor: clearCart.isPending ? "default" : "pointer" }}
        >
          <Text fz={13} fw={700} c="var(--agri-danger)">
            {clearCart.isPending ? "Đang xoá…" : "Xoá tất cả"}
          </Text>
        </UnstyledButton>
      </Group>

      {mutationError ? (
        <Group
          gap={6}
          wrap="nowrap"
          align="center"
          mb={8}
          style={{
            background: "var(--agri-danger-soft)",
            border: "1px solid var(--agri-danger)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <IconAlertCircle size={15} color="var(--agri-danger)" style={{ flexShrink: 0 }} />
          <Text fz={12.5} c="var(--agri-danger)" style={{ flex: 1 }}>
            {mutationError instanceof ApiError
              ? mutationError.message
              : "Cập nhật giỏ hàng thất bại. Vui lòng thử lại."}
          </Text>
        </Group>
      ) : null}

      <Group align="flex-start" gap={12} wrap="wrap">
        <Stack gap={8} style={{ flex: "1 1 420px", minWidth: 0 }}>
          {items.map(renderLine)}

          {/* Voucher selection lives in checkout, where the code is validated
              against the real order and the discount is shown. */}
          <AppCard
            component={Link}
            href="/thanh-toan"
            className="agri-press"
            aria-label="Chọn mã giảm giá ở bước đặt hàng"
          >
            <Group gap={10} wrap="nowrap" style={{ minHeight: 24 }}>
              <IconTag size={18} color="var(--agri-primary)" aria-hidden />
              <Text fz={14} fw={600} c="var(--agri-text)" style={{ flex: 1 }}>
                Mã giảm giá
              </Text>
              <Text fz={12.5} fw={700} c="var(--agri-primary)">
                Chọn ở bước đặt hàng
              </Text>
              <IconChevronRight size={15} color="var(--agri-primary)" aria-hidden />
            </Group>
          </AppCard>
        </Stack>

        {/* Order breakdown. Every number comes from the backend preview; the
            grand total itself is stated once, in the bottom bar, so the same
            amount is never printed twice on one screen. */}
        <AppCard padding={16} w={{ base: "100%", md: 340 }} style={{ flexShrink: 0 }}>
          <Text fz={15} fw={700} c="var(--agri-text-strong)" mb={8}>
            Tổng đơn
          </Text>
          {previewQuery.isPending ? (
            <LoadingView label="Đang tính tổng tiền…" />
          ) : previewQuery.isError ? (
            <ErrorState
              error={previewQuery.error}
              title="Không tính được tổng tiền"
              onRetry={() => previewQuery.refetch()}
            />
          ) : previewQuery.data ? (
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap={12}>
                <Text fz={13} c="var(--agri-muted)">
                  Tiền hàng
                </Text>
                <Text fz={13.5} fw={600} c="var(--agri-text)">
                  {formatMoney(previewQuery.data.subtotal)}
                </Text>
              </Group>
              {/* One discount row. The backend reports the voucher discount in
                  `discountTotal` and repeats the same amount under `voucher`,
                  so rendering both would print the identical number twice. */}
              {previewQuery.data.discountTotal > 0 ? (
                <Group justify="space-between" wrap="nowrap" gap={12}>
                  <Text fz={13} c="var(--agri-muted)">
                    Giảm giá
                    {previewQuery.data.voucher ? ` (${previewQuery.data.voucher.code})` : ""}
                  </Text>
                  <Text fz={13.5} fw={700} c="var(--agri-primary)">
                    −{formatMoney(previewQuery.data.discountTotal)}
                  </Text>
                </Group>
              ) : null}
              <Group justify="space-between" wrap="nowrap" gap={12}>
                <Text fz={13} c="var(--agri-muted)">
                  Phí vận chuyển
                </Text>
                <Text fz={13.5} fw={600} c="var(--agri-text)">
                  {formatMoney(previewQuery.data.shippingFee)}
                </Text>
              </Group>
            </Stack>
          ) : null}
        </AppCard>
      </Group>

      {hasUnavailable ? (
        <Group gap={6} wrap="nowrap" align="center" mt={8} px={4}>
          <IconAlertCircle size={15} color="var(--agri-danger)" style={{ flexShrink: 0 }} />
          <Text fz={12.5} c="var(--agri-danger)" style={{ flex: 1 }}>
            Một số sản phẩm không đủ hàng. Vui lòng điều chỉnh trước khi đặt.
          </Text>
        </Group>
      ) : null}

      {/* ------------------------------------------------- action bar ------- */}
      <BottomBar aboveTabs>
        <Stack gap={10}>
          {previewQuery.data ? (
            <Group justify="space-between" align="baseline" wrap="nowrap">
              <Text fz={13} c="var(--agri-muted)">
                Tổng thanh toán
              </Text>
              <Text fz={{ base: 17, sm: 18 }} fw={700} c="var(--agri-primary)">
                {formatMoney(previewQuery.data.grandTotal)}
              </Text>
            </Group>
          ) : (
            <Text fz={13} c="var(--agri-muted)">
              {previewQuery.isPending
                ? "Đang tính tổng tiền…"
                : "Chưa tính được tổng tiền. Vui lòng thử lại."}
            </Text>
          )}
          <Button
            radius={8}
            size="md"
            fullWidth
            disabled={!canCheckout}
            onClick={() => router.push("/thanh-toan")}
            styles={{ root: { minHeight: 48 }, label: { fontSize: 15, fontWeight: 700 } }}
          >
            {hasUnavailable ? "Điều chỉnh số lượng để tiếp tục" : "Tiến hành thanh toán"}
          </Button>
        </Stack>
      </BottomBar>
    </Container>
  );
}
