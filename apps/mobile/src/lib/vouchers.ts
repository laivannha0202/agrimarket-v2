/**
 * Voucher selection for checkout — pure helpers (unit-testable, no RN imports).
 *
 * The backend stays the ONLY authority on money. Nothing here computes a
 * discount: `POST /orders/checkout-preview` returns the applied amount, and the
 * eligibility verdict below decides *ordering and wording* only, from the
 * voucher row plus the current subtotal.
 *
 * WHY THIS EXISTS
 *
 * The screen used to ask the customer to type a code from memory. The voucher
 * catalogue (`GET /vouchers`) already carries every rule the backend enforces —
 * minimum order, validity window, remaining quota, per-customer limit — so the
 * app can list the codes, put the usable ones first, and state plainly why a
 * code cannot be used yet. That removes the copy/retype step without moving a
 * single decision off the server: the code still travels to
 * `checkout-preview`, which returns the authoritative discount.
 */

import type { Voucher } from "./types";

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
 * The order of the checks mirrors the backend's own evaluation
 * (`assertVoucherUsable` → usage limit → per-customer limit), so the reason the
 * customer sees is the reason the server would give.
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

  if (subtotal !== null && subtotal < Number(voucher.minOrderAmount)) return verdict("below-minimum");

  return { voucher, eligibility: "eligible", eligible: true, reason: null };
}

/**
 * All vouchers, split for display: usable first (cheapest-qualifying order not
 * required — the backend decides the real amount), then the rest, each with its
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
 * Label for the voucher row in the checkout total block, e.g.
 * `"Giảm 50.000 ₫"` / `"Giảm 10%"`. Display only — the money comes from the
 * preview.
 */
export function voucherValueLabel(voucher: Pick<Voucher, "discountType" | "discountValue">): string {
  const raw = Number(voucher.discountValue);
  if (!Number.isFinite(raw)) return "—";
  if (voucher.discountType === "PERCENT") return `Giảm ${raw}%`;
  return `Giảm ${Math.round(raw).toLocaleString("vi-VN")} ₫`;
}

/**
 * The voucher actually in force for the current preview.
 *
 * The backend echoes the code it applied, so the applied state is read from
 * `preview.voucher` — not from local state that could drift from it. Returns
 * `null` when the preview applied nothing (no code, or a code the backend
 * refused).
 */
export function appliedVoucherCode(
  preview: { voucher: { code: string; discountAmount: number } | null } | undefined,
): string | null {
  return preview?.voucher?.code ?? null;
}
