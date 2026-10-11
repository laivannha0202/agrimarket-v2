/**
 * Variant selection.
 *
 * The card prints one variant's price and its cart button adds a variant; the
 * product page opens on a variant. If those disagree, the customer is charged
 * for something they never saw — so the rule is pinned here.
 *
 * These tests only assert *selection*. No price, discount or stock is ever
 * derived on the client.
 */

import { describe, expect, it } from "vitest";
import { displayVariant, isSoldOut } from "../product-variant";

function variant(id: number, unitPrice: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "ACTIVE",
    inStock: true,
    effectivePrice: { basePrice: unitPrice, unitPrice, discountAmount: 0, source: "NONE" },
    ...overrides,
  };
}

describe("displayVariant", () => {
  it("picks the cheapest sellable variant so the headline price is the one shown", () => {
    const product = { variants: [variant(1, 20000), variant(2, 12000)] } as never;
    expect(displayVariant(product)?.id).toBe(2);
  });

  it("ignores an INACTIVE variant even when it is cheaper", () => {
    // Otherwise the card would advertise a price the customer cannot buy.
    const product = { variants: [variant(1, 20000), variant(2, 1000, { status: "INACTIVE" })] } as never;
    expect(displayVariant(product)?.id).toBe(1);
  });

  it("still shows a price when every variant is INACTIVE (no invented number)", () => {
    const product = { variants: [variant(1, 20000, { status: "INACTIVE" })] } as never;
    expect(displayVariant(product)?.id).toBe(1);
  });

  it("returns null for a product with no variants instead of a fake price", () => {
    expect(displayVariant({ variants: [] } as never)).toBeNull();
  });
});

describe("isSoldOut", () => {
  it("is true when the variant on display has no stock", () => {
    expect(isSoldOut({ variants: [variant(1, 12000, { inStock: false })] } as never)).toBe(true);
  });

  it("is false when the displayed variant is in stock", () => {
    expect(isSoldOut({ variants: [variant(1, 12000)] } as never)).toBe(false);
  });

  it("prefers a cheaper in-stock variant over a pricier sold-out one", () => {
    // The card headlines the in-stock variant, so it must not read as sold out.
    const product = {
      variants: [variant(1, 5000, { inStock: false }), variant(2, 12000)],
    } as never;
    expect(displayVariant(product)?.id).toBe(2);
    expect(isSoldOut(product)).toBe(false);
  });

  it("is false when there is no variant at all (nothing to sell out)", () => {
    expect(isSoldOut({ variants: [] } as never)).toBe(false);
  });

  it("is true only when nothing on the card can be bought", () => {
    // Every ACTIVE variant is out of stock -> the card must say so, and its
    // add button must be hidden, rather than offering an unbuyable variant.
    const product = {
      variants: [variant(1, 12000, { inStock: false }), variant(2, 18000, { inStock: false })],
    } as never;
    expect(isSoldOut(product)).toBe(true);
    expect(displayVariant(product)?.id).toBe(1);
  });
});
