import { describe, it, expect } from "vitest";
import type { Order } from "@/types/api";
import {
  hasDeliveryMismatch,
  hasPartnerDeliveryMismatch,
  mismatchedPartnerOrders,
  partnerShipmentStatusSummary,
  shipmentCounts,
  undeliveredShipmentCount,
} from "@/lib/orderShipping";

function mkOrder(status: string, shipStatuses: string[]): Order {
  return {
    id: 1,
    code: "O",
    customerId: 1,
    shippingAddressSnapshot: { recipientName: "A", phone: "0", province: "P", detail: "D" },
    subtotal: "0",
    discountTotal: "0",
    shippingFee: "0",
    grandTotal: "100",
    status: status as Order["status"],
    note: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    partnerOrders: [
      {
        id: 10,
        code: "PO",
        orderId: 1,
        partnerId: 2,
        subtotal: "100",
        discountTotal: "0",
        commissionAmount: "0",
        payableAmount: "100",
        status: status as Order["status"],
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        partner: { id: 2, name: "P" },
        shipments: shipStatuses.map((s, i) => ({
          id: i + 1,
          code: `SH-${i}`,
          partnerOrderId: 10,
          carrier: "GHN",
          trackingCode: `T${i}`,
          status: s as never,
          failureReason: null,
          shippedAt: null,
          deliveredAt: s === "DELIVERED" ? "2026-10-01T02:00:00.000Z" : null,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          events: [],
        })),
      },
    ],
  };
}

describe("order shipping logic", () => {
  it("detects mismatch when order delivered but shipment in transit", () => {
    const o = mkOrder("DELIVERED", ["IN_TRANSIT", "IN_TRANSIT"]);
    expect(hasDeliveryMismatch(o)).toBe(true);
    expect(undeliveredShipmentCount(o)).toBe(2);
  });
  it("no mismatch when all delivered", () => {
    const o = mkOrder("DELIVERED", ["DELIVERED", "DELIVERED"]);
    expect(hasDeliveryMismatch(o)).toBe(false);
  });
  it("counts delivered with evidence vs missing", () => {
    const o = mkOrder("DELIVERED", ["DELIVERED"]);
    // remove deliveredAt to simulate missing evidence
    o.partnerOrders![0].shipments![0].deliveredAt = null;
    const c = shipmentCounts(o);
    expect(c.delivered).toBe(1);
    expect(c.deliveredWithEvidence).toBe(0);
    expect(c.missingDeliveryTime).toBe(1);
  });
  it("no mismatch for cancelled order", () => {
    const o = mkOrder("CANCELLED", ["IN_TRANSIT"]);
    expect(hasDeliveryMismatch(o)).toBe(false);
  });
});

describe("partner delivery mismatch helpers", () => {
  it("detects partner mismatch", () => {
    const po = { status: "DELIVERED", shipments: [{ status: "IN_TRANSIT" }] } as { status: string; shipments: { status: string }[] };
    expect(hasPartnerDeliveryMismatch(po)).toBe(true);
    expect(hasPartnerDeliveryMismatch({ status: "DELIVERED", shipments: [{ status: "DELIVERED", deliveredAt: "2026-10-01T02:00:00Z" }] })).toBe(false);
  });
  it("partner shipment summary single vs multiple", () => {
    expect(partnerShipmentStatusSummary({ shipments: [{ status: "IN_TRANSIT" }, { status: "IN_TRANSIT" }] })).toBe("Đang vận chuyển");
    expect(partnerShipmentStatusSummary({ shipments: [{ status: "IN_TRANSIT" }, { status: "DELIVERED" }] })).toBe("Nhiều trạng thái");
    expect(partnerShipmentStatusSummary({ shipments: [] })).toBe("Chưa có vận đơn");
  });
  it("mismatched partner orders list", () => {
    const o = {
      status: "DELIVERED",
      partnerOrders: [
        { id: 1, code: "PO1", partner: { name: "A" }, status: "DELIVERED", shipments: [{ status: "IN_TRANSIT" }] },
        { id: 2, code: "PO2", partner: { name: "B" }, status: "DELIVERED", shipments: [{ status: "DELIVERED", deliveredAt: "2026-10-01T02:00:00Z" }] },
      ],
    };
    const list = mismatchedPartnerOrders(o);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("A");
  });
  it("shipment counts distinguish errors from in-progress", () => {
    const o = mkOrder("DELIVERED", ["DELIVERY_FAILED", "IN_TRANSIT", "DELIVERED"]);
    const c = shipmentCounts(o);
    expect(c.problems).toBe(1);
    expect(c.inProgress).toBe(1);
    expect(c.delivered).toBe(1);
  });
  it("detects delivered order without a shipment", () => {
    const o = mkOrder("DELIVERED", []);
    expect(hasDeliveryMismatch(o)).toBe(true);
    expect(hasPartnerDeliveryMismatch(o.partnerOrders![0])).toBe(true);
    expect(mismatchedPartnerOrders(o)).toEqual([{ code: "PO", name: "P" }]);
  });
  it("detects missing deliveredAt even when shipment status is DELIVERED", () => {
    const o = mkOrder("DELIVERED", ["DELIVERED"]);
    o.partnerOrders![0].shipments![0].deliveredAt = null;
    expect(hasDeliveryMismatch(o)).toBe(true);
    expect(hasPartnerDeliveryMismatch(o.partnerOrders![0])).toBe(true);
  });
  it("requires every partner's evidence, including partners without shipments", () => {
    const o = mkOrder("DELIVERED", ["DELIVERED"]);
    o.partnerOrders!.push({ ...o.partnerOrders![0], id: 11, code: "PO-EMPTY", shipments: [] });
    expect(hasDeliveryMismatch(o)).toBe(true);
    expect(mismatchedPartnerOrders(o)).toEqual([{ code: "PO-EMPTY", name: "P" }]);
  });
  it("accepts a delivered shipment alongside a terminal returned attempt", () => {
    const o = mkOrder("DELIVERED", ["RETURNED", "DELIVERED"]);
    expect(hasDeliveryMismatch(o)).toBe(false);
    expect(hasPartnerDeliveryMismatch(o.partnerOrders![0])).toBe(false);
  });
  it("detects a delivered order with a cancelled partner", () => {
    const o = mkOrder("DELIVERED", ["DELIVERED"]);
    o.partnerOrders![0].status = "CANCELLED";
    expect(hasDeliveryMismatch(o)).toBe(true);
    expect(mismatchedPartnerOrders(o)).toHaveLength(1);
  });
  it("detects delivered order without partner orders", () => {
    const o = mkOrder("DELIVERED", []);
    o.partnerOrders = [];
    expect(hasDeliveryMismatch(o)).toBe(true);
  });
});
