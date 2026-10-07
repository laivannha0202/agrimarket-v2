/**
 * Centralised React Query keys so cache invalidation stays consistent.
 */
import type { ListParams } from "@/types/api";

export const queryKeys = {
  me: ["me"] as const,

  orders: (params?: ListParams) => ["orders", params ?? {}] as const,
  order: (id: number | string) => ["order", String(id)] as const,

  returns: (params?: ListParams) => ["returns", params ?? {}] as const,
  return: (id: number | string) => ["return", String(id)] as const,
  complaints: (params?: ListParams) => ["complaints", params ?? {}] as const,
  complaint: (id: number | string) => ["complaint", String(id)] as const,

  products: (params?: ListParams) => ["products", params ?? {}] as const,
  product: (id: number | string) => ["product", String(id)] as const,
  categories: (params?: ListParams) => ["categories", params ?? {}] as const,

  partners: (params?: ListParams) => ["partners", params ?? {}] as const,
  partner: (id: number | string) => ["partner", String(id)] as const,
  farms: (params?: ListParams) => ["farms", params ?? {}] as const,
  farm: (id: number | string) => ["farm", String(id)] as const,
  seasons: (params?: ListParams) => ["seasons", params ?? {}] as const,
  season: (id: number | string) => ["season", String(id)] as const,
  harvests: (params?: ListParams) => ["harvests", params ?? {}] as const,

  qc: (params?: ListParams) => ["qc", params ?? {}] as const,
  lots: (params?: ListParams) => ["lots", params ?? {}] as const,
  lot: (id: number | string) => ["lot", String(id)] as const,
  certificates: (params?: ListParams) => ["certificates", params ?? {}] as const,

  inventory: (params?: ListParams) => ["inventory", params ?? {}] as const,
  movements: (params?: ListParams) => ["movements", params ?? {}] as const,
  warehouseDocuments: (params?: ListParams) => ["warehouse-documents", params ?? {}] as const,
  warehouseDocument: (id: number | string) => ["warehouse-document", String(id)] as const,
  warehouses: (params?: ListParams) => ["warehouses", params ?? {}] as const,

  vouchers: (params?: ListParams) => ["vouchers", params ?? {}] as const,
  productDiscounts: (params?: ListParams) => ["product-discounts", params ?? {}] as const,
  flashSales: (params?: ListParams) => ["flash-sales", params ?? {}] as const,

  customers: (params?: ListParams) => ["customers", params ?? {}] as const,
  customer: (id: number | string) => ["customer", String(id)] as const,
  reviews: (params?: ListParams) => ["reviews", params ?? {}] as const,

  commissionRules: (params?: ListParams) => ["commission-rules", params ?? {}] as const,
  settlements: (params?: ListParams) => ["settlements", params ?? {}] as const,
  settlement: (id: number | string) => ["settlement", String(id)] as const,
  payouts: (params?: ListParams) => ["payouts", params ?? {}] as const,
};
