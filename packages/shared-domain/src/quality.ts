/**
 * Trust badges for the product page, shared by Customer Web and Mobile.
 *
 * The rule this module exists to enforce: a badge may only restate a fact the
 * backend actually holds. The category of a product is a catalogue grouping, not
 * evidence — an item filed under "Rau củ" is not thereby inspected, certified or
 * safe — so this function cannot see the category at all. That is deliberate:
 * the input type simply has no field for it, so the old
 * `product.category ? "An toàn" : null` claim cannot come back by accident.
 *
 * Two facts are real enough to show, and both are FARM-level, never a claim
 * about the goods in the customer's basket:
 *
 *  - `origin`      — the product is linked to a Farm row. Label says "thông tin"
 *                    (information), because that is all it is: a pointer to the
 *                    farm record, not proof of this lot's provenance. The
 *                    authoritative origin of a delivered line is its
 *                    `ProductLot`, which is what the order's trace links use.
 *  - `certificate` — the farm has at least one certificate the API currently
 *                    reports as valid (`GET /certificates/farm/:id/valid`:
 *                    VERIFIED + ACTIVE + inside [issuedAt, expiresAt] + has a
 *                    document). Expired, revoked/rejected, pending and
 *                    undocumented rows are already excluded server-side, so a
 *                    stale certificate can never light this badge up.
 *
 * What is deliberately NOT here:
 *
 *  - Any "an toàn"/"kiểm định" claim about the product. A product can be
 *    fulfilled from several lots under FEFO, so the QC result of one inspection
 *    says nothing about the units actually shipped — a product-level certificate
 *    claim would be a guess.
 *  - A "truy xuất" badge. Traceability is a property of a LOT (`ProductLot.
 *    traceCode`) and is reached from the delivered order, not from the product
 *    page, so the product payload carries no evidence for it.
 *
 * The mobile and web screens both render exactly the labels below, so the two
 * apps cannot drift into different wording for the same fact.
 */

export type ProductTrustBadgeKind = "origin" | "certificate";

/** Structural input — `product.farmId` plus what the certificate endpoint said. */
export interface ProductTrustInput {
  /** The product's linked farm, or null when it has none. */
  farmId?: number | null;
  /**
   * How many certificates `GET /certificates/farm/:farmId/valid` returned for
   * that farm. `undefined`/`null` (not fetched, or the request failed) is
   * treated as "no evidence" and hides the badge rather than assuming the best.
   */
  validCertificateCount?: number | null;
}

export interface ProductTrustBadge {
  kind: ProductTrustBadgeKind;
  label: string;
}

/** A farm id is present only when it is a positive integer. */
function hasFarm(farmId: number | null | undefined): farmId is number {
  return typeof farmId === "number" && Number.isInteger(farmId) && farmId > 0;
}

/**
 * The badges to show for a product, in display order. An empty array means
 * "show nothing" — the correct answer when there is no evidence.
 */
export function productTrustBadges(input: ProductTrustInput): ProductTrustBadge[] {
  const badges: ProductTrustBadge[] = [];

  if (hasFarm(input.farmId)) {
    badges.push({ kind: "origin", label: "Thông tin nguồn gốc" });
  }

  // Certificates belong to the farm, so evidence without a farm is impossible;
  // requiring both keeps a malformed payload from inventing a certification.
  const certificateCount =
    typeof input.validCertificateCount === "number" && Number.isFinite(input.validCertificateCount)
      ? Math.floor(input.validCertificateCount)
      : 0;
  if (hasFarm(input.farmId) && certificateCount > 0) {
    badges.push({ kind: "certificate", label: "Chứng nhận trang trại" });
  }

  return badges;
}
