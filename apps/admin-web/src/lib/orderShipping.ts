import { formatDateTime } from "@/lib/format";
import type { Order, Shipment } from "@/types/api";

/** Flatten every shipment on every partner order of an order. */
export function collectShipments(order: Order | null | undefined): Shipment[] {
  if (!order) return [];
  const out: Shipment[] = [];
  for (const po of order.partnerOrders ?? []) {
    for (const s of po.shipments ?? []) out.push(s);
  }
  return out;
}

export interface ShipmentCounts {
  total: number;
  delivered: number;
  deliveredWithEvidence: number;
  inProgress: number;
  problems: number;
  missingDeliveryTime: number;
}

export function shipmentCounts(order: Order | null | undefined): ShipmentCounts {
  const shipments = collectShipments(order);
  const isProgress = (s: Shipment) =>
    s.status === "PENDING" ||
    s.status === "READY" ||
    s.status === "IN_TRANSIT" ||
    s.status === "OUT_FOR_DELIVERY";
  const isProblem = (s: Shipment) =>
    s.status === "DELIVERY_FAILED" ||
    s.status === "RETURNING" ||
    s.status === "RETURNED" ||
    s.status === "CANCELLED";
  return {
    total: shipments.length,
    delivered: shipments.filter((s) => s.status === "DELIVERED").length,
    deliveredWithEvidence: shipments.filter(
      (s) => s.status === "DELIVERED" && !!s.deliveredAt,
    ).length,
    inProgress: shipments.filter(isProgress).length,
    problems: shipments.filter(isProblem).length,
    missingDeliveryTime: shipments.filter(
      (s) => s.status === "DELIVERED" && !s.deliveredAt,
    ).length,
  };
}

/**
 * True when an order/partner order is recorded as delivered but at least one of
 * its shipments is not DELIVERED. This is a *display* condition only — it never
 * mutates the underlying records.
 */
export function hasDeliveryMismatch(order: Order | null | undefined): boolean {
  if (!order) return false;
  const shipments = collectShipments(order);
  if (shipments.length === 0) return false;
  if (order.status === "DELIVERED" && shipments.some((s) => s.status !== "DELIVERED")) {
    return true;
  }
  for (const po of order.partnerOrders ?? []) {
    if (po.status === "DELIVERED" && (po.shipments ?? []).some((s) => s.status !== "DELIVERED")) {
      return true;
    }
  }
  return false;
}

export function undeliveredShipmentCount(order: Order | null | undefined): number {
  return collectShipments(order).filter((s) => s.status !== "DELIVERED").length;
}

export function deliveryEvidenceLabel(shipment: Shipment): string {
  if (shipment.deliveredAt) return formatDateTime(shipment.deliveredAt);
  if (shipment.status === "DELIVERED") return "Thiếu thời điểm giao";
  return "Chưa giao";
}

export function shipmentProgressStep(status: string): number {
  switch (status) {
    case "PENDING":
    case "READY":
      return 0;
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return 1;
    case "DELIVERED":
      return 2;
    case "DELIVERY_FAILED":
      return 1;
    case "RETURNING":
    case "RETURNED":
      return 1;
    case "CANCELLED":
      return 0;
    default:
      return 0;
  }
}

export function shipmentProgressStatus(status: string): "wait" | "process" | "finish" | "error" {
  if (status === "DELIVERED") return "finish";
  if (status === "DELIVERY_FAILED" || status === "CANCELLED") return "error";
  return "process";
}
