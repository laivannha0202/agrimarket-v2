"use client";

/**
 * Homepage product sections.
 *
 * Both sections are built from real API data:
 *   - "Sản phẩm đang giảm giá"  = products with a REAL discount on an ACTIVE
 *     variant (`effectivePrice.unitPrice < basePrice`, shared rule
 *     `isProductOnSale`). The backend resolves that price, so the section
 *     needs no client-side join against the promotion endpoints.
 *   - "Sản phẩm nổi bật"        = the newest products the catalog returns.
 *
 * NO PRODUCT APPEARS TWICE ON THE HOMEPAGE
 *
 * The Flash Sale block at the top of the page already shows the flash-sale
 * items, and the discounted block would otherwise repeat those same products
 * right underneath, with the featured block repeating them a third time. Each
 * section therefore excludes everything an earlier section already showed, so
 * every slot on the homepage introduces a product the customer has not seen yet
 * on that page. The catalogue itself is unchanged — `/san-pham` still lists
 * every product exactly once.
 */

import { useMemo } from "react";
import { SimpleGrid, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { isProductOnSale, partitionHomeProducts } from "@agrimarket/shared-domain/home";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { ProductCard } from "@/components/product/ProductCard";
import { useAddToCart } from "@/components/product/useAddToCart";
import { SectionHeader } from "@/components/ui/kit";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { ProductGridSkeleton, ErrorState, EmptyState } from "@/components/common/States";

const GRID_COLS = { base: 2, xs: 2, sm: 3, md: 4, lg: 5 } as const;

/** How many cards each section shows. Keeps the homepage a sane length. */
const DISCOUNTED_LIMIT = 5;
const FEATURED_LIMIT = 8;

function useCatalogProducts() {
  return useQuery({
    queryKey: queryKeys.products.list({ page: 1, limit: 100 }),
    queryFn: () => resources.listProducts({ page: 1, limit: 100 }),
    staleTime: 60_000,
  });
}

/**
 * The catalogue split into the homepage's sections, de-duplicated.
 *
 * `flashSaleProductIds` comes from the flash-sale block that is rendered above
 * these sections; passing the ids it displayed is what removes the overlap.
 */
function useHomeSections(flashSaleProductIds: ReadonlySet<number>) {
  const productsQuery = useCatalogProducts();
  const { index } = usePromotionIndex();
  const cart = useAddToCart();

  const sections = useMemo(() => {
    const products = productsQuery.data?.data ?? [];

    // Section rules (dedup by product ID, "sale" means a REAL discount on an
    // ACTIVE variant) live in `@agrimarket/shared-domain` so the Mobile home
    // tab picks the exact same products.
    return partitionHomeProducts(products, {
      getId: (product) => product.id,
      excludeIds: flashSaleProductIds,
      isDiscounted: isProductOnSale,
      discountedLimit: DISCOUNTED_LIMIT,
      featuredLimit: FEATURED_LIMIT,
    });
  }, [productsQuery.data, flashSaleProductIds]);

  return { ...sections, index, productsQuery, cart };
}

export function DiscountedProductsSection({
  flashSaleProductIds,
}: {
  flashSaleProductIds: ReadonlySet<number>;
}) {
  const { discounted, index, productsQuery, cart } = useHomeSections(flashSaleProductIds);

  if (productsQuery.isError) {
    return (
      <Stack gap={8}>
        <SectionHeader title="Sản phẩm đang giảm giá" href="/san-pham" />
        <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
      </Stack>
    );
  }

  if (productsQuery.isLoading) {
    return (
      <Stack gap={8}>
        <SectionHeader title="Sản phẩm đang giảm giá" href="/san-pham" />
        <ProductGridSkeleton count={DISCOUNTED_LIMIT} />
      </Stack>
    );
  }

  if (discounted.length === 0) return null;

  return (
    <Stack gap="md">
      <SectionHeader title="Sản phẩm đang giảm giá" href="/san-pham" />
      <SimpleGrid cols={GRID_COLS} spacing={12}>
        {discounted.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            index={index}
            onAddToCart={cart.add}
            addPending={cart.pendingId === product.id}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function FeaturedProductsSection({
  flashSaleProductIds,
}: {
  flashSaleProductIds: ReadonlySet<number>;
}) {
  const { featured, index, productsQuery, cart } = useHomeSections(flashSaleProductIds);

  if (productsQuery.isError) {
    return (
      <Stack gap={8}>
        <SectionHeader title="Sản phẩm nổi bật" href="/san-pham" />
        <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
      </Stack>
    );
  }

  if (productsQuery.isLoading) {
    return (
      <Stack gap={8}>
        <SectionHeader title="Sản phẩm nổi bật" href="/san-pham" />
        <ProductGridSkeleton count={FEATURED_LIMIT} />
      </Stack>
    );
  }

  if (featured.length === 0) {
    return (
      <Stack gap={8}>
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
      <SimpleGrid cols={GRID_COLS} spacing={12}>
        {featured.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            index={index}
            onAddToCart={cart.add}
            addPending={cart.pendingId === product.id}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
