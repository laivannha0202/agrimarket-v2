import { describe, expect, it } from "vitest";
import { voucherStatus, voucherValueLabel } from "@/lib/vouchers";
import type { Voucher } from "@/lib/api/types";

/**
 * Programme status shown on the voucher centre. This is not personal
 * eligibility: the card must never claim a code will be accepted at checkout,
 * only that the programme is running, upcoming, ended or out of quota.
 */

const base: Voucher = {
  id: 1,
  code: "HUNGYEN50K",
  name: "Giảm 50.000 ₫ cho đơn từ 300.000 ₫",
  discountType: "FIXED",
  discountValue: "50000",
  minOrderAmount: "300000",
  maxDiscount: "50000",
  usageLimit: 500,
  perCustomerLimit: 1,
  usedCount: 0,
  startsAt: "2026-09-14T17:00:00.000Z",
  endsAt: "2026-12-13T17:00:00.000Z",
  status: "ACTIVE",
};

const during = new Date("2026-10-20T00:00:00.000Z").getTime();
const before = new Date("2026-08-01T00:00:00.000Z").getTime();
const after = new Date("2027-01-01T00:00:00.000Z").getTime();

describe("voucherStatus", () => {
  it("shows a running programme as ongoing", () => {
    expect(voucherStatus(base, during)).toEqual({
      phase: "ongoing",
      label: "Đang diễn ra",
      tone: "success",
      running: true,
    });
  });

  it("distinguishes a future programme from a finished one", () => {
    expect(voucherStatus(base, before)).toMatchObject({
      phase: "upcoming",
      label: "Sắp diễn ra",
      tone: "warning",
      running: false,
    });
    expect(voucherStatus(base, after)).toMatchObject({
      phase: "ended",
      label: "Đã kết thúc",
      tone: "neutral",
      running: false,
    });
  });

  it("keeps an exhausted quota in the ongoing phase with its own label", () => {
    expect(voucherStatus({ ...base, usedCount: 500 }, during)).toMatchObject({
      phase: "ongoing",
      label: "Hết lượt",
      tone: "danger",
      running: false,
    });
  });

  it("treats an inactive programme as paused", () => {
    expect(voucherStatus({ ...base, status: "INACTIVE" }, during)).toMatchObject({
      phase: "inactive",
      label: "Tạm dừng",
      tone: "neutral",
      running: false,
    });
  });

  it("keeps a stable phase while the clock is unknown (SSR/hydration)", () => {
    // The shared clock returns 0 on the server. The date window is skipped so
    // the first render does not depend on an invented timestamp.
    expect(voucherStatus(base, 0)).toMatchObject({
      phase: "ongoing",
      label: "Đang diễn ra",
      running: true,
    });
  });

  it("falls back safely when the validity window is malformed", () => {
    expect(voucherStatus({ ...base, startsAt: "not-a-date" }, during)).toMatchObject({
      phase: "ended",
      label: "Không xác định",
      running: false,
    });
  });
});

describe("voucherValueLabel", () => {
  it("labels fixed and percentage discounts with the real backend values", () => {
    expect(voucherValueLabel(base)).toBe("Giảm 50.000 ₫");
    expect(
      voucherValueLabel({ discountType: "PERCENT", discountValue: "10" }),
    ).toBe("Giảm 10%");
  });

  it("never prints NaN when the value is malformed", () => {
    expect(voucherValueLabel({ discountType: "FIXED", discountValue: "NaN" })).toBe("—");
  });
});
