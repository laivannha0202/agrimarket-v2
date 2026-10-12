/**
 * Voucher eligibility for display — pure helpers, no React.
 *
 * Port of the Mobile app's `src/lib/vouchers.ts`, so both clients describe the
 * same code with the same wording.
 *
 * The backend stays the ONLY authority on money. Nothing here computes a
 * discount: `POST /orders/checkout-preview` returns the applied amount, and the
 * verdict below decides *ordering and wording* only, from the voucher row plus
 * the current subtotal.
 *
 * The screen used to ask the customer to type a code from memory. The catalogue
 * (`GET /vouchers`) already carries every rule the backend enforces — minimum
 * order, validity window, remaining quota, per-customer limit — so the list can
 * put the usable codes first and state plainly why a code cannot be used yet.
 */

import type { Voucher } from "@/lib/api/types";

export type VoucherEligibility =
  | "eligible"
  /** Subtotal is below `minOrderAmount`. */
  | "below-minimum"
  /** Outside `startsAt`–`endsAt`. */
  | "not-in-period"
  /** Global `usageLimit` already reached. */
  | "quota-exhausted"
  /** `perCustomerLimit` reached — the backend rejects this on redemption. */
  | "already-used"
  | "inactive";

export interface VoucherOption {
  voucher: Voucher;
  eligibility: VoucherEligibility;
  /** True only when the backend is expected to accept this code now. */
  eligible: boolean;
  /** Vietnamese reason, shown verbatim for an ineligible code. */
  reason: string | null;
}

const REASON: Record<Exclude<VoucherEligibility, "eligible">, string> = {
  "below-minimum": "Chưa đủ giá trị đơn tối thiểu",
  "not-in-period": "Chưa đến kỳ hoặc đã hết hạn",
  "quota-exhausted": "Đã hết lượt sử dụng",
  "already-used": "Bạn đã dùng hết số lần cho phép",
  inactive: "Mã đã ngừng áp dụng",
};

/**
 * Decide how one voucher reads for this customer and subtotal.
 *
 * `now` is injectable so the period check is testable without freezing time.
 * `subtotal` may be `null` when the caller has no order in view (the voucher
 * catalogue screen): the minimum-order rule is then skipped, because it is not
 * a property of the voucher but of a specific order. Every other rule still
 * applies, so a code that is expired or out of quota is never shown as usable.
 *
 * The order of the checks mirrors the backend's own evaluation, so the reason
 * the customer sees is the reason the server would give.
 */
export function evaluateVoucher(
  voucher: Voucher,
  subtotal: number | null,
  options: { now?: number; customerUsage?: number } = {},
): VoucherOption {
  const now = options.now ?? Date.now();
  const usage = options.customerUsage ?? 0;

  const verdict = (eligibility: Exclude<VoucherEligibility, "eligible">): VoucherOption => ({
    voucher,
    eligibility,
    eligible: false,
    reason: REASON[eligibility],
  });

  if (voucher.status !== "ACTIVE") return verdict("inactive");

  const start = new Date(voucher.startsAt).getTime();
  const end = new Date(voucher.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return verdict("not-in-period");
  if (now < start || now > end) return verdict("not-in-period");

  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    return verdict("quota-exhausted");
  }

  if (voucher.perCustomerLimit !== null && usage >= voucher.perCustomerLimit) {
    return verdict("already-used");
  }

  if (subtotal !== null && subtotal < Number(voucher.minOrderAmount)) {
    return verdict("below-minimum");
  }

  return { voucher, eligibility: "eligible", eligible: true, reason: null };
}

/**
 * All vouchers, split for display: usable first, then the rest, each with its
 * reason. Ordering inside each group keeps the biggest nominal discount on top
 * so the list reads like a real storefront without implying a computed saving.
 */
export function splitVouchers(
  vouchers: Voucher[],
  subtotal: number | null,
  options: { now?: number; usageByCode?: Record<string, number> } = {},
): { eligible: VoucherOption[]; ineligible: VoucherOption[] } {
  const usageByCode = options.usageByCode ?? {};
  const evaluated = vouchers.map((voucher) =>
    evaluateVoucher(voucher, subtotal, {
      now: options.now,
      customerUsage: usageByCode[voucher.code] ?? 0,
    }),
  );

  const byNominalValue = (a: VoucherOption, b: VoucherOption): number => {
    const value = (o: VoucherOption): number => {
      const v = Number(o.voucher.discountValue);
      return o.voucher.discountType === "PERCENT" ? v : v / 1000;
    };
    return value(b) - value(a);
  };

  return {
    eligible: evaluated.filter((o) => o.eligible).sort(byNominalValue),
    ineligible: evaluated.filter((o) => !o.eligible).sort(byNominalValue),
  };
}

/**
 * Label for the voucher row, e.g. `"Giảm 50.000 ₫"` / `"Giảm 10%"`. Display
 * only — the money actually saved comes from the checkout preview.
 */
export function voucherValueLabel(
  voucher: Pick<Voucher, "discountType" | "discountValue">,
): string {
  const raw = Number(voucher.discountValue);
  if (!Number.isFinite(raw)) return "—";
  if (voucher.discountType === "PERCENT") return `Giảm ${raw}%`;
  return `Giảm ${Math.round(raw).toLocaleString("vi-VN")} ₫`;
}
