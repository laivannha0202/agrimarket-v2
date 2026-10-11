/**
 * Danh sách trang trại.
 *
 * Layout follows the UI Kit mockup: one consistent card per farm with an image,
 * name, address, partner and area.
 *
 * IMAGE RULE: `Farm` carries no image field in Backend V2 (only code, address,
 * coordinates, area and description), so there is no "real farm photo" to show.
 * The kit's `farm_fallback` illustration is therefore used for every card and is
 * explicitly labelled as an illustration — it is never presented as a photo of
 * that particular farm, which is why the caption is present rather than implied.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyView, ErrorView, LinkPress, LoadingView } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { designAssets } from "../src/lib/design-assets";
import { resources } from "../src/lib/resources";
import { colors, elevation, radius, spacing } from "../src/lib/theme";

export default function FarmsScreen() {
  const farms = useQuery({ queryKey: ["farms", "all"], queryFn: () => resources.listFarms(undefined, 100) });

  if (farms.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải trang trại…" />
      </View>
    );
  }

  if (farms.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(farms.error, "Không tải được trang trại.")}
          onRetry={() => void farms.refetch()}
          network={isNetworkError(farms.error)}
          fill
        />
      </View>
    );
  }

  const list = farms.data.data;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={farms.isRefetching} onRefresh={() => void farms.refetch()} />}
    >
      <View style={styles.headRow}>
        <View style={styles.headIcon}>
          <Ionicons name="leaf-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.headBody}>
          <Text style={styles.headTitle}>Trang trại đối tác</Text>
          <Text style={styles.headSub}>{farms.data.meta.total} trang trại đang hoạt động</Text>
        </View>
      </View>

      {list.length === 0 ? (
        <EmptyView kind="search" title="Chưa có trang trại" message="Hệ thống chưa ghi nhận trang trại nào." />
      ) : (
        list.map((f) => (
          <LinkPress
            key={f.id}
            href={{ pathname: "/farm/[id]", params: { id: String(f.id) } }}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            accessibilityLabel={`Trang trại ${f.name}`}
          >
            <View style={styles.imageWrap}>
              <Image source={designAssets.farmFallback} style={styles.image} resizeMode="cover" />
              <View style={styles.imageTag}>
                <Text style={styles.imageTagText}>Hình minh hoạ</Text>
              </View>
            </View>
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={2}>
                {f.name}
              </Text>
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={13} color={colors.mutedSoft} />
                <Text style={styles.meta} numberOfLines={2}>
                  {f.address}
                </Text>
              </View>
              <View style={styles.footRow}>
                <View style={styles.partnerChip}>
                  <Ionicons name="business-outline" size={12} color={colors.primary} />
                  <Text style={styles.partnerText} numberOfLines={1}>
                    {f.partner.name}
                  </Text>
                </View>
                {f.areaHa ? <Text style={styles.area}>{f.areaHa} ha</Text> : null}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedSoft} />
          </LinkPress>
        ))
      )}

      <Text style={styles.note}>
        Chứng nhận còn hiệu lực được hiển thị trong chi tiết từng trang trại.
      </Text>
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  pressed: { opacity: 0.9 },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  headIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headBody: { flex: 1, gap: 1 },
  headTitle: { fontSize: 16, fontWeight: "700", color: colors.textStrong },
  headSub: { fontSize: 12.5, color: colors.muted },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  imageWrap: { width: 88, height: 88, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.primarySoft },
  image: { width: "100%", height: "100%" },
  imageTag: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,18,15,0.55)",
    paddingVertical: 2,
    alignItems: "center",
  },
  imageTagText: { color: "#fff", fontSize: 9, fontWeight: "600" },

  body: { flex: 1, gap: 4 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text, lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  meta: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  footRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
  partnerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexShrink: 1,
  },
  partnerText: { fontSize: 11, color: colors.primaryDark, fontWeight: "600", flexShrink: 1 },
  area: { fontSize: 11.5, color: colors.mutedSoft, fontWeight: "600" },
  note: { fontSize: 12, color: colors.muted, marginTop: spacing.sm, textAlign: "center", lineHeight: 17 },
});
