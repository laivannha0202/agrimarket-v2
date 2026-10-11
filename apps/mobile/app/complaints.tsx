/**
 * Danh sách khiếu nại đã gửi (LIST ONLY).
 *
 * Creation lives in `/complaints-new`: this screen never asks for order,
 * type, content or photos, so the list stays scannable and the form stays
 * focused. The prominent "Gửi khiếu nại mới" button is the only creation
 * entry point here; the per-order entry point lives on the order detail
 * screen, which opens the form with the order already chosen.
 *
 * A legacy deep link (`/complaints?orderId=…`) is forwarded to the form so
 * old entry points keep working.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, EmptyView, ErrorView, LinkPress, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDateTime } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { complaintStatusMeta, complaintTypeLabel } from "../src/lib/status";
import { colors, radius, spacing } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function ComplaintsScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();

  /**
   * Legacy deep links pointed at this screen with an order id. The form now
   * owns creation, so forward there — the customer never sees this hop.
   */
  useEffect(() => {
    if (orderId) {
      router.replace({ pathname: "/complaints-new", params: { orderId } });
    }
  }, [orderId, router]);

  const list = useQuery({
    queryKey: ["complaints"],
    queryFn: () => resources.listMyComplaints({ page: 1, limit: 20 }),
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
          message="Đăng nhập để gửi và theo dõi khiếu nại."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/complaints" } })}
          fill
        />
      </View>
    );
  }
  if (list.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải khiếu nại…" />
      </View>
    );
  }
  if (list.isError) {
    const err = list.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được khiếu nại.")}
          onRetry={() => void list.refetch()}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const complaints = list.data.data;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
    >
      <PrimaryButton
        label="Gửi khiếu nại mới"
        icon="add"
        onPress={() => router.push("/complaints-new")}
        style={styles.createBtn}
      />

      <Text style={styles.section}>Khiếu nại đã gửi</Text>
      {complaints.length === 0 ? (
        <EmptyView
          kind="orders"
          title="Chưa có khiếu nại"
          message="Khiếu nại được xử lý theo quy trình của AgriMarket."
          actionLabel="Gửi khiếu nại mới"
          onAction={() => router.push("/complaints-new")}
        />
      ) : (
        complaints.map((c) => {
          const meta = complaintStatusMeta(c.status);
          return (
            <LinkPress
              key={c.id}
              href={{ pathname: "/complaint/[id]", params: { id: String(c.id) } }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityLabel={`Khiếu nại ${c.id}`}
            >
              <View style={styles.head}>
                <Text style={styles.code}>Khiếu nại #{c.id}</Text>
                <Badge label={meta.label} tone={meta.tone} />
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="receipt-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>Đơn {c.order?.code ?? `#${c.orderId}`}</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="pricetag-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>{complaintTypeLabel(c.type)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={14} color={colors.mutedSoft} />
                <Text style={styles.muted}>{formatDateTime(c.createdAt)}</Text>
              </View>
              <Text style={styles.reason} numberOfLines={2}>
                {c.content}
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
