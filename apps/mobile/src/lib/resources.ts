/**
 * Typed wrappers around the real AgriMarket V2 endpoints.
 * Every function maps 1:1 to a backend route. Nothing is invented.
 */

import { api, apiFetch } from "./api-client";
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
  EvidenceImage,
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

export interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: number;
  partnerId?: number;
}

export interface OrderListParams {
  page?: number;
  limit?: number;
  status?: string;
}

/**
 * The checkout request body. The shape is owned by `@agrimarket/shared-domain`
 * — `buildCheckoutPayload` returns exactly this — so the app and the shared
 * payload builder cannot disagree about it.
 */
export type CheckoutPayload = CheckoutPayloadLike;

export interface CheckoutPreviewPayload {
  items?: { productVariantId: number; quantity: number }[];
  voucherCode?: string;
}

export const resources = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }, { anonymous: true }),

  /**
   * Public self-registration. Always creates a CUSTOMER — the backend DTO has
   * no `role` field and rejects unknown properties, so a forged role is a 400.
   * No session comes back: the customer signs in on the login screen.
   */
  register: (payload: { email: string; password: string; fullName: string; phone: string }) =>
    api.post<RegisterResponse>("/auth/register", payload, { anonymous: true }),

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
   * app and the Customer Web read it from here instead of embedding their own
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

  listPartners: (limit = 50) => api.getPublic<Paginated<Partner>>("/partners", { limit, status: "ACTIVE" }),

  getPartner: (id: number) => api.getPublic<Partner>(`/partners/${id}`),

  listFarms: (partnerId?: number, limit = 50) =>
    api.getPublic<Paginated<Farm>>("/farms", { limit, partnerId, status: "ACTIVE" }),

  getFarm: (id: number) => api.getPublic<Farm>(`/farms/${id}`),

  listValidCertificates: (farmId: number) =>
    api.getPublic<Certificate[]>(`/certificates/farm/${farmId}/valid`),

  listProductReviews: (productId: number, page = 1, limit = 10) =>
    api.getPublic<Paginated<Review>>(`/reviews/product/${productId}`, { page, limit }),

  getTrace: (traceCode: string) =>
    api.getPublic<TraceResult>(`/trace/${encodeURIComponent(traceCode.trim())}`),

  listVouchers: (limit = 50) => api.getPublic<Paginated<Voucher>>("/vouchers", { limit, status: "ACTIVE" }),

  listFlashSales: (limit = 10) => api.getPublic<Paginated<FlashSale>>("/flash-sales", { limit, status: "ACTIVE" }),

  listProductDiscounts: (limit = 100) =>
    api.getPublic<Paginated<ProductDiscount>>("/product-discounts", { limit, status: "ACTIVE" }),

  getCart: () => api.get<Cart>("/carts/me"),

  addCartItem: (productVariantId: number, quantity: number) =>
    api.post<Cart>("/carts/me/items", { productVariantId, quantity }),

  updateCartItem: (itemId: number, quantity: number) =>
    api.patch<Cart>(`/carts/me/items/${itemId}`, { quantity }),

  removeCartItem: (itemId: number) => api.delete<Cart>(`/carts/me/items/${itemId}`),

  clearCart: () => api.delete<Cart>("/carts/me"),

  listMyOrders: (params: OrderListParams) =>
    api.get<Paginated<Order>>("/orders/me", {
      page: params.page,
      limit: params.limit,
      status: params.status,
    }),

  getMyOrder: (id: number) => api.get<Order>(`/orders/me/${id}`),

  checkout: (payload: CheckoutPayload, idempotencyKey?: string) =>
    api.post<Order>("/orders/checkout", payload, {
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),

  checkoutPreview: (payload: CheckoutPreviewPayload) =>
    api.post<CheckoutPreview>("/orders/checkout-preview", payload),

  cancelMyOrder: (id: number) => api.post<Order>(`/orders/me/${id}/cancel`),

  listAddresses: () => api.get<Address[]>("/customers/me/addresses"),

  createAddress: (payload: ShippingAddressInput & { isDefault?: boolean }) =>
    api.post<Address>("/customers/me/addresses", payload),

  updateAddress: (id: number, payload: Partial<ShippingAddressInput> & { isDefault?: boolean }) =>
    api.patch<Address>(`/customers/me/addresses/${id}`, payload),

  deleteAddress: (id: number) => api.delete<{ id: number; deleted: boolean }>(`/customers/me/addresses/${id}`),

  setDefaultAddress: (id: number) => api.patch<Address>(`/customers/me/addresses/${id}/default`),

  updateMyProfile: (payload: { fullName?: string; phone?: string }) =>
    api.patch<AuthUser>("/customers/me", payload),

  createReturn: (payload: { orderItemId: number; quantity: number; reason: string; evidenceIds?: number[] }) =>
    api.post<ReturnRequest>("/returns", payload),

  listMyReturns: (params: { page?: number; limit?: number; status?: ReturnRequestStatus } = {}) =>
    api.get<Paginated<ReturnRequest>>("/returns/me", params),

  getMyReturn: (id: number) => api.get<ReturnRequest>(`/returns/me/${id}`),

  createComplaint: (payload: {
    orderId: number;
    orderItemId?: number;
    type: string;
    content: string;
    evidenceIds?: number[];
  }) => api.post<Complaint>("/complaints", payload),

  listMyComplaints: (params: { page?: number; limit?: number; status?: ComplaintStatus } = {}) =>
    api.get<Paginated<Complaint>>("/complaints/me", params),

  getMyComplaint: (id: number) => api.get<Complaint>(`/complaints/me/${id}`),

  createReview: (payload: { orderItemId: number; rating: number; content?: string; evidenceIds?: number[] }) =>
    api.post<Review>("/reviews", payload),

  listMyReviews: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paginated<MyReview>>("/reviews/me", params),

  /**
   * Items the customer may still review. Eligibility (DELIVERED order, own
   * item, not already reviewed) is decided by the backend, so the picker can
   * only ever offer something the create call will accept.
   */
  listReviewableItems: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paginated<EligibleReviewItem>>("/reviews/me/eligible-items", params),

  /** Items still returnable, with the quantity the backend will accept. */
  listReturnableItems: (params: { page?: number; limit?: number } = {}) =>
    api.get<Paginated<EligibleReturnItem>>("/returns/me/eligible-items", params),

  /**
   * Uploads ONE evidence photo and returns its id. The file is not attached to
   * anything yet: the id is passed as `evidenceIds` when the request is
   * created, and the backend binds it in the same transaction.
   *
   * `raw: true` tells the client to leave this body alone. It also routes the
   * request over `XMLHttpRequest` instead of `fetch`: Expo SDK 57's `fetch`
   * cannot encode a React Native `{ uri, name, type }` file part (see the note
   * on `xhrSendFormData` in api-client.ts). No `Content-Type` is set by hand —
   * the platform generates the multipart boundary.
   */
  uploadEvidence: async (file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    // React Native's FormData accepts this shape for a file part; the cast is
    // required because the DOM typings expect a Blob.
    form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    return apiFetch<EvidenceImage>("/evidence", { method: "POST", body: form, raw: true });
  },
};
