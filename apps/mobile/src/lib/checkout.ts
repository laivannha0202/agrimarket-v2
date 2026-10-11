/**
 * Pure checkout helpers (unit-testable, no React Native imports).
 * Backend remains the source of truth: these only shape requests and
 * interpret responses, never compute prices, stock or fees.
 */

import { ApiError } from "./api-client";
import type { Address, CheckoutPreview } from "./types";
import type { CheckoutPayload } from "./resources";

export interface CheckoutLineInput {
  productVariantId: number;
  quantity: number;
}

/** Parse `?buyNow=<variantId>:<qty>`; null when malformed. */
export function parseBuyNowParam(value: unknown): CheckoutLineInput[] | null {
  if (typeof value !== "string") return null;
  const [v, q] = value.split(":");
  const productVariantId = Number(v);
  const quantity = Number(q);
  if (!Number.isInteger(productVariantId) || productVariantId <= 0) return null;
  if (!Number.isFinite(quantity) || quantity < 0.001) return null;
  return [{ productVariantId, quantity }];
}

export function buildCheckoutPayload(
  address: Address,
  items: CheckoutLineInput[],
  voucherCode: string,
  note: string,
  preview: CheckoutPreview,
): CheckoutPayload {
  return {
    shippingAddress: {
      recipientName: address.recipientName,
      phone: address.phone,
      province: address.province,
      // The verified pair, when the address was saved against the catalogue.
      // The backend re-resolves the official name from the code, so sending the
      // codes is what lets it reject a commune that does not exist or belongs to
      // another province. Legacy text is only sent for addresses saved before
      // the reorganisation — the backend stores one generation or the other.
      provinceCode: address.provinceCode ?? undefined,
      wardCode: address.wardCode ?? undefined,
      district: address.district ?? undefined,
      ward: address.ward ?? undefined,
      village: address.village ?? undefined,
      detail: address.detail,
    },
    items,
    voucherCode: voucherCode || undefined,
    paymentMethod: "COD",
    note: note || undefined,
    expectedGrandTotal: preview.grandTotal,
  };
}

/**
 * What a 409 from `POST /orders/checkout` actually means.
 *
 * The backend uses 409 for several *different* conditions, and they need
 * different reactions — collapsing them into "the total changed" (which the app
 * originally did) made a retryable in-flight conflict clear the customer's
 * confirmation and demand they re-confirm a total that had not changed at all.
 *
 * Classified by the backend's own message text, because that is the only signal
 * the API exposes (there is no machine-readable error code).
 */
export type CheckoutConflict =
  | "total-changed"
  | "in-flight"
  | "key-reuse"
  | "order-gone"
  | "other";

const TOTAL_CHANGED = /total changed/i;
const IN_FLIGHT = /still being processed/i;
const KEY_REUSE = /already used with a different checkout payload/i;
const ORDER_GONE = /no longer available/i;

/**
 * Every message the failure carries, raw text first.
 *
 * `ApiError.message` has already been run through `translateApiMessage`, so for
 * a message the app knows about it is Vietnamese by the time it gets here —
 * while the backend's own wording (the English text these patterns match) only
 * survives in `body.message`. Both are searched, so classification works the
 * same whether the message was translated or not.
 */
function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "";
  const parts: string[] = [err.message ?? ""];
  const raw = err.body?.message;
  if (Array.isArray(raw)) parts.push(...raw.map(String));
  else if (typeof raw === "string") parts.push(raw);
  return parts.join(" \u0000 ");
}

export function classifyCheckoutConflict(err: unknown): CheckoutConflict {
  if (!(err instanceof ApiError) || err.status !== 409) return "other";
  const msg = errorText(err);
  if (TOTAL_CHANGED.test(msg)) return "total-changed";
  if (IN_FLIGHT.test(msg)) return "in-flight";
  if (KEY_REUSE.test(msg)) return "key-reuse";
  if (ORDER_GONE.test(msg)) return "order-gone";
  return "other";
}

/**
 * WHY the customer must tap once more before the order is created.
 *
 * Deliberately NOT derived from "has the customer confirmed the total" — that
 * framing is what broke the screen. `checkout-preview` is the authoritative
 * amount, so a first visit needs no confirmation step at all; demanding one
 * showed a permanent "Xác nhận tổng …" bar and disabled the only CTA, so a
 * normal order could never be placed.
 *
 * A confirmation step is owed in exactly ONE situation: the backend re-priced
 * the order *after* the customer was shown a total (the 409 path). Then the new
 * amount is displayed and the customer accepts it with the same single button.
 *
 * `pendingTotal` is `null` when nothing is owed. When it is set, the screen
 * shows the CURRENT preview total, so a further re-price before the tap is
 * confirmed against the latest amount rather than a stale one.
 */
export function needsTotalConfirm(preview: CheckoutPreview | undefined, pendingTotal: number | null): boolean {
  return preview !== undefined && pendingTotal !== null;
}

/**
 * Carry the pending re-price confirmation across a render, or drop it.
 *
 * A re-price confirmation is owed to the customer only while the order they are
 * looking at is the one the backend re-priced. The moment they edit the lines,
 * the voucher or the address, the refreshed preview IS their own new total — so
 * the flag is dropped and they get the normal single button back.
 *
 * Without this the screen would show "Giá vừa được cập nhật" for a change the
 * customer just made themselves, which is the same pointless second
 * confirmation that made a normal order impossible to place.
 *
 * `signature` covers exactly the inputs the customer controls, so a 409 (which
 * refetches the preview without changing those inputs) keeps its confirmation.
 */
export function carryPendingTotal(previousSignature: string, signature: string, pendingTotal: number | null): number | null {
  return previousSignature === signature ? pendingTotal : null;
}

/** Cause of a failed submit, so the screen can explain the real reason. */
export type CheckoutErrorCause =
  | "network"
  | "session"
  | "total-changed"
  | "stock"
  | "voucher"
  | "address"
  | "unknown";

const STOCK_MSG =
  /insufficient sellable stock|flash sale quota exceeded|per-customer flash sale limit|no longer for sale|is no longer available|không còn đủ hàng|hết suất|giới hạn số lượng mua/i;
const VOUCHER_MSG = /voucher|mã giảm giá/i;
const ADDRESS_MSG =
  /xã\/phường|tỉnh\/thành phố|số điện thoại|người nhận|địa chỉ chi tiết|province|ward|phone|recipient|shipping address/i;

/**
 * Classify a submit failure by CAUSE.
 *
 * The backend answers with a plain message and no machine-readable code, so the
 * cause is read from the HTTP status first (unambiguous) and the message text
 * second. 409 is split by `classifyCheckoutConflict`, because "the price moved"
 * and "your request is still in flight" need opposite reactions.
 */
export function classifyCheckoutError(err: unknown): CheckoutErrorCause {
  if (!(err instanceof ApiError)) return "unknown";
  if (err.status === 0) return "network";
  if (err.status === 401 || err.status === 403) return "session";
  const msg = errorText(err);
  if (err.status === 409) {
    return classifyCheckoutConflict(err) === "total-changed" ? "total-changed" : "unknown";
  }
  if (STOCK_MSG.test(msg)) return "stock";
  if (VOUCHER_MSG.test(msg)) return "voucher";
  if (ADDRESS_MSG.test(msg)) return "address";
  return "unknown";
}

/**
 * The backend's own message, translated, or `null` when there is nothing
 * specific to show.
 *
 * `ApiError.message` has already been through `translateApiMessage`; when that
 * produced Vietnamese the text names the exact rule that failed, so it is worth
 * showing verbatim. When the message was left as raw English (an unmapped
 * sentence) the caller should use its own cause-based wording instead of
 * printing English at the customer.
 */
export function translatedMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const msg = (err.message ?? "").trim();
  if (!msg) return null;
  // Vietnamese text is safe to show; anything else falls back to the cause.
  return /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(msg)
    ? msg
    : null;
}

/**
 * Customer-facing text for a failed submit.
 *
 * The backend's own message wins whenever it was translated into Vietnamese
 * (it names the exact rule that failed); otherwise the cause supplies a
 * sentence that says what to do next. Nothing here changes a business rule —
 * the decision was already made server-side.
 */
export function checkoutErrorMessage(err: unknown, translated: string | null): string {
  const cause = classifyCheckoutError(err);
  if (translated) return translated;
  switch (cause) {
    case "network":
      return "Không kết nối được máy chủ. Vui lòng kiểm tra Wi-Fi rồi thử lại.";
    case "session":
      return "Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.";
    case "total-changed":
      return "Giá hoặc khuyến mãi vừa thay đổi. Vui lòng xem lại tổng tiền mới và xác nhận.";
    case "stock":
      return "Sản phẩm này không còn đủ hàng để đặt. Vui lòng giảm số lượng hoặc chọn sản phẩm khác.";
    case "voucher":
      return "Mã giảm giá không còn áp dụng được cho đơn này.";
    case "address":
      return "Địa chỉ giao hàng chưa hợp lệ. Vui lòng kiểm tra lại.";
    default:
      return "Đặt hàng thất bại. Vui lòng thử lại.";
  }
}

/**
 * One-line display form of a saved address.
 *
 * Prefers the catalogue name (`wardName`, resolved by the backend from the
 * official code) and falls back to the legacy free-text commune — an address
 * saved before the 2025 reorganisation has no `wardName` and must keep showing
 * exactly what the customer typed. `district` is only rendered when there is no
 * catalogue ward, because the current model has no district level.
 */
export function addressSummary(a: Address): string {
  const commune = a.wardName ?? a.ward;
  const locality = a.wardName ? [commune, a.province] : [commune, a.district, a.province];
  return [a.detail, ...locality].filter(Boolean).join(", ");
}

export function validateAddressInput(input: {
  recipientName: string;
  phone: string;
  province: string;
  detail: string;
}): string | null {
  if (!input.recipientName.trim() || !input.phone.trim() || !input.province.trim() || !input.detail.trim()) {
    return "Vui lòng nhập họ tên, điện thoại, tỉnh và địa chỉ chi tiết.";
  }
  return null;
}
