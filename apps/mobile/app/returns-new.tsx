/**
 * Tạo yêu cầu trả hàng (CREATE ONLY).
 *
 * NO TECHNICAL IDS
 *
 * The previous combined screen asked the customer to type an `orderItemId`.
 * This form lists what the backend says can still be returned
 * (`GET /returns/me/eligible-items`) and the id travels inside the request.
 *
 * The list is server-side and already accounts for what the customer has
 * claimed before: each row carries `returnableQuantity` = purchased minus
 * everything tied up in active requests. The quantity box is capped by that
 * number and the create call re-checks the same sum inside a transaction, so a
 * customer cannot promise the same unit twice.
 *
 * Opened from:
 * - the order detail screen (`/returns-new?orderItemId=…`), with the product
 *   already chosen;
 * - the returns list's "Tạo yêu cầu mới" button (no pre-selection).
 *
 * On success the screen navigates to the new request's detail — the detail
 * carries the status and the way back to the order / the list — instead of
 * leaving a "done" banner on top of a list.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
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
import { Card, EmptyView, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { ApiError, errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import {
  mapAfterSalesFieldErrors,
  validateReturnForm,
  type AfterSalesFieldErrors,
} from "../src/lib/aftersales-validation";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

/** Parses a Decimal-as-string quantity, treating anything unusable as 0. */
function maxQuantity(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function ReturnsNewScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { orderItemId: presetId } = useLocalSearchParams<{ orderItemId?: string }>();

  const [pickedId, setPickedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [fieldErrors, setFieldErrors] = useState<AfterSalesFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const eligible = useQuery({
    queryKey: ["returnable-items"],
    queryFn: () => resources.listReturnableItems({ page: 1, limit: 30 }),
    enabled: hydrated && token !== null,
  });

  /**
   * The selected line is DERIVED, not stored: `explicit tap ?? deep-link
   * parameter`. Storing it and syncing from an effect caused an extra render and
   * could leave a stale selection after the list refreshed. Deriving guarantees
   * the selection is always one of the rows actually on screen, and the
   * quantity cap always belongs to the row being shown.
   */
  const selected =
    eligible.data?.data.find((i) => i.orderItemId === pickedId) ??
    (presetId
      ? (eligible.data?.data.find((i) => i.orderItemId === Number(presetId)) ?? null)
      : null);

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
      if (!selected) throw new Error("Vui lòng chọn sản phẩm cần trả.");

      const requested = Number(quantity);
      const max = maxQuantity(selected.returnableQuantity);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("Số lượng trả phải lớn hơn 0.");
      }
      /**
       * Checked here for a fast, clear message; the backend enforces the same
       * bound against the live sum, so this cannot be used to over-claim.
       */
      if (requested > max) {
        throw new Error(`Bạn chỉ có thể trả tối đa ${max} cho sản phẩm này.`);
      }
      if (reason.trim().length === 0) {
        throw new Error("Vui lòng nhập lý do trả hàng.");
      }

      // Upload first: a failed photo means no request is created and the form
      // survives for a retry.
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);

      return resources.createReturn({
        orderItemId: selected.orderItemId,
        quantity: requested,
        reason: reason.trim(),
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: (created) => {
      setFieldErrors({});
      setFormError(null);
      void client.invalidateQueries({ queryKey: ["returns"] });
      void client.invalidateQueries({ queryKey: ["returnable-items"] });
      router.replace({ pathname: "/return/[id]", params: { id: String(created.id) } });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        fail(err.body?.message, errorMessage(err, "Gửi yêu cầu thất bại."));
      } else if (err instanceof Error) {
        fail(err.message, "Gửi yêu cầu thất bại.");
      } else {
        setFormError("Gửi yêu cầu thất bại.");
      }
    },
  });

  const submitDisabledReason = (): string | null => {
    if (!selected) return "Hãy chọn một sản phẩm ở trên để tiếp tục.";
    if (reason.trim().length === 0) return "Hãy nhập lý do trả hàng để tiếp tục.";
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
          message="Đăng nhập để tạo yêu cầu trả hàng."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/returns-new" } })}
          fill
        />
      </View>
    );
  }
  if (eligible.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải sản phẩm có thể trả…" />
      </View>
    );
  }
  if (eligible.isError) {
    const err = eligible.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được sản phẩm có thể trả.")}
          onRetry={() => void eligible.refetch()}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const returnable = eligible.data.data;
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
          <Text style={styles.section}>Tạo yêu cầu trả hàng</Text>

          {returnable.length === 0 ? (
            <Text style={styles.hint}>
              Bạn chưa có sản phẩm nào có thể trả. Chỉ đơn đã giao và còn số lượng chưa yêu cầu trả mới
              hiển thị ở đây.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Chọn sản phẩm cần trả</Text>
              {fieldErrors.product ? <Text style={styles.fieldError}>{fieldErrors.product}</Text> : null}
              {returnable.map((item) => {
                const active = selected?.orderItemId === item.orderItemId;
                return (
                  <Pressable
                    key={item.orderItemId}
                    onPress={() => {
                      setPickedId(item.orderItemId);
                      setQuantity("1");
                      setFieldErrors({});
                      setFormError(null);
                    }}
                    style={[styles.item, active && styles.itemActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Chọn ${item.productName}`}
                  >
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.itemThumb} />
                    ) : (
                      <View style={[styles.itemThumb, styles.itemThumbFallback]}>
                        <Ionicons name="leaf-outline" size={18} color={colors.mutedSoft} />
                      </View>
                    )}
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.productName}
                      </Text>
                      <Text style={styles.itemMeta} numberOfLines={1}>
                        {item.variantName} · đã mua {formatQuantity(item.purchasedQuantity)}
                      </Text>
                      <Text style={styles.itemMeta}>
                        Có thể trả {formatQuantity(item.returnableQuantity)} · Đơn {item.orderCode}
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

              {selected ? (
                <>
                  <Text style={styles.label}>
                    Số lượng trả (tối đa {formatQuantity(selected.returnableQuantity)})
                  </Text>
                  <TextInput
                    value={quantity}
                    onChangeText={(v) => {
                      setQuantity(v);
                      setFieldErrors((prev) => ({ ...prev, quantity: undefined }));
                    }}
                    keyboardType="decimal-pad"
                    placeholder="1"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, fieldErrors.quantity && styles.inputError]}
                  />
                  {fieldErrors.quantity ? (
                    <Text style={styles.fieldError}>{fieldErrors.quantity}</Text>
                  ) : null}

                  <Text style={styles.label}>Lý do</Text>
                  <TextInput
                    value={reason}
                    onChangeText={(v) => {
                      setReason(v);
                      setFieldErrors((prev) => ({ ...prev, reason: undefined }));
                    }}
                    placeholder="Mô tả tình trạng sản phẩm nhận được"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.inputMultiline, fieldErrors.reason && styles.inputError]}
                    multiline
                  />
                  {fieldErrors.reason ? (
                    <Text style={styles.fieldError}>{fieldErrors.reason}</Text>
                  ) : null}

                  <EvidencePicker items={evidence} onChange={setEvidence} disabled={create.isPending} />
                  {fieldErrors.evidence ? (
                    <Text style={styles.fieldError}>{fieldErrors.evidence}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.hint}>Chọn một sản phẩm ở trên để tạo yêu cầu trả.</Text>
              )}
            </>
          )}

          {formError ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{formError}</Text>
            </View>
          ) : null}

          {returnable.length > 0 ? (
            <>
              <PrimaryButton
                label={create.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
                onPress={() => {
                  // Client-side first: field errors land under the field, and
                  // the request is only sent when the form is locally valid.
                  const local = validateReturnForm({
                    hasProduct: selected !== null,
                    quantityText: quantity,
                    maxQuantity: selected ? maxQuantity(selected.returnableQuantity) : 0,
                    reason,
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
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: spacing.md },

  /** One selectable returnable item. */
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
  itemThumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.page },
  itemThumbFallback: { alignItems: "center", justifyContent: "center" },
  itemBody: { flex: 1 },
  itemName: { fontSize: 13.5, fontWeight: "600", color: colors.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
