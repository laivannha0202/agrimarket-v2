import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Card, EmptyView, ErrorView, LoadingView } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { formatDate } from "../../src/lib/format";
import { resources } from "../../src/lib/resources";
import { colors, radius, spacing } from "../../src/lib/theme";

export default function FarmDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = Number(id);

  const farm = useQuery({
    queryKey: ["farm", farmId],
    queryFn: () => resources.getFarm(farmId),
    enabled: Number.isFinite(farmId),
  });

  const certs = useQuery({
    queryKey: ["farm-certs", farmId],
    queryFn: () => resources.listValidCertificates(farmId),
    enabled: Number.isFinite(farmId),
  });

  if (!Number.isFinite(farmId)) {
    return (
      <View style={styles.statePage}>
        <ErrorView message="Trang trại không hợp lệ." fill />
      </View>
    );
  }
  if (farm.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải trang trại…" />
      </View>
    );
  }
  if (farm.isError || !farm.data) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(farm.error, "Không tải được trang trại.")}
          onRetry={() => void farm.refetch()}
          network={isNetworkError(farm.error)}
          fill
        />
      </View>
    );
  }

  const f = farm.data;
  const certList = certs.data ?? [];

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.head}>
          <View style={styles.icon}>
            <Ionicons name="leaf" size={20} color={colors.primary} />
          </View>
          <View style={styles.headBody}>
            <Text style={styles.name}>{f.name}</Text>
            <Text style={styles.muted}>{f.partner.name}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>{f.address}</Text>
        </View>
        {f.areaHa ? (
          <View style={styles.infoRow}>
            <Ionicons name="resize-outline" size={15} color={colors.mutedSoft} />
            <Text style={styles.muted}>Diện tích {f.areaHa} ha</Text>
          </View>
        ) : null}
        {f.latitude && f.longitude ? (
          <View style={styles.infoRow}>
            <Ionicons name="navigate-outline" size={15} color={colors.mutedSoft} />
            <Text style={styles.muted}>
              Toạ độ {f.latitude}, {f.longitude}
            </Text>
          </View>
        ) : null}
        <View style={styles.infoRow}>
          <Ionicons name="pricetag-outline" size={15} color={colors.mutedSoft} />
          <Text style={styles.muted}>Mã trang trại {f.code}</Text>
        </View>

        {f.description ? <Text style={styles.desc}>{f.description}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.section}>Chứng nhận còn hiệu lực</Text>
        {certs.isPending ? (
          <LoadingView message="Đang tải chứng nhận…" />
        ) : certs.isError ? (
          <ErrorView
            message={errorMessage(certs.error, "Không tải được chứng nhận.")}
            onRetry={() => void certs.refetch()}
            network={isNetworkError(certs.error)}
          />
        ) : certList.length === 0 ? (
          <EmptyView
            kind="search"
            message="Trang trại chưa có chứng nhận còn hiệu lực."
            illustration={false}
          />
        ) : (
          certList.map((c) => (
            <View key={c.id} style={styles.cert}>
              <View style={styles.certHead}>
                <Ionicons name="ribbon-outline" size={16} color={colors.primary} />
                <Text style={styles.certName}>
                  {c.type} · {c.certificateCode}
                </Text>
              </View>
              <Badge
                label={c.verificationStatus === "VERIFIED" ? "Đã xác minh" : "Chờ xác minh"}
                tone={c.verificationStatus === "VERIFIED" ? "green" : "yellow"}
              />
              <Text style={styles.muted}>{c.issuer}</Text>
              <Text style={styles.muted}>
                Cấp {formatDate(c.issuedAt)} · Hết hạn {formatDate(c.expiresAt)}
              </Text>
            </View>
          ))
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

  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headBody: { flex: 1, gap: 1 },
  name: { fontSize: 17, fontWeight: "700", color: colors.textStrong },
  muted: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  desc: { fontSize: 14, color: colors.text, marginTop: spacing.sm, lineHeight: 20 },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  cert: {
    paddingVertical: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  certHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  certName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
});
