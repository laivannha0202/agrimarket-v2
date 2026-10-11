import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EvidenceGallery } from "../../src/components/EvidenceGallery";
import { Badge, Card, EmptyView, ErrorView, LoadingView, PrimaryButton } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { formatDateTime, formatMoney } from "../../src/lib/format";
import { resources } from "../../src/lib/resources";
import { RETURN_FLOW, returnStatusMeta } from "../../src/lib/status";
import { colors, radius, spacing, TOUCH } from "../../src/lib/theme";
import { useAuth } from "../../src/providers";

export default function ReturnDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const returnId = Number(id);
  const { token, hydrated } = useAuth();
  const router = useRouter();

  const detail = useQuery({
    queryKey: ["return", returnId],
    queryFn: () => resources.getMyReturn(returnId),
    enabled: hydrated && token !== null && Number.isFinite(returnId),
  });

  if (!Number.isFinite(returnId)) {
    return (
      <View style={styles.statePage}>
        <ErrorView message="Yêu cầu trả hàng không hợp lệ." fill />
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
          message="Đăng nhập để xem chi tiết yêu cầu trả hàng."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: `/return/${returnId}` } })}
          fill
        />
      </View>
    );
  }

  if (detail.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải yêu cầu…" />
      </View>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(detail.error, "Không tải được yêu cầu.")}
          onRetry={() => void detail.refetch()}
          network={isNetworkError(detail.error)}
          fill
        />
      </View>
    );
  }

  const r = detail.data;
  const meta = returnStatusMeta(r.status);
  const currentIdx = RETURN_FLOW.indexOf(r.status);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.head}>
          <Text style={styles.code}>Yêu cầu #{r.id}</Text>
          <Badge label={meta.label} tone={meta.tone} />
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="receipt-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>Đơn {r.order?.code ?? `#${r.orderId}`}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="cube-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>Số lượng yêu cầu trả: {r.quantity}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>Tạo lúc {formatDateTime(r.createdAt)}</Text>
        </View>
        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>Lý do</Text>
          <Text style={styles.reasonText}>{r.reason}</Text>
        </View>
        {/**
         * The customer's own photos for this request, fetched with the
         * session. Only the owner (and an ADMIN) can load them — a plain
         * `<Image>` URL would arrive anonymous and be refused.
         */}
        <EvidenceGallery images={r.evidence} label="Ảnh minh chứng đã gửi" />
      </Card>

      {/* Progress through the real backend status flow (rejected is off-flow). */}
      {currentIdx >= 0 ? (
        <Card>
          <Text style={styles.section}>Tiến trình xử lý</Text>
          {RETURN_FLOW.map((s, idx) => {
            const done = idx <= currentIdx;
            const sMeta = returnStatusMeta(s);
            return (
              <View key={s} style={styles.step}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, done && styles.stepDotDone]}>
                    {done ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                  </View>
                  {idx < RETURN_FLOW.length - 1 ? (
                    <View style={[styles.stepLine, idx < currentIdx && styles.stepLineDone]} />
                  ) : null}
                </View>
                <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{sMeta.label}</Text>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.section}>Hoàn tiền</Text>
        {r.refund ? (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.muted}>Số tiền hoàn</Text>
              <Text style={styles.amount}>{formatMoney(r.refund.amount)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.muted}>Trạng thái</Text>
              <Badge
                label={
                  r.refund.status === "COMPLETED"
                    ? "Đã hoàn tiền"
                    : r.refund.status === "PENDING"
                      ? "Chờ hoàn tiền"
                      : "Hoàn tiền thất bại"
                }
                tone={r.refund.status === "COMPLETED" ? "green" : r.refund.status === "PENDING" ? "yellow" : "red"}
              />
            </View>
            {r.refund.reason ? <Text style={styles.muted}>Ghi chú: {r.refund.reason}</Text> : null}
          </>
        ) : (
          <Text style={styles.muted}>Chưa có thông tin hoàn tiền cho yêu cầu này.</Text>
        )}
      </Card>

      {/**
       * Post-submit navigation: the detail is a dead end unless the customer
       * can return to the order it came from or to the list of requests.
       */}
      <View style={styles.navRow}>
        <Pressable
          onPress={() => router.push({ pathname: "/order/[id]", params: { id: String(r.orderId) } })}
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Về đơn ${r.order?.code ?? `#${r.orderId}`}`}
        >
          <Ionicons name="receipt-outline" size={15} color={colors.primary} />
          <Text style={styles.navText}>Về đơn {r.order?.code ?? `#${r.orderId}`}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/returns")}
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Danh sách trả hàng"
        >
          <Ionicons name="list-outline" size={15} color={colors.primary} />
          <Text style={styles.navText}>Danh sách trả hàng</Text>
        </Pressable>
      </View>
      <PrimaryButton label="Tạo yêu cầu trả hàng mới" onPress={() => router.push("/returns-new")} />

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
  reasonBox: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reasonLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 2 },
  reasonText: { fontSize: 13.5, color: colors.text, lineHeight: 19 },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
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

  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  amount: { fontSize: 15, fontWeight: "700", color: colors.primary },

  navRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  navBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: TOUCH,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  navText: { fontSize: 12.5, fontWeight: "700", color: colors.primary },
  pressed: { opacity: 0.85 },
});
