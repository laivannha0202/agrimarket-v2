/**
 * Centralised status label + tone mapping, shared by Customer Web and Mobile.
 *
 * These are the exact enums the backend exposes. No status is invented, and no
 * raw enum value is ever rendered in the UI. Each platform maps `Tone` to its
 * own colours; the label, the tone and the flow order are decided here once.
 */

import type {
  ComplaintStatus,
  ComplaintType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ReturnRequestStatus,
  ShipmentStatus,
  Tone,
} from "./types";

export interface StatusMeta {
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
 * terminal off-flow outcome, so it is excluded here and rendered as its own
 * notice rather than as a step of the progress tracker.
 */
export const RETURN_FLOW: ReturnRequestStatus[] = [
  "REQUESTED",
  "APPROVED",
  "RETURNING",
  "RECEIVED",
  "QC_PENDING",
  "REFUNDED",
];

/** Index of a status within `RETURN_FLOW`, or -1 when it is off-flow (REJECTED). */
export function returnFlowIndex(status: string): number {
  return RETURN_FLOW.indexOf(status as ReturnRequestStatus);
}

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

/** Human labels for the public traceability timeline. */
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

export const FARMING_EVENT_LABEL: Record<string, string> = {
  WATERING: "Tưới nước",
  FERTILIZING: "Bón phân",
  PEST_CHECK: "Kiểm tra sâu bệnh",
  CARE: "Chăm sóc",
  OTHER: "Ghi nhận khác",
};

export function farmingEventLabel(type: string): string {
  return FARMING_EVENT_LABEL[type] ?? "Ghi nhận khác";
}

export const SEASON_STATUS: Record<string, string> = {
  PLANNED: "Đã lên kế hoạch",
  GROWING: "Đang sinh trưởng",
  HARVESTING: "Đang thu hoạch",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
};

export function seasonStatusLabel(status: string): string {
  return SEASON_STATUS[status] ?? status;
}

/**
 * The order state machine, in customer-facing order. `CANCELLED` deliberately
 * sits OFF this flow, so a cancelled order renders as cancelled instead of as a
 * half-filled progress tracker. Mirrors `ALLOWED_TRANSITIONS` in the API:
 * PENDING_CONFIRMATION -> CONFIRMED -> PREPARING -> READY_TO_SHIP -> SHIPPING
 * -> DELIVERED.
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

/** Order statuses a customer can cancel, mirroring the backend state machine. */
export const CANCELLABLE_ORDER_STATUSES: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPING",
];

/** Order statuses that allow a return request (backend requires DELIVERED). */
export const RETURNABLE_ORDER_STATUSES: OrderStatus[] = ["DELIVERED"];
