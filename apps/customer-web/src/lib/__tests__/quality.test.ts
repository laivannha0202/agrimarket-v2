import { describe, expect, it } from "vitest";
import { productTrustBadges } from "@/lib/quality";

/**
 * The Product Detail trust strip through the Web app's own module
 * (`src/lib/quality.ts` → `@agrimarket/shared-domain/quality`).
 *
 * The screen used to print "An toàn" whenever the product had a category — a
 * catalogue grouping standing in for an inspection. These tests fail if the
 * re-export breaks, if the wording drifts from Mobile, or if the burnt label
 * ever comes back.
 */

/** The three labels the strip is allowed to know, verbatim. */
const FORBIDDEN = ["An toàn", "Truy xuất", "Đã kiểm định"];

describe("productTrustBadges (Web → shared-domain)", () => {
  it("shows no badge at all when the backend holds no fact", () => {
    expect(productTrustBadges({})).toEqual([]);
    expect(productTrustBadges({ farmId: null, validCertificateCount: 0 })).toEqual([]);
  });

  it("labels a farm link as origin information, never as a safety claim", () => {
    const badges = productTrustBadges({ farmId: 4, validCertificateCount: 0 });
    expect(badges).toEqual([{ kind: "origin", label: "Thông tin nguồn gốc" }]);
    for (const badge of badges) expect(FORBIDDEN).not.toContain(badge.label);
  });

  it("only adds the certificate badge when a valid certificate was reported", () => {
    const withCert = productTrustBadges({ farmId: 4, validCertificateCount: 1 });
    expect(withCert.map((b) => b.label)).toEqual([
      "Thông tin nguồn gốc",
      "Chứng nhận trang trại",
    ]);
    // No farm link and no evidence → nothing to claim.
    expect(productTrustBadges({ farmId: null, validCertificateCount: 3 })).toEqual([]);
  });

  it("never mentions a lot-level inspection (FEFO picks the lot later)", () => {
    const labels = productTrustBadges({ farmId: 4, validCertificateCount: 1 })
      .map((b) => b.label)
      .join(" ");
    expect(labels).not.toMatch(/lô|kiểm định|QC/i);
  });
});
