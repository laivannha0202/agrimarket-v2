/**
 * Giỏ hàng.
 *
 * Layout follows the UI Kit mockup: line cards with the real product photo,
 * unit price, stepper and per-line subtotal; a summary block whose every number
 * comes from the backend preview; and a sticky checkout bar.
 *
 * The four states are kept strictly separate, because collapsing them is how a
 * cart screen lies to the customer:
 * - not logged in  -> login CTA (not "empty cart")
 * - loading        -> spinner
 * - request failed -> error state, with the OFFLINE illustration only when the
 *                     server was never reached
 * - loaded & empty -> the empty-cart illustration
 *
 * PRICES ARE NEVER GUESSED. `GET /carts/me` carries no money at all — only the
 * variant's list price — so a line's real unit price, its discount and the
 * order totals come from `POST /orders/checkout-preview`. Until that answer
 * arrives the line shows a placeholder rather than a number that might be
 * wrong, and the whole summary block stays in its loading state. The cart and
 * the checkout therefore show the same amounts for the same lines.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomBar, Card, EmptyView, ErrorView, LinkPress, LoadingView, ProductThumb, QtyStepper } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { formatMoney, formatQuantity } from "../../src/lib/format";
import { resources } from "../../src/lib/resources";
import { colors, elevation, radius, spacing, TOUCH } from "../../src/lib/theme";
import type { CartItem, CheckoutPreviewLine } from "../../src/lib/types";
import { productImageUrl, useProductMap } from "../../src/lib/use-products";
import { useAuth } from "../../src/providers";

export default function CartScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();

  const cart = useQuery({
    queryKey: ["cart"],
    queryFn: () => resources.getCart(),
    enabled: hydrated && token !== null,
    retry: false,
  });

  const lines = cart.data?.items ?? [];

  /**
   * Image + partner join. `GET /carts/me` sends only the bare product row, so
   * the photo has to be read from the product resource by id (same query key as
   * the product screen, so it is cache-shared).
   */
  const products = useProductMap(lines.map((i) => i.productVariant.product.id));

  const preview = useQuery({
    queryKey: ["checkout-preview", cart.data?.id, lines.map((i) => `${i.productVariantId}:${i.quantity}`).join(",")],
    queryFn: () =>
      resources.checkoutPreview({
        items: lines.map((i) => ({ productVariantId: i.productVariantId, quantity: Number(i.quantity) })),
      }),
    enabled: hydrated && token !== null && lines.length > 0,
  });

  /** Server-computed unit price / availability, keyed by variant. */
  const previewByVariant = useMemo(() => {
    const map = new Map<number, CheckoutPreviewLine>();
    for (const line of preview.data?.items ?? []) map.set(line.productVariantId, line);
    return map;
  }, [preview.data]);

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["cart"] });
  };

  const updateQty = useMutation({
    mutationFn: ({ id, qty }: { id: number; qty: number }) => resources.updateCartItem(id, qty),
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: (id: number) => resources.removeCartItem(id),
    onSuccess: invalidate,
  });

  const clearCart = useMutation({
    mutationFn: () => resources.clearCart(),
    onSuccess: invalidate,
  });

  /* ------------------------------------------------------------- states -- */

  if (!hydrated) return <LoadingView message="Đang tải…" />;

  if (!token) {
    return (
      <View style={styles.statePage}>
        <EmptyView
          kind="cart"
          title="Chưa đăng nhập"
          message="Đăng nhập để xem giỏ hàng của bạn."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/(tabs)/cart" } })}
          fill
        />
      </View>
    );
  }

  if (cart.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải giỏ hàng…" />
      </View>
    );
  }

  if (cart.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(cart.error, "Không tải được giỏ hàng.")}
          onRetry={() => void cart.refetch()}
          network={isNetworkError(cart.error)}
          fill
        />
      </View>
    );
  }

  if (lines.length === 0) {
    return (
      <View style={styles.statePage}>
        <EmptyView
          kind="cart"
          title="Giỏ hàng trống"
          message="Thêm sản phẩm để bắt đầu đặt hàng."
          actionLabel="Xem sản phẩm"
          onAction={() => router.push("/(tabs)/catalog")}
          fill
        />
      </View>
    );
  }

  /* --------------------------------------------------------------- ready -- */

  const hasUnavailable = (preview.data?.items ?? []).some((l) => !l.available);
  const busyItemId = updateQty.isPending
    ? updateQty.variables?.id
    : removeItem.isPending
      ? removeItem.variables
      : undefined;
  const mutationError = updateQty.error ?? removeItem.error ?? clearCart.error;
  const canCheckout = !preview.isPending && preview.data !== undefined && !hasUnavailable;

  const renderLine = (item: CartItem) => {
    const line = previewByVariant.get(item.productVariantId);
    const qty = Number(item.quantity);
    const busy = busyItemId === item.id;
    const product = products.get(item.productVariant.product.id);
    const image = productImageUrl(product);
    const maxQty = line ? Math.max(1, Math.floor(line.availableQuantity)) : undefined;
    // The price is known only once the backend preview has answered. Showing the
    // catalogue list price in the meantime would print a number the customer may
    // not be charged, so the line waits for the authoritative one.
    const priced = line !== undefined;
    const discounted = priced && line.unitPrice < line.basePrice;

    return (
      <View key={item.id} style={styles.line}>
        <LinkPress
          href={{ pathname: "/product/[id]", params: { id: String(item.productVariant.product.id) } }}
          accessibilityLabel={`Xem ${item.productVariant.name}`}
        >
          <ProductThumb uri={image} size={68} />
        </LinkPress>

        <View style={styles.lineBody}>
          <LinkPress
            href={{ pathname: "/product/[id]", params: { id: String(item.productVariant.product.id) } }}
            accessibilityLabel={line?.productName ?? item.productVariant.product.name}
          >
            <Text style={styles.name} numberOfLines={2}>
              {line?.productName ?? item.productVariant.product.name}
            </Text>
          </LinkPress>
          {/* Quy cách (pack size) comes from the API's variant row. */}
          <Text style={styles.spec} numberOfLines={1}>
            {item.productVariant.name}
            {item.productVariant.saleUnit ? ` · ${item.productVariant.saleUnit}` : ""}
          </Text>

          <View style={styles.priceRow}>
            {priced ? (
              <>
                <Text style={styles.unit}>{formatMoney(line.unitPrice)}</Text>
                {discounted ? <Text style={styles.unitWas}>{formatMoney(line.basePrice)}</Text> : null}
              </>
            ) : (
              <Text style={styles.pricePending}>Đang tính giá…</Text>
            )}
          </View>

          {line && !line.available ? (
            <View style={styles.warnRow}>
              <Ionicons name="alert-circle" size={13} color={colors.danger} />
              <Text style={styles.warnText}>
                Chỉ còn {formatQuantity(line.availableQuantity, item.productVariant.saleUnit)}. Vui lòng giảm số lượng.
              </Text>
            </View>
          ) : null}

          <View style={styles.lineFoot}>
            <QtyStepper
              value={qty}
              busy={busy}
              max={maxQty}
              onChange={(next) => updateQty.mutate({ id: item.id, qty: next })}
            />
            {/* Per-line subtotal, so the customer can check the arithmetic. The
                order totals are stated once, in the summary block below. */}
            <View style={styles.lineRight}>
              <Text style={styles.subtotalLabel}>Tạm tính</Text>
              <Text style={styles.subtotal}>{priced ? formatMoney(line.subtotal) : "—"}</Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => removeItem.mutate(item.id)}
          disabled={busy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Xoá ${item.productVariant.name} khỏi giỏ`}
          style={({ pressed }) => [styles.trash, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          <Text style={styles.headCount}>Giỏ hàng ({formatQuantity(lines.length)})</Text>
          <Pressable
            onPress={() => clearCart.mutate()}
            disabled={clearCart.isPending}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ disabled: clearCart.isPending }}
          >
            <Text style={styles.clear}>{clearCart.isPending ? "Đang xoá…" : "Xoá tất cả"}</Text>
          </Pressable>
        </View>

        {mutationError ? (
          <View style={styles.inlineError}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.inlineErrorText}>
              {errorMessage(mutationError, "Cập nhật giỏ hàng thất bại. Vui lòng thử lại.")}
            </Text>
          </View>
        ) : null}

        {lines.map(renderLine)}

        {/* Voucher selection lives in checkout, where the code is validated
            against the real order and the discount is shown. */}
        <LinkPress
          href="/checkout"
          style={({ pressed }) => [styles.voucherRow, pressed && styles.pressed]}
          accessibilityLabel="Chọn mã giảm giá ở bước đặt hàng"
        >
          <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
          <Text style={styles.voucherText}>Mã giảm giá</Text>
          <Text style={styles.voucherAction}>Chọn ở bước đặt hàng</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.primary} />
        </LinkPress>

        {/* Order breakdown. Every number comes from the backend preview; the
            grand total itself is stated once, in the sticky bar below, so the
            same amount is never printed twice on one screen. */}
        <Card>
          <Text style={styles.section}>Tổng đơn</Text>
          {preview.isPending ? (
            <LoadingView message="Đang tính tổng tiền…" />
          ) : preview.isError ? (
            <ErrorView
              message={errorMessage(preview.error, "Không tính được tổng tiền.")}
              onRetry={() => void preview.refetch()}
              network={isNetworkError(preview.error)}
            />
          ) : preview.data ? (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.muted}>Tiền hàng</Text>
                <Text style={styles.total}>{formatMoney(preview.data.subtotal)}</Text>
              </View>
              {/* One discount row. The backend reports the voucher discount in
                  `discountTotal` and repeats the same amount under `voucher`,
                  so rendering both printed the identical number twice. */}
              {preview.data.discountTotal > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={styles.muted}>
                    Giảm giá{preview.data.voucher ? ` (${preview.data.voucher.code})` : ""}
                  </Text>
                  <Text style={styles.discount}>−{formatMoney(preview.data.discountTotal)}</Text>
                </View>
              ) : null}
              <View style={styles.totalRow}>
                <Text style={styles.muted}>Phí vận chuyển</Text>
                <Text style={styles.total}>{formatMoney(preview.data.shippingFee)}</Text>
              </View>
            </>
          ) : null}
        </Card>

        {hasUnavailable ? (
          <View style={styles.blockNote}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.blockNoteText}>
              Một số sản phẩm không đủ hàng. Vui lòng điều chỉnh trước khi đặt.
            </Text>
          </View>
        ) : null}

        <View style={styles.bottomPad} />
      </ScrollView>

      <BottomBar style={styles.actionBar} safeArea={false}>
        {preview.data ? (
          <View style={styles.barTotalRow}>
            <Text style={styles.barTotalLabel}>Tổng thanh toán</Text>
            <Text style={styles.barTotal}>{formatMoney(preview.data.grandTotal)}</Text>
          </View>
        ) : null}
        <LinkPress
          href="/checkout"
          style={({ pressed }) => [styles.checkout, !canCheckout && styles.disabled, pressed && styles.pressed]}
          disabled={!canCheckout}
          accessibilityLabel="Tiến hành thanh toán"
        >
          <Text style={styles.checkoutText}>
            {hasUnavailable ? "Điều chỉnh số lượng để tiếp tục" : "Tiến hành thanh toán"}
          </Text>
        </LinkPress>
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md, paddingBottom: spacing.md },
  bottomPad: { height: spacing.lg },
  pressed: { opacity: 0.85 },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    minHeight: TOUCH,
  },
  headCount: { fontSize: 16, fontWeight: "700", color: colors.textStrong },
  clear: { fontSize: 13, color: colors.danger, fontWeight: "700" },

  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  inlineErrorText: { flex: 1, fontSize: 12.5, color: colors.danger },

  line: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  lineBody: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 19 },
  spec: { fontSize: 12, color: colors.muted },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 1 },
  unit: { fontSize: 14, fontWeight: "700", color: colors.primary },
  unitWas: { fontSize: 12, color: colors.mutedSoft, textDecorationLine: "line-through" },
  pricePending: { fontSize: 12.5, color: colors.mutedSoft, fontStyle: "italic" },

  warnRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 },
  warnText: { flex: 1, fontSize: 11.5, color: colors.danger, lineHeight: 16 },

  lineFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  lineRight: { alignItems: "flex-end" },
  subtotalLabel: { fontSize: 10.5, color: colors.mutedSoft },
  subtotal: { fontSize: 14.5, fontWeight: "700", color: colors.textStrong },

  trash: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },

  voucherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH + 4,
    marginBottom: spacing.sm,
  },
  voucherText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  voucherAction: { fontSize: 12.5, fontWeight: "700", color: colors.primary },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  muted: { fontSize: 13, color: colors.muted },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  total: { fontWeight: "600", color: colors.text },
  discount: { fontWeight: "700", color: colors.primary },

  blockNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  blockNoteText: { flex: 1, fontSize: 12.5, color: colors.danger },

  actionBar: { gap: spacing.sm },
  barTotalRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  barTotalLabel: { fontSize: 13, color: colors.muted },
  barTotal: { fontSize: 17, fontWeight: "700", color: colors.primary },
  checkout: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: TOUCH + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkoutText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
});
