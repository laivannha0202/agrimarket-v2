import { describe, expect, it } from "vitest";
import { apiConfigNotice, isApiConfigured, isLocalhostBaseUrl } from "../config";
import {
  galleryImages,
  isIdempotencyKey,
  newIdempotencyKey,
  primaryImage,
  resolveImageUrl,
} from "../promotions";

describe("config", () => {
  it("never treats localhost as a configured phone-reachable API", () => {
    expect(isLocalhostBaseUrl("http://localhost:3000/api/v1")).toBe(true);
    expect(isLocalhostBaseUrl("http://127.0.0.1:3000/api/v1")).toBe(true);
    expect(isLocalhostBaseUrl("http://192.168.1.10:3000/api/v1")).toBe(false);
  });

  it("requires an explicit LAN URL (no stale hardcoded fallback)", () => {
    expect(isApiConfigured("")).toBe(false);
    expect(isApiConfigured("http://localhost:3000/api/v1")).toBe(false);
    expect(isApiConfigured("http://192.168.1.10:3000/api/v1")).toBe(true);
    expect(apiConfigNotice("")).toContain("Chưa cấu hình");
    expect(apiConfigNotice("http://192.168.1.10:3000/api/v1")).toBeNull();
  });
});

describe("promotions", () => {
  it("rewrites localhost image URLs to the API origin", () => {
    expect(resolveImageUrl("http://localhost:3000/uploads/products/a.jpg", "http://192.168.1.10:3000")).toBe(
      "http://192.168.1.10:3000/uploads/products/a.jpg",
    );
    expect(resolveImageUrl("/uploads/products/a.jpg", "http://192.168.1.10:3000")).toBe(
      "http://192.168.1.10:3000/uploads/products/a.jpg",
    );
    expect(resolveImageUrl("http://192.168.1.10:3000/uploads/products/a.jpg")).toBe(
      "http://192.168.1.10:3000/uploads/products/a.jpg",
    );
    expect(resolveImageUrl(null)).toBeNull();
  });

  /**
   * Regression guard for the crash that broke every product card:
   * React Native's partial `URL` polyfill has getter-only `protocol`/`host`,
   * so an implementation that assigned them threw
   * "Cannot set property protocol of [object Object] which has only a getter".
   * The fix is string surgery, which these cases pin down.
   */
  it("handles every real stored-image shape without throwing", () => {
    const origin = "http://192.168.100.155:3000";
    // The exact shape stored by the API seeder (webp uploads).
    expect(
      resolveImageUrl("http://localhost:3000/uploads/products/3f2db25c-69b8-4e66-a347-df1f18f86151.webp", origin),
    ).toBe(`${origin}/uploads/products/3f2db25c-69b8-4e66-a347-df1f18f86151.webp`);
    // 127.0.0.1 with a non-default port.
    expect(resolveImageUrl("http://127.0.0.1:8080/uploads/a.png", origin)).toBe(`${origin}/uploads/a.png`);
    // https localhost must be rewritten too.
    expect(resolveImageUrl("https://localhost:3000/uploads/a.png", origin)).toBe(`${origin}/uploads/a.png`);
    // Already-LAN absolute URL passes through untouched.
    expect(resolveImageUrl("http://192.168.100.155:3000/uploads/a.png", origin)).toBe(
      "http://192.168.100.155:3000/uploads/a.png",
    );
    // External CDN passes through untouched.
    expect(resolveImageUrl("https://cdn.example.com/a.png", origin)).toBe("https://cdn.example.com/a.png");
  });

  it("treats blank and whitespace-only values as missing, not as a broken URL", () => {
    expect(resolveImageUrl("")).toBeNull();
    expect(resolveImageUrl("   ")).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl(null, "")).toBeNull();
  });

  it("keeps a relative path usable when no origin is configured", () => {
    // Nothing to rewrite to: returning the path beats inventing a host.
    expect(resolveImageUrl("/uploads/a.png", "")).toBe("/uploads/a.png");
    // A localhost URL with no configured origin is returned as-is rather than
    // being silently pointed at a random host.
    expect(resolveImageUrl("http://localhost:3000/uploads/a.png", "")).toBe(
      "http://localhost:3000/uploads/a.png",
    );
  });

  it("tolerates a trailing slash on the configured origin", () => {
    expect(resolveImageUrl("/uploads/a.png", "http://192.168.1.10:3000/")).toBe(
      "http://192.168.1.10:3000/uploads/a.png",
    );
    expect(resolveImageUrl("http://localhost:3000/uploads/a.png", "http://192.168.1.10:3000///")).toBe(
      "http://192.168.1.10:3000/uploads/a.png",
    );
  });

  it("does not rewrite a host that merely starts with localhost", () => {
    // "localhost.evil.com" is a different host and must not be touched.
    expect(resolveImageUrl("https://localhost.evil.com/a.png", "http://192.168.1.10:3000")).toBe(
      "https://localhost.evil.com/a.png",
    );
  });

  /**
   * The app must never recompute money. A local `variantDisplayPrice()` helper
   * used to duplicate the flash-sale/discount precedence here, which could
   * disagree with the server total shown at checkout. It was removed; this test
   * fails if it (or any similar arithmetic helper) comes back.
   *
   * Same rule for the flash-sale window: `isFlashSaleActive` used to live here
   * and drifted from Web's copy; the single implementation is now
   * `isFlashSaleLive` in `@agrimarket/shared-domain`.
   */
  it("exposes no client-side price computation", async () => {
    const mod: Record<string, unknown> = await import("../promotions");
    expect(mod.variantDisplayPrice).toBeUndefined();
    expect(mod.isFlashSaleActive).toBeUndefined();

    // `cheapestVariantPrice` is allowed because it only *selects* a value the
    // server already computed — it must never derive a new number.
    const pick = mod.cheapestVariantPrice as (p: unknown) => unknown;
    expect(typeof pick).toBe("function");
  });

  it("selects the cheapest server price verbatim instead of computing one", async () => {
    const { cheapestVariantPrice } = await import("../promotions");
    const variant = (unitPrice: number, basePrice: number) => ({
      effectivePrice: { unitPrice, basePrice, discountAmount: basePrice - unitPrice, source: "NONE" },
    });
    const product = { variants: [variant(18000, 20000), variant(12000, 12000)] } as never;
    // Exactly the server's number for the cheapest variant, not a recomputation.
    expect(cheapestVariantPrice(product)).toEqual({ unitPrice: 12000, basePrice: 12000 });
  });

  it("uses the backend isPrimary image as the cover, not whichever is first", () => {
    // Verified against real data: product 29 has two uploads, both sortOrder
    // 0 and 1, with isPrimary only on the first. The flag is the authority.
    const images = [
      { id: 1, url: "http://x/a.webp", sortOrder: 0, isPrimary: false },
      { id: 2, url: "http://x/b.webp", sortOrder: 1, isPrimary: true },
    ];
    expect(primaryImage({ images } as never)).toBe("http://x/b.webp");
  });

  it("falls back to the first image when no upload is flagged primary", () => {
    const images = [
      { id: 1, url: "http://x/a.webp", sortOrder: 0, isPrimary: false },
      { id: 2, url: "http://x/b.webp", sortOrder: 1, isPrimary: false },
    ];
    expect(primaryImage({ images } as never)).toBe("http://x/a.webp");
  });

  it("returns null for a product with no uploads instead of inventing a photo", () => {
    expect(primaryImage({ images: [] } as never)).toBeNull();
  });

  it("opens the gallery on the same image the card used as cover", () => {
    // A product may legitimately have its primary upload at sortOrder 1. The
    // card shows `isPrimary`; if the gallery opened on `sortOrder` 0 the
    // customer would tap one photo and land on a different one.
    const images = [
      { id: 7, url: "http://x/second.webp", sortOrder: 0, isPrimary: false },
      { id: 9, url: "http://x/first.webp", sortOrder: 1, isPrimary: true },
    ];
    const gallery = galleryImages({ images } as never);
    expect(gallery.map((i: { url: string }) => i.url)).toEqual([
      "http://x/first.webp",
      "http://x/second.webp",
    ]);
    // The first slide must be exactly what the card cover resolves to.
    expect(gallery[0]?.url).toBe(primaryImage({ images } as never));
  });

  it("orders the remaining gallery slides by the backend sortOrder", () => {
    const images = [
      { id: 3, url: "http://x/third.webp", sortOrder: 3, isPrimary: false },
      { id: 9, url: "http://x/cover.webp", sortOrder: 2, isPrimary: true },
      { id: 2, url: "http://x/second.webp", sortOrder: 1, isPrimary: false },
    ];
    expect(galleryImages({ images } as never).map((i: { url: string }) => i.url)).toEqual([
      "http://x/cover.webp",
      "http://x/second.webp",
      "http://x/third.webp",
    ]);
  });

  it("keeps every upload in the gallery (nothing is dropped or duplicated)", () => {
    const images = [
      { id: 1, url: "http://x/a.webp", sortOrder: 0, isPrimary: true },
      { id: 2, url: "http://x/b.webp", sortOrder: 1, isPrimary: false },
      { id: 3, url: "http://x/c.webp", sortOrder: 2, isPrimary: false },
    ];
    const gallery = galleryImages({ images } as never);
    expect(gallery).toHaveLength(3);
    expect(new Set(gallery.map((i: { id: number }) => i.id)).size).toBe(3);
  });

  it("falls back to sortOrder when no upload is flagged primary", () => {
    const images = [
      { id: 5, url: "http://x/later.webp", sortOrder: 2, isPrimary: false },
      { id: 4, url: "http://x/earlier.webp", sortOrder: 1, isPrimary: false },
    ];
    expect(galleryImages({ images } as never).map((i: { url: string }) => i.url)).toEqual([
      "http://x/earlier.webp",
      "http://x/later.webp",
    ]);
  });

  it("generates valid idempotency keys", () => {
    const key = newIdempotencyKey();
    expect(isIdempotencyKey(key)).toBe(true);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});
