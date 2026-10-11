/**
 * Centralised React Query keys.
 *
 * Keeping them in one place makes invalidation predictable: a mutation never
 * has to guess which list to refresh.
 */

import type {
  ComplaintStatus,
  OrderStatus,
  ReturnRequestStatus,
} from "@/lib/api/types";

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
  status?: OrderStatus;
}

export interface ReturnListParams {
  page?: number;
  limit?: number;
  status?: ReturnRequestStatus;
}

export interface ComplaintListParams {
  page?: number;
  limit?: number;
  status?: ComplaintStatus;
}

export const queryKeys = {
  categories: {
    all: ["categories"] as const,
    list: (limit: number) => ["categories", "list", limit] as const,
    detail: (id: number) => ["categories", "detail", id] as const,
  },
  products: {
    all: ["products"] as const,
    list: (params: ProductListParams) => ["products", "list", params] as const,
    detail: (id: number) => ["products", "detail", id] as const,
  },
  partners: {
    all: ["partners"] as const,
    list: (limit: number) => ["partners", "list", limit] as const,
    detail: (id: number) => ["partners", "detail", id] as const,
  },
  farms: {
    all: ["farms"] as const,
    list: (partnerId?: number) => ["farms", "list", partnerId ?? null] as const,
    detail: (id: number) => ["farms", "detail", id] as const,
  },
  certificates: {
    all: ["certificates"] as const,
    validForFarm: (farmId: number) => ["certificates", "valid", farmId] as const,
  },
  trace: {
    all: ["trace"] as const,
    detail: (code: string) => ["trace", "detail", code] as const,
  },
  cart: {
    all: ["cart"] as const,
    me: () => ["cart", "me"] as const,
  },
  orders: {
    all: ["orders"] as const,
    list: (params: OrderListParams) => ["orders", "list", params] as const,
    detail: (id: number) => ["orders", "detail", id] as const,
  },
  addresses: {
    all: ["addresses"] as const,
    me: () => ["addresses", "me"] as const,
  },
  /**
   * Administrative catalogue (provinces + xã/phường). Reference data, so it is
   * cached for the session; the key carries the province because each province
   * has its own ward list.
   */
  locations: {
    all: ["locations"] as const,
    provinces: () => ["locations", "provinces"] as const,
    wards: (provinceCode: string) => ["locations", "wards", provinceCode] as const,
  },
  returns: {
    all: ["returns"] as const,
    list: (params: ReturnListParams) => ["returns", "list", params] as const,
    detail: (id: number) => ["returns", "detail", id] as const,
  },
  complaints: {
    all: ["complaints"] as const,
    list: (params: ComplaintListParams) => ["complaints", "list", params] as const,
    detail: (id: number) => ["complaints", "detail", id] as const,
  },
  reviews: {
    all: ["reviews"] as const,
    mine: () => ["reviews", "me"] as const,
    forProduct: (productId: number, page: number) =>
      ["reviews", "product", productId, page] as const,
  },
  vouchers: {
    all: ["vouchers"] as const,
    list: (limit: number) => ["vouchers", "list", limit] as const,
  },
  flashSales: {
    all: ["flash-sales"] as const,
    list: (limit: number) => ["flash-sales", "list", limit] as const,
  },
  productDiscounts: {
    all: ["product-discounts"] as const,
    list: (limit: number) => ["product-discounts", "list", limit] as const,
  },
};
