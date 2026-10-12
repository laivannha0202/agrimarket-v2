"use client";

/**
 * Product card for catalog grids.
 *
 * Shows only customer-safe fields: image, name, variant/package, effective
 * price, promotion badge and the partner's short name. No SKU, no lot status,
 * no inventory internals, no warehouse, no commission.
 */

import { Badge, Box, Card, Group, Stack, Text } from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";
import Link from "next/link";
import { ProductImage } from "@/components/common/ProductImage";
import { PriceBlock } from "@/components/common/PriceBlock";
import { formatWeight, shortPartnerName } from "@/lib/format";
import {
  cheapestVariantPrice,
  hasSellableVariant,
  type PromotionIndex,
} from "@/lib/promotions";
import type { Product } from "@/lib/api/types";

export function ProductCard({
  product,
  index,
}: {
  product: Product;
  index?: PromotionIndex;
}) {
  const primaryImage =
    product.images.find((image) => image.isPrimary)?.url ??
    product.images[0]?.url ??
    null;

  const price = cheapestVariantPrice(product.variants, index);
  const soldOut = !hasSellableVariant(product.variants);
  const activeVariants = (product.variants ?? []).filter((v) => v.status === "ACTIVE");
  const cheapestVariant = activeVariants.length
    ? activeVariants.reduce((min, v) => (Number(v.basePrice) < Number(min.basePrice) ? v : min))
    : null;

  /**
   * The card states the quantity the price is quoted for, in the same shape the
   * Mobile card uses ("1 kg / túi"): the weight the backend recorded, then the
   * unit it is sold in. The variant's human name is deliberately not repeated
   * here — it says the same thing ("Túi 1 kg") in different words.
   */
  const packageLabel = cheapestVariant
    ? (() => {
        const weight = formatWeight(cheapestVariant.weight, cheapestVariant.weightUnit);
        if (weight) return `${weight} / ${cheapestVariant.saleUnit}`;
        return cheapestVariant.saleUnit || cheapestVariant.name;
      })()
    : null;

  return (
    <Card
      padding={0}
      radius="md"
      withBorder
      component={Link}
      href={`/san-pham/${product.id}`}
      style={{ overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}
    >
      <Box style={{ position: "relative" }}>
        <ProductImage
          src={primaryImage}
          alt={product.name}
          ratio={1}
          fallbackLabel={product.name}
          sizes="(max-width: 48em) 45vw, 220px"
        />
        {price?.source === "FLASH_SALE" ? (
          <Badge
            color="red"
            variant="filled"
            size="xs"
            radius="sm"
            leftSection={<IconBolt size={11} />}
            style={{ position: "absolute", top: 8, left: 8 }}
          >
            Flash Sale
          </Badge>
        ) : null}
        {soldOut ? (
          <Badge
            color="gray"
            variant="filled"
            size="xs"
            radius="sm"
            style={{ position: "absolute", top: 8, right: 8 }}
          >
            Hết hàng
          </Badge>
        ) : null}
      </Box>

      <Stack gap={6} p="sm" style={{ flex: 1 }}>
        <Text size="sm" fw={600} className="agri-clamp-2" style={{ minHeight: "2.6em" }}>
          {product.name}
        </Text>

        {packageLabel ? (
          <Text size="xs" c="dimmed">
            {packageLabel}
          </Text>
        ) : null}

        <Box style={{ marginTop: "auto" }}>
          <PriceBlock price={price} align="flex-start" />
        </Box>

        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="dimmed" truncate>
            {shortPartnerName(product.partner.name)}
          </Text>
        </Group>
      </Stack>
    </Card>
  );
}
