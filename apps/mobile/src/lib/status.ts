/**
 * Status labels. Port of `apps/customer-web/src/lib/status.ts`.
 * Exact backend enums, Vietnamese labels. No raw enum reaches the UI.
 */

import type { Tone } from "./theme";
import type {
  ComplaintStatus,
  ComplaintType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ReturnRequestStatus,
  ShipmentStatus,
} from "./types";

interface StatusMeta {
  label: string;
  tone: Tone;
}

const UNKNOWN: StatusMeta = { label: "Không xác định", tone: "gray" };

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  PENDING_CONFIRMATION: { label: "Chờ xác nhận", tone: "yellow" },
  CONFIRMED: { label: "Đã xác nhận", tone: "blue" },
  PREPARING: { label: "Đang chuẩn bị", tone: "blue" },
  READY_TO_SHIP: { label: "Chờ giao", tone: "blue" },
  SHIPPING: { label: "Đang giao", tone: "orange" },
  DELIVERED: { label: "Đã giao", tone: "green" },
  CANCELLED: { label: "Đã hủy", tone: "red" },
};

export function orderStatusMeta(status: string): StatusMeta {
  return ORDER_STATUS[status as OrderStatus] ?? UNKNOWN;
}

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = {
  PENDING: { label: "Chờ thanh toán", tone: "yellow" },
  PAID: { label: "Đã thanh toán", tone: "green" },
  PARTIALLY_REFUNDED: { label: "Hoàn một phần", tone: "blue" },
  REFUNDED: { label: "Đã hoàn tiền", tone: "blue" },
  FAILED: { label: "Thất bại", tone: "red" },
};

export function paymentStatusMeta(status: string): StatusMeta {
  return PAYMENT_STATUS[status as PaymentStatus] ?? UNKNOWN;
}

export const SHIPMENT_STATUS: Record<ShipmentStatus, StatusMeta> = {
  PENDING: { label: "Chờ xử lý", tone: "gray" },
  READY: { label: "Sẵn sàng giao", tone: "blue" },
  IN_TRANSIT: { label: "Đang vận chuyển", tone: "blue" },
  OUT_FOR_DELIVERY: { label: "Đang giao", tone: "orange" },
  DELIVERED: { label: "Đã giao", tone: "green" },
  DELIVERY_FAILED: { label: "Giao thất bại", tone: "red" },
  RETURNING: { label: "Đang hoàn hàng", tone: "orange" },
  RETURNED: { label: "Đã hoàn hàng", tone: "gray" },
};

export function shipmentStatusMeta(status: string): StatusMeta {
  return SHIPMENT_STATUS[status as ShipmentStatus] ?? UNKNOWN;
}

export const RETURN_STATUS: Record<ReturnRequestStatus, StatusMeta> = {
  REQUESTED: { label: "Đã gửi yêu cầu", tone: "yellow" },
  APPROVED: { label: "Đã chấp nhận", tone: "blue" },
  RETURNING: { label: "Đang gửi trả", tone: "blue" },
  RECEIVED: { label: "Đã nhận hàng trả", tone: "blue" },
  QC_PENDING: { label: "Chờ kiểm định", tone: "orange" },
  REFUNDED: { label: "Đã hoàn tiền", tone: "green" },
  REJECTED: { label: "Từ chối", tone: "red" },
};

export function returnStatusMeta(status: string): StatusMeta {
  return RETURN_STATUS[status as ReturnRequestStatus] ?? UNKNOWN;
}

/**
 * Happy-path progression of a return, in backend order. `REJECTED` is a
 * terminal off-flow outcome, so it is excluded and handled separately.
 */
export const RETURN_FLOW: ReturnRequestStatus[] = [
  "REQUESTED",
  "APPROVED",
  "RETURNING",
  "RECEIVED",
  "QC_PENDING",
  "REFUNDED",
];

export const COMPLAINT_STATUS: Record<ComplaintStatus, StatusMeta> = {
  OPEN: { label: "Đã tiếp nhận", tone: "yellow" },
  PROCESSING: { label: "Đang xử lý", tone: "blue" },
  RESOLVED: { label: "Đã giải quyết", tone: "green" },
  REJECTED: { label: "Từ chối", tone: "red" },
};

export function complaintStatusMeta(status: string): StatusMeta {
  return COMPLAINT_STATUS[status as ComplaintStatus] ?? UNKNOWN;
}

export const COMPLAINT_TYPE: Record<ComplaintType, string> = {
  PRODUCT_QUALITY: "Chất lượng sản phẩm",
  DELIVERY: "Giao hàng",
  WRONG_ITEM: "Giao sai sản phẩm",
  OTHER: "Khác",
};

export function complaintTypeLabel(type: string): string {
  return COMPLAINT_TYPE[type as ComplaintType] ?? "Khác";
}

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  COD: "Thanh toán khi nhận hàng (COD)",
  VNPAY: "VNPay",
  MOCK_ONLINE: "Thanh toán online",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD[method as PaymentMethod] ?? "Thanh toán khi nhận hàng (COD)";
}

export const TRACE_EVENT_LABEL: Record<string, string> = {
  HARVEST: "Thu hoạch",
  QC: "Kiểm định chất lượng",
  PACKING: "Đóng gói",
  WAREHOUSE_IN: "Nhập kho",
  WAREHOUSE_OUT: "Xuất kho",
  SHIPPING: "Giao hàng",
  DELIVERED: "Đã giao",
  RETURNED: "Hàng hoàn về kho",
};

export function traceEventLabel(type: string): string {
  return TRACE_EVENT_LABEL[type] ?? type;
}

export const LOT_STATUS: Record<string, StatusMeta> = {
  PENDING_QC: { label: "Chờ kiểm định", tone: "yellow" },
  QUARANTINED: { label: "Cách ly", tone: "orange" },
  SELLABLE: { label: "Đủ điều kiện bán", tone: "green" },
  REJECTED: { label: "Không đạt", tone: "red" },
  RECALLED: { label: "Đã thu hồi", tone: "red" },
  EXPIRED: { label: "Hết hạn", tone: "red" },
  LOCKED: { label: "Tạm giữ", tone: "gray" },
};

export function lotStatusMeta(status: string): StatusMeta {
  return LOT_STATUS[status] ?? UNKNOWN;
}

/**
 * Happy-path progression of an order, in backend order.
 *
 * Mirrors `ALLOWED_TRANSITIONS` in `apps/api/src/orders/orders.service.ts`:
 * PENDING_CONFIRMATION -> CONFIRMED -> PREPARING -> READY_TO_SHIP -> SHIPPING
 * -> DELIVERED. `CANCELLED` is a terminal off-flow outcome (reachable from any
 * non-terminal step), so it is excluded here and rendered separately — drawing
 * it as step 6 of 6 would claim the order advanced when it did not.
 */
export const ORDER_FLOW: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPING",
  "DELIVERED",
];

/** Index of a status within `ORDER_FLOW`, or -1 when it is off-flow (CANCELLED). */
export function orderFlowIndex(status: string): number {
  return ORDER_FLOW.indexOf(status as OrderStatus);
}

export const CANCELLABLE_ORDER_STATUSES: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPING",
];

export const RETURNABLE_ORDER_STATUSES: OrderStatus[] = ["DELIVERED"];
