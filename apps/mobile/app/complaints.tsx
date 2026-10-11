/**
 * Khiếu nại.
 *
 * NO TECHNICAL IDS
 *
 * The previous version asked the customer to type an `orderId`. A complaint is
 * always about an order the customer already has, so the screen lists their
 * orders (`GET /orders/me`) and the id travels inside the request. The optional
 * product line is a picker over that order's own items, so a line from a
 * different order can no longer be attached — the backend now refuses that too.
 *
 * Photos are optional and upload at submit time. Nothing is reported as sent
 * until the backend has created the complaint and bound the images.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  EvidencePicker,
  uploadEvidence,
  type PickedEvidence,
} from "../src/components/EvidencePicker";
import { Badge, Card, EmptyView, ErrorView, LinkPress, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDateTime, formatMoney, formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { complaintStatusMeta, complaintTypeLabel, COMPLAINT_TYPE, orderStatusMeta } from "../src/lib/status";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

const TYPES = Object.keys(COMPLAINT_TYPE);

export default function ComplaintsScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { orderId: presetId } = useLocalSearchParams<{ orderId?: string }>();

  const [pickedOrderId, setPickedOrderId] = useState<number | null>(null);
  const [orderItemId, setOrderItemId] = useState<number | null>(null);
  const [type, setType] = useState("PRODUCT_QUALITY");
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const list = useQuery({
    queryKey: ["complaints"],
    queryFn: () => resources.listMyComplaints({ page: 1, limit: 20 }),
    enabled: hydrated && token !== null,
  });

  /**
   * The customer's orders, newest first. Only the 30 most recent are offered:
   * a complaint is about something that just arrived, and paginating the picker
   * would add a control the customer does not need to reach the order they
   * actually want.
   */
  const orders = useQuery({
    queryKey: ["orders", "for-complaint"],
    queryFn: () => resources.listMyOrders({ page: 1, limit: 30 }),
    enabled: hydrated && token !== null,
  });

  /**
   * The selected order is DERIVED, not stored: `explicit tap ?? deep-link
   * parameter`. Storing it and syncing from an effect caused an extra render and
   * could leave a stale selection after the list refreshed. Deriving guarantees
   * the selected order is always one the customer actually has, so its id can
   * never be sent for an order that is not theirs.
   */
  const selected =
    orders.data?.data.find((o) => o.id === pickedOrderId) ??
    (presetId ? (orders.data?.data.find((o) => o.id === Number(presetId)) ?? null) : null);

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Vui lòng chọn đơn hàng cần khiếu nại.");
      if (!content.trim()) throw new Error("Vui lòng mô tả vấn đề bạn gặp phải.");

      // Upload first: a failed photo means no complaint is created and the form
      // survives for a retry.
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);

      return resources.createComplaint({
        orderId: selected.id,
        orderItemId: orderItemId ?? undefined,
        type,
        content: content.trim(),
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: () => {
      setError(null);
      setDone(true);
      setPickedOrderId(null);
      setOrderItemId(null);
      setContent("");
      setEvidence([]);
      void client.invalidateQueries({ queryKey: ["complaints"] });
    },
    onError: (err) => setError(errorMessage(err, "Gửi khiếu nại thất bại.")),
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
  if (list.isPending || orders.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải khiếu nại…" />
      </View>
    );
  }
  if (list.isError || orders.isError) {
    const err = list.error ?? orders.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được khiếu nại.")}
          onRetry={() => {
            void list.refetch();
            void orders.refetch();
          }}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const complaints = list.data.data;
  const myOrders = orders.data.data;
  const items = selected?.partnerOrders.flatMap((po) => po.items) ?? [];


  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {done ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
            <Text style={styles.successText}>
              Đã gửi khiếu nại. AgriMarket sẽ xử lý và phản hồi theo quy trình.
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>Khiếu nại đã gửi</Text>
        {complaints.length === 0 ? (
          <EmptyView
            kind="orders"
            title="Chưa có khiếu nại"
            message="Khiếu nại được xử lý theo quy trình của AgriMarket. Gửi khiếu nại ở biểu mẫu bên dưới."
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


        <Card>
          <Text style={styles.section}>Gửi khiếu nại mới</Text>

          {myOrders.length === 0 ? (
            <Text style={styles.hint}>
              Bạn chưa có đơn hàng nào để khiếu nại. Khiếu nại được gửi cho một đơn đã đặt.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Chọn đơn hàng</Text>
              {myOrders.map((o) => {
                const active = selected?.id === o.id;
                const status = orderStatusMeta(o.status);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => {
                      setPickedOrderId(o.id);
                      setOrderItemId(null);
                      setDone(false);
                      setError(null);
                    }}
                    style={[styles.item, active && styles.itemActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Chọn đơn ${o.code}`}
                  >
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName}>Đơn {o.code}</Text>
                      <Text style={styles.itemMeta}>
                        {formatMoney(o.grandTotal)} · {formatDateTime(o.createdAt)}
                      </Text>
                      <View style={styles.itemBadgeRow}>
                        <Badge label={status.label} tone={status.tone} />
                      </View>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={20} color={colors.borderStrong} />
                    )}
                  </Pressable>
                );
              })}

              {selected ? (
                <>
                  {items.length > 0 ? (
                    <>
                      <Text style={styles.label}>Sản phẩm liên quan (không bắt buộc)</Text>
                      <Text style={styles.hint}>
                        Chọn một sản phẩm nếu khiếu nại chỉ về mặt hàng đó, hoặc để trống nếu vấn đề
                        thuộc cả đơn.
                      </Text>
                      <Pressable
                        onPress={() => setOrderItemId(null)}
                        style={[styles.item, orderItemId === null && styles.itemActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: orderItemId === null }}
                        accessibilityLabel="Cả đơn hàng"
                      >
                        <View style={styles.itemBody}>
                          <Text style={styles.itemName}>Cả đơn hàng</Text>
                        </View>
                        {orderItemId === null ? (
                          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        ) : (
                          <Ionicons name="ellipse-outline" size={20} color={colors.borderStrong} />
                        )}
                      </Pressable>
                      {items.map((it) => {
                        const active = orderItemId === it.id;
                        return (
                          <Pressable
                            key={it.id}
                            onPress={() => setOrderItemId(it.id)}
                            style={[styles.item, active && styles.itemActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`Chọn ${it.productNameSnapshot}`}
                          >
                            <View style={styles.itemBody}>
                              <Text style={styles.itemName} numberOfLines={2}>
                                {it.productNameSnapshot}
                              </Text>
                              <Text style={styles.itemMeta}>
                                {it.skuSnapshot} · SL {formatQuantity(it.quantity)}
                              </Text>
                            </View>
                            {active ? (
                              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                            ) : (
                              <Ionicons name="ellipse-outline" size={20} color={colors.borderStrong} />
                            )}
                          </Pressable>
                        );
                      })}
                    </>
                  ) : null}

                  <Text style={styles.label}>Loại khiếu nại</Text>
                  <View style={styles.typeRow}>
                    {TYPES.map((t) => (
                      <Pressable
                        key={t}
                        onPress={() => setType(t)}
                        style={[styles.chip, type === t && styles.chipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: type === t }}
                      >
                        <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                          {complaintTypeLabel(t)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Nội dung</Text>
                  <TextInput
                    value={content}
                    onChangeText={setContent}
                    placeholder="Mô tả vấn đề bạn gặp phải"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.inputMultiline]}
                    multiline
                  />

                  <EvidencePicker items={evidence} onChange={setEvidence} disabled={create.isPending} />
                </>
              ) : (
                <Text style={styles.hint}>Chọn một đơn hàng ở trên để gửi khiếu nại.</Text>
              )}
            </>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {myOrders.length > 0 ? (
            <PrimaryButton
              label={create.isPending ? "Đang gửi…" : "Gửi khiếu nại"}
              onPress={() => create.mutate()}
              disabled={create.isPending || !selected || content.trim().length === 0}
              loading={create.isPending}
              style={styles.submit}
            />
          ) : null}
        </Card>
        <View style={styles.bottomPad} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

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
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 4, marginTop: spacing.sm },
  input: {
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: "top" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    minHeight: 34,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.text },
  chipTextActive: { color: "#fff" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: spacing.md },

  /** Success banner shown after the backend confirms the complaint exists. */
  successBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  successText: { flex: 1, fontSize: 12.5, color: colors.primary, lineHeight: 18, fontWeight: "600" },

  /** One selectable order or product line. */
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  itemActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  itemBody: { flex: 1 },
  itemName: { fontSize: 13.5, fontWeight: "600", color: colors.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  itemBadgeRow: { flexDirection: "row", marginTop: 2 },
});
