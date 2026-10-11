/**
 * Danh sách đơn hàng của tôi.
 *
 * The status filter is a *server* filter (`GET /orders/me?status=`), so every
 * chip hits the backend and the list never claims to show "all" while hiding
 * rows it already has. That also means the empty state has to distinguish
 * "you have no orders" from "no order matches this status" — see `EmptyView`.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Chip, EmptyView, ErrorView, LinkPress, LoadingView } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { emptyStateKind } from "../src/lib/design-assets";
import { formatDateTime, formatMoney } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { orderStatusMeta } from "../src/lib/status";
import { colors, elevation, radius, spacing } from "../src/lib/theme";
import { useAuth } from "../src/providers";

const FILTERS = ["", "PENDING_CONFIRMATION", "CONFIRMED", "SHIPPING", "DELIVERED", "CANCELLED"] as const;

export default function OrdersScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<string>("");

  const orders = useQuery({
    queryKey: ["orders", status],
    queryFn: () => resources.listMyOrders({ page: 1, limit: 20, status: status || undefined }),
    enabled: hydrated && token !== null,
  });

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
          message="Đăng nhập để xem đơn hàng của bạn."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/orders" } })}
          fill
        />
      </View>
    );
  }

  if (orders.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải đơn hàng…" />
      </View>
    );
  }

  if (orders.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(orders.error, "Không tải được đơn hàng.")}
          onRetry={() => void orders.refetch()}
          network={isNetworkError(orders.error)}
          fill
        />
      </View>
    );
  }

  const list = orders.data.data;
  const hasFilter = status !== "";

  return (
    <View style={styles.page}>
      {/* `flexGrow: 0` keeps the row at content height — without it RN stretched
          the first chip vertically to fill the parent. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filters}
        contentContainerStyle={styles.filtersContent}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f || "all"}
            label={f === "" ? "Tất cả" : orderStatusMeta(f).label}
            active={status === f}
            onPress={() => setStatus(f)}
          />
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} />}
      >
        {list.map((o) => {
          const meta = orderStatusMeta(o.status);
          const items = o.partnerOrders.flatMap((po) => po.items);
          const firstItem = items[0];
          const supplierCount = o.partnerOrders.length;
          return (
            <LinkPress
              key={o.id}
              href={{ pathname: "/order/[id]", params: { id: String(o.id) } }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityLabel={`Đơn ${o.code}`}
            >
              <View style={styles.rowHead}>
                <Text style={styles.code}>{o.code}</Text>
                <Badge label={meta.label} tone={meta.tone} />
              </View>

              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>{formatDateTime(o.createdAt)}</Text>
              </View>

              {/* Real line items only — when the backend returns none we say so
                  instead of printing a placeholder count. */}
              {firstItem ? (
                <View style={styles.metaRow}>
                  <Ionicons name="cube-outline" size={14} color={colors.mutedSoft} />
                  <Text style={styles.muted} numberOfLines={1}>
                    {firstItem.productNameSnapshot}
                    {items.length > 1 ? ` và ${items.length - 1} sản phẩm khác` : ""}
                  </Text>
                </View>
              ) : null}

              {supplierCount > 0 ? (
                <View style={styles.metaRow}>
                  <Ionicons name="storefront-outline" size={14} color={colors.mutedSoft} />
                  <Text style={styles.muted}>{supplierCount} nhà cung cấp</Text>
                </View>
              ) : null}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tổng cộng</Text>
                <Text style={styles.total}>{formatMoney(o.grandTotal)}</Text>
              </View>
            </LinkPress>
          );
        })}

        {list.length === 0 ? (
          <EmptyView
            kind={emptyStateKind({ listKind: "orders", hasFilter })}
            title={hasFilter ? "Không có đơn ở trạng thái này" : "Chưa có đơn hàng"}
            message={
              hasFilter
                ? "Bạn không có đơn nào ở trạng thái đã chọn. Chọn trạng thái khác hoặc xem tất cả."
                : "Bạn chưa có đơn hàng nào. Đơn đã đặt sẽ được theo dõi tại đây."
            }
            actionLabel={hasFilter ? "Xem tất cả" : "Xem sản phẩm"}
            onAction={() => (hasFilter ? setStatus("") : router.push("/(tabs)/catalog"))}
          />
        ) : null}

        {list.length > 0 && orders.data.meta.total > list.length ? (
          <Text style={styles.moreNote}>Hiển thị {list.length}/{orders.data.meta.total} đơn hàng gần nhất.</Text>
        ) : null}

        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  filters: { flexGrow: 0, paddingTop: spacing.md },
  filtersContent: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },

  list: { paddingHorizontal: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 3,
    ...elevation.card,
  },
  pressed: { opacity: 0.9 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  code: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textStrong },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  muted: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  totalLabel: { fontSize: 13, color: colors.muted },
  total: { fontSize: 15, fontWeight: "700", color: colors.primary },
  moreNote: { fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: spacing.sm },
  bottomPad: { height: spacing.xl },
});
