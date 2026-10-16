"use client";

/**
 * Homepage — laid out exactly like the Mobile home tab:
 * brand hero -> categories -> Flash Sale -> featured products -> discounted
 * products -> farms -> traceability CTA.
 *
 * Every product, price, promotion and farm below the hero comes from the API.
 * When an endpoint fails the section shows an error state; nothing is
 * back-filled with fake data.
 *
 * The flash-sale block is the first place products appear, so the ids it shows
 * are collected here and handed to the sections underneath: no product is
 * listed twice on the same page.
 */

import { useMemo } from "react";
import { Container, Stack } from "@mantine/core";
import { Hero } from "@/components/home/Hero";
import { CategoryStrip } from "@/components/home/CategoryStrip";
import { FlashSaleSection, useActiveFlashSales } from "@/components/home/FlashSaleSection";
import {
  DiscountedProductsSection,
  FeaturedProductsSection,
} from "@/components/home/ProductSections";
import { FarmsSection, TraceCta } from "@/components/home/FarmsSection";
import { layout } from "@/theme";

export default function HomePage() {
  const { sales } = useActiveFlashSales();

  // Product ids already displayed in the flash-sale block above.
  const flashSaleProductIds = useMemo(
    () =>
      new Set(
        sales.flatMap((sale) => sale.items.map((item) => item.productVariant.productId)),
      ),
    [sales],
  );

  return (
    <>
      <Hero />
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }}>
        <Stack gap={18} py={{ base: 14, sm: 24 }}>
          <CategoryStrip />
          <FlashSaleSection />
          <FeaturedProductsSection flashSaleProductIds={flashSaleProductIds} />
          <DiscountedProductsSection flashSaleProductIds={flashSaleProductIds} />
          <FarmsSection />
        </Stack>
      </Container>
      <TraceCta />
    </>
  );
}
