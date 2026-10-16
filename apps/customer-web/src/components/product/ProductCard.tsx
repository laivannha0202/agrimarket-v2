"use client";

/**
 * Product card for catalog grids — the web twin of the Mobile `ProductCard`
 * (grid variant): square photo, "-x%" pill, sold-out overlay, name on two
 * lines, package spec, effective price + struck-through original, partner name
 * and an optional quick add-to-cart button.
 *
 * PRICING: the card only *selects* the variant the server priced (see
 * `displayVariant`) and formats it; it never recomputes a price or stock level.
 *
 * The cart control is a SIBLING of the card link, never a child: nesting a
 * button inside a link is invalid HTML and makes the two tap targets fight over
 * the same click.
 */

import { Box, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconShoppingCart } from "@tabler/icons-react";
import Link from "next/link";
import { ProductImage } from "@/components/common/ProductImage";
import { AppCard } from "@/components/ui/kit";
import { discountPercent, formatMoney, formatWeight, shortPartnerName } from "@/lib/format";
import { displayVariant } from "@/lib/product-variant";
import type { PromotionIndex } from "@/lib/promotions";
import type { Product } from "@/lib/api/types";

export function ProductCard({
  product,
  index,
  onAddToCart,
  addPending = false,
}: {
  product: Product;
  index?: PromotionIndex;
  /** Omitted -> no cart affordance is rendered (never a dead button). */
  onAddToCart?: (product: Product) => void;
  addPending?: boolean;
}) {
  const primaryImage =
    product.images.find((image) => image.isPrimary)?.url ??
    product.images[0]?.url ??
    null;

  const displayed = displayVariant(product, index);
  const price = displayed?.price ?? null;
  const soldOut = displayed !== null && !displayed.variant.inStock;
  const hasCart = Boolean(onAddToCart) && !soldOut;

  /**
   * "1 kg / túi" — the weight the backend recorded, then the unit the price is
   * quoted for. The variant's human name is deliberately not repeated: it says
   * the same thing in different words.
   */
  const packageLabel = displayed
    ? (() => {
        const weight = formatWeight(displayed.variant.weight, displayed.variant.weightUnit);
        if (weight) return `${weight} / ${displayed.variant.saleUnit}`;
        return displayed.variant.saleUnit || displayed.variant.name;
      })()
    : null;

  const percent = price ? discountPercent(price.basePrice, price.unitPrice) : null;

  return (
    <AppCard
      padding={0}
      style={{
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxShadow: "0 2px 6px rgba(15, 18, 15, 0.04)",
      }}
    >
      <UnstyledButton
        component={Link}
        href={`/san-pham/${product.id}`}
        className="agri-press"
        aria-label={`${product.name}${price ? `, ${formatMoney(price.unitPrice)}` : ""}`}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          textAlign: "left",
          color: "var(--agri-text)",
        }}
      >
        <Box style={{ position: "relative" }}>
          <ProductImage
            src={primaryImage}
            alt={product.name}
            ratio={1}
            sizes="(max-width: 48em) 45vw, 220px"
          />
          {percent !== null && percent > 0 ? (
            <Box
              component="span"
              style={{
                position: "absolute",
                top: 6,
                left: 6,
                background: "var(--agri-danger)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 8,
                padding: "2px 6px",
                lineHeight: "15px",
              }}
            >
              -{percent}%
            </Box>
          ) : null}
          {soldOut ? (
            <Box
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(255, 255, 255, 0.72)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Text
                fz={13}
                fw={700}
                style={{
                  color: "var(--agri-danger)",
                  background: "var(--agri-surface)",
                  border: "1px solid var(--agri-danger)",
                  borderRadius: 8,
                  padding: "4px 10px",
                  lineHeight: "17px",
                }}
              >
                Hết hàng
              </Text>
            </Box>
          ) : null}
        </Box>

        <Stack
          gap={2}
          p={10}
          pe={hasCart ? 50 : undefined}
          style={{ flex: 1 }}
        >
          <Text fz={14} fw={600} lineClamp={2} lh="18px" mih={36}>
            {product.name}
          </Text>

          {packageLabel ? (
            <Text fz={12} c="var(--agri-muted)" lineClamp={1}>
              {packageLabel}
            </Text>
          ) : (
            <Box h={16} />
          )}

          <Box style={{ marginTop: "auto", paddingTop: 2 }}>
            {price ? (
              <Group gap={6} align="baseline" wrap="wrap">
                <Text fz={15} fw={700} c="agri.9" style={{ whiteSpace: "nowrap", lineHeight: 1.2 }}>
                  {formatMoney(price.unitPrice)}
                </Text>
                {percent !== null && percent > 0 ? (
                  <Text
                    fz={12}
                    c="var(--agri-muted-soft)"
                    td="line-through"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {formatMoney(price.basePrice)}
                  </Text>
                ) : null}
              </Group>
            ) : (
              <Text fz={14} fw={600} c="var(--agri-muted)">
                Liên hệ
              </Text>
            )}
          </Box>

          <Text fz={11} c="var(--agri-muted-soft)" truncate style={{ marginTop: 1 }}>
            {shortPartnerName(product.partner.name)}
          </Text>
        </Stack>
      </UnstyledButton>

      {hasCart ? (
        <UnstyledButton
          aria-label={`Thêm ${product.name} vào giỏ`}
          aria-busy={addPending || undefined}
          onClick={() => onAddToCart?.(product)}
          disabled={addPending}
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            width: 34,
            height: 34,
            borderRadius: 8,
            background: "var(--agri-primary)",
            color: "#ffffff",
            display: "grid",
            placeItems: "center",
            opacity: addPending ? 0.6 : 1,
          }}
        >
          {addPending ? (
            <Loader size={16} color="#fff" />
          ) : (
            <IconShoppingCart size={17} aria-hidden />
          )}
        </UnstyledButton>
      ) : null}
    </AppCard>
  );
}
