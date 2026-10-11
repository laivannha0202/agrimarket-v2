import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_ORDER_STATUSES,
  complaintTypeLabel,
  ORDER_FLOW,
  orderFlowIndex,
  orderStatusMeta,
  paymentMethodLabel,
  RETURNABLE_ORDER_STATUSES,
  returnStatusMeta,
} from "../status";

describe("status", () => {
  it("labels order states in Vietnamese", () => {
    expect(orderStatusMeta("DELIVERED").label).toBe("Đã giao");
    expect(orderStatusMeta("BOGUS").label).toBe("Không xác định");
  });

  it("mirrors the backend cancel/return state machine", () => {
    expect(CANCELLABLE_ORDER_STATUSES).toContain("SHIPPING");
    expect(CANCELLABLE_ORDER_STATUSES).not.toContain("DELIVERED");
    expect(CANCELLABLE_ORDER_STATUSES).not.toContain("CANCELLED");
    expect(RETURNABLE_ORDER_STATUSES).toEqual(["DELIVERED"]);
    expect(returnStatusMeta("REFUNDED").label).toBe("Đã hoàn tiền");
  });

  it("labels complaint types and payment methods", () => {
    expect(complaintTypeLabel("PRODUCT_QUALITY")).toBe("Chất lượng sản phẩm");
    expect(paymentMethodLabel("COD")).toContain("COD");
  });

  /**
   * The progress tracker draws `ORDER_FLOW` as a sequence of completed steps, so
   * the list must match the backend's `ALLOWED_TRANSITIONS` exactly and must NOT
   * contain CANCELLED — a cancelled order is not a later step of the happy path.
   */
  it("orders the happy-path flow exactly as the backend allows it", () => {
    expect(ORDER_FLOW).toEqual([
      "PENDING_CONFIRMATION",
      "CONFIRMED",
      "PREPARING",
      "READY_TO_SHIP",
      "SHIPPING",
      "DELIVERED",
    ]);
    expect(ORDER_FLOW).not.toContain("CANCELLED");
    expect(orderFlowIndex("PENDING_CONFIRMATION")).toBe(0);
    expect(orderFlowIndex("DELIVERED")).toBe(ORDER_FLOW.length - 1);
  });

  it("treats CANCELLED and unknown statuses as off-flow", () => {
    expect(orderFlowIndex("CANCELLED")).toBe(-1);
    expect(orderFlowIndex("NOT_A_STATUS")).toBe(-1);
  });
});
