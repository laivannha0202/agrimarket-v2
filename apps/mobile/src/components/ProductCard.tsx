/**
 * Product card — the one card used by Home, Catalog and any product strip.
 *
 * `grid` = 2-up column (catalogue/home), `row` = list row (1-column fallback).
 * Both variants show the same information so the catalogue never reflows when
 * the viewport crosses the 2-column breakpoint.
 *
 * PRICING: `effectivePrice` is the server's answer (flash sale > product
 * discount > base price). The card only *selects* and *formats* it; it never
 * recomputes a price or a stock level.
 */

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { discountPercent, formatMoney, formatQuantity, formatWeight } from "../lib/format";
import { displayVariant, isSoldOut } from "../lib/product-variant";
import { primaryImage, resolveImageUrl } from "../lib/promotions";
import { colors, elevation, productNameLineHeight, radius, spacing, TOUCH } from "../lib/theme";
import type { Product } from "../lib/types";
import { LinkPress, ProductThumb } from "./ui";

/** "1 kg / cây" or "500 g / túi" — the weight the price is quoted for. */
function specLabel(product: Product): string | null {
  const v = displayVariant(product);
  if (!v) return null;
  const weight = formatWeight(v.weight, v.weightUnit);
  if (weight) return `${weight} / ${v.saleUnit}`;
  return v.saleUnit;
}

export function ProductCard({
  product,
  layout = "grid",
  onAddToCart,
  addDisabled = false,
}: {
  product: Product;
  layout?: "grid" | "row";
  /** Omitted -> no cart affordance is rendered (never a dead button). */
  onAddToCart?: (product: Product) => void;
  addDisabled?: boolean;
}) {
  const variant = displayVariant(product);
  const price = variant?.effectivePrice ?? null;
  const image = resolveImageUrl(primaryImage(product));
  const pct = price ? discountPercent(price.basePrice, price.unitPrice) : null;
  const soldOut = isSoldOut(product);
  const spec = specLabel(product);
  const isGrid = layout === "grid";
  const hasCart = Boolean(onAddToCart) && !soldOut;

  const body = (
    <>
      <View style={isGrid ? styles.gridImage : styles.rowImage}>
        <ProductThumb uri={image} size={isGrid ? undefined : 76} fill={isGrid} />
        {pct !== null ? (
          <View style={styles.pctBadge}>
            <Text style={styles.pctBadgeText}>-{pct}%</Text>
          </View>
        ) : null}
        {soldOut ? (
          <View style={styles.soldOutOverlay}>
            <Text style={styles.soldOutText}>Hết hàng</Text>
          </View>
        ) : null}
      </View>

      <View style={[isGrid ? styles.gridBody : styles.rowBody, hasCart && isGrid && styles.bodyWithCart]}>
        <Text style={isGrid ? styles.nameGrid : styles.nameRow} numberOfLines={2}>
          {product.name}
        </Text>
        {spec ? (
          <Text style={styles.spec} numberOfLines={1}>
            {spec}
          </Text>
        ) : null}
        {price ? (
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatMoney(price.unitPrice)}</Text>
            {pct !== null ? <Text style={styles.wasPrice}>{formatMoney(price.basePrice)}</Text> : null}
          </View>
        ) : (
          <Text style={styles.contact}>Liên hệ</Text>
        )}
        {isGrid ? (
          <Text style={styles.partner} numberOfLines={1}>
            {product.partner.name}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    // The cart control is a SIBLING of the card link, never a child: nesting a
    // pressable inside a pressable renders `<button>` inside `<button>` on
    // React Native Web (invalid HTML, flagged in the console) and makes the two
    // tap targets fight over the same touch on native.
    <View style={[styles.card, isGrid ? styles.cardGrid : styles.cardRow]}>
      <LinkPress
        href={{ pathname: "/product/[id]", params: { id: String(product.id) } }}
        accessibilityLabel={`${product.name}${price ? `, ${formatMoney(price.unitPrice)}` : ""}${
          variant && !soldOut ? `, còn ${formatQuantity(variant.availableQuantity, variant.saleUnit)}` : ""
        }`}
        style={({ pressed }) => [isGrid ? styles.linkGrid : styles.linkRow, pressed && styles.cardPressed]}
      >
        {body}
      </LinkPress>

      {hasCart ? (
        <Pressable
          onPress={() => onAddToCart?.(product)}
          disabled={addDisabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Thêm ${product.name} vào giỏ`}
          style={({ pressed }) => [
            isGrid ? styles.cartBtnGrid : styles.cartBtnRow,
            addDisabled && styles.disabled,
            pressed && !addDisabled && styles.pressed,
          ]}
        >
          <Ionicons name="cart-outline" size={17} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    ...elevation.card,
  },
  cardGrid: { flex: 1 },
  cardRow: { flexDirection: "row", padding: spacing.sm, gap: spacing.sm, marginBottom: spacing.sm },
  cardPressed: { opacity: 0.92 },
  // The link fills the card and owns the inner layout; the card frame stays on
  // the outer View so the cart button can sit beside it instead of inside it.
  linkGrid: { flex: 1 },
  linkRow: { flex: 1, flexDirection: "row", gap: spacing.sm },

  gridImage: { width: "100%", aspectRatio: 1, backgroundColor: colors.primarySoft },
  rowImage: { width: 76, height: 76, borderRadius: radius.sm, overflow: "hidden" },
  gridBody: { padding: spacing.sm, paddingBottom: spacing.sm + 2, gap: 2 },
  rowBody: { flex: 1, gap: 2, justifyContent: "center", paddingRight: spacing.sm },
  // Reserve the button's footprint so a long partner name can't run underneath
  // it (the button is absolutely positioned in the grid layout).
  bodyWithCart: { paddingRight: 34 + spacing.sm * 2 },

  // Explicit line boxes: the Vietnamese diacritics need the extra leading, and
  // fixing the height keeps every grid cell identical (no ragged 2-up rows).
  nameGrid: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: productNameLineHeight.grid },
  nameRow: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: productNameLineHeight.row },
  spec: { fontSize: 12, color: colors.muted },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginTop: 2 },
  price: { fontSize: 15, fontWeight: "700", color: colors.primary },
  wasPrice: { fontSize: 12, color: colors.mutedSoft, textDecorationLine: "line-through" },
  contact: { fontSize: 14, fontWeight: "600", color: colors.muted, marginTop: 2 },
  partner: { fontSize: 11, color: colors.mutedSoft, marginTop: 1 },

  pctBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pctBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  soldOutOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  soldOutText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.danger,
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },

  // 34px visual button. `hitSlop={8}` on the Pressable widens the *touch* area
  // to 50x50, which clears the 44px minimum without making the button visually
  // oversized next to the mockup's compact icon.
  cartBtnGrid: {
    position: "absolute",
    right: spacing.sm,
    bottom: spacing.sm,
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  cartBtnRow: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
