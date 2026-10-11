import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Card, ErrorView, GhostButton, LoadingView, ProductThumb } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { formatDate, formatDateTime, formatQuantity } from "../../src/lib/format";
import { resolveImageUrl } from "../../src/lib/promotions";
import { resources } from "../../src/lib/resources";
import { lotStatusMeta, traceEventLabel } from "../../src/lib/status";
import { colors, radius, spacing } from "../../src/lib/theme";
import { parseTraceCode } from "../../src/lib/trace-code";

const QC_CHECKS: { key: "appearancePassed" | "freshnessPassed" | "packagingPassed" | "damagePassed"; label: string }[] = [
  { key: "appearancePassed", label: "Ngoại quan" },
  { key: "freshnessPassed", label: "Độ tươi" },
  { key: "packagingPassed", label: "Bao bì" },
  { key: "damagePassed", label: "Không hư hỏng" },
];

export default function TraceDetailScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const traceCode = parseTraceCode(typeof code === "string" ? code : "") ?? "";

  const trace = useQuery({
    queryKey: ["trace", traceCode],
    queryFn: () => resources.getTrace(traceCode),
    enabled: traceCode.length > 0,
    retry: false,
  });

  if (!traceCode) {
    return (
      <View style={styles.center}>
        <ErrorView message="Mã truy xuất không hợp lệ. Vui lòng kiểm tra lại hoặc quét mã QR khác." />
      </View>
    );
  }

  if (trace.isPending) {
    return (
      <View style={styles.center}>
        <LoadingView message="Đang tra cứu hồ sơ lô hàng…" />
      </View>
    );
  }

  if (trace.isError || !trace.data) {
    return (
      <View style={styles.center}>
        <ErrorView
          message={errorMessage(trace.error, "Tra cứu thất bại.")}
          onRetry={() => void trace.refetch()}
          network={isNetworkError(trace.error)}
        />
        <GhostButton label="Nhập mã khác" onPress={() => router.push("/(tabs)/trace")} style={styles.retryBtn} />
      </View>
    );
  }

  const t = trace.data;
  const lotMeta = lotStatusMeta(t.lot.status);
  const cover = resolveImageUrl(t.product.images[0] ?? null);
  const events = [...t.traceEvents].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const farming = [...t.farmingEvents].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {/* Hero: the real product photo when the backend has one; `ProductThumb`
          falls back to a neutral leaf placeholder if the upload is missing. */}
      <View style={styles.hero}>
        <ProductThumb uri={cover} size={88} />
        <View style={styles.heroBody}>
          <Text style={styles.heroName} numberOfLines={2}>
            {t.product.name}
          </Text>
          <Text style={styles.muted}>{t.product.category}</Text>
          <View style={styles.heroBadges}>
            <Badge label={lotMeta.label} tone={lotMeta.tone} />
            {t.lot.isExpired ? <Badge label="Quá hạn" tone="red" /> : null}
            <Badge label={`Hạng ${t.lot.grade}`} tone="gray" />
          </View>
        </View>
      </View>

      {/* Lot identity + expiry */}
      <Card>
        <Text style={styles.section}>Thông tin lô</Text>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Mã lô</Text>
          <Text style={styles.kvValue}>{t.lot.code}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Mã truy xuất</Text>
          <Text style={styles.kvValue}>{t.lot.traceCode}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Đóng gói</Text>
          <Text style={styles.kvValue}>{formatDate(t.lot.packedAt)}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Hạn dùng</Text>
          <Text style={[styles.kvValue, t.lot.isExpired && styles.kvDanger]}>
            {formatDate(t.lot.expiresAt)}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Còn lại</Text>
          <Text style={styles.kvValue}>{formatQuantity(t.lot.remainingQuantity, t.lot.unit)}</Text>
        </View>
      </Card>

      {/* Origin */}
      <Card>
        <Text style={styles.section}>Nguồn gốc</Text>
        <View style={styles.iconRow}>
          <View style={styles.iconBox}>
            <Ionicons name="leaf-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.iconBody}>
            <Text style={styles.rowTitle}>{t.farm.name}</Text>
            <Text style={styles.muted}>{t.farm.address}</Text>
            {t.farm.areaHa ? (
              <Text style={styles.muted}>Diện tích {formatQuantity(t.farm.areaHa, "ha")}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.iconRow}>
          <View style={styles.iconBox}>
            <Ionicons name="business-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.iconBody}>
            <Text style={styles.rowTitle}>{t.partner.name}</Text>
            <Text style={styles.muted}>Đại diện: {t.partner.representativeName}</Text>
          </View>
        </View>
        <View style={styles.iconRow}>
          <View style={styles.iconBox}>
            <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.iconBody}>
            <Text style={styles.rowTitle}>
              {t.season.cropName}
              {t.season.variety ? ` · ${t.season.variety}` : ""}
            </Text>
            <Text style={styles.muted}>
              Gieo {formatDate(t.season.plantingDate)} · Dự kiến thu {formatDate(t.season.expectedHarvestDate)}
            </Text>
            <Text style={styles.muted}>Trạng thái vụ: {t.season.status}</Text>
          </View>
        </View>
        <View style={styles.iconRow}>
          <View style={styles.iconBox}>
            <Ionicons name="basket-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.iconBody}>
            <Text style={styles.rowTitle}>Thu hoạch {formatDate(t.harvest.harvestDate)}</Text>
            <Text style={styles.muted}>
              {formatQuantity(t.harvest.quantity, t.harvest.unit)} · Hạng {t.harvest.grade}
            </Text>
          </View>
        </View>
      </Card>

      {/* Quality control */}
      <Card>
        <Text style={styles.section}>Kiểm định chất lượng</Text>
        {t.qualityControl ? (
          <>
            <View style={styles.qcHead}>
              <Badge
                label={t.qualityControl.result === "PASS" ? "Đạt" : "Không đạt"}
                tone={t.qualityControl.result === "PASS" ? "green" : "red"}
              />
              <Text style={styles.muted}>{formatDateTime(t.qualityControl.inspectedAt)}</Text>
            </View>
            <View style={styles.qcGrid}>
              {QC_CHECKS.map((c) => {
                const ok = t.qualityControl![c.key];
                return (
                  <View key={c.key} style={styles.qcItem}>
                    <Ionicons
                      name={ok ? "checkmark-circle" : "close-circle"}
                      size={16}
                      color={ok ? colors.primary : colors.danger}
                    />
                    <Text style={styles.qcText}>{c.label}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={styles.muted}>Lô hàng chưa có kết quả kiểm định.</Text>
        )}
      </Card>

      {/* Certificates */}
      {t.certificates.length > 0 ? (
        <Card>
          <Text style={styles.section}>Chứng nhận ({t.certificates.length})</Text>
          {t.certificates.map((c) => (
            <View key={c.certificateCode} style={styles.certRow}>
              <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
              <View style={styles.certBody}>
                <Text style={styles.rowTitle}>{c.type}</Text>
                <Text style={styles.muted}>
                  {c.certificateCode} · {c.issuer}
                </Text>
                <Text style={styles.muted}>
                  Cấp {formatDate(c.issuedAt)} · Hết hạn {formatDate(c.expiresAt)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {/* Farming events */}
      {farming.length > 0 ? (
        <Card>
          <Text style={styles.section}>Quá trình canh tác ({farming.length})</Text>
          {farming.map((e, idx) => (
            <View key={`${e.type}-${idx}`} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={styles.timelineDot} />
                {idx < farming.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.rowTitle}>{e.type}</Text>
                <Text style={styles.muted}>{formatDate(e.occurredAt)}</Text>
                <Text style={styles.timelineText}>{e.content}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {/* Trace events */}
      <Card>
        <Text style={styles.section}>Hành trình lô hàng</Text>
        {events.length === 0 ? (
          <Text style={styles.muted}>Chưa có sự kiện hành trình.</Text>
        ) : (
          events.map((e, idx) => (
            <View key={`${e.type}-${idx}`} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDot, styles.timelineDotPrimary]} />
                {idx < events.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.rowTitle}>{traceEventLabel(e.type)}</Text>
                <Text style={styles.muted}>
                  {formatDateTime(e.occurredAt)}
                  {e.location ? ` · ${e.location}` : ""}
                </Text>
                {e.description ? <Text style={styles.timelineText}>{e.description}</Text> : null}
              </View>
            </View>
          ))
        )}
      </Card>

      {t.product.description ? (
        <Card>
          <Text style={styles.section}>Giới thiệu sản phẩm</Text>
          <Text style={styles.timelineText}>{t.product.description}</Text>
        </Card>
      ) : null}

      <Card style={styles.noteCard}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
        <Text style={styles.noteText}>
          Hồ sơ truy xuất do AgriMarket cung cấp theo dữ liệu ghi nhận của đơn vị sản xuất. AgriMarket không tự xác minh ngoài thực địa.
        </Text>
      </Card>

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  center: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },
  retryBtn: { alignSelf: "center", minWidth: 200, marginTop: spacing.sm },

  hero: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  heroBody: { flex: 1, gap: 2, justifyContent: "center" },
  heroName: { fontSize: 16, fontWeight: "700", color: colors.textStrong, lineHeight: 21 },
  heroBadges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 2 },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  muted: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  rowTitle: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 19 },

  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: 4,
  },
  kvLabel: { fontSize: 13, color: colors.muted },
  kvValue: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text, textAlign: "right" },
  kvDanger: { color: colors.danger },

  iconRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 6 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBody: { flex: 1, gap: 1 },

  qcHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  qcGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  qcItem: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: "40%" },
  qcText: { fontSize: 13, color: colors.text },

  certRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 6 },
  certBody: { flex: 1, gap: 1 },

  timelineRow: { flexDirection: "row", gap: spacing.sm },
  timelineRail: { alignItems: "center", width: 14, paddingTop: 5 },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.borderStrong,
  },
  timelineDotPrimary: { backgroundColor: colors.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  timelineBody: { flex: 1, paddingBottom: spacing.md, gap: 1 },
  timelineText: { fontSize: 13, color: colors.text, lineHeight: 19 },

  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
  },
  noteText: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 18 },
});
