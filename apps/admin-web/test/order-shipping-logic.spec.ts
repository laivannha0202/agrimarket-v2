import { describe, it, expect } from "vitest";
import type { Order } from "@/types/api";
import { hasDeliveryMismatch, shipmentCounts, undeliveredShipmentCount } from "@/lib/orderShipping";

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
