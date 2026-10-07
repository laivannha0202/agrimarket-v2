/**
 * Typed wrappers around the backend list/detail endpoints used by the admin.
 * Keeps endpoint strings in one place so pages stay declarative.
 */
import { api, type QueryValue } from "@/lib/api/client";
import type {
  Category,
  Certificate,
  Complaint,
  Customer,
  Farm,
  FlashSale,
  InventoryBalance,
  InventoryMovement,
  ListParams,
  Order,
  Paginated,
  Partner,
  Payment,
  Payout,
  Product,
  ProductDiscount,
  ProductLot,
  QcInspection,
  ReturnRequest,
  Review,
  Season,
  Settlement,
  Shipment,
  Voucher,
  Warehouse,
  WarehouseDocument,
  CommissionRule,
  Harvest,
  AuthUser,
} from "@/types/api";

function toQuery(params?: ListParams): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out[k] = v as QueryValue;
    }
  }
  return out;
}

export const resources = {
  me: () => api.get<AuthUser>("/auth/me"),

  // Orders
  orders: (p?: ListParams) => api.get<Paginated<Order>>("/orders", toQuery(p)),
  order: (id: number | string) => api.get<Order>(`/orders/${id}`),
  updateOrderStatus: (id: number | string, status: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status }),

  // Returns & complaints
  returns: (p?: ListParams) => api.get<Paginated<ReturnRequest>>("/returns", toQuery(p)),
  updateReturn: (id: number | string, body: { status: string; refundId?: number }) =>
    api.patch<ReturnRequest>(`/returns/${id}`, body),
  complaints: (p?: ListParams) => api.get<Paginated<Complaint>>("/complaints", toQuery(p)),
  updateComplaint: (id: number | string, body: { status: string; resolution?: string }) =>
    api.patch<Complaint>(`/complaints/${id}`, body),

  // Catalog
  products: (p?: ListParams) => api.get<Paginated<Product>>("/products", toQuery(p)),
  product: (id: number | string) => api.get<Product>(`/products/${id}`),
  createProduct: (body: unknown) => api.post<Product>("/products", body),
  updateProduct: (id: number | string, body: unknown) => api.patch<Product>(`/products/${id}`, body),
  addVariant: (id: number | string, body: unknown) => api.post(`/products/${id}/variants`, body),
  categories: (p?: ListParams) => api.get<Paginated<Category>>("/categories", toQuery(p)),
  createCategory: (body: unknown) => api.post<Category>("/categories", body),
  updateCategory: (id: number | string, body: unknown) => api.patch<Category>(`/categories/${id}`, body),

  // Partners & farms
  partners: (p?: ListParams) => api.get<Paginated<Partner>>("/partners", toQuery(p)),
  partner: (id: number | string) => api.get<Partner>(`/partners/${id}`),
  createPartner: (body: unknown) => api.post<Partner>("/partners", body),
  updatePartner: (id: number | string, body: unknown) => api.patch<Partner>(`/partners/${id}`, body),
  farms: (p?: ListParams) => api.get<Paginated<Farm>>("/farms", toQuery(p)),
  farm: (id: number | string) => api.get<Farm>(`/farms/${id}`),
  createFarm: (body: unknown) => api.post<Farm>("/farms", body),
  updateFarm: (id: number | string, body: unknown) => api.patch<Farm>(`/farms/${id}`, body),
  seasons: (p?: ListParams) => api.get<Paginated<Season>>("/seasons", toQuery(p)),
  season: (id: number | string) => api.get<Season>(`/seasons/${id}`),
  createSeason: (body: unknown) => api.post<Season>("/seasons", body),
  updateSeason: (id: number | string, body: unknown) => api.patch<Season>(`/seasons/${id}`, body),
  harvests: (p?: ListParams) => api.get<Paginated<Harvest>>("/harvests", toQuery(p)),
  createHarvest: (body: unknown) => api.post<Harvest>("/harvests", body),
  farmingEvents: (seasonId: number | string) =>
    api.get<import("@/types/api").FarmingEvent[]>(`/farming-events/season/${seasonId}`),
  createFarmingEvent: (body: unknown) => api.post("/farming-events", body),

  // QC & lots & certificates
  qc: (p?: ListParams) => api.get<Paginated<QcInspection>>("/qc", toQuery(p)),
  createQc: (body: unknown) => api.post<QcInspection>("/qc", body),
  lots: (p?: ListParams) => api.get<Paginated<ProductLot>>("/lots", toQuery(p)),
  lot: (id: number | string) => api.get<ProductLot>(`/lots/${id}`),
  createLot: (body: unknown) => api.post<ProductLot>("/lots", body),
  recallLot: (id: number | string, reason: string) =>
    api.post<ProductLot>(`/lots/${id}/recall`, { reason }),
  certificates: (p?: ListParams) =>
    api.get<Paginated<Certificate>>("/certificates", toQuery(p)),
  createCertificate: (body: unknown) => api.post<Certificate>("/certificates", body),
  verifyCertificate: (id: number | string, body: { verificationStatus: string; rejectionReason?: string }) =>
    api.patch<Certificate>(`/certificates/${id}/verify`, body),

  // Warehouse & inventory
  warehouses: (p?: ListParams) => api.get<Paginated<Warehouse>>("/warehouses", toQuery(p)),
  inventory: (p?: ListParams) =>
    api.get<Paginated<InventoryBalance>>("/inventory", toQuery(p)),
  movements: (p?: ListParams) =>
    api.get<Paginated<InventoryMovement>>("/inventory/movements", toQuery(p)),
  inboundInventory: (body: unknown) => api.post<InventoryBalance>("/inventory/inbound", body),
  adjustInventory: (body: unknown) => api.post<InventoryBalance>("/inventory/adjust", body),
  warehouseDocuments: (p?: ListParams) =>
    api.get<Paginated<WarehouseDocument>>("/warehouse-documents", toQuery(p)),
  warehouseDocument: (id: number | string) =>
    api.get<WarehouseDocument>(`/warehouse-documents/${id}`),
  createWarehouseDocument: (body: unknown) =>
    api.post<WarehouseDocument>("/warehouse-documents", body),
  completeWarehouseDocument: (id: number | string) =>
    api.post<WarehouseDocument>(`/warehouse-documents/${id}/complete`),

  // Promotions
  vouchers: (p?: ListParams) => api.get<Paginated<Voucher>>("/vouchers", toQuery(p)),
  createVoucher: (body: unknown) => api.post<Voucher>("/vouchers", body),
  productDiscounts: (p?: ListParams) =>
    api.get<Paginated<ProductDiscount>>("/product-discounts", toQuery(p)),
  createProductDiscount: (body: unknown) => api.post<ProductDiscount>("/product-discounts", body),
  flashSales: (p?: ListParams) => api.get<Paginated<FlashSale>>("/flash-sales", toQuery(p)),
  createFlashSale: (body: unknown) => api.post<FlashSale>("/flash-sales", body),

  // Customers & reviews
  customers: (p?: ListParams) => api.get<Paginated<Customer>>("/customers", toQuery(p)),
  customer: (id: number | string) => api.get<Customer>(`/customers/${id}`),
  createCustomer: (body: unknown) => api.post<Customer>("/customers", body),
  deactivateCustomer: (id: number | string) => api.patch(`/customers/${id}/deactivate`),
  activateCustomer: (id: number | string) => api.patch(`/customers/${id}/activate`),
  reviews: (p?: ListParams) => api.get<Paginated<Review>>("/reviews", toQuery(p)),
  updateReviewStatus: (id: number | string, status: string) =>
    api.patch<Review>(`/reviews/${id}/status`, { status }),

  // Finance
  commissionRules: (p?: ListParams) =>
    api.get<Paginated<CommissionRule>>("/commission-rules", toQuery(p)),
  createCommissionRule: (body: unknown) => api.post<CommissionRule>("/commission-rules", body),
  settlements: (p?: ListParams) => api.get<Paginated<Settlement>>("/settlements", toQuery(p)),
  settlement: (id: number | string) => api.get<Settlement>(`/settlements/${id}`),
  createSettlement: (body: unknown) => api.post<Settlement>("/settlements", body),
  confirmSettlement: (id: number | string) => api.post<Settlement>(`/settlements/${id}/confirm`),
  payouts: (p?: ListParams) => api.get<Paginated<Payout>>("/payouts", toQuery(p)),
  createPayout: (body: unknown) => api.post<Payout>("/payouts", body),
  payPayout: (id: number | string) => api.post<Payout>(`/payouts/${id}/pay`),

  // Payments & shipments (order context)
  payments: (p?: ListParams) => api.get<Paginated<Payment>>("/payments", toQuery(p)),
  shipments: (p?: ListParams) => api.get<Paginated<Shipment>>("/shipments", toQuery(p)),
  createShipment: (body: unknown) => api.post<Shipment>("/shipments", body),
  updateShipmentStatus: (id: number | string, body: unknown) =>
    api.patch<Shipment>(`/shipments/${id}/status`, body),
};
