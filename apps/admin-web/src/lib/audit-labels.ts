/**
 * Vietnamese labels for the audit log.
 *
 * The backend stores actions and entity types as enums (`ORDER_CANCEL`,
 * `InventoryBalance`) because they are log keys, not prose. Printing them raw
 * on the console put English identifiers in front of Vietnamese operators —
 * "QuarantineCase #12" tells nobody what happened. These maps translate the
 * known values and keep an honest fallback for a new action that ships before
 * the console learns its name: the raw key is shown in a monospace tag rather
 * than silently mislabelled.
 */

export const ENTITY_LABEL: Record<string, string> = {
  Certificate: "Chứng nhận",
  FarmingEvent: "Nhật ký canh tác",
  Harvest: "Vụ thu hoạch",
  InventoryBalance: "Tồn kho",
  Order: "Đơn hàng",
  Partner: "Đối tác",
  Payment: "Thanh toán",
  Payout: "Chi trả",
  ProductLot: "Lô hàng",
  ProductVariant: "Quy cách sản phẩm",
  QuarantineCase: "Hồ sơ cách ly",
  Refund: "Hoàn tiền",
  ReturnRequest: "Yêu cầu trả hàng",
  Season: "Mùa vụ",
  Settlement: "Kỳ đối soát",
  SettlementAdjustment: "Điều chỉnh đối soát",
  SettlementRecovery: "Thu hồi sau đối soát",
  Shipment: "Vận đơn",
  User: "Người dùng",
  Voucher: "Voucher",
  FlashSale: "Flash sale",
  CommissionRule: "Quy tắc hoa hồng",
  Warehouse: "Kho",
  WarehouseDocument: "Phiếu kho",
};

/** Actions whose meaning is not a simple `<entity>_<verb>` pair. */
const ACTION_LABEL: Record<string, string> = {
  CREATE: "Tạo mới",
  UPDATE: "Cập nhật",
  UPDATE_VARIANT: "Cập nhật quy cách",
  RECALL: "Thu hồi lô hàng",
  ORDER_CREATE: "Tạo đơn hàng",
  ORDER_CANCEL: "Hủy đơn hàng",
  ORDER_CANCELLED: "Hủy đơn hàng",
  ORDER_STATUS: "Đổi trạng thái đơn hàng",
  ORDER_RESERVATION_EXPIRED: "Hết hạn giữ tồn",
  INVENTORY_ADJUSTMENT: "Điều chỉnh tồn kho",
  USER_REGISTERED: "Đăng ký tài khoản",
  PASSWORD_CHANGED: "Đổi mật khẩu",
  PASSWORD_RESET_REQUESTED: "Yêu cầu đặt lại mật khẩu",
  PASSWORD_RESET_COMPLETED: "Đặt lại mật khẩu",
  FARMING_EVENT_CREATE: "Thêm nhật ký canh tác",
  FARMING_EVENT_UPDATE: "Sửa nhật ký canh tác",
  HARVEST_CREATE: "Tạo vụ thu hoạch",
  HARVEST_UPDATE: "Cập nhật vụ thu hoạch",
  SEASON_CREATE: "Tạo mùa vụ",
  SEASON_UPDATE: "Cập nhật mùa vụ",
  QUARANTINE_CREATE: "Tạo hồ sơ cách ly",
  REFUND_CREATE: "Tạo yêu cầu hoàn tiền",
  REFUND_APPROVE: "Duyệt hoàn tiền",
  REFUND_COMPLETE: "Hoàn tất hoàn tiền",
  REFUND_FAIL: "Từ chối hoàn tiền",
  PAYOUT_CREATE: "Tạo lệnh chi trả",
  PAYOUT_PAID: "Đã chi trả",
  SETTLEMENT_CREATE: "Tạo kỳ đối soát",
  SETTLEMENT_CONFIRM: "Xác nhận kỳ đối soát",
  SETTLEMENT_ADJUSTMENT_REVIEW: "Xử lý điều chỉnh đối soát",
  SETTLEMENT_RECOVERY_REQUEST: "Yêu cầu thu hồi",
  SETTLEMENT_RECOVERY_RECORD: "Ghi nhận thu hồi",
  SHIPMENT_CREATE: "Tạo vận đơn",
  WAREHOUSE_CREATE: "Tạo kho",
  WAREHOUSE_UPDATE: "Cập nhật kho",
  WAREHOUSE_DEACTIVATE: "Ngừng hoạt động kho",
  WAREHOUSE_DOCUMENT_CANCEL: "Hủy phiếu kho",
  WAREHOUSE_DOCUMENT_COMPLETE: "Hoàn tất phiếu kho",
  WAREHOUSE_DOCUMENT_UPDATE_DRAFT: "Sửa phiếu kho nháp",
};

/** Verbs that follow an entity prefix, e.g. `PAYMENT_PAID`, `QC_PASS`. */
const VERB_LABEL: Record<string, string> = {
  CREATE: "tạo mới",
  UPDATE: "cập nhật",
  DELETE: "xóa",
  PAID: "đã thanh toán",
  PENDING: "chờ xử lý",
  FAILED: "thất bại",
  REFUNDED: "đã hoàn tiền",
  PARTIALLY_REFUNDED: "hoàn một phần",
  PASS: "đạt",
  FAIL: "không đạt",
  PENDING_QC: "chờ kiểm định",
  RELEASE: "giải phóng",
  SCRAP: "tiêu hủy",
  INSPECT_PASS: "kiểm định đạt",
  INSPECT_FAIL: "kiểm định không đạt",
  PENDING_CONFIRMATION: "chờ xác nhận",
  CONFIRMED: "đã xác nhận",
  PREPARING: "đang chuẩn bị",
  READY_TO_SHIP: "sẵn sàng giao",
  SHIPPING: "đang giao",
  DELIVERED: "đã giao",
  CANCELLED: "đã hủy",
  APPROVED: "đã duyệt",
  REJECTED: "đã từ chối",
  COMPLETED: "hoàn tất",
  IN_TRANSIT: "đang vận chuyển",
  OUT_FOR_DELIVERY: "đang giao đến khách",
  DELIVERY_FAILED: "giao thất bại",
  RETURNING: "đang hoàn hàng",
  RETURNED: "đã hoàn hàng",
  VERIFIED: "đã xác minh",
  UNVERIFIED: "chưa xác minh",
};

/** Entity prefixes that may appear before a status/verb in a dynamic action. */
const ACTION_PREFIX: Array<[string, string]> = [
  ["ORDER", "Đơn hàng"],
  ["PAYMENT", "Thanh toán"],
  ["REFUND", "Hoàn tiền"],
  ["RETURN", "Trả hàng"],
  ["SHIPMENT", "Vận đơn"],
  ["QUARANTINE", "Cách ly"],
  ["QC", "Kiểm định"],
  ["CERTIFICATE", "Chứng nhận"],
];

/**
 * Human label for an audit action. Unknown keys fall back to the raw enum so a
 * new backend action is visible (and searchable) instead of being hidden.
 */
export function auditActionLabel(action: string): string {
  const direct = ACTION_LABEL[action];
  if (direct) return direct;

  for (const [prefix, noun] of ACTION_PREFIX) {
    if (!action.startsWith(`${prefix}_`)) continue;
    const verbKey = action.slice(prefix.length + 1);
    const verb = VERB_LABEL[verbKey];
    return verb ? `${noun}: ${verb}` : `${noun}: ${verbKey.toLowerCase()}`;
  }
  return action;
}

export function entityTypeLabel(type: string): string {
  return ENTITY_LABEL[type] ?? type;
}

/** Select options for the entity filter, in the order the console uses. */
export const ENTITY_TYPE_OPTIONS = Object.entries(ENTITY_LABEL).map(([value, label]) => ({
  value,
  label,
}));
