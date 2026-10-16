/**
 * Typed wrappers around the real AgriMarket V2 endpoints.
 *
 * Every function here maps 1:1 to a route that exists in the backend. Nothing
 * is invented: if a customer-facing capability has no endpoint, it is reported
 * as a blocker instead of being emulated on the client.
 */

import { api } from "./client";
export { fetchEvidenceBlobUrl } from "./client";
import { queryKeys, type OrderListParams, type ProductListParams } from "./query-keys";
import type {
  Address,
  AuthUser,
  Cart,
  Category,
  Certificate,
  ChangePasswordResponse,
  CheckoutPreview,
  Complaint,
  ComplaintStatus,
  EligibleReturnItem,
  EligibleReviewItem,
  Farm,
  FlashSale,
  ForgotPasswordResponse,
  LoginResponse,
  MyReview,
  Order,
  Paginated,
  Partner,
  Product,
  ProductDiscount,
  Province,
  RegisterResponse,
  ResetPasswordResponse,
  ReturnRequest,
  ReturnRequestStatus,
  Review,
  ShippingAddressInput,
  TraceResult,
  Voucher,
  Ward,
} from "./types";

import type { CheckoutPayloadLike } from "@agrimarket/shared-domain";

export const resources = {
  // ----- Auth ---------------------------------------------------------------
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }, { anonymous: true }),

  /**
   * Public self-registration. Always creates a CUSTOMER — the backend DTO has
   * no `role` field and rejects unknown properties, so a forged role is a 400.
   * No session comes back: the customer signs in on the login screen.
   */
  register: (payload: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
  }) => api.post<RegisterResponse>("/auth/register", payload, { anonymous: true }),

  /**
   * Starts password recovery. The response is identical for a registered and an
   * unregistered address (no enumeration), and `delivery` tells the UI whether
   * a real e-mail was sent or the transport only captured it.
   */
  forgotPassword: (email: string) =>
    api.post<ForgotPasswordResponse>("/auth/forgot-password", { email }, { anonymous: true }),

  /** Completes recovery with the single-use token from the e-mail. */
  resetPassword: (token: string, newPassword: string) =>
    api.post<ResetPasswordResponse>(
      "/auth/reset-password",
      { token, newPassword },
      { anonymous: true },
    ),

  /** Change the signed-in customer's password; returns a fresh token. */
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<ChangePasswordResponse>("/auth/change-password", {
      currentPassword,
      newPassword,
    }),

  me: () => api.get<AuthUser>("/auth/me"),

  // ----- Locations (public administrative catalogue) ------------------------
  /**
   * The verified province/commune catalogue lives ONLY in the backend. Both the
   * Web and the Mobile client read it from here instead of embedding their own
   * copy of the 104 Hưng Yên units.
   */
  listProvinces: () => api.getPublic<Province[]>("/locations/provinces"),

  /**
   * Communes of a province. The whole catalogue is 104 rows, so one call with
   * the default limit returns every unit and the picker filters locally — no
   * request per keystroke.
   */
  listWards: (provinceCode: string, search?: string) =>
    api.getPublic<Paginated<Ward>>(
      `/locations/provinces/${encodeURIComponent(provinceCode)}/wards`,
      { search, limit: 200 },
    ),

  getWard: (provinceCode: string, wardCode: string) =>
    api.getPublic<Ward>(
      `/locations/provinces/${encodeURIComponent(provinceCode)}/wards/${encodeURIComponent(wardCode)}`,
    ),

  // ----- Catalog (public) ---------------------------------------------------
  listCategories: (limit = 100) =>
    api.getPublic<Paginated<Category>>("/categories", { limit, status: "ACTIVE" }),

  listProducts: (params: ProductListParams) =>
    api.getPublic<Paginated<Product>>("/products", {
      page: params.page,
      limit: params.limit,
      search: params.search,
      categoryId: params.categoryId,
      partnerId: params.partnerId,
      status: "ACTIVE",
    }),

  getProduct: (id: number) => api.getPublic<Product>(`/products/${id}`),

  listPartners: (limit = 50) =>
    api.getPublic<Paginated<Partner>>("/partners", { limit, status: "ACTIVE" }),

  getPartner: (id: number) => api.getPublic<Partner>(`/partners/${id}`),

  listFarms: (partnerId?: number, limit = 50) =>
    api.getPublic<Paginated<Farm>>("/farms", { limit, partnerId, status: "ACTIVE" }),

  getFarm: (id: number) => api.getPublic<Farm>(`/farms/${id}`),

  /** Only VERIFIED + ACTIVE + within its validity period + carrying a document. */
  listValidCertificates: (farmId: number) =>
    api.getPublic<Certificate[]>(`/certificates/farm/${farmId}/valid`),

  listProductReviews: (productId: number, page = 1, limit = 10) =>
    api.getPublic<Paginated<Review>>(`/reviews/product/${productId}`, { page, limit }),

  // ----- Traceability (public) ---------------------------------------------
  getTrace: (traceCode: string) =>
    api.getPublic<TraceResult>(`/trace/${encodeURIComponent(traceCode)}`),

  // ----- Promotions (public) ------------------------------------------------
  listVouchers: (limit = 50) =>
    api.getPublic<Paginated<Voucher>>("/vouchers", { limit, status: "ACTIVE" }),

  listFlashSales: (limit = 10) =>
    api.getPublic<Paginated<FlashSale>>("/flash-sales", { limit, status: "ACTIVE" }),

  listProductDiscounts: (limit = 100) =>
    api.getPublic<Paginated<ProductDiscount>>("/product-discounts", {
      limit,
      status: "ACTIVE",
    }),

  // ----- Cart (CUSTOMER) ----------------------------------------------------
  getCart: () => api.get<Cart>("/carts/me"),

  addCartItem: (productVariantId: number, quantity: number) =>
    api.post<Cart>("/carts/me/items", { productVariantId, quantity }),

  updateCartItem: (itemId: number, quantity: number) =>
    api.patch<Cart>(`/carts/me/items/${itemId}`, { quantity }),

  removeCartItem: (itemId: number) => api.delete<Cart>(`/carts/me/items/${itemId}`),

  clearCart: () => api.delete<Cart>("/carts/me"),

  // ----- Orders (CUSTOMER) --------------------------------------------------
  listMyOrders: (params: OrderListParams) =>
    api.get<Paginated<Order>>("/orders/me", {
      page: params.page,
      limit: params.limit,
      status: params.status,
    }),

  getMyOrder: (id: number) => api.get<Order>(`/orders/me/${id}`),

  /**
   * Checkout. The backend re-resolves prices, re-validates the voucher and
   * re-checks sellable stock, then FEFO-allocates. The client never sends a
   * price and never chooses a lot.
   *
   * `idempotencyKey` makes the call retry-safe: the same key with the same
   * payload returns the original order instead of creating a second one.
   */
  checkout: (payload: CheckoutPayload, idempotencyKey?: string) =>
    api.post<Order>("/orders/checkout", payload, {
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),

  /** Backend-decided total (price, voucher, shipping fee) before submitting. */
  checkoutPreview: (payload: CheckoutPreviewPayload) =>
    api.post<CheckoutPreview>("/orders/checkout-preview", payload),

  /** Cancel my own order. The backend state machine decides what is allowed. */
  cancelMyOrder: (id: number) => api.post<Order>(`/orders/me/${id}/cancel`),

  // ----- Addresses (CUSTOMER) ----------------------------------------------
  listAddresses: () => api.get<Address[]>("/customers/me/addresses"),

  createAddress: (payload: ShippingAddressInput & { isDefault?: boolean }) =>
    api.post<Address>("/customers/me/addresses", payload),

  updateAddress: (
    id: number,
    payload: Partial<ShippingAddressInput> & { isDefault?: boolean },
  ) => api.patch<Address>(`/customers/me/addresses/${id}`, payload),

  deleteAddress: (id: number) =>
    api.delete<{ id: number; deleted: boolean }>(`/customers/me/addresses/${id}`),

  setDefaultAddress: (id: number) =>
    api.patch<Address>(`/customers/me/addresses/${id}/default`),

  // ----- Profile (CUSTOMER) -------------------------------------------------
  updateMyProfile: (payload: { fullName?: string; phone?: string }) =>
    api.patch<AuthUser>("/customers/me", payload),

  // ----- Returns (CUSTOMER) -------------------------------------------------
  createReturn: (payload: {
    orderItemId: number;
    quantity: number;
    reason: string;
    /** Evidence photo ids from `POST /evidence` (max 5). */
    evidenceIds?: number[];
  }) => api.post<ReturnRequest>("/returns", payload),

  listMyReturns: (params: { page?: number; limit?: number; status?: ReturnRequestStatus } = {}) =>
    api.get<Paginated<ReturnRequest>>("/returns/me", params),

  /**
   * Items still returnable, with the quantity the backend will accept
   * (`returnableQuantity` = purchased minus everything tied up in active
   * requests). Server-side so the form can never promise the same unit twice.
   */
  listReturnableItems: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paginated<EligibleReturnItem>>("/returns/me/eligible-items", params),

  getMyReturn: (id: number) => api.get<ReturnRequest>(`/returns/me/${id}`),

  // ----- Complaints (CUSTOMER) ----------------------------------------------
  createComplaint: (payload: {
    orderId: number;
    orderItemId?: number;
    type: string;
    content: string;
    /** Evidence photo ids from `POST /evidence` (max 5). */
    evidenceIds?: number[];
  }) => api.post<Complaint>("/complaints", payload),

  listMyComplaints: (params: { page?: number; limit?: number; status?: ComplaintStatus } = {}) =>
    api.get<Paginated<Complaint>>("/complaints/me", params),

  getMyComplaint: (id: number) => api.get<Complaint>(`/complaints/me/${id}`),

  // ----- Reviews (CUSTOMER) ------------------------------------------------
  createReview: (payload: {
    orderItemId: number;
    rating: number;
    content?: string;
    /** Evidence photo ids from `POST /evidence` (max 5). */
    evidenceIds?: number[];
  }) => api.post<Review>("/reviews", payload),

  /** Own reviews (any status); carries `orderItemId` to detect reviewed items. */
  listMyReviews: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paginated<MyReview>>("/reviews/me", params),

  /**
   * Items the customer may still review. Eligibility (DELIVERED order, own
   * item, not already reviewed) is decided by the backend, so the picker can
   * only ever offer something the create call will accept.
   */
  listReviewableItems: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paginated<EligibleReviewItem>>("/reviews/me/eligible-items", params),

  // ----- Evidence (CUSTOMER) -------------------------------------------------
  /**
   * Upload one evidence photo, unbound, and return its id.
   *
   * The id is passed as `evidenceIds` when creating a review, complaint or
   * return — the two steps are adjacent on purpose, so a submit failure never
   * leaves a half-created request with missing photos.
   */
  uploadEvidence: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<{ id: number }>("/evidence", formData);
  },
};

/**
 * The checkout request body. The shape is owned by `@agrimarket/shared-domain`
 * — `buildCheckoutPayload` returns exactly this — so the Web and Mobile apps
 * cannot disagree with the backend contract.
 */
export type CheckoutPayload = CheckoutPayloadLike;

/** Preview request: the line selection and voucher, never an address. */
export interface CheckoutPreviewPayload {
  items?: Array<{ productVariantId: number; quantity: number }>;
  voucherCode?: string;
}

export { queryKeys };
