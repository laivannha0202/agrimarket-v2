import { formatDateTime } from "@/lib/format";
import { shipmentStatus } from "@/lib/status";
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

const activeShipmentStatuses = new Set([
  "PENDING", "READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "RETURNING",
]);

type DeliveryPartner = {
  status?: string | null;
  shipments?: { status: string; deliveredAt?: string | Date | null }[] | null;
};

/** Mirror the backend delivery-evidence rule for read-only mismatch warnings. */
function lacksDeliveryEvidence(partnerOrder: DeliveryPartner): boolean {
  const shipments = partnerOrder.shipments ?? [];
  return (
    partnerOrder.status === "CANCELLED" ||
    !shipments.some((s) => s.status === "DELIVERED" && !!s.deliveredAt) ||
    shipments.some((s) => activeShipmentStatuses.has(s.status))
  );
}

/** Display-only mismatch detection for order and partner delivery evidence. */
export function hasDeliveryMismatch(order: Order | null | undefined): boolean {
  if (!order) return false;
  const partnerOrders = order.partnerOrders ?? [];
  if (order.status === "DELIVERED" && partnerOrders.length === 0) return true;
  return partnerOrders.some(
    (po) => (order.status === "DELIVERED" || po.status === "DELIVERED") && lacksDeliveryEvidence(po),
  );
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

/** Display-only: partner order recorded delivered without sufficient evidence. */
export function hasPartnerDeliveryMismatch(
  partnerOrder: DeliveryPartner | null | undefined,
): boolean {
  if (!partnerOrder) return false;
  if (partnerOrder.status !== "DELIVERED") return false;
  return lacksDeliveryEvidence(partnerOrder);
}

/**
 * Compact label for the aggregate shipment state of a partner order. Returns
 * the single status label when all shipments agree, otherwise "Nhiều trạng thái".
 */
export function partnerShipmentStatusSummary(
  partnerOrder: { shipments?: { status: string }[] | null } | null | undefined,
): string {
  const shipments = partnerOrder?.shipments ?? [];
  if (shipments.length === 0) return "Chưa có vận đơn";
  const statuses = new Set(shipments.map((s) => s.status));
  if (statuses.size === 1) {
    return shipmentStatus(shipments[0].status).label;
  }
  return "Nhiều trạng thái";
}

/** Partner orders missing delivery evidence for a recorded delivered state. */
export function mismatchedPartnerOrders(order: { status?: string | null; partnerOrders?: (DeliveryPartner & { code: string; partner?: { name?: string | null } | null })[] | null } | null | undefined): { code: string; name: string }[] {
  if (!order) return [];
  const out: { code: string; name: string }[] = [];
  for (const po of order.partnerOrders ?? []) {
    if ((order.status === "DELIVERED" || po.status === "DELIVERED") && lacksDeliveryEvidence(po)) {
      out.push({ code: po.code, name: po.partner?.name ?? po.code });
    }
  }
  return out;
}
