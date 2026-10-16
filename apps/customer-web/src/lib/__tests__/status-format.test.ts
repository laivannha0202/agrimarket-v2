import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_ORDER_STATUSES,
  orderFlowIndex,
  orderStatusMeta,
  paymentMethodLabel,
  paymentStatusMeta,
  RETURNABLE_ORDER_STATUSES,
  returnFlowIndex,
} from "@/lib/status";
import {
  discountPercent,
  formatDate,
  formatMoney,
  formatQuantity,
  isRealDiscount,
  variantSpecLabel,
} from "@/lib/format";

/**
 * The Web app's status/format helpers are re-exports of
 * `@agrimarket/shared-domain/statuses` and `/format`. These smoke tests pin the
 * shared values at the Web entry point, so a broken export map or a divergence
 * between Web and Mobile fails here.
 */

describe("order status meta", () => {
  it("maps every backend status to its Vietnamese label and tone", () => {
    expect(orderStatusMeta("PENDING_CONFIRMATION")).toEqual({ label: "Chờ xác nhận", tone: "yellow" });
    expect(orderStatusMeta("DELIVERED")).toEqual({ label: "Đã giao", tone: "green" });
    expect(orderStatusMeta("CANCELLED")).toEqual({ label: "Đã hủy", tone: "red" });
  });

  it("never renders a raw enum: unknown statuses get the neutral fallback", () => {
    expect(orderStatusMeta("SOMETHING_NEW")).toEqual({ label: "Không xác định", tone: "gray" });
  });

  it("keeps CANCELLED off the progress flow", () => {
    expect(orderFlowIndex("DELIVERED")).toBe(5);
    expect(orderFlowIndex("CANCELLED")).toBe(-1);
  });

  it("mirrors the backend state machine for cancel/return eligibility", () => {
    expect(CANCELLABLE_ORDER_STATUSES).toContain("PENDING_CONFIRMATION");
    expect(CANCELLABLE_ORDER_STATUSES).not.toContain("DELIVERED");
    expect(CANCELLABLE_ORDER_STATUSES).not.toContain("CANCELLED");
    expect(RETURNABLE_ORDER_STATUSES).toEqual(["DELIVERED"]);
  });

  it("labels payment statuses and methods", () => {
    expect(paymentStatusMeta("PAID")).toEqual({ label: "Đã thanh toán", tone: "green" });
    expect(paymentMethodLabel("COD")).toBe("Thanh toán khi nhận hàng (COD)");
    // Unknown methods fall back to COD: that is what the checkout actually offers.
    expect(paymentMethodLabel("SOMETHING")).toBe("Thanh toán khi nhận hàng (COD)");
  });

  it("keeps REJECTED off the return happy path", () => {
    expect(returnFlowIndex("REQUESTED")).toBe(0);
    expect(returnFlowIndex("REFUNDED")).toBe(5);
    expect(returnFlowIndex("REJECTED")).toBe(-1);
  });
});

describe("formatting", () => {
  it("formats money in VND with Vietnamese grouping", () => {
    expect(formatMoney(136000)).toBe("136.000 ₫");
    expect(formatMoney("2500000")).toBe("2.500.000 ₫");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats dates as dd/mm/yyyy regardless of the visitor's locale", () => {
    // Constructed from local components so the assertion cannot flip across timezones.
    expect(formatDate(new Date(2026, 9, 7, 12, 0, 0))).toBe("07/10/2026");
  });

  it("formats Decimal-string quantities without trailing zeros", () => {
    expect(formatQuantity("5.000", "kg")).toBe("5 kg");
    expect(formatQuantity("0.500", "kg")).toBe("0,5 kg");
  });

  it("computes a discount percent only for a real price cut", () => {
    expect(discountPercent(20000, 17000)).toBe(15);
    expect(discountPercent(20000, 20000)).toBeNull();
    expect(discountPercent(20000, 21000)).toBeNull();
    expect(isRealDiscount(20000, 19999)).toBe(true);
    expect(isRealDiscount(20000, 20000)).toBe(false);
  });

  it("keeps a variant label from restating its own weight", () => {
    // "Túi 1 kg" already states the weight: appending "1000 g" was the bug.
    expect(variantSpecLabel({ name: "Túi 1 kg", weight: "1000", weightUnit: "g" })).toBe("Túi 1 kg");
    // A name without a size keeps the weight as real new information.
    expect(variantSpecLabel({ name: "Loại gia đình", weight: "1000", weightUnit: "g" })).toBe(
      "Loại gia đình · 1000 g",
    );
  });
});
