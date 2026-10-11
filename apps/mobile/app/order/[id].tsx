/**
 * Chi tiết đơn hàng.
 *
 * Every block is rendered from the order payload the backend returns — there is
 * no invented data here: the progress tracker walks `ORDER_FLOW` (a port of the
 * backend state machine), the item list uses the price/name *snapshots* the
 * order was placed with (not today's catalogue price), and the trace links come
 * from the real allocated lots.
 *
 * A cancelled order is drawn as cancelled, not as a half-filled progress bar:
 * `CANCELLED` sits off `ORDER_FLOW`, so `orderFlowIndex` returns -1 and the
 * tracker is replaced by a cancellation notice.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Card, EmptyView, ErrorView, LinkPress, LoadingView } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { formatDateTime, formatMoney, formatQuantity } from "../../src/lib/format";
import { resources } from "../../src/lib/resources";
import {
  CANCELLABLE_ORDER_STATUSES,
  ORDER_FLOW,
  orderFlowIndex,
  orderStatusMeta,
  paymentMethodLabel,
  paymentStatusMeta,
  shipmentStatusMeta,
} from "../../src/lib/status";
import { colors, radius, spacing, TOUCH } from "../../src/lib/theme";
import { useAuth } from "../../src/providers";

export default function OrderDetailScreen() {
  const { id, success } = useLocalSearchParams<{ id: string; success?: string }>();
  const orderId = Number(id);
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => resources.getMyOrder(orderId),
    enabled: hydrated && token !== null && Number.isFinite(orderId),
    retry: false,
  });

  const cancel = useMutation({
    mutationFn: () => resources.cancelMyOrder(orderId),
    onSuccess: () => {
      setCancelError(null);
      void client.invalidateQueries({ queryKey: ["order", orderId] });
      void client.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => setCancelError(errorMessage(err, "Hủy đơn thất bại.")),
  });

  if (!Number.isFinite(orderId)) {
    return (
      <View style={styles.statePage}>
        <ErrorView message="Đơn hàng không hợp lệ." fill />
      </View>
    );
  }
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
          kind="orders"
          title="Chưa đăng nhập"
          message="Đăng nhập để xem chi tiết đơn hàng."
          actionLabel="Đăng nhập"
          onAction={() =>
            router.push({ pathname: "/login", params: { redirect: `/order/${orderId}` } })
          }
          fill
        />
      </View>
    );
  }
  if (order.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải đơn hàng…" />
      </View>
    );
  }
  if (order.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(order.error, "Không tải được đơn hàng.")}
          onRetry={() => void order.refetch()}
          network={isNetworkError(order.error)}
          fill
        />
      </View>
    );
  }

  const o = order.data;
  const meta = orderStatusMeta(o.status);
  const cancellable = CANCELLABLE_ORDER_STATUSES.includes(o.status);
  const flowIdx = orderFlowIndex(o.status);
  /**
   * Returns and reviews are only accepted for delivered goods, so both per-item
   * buttons are gated on this. It mirrors the server rule, which re-checks it.
   */
  const isDelivered = o.status === "DELIVERED";

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        {success === "1" ? (
          <Card style={styles.successCard}>
            <View style={styles.successRow}>
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              <Text style={styles.success}>Đặt hàng thành công</Text>
            </View>
            <Text style={styles.successText}>
              Mã đơn {o.code}. Thanh toán tiền mặt khi nhận hàng (COD).
            </Text>
          </Card>
        ) : null}

        {/* -------------------------------------------------------- summary -- */}
        <Card>
          <View style={styles.head}>
            <Text style={styles.code}>{o.code}</Text>
            <Badge label={meta.label} tone={meta.tone} />
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={14} color={colors.mutedSoft} />
            <Text style={styles.muted}>Đặt lúc {formatDateTime(o.createdAt)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={14} color={colors.mutedSoft} />
            <Text style={styles.muted}>
              {o.shippingAddressSnapshot.recipientName} · {o.shippingAddressSnapshot.phone}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={14} color={colors.mutedSoft} />
            <Text style={styles.muted}>
              {[
                o.shippingAddressSnapshot.detail,
                o.shippingAddressSnapshot.ward,
                o.shippingAddressSnapshot.district,
                o.shippingAddressSnapshot.province,
              ]
                .filter(Boolean)
                .join(", ")}
            </Text>
          </View>
          {o.note ? (
            <View style={styles.infoRow}>
              <Ionicons name="chatbubble-outline" size={14} color={colors.mutedSoft} />
              <Text style={styles.muted}>{o.note}</Text>
            </View>
          ) : null}

          {/**
           * Order-level after-sales entry point.
           *
           * A complaint can be about the whole order (a missing parcel, a late
           * delivery) or about one line, so the button is here as well as on
           * each item. It carries the order id, which is what the backend
           * needs — the customer never sees or types it.
           */}
          <Pressable
            onPress={() =>
              router.push({ pathname: "/complaints-new", params: { orderId: String(o.id) } })
            }
            style={({ pressed }) => [styles.itemAction, styles.orderAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Khiếu nại đơn ${o.code}`}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.primary} />
            <Text style={styles.itemActionText}>Khiếu nại về đơn này</Text>
          </Pressable>
        </Card>

        {/* ------------------------------------------------------- progress -- */}
        <Card>
          <Text style={styles.section}>Tiến trình đơn hàng</Text>
          {flowIdx >= 0 ? (
            ORDER_FLOW.map((s, idx) => {
              const done = idx <= flowIdx;
              return (
                <View key={s} style={styles.step}>
                  <View style={styles.stepRail}>
                    <View style={[styles.stepDot, done && styles.stepDotDone]}>
                      {done ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                    </View>
                    {idx < ORDER_FLOW.length - 1 ? (
                      <View style={[styles.stepLine, idx < flowIdx && styles.stepLineDone]} />
                    ) : null}
                  </View>
                  <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>
                    {orderStatusMeta(s).label}
                  </Text>
                </View>
              );
            })
          ) : (
            <View style={styles.cancelBox}>
              <Ionicons name="close-circle" size={18} color={colors.danger} />
              <Text style={styles.cancelText}>
                Đơn đã hủy. Hàng đã giữ cho đơn này được trả lại kho.
              </Text>
            </View>
          )}
        </Card>

        {/* -------------------------------------------- supplier sub-orders -- */}
        {o.partnerOrders.map((po) => (
          <Card key={po.id}>
            <View style={styles.poHead}>
              <Ionicons name="storefront-outline" size={16} color={colors.primary} />
              <Text style={styles.sectionInline}>{po.partner.name}</Text>
            </View>
            <View style={styles.poMeta}>
              <Text style={styles.muted}>{po.code}</Text>
              <Badge label={orderStatusMeta(po.status).label} tone={orderStatusMeta(po.status).tone} />
            </View>

            {po.items.map((item) => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.productNameSnapshot}
                  </Text>
                  <Text style={styles.itemPrice}>{formatMoney(item.subtotal)}</Text>
                </View>
                <Text style={styles.itemMeta}>
                  {item.skuSnapshot} · {formatQuantity(item.quantity)} ×{" "}
                  {formatMoney(item.unitPriceSnapshot)}
                </Text>
                {Number(item.discountAmount) > 0 ? (
                  <Text style={styles.itemDiscount}>Giảm {formatMoney(item.discountAmount)}</Text>
                ) : null}

                {(item.allocations ?? []).map((a, idx) => (
                  <LinkPress
                    key={`${a.productLot.traceCode}-${idx}`}
                    href={{ pathname: "/trace/[code]", params: { code: a.productLot.traceCode } }}
                    style={styles.traceRow}
                    accessibilityLabel={`Truy xuất lô ${a.productLot.code}`}
                  >
                    <Ionicons name="qr-code-outline" size={14} color={colors.primary} />
                    <Text style={styles.traceLink} numberOfLines={1}>
                      Lô {a.productLot.code} · {a.productLot.traceCode}
                    </Text>
                    <Ionicons name="chevron-forward" size={13} color={colors.primary} />
                  </LinkPress>
                ))}

                {/**
                 * After-sales entry points, one per line, shown only when the
                 * backend would accept the action.
                 *
                 * The buttons do not send anything themselves: they open the
                 * form with this line already chosen. The eligibility rule is
                 * duplicated from the server on purpose — a button that leads
                 * to a guaranteed rejection is worse than no button — and the
                 * server re-checks it on submit, so the UI cannot widen access.
                 *
                 * A delivered order is what unlocks both: returns and reviews
                 * are only accepted for goods the customer has received.
                 */}
                {isDelivered ? (
                  <View style={styles.itemActions}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/returns-new",
                          params: { orderItemId: String(item.id) },
                        })
                      }
                      style={({ pressed }) => [styles.itemAction, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Trả hàng ${item.productNameSnapshot}`}
                    >
                      <Ionicons name="return-down-back-outline" size={14} color={colors.primary} />
                      <Text style={styles.itemActionText}>Trả hàng</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/my-reviews-new",
                          params: { orderItemId: String(item.id) },
                        })
                      }
                      style={({ pressed }) => [styles.itemAction, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Đánh giá ${item.productNameSnapshot}`}
                    >
                      <Ionicons name="star-outline" size={14} color={colors.primary} />
                      <Text style={styles.itemActionText}>Đánh giá</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}

            {(po.shipments ?? []).map((s) => (
              <View key={s.id} style={styles.ship}>
                <View style={styles.infoRow}>
                  <Ionicons name="car-outline" size={14} color={colors.mutedSoft} />
                  <Text style={styles.muted}>
                    {s.code} · {shipmentStatusMeta(s.status).label}
                    {s.trackingCode ? ` · ${s.trackingCode}` : ""}
                  </Text>
                </View>
                {(s.events ?? []).map((e) => (
                  <Text key={e.id} style={styles.shipEvent}>
                    • {shipmentStatusMeta(e.status).label} · {formatDateTime(e.occurredAt)}
                    {e.note ? ` · ${e.note}` : ""}
                  </Text>
                ))}
              </View>
            ))}
          </Card>
        ))}

        {/* ------------------------------------------------------- payment -- */}
        <Card>
          <Text style={styles.section}>Thanh toán</Text>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Tạm tính</Text>
            <Text style={styles.amount}>{formatMoney(o.subtotal)}</Text>
          </View>
          {Number(o.discountTotal) > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.muted}>Giảm giá</Text>
              <Text style={styles.discount}>−{formatMoney(o.discountTotal)}</Text>
            </View>
          ) : null}
          {o.voucherRedemptions.map((v) => (
            <View key={v.id} style={styles.totalRow}>
              <Text style={styles.muted}>Mã giảm giá #{v.voucherId}</Text>
              <Text style={styles.discount}>−{formatMoney(v.discountAmount)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Phí giao hàng</Text>
            <Text style={styles.amount}>{formatMoney(o.shippingFee)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandRow]}>
            <Text style={styles.grandLabel}>Tổng cộng</Text>
            <Text style={styles.grand}>{formatMoney(o.grandTotal)}</Text>
          </View>
          {o.payments.map((p) => (
            <View key={p.id} style={styles.infoRow}>
              <Ionicons name="card-outline" size={14} color={colors.mutedSoft} />
              <Text style={styles.muted}>
                {paymentMethodLabel(p.method)} · {paymentStatusMeta(p.status).label}
                {p.paidAt ? ` · ${formatDateTime(p.paidAt)}` : ""}
              </Text>
            </View>
          ))}
        </Card>

        {/* --------------------------------------------------------- cancel -- */}
        {cancellable ? (
          <Card>
            <Text style={styles.section}>Hủy đơn</Text>
            <Text style={styles.hint}>
              Chỉ hủy được khi đơn chưa giao. Sau khi hủy, hàng đã giữ sẽ được trả lại kho.
            </Text>
            {cancelError ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.error}>{cancelError}</Text>
              </View>
            ) : null}
            <Pressable
              onPress={() => cancel.mutate()}
              disabled={cancel.isPending}
              style={({ pressed }) => [styles.danger, cancel.isPending && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ disabled: cancel.isPending, busy: cancel.isPending }}
            >
              <Ionicons name="close-circle-outline" size={17} color={colors.danger} />
              <Text style={styles.dangerText}>{cancel.isPending ? "Đang hủy…" : "Hủy đơn hàng"}</Text>
            </Pressable>
          </Card>
        ) : null}

        {/* ---------------------------------------------------- after-sales -- */}
        <Card>
          <Text style={styles.section}>Sau giao hàng</Text>
          <Text style={styles.hint}>Trả hàng, khiếu nại và đánh giá chỉ áp dụng cho đơn đã giao.</Text>
          <View style={styles.linkRow}>
            <LinkPress href="/returns" style={styles.ghost} accessibilityLabel="Trả hàng">
              <Text style={styles.ghostText}>Trả hàng</Text>
            </LinkPress>
            <LinkPress href="/complaints" style={styles.ghost} accessibilityLabel="Khiếu nại">
              <Text style={styles.ghostText}>Khiếu nại</Text>
            </LinkPress>
            <LinkPress href="/my-reviews" style={styles.ghost} accessibilityLabel="Đánh giá">
              <Text style={styles.ghostText}>Đánh giá</Text>
            </LinkPress>
          </View>
        </Card>

        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  muted: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },

  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  code: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textStrong },
  successCard: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  successRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  success: { fontSize: 16, fontWeight: "700", color: colors.primary },
  successText: { fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 18 },
  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  sectionInline: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textStrong },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: spacing.sm },

  step: { flexDirection: "row", gap: spacing.sm },
  stepRail: { alignItems: "center", width: 18 },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotDone: { backgroundColor: colors.primary },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.border, minHeight: 18 },
  stepLineDone: { backgroundColor: colors.primary },
  stepLabel: { flex: 1, fontSize: 13, color: colors.muted, paddingBottom: spacing.sm },
  stepLabelDone: { color: colors.text, fontWeight: "600" },

  cancelBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  cancelText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },

  poHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  poMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  item: {
    paddingVertical: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  itemName: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 19 },
  itemPrice: { fontSize: 14, fontWeight: "700", color: colors.textStrong },
  itemMeta: { fontSize: 12, color: colors.mutedSoft, marginTop: 2 },
  itemDiscount: { fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 2 },
  traceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs, minHeight: 30 },
  traceLink: { flex: 1, fontSize: 12.5, color: colors.primary, fontWeight: "600" },

  /**
   * After-sales actions on one order line. Laid out as small outlined buttons
   * rather than a filled CTA: they are secondary to viewing the order, and a
   * full-width button per line would turn the screen into a wall of green.
   */
  itemActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  itemAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    backgroundColor: colors.surface,
  },
  /** The order-level complaint button spans the card. */
  orderAction: { alignSelf: "stretch", marginTop: spacing.md, minHeight: TOUCH },
  itemActionText: { fontSize: 12.5, fontWeight: "700", color: colors.primary },
  ship: {
    marginTop: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  shipEvent: { fontSize: 12, color: colors.mutedSoft, marginTop: 2, marginLeft: 20, lineHeight: 17 },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 3,
  },
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

  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },
  danger: {
    flexDirection: "row",
    gap: 6,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: TOUCH,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  dangerText: { color: colors.danger, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  linkRow: { flexDirection: "row", gap: spacing.sm },
  ghost: {
    flex: 1,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: TOUCH,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  ghostText: { color: colors.text, fontWeight: "600", fontSize: 13 },
});
