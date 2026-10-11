/**
 * Đánh giá của tôi.
 *
 * NO TECHNICAL IDS
 *
 * The previous version asked the customer to type an `orderItemId` — an
 * internal database key they had no way of knowing. Now the screen lists what
 * the backend says can be reviewed (`GET /reviews/me/eligible-items`) and the
 * id travels inside the request, never through the keyboard.
 *
 * The list is server-side: it only contains the customer's own DELIVERED items
 * that have no review yet. The create call re-checks all three conditions, so a
 * stale list can only produce a clean business error — never a duplicate review.
 *
 * Photos are optional and upload at submit time. Nothing is reported as sent
 * until the backend has created the review and bound the images.
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
import { Badge, Card, EmptyView, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { evidenceFileUrl } from "../src/lib/config";
import { formatDateTime, formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { colors, radius, spacing } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function MyReviewsScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { orderItemId: presetId } = useLocalSearchParams<{ orderItemId?: string }>();

  const [pickedId, setPickedId] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reviews = useQuery({
    queryKey: ["my-reviews"],
    queryFn: () => resources.listMyReviews({ page: 1, limit: 20 }),
    enabled: hydrated && token !== null,
  });

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
      setError(null);
      setDone(true);
      setPickedId(null);
      setContent("");
      setRating(5);
      setEvidence([]);
      void client.invalidateQueries({ queryKey: ["my-reviews"] });
      void client.invalidateQueries({ queryKey: ["reviewable-items"] });
    },
    onError: (err) => setError(errorMessage(err, "Gửi đánh giá thất bại.")),
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
          message="Đăng nhập để gửi và xem đánh giá của bạn."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/my-reviews" } })}
          fill
        />
      </View>
    );
  }
  if (reviews.isPending || eligible.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải đánh giá…" />
      </View>
    );
  }
  if (reviews.isError || eligible.isError) {
    const err = reviews.error ?? eligible.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được đánh giá.")}
          onRetry={() => {
            void reviews.refetch();
            void eligible.refetch();
          }}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const myReviews = reviews.data.data;
  const reviewable = eligible.data.data;


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
              Đã gửi đánh giá. Ảnh đính kèm sẽ hiển thị công khai khi đánh giá được duyệt.
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>Đánh giá của tôi</Text>
        {myReviews.length === 0 ? (
          <EmptyView
            kind="orders"
            title="Chưa có đánh giá"
            message="Chỉ đơn đã giao mới được đánh giá. Viết đánh giá đầu tiên ở biểu mẫu bên dưới."
          />
        ) : (
          myReviews.map((r) => (
            <Card key={r.id}>
              <View style={styles.reviewHead}>
                <Text style={styles.name} numberOfLines={2}>
                  {r.product.name}
                </Text>
                <Badge
                  label={
                    r.status === "APPROVED" ? "Đã duyệt" : r.status === "PENDING" ? "Chờ duyệt" : "Đã ẩn"
                  }
                  tone={r.status === "APPROVED" ? "green" : r.status === "PENDING" ? "yellow" : "gray"}
                />
              </View>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Ionicons
                    key={n}
                    name={n <= r.rating ? "star" : "star-outline"}
                    size={13}
                    color={n <= r.rating ? colors.warning : colors.mutedSoft}
                  />
                ))}
                <Text style={styles.ratingText}>{r.rating}/5</Text>
              </View>
              {r.content ? <Text style={styles.reviewText}>{r.content}</Text> : null}

              {r.evidence && r.evidence.length > 0 ? (
                <View style={styles.evidenceRow}>
                  {r.evidence.map((img) => (
                    <Image
                      key={img.id}
                      source={{ uri: evidenceFileUrl(img.id) }}
                      style={styles.evidenceThumb}
                      accessibilityLabel="Ảnh minh chứng"
                    />
                  ))}
                </View>
              ) : null}

              <Text style={styles.muted}>{formatDateTime(r.createdAt)}</Text>
            </Card>
          ))
        )}


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
              {reviewable.map((item) => {
                const active = selected?.orderItemId === item.orderItemId;
                return (
                  <Pressable
                    key={item.orderItemId}
                    onPress={() => {
                      setPickedId(item.orderItemId);
                      setDone(false);
                      setError(null);
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
                </>
              ) : (
                <Text style={styles.hint}>Chọn một sản phẩm ở trên để viết đánh giá.</Text>
              )}
            </>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {reviewable.length > 0 ? (
            <PrimaryButton
              label={create.isPending ? "Đang gửi…" : "Gửi đánh giá"}
              onPress={() => create.mutate()}
              disabled={create.isPending || !selected}
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

  muted: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  reviewHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  name: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textStrong, lineHeight: 19 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  reviewText: { fontSize: 13, color: colors.text, marginTop: spacing.xs, lineHeight: 19 },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: spacing.sm },
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
  stars: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ratingText: { fontSize: 12.5, fontWeight: "700", color: colors.text, marginLeft: 4 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: spacing.md },

  /** Success banner shown after the backend confirms the review exists. */
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

  /** Evidence thumbnails on a saved review. */
  evidenceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  evidenceThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.page,
  },
});
