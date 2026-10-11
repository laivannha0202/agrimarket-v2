/**
 * Client-side validation for the after-sales forms (returns / complaints /
 * reviews) — mirrors the backend DTOs, never widens or narrows them.
 *
 * Backend contract mirrored here:
 * - `POST /returns`: `orderItemId` int, `quantity >= 0.001`, `reason` non-empty,
 *   `evidenceIds` max 5 (service re-checks returnable quantity + DELIVERED).
 * - `POST /complaints`: `orderId` int, `type` enum, `content` non-empty,
 *   `evidenceIds` max 5 (service re-checks ownership + line belongs to order).
 * - `POST /reviews`: `orderItemId` int, `rating 1..5`, `evidenceIds` max 5
 *   (service re-checks ownership + DELIVERED + not already reviewed).
 *
 * The backend is the authority; this copy exists so the customer gets the
 * message next to the field BEFORE a round trip. A value the API accepts must
 * never be rejected here. Anything unmapped stays a single form-level error.
 */

export type AfterSalesField =
  | "product"
  | "order"
  | "quantity"
  | "reason"
  | "content"
  | "type"
  | "rating"
  | "evidence";

export type AfterSalesFieldErrors = Partial<Record<AfterSalesField, string>>;

export function validateReturnForm(values: {
  hasProduct: boolean;
  quantityText: string;
  maxQuantity: number;
  reason: string;
}): AfterSalesFieldErrors {
  const errors: AfterSalesFieldErrors = {};
  if (!values.hasProduct) {
    errors.product = "Vui lòng chọn sản phẩm cần trả.";
  }
  const requested = Number(values.quantityText);
  if (!values.quantityText.trim() || !Number.isFinite(requested) || requested <= 0) {
    errors.quantity = "Số lượng trả phải lớn hơn 0.";
  } else if (Number.isFinite(values.maxQuantity) && requested > values.maxQuantity) {
    errors.quantity = `Bạn chỉ có thể trả tối đa ${values.maxQuantity} cho sản phẩm này.`;
  }
  if (values.reason.trim().length === 0) {
    errors.reason = "Vui lòng nhập lý do trả hàng.";
  }
  return errors;
}

export function validateComplaintForm(values: {
  hasOrder: boolean;
  content: string;
  hasType: boolean;
}): AfterSalesFieldErrors {
  const errors: AfterSalesFieldErrors = {};
  if (!values.hasOrder) {
    errors.order = "Vui lòng chọn đơn hàng cần khiếu nại.";
  }
  if (!values.hasType) {
    errors.type = "Vui lòng chọn loại khiếu nại.";
  }
  if (values.content.trim().length === 0) {
    errors.content = "Vui lòng mô tả vấn đề bạn gặp phải.";
  }
  return errors;
}

export function validateReviewForm(values: {
  hasProduct: boolean;
  rating: number;
}): AfterSalesFieldErrors {
  const errors: AfterSalesFieldErrors = {};
  if (!values.hasProduct) {
    errors.product = "Vui lòng chọn sản phẩm cần đánh giá.";
  }
  if (!Number.isInteger(values.rating) || values.rating < 1 || values.rating > 5) {
    errors.rating = "Vui lòng chọn số sao từ 1 đến 5.";
  }
  return errors;
}

/**
 * Maps a backend error body onto the after-sales fields.
 *
 * Conservative by design: recognised business sentences (Vietnamese from the
 * services, `You can return at most …`, quantity bounds) map to their field;
 * class-validator English noise (`quantity must …`, `reason must …`) maps by
 * DTO property without leaking the English text; everything else stays a
 * form-level error so internal text never lands under a field.
 */
export function mapAfterSalesFieldErrors(
  message: string | string[] | undefined,
): { fields: AfterSalesFieldErrors; formError: string | null } {
  const fields: AfterSalesFieldErrors = {};
  if (message === undefined) return { fields, formError: null };
  const list = Array.isArray(message) ? message : [message];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text) continue;
    const field = fieldForAfterSalesMessage(text);
    if (field && !fields[field]) {
      fields[field] = fieldTextForAfterSalesMessage(field, text);
    }
  }
  const mapped = Object.keys(fields).length > 0;
  const firstString = list.find((item): item is string => typeof item === "string") ?? null;
  return { fields, formError: mapped ? null : firstString };
}

const VIETNAMESE_MESSAGES: Record<string, AfterSalesField> = {
  "Vui lòng chọn sản phẩm cần trả.": "product",
  "Vui lòng chọn đơn hàng cần khiếu nại.": "order",
  "Vui lòng mô tả vấn đề bạn gặp phải.": "content",
  "Vui lòng chọn sản phẩm cần đánh giá.": "product",
  "Bạn chỉ có thể yêu cầu trả hàng cho đơn của mình.": "product",
  "Bạn chỉ có thể khiếu nại cho đơn hàng của mình.": "order",
  "Bạn chỉ có thể đánh giá sản phẩm mình đã mua.": "product",
  "Chỉ đơn hàng đã giao mới được yêu cầu trả hàng.": "product",
  "Chỉ đơn hàng đã giao mới được đánh giá.": "product",
  "Số lượng trả không được vượt quá số lượng đã mua.": "quantity",
  "Sản phẩm này đã được đánh giá.": "product",
  "Sản phẩm này đã được yêu cầu trả toàn bộ trong yêu cầu khác.": "quantity",
  "Sản phẩm khiếu nại không thuộc đơn hàng này.": "product",
  "Ảnh đính kèm không hợp lệ hoặc đã thuộc yêu cầu khác. Vui lòng tải lại ảnh.": "evidence",
  "Mỗi yêu cầu gửi tối đa 5 ảnh.": "evidence",
  "Chỉ nhận ảnh JPG, PNG hoặc WebP.": "evidence",
  "Ảnh vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.": "evidence",
  "Tệp không phải ảnh hợp lệ. Vui lòng tải lên ảnh JPG, PNG hoặc WebP thật.": "evidence",
};

const DTO_PROPERTY_TO_FIELD: Record<string, AfterSalesField> = {
  orderItemId: "product",
  orderId: "order",
  quantity: "quantity",
  reason: "reason",
  content: "content",
  type: "type",
  rating: "rating",
  evidenceIds: "evidence",
};

function fieldForAfterSalesMessage(text: string): AfterSalesField | null {
  const exact = VIETNAMESE_MESSAGES[text];
  if (exact) return exact;
  if (/^You can return at most [\d.]+ of this item$/.test(text)) return "quantity";
  const propertyMatch = /^(orderItemId|orderId|quantity|reason|content|type|rating|evidenceIds)\b/.exec(
    text,
  );
  if (propertyMatch) return DTO_PROPERTY_TO_FIELD[propertyMatch[1]!] ?? null;
  return null;
}

function fieldTextForAfterSalesMessage(field: AfterSalesField, text: string): string {
  if (VIETNAMESE_MESSAGES[text] !== undefined) return text;
  if (/^You can return at most [\d.]+ of this item$/.test(text)) {
    return "Số lượng trả vượt quá số lượng còn có thể trả của sản phẩm này.";
  }
  switch (field) {
    case "product":
      return "Vui lòng chọn sản phẩm.";
    case "order":
      return "Vui lòng chọn đơn hàng.";
    case "quantity":
      return "Số lượng chưa hợp lệ.";
    case "reason":
      return "Vui lòng nhập lý do trả hàng.";
    case "content":
      return "Vui lòng mô tả vấn đề bạn gặp phải.";
    case "type":
      return "Vui lòng chọn loại khiếu nại.";
    case "rating":
      return "Vui lòng chọn số sao từ 1 đến 5.";
    case "evidence":
      return "Ảnh đính kèm chưa hợp lệ. Vui lòng kiểm tra lại.";
    default:
      return "Giá trị chưa hợp lệ.";
  }
}
