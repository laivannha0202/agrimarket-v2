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
  CANCELLED: { label: "Đã hủy", color: "error" },
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

/** Completeness of one lot's public trace chain (Admin audit). */
export const TRACE_CHECK_STATUS: Map = {
  OK: { label: "Đạt", color: "success" },
  WARNING: { label: "Cảnh báo", color: "warning" },
  MISSING: { label: "Thiếu", color: "error" },
};

export const traceCheckStatus = (v?: string | null) => resolve(TRACE_CHECK_STATUS, v);

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
  PENDING: { label: "Chờ duyệt", color: "warning" },
  APPROVED: { label: "Đã duyệt — chờ chi tiền", color: "processing" },
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
  QUARANTINE: { label: "Chuyển cách ly", color: "warning" },
  QUARANTINE_RELEASE: { label: "Giải phóng cách ly", color: "success" },
  SCRAP: { label: "Tiêu hủy", color: "error" },
};

export const inventoryMovementType = (v?: string | null) =>
  resolve(INVENTORY_MOVEMENT_TYPE, v);

export const QUARANTINE_STATUS: Map = {
  PENDING: { label: "Chờ kiểm định lại", color: "warning" },
  PASSED: { label: "Đạt — chờ giải phóng", color: "processing" },
  FAILED: { label: "Không đạt — chờ tiêu hủy", color: "error" },
  RELEASED: { label: "Đã giải phóng", color: "success" },
  SCRAPPED: { label: "Đã tiêu hủy", color: "error" },
};

export const quarantineStatus = (v?: string | null) => resolve(QUARANTINE_STATUS, v);

export const QUARANTINE_SOURCE: Map = {
  ORDER_CANCEL: { label: "Hủy đơn khi đang giao", color: "warning" },
  SHIPMENT_RETURN: { label: "Vận đơn hoàn về", color: "processing" },
  RETURN: { label: "Yêu cầu trả hàng", color: "processing" },
  WAREHOUSE_RETURN: { label: "Phiếu trả hàng kho", color: "default" },
};

export const quarantineSource = (v?: string | null) => resolve(QUARANTINE_SOURCE, v);

/**
 * Which quantity the movement's `before`/`after` columns describe.
 *
 * RESERVE / RELEASE / QUARANTINE move the *reserved* (and blocked) quantity —
 * `quantity_delta` stays 0 because on-hand did not change — while
 * INBOUND / OUTBOUND / ADJUSTMENT / RETURN move the *on-hand* quantity. The
 * table must say which one it is showing, otherwise a reserve row reads as
 * "Thay đổi: 0" next to changing numbers and looks broken.
 */
export function inventoryMovementBasis(type?: string | null): string {
  return type === "RESERVE" || type === "RELEASE" || type === "QUARANTINE"
    ? "Đã giữ"
    : "Tồn thực tế";
}

// Finance -------------------------------------------------------------------

export const SETTLEMENT_STATUS: Map = {
  DRAFT: { label: "Nháp", color: "warning" },
  CONFIRMED: { label: "Đã xác nhận", color: "processing" },
  PAID: { label: "Đã chi trả", color: "success" },
};

export const settlementStatus = (v?: string | null) => resolve(SETTLEMENT_STATUS, v);

export const SETTLEMENT_ADJUSTMENT_STATUS: Map = {
  OPEN: { label: "Chờ xử lý", color: "warning" },
  REVIEWED: { label: "Đã xử lý", color: "success" },
};

export const settlementAdjustmentStatus = (v?: string | null) =>
  resolve(SETTLEMENT_ADJUSTMENT_STATUS, v);

export const SETTLEMENT_ADJUSTMENT_RESOLUTION: Map = {
  DEDUCT_NEXT: { label: "Trừ vào kỳ sau", color: "processing" },
  WRITE_OFF: { label: "Xóa nợ", color: "default" },
  MANUAL: { label: "Xử lý thủ công", color: "default" },
};

export const settlementAdjustmentResolution = (v?: string | null) =>
  resolve(SETTLEMENT_ADJUSTMENT_RESOLUTION, v);

export const SETTLEMENT_RECOVERY_STATUS: Map = {
  PENDING_APPROVAL: { label: "Chờ phê duyệt", color: "warning" },
  APPROVED: { label: "Đã duyệt - chờ thu hồi", color: "processing" },
  RECORDED: { label: "Đã thu hồi", color: "success" },
  REJECTED: { label: "Từ chối", color: "error" },
};

export const settlementRecoveryStatus = (v?: string | null) =>
  resolve(SETTLEMENT_RECOVERY_STATUS, v);

export const PAYOUT_STATUS: Map = {
  PENDING: { label: "Chờ chi trả", color: "warning" },
  PAID: { label: "Đã chi trả", color: "success" },
  FAILED: { label: "Thất bại", color: "error" },
};

export const payoutStatus = (v?: string | null) => resolve(PAYOUT_STATUS, v);

/**
 * Why an order appears in the reconciliation worklist. The wording names the
 * discrepancy, not the fix: this screen reports, it never adjusts money.
 */
export const RECONCILIATION_ISSUE: Map = {
  UNDER_COLLECTED: { label: "Thu thiếu", color: "warning" },
  OVER_COLLECTED: { label: "Thu vượt", color: "error" },
  SETTLED_WITHOUT_FULL_COLLECTION: {
    label: "Đã quyết toán khi chưa thu đủ",
    color: "error",
  },
  REFUND_WITHOUT_COLLECTION: { label: "Hoàn tiền chưa từng thu", color: "error" },
  REFUND_STATUS_MISMATCH: { label: "Trạng thái hoàn tiền lệch", color: "warning" },
  MISSING_COLLECTION_EVIDENCE: { label: "Thiếu bằng chứng thu tiền", color: "error" },
};

export const reconciliationIssue = (v?: string | null) => resolve(RECONCILIATION_ISSUE, v);

/** How much of the obligation the recorded payments cover (API-computed). */
export const COLLECTION_STATE: Map = {
  NONE: { label: "Chưa ghi nhận thu", color: "default" },
  PARTIAL: { label: "Thu một phần", color: "warning" },
  FULL: { label: "Đã thu đủ", color: "success" },
  OVER: { label: "Thu vượt", color: "error" },
};

export const collectionState = (v?: string | null) => resolve(COLLECTION_STATE, v);

/** How much of the collected money was returned. */
export const RECONCILIATION_REFUND_STATE: Map = {
  NONE: { label: "Không hoàn", color: "default" },
  PARTIAL: { label: "Hoàn một phần", color: "processing" },
  FULL: { label: "Hoàn toàn bộ", color: "warning" },
};

export const reconciliationRefundState = (v?: string | null) =>
  resolve(RECONCILIATION_REFUND_STATE, v);

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
