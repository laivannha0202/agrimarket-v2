import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Card, EmptyView, ErrorView, LoadingView } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { formatDateTime } from "../../src/lib/format";
import { resources } from "../../src/lib/resources";
import { complaintStatusMeta, complaintTypeLabel } from "../../src/lib/status";
import { colors, radius, spacing, toneColors } from "../../src/lib/theme";
import { useAuth } from "../../src/providers";

export default function ComplaintDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const complaintId = Number(id);
  const { token, hydrated } = useAuth();
  const router = useRouter();

  const detail = useQuery({
    queryKey: ["complaint", complaintId],
    queryFn: () => resources.getMyComplaint(complaintId),
    enabled: hydrated && token !== null && Number.isFinite(complaintId),
  });

  if (!Number.isFinite(complaintId)) {
    return (
      <View style={styles.statePage}>
        <ErrorView message="Khiếu nại không hợp lệ." fill />
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
          message="Đăng nhập để xem chi tiết khiếu nại."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: `/complaint/${complaintId}` } })}
          fill
        />
      </View>
    );
  }

  if (detail.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải khiếu nại…" />
      </View>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(detail.error, "Không tải được khiếu nại.")}
          onRetry={() => void detail.refetch()}
          network={isNetworkError(detail.error)}
          fill
        />
      </View>
    );
  }

  const c = detail.data;
  const meta = complaintStatusMeta(c.status);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.head}>
          <Text style={styles.code}>Khiếu nại #{c.id}</Text>
          <Badge label={meta.label} tone={meta.tone} />
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="receipt-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>Đơn {c.order?.code ?? `#${c.orderId}`}</Text>
        </View>
        {c.orderItemId ? (
          <View style={styles.infoRow}>
            <Ionicons name="cube-outline" size={15} color={colors.mutedSoft} />
            <Text style={styles.muted}>Dòng đơn #{c.orderItemId}</Text>
          </View>
        ) : null}
        <View style={styles.infoRow}>
          <Ionicons name="pricetag-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>{complaintTypeLabel(c.type)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>Gửi lúc {formatDateTime(c.createdAt)}</Text>
        </View>
        <View style={styles.bodyBox}>
          <Text style={styles.bodyLabel}>Nội dung</Text>
          <Text style={styles.body}>{c.content}</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.section}>Kết quả xử lý</Text>
        {c.resolution ? (
          <>
            <View style={styles.infoRow}>
              <Ionicons name="checkmark-circle-outline" size={15} color={colors.primary} />
              <Text style={styles.resolution}>{c.resolution}</Text>
            </View>
            {c.resolvedAt ? (
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={15} color={colors.mutedSoft} />
                <Text style={styles.muted}>Xử lý lúc {formatDateTime(c.resolvedAt)}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.pendingBox}>
            <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
            <Text style={styles.pendingText}>
              AgriMarket đang xử lý khiếu nại này. Kết quả sẽ hiển thị tại đây.
            </Text>
          </View>
        )}
      </Card>

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  muted: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  code: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textStrong },

  bodyBox: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bodyLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 2 },
  body: { fontSize: 13.5, color: colors.text, lineHeight: 19 },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  resolution: { flex: 1, fontSize: 13.5, color: colors.text, lineHeight: 19 },
  pendingBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.warningSoft,
    borderColor: toneColors.yellow.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  pendingText: { flex: 1, fontSize: 12.5, color: toneColors.yellow.fg, lineHeight: 18 },
});
