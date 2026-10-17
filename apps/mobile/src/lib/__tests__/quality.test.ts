import { describe, expect, it } from "vitest";
import { productTrustBadges } from "../quality";

/**
 * The Product Detail trust strip through the Mobile app's own module
 * (`src/lib/quality.ts` → `@agrimarket/shared-domain/quality`).
 *
 * Mirrors `apps/customer-web/src/lib/__tests__/quality.test.ts` label for
 * label: the two screens must never disagree about what the backend proved.
 */

/** The three labels the strip is allowed to know, verbatim. */
const FORBIDDEN = ["An toàn", "Truy xuất", "Đã kiểm định"];

describe("productTrustBadges (Mobile → shared-domain)", () => {
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

  it("hides the certificate badge when the farm certificate request failed", () => {
    // `undefined`/`null` means "not fetched or failed" — absence of evidence.
    expect(productTrustBadges({ farmId: 4, validCertificateCount: null }).map((b) => b.kind)).toEqual(
      ["origin"],
    );
    expect(
      productTrustBadges({ farmId: 4, validCertificateCount: undefined }).map((b) => b.kind),
    ).toEqual(["origin"]);
  });

  it("never mentions a lot-level inspection (FEFO picks the lot later)", () => {
    const labels = productTrustBadges({ farmId: 4, validCertificateCount: 1 })
      .map((b) => b.label)
      .join(" ");
    expect(labels).not.toMatch(/lô|kiểm định|QC/i);
  });
});
