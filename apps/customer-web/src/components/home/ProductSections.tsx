"use client";

/**
 * Homepage product sections.
 *
 * Both sections are built from real API data:
 *   - "Sản phẩm đang giảm giá"  = products whose catalog `effectivePrice`
 *     reports a real promotion (`PRODUCT_DISCOUNT` or `FLASH_SALE`). The
 *     backend resolves that price, so the section needs no client-side join
 *     against the promotion endpoints.
 *   - "Sản phẩm nổi bật"        = the newest products the catalog returns
 */

import { SimpleGrid, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeader } from "@/components/home/FlashSaleSection";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { ProductGridSkeleton, ErrorState, EmptyState } from "@/components/common/States";

const GRID_COLS = { base: 2, xs: 2, sm: 3, md: 4, lg: 5 } as const;

function useCatalogProducts() {
  return useQuery({
    queryKey: queryKeys.products.list({ page: 1, limit: 100 }),
    queryFn: () => resources.listProducts({ page: 1, limit: 100 }),
    staleTime: 60_000,
  });
}

export function DiscountedProductsSection() {
  const productsQuery = useCatalogProducts();
  const { index } = usePromotionIndex();

  if (productsQuery.isError) {
    return (
      <Stack gap="md">
        <SectionHeader title="Sản phẩm đang giảm giá" href="/san-pham" />
        <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
      </Stack>
    );
  }

  if (productsQuery.isLoading) {
    return (
      <Stack gap="md">
        <SectionHeader title="Sản phẩm đang giảm giá" href="/san-pham" />
        <ProductGridSkeleton count={5} />
      </Stack>
    );
  }

  const products = productsQuery.data?.data ?? [];
  const discounted = products
    .filter((product) =>
      (product.variants ?? []).some(
        (variant) =>
          variant.status === "ACTIVE" && variant.effectivePrice?.source !== "NONE",
      ),
    )
    .slice(0, 10);

  if (discounted.length === 0) return null;

  return (
    <Stack gap="md">
      <SectionHeader title="Sản phẩm đang giảm giá" href="/san-pham" />
      <SimpleGrid cols={GRID_COLS} spacing="md">
        {discounted.map((product) => (
          <ProductCard key={product.id} product={product} index={index} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function FeaturedProductsSection() {
  const productsQuery = useCatalogProducts();

  if (productsQuery.isError) {
    return (
      <Stack gap="md">
        <SectionHeader title="Sản phẩm nổi bật" href="/san-pham" />
        <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
      </Stack>
    );
  }

  if (productsQuery.isLoading) {
    return (
      <Stack gap="md">
        <SectionHeader title="Sản phẩm nổi bật" href="/san-pham" />
        <ProductGridSkeleton count={5} />
      </Stack>
    );
  }

  const products = (productsQuery.data?.data ?? []).slice(0, 10);

  if (products.length === 0) {
    return (
      <Stack gap="md">
        <SectionHeader title="Sản phẩm nổi bật" href="/san-pham" />
        <EmptyState
          title="Chưa có sản phẩm nào"
          description="Danh mục nông sản sẽ hiển thị ngay khi đối tác đăng bán."
        />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <SectionHeader title="Sản phẩm nổi bật" href="/san-pham" />
      <SimpleGrid cols={GRID_COLS} spacing="md">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} index={undefined} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
