/**
 * Vietnamese labels for backend enums, used only when building export
 * documents (Excel / PDF).
 *
 * The admin UI already owns the canonical labels (`apps/admin-web/src/lib/status`);
 * these mirror them so an exported file reads the same as the screen. They live
 * in the API because the export is generated server-side and must not depend on
 * a browser.
 */

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_CONFIRMATION: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PREPARING: 'Đang chuẩn bị',
  READY_TO_SHIP: 'Chờ giao',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Đã yêu cầu',
  APPROVED: 'Đã chấp nhận',
  RETURNING: 'Đang hoàn hàng',
  RECEIVED: 'Đã nhận hàng',
  QC_PENDING: 'Chờ kiểm định',
  REFUNDED: 'Đã hoàn tiền',
  REJECTED: 'Từ chối',
};

export const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Mới',
  PROCESSING: 'Đang xử lý',
  RESOLVED: 'Đã giải quyết',
  REJECTED: 'Từ chối',
};

export const COMPLAINT_TYPE_LABEL: Record<string, string> = {
  PRODUCT_QUALITY: 'Chất lượng sản phẩm',
  DELIVERY: 'Giao hàng',
  WRONG_ITEM: 'Sai sản phẩm',
  OTHER: 'Khác',
};

export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  CONFIRMED: 'Đã xác nhận',
  PAID: 'Đã chi trả',
};

export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ chi trả',
  PAID: 'Đã chi trả',
  FAILED: 'Thất bại',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ thanh toán',
  PAID: 'Đã thanh toán',
  PARTIALLY_REFUNDED: 'Hoàn một phần',
  REFUNDED: 'Đã hoàn tiền',
  FAILED: 'Thất bại',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  COD: 'Thanh toán khi nhận hàng',
  VNPAY: 'VNPAY',
};

/** Fall back to the raw enum so an unmapped value is never blank. */
export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}
