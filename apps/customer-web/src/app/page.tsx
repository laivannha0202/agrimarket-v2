"use client";

/**
 * Homepage.
 *
 * Deliberately short: hero -> categories -> flash sale -> discounted products
 * -> featured products -> farms -> traceability CTA. Every product, price,
 * promotion and farm below the hero comes from the API. When an endpoint fails
 * the section shows an error state; nothing is back-filled with fake data.
 */

import { Container, Stack } from "@mantine/core";
import { Hero } from "@/components/home/Hero";
import { CategoryStrip } from "@/components/home/CategoryStrip";
import { FlashSaleSection } from "@/components/home/FlashSaleSection";
import {
  DiscountedProductsSection,
  FeaturedProductsSection,
} from "@/components/home/ProductSections";
import { FarmsSection, TraceCta } from "@/components/home/FarmsSection";
import { layout } from "@/theme";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }}>
        <Stack gap={40} py={{ base: 24, sm: 36 }}>
          <CategoryStrip />
          <FlashSaleSection />
          <DiscountedProductsSection />
          <FeaturedProductsSection />
          <FarmsSection />
        </Stack>
      </Container>
      <TraceCta />
    </>
  );
}
