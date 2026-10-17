/**
 * Pure checkout helpers shared by Customer Web and Mobile.
 *
 * Backend remains the source of truth: these only shape requests and interpret
 * responses — they never compute prices, stock or fees. Both platforms run the
 * exact same rules for the "Mua ngay" (buy now) parameter, the 409 conflict
 * classification and the customer-facing failure messages, so the two apps
 * cannot drift apart.
 *
 * The helpers accept a structural view of each app's `ApiError`
 * (`status`/`message`/`body`) instead of importing one, because the two apps
 * keep their own error class while the fields are identical.
 */

import type { PaymentMethod } from "./types";

/** One order line: the same shape `POST /orders/checkout` accepts. */
export interface CheckoutLineInput {
  productVariantId: number;
  quantity: number;
}

/** `?buyNow=<variantId>:<qty>` — one line. Null when malformed. */
export function parseBuyNowParam(value: unknown): CheckoutLineInput[] | null {
  if (typeof value !== "string") return null;
  const [v, q] = value.split(":");
  const productVariantId = Number(v);
  const quantity = Number(q);
  if (!Number.isInteger(productVariantId) || productVariantId <= 0) return null;
  if (!Number.isFinite(quantity) || quantity < 0.001) return null;
  return [{ productVariantId, quantity }];
}

/** The inverse of `parseBuyNowParam`: builds the `buyNow` param value. */
export function buyNowParam(productVariantId: number, quantity: number): string {
  return `${productVariantId}:${quantity}`;
}

/* ------------------------------------------------------------- API errors -- */

/** Structural view of an app `ApiError`. */
export interface ApiErrorLike {
  status: number;
  message?: string | null;
  body?: { message?: unknown } | null;
}

/**
 * Returns the error as `ApiErrorLike` when it carries an HTTP status, else
 * `null`. Works for both apps' `ApiError` classes without importing either.
 */
export function asApiErrorLike(err: unknown): ApiErrorLike | null {
  if (typeof err !== "object" || err === null) return null;
  const candidate = err as { status?: unknown; message?: unknown; body?: unknown };
  if (typeof candidate.status !== "number") return null;
  const body =
    typeof candidate.body === "object" && candidate.body !== null
      ? (candidate.body as { message?: unknown })
      : null;
  return {
    status: candidate.status,
    message: typeof candidate.message === "string" ? candidate.message : "",
    body,
  };
}

/**
 * Every message the failure carries, raw text first.
 *
 * `ApiError.message` has already been run through `translateApiMessage`, so for
 * a message the apps know about it is Vietnamese by the time it gets here —
 * while the backend's own wording (the English text these patterns match) only
 * survives in `body.message`. Both are searched, so classification works the
 * same whether the message was translated or not.
 */
function errorText(err: unknown): string {
  const apiError = asApiErrorLike(err);
  if (!apiError) return "";
  const parts: string[] = [apiError.message ?? ""];
  const raw = apiError.body?.message;
  if (Array.isArray(raw)) parts.push(...raw.map(String));
  else if (typeof raw === "string") parts.push(raw);
  return parts.join(" \u0000 ");
}

/**
 * What a 409 from `POST /orders/checkout` actually means.
 *
 * The backend uses 409 for several *different* conditions, and they need
 * different reactions — collapsing them into "the total changed" would make a
 * retryable in-flight conflict clear the customer's confirmation and demand
 * they re-confirm a total that had not changed at all.
 *
 * Classified by the backend's own message text, because that is the only signal
 * the API exposes (there is no machine-readable error code).
 */
export type CheckoutConflict = "total-changed" | "in-flight" | "key-reuse" | "order-gone" | "other";

const TOTAL_CHANGED = /total changed/i;
const IN_FLIGHT = /still being processed/i;
const KEY_REUSE = /already used with a different checkout payload/i;
const ORDER_GONE = /no longer available/i;

export function classifyCheckoutConflict(err: unknown): CheckoutConflict {
  const apiError = asApiErrorLike(err);
  if (!apiError || apiError.status !== 409) return "other";
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
 * framing is what broke the checkout screen once: demanding a confirmation on
 * arrival showed a permanent "Xác nhận tổng …" bar and disabled the only CTA,
 * so a normal order could never be placed.
 *
 * `checkout-preview` is the authoritative amount, so a first visit needs no
 * confirmation step at all. A confirmation step is owed in exactly ONE
 * situation: the backend re-priced the order *after* the customer was shown a
 * total (the 409 path). Then the new amount is displayed and the customer
 * accepts it with the same single button.
 *
 * `pendingTotal` is `null` when nothing is owed. When it is set, the screen
 * shows the CURRENT preview total, so a further re-price before the tap is
 * confirmed against the latest amount rather than a stale one.
 */
export function needsTotalConfirm(
  preview: { grandTotal: number } | undefined,
  pendingTotal: number | null,
): boolean {
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
 * `signature` covers exactly the inputs the customer controls, so a 409 (which
 * refetches the preview without changing those inputs) keeps its confirmation.
 */
export function carryPendingTotal(
  previousSignature: string,
  signature: string,
  pendingTotal: number | null,
): number | null {
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
  const apiError = asApiErrorLike(err);
  if (!apiError) return "unknown";
  if (apiError.status === 0) return "network";
  if (apiError.status === 401 || apiError.status === 403) return "session";
  const msg = errorText(err);
  if (apiError.status === 409) {
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
  const apiError = asApiErrorLike(err);
  if (!apiError) return null;
  const msg = (apiError.message ?? "").trim();
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
      return "Không kết nối được máy chủ. Vui lòng kiểm tra kết nối mạng rồi thử lại.";
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

/* ------------------------------------------------------------ payload ---- */

/**
 * The address fields the checkout payload needs. Both apps' `Address` type is
 * structurally compatible (nullable codes are normalised to `undefined`).
 */
export interface CheckoutAddressLike {
  recipientName: string;
  phone: string;
  province: string;
  provinceCode?: string | null;
  wardCode?: string | null;
  district?: string | null;
  ward?: string | null;
  village?: string | null;
  detail: string;
}

export interface CheckoutShippingAddressInput {
  recipientName: string;
  phone: string;
  province: string;
  provinceCode?: string;
  wardCode?: string;
  district?: string;
  ward?: string;
  village?: string;
  detail: string;
}

export interface CheckoutPayloadLike {
  shippingAddress: CheckoutShippingAddressInput;
  items?: CheckoutLineInput[];
  voucherCode?: string;
  paymentMethod?: PaymentMethod;
  note?: string;
  expectedGrandTotal?: number;
  source?: CheckoutSource;
}

/**
 * Where the ordered lines came from — and therefore whether the backend may
 * touch the cart once the order commits. Must stay in sync with the API's
 * `CheckoutSource` (`apps/api/src/orders/dto/checkout.dto.ts`).
 *
 * - `CART`: the lines are cart lines; the backend consumes exactly what was
 *   ordered and keeps any remainder.
 * - `BUY_NOW`: a direct purchase ("Mua ngay"); the cart is never written, so
 *   buying B never adds, decrements or removes a cart line — not even a B that
 *   is already there.
 */
export type CheckoutSource = "CART" | "BUY_NOW";

/**
 * Build the checkout payload from the chosen address, the exact lines being
 * ordered (cart selection OR a "Mua ngay" line — the caller decides, this
 * helper never reads the cart), the backend preview, and which of the two
 * sources produced those lines.
 *
 * `source` is required on purpose: it is the only thing that decides whether
 * the backend is allowed to consume cart lines, so no caller may leave it to a
 * default and accidentally let a "Mua ngay" purchase rewrite the cart.
 *
 * A code-verified address sends the official `provinceCode`/`wardCode` pair and
 * no legacy district/ward text: the backend re-resolves the official names from
 * the code and refuses a commune that does not belong to the province. A legacy
 * address sends its own free text untouched.
 *
 * `expectedGrandTotal` is the amount the customer actually saw — the backend
 * refuses a silent re-price with a 409.
 */
export function buildCheckoutPayload(
  address: CheckoutAddressLike,
  items: CheckoutLineInput[],
  voucherCode: string,
  note: string,
  preview: { grandTotal: number },
  source: CheckoutSource,
  paymentMethod: PaymentMethod = "COD",
): CheckoutPayloadLike {
  const verified = Boolean(address.wardCode);
  return {
    shippingAddress: {
      recipientName: address.recipientName,
      phone: address.phone,
      province: address.province,
      provinceCode: address.provinceCode ?? undefined,
      wardCode: address.wardCode ?? undefined,
      district: verified ? undefined : (address.district ?? undefined),
      ward: verified ? undefined : (address.ward ?? undefined),
      village: address.village ?? undefined,
      detail: address.detail,
    },
    items,
    voucherCode: voucherCode || undefined,
    paymentMethod,
    note: note.trim() || undefined,
    expectedGrandTotal: preview.grandTotal,
    source,
  };
}

/* ------------------------------------------------------------ address ---- */

/**
 * One-line display form of a saved address.
 *
 * Prefers the catalogue name (`wardName`, resolved by the backend from the
 * official code) and falls back to the legacy free-text commune — an address
 * saved before the 2025 reorganisation has no `wardName` and must keep showing
 * exactly what the customer typed. `district` is only rendered when there is no
 * catalogue ward, because the current model has no district level.
 */
export function formatAddressLine(address: {
  detail?: string | null;
  village?: string | null;
  wardName?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
}): string {
  return [
    address.detail,
    address.village,
    address.wardName ?? address.ward,
    address.wardName ? null : address.district,
    address.province,
  ]
    .filter(Boolean)
    .join(", ");
}
