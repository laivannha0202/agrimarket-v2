/**
 * Gửi khiếu nại mới (CREATE ONLY).
 *
 * NO TECHNICAL IDS
 *
 * A complaint is always about an order the customer already has, so the form
 * lists their orders (`GET /orders/me`) and the id travels inside the request.
 * The optional product line is a picker over that order's own items, so a line
 * from a different order can no longer be attached — the backend now refuses
 * that too.
 *
 * Photos are optional and upload at submit time. Nothing is reported as sent
 * until the backend has created the complaint and bound the images.
 *
 * Opened from:
 * - the order detail screen (`/complaints-new?orderId=…`), with the order
 *   already chosen;
 * - the complaints list's "Gửi khiếu nại mới" button (no pre-selection).
 *
 * On success the screen navigates to the new complaint's detail — the detail
 * carries the status and the way back to the order / the list — instead of
 * leaving a "done" banner on top of a list.
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
import { Badge, Card, EmptyView, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { ApiError, errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDateTime, formatMoney, formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import {
  mapAfterSalesFieldErrors,
  validateComplaintForm,
  type AfterSalesFieldErrors,
} from "../src/lib/aftersales-validation";
import { complaintTypeLabel, COMPLAINT_TYPE, orderStatusMeta } from "../src/lib/status";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

const TYPES = Object.keys(COMPLAINT_TYPE);

export default function ComplaintsNewScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { orderId: presetId } = useLocalSearchParams<{ orderId?: string }>();

  const [pickedOrderId, setPickedOrderId] = useState<number | null>(null);
  const [orderItemId, setOrderItemId] = useState<number | null>(null);
  const [type, setType] = useState("PRODUCT_QUALITY");
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [fieldErrors, setFieldErrors] = useState<AfterSalesFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

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

  const fail = (message: string | string[] | undefined, fallback: string) => {
    const { fields, formError: unmapped } = mapAfterSalesFieldErrors(message);
    setFieldErrors(fields);
    if (Object.keys(fields).length > 0) {
      setFormError(null);
    } else if (typeof message === "string") {
      setFormError(message);
    } else if (Array.isArray(message)) {
      setFormError(message.filter(Boolean).join(" ") || fallback);
    } else {
      setFormError(unmapped ?? fallback);
    }
  };

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
    onSuccess: (created) => {
      setFieldErrors({});
      setFormError(null);
      void client.invalidateQueries({ queryKey: ["complaints"] });
      router.replace({ pathname: "/complaint/[id]", params: { id: String(created.id) } });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        fail(err.body?.message, errorMessage(err, "Gửi khiếu nại thất bại."));
      } else if (err instanceof Error) {
        fail(err.message, "Gửi khiếu nại thất bại.");
      } else {
        setFormError("Gửi khiếu nại thất bại.");
      }
    },
  });

  const submitDisabledReason = (): string | null => {
    if (!selected) return "Hãy chọn một đơn hàng ở trên để tiếp tục.";
    if (content.trim().length === 0) return "Hãy mô tả vấn đề bạn gặp phải để tiếp tục.";
    return null;
  };

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
          message="Đăng nhập để gửi khiếu nại."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/complaints-new" } })}
          fill
        />
      </View>
    );
  }
  if (orders.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải đơn hàng…" />
      </View>
    );
  }
  if (orders.isError) {
    const err = orders.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được đơn hàng.")}
          onRetry={() => void orders.refetch()}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const myOrders = orders.data.data;
  const items = selected?.partnerOrders.flatMap((po) => po.items) ?? [];
  const hint = submitDisabledReason();

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
        <Card>
          <Text style={styles.section}>Gửi khiếu nại mới</Text>

          {myOrders.length === 0 ? (
            <Text style={styles.hint}>
              Bạn chưa có đơn hàng nào để khiếu nại. Khiếu nại được gửi cho một đơn đã đặt.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Chọn đơn hàng</Text>
              {fieldErrors.order ? <Text style={styles.fieldError}>{fieldErrors.order}</Text> : null}
              {myOrders.map((o) => {
                const active = selected?.id === o.id;
                const status = orderStatusMeta(o.status);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => {
                      setPickedOrderId(o.id);
                      setOrderItemId(null);
                      setFieldErrors({});
                      setFormError(null);
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
                  {fieldErrors.type ? (
                    <Text style={styles.fieldError}>{fieldErrors.type}</Text>
                  ) : null}

                  <Text style={styles.label}>Nội dung</Text>
                  <TextInput
                    value={content}
                    onChangeText={(v) => {
                      setContent(v);
                      setFieldErrors((prev) => ({ ...prev, content: undefined }));
                    }}
                    placeholder="Mô tả vấn đề bạn gặp phải"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.inputMultiline, fieldErrors.content && styles.inputError]}
                    multiline
                  />
                  {fieldErrors.content ? (
                    <Text style={styles.fieldError}>{fieldErrors.content}</Text>
                  ) : null}

                  <EvidencePicker items={evidence} onChange={setEvidence} disabled={create.isPending} />
                  {fieldErrors.evidence ? (
                    <Text style={styles.fieldError}>{fieldErrors.evidence}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.hint}>Chọn một đơn hàng ở trên để gửi khiếu nại.</Text>
              )}
            </>
          )}

          {formError ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{formError}</Text>
            </View>
          ) : null}

          {myOrders.length > 0 ? (
            <>
              <PrimaryButton
                label={create.isPending ? "Đang gửi…" : "Gửi khiếu nại"}
                onPress={() => {
                  const local = validateComplaintForm({
                    hasOrder: selected !== null,
                    content,
                    hasType: TYPES.includes(type),
                  });
                  setFieldErrors(local);
                  setFormError(null);
                  if (Object.keys(local).length > 0) return;
                  create.mutate();
                }}
                disabled={create.isPending}
                loading={create.isPending}
                style={styles.submit}
              />
              {hint && !create.isPending ? <Text style={styles.disabledHint}>{hint}</Text> : null}
            </>
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

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: spacing.sm },
  disabledHint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginTop: spacing.sm, textAlign: "center" },
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
  inputError: { borderColor: colors.danger },
  fieldError: { fontSize: 12.5, color: colors.danger, marginTop: 4, lineHeight: 17 },
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
