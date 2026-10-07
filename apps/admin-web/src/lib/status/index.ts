/**
 * Vietnamese labels for every backend enum.
 *
 * Colours follow the agreed scheme:
 *   gray   neutral / pending
 *   blue   processing
 *   green  success
 *   orange warning
 *   red    error / rejected / expired / recall
 *
 * Never colour-only: always render the text label alongside the colour.
 */

export type StatusColor = "default" | "processing" | "success" | "warning" | "error";

export interface StatusDescriptor {
  label: string;
  color: StatusColor;
}

type Map = Record<string, StatusDescriptor>;

const FALLBACK: StatusDescriptor = { label: "Không xác định", color: "default" };

function resolve(map: Map, value: string | null | undefined): StatusDescriptor {
  if (!value) return FALLBACK;
  return map[value] ?? { label: value, color: "default" };
}

// Orders --------------------------------------------------------------------

export const ORDER_STATUS: Map = {
  PENDING_CONFIRMATION: { label: "Chờ xác nhận", color: "warning" },
  CONFIRMED: { label: "Đã xác nhận", color: "processing" },
  PREPARING: { label: "Đang chuẩn bị", color: "processing" },
  READY_TO_SHIP: { label: "Chờ giao", color: "processing" },
  SHIPPING: { label: "Đang giao", color: "processing" },
  DELIVERED: { label: "Đã giao", color: "success" },
  CANCELLED: { label: "Đã hủy", color: "error" },
};

export const orderStatus = (v?: string | null) => resolve(ORDER_STATUS, v);

// Shipments -----------------------------------------------------------------

export const SHIPMENT_STATUS: Map = {
  PENDING: { label: "Chờ xử lý", color: "default" },
  READY: { label: "Sẵn sàng giao", color: "processing" },
  IN_TRANSIT: { label: "Đang vận chuyển", color: "processing" },
  OUT_FOR_DELIVERY: { label: "Đang giao", color: "processing" },
  DELIVERED: { label: "Đã giao", color: "success" },
  DELIVERY_FAILED: { label: "Giao thất bại", color: "error" },
  RETURNING: { label: "Đang hoàn hàng", color: "warning" },
  RETURNED: { label: "Đã hoàn hàng", color: "warning" },
};

export const shipmentStatus = (v?: string | null) => resolve(SHIPMENT_STATUS, v);

// Fulfillment ---------------------------------------------------------------

export const FULFILLMENT_STATUS: Map = {
  PENDING: { label: "Chờ đóng gói", color: "default" },
  PACKING: { label: "Đang đóng gói", color: "processing" },
  PACKED: { label: "Đã đóng gói", color: "success" },
  CANCELLED: { label: "Đã hủy", color: "error" },
};

export const fulfillmentStatus = (v?: string | null) => resolve(FULFILLMENT_STATUS, v);

// Lots ----------------------------------------------------------------------

export const LOT_STATUS: Map = {
  PENDING_QC: { label: "Chờ kiểm định", color: "warning" },
  QUARANTINED: { label: "Cách ly", color: "warning" },
  SELLABLE: { label: "Có thể bán", color: "success" },
  REJECTED: { label: "Không đạt", color: "error" },
  RECALLED: { label: "Thu hồi", color: "error" },
  EXPIRED: { label: "Hết hạn", color: "error" },
  LOCKED: { label: "Đã khóa", color: "default" },
};

export const lotStatus = (v?: string | null) => resolve(LOT_STATUS, v);

// QC ------------------------------------------------------------------------

export const QC_RESULT: Map = {
  PASS: { label: "Đạt", color: "success" },
  FAIL: { label: "Không đạt", color: "error" },
};

export const qcResult = (v?: string | null) => resolve(QC_RESULT, v);

// Payments ------------------------------------------------------------------

export const PAYMENT_STATUS: Map = {
  PENDING: { label: "Chờ thanh toán", color: "warning" },
  PAID: { label: "Đã thanh toán", color: "success" },
  PARTIALLY_REFUNDED: { label: "Hoàn một phần", color: "processing" },
  REFUNDED: { label: "Đã hoàn tiền", color: "default" },
  FAILED: { label: "Thất bại", color: "error" },
};

export const paymentStatus = (v?: string | null) => resolve(PAYMENT_STATUS, v);

export const PAYMENT_METHOD: Map = {
  COD: { label: "Thanh toán khi nhận hàng", color: "default" },
  VNPAY: { label: "VNPAY", color: "processing" },
  MOCK_ONLINE: { label: "Thanh toán online", color: "processing" },
};

export const paymentMethod = (v?: string | null) => resolve(PAYMENT_METHOD, v);

export const REFUND_STATUS: Map = {
  PENDING: { label: "Chờ xử lý", color: "warning" },
  COMPLETED: { label: "Đã hoàn tiền", color: "success" },
  FAILED: { label: "Thất bại", color: "error" },
};

export const refundStatus = (v?: string | null) => resolve(REFUND_STATUS, v);

// Certificates --------------------------------------------------------------

export const CERTIFICATE_STATUS: Map = {
  PENDING: { label: "Chờ xác minh", color: "warning" },
  VERIFIED: { label: "Đã xác minh", color: "success" },
  REJECTED: { label: "Từ chối", color: "error" },
};

export const certificateStatus = (v?: string | null) => resolve(CERTIFICATE_STATUS, v);

// Records -------------------------------------------------------------------

export const RECORD_STATUS: Map = {
  ACTIVE: { label: "Đang hoạt động", color: "success" },
  INACTIVE: { label: "Ngừng hoạt động", color: "default" },
};

export const recordStatus = (v?: string | null) => resolve(RECORD_STATUS, v);

export const USER_STATUS: Map = {
  ACTIVE: { label: "Đang hoạt động", color: "success" },
  INACTIVE: { label: "Đã khóa", color: "default" },
};

export const userStatus = (v?: string | null) => resolve(USER_STATUS, v);

// Seasons -------------------------------------------------------------------

export const SEASON_STATUS: Map = {
  PLANNED: { label: "Đã lên kế hoạch", color: "default" },
  GROWING: { label: "Đang canh tác", color: "processing" },
  HARVESTING: { label: "Đang thu hoạch", color: "processing" },
  COMPLETED: { label: "Đã kết thúc", color: "success" },
  CANCELLED: { label: "Đã hủy", color: "error" },
};

export const seasonStatus = (v?: string | null) => resolve(SEASON_STATUS, v);

export const FARMING_EVENT_TYPE: Map = {
  WATERING: { label: "Tưới nước", color: "default" },
  FERTILIZING: { label: "Bón phân", color: "default" },
  PEST_CHECK: { label: "Kiểm tra sâu bệnh", color: "default" },
  CARE: { label: "Chăm sóc", color: "default" },
  OTHER: { label: "Khác", color: "default" },
};

export const farmingEventType = (v?: string | null) => resolve(FARMING_EVENT_TYPE, v);

// Returns & complaints ------------------------------------------------------

export const RETURN_STATUS: Map = {
  REQUESTED: { label: "Đã yêu cầu", color: "warning" },
  APPROVED: { label: "Đã chấp nhận", color: "processing" },
  RETURNING: { label: "Đang hoàn hàng", color: "processing" },
  RECEIVED: { label: "Đã nhận hàng", color: "processing" },
  QC_PENDING: { label: "Chờ kiểm định", color: "warning" },
  REFUNDED: { label: "Đã hoàn tiền", color: "success" },
  REJECTED: { label: "Từ chối", color: "error" },
};

export const returnStatus = (v?: string | null) => resolve(RETURN_STATUS, v);

export const COMPLAINT_TYPE: Map = {
  PRODUCT_QUALITY: { label: "Chất lượng sản phẩm", color: "default" },
  DELIVERY: { label: "Giao hàng", color: "default" },
  WRONG_ITEM: { label: "Sai sản phẩm", color: "default" },
  OTHER: { label: "Khác", color: "default" },
};

export const complaintType = (v?: string | null) => resolve(COMPLAINT_TYPE, v);

export const COMPLAINT_STATUS: Map = {
  OPEN: { label: "Mới", color: "warning" },
  PROCESSING: { label: "Đang xử lý", color: "processing" },
  RESOLVED: { label: "Đã giải quyết", color: "success" },
  REJECTED: { label: "Từ chối", color: "error" },
};

export const complaintStatus = (v?: string | null) => resolve(COMPLAINT_STATUS, v);

// Reviews -------------------------------------------------------------------

export const REVIEW_STATUS: Map = {
  PENDING: { label: "Chờ duyệt", color: "warning" },
  APPROVED: { label: "Công khai", color: "success" },
  HIDDEN: { label: "Ẩn", color: "default" },
};

export const reviewStatus = (v?: string | null) => resolve(REVIEW_STATUS, v);

// Promotions ----------------------------------------------------------------

export const DISCOUNT_TYPE: Map = {
  PERCENT: { label: "Phần trăm", color: "default" },
  FIXED: { label: "Số tiền", color: "default" },
};

export const discountType = (v?: string | null) => resolve(DISCOUNT_TYPE, v);

// Warehouse -----------------------------------------------------------------

export const WAREHOUSE_DOC_TYPE: Map = {
  INBOUND: { label: "Nhập kho", color: "success" },
  OUTBOUND: { label: "Xuất kho", color: "processing" },
  ADJUSTMENT: { label: "Điều chỉnh", color: "warning" },
  RETURN: { label: "Hoàn hàng", color: "default" },
};

export const warehouseDocType = (v?: string | null) => resolve(WAREHOUSE_DOC_TYPE, v);

export const WAREHOUSE_DOC_STATUS: Map = {
  DRAFT: { label: "Nháp", color: "warning" },
  COMPLETED: { label: "Đã hoàn thành", color: "success" },
  CANCELLED: { label: "Đã hủy", color: "error" },
};

export const warehouseDocStatus = (v?: string | null) => resolve(WAREHOUSE_DOC_STATUS, v);

export const INVENTORY_MOVEMENT_TYPE: Map = {
  INBOUND: { label: "Nhập kho", color: "success" },
  OUTBOUND: { label: "Xuất kho", color: "processing" },
  ADJUSTMENT: { label: "Điều chỉnh", color: "warning" },
  RESERVE: { label: "Giữ hàng", color: "default" },
  RELEASE: { label: "Giải phóng", color: "default" },
  RETURN: { label: "Hoàn hàng", color: "default" },
};

export const inventoryMovementType = (v?: string | null) =>
  resolve(INVENTORY_MOVEMENT_TYPE, v);

// Finance -------------------------------------------------------------------

export const SETTLEMENT_STATUS: Map = {
  DRAFT: { label: "Nháp", color: "warning" },
  CONFIRMED: { label: "Đã xác nhận", color: "processing" },
  PAID: { label: "Đã chi trả", color: "success" },
};

export const settlementStatus = (v?: string | null) => resolve(SETTLEMENT_STATUS, v);

export const PAYOUT_STATUS: Map = {
  PENDING: { label: "Chờ chi trả", color: "warning" },
  PAID: { label: "Đã chi trả", color: "success" },
  FAILED: { label: "Thất bại", color: "error" },
};

export const payoutStatus = (v?: string | null) => resolve(PAYOUT_STATUS, v);

// Trace ---------------------------------------------------------------------

export const TRACE_EVENT_TYPE: Map = {
  HARVEST: { label: "Thu hoạch", color: "default" },
  QC: { label: "Kiểm định", color: "default" },
  PACKING: { label: "Đóng gói", color: "default" },
  WAREHOUSE_IN: { label: "Nhập kho", color: "default" },
  WAREHOUSE_OUT: { label: "Xuất kho", color: "default" },
  SHIPPING: { label: "Vận chuyển", color: "default" },
  DELIVERED: { label: "Giao hàng", color: "default" },
  RETURNED: { label: "Hoàn hàng", color: "default" },
};

export const traceEventType = (v?: string | null) => resolve(TRACE_EVENT_TYPE, v);

/** Turn a status map into antd `Select` options (label + value). */
export function statusOptions(map: Map): { label: string; value: string }[] {
  return Object.entries(map).map(([value, { label }]) => ({ label, value }));
}
