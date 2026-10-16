import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_ORDER_STATUSES,
  ORDER_FLOW,
  ORDER_STATUS,
  PAYMENT_METHOD,
  RETURN_FLOW,
  complaintTypeLabel,
  orderFlowIndex,
  orderStatusMeta,
  paymentMethodLabel,
  paymentStatusMeta,
  returnFlowIndex,
  returnStatusMeta,
} from "../statuses";

describe("status labels", () => {
  it("translates every order status", () => {
    for (const status of Object.keys(ORDER_STATUS)) {
      const meta = orderStatusMeta(status);
      expect(meta.label).not.toBe("Không xác định");
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it("never renders a raw enum for an unknown status", () => {
    expect(orderStatusMeta("SOMETHING_NEW").label).toBe("Không xác định");
    expect(paymentStatusMeta("SOMETHING_NEW").label).toBe("Không xác định");
    expect(returnStatusMeta("SOMETHING_NEW").label).toBe("Không xác định");
  });

  it("labels payments and methods consistently", () => {
    expect(paymentStatusMeta("PAID").label).toBe("Đã thanh toán");
    expect(paymentMethodLabel("COD")).toContain("COD");
    expect(paymentMethodLabel("VNPAY")).toBe(PAYMENT_METHOD.VNPAY);
    expect(complaintTypeLabel("WRONG_ITEM")).toBe("Giao sai sản phẩm");
  });
});

describe("flows", () => {
  it("keeps CANCELLED off the order flow", () => {
    expect(ORDER_FLOW).not.toContain("CANCELLED");
    expect(orderFlowIndex("CANCELLED")).toBe(-1);
    expect(orderFlowIndex("DELIVERED")).toBe(ORDER_FLOW.length - 1);
  });

  it("keeps REJECTED off the return flow", () => {
    expect(RETURN_FLOW).not.toContain("REJECTED");
    expect(returnFlowIndex("REJECTED")).toBe(-1);
  });

  it("mirrors the backend's cancellable statuses", () => {
    expect(CANCELLABLE_ORDER_STATUSES).toEqual([
      "PENDING_CONFIRMATION",
      "CONFIRMED",
      "PREPARING",
      "READY_TO_SHIP",
      "SHIPPING",
    ]);
    expect(CANCELLABLE_ORDER_STATUSES).not.toContain("DELIVERED");
  });
});
