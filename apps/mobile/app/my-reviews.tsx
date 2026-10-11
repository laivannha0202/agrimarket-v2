/**
 * Đánh giá của tôi (LIST ONLY).
 *
 * Creation lives in `/my-reviews-new`: this screen never asks for product,
 * rating or photos, so the history stays scannable and the form stays
 * focused. The prominent "Viết đánh giá mới" button is the only creation
 * entry point here; the per-item entry point lives on the order detail
 * screen, which opens the form with the product already chosen.
 *
 * A legacy deep link (`/my-reviews?orderItemId=…`) is forwarded to the form
 * so old entry points keep working.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { EvidenceGallery } from "../src/components/EvidenceGallery";
import { Badge, Card, EmptyView, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDateTime } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { colors, spacing } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function MyReviewsScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const { orderItemId } = useLocalSearchParams<{ orderItemId?: string }>();

  /**
   * Legacy deep links pointed at this screen with a product id. The form now
   * owns creation, so forward there — the customer never sees this hop.
   */
  useEffect(() => {
    if (orderItemId) {
      router.replace({ pathname: "/my-reviews-new", params: { orderItemId } });
    }
  }, [orderItemId, router]);

  const reviews = useQuery({
    queryKey: ["my-reviews"],
    queryFn: () => resources.listMyReviews({ page: 1, limit: 20 }),
    enabled: hydrated && token !== null,
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
          message="Đăng nhập để xem đánh giá của bạn."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/my-reviews" } })}
          fill
        />
      </View>
    );
  }
  if (reviews.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải đánh giá…" />
      </View>
    );
  }
  if (reviews.isError) {
    const err = reviews.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được đánh giá.")}
          onRetry={() => void reviews.refetch()}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const myReviews = reviews.data.data;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={reviews.isRefetching} onRefresh={() => void reviews.refetch()} />}
    >
      <PrimaryButton
        label="Viết đánh giá mới"
        icon="add"
        onPress={() => router.push("/my-reviews-new")}
        style={styles.createBtn}
      />

      <Text style={styles.section}>Đánh giá của tôi</Text>
      {myReviews.length === 0 ? (
        <EmptyView
          kind="orders"
          title="Chưa có đánh giá"
          message="Chỉ đơn đã giao mới được đánh giá."
          actionLabel="Viết đánh giá mới"
          onAction={() => router.push("/my-reviews-new")}
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

            {/**
             * The customer's OWN photos, fetched with the session. The old
             * code rendered `evidenceFileUrl(id)` as a plain `<Image>`, which
             * arrives anonymous and is refused for every PENDING/HIDDEN review —
             * exactly the reviews the customer most wants to check.
             */}
            <EvidenceGallery images={r.evidence} label="Ảnh đã gửi" size={56} />

            <Text style={styles.muted}>{formatDateTime(r.createdAt)}</Text>
          </Card>
        ))
      )}
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },
  createBtn: { marginTop: 0, marginBottom: spacing.md },

  muted: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  reviewHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  name: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textStrong, lineHeight: 19 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  reviewText: { fontSize: 13, color: colors.text, marginTop: spacing.xs, lineHeight: 19 },
  ratingText: { fontSize: 12.5, fontWeight: "700", color: colors.text, marginLeft: 4 },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
});
