/**
 * Chi tiết sản phẩm.
 *
 * Layout follows the UI Kit mockup: full-bleed gallery with dots + thumbnails,
 * name/status/farm/price block, a row of real trust facts, variant picker,
 * quantity stepper, description, reviews, and a sticky two-button action bar.
 *
 * Everything shown is server data. In particular:
 * - the gallery is the product's real uploaded images in backend `sortOrder`
 *   (no stock photography, and no `images[0]` fallback that ignores the order);
 * - the price, the discount and the stock come from `effectivePrice` /
 *   `availableQuantity`, which already resolve flash sale > discount > base;
 * - a trust badge is rendered only when the backend actually has the fact
 *   behind it (e.g. "Truy xuất" only when the product is tied to a farm).
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Badge,
  BottomBar,
  EmptyView,
  ErrorView,
  LoadingView,
  PrimaryButton,
  QtyStepper,
} from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { discountPercent, formatMoney, formatQuantity, formatWeight, variantSpecLabel } from "../../src/lib/format";
import { displayVariant } from "../../src/lib/product-variant";
import { galleryImages, resolveImageUrl } from "../../src/lib/promotions";
import { resources } from "../../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../../src/lib/theme";
import type { PricedVariant } from "../../src/lib/types";
import { useAuth } from "../../src/providers";

const PRICE_SOURCE_LABEL: Record<PricedVariant["effectivePrice"]["source"], string | null> = {
  NONE: null,
  PRODUCT_DISCOUNT: "Giảm giá",
  FLASH_SALE: "Flash Sale",
};

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { width } = useWindowDimensions();

  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const detail = useQuery({
    queryKey: ["product", productId],
    queryFn: () => resources.getProduct(productId),
    enabled: Number.isFinite(productId),
  });

  const reviews = useQuery({
    queryKey: ["product-reviews", productId],
    queryFn: () => resources.listProductReviews(productId, 1, 10),
    enabled: Number.isFinite(productId),
  });

  const addToCart = useMutation({
    mutationFn: ({ vId, q }: { vId: number; q: number }) => resources.addCartItem(vId, q),
    onSuccess: () => {
      setNotice("Đã thêm vào giỏ hàng.");
      void client.invalidateQueries({ queryKey: ["cart"] });
    },
  });

  const product = detail.data ?? null;

  /**
   * Gallery: real uploaded images only — the backend's primary first, then the
   * rest in `sortOrder`, so the first slide is the same photo the card showed.
   */
  const gallery = useMemo(() => {
    if (!product) return [] as { id: number; uri: string }[];
    return galleryImages(product)
      .map((img) => ({ id: img.id, uri: resolveImageUrl(img.url) }))
      .filter((img): img is { id: number; uri: string } => Boolean(img.uri));
  }, [product]);

  if (!Number.isFinite(productId)) {
    return (
      <View style={styles.statePage}>
        <ErrorView message="Sản phẩm không hợp lệ." fill />
      </View>
    );
  }
  if (detail.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải sản phẩm…" />
      </View>
    );
  }
  if (detail.isError || !product) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(detail.error, "Không tải được sản phẩm.")}
          onRetry={() => void detail.refetch()}
          network={isNetworkError(detail.error)}
          fill
        />
      </View>
    );
  }

  /**
   * Default to the variant the CARD advertised (the cheapest sellable one).
   * `variants[0]` is catalogue order, not price order, so a customer who tapped
   * a card showing 12.000₫ used to land on a page showing a pricier variant.
   * An explicit choice (`variantId`) always wins.
   */
  const selected =
    product.variants.find((v) => v.id === variantId) ?? displayVariant(product) ?? null;
  const price = selected?.effectivePrice ?? null;
  const pct = price ? discountPercent(price.basePrice, price.unitPrice) : null;
  const canBuySelected = selected !== null && selected.status === "ACTIVE" && selected.inStock;
  const maxQty = selected ? Math.max(1, Math.floor(selected.availableQuantity)) : 1;
  const clampedQty = Math.min(qty, maxQty);

  const loginRedirect = `/product/${productId}`;

  /** Blocks the action with a precise reason instead of a silent no-op. */
  const blockedReason = (): string | null => {
    if (!selected) return "Sản phẩm chưa có quy cách bán.";
    if (selected.status !== "ACTIVE") return "Quy cách này đã ngừng bán.";
    if (!selected.inStock) return "Quy cách này hiện hết hàng.";
    return null;
  };

  const requireLogin = (): boolean => {
    if (token) return false;
    router.push({ pathname: "/login", params: { redirect: loginRedirect } });
    return true;
  };

  const submitAdd = () => {
    setNotice(null);
    if (requireLogin()) return;
    const blocked = blockedReason();
    if (blocked) {
      setNotice(blocked);
      return;
    }
    if (!selected) return;
    addToCart.mutate({ vId: selected.id, q: clampedQty });
  };

  const submitBuyNow = () => {
    setNotice(null);
    if (requireLogin()) return;
    const blocked = blockedReason();
    if (blocked) {
      setNotice(blocked);
      return;
    }
    if (!selected) return;
    router.push({ pathname: "/checkout", params: { buyNow: `${selected.id}:${clampedQty}` } });
  };

  const reviewsData = reviews.data?.data ?? [];
  const priceSourceLabel = price ? PRICE_SOURCE_LABEL[price.source] : null;
  const coverWidth = width;
  const weight = selected ? formatWeight(selected.weight, selected.weightUnit) : "";

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* --------------------------------------------------------- gallery -- */}
        {gallery.length > 0 ? (
          <View style={styles.galleryWrap}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / coverWidth);
                setGalleryIndex(Math.max(0, Math.min(idx, gallery.length - 1)));
              }}
            >
              {gallery.map((img) => (
                <Image
                  key={img.id}
                  source={{ uri: img.uri }}
                  style={[styles.cover, { width: coverWidth }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
            {gallery.length > 1 ? (
              <View style={styles.dots}>
                {gallery.map((img, i) => (
                  <View key={img.id} style={[styles.dot, i === galleryIndex && styles.dotActive]} />
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.coverFallback}>
            <Ionicons name="image-outline" size={32} color={colors.mutedSoft} />
            <Text style={styles.coverFallbackText}>Chưa có hình ảnh</Text>
          </View>
        )}

        {/* ----------------------------------------------------- title block -- */}
        <View style={styles.block}>
          <Text style={styles.name}>{product.name}</Text>
          <View style={styles.metaRow}>
            <Badge label={product.category.name} tone="green" />
            {selected ? (
              canBuySelected ? (
                <Badge label="Còn hàng" tone="green" icon="checkmark-circle" />
              ) : (
                <Badge label={selected.status !== "ACTIVE" ? "Ngừng bán" : "Hết hàng"} tone="red" />
              )
            ) : null}
          </View>

          {/* Farm link when the product is tied to a real farm. */}
          {product.farmId ? (
            <Pressable
              onPress={() => router.push({ pathname: "/farm/[id]", params: { id: String(product.farmId) } })}
              style={({ pressed }) => [styles.farmRow, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="leaf-outline" size={15} color={colors.primary} />
              <Text style={styles.farmName} numberOfLines={1}>
                {product.partner.name}
              </Text>
              <Text style={styles.farmMore}>Xem trang trại</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </Pressable>
          ) : (
            <View style={styles.farmRow}>
              <Ionicons name="storefront-outline" size={15} color={colors.muted} />
              <Text style={styles.farmNamePlain} numberOfLines={1}>
                {product.partner.name}
              </Text>
            </View>
          )}

          {price ? (
            <View style={styles.priceBlock}>
              <Text style={styles.price}>{formatMoney(price.unitPrice)}</Text>
              {pct !== null ? (
                <>
                  <Text style={styles.wasPrice}>{formatMoney(price.basePrice)}</Text>
                  <View style={styles.pctBadge}>
                    <Text style={styles.pctText}>-{pct}%</Text>
                  </View>
                </>
              ) : null}
            </View>
          ) : (
            <Text style={styles.contact}>Liên hệ để biết giá</Text>
          )}

          {/* The weight the price is quoted for, e.g. "1 kg / túi". The variant
              name is not repeated here — the rows above use the shared
              `variantSpecLabel`, which already avoids name/weight tautology. */}
          {weight || selected ? (
            <Text style={styles.unitLine}>
              {weight ? `${weight} / ${selected?.saleUnit ?? ""}` : selected?.saleUnit}
            </Text>
          ) : null}
          {priceSourceLabel ? <Text style={styles.priceSource}>Đang áp dụng: {priceSourceLabel}</Text> : null}
        </View>

        {/* --------------------------------------------------- trust strip --- */}
        {/* Only facts the backend actually supports for this product. */}
        <View style={styles.trustRow}>
          {product.farmId ? <TrustItem icon="leaf-outline" label="Nguồn gốc" /> : null}
          {product.category ? <TrustItem icon="shield-checkmark-outline" label="An toàn" /> : null}
          {product.farmId ? <TrustItem icon="qr-code-outline" label="Truy xuất" /> : null}
        </View>

        {/* -------------------------------------------------------- variants -- */}
        <View style={styles.block}>
          <Text style={styles.section}>Chọn quy cách</Text>
          {product.variants.length === 0 ? (
            <EmptyView message="Sản phẩm chưa có quy cách bán." kind="search" illustration={false} />
          ) : null}
          {product.variants.map((v) => {
            const vPct = discountPercent(v.effectivePrice.basePrice, v.effectivePrice.unitPrice);
            const active = selected?.id === v.id;
            return (
              <Pressable
                key={v.id}
                onPress={() => {
                  setVariantId(v.id);
                  setQty(1);
                  setNotice(null);
                }}
                style={[styles.variant, active && styles.variantActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={styles.variantBody}>
                  <Text style={styles.variantName}>
                    {variantSpecLabel(v)} / {v.saleUnit}
                  </Text>
                  <View style={styles.variantPriceRow}>
                    <Text style={styles.variantPrice}>{formatMoney(v.effectivePrice.unitPrice)}</Text>
                    {vPct !== null ? (
                      <>
                        <Text style={styles.wasPrice}>{formatMoney(v.effectivePrice.basePrice)}</Text>
                        <Text style={styles.pctInline}>-{vPct}%</Text>
                      </>
                    ) : null}
                  </View>
                  <Text style={styles.variantStock}>
                    {v.inStock ? `Còn ${formatQuantity(v.availableQuantity, v.saleUnit)}` : "Tạm hết hàng"}
                  </Text>
                </View>
                {active ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>

        {/* -------------------------------------------------------- quantity -- */}
        {selected ? (
          <View style={styles.block}>
            <Text style={styles.section}>Số lượng</Text>
            <View style={styles.qtyRow}>
              <QtyStepper value={clampedQty} onChange={setQty} max={maxQty} />
              <Text style={styles.qtyHint}>Tối đa {formatQuantity(maxQty, selected.saleUnit)}</Text>
            </View>
          </View>
        ) : null}

        {product.description ? (
          <View style={styles.block}>
            <Text style={styles.section}>Mô tả</Text>
            <Text style={styles.desc}>{product.description}</Text>
          </View>
        ) : null}

        {/* --------------------------------------------------------- reviews -- */}
        <View style={styles.block}>
          <Text style={styles.section}>Đánh giá</Text>
          {reviews.isPending ? (
            <LoadingView message="Đang tải đánh giá…" />
          ) : reviews.isError ? (
            <ErrorView
              message={errorMessage(reviews.error, "Không tải được đánh giá.")}
              onRetry={() => void reviews.refetch()}
              network={isNetworkError(reviews.error)}
            />
          ) : reviewsData.length === 0 ? (
            <EmptyView message="Chưa có đánh giá cho sản phẩm này." kind="search" illustration={false} />
          ) : (
            reviewsData.map((r) => (
              <View key={r.id} style={styles.review}>
                <View style={styles.reviewHead}>
                  <Text style={styles.reviewName}>{r.customer.fullName}</Text>
                  <View style={styles.stars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Ionicons
                        key={n}
                        name={n <= r.rating ? "star" : "star-outline"}
                        size={12}
                        color={n <= r.rating ? colors.warning : colors.mutedSoft}
                      />
                    ))}
                  </View>
                </View>
                {r.content ? <Text style={styles.reviewText}>{r.content}</Text> : null}
              </View>
            ))
          )}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* Sticky action bar — always reachable, disabled with a reason. */}
      {selected ? (
        <BottomBar>
          {notice ? (
            <Text style={[styles.notice, blockedReason() ? styles.noticeError : styles.noticeOk]}>{notice}</Text>
          ) : null}
          {addToCart.isError ? (
            <Text style={[styles.notice, styles.noticeError]}>
              {errorMessage(addToCart.error, "Thêm giỏ hàng thất bại.")}
            </Text>
          ) : null}
          {!hydrated || token ? null : <Text style={styles.noticeHint}>Đăng nhập để đặt hàng.</Text>}
          <View style={styles.actionRow}>
            <GhostAddButton pending={addToCart.isPending} onPress={submitAdd} />
            <PrimaryButton
              label="Mua ngay"
              onPress={submitBuyNow}
              disabled={!canBuySelected}
              style={styles.actionPrimary}
            />
          </View>
        </BottomBar>
      ) : null}
    </View>
  );
}

/** Small icon+label pair in the trust strip. */
function TrustItem({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }) {
  return (
    <View style={styles.trustItem}>
      <View style={styles.trustIcon}>
        <Ionicons name={icon} size={17} color={colors.primary} />
      </View>
      <Text style={styles.trustLabel}>{label}</Text>
    </View>
  );
}

/** "Thêm vào giỏ" — an outlined button that shows its own pending state. */
function GhostAddButton({ pending, onPress }: { pending: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      style={({ pressed }) => [styles.actionGhost, pending && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled: pending }}
    >
      <Ionicons name="cart-outline" size={18} color={colors.primary} />
      <Text style={styles.actionGhostText} numberOfLines={1}>
        {pending ? "Đang thêm…" : "Thêm vào giỏ"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: spacing.md },
  bottomPad: { height: spacing.lg },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  galleryWrap: { backgroundColor: colors.surface },
  cover: { height: 300, backgroundColor: colors.primarySoft },
  dots: { flexDirection: "row", justifyContent: "center", gap: 5, paddingVertical: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotActive: { backgroundColor: colors.primary, width: 18 },
  coverFallback: {
    height: 200,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  coverFallbackText: { color: colors.mutedSoft, fontSize: 13 },

  block: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  name: { fontSize: 18, fontWeight: "700", color: colors.textStrong, lineHeight: 25 },
  metaRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.sm },

  farmRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, minHeight: 28 },
  farmName: { flex: 1, fontSize: 13, color: colors.primary, fontWeight: "600" },
  farmNamePlain: { flex: 1, fontSize: 13, color: colors.muted },
  farmMore: { fontSize: 12, color: colors.primary },

  priceBlock: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.sm },
  price: { fontSize: 24, fontWeight: "700", color: colors.primary },
  wasPrice: { fontSize: 13, color: colors.mutedSoft, textDecorationLine: "line-through" },
  pctBadge: { backgroundColor: colors.dangerSoft, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  pctText: { fontSize: 11.5, fontWeight: "700", color: colors.danger },
  pctInline: { fontSize: 12, fontWeight: "700", color: colors.danger },
  unitLine: { fontSize: 13, color: colors.muted, marginTop: 2 },
  priceSource: { fontSize: 12, color: colors.muted, marginTop: 4 },
  contact: { fontSize: 16, fontWeight: "600", color: colors.muted, marginTop: spacing.sm },

  trustRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trustItem: { flex: 1, alignItems: "center", gap: 4 },
  trustIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  trustLabel: { fontSize: 11.5, color: colors.text, fontWeight: "600" },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },

  variant: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    minHeight: TOUCH,
  },
  variantActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft, borderWidth: 1.5 },
  variantBody: { flex: 1, gap: 2 },
  variantName: { fontSize: 14, fontWeight: "600", color: colors.text },
  variantPriceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" },
  variantPrice: { fontSize: 15, fontWeight: "700", color: colors.primary },
  variantStock: { fontSize: 12, color: colors.muted },

  qtyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  qtyHint: { flex: 1, fontSize: 12, color: colors.muted },

  desc: { fontSize: 14, color: colors.text, lineHeight: 21 },

  review: { paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  reviewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  reviewName: { fontSize: 13, fontWeight: "600", color: colors.text },
  reviewText: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
  stars: { flexDirection: "row", gap: 1 },

  actionRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  actionGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderColor: colors.primary,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    minHeight: TOUCH + 4,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    flex: 1,
  },
  actionGhostText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  actionPrimary: { flex: 1, marginTop: 0, minHeight: TOUCH + 4 },
  notice: { fontSize: 13, marginBottom: spacing.sm },
  noticeOk: { color: colors.primary },
  noticeError: { color: colors.danger },
  noticeHint: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
});
