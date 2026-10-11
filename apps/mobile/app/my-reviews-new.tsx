/**
 * Viết đánh giá (CREATE ONLY).
 *
 * NO TECHNICAL IDS
 *
 * The previous combined screen asked the customer to type an `orderItemId` —
 * an internal database key they had no way of knowing. This form lists what
 * the backend says can be reviewed (`GET /reviews/me/eligible-items`) and the
 * id travels inside the request, never through the keyboard.
 *
 * The list is server-side: it only contains the customer's own DELIVERED items
 * that have no review yet. The create call re-checks all three conditions, so a
 * stale list can only produce a clean business error — never a duplicate review.
 *
 * Photos are optional and upload at submit time. Nothing is reported as sent
 * until the backend has created the review and bound the images.
 *
 * Opened from:
 * - the order detail screen (`/my-reviews-new?orderItemId=…`), with the
 *   product already chosen;
 * - the reviews list's "Viết đánh giá mới" button (no pre-selection).
 *
 * On success the screen navigates back to the reviews list (refreshed) — the
 * new review is visible there with its moderation status — instead of leaving
 * a "done" banner on top of a stale list.
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
import { formatDateTime, formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import {
  mapAfterSalesFieldErrors,
  validateReviewForm,
  type AfterSalesFieldErrors,
} from "../src/lib/aftersales-validation";
import { colors, radius, spacing } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function MyReviewsNewScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { orderItemId: presetId } = useLocalSearchParams<{ orderItemId?: string }>();

  const [pickedId, setPickedId] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [fieldErrors, setFieldErrors] = useState<AfterSalesFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const eligible = useQuery({
    queryKey: ["reviewable-items"],
    queryFn: () => resources.listReviewableItems({ page: 1, limit: 30 }),
    enabled: hydrated && token !== null,
  });

  /**
   * The selected item is DERIVED, not stored.
   *
   * When the screen is opened from an order line, that line should be the
   * selection. Keeping it in state and syncing it from an effect meant a second
   * render on every load, and a stale id could survive after the list refreshed.
   * Deriving it from (explicit tap ?? deep-link param ?? nothing) removes both:
   * the selection is always one of the items actually on screen, and a link to
   * an item that is no longer reviewable simply selects nothing.
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
      if (!selected) throw new Error("Vui lòng chọn sản phẩm cần đánh giá.");

      /**
       * Upload first, then create. If any photo fails, this throws before the
       * create call, so no review is written and the form stays intact for a
       * retry — the customer is never told "đã gửi" for a review whose photos
       * did not arrive.
       */
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);

      return resources.createReview({
        orderItemId: selected.orderItemId,
        rating,
        content: content.trim() || undefined,
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: () => {
      setFieldErrors({});
      setFormError(null);
      void client.invalidateQueries({ queryKey: ["my-reviews"] });
      void client.invalidateQueries({ queryKey: ["reviewable-items"] });
      router.replace("/my-reviews");
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        fail(err.body?.message, errorMessage(err, "Gửi đánh giá thất bại."));
      } else if (err instanceof Error) {
        fail(err.message, "Gửi đánh giá thất bại.");
      } else {
        setFormError("Gửi đánh giá thất bại.");
      }
    },
  });

  const submitDisabledReason = (): string | null => {
    if (!selected) return "Hãy chọn một sản phẩm ở trên để tiếp tục.";
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
          message="Đăng nhập để viết đánh giá."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/my-reviews-new" } })}
          fill
        />
      </View>
    );
  }
  if (eligible.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải sản phẩm có thể đánh giá…" />
      </View>
    );
  }
  if (eligible.isError) {
    const err = eligible.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được sản phẩm có thể đánh giá.")}
          onRetry={() => void eligible.refetch()}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const reviewable = eligible.data.data;
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
          <Text style={styles.section}>Viết đánh giá</Text>

          {reviewable.length === 0 ? (
            <Text style={styles.hint}>
              Bạn chưa có sản phẩm nào cần đánh giá. Đánh giá mở khi đơn hàng đã được giao và sản phẩm
              chưa được đánh giá.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Chọn sản phẩm đã mua</Text>
              {fieldErrors.product ? <Text style={styles.fieldError}>{fieldErrors.product}</Text> : null}
              {reviewable.map((item) => {
                const active = selected?.orderItemId === item.orderItemId;
                return (
                  <Pressable
                    key={item.orderItemId}
                    onPress={() => {
                      setPickedId(item.orderItemId);
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
                        {item.variantName} · {formatQuantity(item.quantity)}
                      </Text>
                      <Text style={styles.itemMeta}>
                        Đơn {item.orderCode} · {formatDateTime(item.deliveredAt)}
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
                  <Text style={styles.label}>Điểm (1–5)</Text>
                  <View style={styles.stars}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Pressable
                        key={s}
                        onPress={() => setRating(s)}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={`${s} sao`}
                        accessibilityState={{ selected: rating === s }}
                      >
                        <Ionicons
                          name={rating >= s ? "star" : "star-outline"}
                          size={32}
                          color={rating >= s ? colors.warning : colors.borderStrong}
                        />
                      </Pressable>
                    ))}
                    <Text style={styles.ratingText}>{rating}/5</Text>
                  </View>
                  {fieldErrors.rating ? (
                    <Text style={styles.fieldError}>{fieldErrors.rating}</Text>
                  ) : null}

                  <Text style={styles.label}>Nhận xét (tùy chọn)</Text>
                  <TextInput
                    value={content}
                    onChangeText={setContent}
                    placeholder="Cảm nhận của bạn về sản phẩm"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.inputMultiline]}
                    multiline
                  />

                  <EvidencePicker items={evidence} onChange={setEvidence} disabled={create.isPending} />
                  {fieldErrors.evidence ? (
                    <Text style={styles.fieldError}>{fieldErrors.evidence}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.hint}>Chọn một sản phẩm ở trên để viết đánh giá.</Text>
              )}
            </>
          )}

          {formError ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{formError}</Text>
            </View>
          ) : null}

          {reviewable.length > 0 ? (
            <>
              <PrimaryButton
                label={create.isPending ? "Đang gửi…" : "Gửi đánh giá"}
                onPress={() => {
                  const local = validateReviewForm({
                    hasProduct: selected !== null,
                    rating,
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
    minHeight: 44,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: "top" },
  fieldError: { fontSize: 12.5, color: colors.danger, marginTop: 4, lineHeight: 17 },
  stars: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ratingText: { fontSize: 12.5, fontWeight: "700", color: colors.text, marginLeft: 4 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: spacing.md },

  /** One selectable purchased item. */
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
  itemThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.page,
  },
  itemThumbFallback: { alignItems: "center", justifyContent: "center" },
  itemBody: { flex: 1 },
  itemName: { fontSize: 13.5, fontWeight: "600", color: colors.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
