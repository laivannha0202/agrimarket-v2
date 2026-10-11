/**
 * Backend contract types for the Customer Web.
 *
 * These mirror the actual JSON returned by the AgriMarket V2 API. Numeric
 * columns arrive as strings (Prisma `Decimal` serialised to JSON) and are typed
 * as such on purpose — never assume they are already numbers.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type RecordStatus = "ACTIVE" | "INACTIVE";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type UserRole = "ADMIN" | "CUSTOMER";

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  fullName: string;
  /** The customer's own phone number, used to prefill the profile form. */
  phone?: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/** `POST /auth/register` — no session is issued; the customer then signs in. */
export interface RegisterResponse {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
}

/**
 * `POST /auth/forgot-password`.
 *
 * `delivery.mode` reports which mail transport the API is running with:
 * `smtp` means a real e-mail left the server, `test` means it was only captured
 * (no SMTP configured). The UI must not promise delivery in `test` mode.
 */
export interface ForgotPasswordResponse {
  message: string;
  delivery: { mode: "smtp" | "test"; delivered: boolean };
}

/** `POST /auth/reset-password`. */
export interface ResetPasswordResponse {
  message: string;
}

/** `PATCH /auth/change-password` — a fresh token for the device that changed it. */
export interface ChangePasswordResponse {
  accessToken: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface Category {
  id: number;
  name: string;
  slug: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: number;
  productId: number;
  url: string;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface ProductVariant {
  id: number;
  productId: number;
  sku: string;
  name: string;
  weight: string | null;
  weightUnit: string | null;
  saleUnit: string;
  basePrice: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Backend-resolved price of a variant (flash sale > product discount > base).
 *
 * `unitPrice` is authoritative: it comes from the same resolution the checkout
 * uses, so the UI never has to combine promotions itself.
 */
export interface VariantPrice {
  basePrice: number;
  unitPrice: number;
  discountAmount: number;
  source: "NONE" | "PRODUCT_DISCOUNT" | "FLASH_SALE";
}

/**
 * A variant as returned by the public catalog (`GET /products`,
 * `GET /products/:id`): the plain variant plus the server price and the live
 * sellable quantity.
 */
export interface PricedVariant extends ProductVariant {
  effectivePrice: VariantPrice;
  availableQuantity: number;
  inStock: boolean;
}

export interface ProductCategoryRef {
  id: number;
  name: string;
  slug: string;
}

export interface ProductPartnerRef {
  id: number;
  code: string;
  name: string;
}

export interface Product {
  id: number;
  partnerId: number;
  categoryId: number;
  farmId: number | null;
  name: string;
  slug: string;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  category: ProductCategoryRef;
  partner: ProductPartnerRef;
  images: ProductImage[];
  variants: PricedVariant[];
}

// ---------------------------------------------------------------------------
// Partner / Farm / Certificates
// ---------------------------------------------------------------------------

export interface Partner {
  id: number;
  code: string;
  name: string;
  representativeName: string;
  phone: string;
  email: string;
  address: string;
  taxCode: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerRef {
  id: number;
  code: string;
  name: string;
}

export interface Farm {
  id: number;
  code: string;
  partnerId: number;
  name: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  areaHa: string | null;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  partner: PartnerRef;
}

export interface Certificate {
  id: number;
  farmId: number;
  type: string;
  certificateCode: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  fileUrl: string | null;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  verifiedAt: string | null;
  rejectionReason: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface Review {
  id: number;
  customerId: number;
  orderItemId: number;
  productId: number;
  rating: number;
  content: string | null;
  status: "PENDING" | "APPROVED" | "HIDDEN";
  createdAt: string;
  updatedAt: string;
  customer: { fullName: string };
  /** Evidence photos. Public only while the review is APPROVED. */
  evidence?: EvidenceImage[];
}

/**
 * One evidence photo as the API describes it.
 *
 * There is no `url`: the file is private and served by `GET /evidence/:id/file`,
 * so the client fetches the bytes with its session and renders a blob URL. A
 * URL in the payload would imply the image is reachable without one.
 */
export interface EvidenceImage {
  id: number;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes?: number;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

export interface TraceLot {
  code: string;
  traceCode: string;
  grade: string;
  unit: string;
  quantity: string;
  remainingQuantity: string;
  packedAt: string | null;
  expiresAt: string;
  status:
    | "PENDING_QC"
    | "QUARANTINED"
    | "SELLABLE"
    | "REJECTED"
    | "RECALLED"
    | "EXPIRED"
    | "LOCKED";
  isExpired: boolean;
}

export interface TraceResult {
  lot: TraceLot;
  product: {
    name: string;
    slug: string;
    description: string | null;
    category: string;
    images: string[];
  };
  partner: {
    name: string;
    representativeName: string;
  };
  farm: {
    name: string;
    address: string;
    areaHa: string | null;
    description: string | null;
  };
  season: {
    cropName: string;
    variety: string | null;
    plantingDate: string;
    expectedHarvestDate: string;
    status: string;
  };
  farmingEvents: Array<{
    type: string;
    occurredAt: string;
    content: string;
  }>;
  harvest: {
    harvestDate: string;
    quantity: string;
    unit: string;
    grade: string;
  };
  qualityControl: {
    result: "PASS" | "FAIL";
    appearancePassed: boolean;
    freshnessPassed: boolean;
    packagingPassed: boolean;
    damagePassed: boolean;
    inspectedAt: string;
  } | null;
  certificates: Array<{
    type: string;
    certificateCode: string;
    issuer: string;
    issuedAt: string;
    expiresAt: string;
    verifiedAt: string | null;
  }>;
  traceEvents: Array<{
    type: string;
    occurredAt: string;
    location: string | null;
    description: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/**
 * Product shape embedded in a cart response.
 *
 * IMPORTANT: `GET /carts/me` includes only the plain `product` row — there is
 * no `partner`, `images`, `category` or `variants` relation (verified against
 * the live API; `CartsService` uses `include: { product: true }`). Only
 * `partnerId` is available, so any partner name or product image shown next to
 * a cart line has to be resolved from the public resources (see
 * `useCartProductInfo`). Modelling this as the full `Product` would let the UI
 * compile while dereferencing fields the API never sends.
 */
export interface CartProductRef {
  id: number;
  partnerId: number;
  categoryId: number;
  farmId: number | null;
  name: string;
  slug: string;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  id: number;
  cartId: number;
  productVariantId: number;
  quantity: string;
  createdAt: string;
  updatedAt: string;
  productVariant: ProductVariant & {
    product: CartProductRef;
  };
}

export interface Cart {
  id: number;
  customerId: number;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * A saved delivery address.
 *
 * TWO GENERATIONS, ONE ROW
 *
 * New addresses carry `provinceCode` + `wardCode` (official 2025 codes, stored
 * as strings) and the catalogue's official `wardName`. The legacy free-text
 * `district` / `ward` columns are still returned for addresses saved before the
 * reorganisation; they are never backfilled, so an old address keeps showing
 * exactly what the customer typed.
 *
 * A display line must therefore prefer `wardName` and fall back to `ward`.
 */
export interface Address {
  id: number;
  customerId: number;
  recipientName: string;
  phone: string;
  province: string;
  provinceCode: string | null;
  wardCode: string | null;
  /** Official commune name resolved by the backend from `wardCode`. */
  wardName: string | null;
  /** @deprecated Legacy free-text district (pre-2025 model). */
  district: string | null;
  /** @deprecated Legacy free-text commune; superseded by `wardName`. */
  ward: string | null;
  village: string | null;
  detail: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Address payload accepted by `POST/PATCH /customers/me/addresses`.
 *
 * `provinceCode` + `wardCode` are the verified pair: the backend resolves the
 * official name from the catalogue and rejects a code that is unknown or that
 * belongs to another province. `province` / `district` / `ward` are kept for
 * legacy rows only.
 */
export interface ShippingAddressInput {
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

/** Shape stored in `Order.shippingAddressSnapshot`. */
export interface ShippingAddressSnapshot {
  recipientName?: string;
  phone?: string;
  province?: string;
  provinceCode?: string;
  wardCode?: string;
  wardName?: string;
  district?: string;
  ward?: string;
  village?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Locations (administrative catalogue)
// ---------------------------------------------------------------------------

/** `GET /locations/provinces` — the provinces the storefront delivers to. */
export interface Province {
  /** Official code, always a string (e.g. `"33"`). */
  code: string;
  name: string;
  fullName: string;
}

/** `GET /locations/provinces/:code/wards` — one xã/phường. */
export interface Ward {
  /** Official 5-digit code, always a string (e.g. `"11953"`). */
  code: string;
  /** Official name with its prefix — this is what the UI displays. */
  fullName: string;
  name: string;
  type: string;
  provinceCode: string;
  provinceName: string;
  effectiveFrom: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_TO_SHIP"
  | "SHIPPING"
  | "DELIVERED"
  | "CANCELLED";

export type PartnerOrderStatus = OrderStatus;

export type PaymentMethod = "COD" | "VNPAY" | "MOCK_ONLINE";

export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "FAILED";

export type ShipmentStatus =
  | "PENDING"
  | "READY"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RETURNING"
  | "RETURNED";

export interface OrderItem {
  id: number;
  partnerOrderId: number;
  productVariantId: number;
  productNameSnapshot: string;
  skuSnapshot: string;
  unitPriceSnapshot: string;
  quantity: string;
  subtotal: string;
  discountAmount: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The lots this item was actually fulfilled from (FEFO). Only present on the
   * customer order detail (`GET /orders/me/:id`); the lot's `traceCode` links
   * straight to the public traceability page.
   */
  allocations?: OrderItemAllocation[];
}

/** One `OrderItem` → `ProductLot` slice, as returned to the order's owner. */
export interface OrderItemAllocation {
  quantity: string;
  productLot: {
    code: string;
    traceCode: string;
    grade: string;
    unit: string;
    expiresAt: string;
    status: TraceLot["status"];
  };
}

export interface ShipmentEvent {
  id: number;
  shipmentId: number;
  status: ShipmentStatus;
  occurredAt: string;
  note: string | null;
  createdAt: string;
}

export interface Shipment {
  id: number;
  code: string;
  partnerOrderId: number;
  carrier: string | null;
  trackingCode: string | null;
  status: ShipmentStatus;
  failureReason: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  events?: ShipmentEvent[];
}

export interface Fulfillment {
  id: number;
  partnerOrderId: number;
  status: "PENDING" | "PACKING" | "PACKED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
}

export interface PartnerOrder {
  id: number;
  code: string;
  orderId: number;
  partnerId: number;
  subtotal: string;
  discountTotal: string;
  commissionAmount: string;
  payableAmount: string;
  status: PartnerOrderStatus;
  createdAt: string;
  updatedAt: string;
  partner: PartnerRef;
  items: OrderItem[];
  shipments?: Shipment[];
  fulfillments?: Fulfillment[];
}

export interface PaymentRefund {
  id: number;
  paymentId: number;
  amount: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: number;
  orderId: number;
  method: PaymentMethod;
  amount: string;
  status: PaymentStatus;
  transactionReference: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  refunds?: PaymentRefund[];
}

export interface VoucherRedemption {
  id: number;
  voucherId: number;
  customerId: number;
  orderId: number;
  discountAmount: string;
  createdAt: string;
}

/**
 * `POST /orders/checkout-preview` — the authoritative pre-submit amount.
 *
 * Nothing is created or reserved by a preview; the backend resolves the price,
 * validates the voucher and reports the shipping fee it will charge, so the
 * checkout screen never computes a total itself.
 */
export interface CheckoutPreviewLine {
  productVariantId: number;
  productName: string;
  sku: string;
  quantity: number;
  basePrice: number;
  unitPrice: number;
  discountAmount: number;
  subtotal: number;
  priceSource: "NONE" | "PRODUCT_DISCOUNT" | "FLASH_SALE";
  availableQuantity: number;
  available: boolean;
}

export interface CheckoutPreview {
  items: CheckoutPreviewLine[];
  itemCount: number;
  subtotal: number;
  discountTotal: number;
  voucher: { code: string; discountAmount: number } | null;
  shippingFee: number;
  grandTotal: number;
}

export interface Order {
  id: number;
  code: string;
  customerId: number;
  shippingAddressSnapshot: ShippingAddressSnapshot;
  subtotal: string;
  discountTotal: string;
  shippingFee: string;
  grandTotal: string;
  status: OrderStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  partnerOrders: PartnerOrder[];
  payments: Payment[];
  voucherRedemptions: VoucherRedemption[];
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export interface Voucher {
  id: number;
  code: string;
  name: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  minOrderAmount: string;
  maxDiscount: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  startsAt: string;
  endsAt: string;
  status: RecordStatus;
}

export interface ProductDiscount {
  id: number;
  productVariantId: number;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  startsAt: string;
  endsAt: string;
  status: RecordStatus;
  productVariant: { id: number; sku: string; name: string };
}

export interface FlashSaleItem {
  id: number;
  flashSaleId: number;
  productVariantId: number;
  flashPrice: string;
  quota: number;
  soldQuantity: number;
  perCustomerLimit: number;
  productVariant: ProductVariant;
}

export interface FlashSale {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  status: RecordStatus;
  items: FlashSaleItem[];
}

// ---------------------------------------------------------------------------
// Returns & Complaints
// ---------------------------------------------------------------------------

export type ReturnRequestStatus =
  | "REQUESTED"
  | "APPROVED"
  | "RETURNING"
  | "RECEIVED"
  | "QC_PENDING"
  | "REFUNDED"
  | "REJECTED";

export interface ReturnRequest {
  id: number;
  orderId: number;
  orderItemId: number;
  customerId: number;
  quantity: string;
  reason: string;
  status: ReturnRequestStatus;
  refundId: number | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the customer-facing list/detail responses. */
  order?: { id: number; code: string };
  refund?: PaymentRefund | null;
  /** Evidence photos attached when the request was created. */
  evidence?: EvidenceImage[];
}

export type ComplaintType =
  | "PRODUCT_QUALITY"
  | "DELIVERY"
  | "WRONG_ITEM"
  | "OTHER";

export type ComplaintStatus = "OPEN" | "PROCESSING" | "RESOLVED" | "REJECTED";

export interface Complaint {
  id: number;
  customerId: number;
  orderId: number;
  orderItemId: number | null;
  type: ComplaintType;
  content: string;
  status: ComplaintStatus;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Present on the customer-facing list/detail responses. */
  order?: { id: number; code: string };
  /** Evidence photos attached when the complaint was filed. */
  evidence?: EvidenceImage[];
}

/**
 * `GET /reviews/me` — the customer's own reviews, any status.
 *
 * `orderItemId` is what lets the UI mark a purchased item as already reviewed
 * without reconstructing the link from the public product feed.
 */
export interface MyReview {
  id: number;
  customerId: number;
  orderItemId: number;
  productId: number;
  rating: number;
  content: string | null;
  status: "PENDING" | "APPROVED" | "HIDDEN";
  createdAt: string;
  updatedAt: string;
  product: { id: number; name: string; slug: string };
  /** Evidence photos the customer attached. Visible regardless of status. */
  evidence?: EvidenceImage[];
}
