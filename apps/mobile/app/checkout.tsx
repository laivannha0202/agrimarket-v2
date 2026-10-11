/**
 * Đặt hàng (checkout).
 *
 * The financial contract is unchanged and deliberate:
 * - `POST /orders/checkout-preview` is the ONLY source of the amounts shown;
 * - `expectedGrandTotal` is echoed back so the backend can reject a stale total
 *   with 409, and the screen then refreshes the preview and demands a fresh
 *   confirmation instead of silently re-submitting a different price;
 * - one `Idempotency-Key` per payload signature, so a retry of the same payload
 *   replays the order it already created (a lost response must not double-order);
 * - the submit button is disabled while in flight, which is what actually stops
 *   a double-tap from creating two orders.
 *
 * ONE CONFIRMATION, NOT TWO
 *
 * The screen previously tracked "has the customer confirmed the total" and
 * started at `null`, so on the first visit the total was already "unconfirmed":
 * a permanent yellow "Xác nhận tổng …" bar appeared and the only submit button
 * was disabled. A normal order therefore could not be placed at all.
 *
 * The preview is authoritative, so there is nothing to confirm on arrival. A
 * second step is owed only when the backend re-prices the order *after* the
 * customer was shown a total (the 409 path) — then the new amount is displayed
 * and the customer accepts it with the same single button.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  Badge,
  BottomBar,
  Card,
  EmptyView,
  ErrorView,
  GhostButton,
  LoadingView,
  PrimaryButton,
} from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatAddressLine, isCatalogueAddress } from "../src/lib/address";
import {
  buildCheckoutPayload,
  carryPendingTotal,
  checkoutErrorMessage,
  classifyCheckoutConflict,
  needsTotalConfirm,
  parseBuyNowParam,
  translatedMessage,
} from "../src/lib/checkout";
import { formatMoney } from "../src/lib/format";
import { newIdempotencyKey } from "../src/lib/promotions";
import { resources, type CheckoutPayload } from "../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { appliedVoucherCode, splitVouchers, voucherValueLabel } from "../src/lib/vouchers";
import { useAuth } from "../src/providers";

export default function CheckoutScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { buyNow } = useLocalSearchParams<{ buyNow?: string }>();

  // "Mua ngay": checkout với dòng hàng chỉ định, không qua giỏ.
  // buyNow absent (undefined) -> dùng giỏ; buyNow present-but-malformed -> lỗi.
  const hasBuyNow = buyNow !== undefined;
  const directItems = useMemo(() => (hasBuyNow ? parseBuyNowParam(buyNow) : null), [buyNow, hasBuyNow]);
  const buyNowInvalid = hasBuyNow && directItems === null;

  const [addressId, setAddressId] = useState<number | null>(null);
  const [appliedVoucher, setAppliedVoucher] = useState("");
  const [note, setNote] = useState("");
  /**
   * The total the customer must accept before submitting, or `null`.
   *
   * Set ONLY by the 409 re-price path (see `submit`). It is not a record of what
   * the customer has "seen" — the preview is trusted on arrival, which is why a
   * first visit needs no confirmation at all.
   */
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);

  const cart = useQuery({
    queryKey: ["cart"],
    queryFn: () => resources.getCart(),
    enabled: hydrated && token !== null && !hasBuyNow,
  });

  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => resources.listAddresses(),
    enabled: hydrated && token !== null,
  });

  /** Public voucher catalogue — the same list the backend validates against. */
  const vouchers = useQuery({
    queryKey: ["vouchers"],
    queryFn: () => resources.listVouchers(50),
    enabled: hydrated && token !== null,
    staleTime: 60_000,
  });

  const items = useMemo(
    () =>
      directItems ??
      (cart.data?.items ?? []).map((i) => ({
        productVariantId: i.productVariantId,
        quantity: Number(i.quantity),
      })),
    [cart.data, directItems],
  );

  const itemSignature = items.map((i) => `${i.productVariantId}:${i.quantity}`).join(",");

  const preview = useQuery({
    queryKey: ["checkout-preview", itemSignature, appliedVoucher],
    queryFn: () =>
      resources.checkoutPreview({
        items: items.length > 0 ? items : undefined,
        voucherCode: appliedVoucher || undefined,
      }),
    enabled: hydrated && token !== null && items.length > 0,
  });

  const addressList = addresses.data ?? [];
  /**
   * One idempotency key per payload signature.
   *
   * The signature is deliberately the *request* inputs the customer controls
   * (lines, voucher, address) and NOT `expectedGrandTotal`: a retry after a lost
   * response must reuse the key so the backend replays the order it already
   * created. Adding the total would mint a new key on every re-price and defeat
   * exactly that guarantee.
   *
   * A new key is minted by comparing signatures during render — the same
   * adjust-during-render pattern the catalogue uses for its route params, and
   * the reason `signatureKey` is not a `useMemo` dependency (nothing is derived
   * from it; it only decides *when* the key is replaced).
   */
  const signatureKey = `${itemSignature}|${appliedVoucher}|${addressId ?? ""}`;
  const [idempotency, setIdempotency] = useState(() => ({ signature: signatureKey, key: newIdempotencyKey() }));
  if (idempotency.signature !== signatureKey) {
    setIdempotency({ signature: signatureKey, key: newIdempotencyKey() });
    // A changed order clears any pending re-price confirmation — see
    // `carryPendingTotal`. The 409 path refetches the preview without touching
    // the signature, so the confirmation it owes survives.
    setPendingTotal(carryPendingTotal(idempotency.signature, signatureKey, pendingTotal));
  }
  const idempotencyKey = idempotency.key;

  const selectedAddress =
    addressList.find((a) => a.id === addressId) ?? addressList.find((a) => a.isDefault) ?? addressList[0];

  /**
   * Voucher options split by whether the backend is expected to accept them.
   *
   * Declared here, before any early return, because a hook may not run
   * conditionally. The subtotal comes from the preview and is 0 until it
   * arrives — at which point every code with a minimum order simply reads
   * "chưa đủ điều kiện" until the real amount lands, which is the honest state.
   */
  const voucherGroups = useMemo(
    () => splitVouchers(vouchers.data?.data ?? [], preview.data?.subtotal ?? 0),
    [vouchers.data, preview.data],
  );

  /* ------------------------------------------------------------- states -- */

  if (!hydrated) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải…" />
      </View>
    );
  }
  if (!token) {
    return (
      <View style={styles.statePage}>
        <EmptyView
          kind="cart"
          title="Chưa đăng nhập"
          message="Đăng nhập để hoàn tất đặt hàng."
          actionLabel="Đăng nhập"
          onAction={() =>
            router.push({
              pathname: "/login",
              params: { redirect: hasBuyNow ? `/checkout?buyNow=${buyNow}` : "/checkout" },
            })
          }
          fill
        />
      </View>
    );
  }
  if (cart.isPending && !hasBuyNow) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải giỏ hàng…" />
      </View>
    );
  }
  if (cart.isError && !hasBuyNow) {
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

  if (buyNowInvalid || items.length === 0) {
    return (
      <View style={styles.statePage}>
        <EmptyView
          kind="cart"
          title={buyNowInvalid ? "Dòng hàng không hợp lệ" : "Chưa có sản phẩm để đặt"}
          message={
            buyNowInvalid
              ? "Thông tin mua ngay không đọc được. Vui lòng chọn lại sản phẩm."
              : "Thêm sản phẩm vào giỏ hàng trước khi đặt hàng."
          }
          actionLabel="Xem sản phẩm"
          onAction={() => router.push("/(tabs)/catalog")}
          fill
        />
      </View>
    );
  }

  /* -------------------------------------------------------------- submit -- */

  const submit = async () => {
    if (submitting || !selectedAddress || !preview.data) return;
    setSubmitting(true);
    setSubmitError(null);
    /**
     * The payload is built by the shared helper so the address book and this
     * screen cannot drift apart. It sends the verified `provinceCode` /
     * `wardCode` pair for a catalogue address (the backend re-resolves the
     * official name and rejects a code that does not belong to the province),
     * and the stored free text for a legacy address.
     *
     * The total is `preview.data.grandTotal` — the amount the BACKEND computed.
     * No fee, discount or price is calculated here.
     */
    const payload: CheckoutPayload = buildCheckoutPayload(
      selectedAddress,
      items,
      appliedVoucher,
      note,
      preview.data,
    );
    try {
      const order = await resources.checkout(payload, idempotencyKey);
      void client.invalidateQueries({ queryKey: ["cart"] });
      void client.invalidateQueries({ queryKey: ["orders"] });
      router.replace({ pathname: "/order/[id]", params: { id: String(order.id), success: "1" } });
    } catch (err) {
      const conflict = classifyCheckoutConflict(err);
      if (conflict === "total-changed") {
        // The price/voucher/stock really did move: refresh the preview and make
        // the customer accept the NEW amount. `pendingTotal` switches the CTA to
        // the confirmation step; the refreshed preview is what gets displayed.
        setPendingTotal(preview.data.grandTotal);
        await preview.refetch();
        setSubmitError(checkoutErrorMessage(err, translatedMessage(err)));
      } else if (conflict === "in-flight") {
        // Same request, still processing. Retrying with the SAME key is correct
        // and safe, so no confirmation is demanded — that would force the
        // customer to re-confirm a total that never changed.
        setSubmitError(
          "Đơn hàng trước đang được xử lý. Vui lòng đợi vài giây rồi bấm đặt hàng lại (không tạo đơn trùng).",
        );
      } else {
        setSubmitError(checkoutErrorMessage(err, translatedMessage(err)));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const grandTotal = preview.data?.grandTotal;
  const needsConfirm = needsTotalConfirm(preview.data, pendingTotal);
  const hasUnavailable = (preview.data?.items ?? []).some((l) => !l.available);
  const canSubmit =
    !submitting && selectedAddress !== undefined && preview.data !== undefined && !hasUnavailable;

  /* -------------------------------------------------------------- voucher -- */

  const appliedCode = appliedVoucherCode(preview.data);
  const voucherLookupSize = voucherGroups.eligible.length + voucherGroups.ineligible.length;

  const chooseVoucher = (code: string) => {
    setAppliedVoucher(code);
    setPendingTotal(null);
    setSubmitError(null);
    setVoucherPickerOpen(false);
  };

  const clearVoucher = () => {
    setAppliedVoucher("");
    setPendingTotal(null);
    setSubmitError(null);
    setVoucherPickerOpen(false);
  };

  const voucherDiscount = preview.data?.voucher?.discountAmount ?? 0;

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* --------------------------------------------------------- address -- */}
        <Card>
          <View style={styles.cardHead}>
            <Ionicons name="location-outline" size={17} color={colors.primary} />
            <Text style={styles.section}>Địa chỉ giao hàng</Text>
          </View>

          {addresses.isPending ? <LoadingView message="Đang tải địa chỉ…" /> : null}
          {addresses.isError ? (
            <ErrorView
              message={errorMessage(addresses.error, "Không tải được địa chỉ.")}
              onRetry={() => void addresses.refetch()}
              network={isNetworkError(addresses.error)}
            />
          ) : null}

          {addressList.map((a) => {
            const active = selectedAddress?.id === a.id;
            return (
              <Pressable
                key={a.id}
                onPress={() => setAddressId(a.id)}
                style={[styles.addr, active && styles.addrActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
              <View style={styles.addrHead}>
                <Ionicons
                  name={active ? "radio-button-on" : "radio-button-off"}
                  size={18}
                  color={active ? colors.primary : colors.mutedSoft}
                />
                {/* The name/phone line gets the full width; the badges sit on
                    their own row so a long phone number is never clipped to
                    "091…" by a badge crowding it. */}
                <Text style={styles.addrName} numberOfLines={1}>
                  {a.recipientName} · {a.phone}
                </Text>
              </View>
              {a.isDefault || !isCatalogueAddress(a) ? (
                <View style={styles.addrBadges}>
                  {a.isDefault ? <Badge label="Mặc định" tone="green" /> : null}
                  {isCatalogueAddress(a) ? null : <Badge label="Địa chỉ cũ" tone="gray" />}
                </View>
              ) : null}
              <Text style={styles.addrText}>{formatAddressLine(a)}</Text>
                {isCatalogueAddress(a) ? null : (
                  <Text style={styles.addrLegacyNote}>
                    Địa chỉ lưu trước cập nhật danh mục 2025. Vào sổ địa chỉ để chọn lại xã/phường.
                  </Text>
                )}
              </Pressable>
            );
          })}

          {!addresses.isPending && !addresses.isError && addressList.length === 0 ? (
            <View style={styles.addrEmpty}>
              <Text style={styles.muted}>Chưa có địa chỉ giao hàng.</Text>
              <GhostButton label="Thêm địa chỉ" icon="add" onPress={() => router.push("/addresses")} />
            </View>
          ) : null}

          {addressList.length > 0 ? (
            <Pressable
              onPress={() => router.push("/addresses")}
              style={({ pressed }) => [styles.addrManage, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={15} color={colors.primary} />
              <Text style={styles.addrManageText}>Quản lý sổ địa chỉ</Text>
            </Pressable>
          ) : null}
        </Card>

        {/* --------------------------------------------------------- voucher -- */}
        <Card>
          <View style={styles.cardHead}>
            <Ionicons name="pricetag-outline" size={17} color={colors.primary} />
            <Text style={styles.section}>Mã giảm giá</Text>
            {vouchers.data ? (
              <Text style={styles.voucherCount}>
                {voucherGroups.eligible.length > 0 ? `${voucherGroups.eligible.length} mã dùng được` : "Chưa có mã"}
              </Text>
            ) : null}
          </View>

          {/* Applied state: the code and the amount come from the preview. */}
          {appliedCode && voucherDiscount > 0 ? (
            <View style={styles.voucherApplied}>
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text style={styles.voucherAppliedText}>
                {appliedCode} · giảm {formatMoney(voucherDiscount)}
              </Text>
              <Pressable
                onPress={clearVoucher}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Bỏ mã giảm giá"
              >
                <Text style={styles.voucherRemove}>Bỏ</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.voucherPicker, pressed && styles.pressed]}
              onPress={() => setVoucherPickerOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: voucherPickerOpen }}
              accessibilityLabel="Chọn mã giảm giá"
            >
              <Ionicons name="ticket-outline" size={16} color={colors.primary} />
              <Text style={styles.voucherPickerText}>
                {voucherGroups.eligible.length > 0 ? "Chọn mã giảm giá" : "Xem mã giảm giá"}
              </Text>
              <Ionicons
                name={voucherPickerOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.primary}
              />
            </Pressable>
          )}

          {/* A code the backend refused: the preview errored while one was set. */}
          {appliedVoucher && preview.isError ? (
            <View style={styles.voucherErr}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.voucherErrText}>
                {errorMessage(preview.error, "Mã giảm giá không hợp lệ.")}
              </Text>
            </View>
          ) : null}

          {voucherPickerOpen ? (
            <View style={styles.voucherList}>
              {vouchers.isPending ? <LoadingView message="Đang tải mã giảm giá…" /> : null}
              {vouchers.isError ? (
                <ErrorView
                  message={errorMessage(vouchers.error, "Không tải được mã giảm giá.")}
                  onRetry={() => void vouchers.refetch()}
                  network={isNetworkError(vouchers.error)}
                />
              ) : null}

              {voucherGroups.eligible.map((option) => (
                <Pressable
                  key={option.voucher.id}
                  onPress={() => chooseVoucher(option.voucher.code)}
                  style={({ pressed }) => [styles.voucherItem, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Áp dụng mã ${option.voucher.code}`}
                >
                  <View style={styles.voucherItemBody}>
                    <View style={styles.voucherItemHead}>
                      <Text style={styles.voucherCode}>{option.voucher.code}</Text>
                      <Text style={styles.voucherValue}>{voucherValueLabel(option.voucher)}</Text>
                    </View>
                    <Text style={styles.voucherName} numberOfLines={1}>
                      {option.voucher.name}
                    </Text>
                    <Text style={styles.voucherMeta}>
                      Đơn tối thiểu {formatMoney(option.voucher.minOrderAmount)}
                      {option.voucher.maxDiscount
                        ? ` · tối đa ${formatMoney(option.voucher.maxDiscount)}`
                        : ""}
                    </Text>
                  </View>
                  <View style={styles.voucherApply}>
                    <Text style={styles.voucherApplyText}>Áp dụng</Text>
                  </View>
                </Pressable>
              ))}

              {voucherGroups.ineligible.length > 0 ? (
                <Text style={styles.voucherGroupTitle}>Chưa dùng được</Text>
              ) : null}
              {voucherGroups.ineligible.map((option) => (
                <View key={option.voucher.id} style={[styles.voucherItem, styles.voucherItemOff]}>
                  <View style={styles.voucherItemBody}>
                    <View style={styles.voucherItemHead}>
                      <Text style={[styles.voucherCode, styles.voucherCodeOff]}>{option.voucher.code}</Text>
                      <Text style={[styles.voucherValue, styles.voucherValueOff]}>
                        {voucherValueLabel(option.voucher)}
                      </Text>
                    </View>
                    <Text style={styles.voucherName} numberOfLines={1}>
                      {option.voucher.name}
                    </Text>
                    <Text style={styles.voucherReason}>{option.reason}</Text>
                  </View>
                </View>
              ))}

              {!vouchers.isPending && !vouchers.isError && voucherLookupSize === 0 ? (
                <Text style={styles.voucherMeta}>Hiện chưa có chương trình giảm giá nào.</Text>
              ) : null}
            </View>
          ) : null}
        </Card>

        {/* ----------------------------------------------------------- total -- */}
        <Card>
          <View style={styles.cardHead}>
            <Ionicons name="receipt-outline" size={17} color={colors.primary} />
            <Text style={styles.section}>Tổng tiền</Text>
          </View>
          {preview.isPending ? <LoadingView message="Đang tính tổng tiền…" /> : null}
          {preview.isError && !appliedVoucher ? (
            <ErrorView
              message={errorMessage(preview.error, "Không tính được tổng tiền.")}
              onRetry={() => void preview.refetch()}
              network={isNetworkError(preview.error)}
            />
          ) : null}
          {preview.data ? (
            <>
              {preview.data.items.map((line) => (
                <View key={line.productVariantId} style={styles.line}>
                  <Text style={styles.lineName} numberOfLines={2}>
                    {line.productName} × {line.quantity}
                  </Text>
                  <Text style={styles.linePrice}>{formatMoney(line.subtotal)}</Text>
                </View>
              ))}
              <View style={styles.totalSep} />
              <View style={styles.totalRow}>
                <Text style={styles.muted}>Tiền hàng</Text>
                <Text style={styles.amount}>{formatMoney(preview.data.subtotal)}</Text>
              </View>
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
                <Text style={styles.amount}>{formatMoney(preview.data.shippingFee)}</Text>
              </View>
              <View style={[styles.totalRow, styles.grandRow]}>
                <Text style={styles.grandLabel}>Tổng cộng</Text>
                <Text style={styles.grand}>{formatMoney(preview.data.grandTotal)}</Text>
              </View>
            </>
          ) : null}
        </Card>

        {/* ------------------------------------------------------------ note -- */}
        <Card>
          <View style={styles.cardHead}>
            <Ionicons name="chatbubble-outline" size={17} color={colors.primary} />
            <Text style={styles.section}>Ghi chú & thanh toán</Text>
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Ghi chú cho đơn hàng (tùy chọn)"
            placeholderTextColor={colors.mutedSoft}
            style={styles.input}
            multiline
            accessibilityLabel="Ghi chú đơn hàng"
          />
          <View style={styles.payRow}>
            <Ionicons name="cash-outline" size={17} color={colors.primary} />
            <Text style={styles.payText}>Thanh toán tiền mặt khi nhận hàng (COD)</Text>
          </View>
        </Card>

        {submitError ? (
          <View style={styles.submitError}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.submitErrorText}>{submitError}</Text>
          </View>
        ) : null}

        <View style={styles.bottomPad} />
      </ScrollView>

      <BottomBar>
        {needsConfirm && grandTotal !== undefined ? (
          <Text style={styles.confirmNote}>
            Giá vừa được cập nhật thành {formatMoney(grandTotal)}. Bấm đặt hàng để xác nhận.
          </Text>
        ) : null}

        {/* The button carries the amount, so the bar does not repeat it beside
            the button — the total is stated once above, in the breakdown. */}
        <PrimaryButton
          label={
            submitting
              ? "Đang đặt hàng…"
              : hasUnavailable
                ? "Không đủ hàng"
                : grandTotal !== undefined
                  ? `Đặt hàng · ${formatMoney(grandTotal)}`
                  : "Đặt hàng"
          }
          onPress={() => void submit()}
          disabled={!canSubmit}
          loading={submitting}
          style={styles.submitBtn}
        />
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.lg },
  pressed: { opacity: 0.85 },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  section: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textStrong },
  muted: { fontSize: 13, color: colors.muted },

  addr: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  addrActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft, borderWidth: 1.5 },
  addrHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  addrBadges: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, marginLeft: 24 },
  addrName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  addrText: { fontSize: 12.5, color: colors.muted, marginTop: 4, marginLeft: 24, lineHeight: 18 },
  addrLegacyNote: { fontSize: 12, color: colors.warning, marginTop: 2, marginLeft: 24, lineHeight: 17 },
  addrEmpty: { gap: spacing.xs },
  addrManage: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: TOUCH, justifyContent: "center" },
  addrManageText: { fontSize: 13, fontWeight: "700", color: colors.primary },

  voucherCount: { fontSize: 12, color: colors.primary, fontWeight: "700" },
  voucherPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    backgroundColor: colors.primarySoft,
  },
  voucherPickerText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.primaryDark },
  voucherApplied: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    backgroundColor: colors.primarySoft,
  },
  voucherAppliedText: { flex: 1, fontSize: 13.5, fontWeight: "700", color: colors.primaryDark },
  voucherRemove: { fontSize: 13, fontWeight: "700", color: colors.danger },
  voucherErr: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm },
  voucherErrText: { flex: 1, fontSize: 12.5, color: colors.danger },

  voucherList: { marginTop: spacing.sm, gap: spacing.sm },
  voucherGroupTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, marginTop: spacing.xs },
  voucherItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  voucherItemOff: { opacity: 0.6, backgroundColor: colors.page },
  voucherItemBody: { flex: 1, gap: 1 },
  voucherItemHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  voucherCode: { fontSize: 14, fontWeight: "700", color: colors.primary, letterSpacing: 0.4 },
  voucherCodeOff: { color: colors.muted },
  voucherValue: { fontSize: 12.5, fontWeight: "700", color: colors.primaryDark },
  voucherValueOff: { color: colors.muted },
  voucherName: { fontSize: 12.5, color: colors.text },
  voucherMeta: { fontSize: 11.5, color: colors.muted, lineHeight: 16 },
  voucherReason: { fontSize: 11.5, color: colors.danger, lineHeight: 16 },
  voucherApply: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  voucherApplyText: { color: "#fff", fontWeight: "700", fontSize: 12.5 },

  line: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, paddingVertical: 3 },
  lineName: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  linePrice: { fontSize: 13, fontWeight: "600", color: colors.text },
  totalSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  amount: { fontSize: 13, fontWeight: "600", color: colors.text },
  discount: { fontSize: 13, fontWeight: "700", color: colors.primary },
  grandRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  grandLabel: { fontWeight: "700", color: colors.textStrong, fontSize: 15 },
  grand: { fontWeight: "700", color: colors.primary, fontSize: 17 },

  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    minHeight: 76,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlignVertical: "top",
  },
  payRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  payText: { flex: 1, fontSize: 13, color: colors.text, fontWeight: "600" },

  submitError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  submitErrorText: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },

  confirmNote: { fontSize: 12.5, color: colors.warning, fontWeight: "600", marginBottom: spacing.sm, lineHeight: 17 },

  submitBtn: { marginTop: 0, minHeight: TOUCH + 4 },
});
