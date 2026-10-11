/**
 * Tests for the pure mapping from backend data to UI Kit artwork keys.
 *
 * These are the rules that keep the artwork honest, so they are pinned here:
 * a slug the kit has no glyph for must map to `null` (text-only chip) rather
 * than borrowing another category's picture, and a filtered-to-nothing list
 * must be a "search" empty state rather than a "cart"/"orders" one.
 */

import { describe, expect, it } from "vitest";
import { CATEGORY_ICON_SLUGS, categoryIconKey, emptyStateKind } from "../design-asset-keys";

describe("categoryIconKey", () => {
  it("maps the four slugs the kit ships a glyph for", () => {
    expect(categoryIconKey("rau-an-la")).toBe("rau-an-la");
    expect(categoryIconKey("trai-cay")).toBe("trai-cay");
    expect(categoryIconKey("cu-qua")).toBe("cu-qua");
    expect(categoryIconKey("gao-ngu-coc")).toBe("gao-ngu-coc");
  });

  it("exposes exactly four slugs (adding one requires adding an asset)", () => {
    expect(CATEGORY_ICON_SLUGS).toHaveLength(4);
    expect(new Set(CATEGORY_ICON_SLUGS).size).toBe(4);
  });

  it("normalises case and surrounding whitespace", () => {
    expect(categoryIconKey("  TRAI-CAY  ")).toBe("trai-cay");
    expect(categoryIconKey("Rau-An-La")).toBe("rau-an-la");
  });

  it("returns null for a real category the kit has no glyph for", () => {
    // "Rau ăn quả" (id 12) is a real backend category with no matching asset.
    // Substituting "rau-an-la" or "cu-qua" here would mislabel the category.
    expect(categoryIconKey("rau-an-qua")).toBeNull();
  });

  it("returns null for missing / non-string input instead of throwing", () => {
    expect(categoryIconKey(null)).toBeNull();
    expect(categoryIconKey(undefined)).toBeNull();
    expect(categoryIconKey("")).toBeNull();
    expect(categoryIconKey("   ")).toBeNull();
    // Guards against a caller passing a number through `String(...)`.
    expect(categoryIconKey(42 as unknown as string)).toBeNull();
  });

  it("does not match a slug that merely contains a known one", () => {
    expect(categoryIconKey("rau-an-la-khac")).toBeNull();
    expect(categoryIconKey("x-trai-cay")).toBeNull();
  });
});

describe("emptyStateKind", () => {
  it("uses the list's own graphic when nothing is filtered", () => {
    expect(emptyStateKind({ listKind: "cart", hasFilter: false })).toBe("cart");
    expect(emptyStateKind({ listKind: "orders", hasFilter: false })).toBe("orders");
  });

  it("uses the search graphic whenever a filter is active", () => {
    // An empty *filtered* list means "no match in data that exists", so the
    // cart/orders graphic would misrepresent the shop as empty.
    expect(emptyStateKind({ listKind: "cart", hasFilter: true })).toBe("search");
    expect(emptyStateKind({ listKind: "orders", hasFilter: true })).toBe("search");
  });

  it("never returns 'network' — an unreachable backend is an error, not an empty list", () => {
    for (const listKind of ["cart", "orders"] as const) {
      for (const hasFilter of [true, false]) {
        expect(emptyStateKind({ listKind, hasFilter })).not.toBe("network");
      }
    }
  });
});
