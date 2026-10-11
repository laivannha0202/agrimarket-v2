/**
 * Danh sách yêu cầu trả hàng đã gửi (LIST ONLY).
 *
 * Creation lives in `/returns-new`: this screen never asks for product,
 * quantity or photos, so the list stays scannable and the form stays focused.
 * The prominent "Tạo yêu cầu mới" button is the only creation entry point
 * here; the per-item entry points live on the order detail screen, which
 * opens the form with the product already chosen.
 *
 * A legacy deep link (`/returns?orderItemId=…`) is forwarded to the form so
 * old entry points keep working.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, EmptyView, ErrorView, LinkPress, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDateTime, formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { returnStatusMeta } from "../src/lib/status";
import { colors, radius, spacing } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function ReturnsScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const { orderItemId } = useLocalSearchParams<{ orderItemId?: string }>();

  /**
   * Legacy deep links pointed at this screen with a product id. The form now
   * owns creation, so forward there — the customer never sees this hop.
   */
  useEffect(() => {
    if (orderItemId) {
      router.replace({ pathname: "/returns-new", params: { orderItemId } });
    }
  }, [orderItemId, router]);

  const list = useQuery({
    queryKey: ["returns"],
    queryFn: () => resources.listMyReturns({ page: 1, limit: 20 }),
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
          message="Đăng nhập để xem yêu cầu trả hàng."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/returns" } })}
          fill
        />
      </View>
    );
  }
  if (list.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải trả hàng…" />
      </View>
    );
  }
  if (list.isError) {
    const err = list.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được trả hàng.")}
          onRetry={() => void list.refetch()}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const returns = list.data.data;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
    >
      <PrimaryButton
        label="Tạo yêu cầu trả hàng mới"
        icon="add"
        onPress={() => router.push("/returns-new")}
        style={styles.createBtn}
      />

      <Text style={styles.section}>Yêu cầu đã gửi</Text>
      {returns.length === 0 ? (
        <EmptyView
          kind="orders"
          title="Chưa có yêu cầu trả hàng"
          message="Yêu cầu trả hàng chỉ áp dụng cho đơn đã giao."
          actionLabel="Tạo yêu cầu mới"
          onAction={() => router.push("/returns-new")}
        />
      ) : (
        returns.map((r) => {
          const meta = returnStatusMeta(r.status);
          return (
            <LinkPress
              key={r.id}
              href={{ pathname: "/return/[id]", params: { id: String(r.id) } }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityLabel={`Yêu cầu trả hàng ${r.id}`}
            >
              <View style={styles.head}>
                <Text style={styles.code}>Yêu cầu #{r.id}</Text>
                <Badge label={meta.label} tone={meta.tone} />
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="receipt-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>Đơn {r.order?.code ?? `#${r.orderId}`}</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="cube-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>Số lượng {formatQuantity(r.quantity)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>{formatDateTime(r.createdAt)}</Text>
              </View>
              <Text style={styles.reason} numberOfLines={2}>
                {r.reason}
              </Text>
            </LinkPress>
          );
        })
      )}
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },
  createBtn: { marginTop: 0, marginBottom: spacing.md },

  muted: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 3 },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.9 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  code: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textStrong },
  reason: { fontSize: 12.5, color: colors.text, marginTop: spacing.xs, fontStyle: "italic" },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
});
