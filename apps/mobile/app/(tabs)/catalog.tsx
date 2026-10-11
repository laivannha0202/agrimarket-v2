/**
 * Sản phẩm (catalogue).
 *
 * Layout follows the UI Kit mockup: search field, category chip row, a compact
 * tool row (filter / sort / layout), then a 2-up grid of real products.
 *
 * Notes on the parts that look like shortcuts but are not:
 * - The search box and category chips hit the *server* (`search` / `categoryId`
 *   query params). Sorting and the in-stock toggle are display-only refinements
 *   over server-priced data, and the screen says so when they are active — the
 *   backend exposes no sort parameter, so pretending otherwise would be a lie.
 * - Every empty state names the reason (no match for a filter vs. no catalogue).
 */

import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { ProductCard } from "../../src/components/ProductCard";
import { Chip, EmptyView, ErrorView, LoadingView } from "../../src/components/ui";
import { errorMessage, isNetworkError } from "../../src/lib/api-client";
import { cheapestVariantPrice } from "../../src/lib/promotions";
import { resources } from "../../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../../src/lib/theme";
import type { Product } from "../../src/lib/types";
import { useAddToCart } from "../../src/lib/use-add-to-cart";
import { useAuth } from "../../src/providers";

type SortKey = "relevant" | "price-asc" | "price-desc" | "name";

const SORTS: { key: SortKey; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "relevant", label: "Liên quan", icon: "swap-vertical-outline" },
  { key: "price-asc", label: "Giá tăng", icon: "arrow-up-outline" },
  { key: "price-desc", label: "Giá giảm", icon: "arrow-down-outline" },
  { key: "name", label: "Tên A–Z", icon: "text-outline" },
];

/** Two columns once the viewport can hold them comfortably. */
const GRID_MIN_WIDTH = 340;
const PAGE_SIZE = 20;

export default function CatalogScreen() {
  const params = useLocalSearchParams<{ search?: string; categoryId?: string }>();
  const router = useRouter();
  const routeSearch = typeof params.search === "string" ? params.search : "";
  const routeCategory = params.categoryId ? Number(params.categoryId) : undefined;

  const { width } = useWindowDimensions();
  const columns = width >= GRID_MIN_WIDTH ? 2 : 1;

  // Search box state, re-synced when arriving from Home with new params
  // (adjust-during-render: the documented alternative to setState-in-effect).
  const [search, setSearch] = useState(routeSearch);
  const [committed, setCommitted] = useState(routeSearch);
  const [lastRouteSearch, setLastRouteSearch] = useState(routeSearch);
  if (lastRouteSearch !== routeSearch) {
    setLastRouteSearch(routeSearch);
    setSearch(routeSearch);
    setCommitted(routeSearch);
  }
  const [categoryId, setCategoryId] = useState<number | undefined>(routeCategory);
  const [lastRouteCategory, setLastRouteCategory] = useState<string | undefined>(params.categoryId);
  if (lastRouteCategory !== params.categoryId) {
    setLastRouteCategory(params.categoryId);
    setCategoryId(Number.isFinite(routeCategory) ? routeCategory : undefined);
  }

  const [sort, setSort] = useState<SortKey>("relevant");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const { token, hydrated } = useAuth();
  const cart = useAddToCart({
    token,
    hydrated,
    onRequireSignIn: () => router.push({ pathname: "/login", params: { redirect: "/catalog" } }),
  });

  const categories = useQuery({ queryKey: ["categories"], queryFn: () => resources.listCategories(100) });
  const list = useInfiniteQuery({
    queryKey: ["products", committed, categoryId],
    queryFn: ({ pageParam }) =>
      resources.listProducts({ page: pageParam, limit: PAGE_SIZE, search: committed || undefined, categoryId }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPageParam < lastPage.meta.totalPages ? lastPageParam + 1 : undefined,
  });

  const items = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.data), [list.data]);

  /** Display-only refinement over server-priced data (no price maths here). */
  const visible = useMemo(() => {
    const copy = inStockOnly ? items.filter((p) => p.variants.some((v) => v.inStock)) : [...items];
    if (sort === "price-asc")
      copy.sort((a, b) => (cheapestVariantPrice(a)?.unitPrice ?? 0) - (cheapestVariantPrice(b)?.unitPrice ?? 0));
    else if (sort === "price-desc")
      copy.sort((a, b) => (cheapestVariantPrice(b)?.unitPrice ?? 0) - (cheapestVariantPrice(a)?.unitPrice ?? 0));
    else if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return copy;
  }, [items, sort, inStockOnly]);

  const total = list.data?.pages[0]?.meta.total ?? items.length;
  const hasFilter = committed !== "" || categoryId !== undefined || inStockOnly;

  /** Pad to an even count so a lone card can't stretch across both columns. */
  const gridData = useMemo<(Product | null)[]>(() => {
    if (columns === 1) return visible;
    return visible.length % 2 === 1 ? [...visible, null] : visible;
  }, [visible, columns]);

  const activeCategoryName =
    categoryId !== undefined ? (categories.data?.data ?? []).find((c) => c.id === categoryId)?.name : undefined;

  const isInitialLoading = list.isPending;
  const isInitialError = list.isError && items.length === 0;
  const isEmpty = !isInitialLoading && !isInitialError && visible.length === 0;

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          placeholder="Tìm sản phẩm…"
          placeholderTextColor={colors.mutedSoft}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => setCommitted(search)}
          returnKeyType="search"
          style={styles.searchInput}
          accessibilityLabel="Tìm sản phẩm"
        />
        {search.length > 0 ? (
          <Pressable
            onPress={() => {
              setSearch("");
              setCommitted("");
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Xoá tìm kiếm"
          >
            <Ionicons name="close-circle" size={18} color={colors.mutedSoft} />
          </Pressable>
        ) : null}
      </View>

      {/* Category chips: the server filter, so the row reflects real categories. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroller}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        <Chip label="Tất cả" active={categoryId === undefined} onPress={() => setCategoryId(undefined)} />
        {(categories.data?.data ?? []).map((c) => (
          <Chip key={c.id} label={c.name} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
        ))}
      </ScrollView>

      <View style={styles.toolRow}>
        <Pressable
          onPress={() => setShowFilters((v) => !v)}
          style={[styles.tool, showFilters && styles.toolActive]}
          accessibilityRole="button"
          accessibilityState={{ expanded: showFilters }}
        >
          <Ionicons name="options-outline" size={15} color={showFilters ? colors.primary : colors.text} />
          <Text style={[styles.toolText, showFilters && styles.toolTextActive]}>Lọc</Text>
        </Pressable>
        <Pressable
          onPress={() => setInStockOnly((v) => !v)}
          style={[styles.tool, inStockOnly && styles.toolActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: inStockOnly }}
        >
          <Ionicons
            name={inStockOnly ? "checkbox" : "square-outline"}
            size={15}
            color={inStockOnly ? colors.primary : colors.text}
          />
          <Text style={[styles.toolText, inStockOnly && styles.toolTextActive]}>Còn hàng</Text>
        </Pressable>
        <View style={styles.toolSpacer} />
        <Text style={styles.countText}>
          {visible.length}/{total}
        </Text>
      </View>

      {/* Cart feedback: the backend is the only thing that decides success. */}
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

      {showFilters ? (
        <View style={styles.sortWrap}>
          <Text style={styles.sortLabel}>Sắp xếp</Text>
          <View style={styles.sortRow}>
            {SORTS.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setSort(s.key)}
                style={[styles.sort, sort === s.key && styles.sortActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === s.key }}
              >
                <Ionicons name={s.icon} size={13} color={sort === s.key ? colors.primary : colors.muted} />
                <Text style={[styles.sortText, sort === s.key && styles.sortTextActive]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Be explicit that sorting/stock are applied to what is already loaded:
          the backend has no sort parameter, so "sorted everything" would be false. */}
      {sort !== "relevant" || inStockOnly ? (
        <Text style={styles.scope}>
          Áp dụng trên {visible.length} sản phẩm đã tải
          {activeCategoryName ? ` · ${activeCategoryName}` : ""}
          {committed ? ` · “${committed}”` : ""}.
        </Text>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {list.isError && items.length > 0 ? (
        <Text style={styles.inlineError}>Không tải thêm được sản phẩm.</Text>
      ) : null}
      {list.hasNextPage ? (
        <Pressable
          onPress={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.moreText}>
            {list.isFetchingNextPage ? "Đang tải…" : `Xem thêm (${items.length}/${total} sản phẩm)`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.page}>
      <FlatList
        key={`catalog-${columns}`}
        data={gridData}
        numColumns={columns}
        keyExtractor={(item, index) => (item ? String(item.id) : `filler-${index}`)}
        renderItem={({ item }) =>
          item === null ? (
            <View style={styles.cell} />
          ) : (
            <View style={styles.cell}>
              <ProductCard
                product={item}
                layout={columns === 1 ? "row" : "grid"}
                onAddToCart={cart.add}
                addDisabled={cart.pendingId === item.id}
              />
            </View>
          )
        }
        columnWrapperStyle={columns === 1 ? undefined : styles.columnWrap}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          isInitialLoading ? (
            <LoadingView message="Đang tải sản phẩm…" />
          ) : isInitialError ? (
            <ErrorView
              message={errorMessage(list.error, "Không tải được sản phẩm.")}
              onRetry={() => void list.refetch()}
              network={isNetworkError(list.error)}
            />
          ) : isEmpty ? (
            <EmptyView
              // The kit's search graphic is right here in both cases: either a
              // filter matched nothing, or the catalogue itself has no rows yet.
              kind="search"
              title={hasFilter ? "Không tìm thấy sản phẩm" : "Chưa có sản phẩm"}
              message={
                hasFilter
                  ? "Thử từ khoá khác hoặc bỏ bộ lọc để xem toàn bộ sản phẩm."
                  : "Cửa hàng chưa có sản phẩm nào đang bán."
              }
              actionLabel={hasFilter ? "Bỏ bộ lọc" : undefined}
              onAction={
                hasFilter
                  ? () => {
                      setSearch("");
                      setCommitted("");
                      setCategoryId(undefined);
                      setInStockOnly(false);
                    }
                  : undefined
              }
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
          />
        }
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        removeClippedSubviews={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: spacing.xxl },
  pressed: { opacity: 0.85 },

  header: { paddingTop: spacing.md },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    minHeight: TOUCH,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 8 },

  chipScroller: { flexGrow: 0, marginTop: spacing.sm, paddingLeft: spacing.md },
  chipRow: { gap: spacing.sm, paddingRight: spacing.md, paddingVertical: 2 },

  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  toolSpacer: { flex: 1 },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  toolActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  toolText: { fontSize: 12.5, fontWeight: "600", color: colors.text },
  toolTextActive: { color: colors.primary },
  countText: { fontSize: 12, color: colors.muted, fontWeight: "600" },

  sortWrap: { marginTop: spacing.md, paddingHorizontal: spacing.md },
  sortLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 6 },
  sortRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  sortActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  sortText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  sortTextActive: { color: colors.primary },

  scope: { fontSize: 12, color: colors.muted, paddingHorizontal: spacing.md, marginTop: spacing.sm, lineHeight: 17 },

  columnWrap: { gap: spacing.sm, paddingHorizontal: spacing.md },
  cell: { flex: 1, marginTop: spacing.sm },

  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  inlineError: { fontSize: 13, color: colors.danger, textAlign: "center", marginBottom: spacing.sm },
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
  more: {
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: "center",
    backgroundColor: colors.surface,
    minHeight: TOUCH,
    justifyContent: "center",
  },
  moreText: { color: colors.primary, fontWeight: "700" },
});
