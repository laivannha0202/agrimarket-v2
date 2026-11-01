import { StyleSheet, Text, View } from "react-native";
import { Badge } from "./ui";
import { formatMoney } from "../lib/format";
import { refundStatusMeta } from "../lib/status";
import { colors, spacing } from "../lib/theme";
import type { PaymentRefund } from "../lib/types";

/**
 * Refund rows for one order.
 *
 * A refund is a three-step flow (created -> approved -> completed with a
 * bank/gateway reference), and only the COMPLETED step moved money. Rendering
 * every row as "-50.000 ₫" told the customer they had been paid while the
 * request was still waiting, so the status is always shown next to the amount
 * and only a completed refund is drawn as returned money.
 */
export function OrderRefundList({ refunds }: { refunds: PaymentRefund[] }) {
  if (refunds.length === 0) return null;

  return (
    <View style={styles.block}>
      <Text style={styles.section}>Hoàn tiền</Text>
      {refunds.map((refund) => {
        const meta = refundStatusMeta(refund.status);
        const returned = refund.status === "COMPLETED";
        return (
          <View key={refund.id} style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.reason}>{refund.reason ?? "Hoàn tiền cho đơn hàng"}</Text>
              <Badge label={meta.label} tone={meta.tone} />
              {refund.status === "FAILED" && refund.failureReason ? (
                <Text style={styles.failure}>{refund.failureReason}</Text>
              ) : null}
            </View>
            <Text style={returned ? styles.amountReturned : styles.amountPending}>
              {returned ? "−" : ""}
              {formatMoney(refund.amount)}
            </Text>
          </View>
        );
      })}
      <Text style={styles.hint}>
        Chỉ khoản “Đã hoàn tiền” mới thực sự được chuyển. Khoản đang chờ hoặc đã duyệt chưa rời
        khỏi cửa hàng.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  info: { flex: 1, gap: 3 },
  reason: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  failure: { fontSize: 11.5, color: colors.danger, lineHeight: 16 },
  amountReturned: { fontSize: 13.5, fontWeight: "700", color: colors.primary },
  amountPending: { fontSize: 13.5, fontWeight: "600", color: colors.muted },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginTop: spacing.sm },
});
