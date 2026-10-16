/**
 * Trang chủ.
 *
 * Layout follows the UI Kit mockup: brand header + search, optional hero
 * banner, real category row, real Flash Sale strip, featured products, farms,
 * and the always-reachable trace entry.
 *
 * Every block is driven by a real endpoint. A block whose endpoint returns
 * nothing (no active flash sale, no discounted product) is *omitted entirely*
 * rather than filled with placeholder cards — an empty section that pretends to
 * be a promotion is the exact dishonesty this redesign is meant to remove.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProductCard } from "../../src/components/ProductCard";
import { Card, EmptyView, ErrorView, LinkPress, LoadingView, ProductThumb, SectionHeader } from "../../src/components/ui";
import {
  flashSaleRemainingTotal,
  isFlashItemSoldOut,
  isFlashSaleLive,
  isProductOnSale,
  partitionHomeProducts,
} from "@agrimarket/shared-domain/home";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { apiConfigNotice } from "../../src/lib/config";
import { formatCountdown, formatCountdownLabel } from "../../src/lib/countdown";
import { categoryIcon, designAssets } from "../../src/lib/design-assets";
import { discountPercent, formatMoney, formatQuantity } from "../../src/lib/format";
import { resources } from "../../src/lib/resources";
import { colors, elevation, radius, spacing, TOUCH } from "../../src/lib/theme";
import type { FlashSale, FlashSaleItem, Product } from "../../src/lib/types";
import { useAddToCart } from "../../src/lib/use-add-to-cart";
import { useCountdown } from "../../src/lib/use-countdown";
import { productImageUrl, useProductMap } from "../../src/lib/use-products";
import { useAuth } from "../../src/providers";

/** Two columns once the viewport can hold them comfortably. */
const GRID_MIN_WIDTH = 340;

/** Flash-sale card width / square thumbnail size (kept explicit: `aspectRatio`
 *  on an `overflow: hidden` box let the RN-web image escape its rounded frame). */
const FLASH_CARD_W = 132;
const FLASH_THUMB = FLASH_CARD_W - 16;

export default function HomeScreen() {
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= GRID_MIN_WIDTH ? 2 : 1;

  const { token, hydrated } = useAuth();
  const cart = useAddToCart({
    token,
    hydrated,
    onRequireSignIn: () => router.push({ pathname: "/login", params: { redirect: "/(tabs)" } }),
  });

  const categories = useQuery({ queryKey: ["categories"], queryFn: () => resources.listCategories(100) });
  const products = useQuery({
    queryKey: ["products", "home"],
    queryFn: () => resources.listProducts({ page: 1, limit: 20 }),
  });
  const flash = useQuery({ queryKey: ["flash-sales"], queryFn: () => resources.listFlashSales(10) });
  const farms = useQuery({ queryKey: ["farms", "home"], queryFn: () => resources.listFarms(undefined, 6) });

  const activeFlash = useMemo(
    () => (flash.data?.data ?? []).filter((s) => isFlashSaleLive(s)),
    [flash.data],
  );

  /**
   * A flash sale ended while the screen was open.
   *
   * The card stops rendering itself (see `FlashSaleCard`), and the promotions
   * are re-read so the product grid, the discount section and the flash strip
   * all stop quoting a price that is no longer in force. Refetching is what
   * makes the server's answer — not the device clock — the final word.
   */
  const onFlashExpired = useMemo(
    () => () => {
      void flash.refetch();
      void products.refetch();
    },
    [flash, products],
  );

  /**
   * Flash-sale items embed only `productVariant` ("Túi 1 kg"), so the product
   * name and photo are joined from the real product resource — same trick as
   * the cart. Without this the strip would list anonymous bag sizes.
   * `FlashSaleItem.productVariant` is a full variant row, so `productId` is
   * already present and no extra lookup is needed.
   */
  const productsById = useProductMap(
    activeFlash.flatMap((s) => s.items.map((i) => i.productVariant.productId)),
  );

  /** Product IDs already on display in the flash-sale strip above. */
  const flashSaleProductIds = useMemo(
    () => new Set(activeFlash.flatMap((s) => s.items.map((i) => i.productVariant.productId))),
    [activeFlash],
  );

  /**
   * The two product blocks below the flash strip, de-duplicated.
   *
   * Rules live in `@agrimarket/shared-domain` so the Web homepage shows the
   * exact same sections: a product never appears twice (by ID), the flash-sale
   * strip wins, and "Đang giảm giá" only lists products whose ACTIVE variant
   * really is cheaper than its base price — the server already resolved that
   * price, the app only selects it. The previous extra `/product-discounts`
   * request was never used to decide anything a product row did not already
   * answer, so the home screen no longer makes it.
   */
  const home = useMemo(
    () =>
      partitionHomeProducts(products.data?.data ?? [], {
        getId: (p) => p.id,
        excludeIds: flashSaleProductIds,
        isDiscounted: isProductOnSale,
        discountedLimit: 4,
        featuredLimit: 6,
      }),
    [products.data, flashSaleProductIds],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        categories.refetch(),
        products.refetch(),
        flash.refetch(),
        farms.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const submitSearch = () => {
    router.push({ pathname: "/(tabs)/catalog", params: q.trim() ? { search: q.trim() } : {} });
  };

  const configNotice = apiConfigNotice();

  const renderGrid = (items: Product[]) => {
    if (columns === 1) {
      return items.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          layout="row"
          onAddToCart={cart.add}
          addDisabled={cart.pendingId === p.id}
        />
      ));
    }
    const rows: Product[][] = [];
    for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
    return rows.map((row, idx) => (
      <View key={row[0]?.id ?? idx} style={styles.gridRow}>
        {row.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            layout="grid"
            onAddToCart={cart.add}
            addDisabled={cart.pendingId === p.id}
          />
        ))}
        {row.length === 1 ? <View style={styles.gridFiller} /> : null}
      </View>
    ));
  };

  const categoryList = categories.data?.data ?? [];

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      {/* ------------------------------------------------------------ header -- */}
      {/* This tab has `headerShown: false`, so its own brand header must carry
          the Android top inset itself: without it the status bar (clock, signal)
          sits on top of the logo and the QR/cart buttons. Padding, not margin,
          so the white header background fills the status-bar strip. */}
      <View style={[styles.header, { paddingTop: spacing.md + insets.top }]}>
        <View style={styles.brandRow}>
          <Image source={designAssets.brandLeafMark} style={styles.logo} resizeMode="contain" />
          <View style={styles.brandText}>
            <Text style={styles.brand}>AgriMarket</Text>
            <Text style={styles.brandSub}>Nông sản sạch, rõ nguồn gốc</Text>
          </View>
          <Pressable
            onPress={() => router.push("/(tabs)/trace")}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Truy xuất nguồn gốc"
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/(tabs)/cart")}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Giỏ hàng"
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
          >
            <Ionicons name="cart-outline" size={20} color={colors.primary} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.muted} style={styles.searchIcon} />
          <TextInput
            placeholder="Tìm rau củ, trái cây, trang trại…"
            placeholderTextColor={colors.mutedSoft}
            value={q}
            onChangeText={setQ}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={submitSearch}
            accessibilityLabel="Tìm sản phẩm"
          />
          {q.length > 0 ? (
            <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Xoá tìm kiếm">
              <Ionicons name="close-circle" size={18} color={colors.mutedSoft} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {configNotice ? (
        <Card style={styles.noticeCard}>
          <View style={styles.noticeHead}>
            <Ionicons name="warning-outline" size={17} color={colors.danger} />
            <Text style={styles.noticeTitle}>Chưa kết nối được máy chủ</Text>
          </View>
          <Text style={styles.noticeText}>{configNotice}</Text>
        </Card>
      ) : null}

      {/* Cart feedback — the backend decides success, so its answer is shown. */}
      {cart.notice ? (
        <Pressable
          onPress={cart.clearNotice}
          style={styles.cartNotice}
          accessibilityRole="button"
          accessibilityLabel="Đóng thông báo"
        >
          <Ionicons
            name={cart.notice.startsWith("Đã") ? "checkmark-circle" : "alert-circle"}
            size={16}
            color={cart.notice.startsWith("Đã") ? colors.primary : colors.danger}
          />
          <Text style={styles.cartNoticeText}>{cart.notice}</Text>
        </Pressable>
      ) : null}

      {/* -------------------------------------------------------------- hero -- */}
      {/* Decorative banner from the kit. Text-free artwork, so the headline is
          real copy (and stays translatable) rather than baked-in pixels. */}
      <View style={styles.hero}>
        <Image source={designAssets.homeHero} style={styles.heroImage} resizeMode="cover" />
        <View style={styles.heroOverlay}>
          <Text style={styles.heroTitle}>Nông sản sạch</Text>
          <Text style={styles.heroTitle}>Từ nông trại Việt</Text>
          <Pressable
            onPress={() => router.push("/(tabs)/catalog")}
            style={({ pressed }) => [styles.heroCta, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.heroCtaText}>Khám phá ngay</Text>
          </Pressable>
        </View>
      </View>

      {/* -------------------------------------------------------- categories -- */}
      <SectionHeader
        title="Danh mục"
        actionLabel="Xem tất cả"
        onAction={() => router.push("/(tabs)/catalog")}
      />
      <StateViewFor
        isPending={categories.isPending}
        isError={categories.isError}
        isEmpty={categoryList.length === 0}
        error={categories.error}
        loadingMessage="Đang tải danh mục…"
        errorFallback="Không tải được danh mục."
        emptyMessage="Chưa có danh mục nào."
        emptyKind="search"
        onRetry={() => void categories.refetch()}
      />
      {categoryList.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
          // `flexGrow: 0` stops RN stretching the horizontal scroller to fill the
          // column (which previously blew one chip up to screen height).
          style={styles.hScroller}
          keyboardShouldPersistTaps="handled"
        >
          {categoryList.map((c) => {
            const icon = categoryIcon(c.slug);
            return (
              <Pressable
                key={c.id}
                onPress={() => router.push({ pathname: "/(tabs)/catalog", params: { categoryId: String(c.id) } })}
                style={({ pressed }) => [styles.categoryItem, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Danh mục ${c.name}`}
              >
                <View style={styles.categoryCircle}>
                  {icon ? (
                    <Image source={icon} style={styles.categoryImg} resizeMode="contain" />
                  ) : (
                    // The kit has a glyph for only four categories. A text-only
                    // circle is honest; borrowing another category's picture is not.
                    <Text style={styles.categoryInitial} numberOfLines={1}>
                      {c.name.trim().charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text style={styles.categoryName} numberOfLines={2}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* --------------------------------------------------------- flash sale -- */}
      {/* Only when a real, currently-running programme exists. */}
      {activeFlash.length > 0 ? (
        <>
          <SectionHeader title="Flash Sale" icon="flash" />
          {activeFlash.map((s) => (
            <FlashSaleCard
              key={s.id}
              sale={s}
              products={productsById}
              onOpen={() => router.push("/(tabs)/catalog")}
              onExpired={onFlashExpired}
            />
          ))}
        </>
      ) : null}

      {/* ---------------------------------------------------------- featured -- */}
      <SectionHeader
        title="Sản phẩm nổi bật"
        actionLabel="Xem tất cả"
        onAction={() => router.push("/(tabs)/catalog")}
      />
      <StateViewFor
        isPending={products.isPending}
        isError={products.isError}
        isEmpty={(products.data?.data.length ?? 0) === 0}
        error={products.error}
        loadingMessage="Đang tải sản phẩm…"
        errorFallback="Không tải được sản phẩm."
        emptyMessage="Chưa có sản phẩm nào đang bán."
        emptyKind="search"
        onRetry={() => void products.refetch()}
      />
      {renderGrid(home.featured)}

      {/* --------------------------------------------------------- on sale --- */}
      {/* Only products with a real price cut that are not already shown above. */}
      {home.discounted.length > 0 ? (
        <>
          <SectionHeader title="Đang giảm giá" icon="pricetags-outline" />
          {renderGrid(home.discounted)}
        </>
      ) : null}

      {/* ------------------------------------------------------------- farms -- */}
      <SectionHeader title="Trang trại" actionLabel="Xem tất cả" onAction={() => router.push("/farms")} />
      <StateViewFor
        isPending={farms.isPending}
        isError={farms.isError}
        isEmpty={(farms.data?.data.length ?? 0) === 0}
        error={farms.error}
        loadingMessage="Đang tải trang trại…"
        errorFallback="Không tải được trang trại."
        emptyMessage="Chưa có trang trại nào."
        emptyKind="search"
        onRetry={() => void farms.refetch()}
      />
      {(farms.data?.data ?? []).map((f) => (
        <LinkPress
          key={f.id}
          href={{ pathname: "/farm/[id]", params: { id: String(f.id) } }}
          style={({ pressed }) => [styles.farmRow, pressed && styles.pressed]}
          accessibilityLabel={`Trang trại ${f.name}`}
        >
          <View style={styles.farmIcon}>
            <Ionicons name="leaf-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.farmBody}>
            <Text style={styles.farmName} numberOfLines={1}>
              {f.name}
            </Text>
            <Text style={styles.farmAddr} numberOfLines={1}>
              {f.address}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.mutedSoft} />
        </LinkPress>
      ))}

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

/**
 * Home-local wrapper around the shared state machine.
 *
 * It exists so each block on Home can pass its own query without repeating the
 * `resolveLoadState` call, and so the *network* flag is derived from the error
 * itself (`status === 0`) rather than guessed at the call site.
 */
function StateViewFor({
  isPending,
  isError,
  isEmpty,
  error,
  loadingMessage,
  errorFallback,
  emptyMessage,
  emptyKind,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  error: unknown;
  loadingMessage: string;
  errorFallback: string;
  emptyMessage: string;
  emptyKind: "cart" | "orders" | "search" | "network";
  onRetry: () => void;
}) {
  if (isPending) return <LoadingView message={loadingMessage} />;
  if (isError) {
    return (
      <ErrorView
        message={errorMessage(error, errorFallback)}
        onRetry={onRetry}
        network={isNetworkError(error)}
      />
    );
  }
  if (isEmpty) return <EmptyView message={emptyMessage} kind={emptyKind} illustration={false} />;
  return null;
}

/**
 * Flash sale strip — a horizontal scroller of discounted cards.
 *
 * Every value comes from the backend: the programme name, its real end time, and
 * the per-variant `flashPrice` / `basePrice` / quota. The product *name and
 * photo* are joined from the product resource (the promotion payload embeds the
 * variant only), so a card reads "Nhãn lồng Hưng Yên" instead of "Túi 1 kg".
 * When that join has not resolved yet, the card shows the variant name and the
 * neutral placeholder — never another product's picture.
 *
 * THE TIMER TICKS
 *
 * The remaining time used to be computed once per render, so it froze at
 * whatever it said when the screen mounted and an expired programme kept
 * showing a live clock. It is now a real countdown driven by `endsAt`:
 * recomputed every second, re-synced when the app returns to the foreground,
 * and when it reaches zero the card drops the sale and the promotions are
 * re-read — so an ended flash sale cannot keep displaying flash prices.
 */
function FlashSaleCard({
  sale,
  products,
  onOpen,
  onExpired,
}: {
  sale: FlashSale;
  products: Map<number, Product>;
  onOpen: () => void;
  onExpired: () => void;
}) {
  const countdown = useCountdown(sale.endsAt, onExpired);
  const quotaLeft = flashSaleRemainingTotal(sale);

  // The programme is over: render nothing rather than a card whose prices are
  // no longer valid. `onExpired` has already asked the API for the live list.
  if (countdown.expired) return null;

  return (
    <View style={styles.flashCard}>
      <View style={styles.flashHead}>
        <View style={styles.flashTitleRow}>
          <Ionicons name="flash" size={16} color={colors.danger} />
          <Text style={styles.flashName} numberOfLines={1}>
            {sale.name}
          </Text>
        </View>
        <View style={styles.flashTimer}>
          <Ionicons name="time-outline" size={12} color="#fff" />
          <Text style={styles.flashTimerText}>
            {formatCountdownLabel(countdown.remainingSeconds)} · {formatCountdown(countdown.remainingSeconds)}
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.hScroller}
        contentContainerStyle={styles.flashRow}
        keyboardShouldPersistTaps="handled"
      >
        {sale.items.slice(0, 8).map((it) => (
          <FlashSaleItemCard key={it.id} item={it} product={products.get(it.productVariant.productId)} />
        ))}
      </ScrollView>

      <View style={styles.flashFoot}>
        <Text style={styles.flashQuota}>
          {sale.items.length > 0 ? `${formatQuantity(quotaLeft)} suất còn lại` : ""}
        </Text>
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.flashCta, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.flashCtaText}>Xem ưu đãi</Text>
          <Ionicons name="chevron-forward" size={14} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/** One discounted card: real photo, product name, flash price vs struck base. */
function FlashSaleItemCard({ item, product }: { item: FlashSaleItem; product: Product | undefined }) {
  const flash = Number(item.flashPrice);
  const base = Number(item.productVariant.basePrice);
  const off = discountPercent(base, flash);
  const soldOut = isFlashItemSoldOut(item);

  return (
    <LinkPress
      href={{ pathname: "/product/[id]", params: { id: String(item.productVariant.productId) } }}
      style={({ pressed }) => [styles.flashItemCard, pressed && styles.pressed]}
      accessibilityLabel={`${product?.name ?? item.productVariant.name}, giá ${formatMoney(flash)}`}
    >
      <View style={styles.flashThumbWrap}>
          <ProductThumb uri={productImageUrl(product)} fill />
          {off !== null ? (
            <View style={styles.flashOffBadge}>
              <Text style={styles.flashOffText}>-{off}%</Text>
            </View>
          ) : null}
          {soldOut ? (
            <View style={styles.flashSoldOut}>
              <Text style={styles.flashSoldOutText}>Hết suất</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.flashItem} numberOfLines={2}>
          {product?.name ?? item.productVariant.name}
        </Text>
        <Text style={styles.flashSpec} numberOfLines={1}>
          {item.productVariant.name}
        </Text>
        <Text style={styles.flashPrice}>{formatMoney(flash)}</Text>
        {off !== null ? <Text style={styles.flashWas}>{formatMoney(base)}</Text> : null}
    </LinkPress>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: spacing.md },
  bottomPad: { height: spacing.xl },
  cartNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  cartNoticeText: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: "600" },
  pressed: { opacity: 0.85 },

  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  logo: { width: 34, height: 34, borderRadius: radius.sm },
  brandText: { flex: 1 },
  brand: { fontSize: 18, fontWeight: "700", color: colors.primary },
  brandSub: { fontSize: 12, color: colors.muted },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.page,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    gap: spacing.sm,
  },
  searchIcon: {},
  searchInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 8 },

  noticeCard: { marginHorizontal: spacing.md, marginTop: spacing.md, borderColor: colors.danger },
  noticeHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.danger },
  noticeText: { fontSize: 13, color: colors.muted, lineHeight: 19 },

  hero: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.primarySoft,
    minHeight: 148,
    justifyContent: "center",
    ...elevation.card,
  },
  heroImage: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  heroOverlay: { padding: spacing.lg, gap: 2 },
  heroTitle: { fontSize: 21, fontWeight: "700", color: colors.primaryDark, lineHeight: 28 },
  heroCta: {
    alignSelf: "flex-start",
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 38,
    justifyContent: "center",
  },
  heroCtaText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  hScroller: { flexGrow: 0 },
  categoryRow: { gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 2, paddingRight: spacing.lg },
  categoryItem: { alignItems: "center", width: 68, gap: 6 },
  categoryCircle: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  categoryImg: { width: 44, height: 44 },
  categoryInitial: { fontSize: 20, fontWeight: "700", color: colors.primary },
  categoryName: { fontSize: 12, color: colors.text, textAlign: "center", lineHeight: 15 },

  gridRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  gridFiller: { flex: 1 },

  flashCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    ...elevation.card,
  },
  flashHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  flashTitleRow: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  flashName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textStrong },
  flashTimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  flashTimerText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  flashRow: { gap: spacing.sm, paddingRight: spacing.xs, alignItems: "flex-start" },
  flashItemCard: {
    width: FLASH_CARD_W,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 1,
    ...elevation.card,
  },
  flashThumbWrap: {
    position: "relative",
    width: FLASH_THUMB,
    height: FLASH_THUMB,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginBottom: spacing.xs,
    backgroundColor: colors.primarySoft,
  },
  flashOffBadge: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: colors.danger,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  flashOffText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  flashSoldOut: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  flashSoldOutText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  flashItem: { fontSize: 12.5, fontWeight: "600", color: colors.text, lineHeight: 17 },
  flashSpec: { fontSize: 11, color: colors.mutedSoft },
  flashPrice: { fontSize: 13.5, fontWeight: "700", color: colors.danger, marginTop: 1 },
  flashWas: { fontSize: 11, color: colors.mutedSoft, textDecorationLine: "line-through" },
  flashFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xs,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  flashQuota: { flex: 1, fontSize: 11.5, color: colors.muted },
  flashCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: "center",
  },
  flashCtaText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  farmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: TOUCH + 12,
  },
  farmIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  farmBody: { flex: 1, gap: 1 },
  farmName: { fontSize: 14, fontWeight: "600", color: colors.text },
  farmAddr: { fontSize: 12.5, color: colors.muted },
});
