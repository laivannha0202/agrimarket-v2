import { describe, expect, it } from "vitest";
import {
  appliedVoucherCode,
  evaluateVoucher,
  splitVouchers,
  voucherValueLabel,
} from "../vouchers";
import type { Voucher } from "../types";

/**
 * Voucher selection helpers.
 *
 * These decide ORDERING and WORDING only. The discount is never computed here —
 * `POST /orders/checkout-preview` returns the authoritative amount — so the
 * tests assert the eligibility verdict and the reason text, and assert that no
 * money is produced.
 */

const NOW = new Date("2026-10-10T12:00:00Z").getTime();
const DAY = 86_400_000;

function voucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 3,
    code: "HUNGYEN50K",
    name: "Giảm 50.000đ cho đơn từ 300.000đ",
    discountType: "FIXED",
    discountValue: "50000",
    minOrderAmount: "300000",
    maxDiscount: "50000",
    usageLimit: 500,
    perCustomerLimit: 1,
    usedCount: 0,
    startsAt: new Date(NOW - 30 * DAY).toISOString(),
    endsAt: new Date(NOW + 60 * DAY).toISOString(),
    status: "ACTIVE",
    ...overrides,
  };
}

describe("voucher eligibility", () => {
  it("accepts a voucher whose minimum order is met", () => {
    const option = evaluateVoucher(voucher(), 300_000, { now: NOW });
    expect(option.eligible).toBe(true);
    expect(option.eligibility).toBe("eligible");
    expect(option.reason).toBeNull();
  });

  it("reports the minimum-order rule for an order that is too small", () => {
    // The exact case the user asked to test: HUNGYEN50K on a 200.000đ order.
    const option = evaluateVoucher(voucher(), 200_000, { now: NOW });
    expect(option.eligible).toBe(false);
    expect(option.eligibility).toBe("below-minimum");
    expect(option.reason).toBe("Chưa đủ giá trị đơn tối thiểu");
  });

  it("treats exactly the minimum as eligible (the backend uses >=)", () => {
    expect(evaluateVoucher(voucher(), 300_000, { now: NOW }).eligible).toBe(true);
    expect(evaluateVoucher(voucher(), 299_999, { now: NOW }).eligibility).toBe("below-minimum");
  });

  it("reports an expired or not-yet-started voucher", () => {
    const expired = voucher({
      startsAt: new Date(NOW - 60 * DAY).toISOString(),
      endsAt: new Date(NOW - DAY).toISOString(),
    });
    expect(evaluateVoucher(expired, 500_000, { now: NOW }).eligibility).toBe("not-in-period");

    const future = voucher({
      startsAt: new Date(NOW + DAY).toISOString(),
      endsAt: new Date(NOW + 30 * DAY).toISOString(),
    });
    expect(evaluateVoucher(future, 500_000, { now: NOW }).eligibility).toBe("not-in-period");
  });

  it("reports an exhausted global quota", () => {
    const option = evaluateVoucher(voucher({ usageLimit: 500, usedCount: 500 }), 500_000, { now: NOW });
    expect(option.eligibility).toBe("quota-exhausted");
    expect(option.reason).toBe("Đã hết lượt sử dụng");
  });

  it("reports the per-customer limit separately from the global quota", () => {
    // usageLimit still has room, but this customer already redeemed once.
    const option = evaluateVoucher(voucher({ perCustomerLimit: 1 }), 500_000, {
      now: NOW,
      customerUsage: 1,
    });
    expect(option.eligibility).toBe("already-used");
    expect(option.reason).toBe("Bạn đã dùng hết số lần cho phép");
  });

  it("reports an inactive voucher", () => {
    expect(evaluateVoucher(voucher({ status: "INACTIVE" }), 500_000, { now: NOW }).eligibility).toBe(
      "inactive",
    );
  });

  it("never computes a discount amount", () => {
    const option = evaluateVoucher(voucher(), 1_000_000, { now: NOW });
    // The only money-shaped fields are the voucher's own backend values.
    expect(option).not.toHaveProperty("discountAmount");
    expect(option).not.toHaveProperty("discount");
  });
});

describe("voucher list split", () => {
  it("puts eligible codes first and ineligible ones after, each with a reason", () => {
    const vouchers: Voucher[] = [
      voucher({ id: 1, code: "SMALL", minOrderAmount: "500000", discountValue: "10000" }),
      voucher({ id: 2, code: "BIG", minOrderAmount: "100000", discountValue: "30000" }),
      voucher({ id: 3, code: "HUGE", minOrderAmount: "100000", discountValue: "50000" }),
    ];

    const { eligible, ineligible } = splitVouchers(vouchers, 200_000, { now: NOW });

    expect(eligible.map((o) => o.voucher.code)).toEqual(["HUGE", "BIG"]);
    expect(ineligible.map((o) => o.voucher.code)).toEqual(["SMALL"]);
    expect(ineligible[0]?.reason).toBe("Chưa đủ giá trị đơn tối thiểu");
  });

  it("moves a code between groups when the subtotal changes", () => {
    const vouchers = [voucher()];

    const low = splitVouchers(vouchers, 100_000, { now: NOW });
    expect(low.eligible).toHaveLength(0);
    expect(low.ineligible).toHaveLength(1);

    // Same cart, higher subtotal: the code becomes usable without a reload.
    const high = splitVouchers(vouchers, 400_000, { now: NOW });
    expect(high.eligible).toHaveLength(1);
    expect(high.ineligible).toHaveLength(0);
  });

  it("applies the per-customer usage passed in for a code", () => {
    const { eligible, ineligible } = splitVouchers([voucher()], 500_000, {
      now: NOW,
      usageByCode: { HUNGYEN50K: 1 },
    });
    expect(eligible).toHaveLength(0);
    expect(ineligible[0]?.eligibility).toBe("already-used");
  });

  it("handles an empty catalogue", () => {
    const { eligible, ineligible } = splitVouchers([], 100_000, { now: NOW });
    expect(eligible).toEqual([]);
    expect(ineligible).toEqual([]);
  });
});

describe("voucher labels", () => {
  it("labels a fixed and a percent discount", () => {
    expect(voucherValueLabel({ discountType: "FIXED", discountValue: "50000" })).toContain("50.000");
    expect(voucherValueLabel({ discountType: "PERCENT", discountValue: "10" })).toBe("Giảm 10%");
  });

  it("reads the applied code from the backend preview, not local state", () => {
    expect(appliedVoucherCode({ voucher: { code: "HUNGYEN50K", discountAmount: 50_000 } })).toBe("HUNGYEN50K");
    // No voucher applied -> nothing to show, even if the user typed a code.
    expect(appliedVoucherCode({ voucher: null })).toBeNull();
    expect(appliedVoucherCode(undefined)).toBeNull();
  });
});
