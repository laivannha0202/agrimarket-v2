import { describe, it, expect } from "vitest";
import { productTrustBadges } from "../quality";

/**
 * The trust strip used to say "An toàn" whenever the product HAD a category —
 * a catalogue grouping standing in for an inspection. These tests pin the
 * replacement rule: only facts the backend holds may produce a badge, and the
 * function is structurally unable to read the category at all.
 */
describe("productTrustBadges", () => {
  const kinds = (input: Parameters<typeof productTrustBadges>[0]) =>
    productTrustBadges(input).map((badge) => badge.kind);

  it("shows nothing when there is no farm and no certificate evidence", () => {
    expect(productTrustBadges({ farmId: null, validCertificateCount: 0 })).toEqual([]);
    expect(productTrustBadges({})).toEqual([]);
  });

  it("never turns a category into a safety claim", () => {
    // The category is not part of the input contract; passing one changes
    // nothing. (TypeScript would reject it — cast to prove the runtime too.)
    const withCategory = { farmId: null, validCertificateCount: 0, category: { id: 3, name: "Rau củ" } };
    expect(productTrustBadges(withCategory as never)).toEqual([]);
  });

  it("labels a farm link as origin INFORMATION, not as safety", () => {
    const badges = productTrustBadges({ farmId: 12, validCertificateCount: 0 });
    expect(badges).toEqual([{ kind: "origin", label: "Thông tin nguồn gốc" }]);
    // The old wording must never come back.
    for (const badge of badges) expect(badge.label).not.toBe("An toàn");
  });

  it("adds a farm-certificate badge when the API reports a valid certificate", () => {
    const badges = productTrustBadges({ farmId: 12, validCertificateCount: 2 });
    expect(badges.map((b) => b.kind)).toEqual(["origin", "certificate"]);
    // Farm-level wording: the claim is about the farm, never the specific lot
    // that FEFO will pick for the customer's order.
    const certificate = badges.find((b) => b.kind === "certificate");
    expect(certificate?.label).toBe("Chứng nhận trang trại");
  });

  it("shows no certificate badge when the farm has no valid certificate left", () => {
    // Expired, revoked/rejected, still pending and undocumented certificates are
    // filtered out by the API, so they arrive as a count of zero.
    expect(kinds({ farmId: 12, validCertificateCount: 0 })).toEqual(["origin"]);
  });

  it("hides the certificate badge when the certificate request failed or never ran", () => {
    // A failed/absent fetch is not evidence — never assume the best.
    expect(kinds({ farmId: 12, validCertificateCount: null })).toEqual(["origin"]);
    expect(kinds({ farmId: 12, validCertificateCount: undefined })).toEqual(["origin"]);
  });

  it("cannot certify anything without a farm, even with a stray count", () => {
    expect(kinds({ farmId: null, validCertificateCount: 5 })).toEqual([]);
    expect(kinds({ farmId: 0, validCertificateCount: 5 })).toEqual([]);
  });

  it("ignores malformed farm ids and counts instead of guessing", () => {
    expect(kinds({ farmId: Number.NaN })).toEqual([]);
    expect(kinds({ farmId: 1.5 })).toEqual([]);
    expect(kinds({ farmId: -3 })).toEqual([]);
    expect(kinds({ farmId: 12, validCertificateCount: Number.NaN })).toEqual(["origin"]);
    expect(kinds({ farmId: 12, validCertificateCount: -1 })).toEqual(["origin"]);
  });

  it("never claims the product itself was inspected (no lot-level QC badge)", () => {
    // A product can be fulfilled from many lots with different QC results under
    // FEFO, so no badge may assert a product-level inspection.
    const badges = productTrustBadges({ farmId: 12, validCertificateCount: 1 });
    const labels = badges.map((b) => b.label);
    expect(labels.join(" ")).not.toMatch(/An toàn|kiểm định|đã kiểm|QC/i);
  });
});
