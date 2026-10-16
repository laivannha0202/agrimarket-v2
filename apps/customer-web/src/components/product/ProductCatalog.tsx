"use client";

/**
 * Catalog — the web twin of the Mobile catalogue screen.
 *
 * Search and the category chips hit the *server* (`search` / `categoryId`
 * query params; a partner page can also arrive with `partnerId`). Sorting and
 * the in-stock toggle are display-only refinements over what has already been
 * loaded, and the screen says so when they are active — the backend exposes no
 * sort parameter, so pretending otherwise would be a lie.
 *
 * Every empty state names the reason (no match for a filter vs. no catalogue).
 */

import { Box, Container, Group, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  IconAdjustments,
  IconArrowDown,
  IconArrowUp,
  IconArrowsUpDown,
  IconLetterCase,
  IconSearch,
  IconSquare,
  IconSquareCheck,
  IconX,
} from "@tabler/icons-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { displayVariant } from "@/lib/product-variant";
import { ProductCard } from "@/components/product/ProductCard";
import { useAddToCart } from "@/components/product/useAddToCart";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { EmptyState, ErrorState, ProductGridSkeleton } from "@/components/common/States";
import { FilterChip, GhostButton, PageTitle } from "@/components/ui/kit";
import { layout } from "@/theme";

const GRID_COLS = { base: 2, xs: 2, sm: 3, md: 4, lg: 5 } as const;
const PAGE_SIZE = 20;

type SortKey = "relevant" | "price-asc" | "price-desc" | "name";

const SORTS: Array<{ key: SortKey; label: string; icon: React.ReactNode }> = [
  { key: "relevant", label: "Liên quan", icon: <IconArrowsUpDown size={13} /> },
  { key: "price-asc", label: "Giá tăng", icon: <IconArrowUp size={13} /> },
  { key: "price-desc", label: "Giá giảm", icon: <IconArrowDown size={13} /> },
  { key: "name", label: "Tên A–Z", icon: <IconLetterCase size={13} /> },
];

export function ProductCatalog({ lockedCategoryId }: { lockedCategoryId?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlSearch = searchParams.get("search") ?? "";
  const urlCategory = searchParams.get("categoryId");
  const urlPartner = searchParams.get("partnerId");

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  // Sync the input when the URL changes (back/forward, header search, links).
  // Adjusting state during render is the documented alternative to a
  // setState-in-effect.
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setSearchInput(urlSearch);
  }

  const categoryId = lockedCategoryId ?? (urlCategory ? Number(urlCategory) : undefined);
  const partnerId = urlPartner ? Number(urlPartner) : undefined;

  const [sort, setSort] = useState<SortKey>("relevant");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const setParam = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  // Push the debounced term into the URL, which drives the query.
  useEffect(() => {
    if (debouncedSearch === urlSearch) return;
    setParam({ search: debouncedSearch || undefined });
  }, [debouncedSearch, urlSearch, setParam]);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories.list(100),
    queryFn: () => resources.listCategories(100),
    staleTime: 5 * 60_000,
  });

  const partnersQuery = useQuery({
    queryKey: queryKeys.partners.list(50),
    queryFn: () => resources.listPartners(50),
    staleTime: 5 * 60_000,
  });

  const list = useInfiniteQuery({
    queryKey: queryKeys.products.list({ search: urlSearch || undefined, categoryId, partnerId }),
    queryFn: ({ pageParam }) =>
      resources.listProducts({
        page: pageParam,
        limit: PAGE_SIZE,
        search: urlSearch || undefined,
        categoryId,
        partnerId,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPageParam < lastPage.meta.totalPages ? lastPageParam + 1 : undefined,
  });

  const { index } = usePromotionIndex();
  const { add, pendingId } = useAddToCart({
    redirectPath: urlSearch ? `/san-pham?search=${encodeURIComponent(urlSearch)}` : "/san-pham",
  });

  const categories = categoriesQuery.data?.data ?? [];
  const activeCategory = categories.find((c) => c.id === categoryId);
  const activePartner = (partnersQuery.data?.data ?? []).find((p) => p.id === partnerId);

  const items = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.data), [list.data]);

  /** Display-only refinement over server-priced data (no price maths here). */
  const visible = useMemo(() => {
    const copy = inStockOnly
      ? items.filter((p) => (p.variants ?? []).some((v) => v.inStock))
      : [...items];
    if (sort === "price-asc")
      copy.sort(
        (a, b) =>
          (displayVariant(a, index)?.price.unitPrice ?? 0) -
          (displayVariant(b, index)?.price.unitPrice ?? 0),
      );
    else if (sort === "price-desc")
      copy.sort(
        (a, b) =>
          (displayVariant(b, index)?.price.unitPrice ?? 0) -
          (displayVariant(a, index)?.price.unitPrice ?? 0),
      );
    else if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return copy;
  }, [items, sort, inStockOnly, index]);

  const total = list.data?.pages[0]?.meta.total ?? items.length;
  const hasFilter = urlSearch !== "" || categoryId !== undefined || partnerId !== undefined || inStockOnly;

  const selectCategory = (id: number | undefined) => {
    if (lockedCategoryId) {
      router.push(id ? `/san-pham?categoryId=${id}` : "/san-pham");
      return;
    }
    setParam({ categoryId: id ? String(id) : undefined });
  };

  const clearAll = () => {
    setSearchInput("");
    setInStockOnly(false);
    setSort("relevant");
    setParam({
      search: undefined,
      partnerId: undefined,
      ...(lockedCategoryId ? {} : { categoryId: undefined }),
    });
  };

  // Auto-load the next page when the sentinel scrolls into view — same
  // behaviour as the Mobile list's `onEndReached`, with the button as fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  useEffect(() => {
    loadMoreRef.current = () => {
      if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
    };
  });
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const isInitialLoading = list.isPending;
  const isEmpty = !isInitialLoading && !list.isError && visible.length === 0;

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>{activeCategory ? activeCategory.name : "Tất cả sản phẩm"}</PageTitle>

      <Stack gap={12} mt={{ base: 0, md: 12 }}>
        {/* Search — a pill exactly like the Mobile catalogue's search row. */}
        <TextInput
          value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          placeholder="Tìm sản phẩm…"
          leftSection={<IconSearch size={18} />}
          rightSection={
            searchInput ? (
              <IconX
                size={18}
                color="var(--agri-muted-soft)"
                style={{ cursor: "pointer" }}
                onClick={() => setSearchInput("")}
                aria-label="Xoá tìm kiếm"
              />
            ) : null
          }
          rightSectionPointerEvents={searchInput ? "auto" : "none"}
          radius={999}
          size="md"
          aria-label="Tìm sản phẩm"
        />

        {/* Category chips: the server filter, so the row reflects real categories. */}
        <Group gap={8} wrap="wrap">
          <FilterChip active={categoryId === undefined} onClick={() => selectCategory(undefined)}>
            Tất cả
          </FilterChip>
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              active={categoryId === category.id}
              onClick={() => selectCategory(category.id)}
            >
              {category.name}
            </FilterChip>
          ))}
        </Group>

        {/* Active partner filter (arrived from a partner page). */}
        {activePartner ? (
          <Group gap={8} wrap="wrap">
            <FilterChip active onClick={() => setParam({ partnerId: undefined })} icon={<IconX size={13} />}>
              {activePartner.name}
            </FilterChip>
          </Group>
        ) : null}

        {/* Tool row: Lọc / Còn hàng / count — identical affordances to Mobile. */}
        <Group gap={8} align="center" wrap="nowrap">
          <FilterChip
            active={showFilters}
            icon={<IconAdjustments size={15} />}
            onClick={() => setShowFilters((value) => !value)}
          >
            Lọc
          </FilterChip>
          <FilterChip
            active={inStockOnly}
            icon={inStockOnly ? <IconSquareCheck size={15} /> : <IconSquare size={15} />}
            onClick={() => setInStockOnly((value) => !value)}
          >
            Còn hàng
          </FilterChip>
          <Box style={{ flex: 1 }} />
          <Text fz={12} fw={600} c="var(--agri-muted)">
            {visible.length}/{total}
          </Text>
        </Group>

        {showFilters ? (
          <Stack gap={6}>
            <Text fz={12} fw={700} c="var(--agri-muted)">
              Sắp xếp
            </Text>
            <Group gap={8} wrap="wrap">
              {SORTS.map((option) => (
                <FilterChip
                  key={option.key}
                  active={sort === option.key}
                  icon={option.icon}
                  onClick={() => setSort(option.key)}
                >
                  {option.label}
                </FilterChip>
              ))}
            </Group>
          </Stack>
        ) : null}

        {/* Be explicit that sorting/stock are applied to what is already loaded:
            the backend has no sort parameter, so "sorted everything" would be false. */}
        {sort !== "relevant" || inStockOnly ? (
          <Text fz={12} c="var(--agri-muted)" style={{ lineHeight: 1.4 }}>
            Áp dụng trên {visible.length} sản phẩm đã tải
            {activeCategory ? ` · ${activeCategory.name}` : ""}
            {urlSearch ? ` · “${urlSearch}”` : ""}.
          </Text>
        ) : null}

        {/* Results */}
        {list.isError && items.length === 0 ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : isInitialLoading ? (
          <ProductGridSkeleton count={10} />
        ) : isEmpty ? (
          <EmptyState
            kind="search"
            title={hasFilter ? "Không tìm thấy sản phẩm" : "Chưa có sản phẩm"}
            description={
              hasFilter
                ? "Thử từ khoá khác hoặc bỏ bộ lọc để xem toàn bộ sản phẩm."
                : "Cửa hàng chưa có sản phẩm nào đang bán."
            }
            action={
              hasFilter ? (
                <GhostButton radius={8} onClick={clearAll} mt={4}>
                  Bỏ bộ lọc
                </GhostButton>
              ) : null
            }
          />
        ) : (
          <>
            <SimpleGrid cols={GRID_COLS} spacing={12} verticalSpacing={12}>
              {visible.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  index={index}
                  onAddToCart={add}
                  addPending={pendingId === product.id}
                />
              ))}
            </SimpleGrid>

            <div ref={sentinelRef} aria-hidden />

            {list.isError && items.length > 0 ? (
              <Text fz={13} c="var(--agri-danger)" ta="center">
                Không tải thêm được sản phẩm.
              </Text>
            ) : null}

            {list.hasNextPage ? (
              <GhostButton
                radius={8}
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage
                  ? "Đang tải…"
                  : `Xem thêm (${items.length}/${total} sản phẩm)`}
              </GhostButton>
            ) : null}
          </>
        )}
      </Stack>
    </Container>
  );
}
