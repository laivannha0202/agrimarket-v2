"use client";

/**
 * Catalog with search + real filters.
 *
 * Only filters the backend actually accepts are sent:
 *   GET /products?page&limit&search&categoryId&partnerId&status
 *
 * There is deliberately NO price-range filter, NO sort selector and NO farm
 * filter: the backend rejects unknown query params (`forbidNonWhitelisted`) and
 * has no `sort` field, so adding them would mean inventing contract. Sorting a
 * single server-paginated page client-side would also be misleading, so it is
 * reported as a blocker instead.
 */

import {
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Container,
  Divider,
  Drawer,
  Group,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { ProductCard } from "@/components/product/ProductCard";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { EmptyState, ErrorState, ProductGridSkeleton } from "@/components/common/States";
import { layout } from "@/theme";

const GRID_COLS = { base: 2, xs: 2, sm: 3, md: 4, lg: 5 } as const;
const PAGE_SIZE = 20;

export function ProductCatalog({ lockedCategoryId }: { lockedCategoryId?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filtersOpened, filters] = useDisclosure(false);

  const urlSearch = searchParams.get("search") ?? "";
  const urlCategory = searchParams.get("categoryId");
  const urlPartner = searchParams.get("partnerId");
  const urlPage = Number(searchParams.get("page") ?? "1");

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  // Sync the input when the URL changes (back/forward, header search). Adjusting
  // state during render is the documented alternative to a setState-in-effect.
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setSearchInput(urlSearch);
  }

  const categoryId = lockedCategoryId ?? (urlCategory ? Number(urlCategory) : undefined);
  const partnerId = urlPartner ? Number(urlPartner) : undefined;
  const page = Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1;

  const setParam = useCallback(
    (updates: Record<string, string | undefined>, resetPage = true) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete("page");
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

  const params = useMemo(
    () => ({ page, limit: PAGE_SIZE, search: urlSearch || undefined, categoryId, partnerId }),
    [page, urlSearch, categoryId, partnerId],
  );

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: () => resources.listProducts(params),
    placeholderData: (previous) => previous,
  });

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

  const { index } = usePromotionIndex();

  const categories = categoriesQuery.data?.data ?? [];
  const partners = partnersQuery.data?.data ?? [];
  const activeCategory = categories.find((c) => c.id === categoryId);
  const activePartner = partners.find((p) => p.id === partnerId);
  const hasFilters = Boolean(categoryId || partnerId);

  const clearAll = () => {
    setSearchInput("");
    router.replace("?", { scroll: false });
  };

  const filterPanel = (
    <Stack gap="md">
      <Select
        label="Danh mục"
        placeholder="Tất cả danh mục"
        clearable
        data={categories.map((c) => ({ value: String(c.id), label: c.name }))}
        value={categoryId ? String(categoryId) : null}
        onChange={(value) => setParam({ categoryId: value ?? undefined })}
        disabled={Boolean(lockedCategoryId)}
      />
      <Select
        label="Đối tác cung cấp"
        placeholder="Tất cả đối tác"
        clearable
        searchable
        data={partners.map((p) => ({ value: String(p.id), label: p.name }))}
        value={partnerId ? String(partnerId) : null}
        onChange={(value) => setParam({ partnerId: value ?? undefined })}
      />
      <Divider />
      {hasFilters || urlSearch ? (
        <Button variant="default" leftSection={<IconX size={16} />} onClick={clearAll}>
          Xóa bộ lọc
        </Button>
      ) : null}
    </Stack>
  );

  const total = productsQuery.data?.meta.total ?? 0;
  const totalPages = productsQuery.data?.meta.totalPages ?? 0;
  const products = productsQuery.data?.data ?? [];

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          {activeCategory ? (
            <Text size="sm" c="dimmed">
              {activeCategory.name}
            </Text>
          ) : (
            <Text size="sm">Sản phẩm</Text>
          )}
        </Breadcrumbs>

        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Title order={2}>{activeCategory ? activeCategory.name : "Tất cả sản phẩm"}</Title>
            <Text size="sm" c="dimmed">
              {productsQuery.isSuccess
                ? `${total} sản phẩm`
                : "Đang tải danh mục sản phẩm…"}
            </Text>
          </Stack>

          <Group gap="sm" wrap="nowrap" style={{ flex: 1, maxWidth: 460 }}>
            <TextInput
              value={searchInput}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              placeholder="Tìm theo tên sản phẩm"
              leftSection={<IconSearch size={16} />}
              rightSection={
                searchInput ? (
                  <IconX
                    size={16}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSearchInput("")}
                    aria-label="Xóa từ khóa"
                  />
                ) : null
              }
              aria-label="Tìm kiếm sản phẩm"
              style={{ flex: 1 }}
            />
            <Button
              variant="default"
              leftSection={<IconFilter size={16} />}
              onClick={filters.open}
              hiddenFrom="md"
            >
              Lọc
            </Button>
          </Group>
        </Group>

        {(activeCategory || activePartner || urlSearch) && (
          <Group gap="xs" wrap="wrap">
            {activeCategory ? (
              <Badge
                variant="light"
                color="agri"
                size="lg"
                rightSection={
                  lockedCategoryId ? null : (
                    <IconX
                      size={13}
                      style={{ cursor: "pointer" }}
                      onClick={() => setParam({ categoryId: undefined })}
                      aria-label="Bỏ lọc danh mục"
                    />
                  )
                }
              >
                {activeCategory.name}
              </Badge>
            ) : null}
            {activePartner ? (
              <Badge
                variant="light"
                color="gray"
                size="lg"
                rightSection={
                  <IconX
                    size={13}
                    style={{ cursor: "pointer" }}
                    onClick={() => setParam({ partnerId: undefined })}
                    aria-label="Bỏ lọc đối tác"
                  />
                }
              >
                {activePartner.name}
              </Badge>
            ) : null}
            {urlSearch ? (
              <Badge
                variant="light"
                color="gray"
                size="lg"
                rightSection={
                  <IconX
                    size={13}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSearchInput("")}
                    aria-label="Bỏ từ khóa"
                  />
                }
              >
                “{urlSearch}”
              </Badge>
            ) : null}
          </Group>
        )}

        <Group align="flex-start" gap="xl" wrap="nowrap">
          <Box w={230} visibleFrom="md" style={{ flexShrink: 0 }}>
            <Stack gap="sm">
              <Text fw={700}>Bộ lọc</Text>
              {filterPanel}
            </Stack>
          </Box>

          <Box style={{ flex: 1, minWidth: 0 }}>
            {productsQuery.isError ? (
              <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
            ) : productsQuery.isLoading ? (
              <ProductGridSkeleton count={10} />
            ) : products.length === 0 ? (
              <EmptyState
                title="Không tìm thấy sản phẩm phù hợp"
                description={
                  urlSearch
                    ? `Không có nông sản nào khớp với “${urlSearch}”. Thử từ khóa khác hoặc bỏ bộ lọc.`
                    : "Chưa có sản phẩm trong mục này."
                }
                action={
                  hasFilters || urlSearch ? (
                    <Button variant="default" onClick={clearAll}>
                      Xóa bộ lọc
                    </Button>
                  ) : null
                }
              />
            ) : (
              <Stack gap="lg">
                <SimpleGrid cols={GRID_COLS} spacing="md">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} index={index} />
                  ))}
                </SimpleGrid>

                {totalPages > 1 ? (
                  <Group justify="center">
                    <Pagination
                      total={totalPages}
                      value={page}
                      onChange={(value) => {
                        setParam({ page: String(value) }, false);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    />
                  </Group>
                ) : null}
              </Stack>
            )}
          </Box>
        </Group>
      </Stack>

      <Drawer opened={filtersOpened} onClose={filters.close} title="Bộ lọc" size="xs">
        {filterPanel}
      </Drawer>
    </Container>
  );
}
