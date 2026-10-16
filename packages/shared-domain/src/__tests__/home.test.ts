import { describe, expect, it } from "vitest";
import {
  discountedVariantPrice,
  flashItemRemaining,
  flashSaleRemainingTotal,
  isFlashItemSoldOut,
  isFlashSaleLive,
  isProductOnSale,
  partitionHomeProducts,
} from "../home";

interface Product {
  id: number;
  name: string;
  variants?: Array<{
    status?: string;
    inStock?: boolean;
    effectivePrice?: { source?: string; basePrice?: number | string; unitPrice?: number | string };
  }>;
}

const getId = (product: Product) => product.id;

describe("discountedVariantPrice", () => {
  it("accepts an active variant with a real cut", () => {
    const price = discountedVariantPrice([
      { status: "ACTIVE", effectivePrice: { source: "PRODUCT_DISCOUNT", basePrice: 12000, unitPrice: 10000 } },
    ]);
    expect(price?.unitPrice).toBe(10000);
  });

  it("rejects a zero-cut 'discount' (fake discount)", () => {
    expect(
      discountedVariantPrice([
        { status: "ACTIVE", effectivePrice: { source: "PRODUCT_DISCOUNT", basePrice: 10000, unitPrice: 10000 } },
      ]),
    ).toBeNull();
  });

  it("ignores inactive variants", () => {
    expect(
      discountedVariantPrice([
        { status: "INACTIVE", effectivePrice: { source: "FLASH_SALE", basePrice: 12000, unitPrice: 9000 } },
      ]),
    ).toBeNull();
  });

  it("returns the cheapest real cut", () => {
    const price = discountedVariantPrice([
      { status: "ACTIVE", effectivePrice: { source: "PRODUCT_DISCOUNT", basePrice: 12000, unitPrice: 11000 } },
      { status: "ACTIVE", effectivePrice: { source: "FLASH_SALE", basePrice: 12000, unitPrice: 9000 } },
    ]);
    expect(price?.unitPrice).toBe(9000);
  });

  it("handles missing data without throwing", () => {
    expect(discountedVariantPrice(undefined)).toBeNull();
    expect(discountedVariantPrice([])).toBeNull();
    expect(discountedVariantPrice([{ status: "ACTIVE" }])).toBeNull();
    expect(isProductOnSale({ variants: [] })).toBe(false);
  });
});

describe("partitionHomeProducts", () => {
  const products: Product[] = [
    { id: 1, name: "A" },
    { id: 2, name: "B" },
    { id: 3, name: "C" },
    { id: 4, name: "D" },
    { id: 2, name: "B (duplicate row)" },
  ];

  it("dedupes by product ID, never by name", () => {
    const { featured } = partitionHomeProducts(products, {
      getId,
      discountedLimit: 0,
      featuredLimit: 10,
    });
    expect(featured.map(getId)).toEqual([1, 2, 3, 4]);
  });

  it("keeps a product out of the featured list once it is discounted", () => {
    const { discounted, featured } = partitionHomeProducts(products, {
      getId,
      isDiscounted: (p) => p.id === 2,
      discountedLimit: 5,
      featuredLimit: 5,
    });
    expect(discounted.map(getId)).toEqual([2]);
    expect(featured.map(getId)).toEqual([1, 3, 4]);
  });

  it("never shows an excluded (flash-sale) product again", () => {
    const { discounted, featured } = partitionHomeProducts(products, {
      getId,
      excludeIds: new Set([1, 3]),
      isDiscounted: (p) => p.id === 3,
      discountedLimit: 5,
      featuredLimit: 5,
    });
    expect(discounted).toEqual([]);
    expect(featured.map(getId)).toEqual([2, 4]);
  });

  it("respects the section limits", () => {
    const { discounted, featured } = partitionHomeProducts(products, {
      getId,
      isDiscounted: () => true,
      discountedLimit: 2,
      featuredLimit: 1,
    });
    expect(discounted.map(getId)).toEqual([1, 2]);
    expect(featured.map(getId)).toEqual([3]);
  });

  it("works on an empty catalogue", () => {
    const { discounted, featured } = partitionHomeProducts([], {
      getId,
      discountedLimit: 5,
      featuredLimit: 5,
    });
    expect(discounted).toEqual([]);
    expect(featured).toEqual([]);
  });
});

describe("flash sale helpers", () => {
  it("clamps remaining at zero", () => {
    expect(flashItemRemaining({ quota: 10, soldQuantity: 4 })).toBe(6);
    expect(flashItemRemaining({ quota: 10, soldQuantity: 12 })).toBe(0);
    expect(flashItemRemaining({ quota: "10", soldQuantity: "9" })).toBe(1);
  });

  it("flags sold-out items and totals a sale", () => {
    expect(isFlashItemSoldOut({ quota: 5, soldQuantity: 5 })).toBe(true);
    expect(flashSaleRemainingTotal({ startsAt: "", endsAt: "", items: [{ quota: 5, soldQuantity: 5 }, { quota: 3, soldQuantity: 1 }] })).toBe(2);
  });

  it("is live only inside its window", () => {
    const now = new Date("2026-10-07T12:00:00.000Z").getTime();
    const live = {
      status: "ACTIVE",
      startsAt: "2026-10-07T00:00:00.000Z",
      endsAt: "2026-10-08T00:00:00.000Z",
      items: [{ quota: 1, soldQuantity: 0 }],
    };
    expect(isFlashSaleLive(live, now)).toBe(true);
    expect(isFlashSaleLive({ ...live, endsAt: "2026-10-07T11:00:00.000Z" }, now)).toBe(false);
    expect(isFlashSaleLive({ ...live, status: "INACTIVE" }, now)).toBe(false);
    expect(isFlashSaleLive({ ...live, items: [] }, now)).toBe(false);
  });
});
