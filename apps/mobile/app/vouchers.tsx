/**
 * Mã giảm giá đang áp dụng.
 *
 * A read-only catalogue of the vouchers the backend currently serves
 * (`GET /vouchers`). There is no "claim" or "my voucher" endpoint, so the screen
 * never offers one: the code is chosen at checkout, where it is validated
 * against the real order and the discount is computed by the server.
 *
 * The list is therefore *informational*: it states each programme's real rules
 * (minimum order, discount, validity window, quota) and whether the code is
 * currently usable at all. It deliberately does not judge whether a code fits a
 * particular cart — that depends on the order, and the checkout screen is where
 * the code is picked and the exact saving is shown.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, EmptyView, ErrorView, LinkPress, LoadingView } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDate, formatMoney } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { colors, elevation, radius, spacing, TOUCH } from "../src/lib/theme";
import { splitVouchers } from "../src/lib/vouchers";

export default function VouchersScreen() {
  const vouchers = useQuery({ queryKey: ["vouchers"], queryFn: () => resources.listVouchers(50) });

  if (vouchers.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải mã giảm giá…" />
      </View>
    );
  }

  if (vouchers.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(vouchers.error, "Không tải được mã giảm giá.")}
          onRetry={() => void vouchers.refetch()}
          network={isNetworkError(vouchers.error)}
          fill
        />
      </View>
    );
  }

  const list = vouchers.data.data;

  if (list.length === 0) {
    return (
      <View style={styles.statePage}>
        <EmptyView
          kind="search"
          title="Chưa có mã giảm giá"
          message="Hiện chưa có chương trình giảm giá nào đang mở. Danh sách sẽ cập nhật khi hệ thống mở chương trình mới."
          fill
        />
      </View>
    );
  }

  // `null` subtotal: with no order in view the minimum-order rule does not
  // apply, so every code that is genuinely live is shown as usable. The other
  // rules (window, quota, per-customer) still decide.
  const { eligible, ineligible } = splitVouchers(list, null);

  const renderCard = (
    option: (typeof eligible)[number],
    state: "usable" | "unusable",
  ) => {
    const v = option.voucher;
    const usable = state === "usable";
    return (
      <Card key={v.id} style={[styles.card, !usable && styles.cardOff]}>
        <View style={[styles.leftRail, !usable && styles.leftRailOff]} />
        <View style={styles.body}>
          <View style={styles.head}>
            <Text style={[styles.code, !usable && styles.codeOff]}>{v.code}</Text>
            <View style={[styles.discountPill, !usable && styles.discountPillOff]}>
              <Text style={[styles.discountText, !usable && styles.discountTextOff]}>
                {v.discountType === "PERCENT" ? `-${v.discountValue}%` : `-${formatMoney(v.discountValue)}`}
              </Text>
            </View>
          </View>
          <Text style={styles.name}>{v.name}</Text>

          <View style={styles.metaRow}>
            <Ionicons name="cart-outline" size={13} color={colors.mutedSoft} />
            <Text style={styles.muted}>Đơn tối thiểu {formatMoney(v.minOrderAmount)}</Text>
          </View>
          {v.maxDiscount ? (
            <View style={styles.metaRow}>
              <Ionicons name="arrow-down-circle-outline" size={13} color={colors.mutedSoft} />
              <Text style={styles.muted}>Giảm tối đa {formatMoney(v.maxDiscount)}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color={colors.mutedSoft} />
            <Text style={styles.muted}>
              {formatDate(v.startsAt)} – {formatDate(v.endsAt)}
            </Text>
          </View>
          {v.usageLimit !== null ? (
            <View style={styles.metaRow}>
              <Ionicons name="people-outline" size={13} color={colors.mutedSoft} />
              <Text style={styles.muted}>
                Đã dùng {v.usedCount}/{v.usageLimit}
                {v.perCustomerLimit ? ` · tối đa ${v.perCustomerLimit}/khách` : ""}
              </Text>
            </View>
          ) : null}

          {!usable && option.reason ? (
            <View style={styles.reasonRow}>
              <Ionicons name="alert-circle" size={13} color={colors.danger} />
              <Text style={styles.reasonText}>{option.reason}</Text>
            </View>
          ) : null}
        </View>
      </Card>
    );
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={vouchers.isRefetching} onRefresh={() => void vouchers.refetch()} />}
    >
      {eligible.length > 0 ? (
        <>
          <Text style={styles.groupTitle}>Dùng được</Text>
          {eligible.map((option) => renderCard(option, "usable"))}
        </>
      ) : null}

      {ineligible.length > 0 ? (
        <>
          <Text style={styles.groupTitle}>Chưa dùng được</Text>
          {ineligible.map((option) => renderCard(option, "unusable"))}
        </>
      ) : null}

      <LinkPress
        href="/checkout"
        style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
        accessibilityLabel="Chọn mã ở bước đặt hàng"
      >
        <Ionicons name="ticket-outline" size={17} color={colors.primary} />
        <Text style={styles.pickText}>Chọn mã ở bước đặt hàng</Text>
        <Ionicons name="chevron-forward" size={15} color={colors.primary} />
      </LinkPress>

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  muted: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  groupTitle: { fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: spacing.sm },

  card: { flexDirection: "row", padding: 0, overflow: "hidden", ...elevation.card },
  cardOff: { backgroundColor: colors.page },
  leftRail: { width: 6, backgroundColor: colors.primary },
  leftRailOff: { backgroundColor: colors.borderStrong },
  body: { flex: 1, padding: spacing.md, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  code: { fontSize: 16, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  codeOff: { color: colors.muted },
  discountPill: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  discountPillOff: { backgroundColor: colors.page, borderColor: colors.border },
  discountText: { fontSize: 12, fontWeight: "700", color: colors.primaryDark },
  discountTextOff: { color: colors.muted },
  name: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.xs },
  reasonText: { flex: 1, fontSize: 12, color: colors.danger, lineHeight: 17 },

  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    marginTop: spacing.md,
  },
  pickText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.primaryDark },
  pressed: { opacity: 0.85 },
});
