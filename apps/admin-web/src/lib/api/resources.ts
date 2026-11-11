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
  PartnerHistoryEntry,
  PartnerImpact,
  Payment,
  Payout,
  Product,
  ProductDiscount,
  ProductImage,
  ProductLot,
  QcInspection,
  ReturnRequest,
  Review,
  Season,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentResolution,
  SettlementRecovery,
  Shipment,
  EligiblePartnerOrder,
  Voucher,
  Warehouse,
  WarehouseDocument,
  CommissionRule,
  Harvest,
  AuthUser,
  ReportsSummary,
  ReportsDaily,
  ReconciliationReport,
  Refund,
  EligibleRefundsResponse,
  QuarantineCase,
  AuditLog,
  FarmingEvent,
  TraceChainAudit,
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
  orderPdf: (id: number | string) => api.download(`/orders/${id}/pdf`),
  packingSlip: (id: number | string) => api.download(`/orders/${id}/packing-slip`),
  updateOrderStatus: (id: number | string, status: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status }),

  // Returns & complaints
  returns: (p?: ListParams) => api.get<Paginated<ReturnRequest>>("/returns", toQuery(p)),
  eligibleRefunds: (id: number | string) =>
    api.get<EligibleRefundsResponse>(`/returns/${id}/eligible-refunds`),
  updateReturn: (id: number | string, body: { status: string; refundId?: number }) =>
    api.patch<ReturnRequest>(`/returns/${id}`, body),
  complaints: (p?: ListParams) => api.get<Paginated<Complaint>>("/complaints", toQuery(p)),
  updateComplaint: (id: number | string, body: { status: string; resolution?: string }) =>
    api.patch<Complaint>(`/complaints/${id}`, body),

  // Catalog
  products: (p?: ListParams) => api.get<Paginated<Product>>("/products/admin", toQuery(p)),
  product: (id: number | string) => api.get<Product>(`/products/admin/${id}`),
  createProduct: (body: unknown) => api.post<Product>("/products", body),
  updateProduct: (id: number | string, body: unknown) => api.patch<Product>(`/products/${id}`, body),
  addVariant: (id: number | string, body: unknown) => api.post(`/products/${id}/variants`, body),
  updateVariant: (variantId: number | string, body: unknown) =>
    api.patch(`/products/variants/${variantId}`, body),
  uploadProductImage: (id: number | string, file: File) =>
    api.upload<ProductImage>(`/products/${id}/images`, file),
  replaceProductImage: (id: number | string, imageId: number, file: File) =>
    api.upload<ProductImage>(`/products/${id}/images/${imageId}/replace`, file),
  setPrimaryImage: (id: number | string, imageId: number) =>
    api.patch<ProductImage>(`/products/${id}/images/${imageId}/primary`, {}),
  reorderProductImages: (id: number | string, orderedIds: number[]) =>
    api.patch<ProductImage[]>(`/products/${id}/images/order`, { orderedIds }),
  deleteProductImage: (id: number | string, imageId: number) =>
    api.del<{ deleted: number }>(`/products/${id}/images/${imageId}`),
  categories: (p?: ListParams) => api.get<Paginated<Category>>("/categories", toQuery(p)),
  createCategory: (body: unknown) => api.post<Category>("/categories", body),
  updateCategory: (id: number | string, body: unknown) => api.patch<Category>(`/categories/${id}`, body),

  // Partners & farms
  partners: (p?: ListParams) => api.get<Paginated<Partner>>("/partners", toQuery(p)),
  partner: (id: number | string) => api.get<Partner>(`/partners/${id}`),
  createPartner: (body: unknown) => api.post<Partner>("/partners", body),
  updatePartner: (id: number | string, body: unknown) => api.patch<Partner>(`/partners/${id}`, body),
  partnerImpact: (id: number | string) => api.get<PartnerImpact>(`/partners/${id}/impact`),
  partnerHistory: (id: number | string) => api.get<PartnerHistoryEntry[]>(`/partners/${id}/history`),
  verifyPartner: (id: number | string, body: { verificationStatus: string; reason?: string }) =>
    api.patch<Partner>(`/partners/${id}/verification`, body),
  changePartnerBusinessStatus: (id: number | string, body: { status: string; reason: string }) =>
    api.patch<Partner>(`/partners/${id}/business-status`, body),
  farms: (p?: ListParams) => api.get<Paginated<Farm>>("/farms", toQuery(p)),
  farm: (id: number | string) => api.get<Farm>(`/farms/${id}`),
  createFarm: (body: unknown) => api.post<Farm>("/farms", body),
  updateFarm: (id: number | string, body: unknown) => api.patch<Farm>(`/farms/${id}`, body),
  transferFarmPartner: (
    id: number | string,
    body: { newPartnerId: number; reason: string },
  ) => api.post<Farm>(`/farms/${id}/transfer-partner`, body),
  seasons: (p?: ListParams) => api.get<Paginated<Season>>("/seasons", toQuery(p)),
  season: (id: number | string) => api.get<Season>(`/seasons/${id}`),
  createSeason: (body: unknown) => api.post<Season>("/seasons", body),
  updateSeason: (id: number | string, body: unknown) => api.patch<Season>(`/seasons/${id}`, body),
  harvests: (p?: ListParams) => api.get<Paginated<Harvest>>("/harvests", toQuery(p)),
  createHarvest: (body: unknown) => api.post<Harvest>("/harvests", body),
  updateHarvest: (id: number | string, body: unknown) =>
    api.patch<Harvest>(`/harvests/${id}`, body),
  farmingEvents: (seasonId: number | string) =>
    api.get<FarmingEvent[]>(`/farming-events/season/${seasonId}`),
  createFarmingEvent: (body: unknown) => api.post<FarmingEvent>("/farming-events", body),
  updateFarmingEvent: (id: number | string, body: unknown) =>
    api.patch<FarmingEvent>(`/farming-events/${id}`, body),

  // QC & lots & certificates
  qc: (p?: ListParams) => api.get<Paginated<QcInspection>>("/qc", toQuery(p)),
  createQc: (body: unknown) => api.post<QcInspection>("/qc", body),
  lots: (p?: ListParams) => api.get<Paginated<ProductLot>>("/lots", toQuery(p)),
  lot: (id: number | string) => api.get<ProductLot>(`/lots/${id}`),
  lotTraceAudit: (id: number | string) =>
    api.get<TraceChainAudit>(`/trace/admin/lot/${id}`),
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
  warehouse: (id: number | string) => api.get<Warehouse>(`/warehouses/${id}`),
  createWarehouse: (body: unknown) => api.post<Warehouse>("/warehouses", body),
  updateWarehouse: (id: number | string, body: unknown) =>
    api.patch<Warehouse>(`/warehouses/${id}`, body),
  inventory: (p?: ListParams) =>
    api.get<Paginated<InventoryBalance>>("/inventory", toQuery(p)),
  movements: (p?: ListParams) =>
    api.get<Paginated<InventoryMovement>>("/inventory/movements", toQuery(p)),
  inboundInventory: (body: unknown) => api.post<InventoryBalance>("/inventory/inbound", body),
  adjustInventory: (body: unknown, idempotencyKey: string) =>
    api.post<InventoryBalance>("/inventory/adjust", body, {
      "Idempotency-Key": idempotencyKey,
    }),
  warehouseDocuments: (p?: ListParams) =>
    api.get<Paginated<WarehouseDocument>>("/warehouse-documents", toQuery(p)),
  warehouseDocument: (id: number | string) =>
    api.get<WarehouseDocument>(`/warehouse-documents/${id}`),
  createWarehouseDocument: (body: unknown) =>
    api.post<WarehouseDocument>("/warehouse-documents", body),
  completeWarehouseDocument: (id: number | string) =>
    api.post<WarehouseDocument>(`/warehouse-documents/${id}/complete`),
  updateWarehouseDocument: (id: number | string, body: unknown) =>
    api.patch<WarehouseDocument>(`/warehouse-documents/${id}`, body),
  cancelWarehouseDocument: (id: number | string) =>
    api.post<WarehouseDocument>(`/warehouse-documents/${id}/cancel`),

  // Promotions
  vouchers: (p?: ListParams) => api.get<Paginated<Voucher>>("/vouchers", toQuery(p)),
  createVoucher: (body: unknown) => api.post<Voucher>("/vouchers", body),
  updateVoucherStatus: (id: number | string, status: string) =>
    api.patch<Voucher>(`/vouchers/${id}`, { status }),
  productDiscounts: (p?: ListParams) =>
    api.get<Paginated<ProductDiscount>>("/product-discounts", toQuery(p)),
  createProductDiscount: (body: unknown) => api.post<ProductDiscount>("/product-discounts", body),
  updateProductDiscountStatus: (id: number | string, status: string) =>
    api.patch<ProductDiscount>(`/product-discounts/${id}`, { status }),
  flashSales: (p?: ListParams) => api.get<Paginated<FlashSale>>("/flash-sales", toQuery(p)),
  createFlashSale: (body: unknown) => api.post<FlashSale>("/flash-sales", body),
  updateFlashSaleStatus: (id: number | string, status: string) =>
    api.patch<FlashSale>(`/flash-sales/${id}`, { status }),

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
  updateCommissionRuleStatus: (id: number | string, status: string) =>
    api.patch<CommissionRule>(`/commission-rules/${id}`, { status }),
  settlements: (p?: ListParams) => api.get<Paginated<Settlement>>("/settlements", toQuery(p)),
  settlement: (id: number | string) => api.get<Settlement>(`/settlements/${id}`),
  createSettlement: (body: unknown) => api.post<Settlement>("/settlements", body),
  confirmSettlement: (id: number | string) => api.post<Settlement>(`/settlements/${id}/confirm`),
  settlementAdjustments: (p?: ListParams) =>
    api.get<Paginated<SettlementAdjustment>>("/settlement-adjustments", toQuery(p)),
  reviewSettlementAdjustment: (
    id: number | string,
    body: { resolution: SettlementAdjustmentResolution; note: string },
  ) => api.post<SettlementAdjustment>(`/settlement-adjustments/${id}/review`, body),
  settlementRecoveries: (p?: ListParams) =>
    api.get<Paginated<SettlementRecovery>>("/settlement-recoveries", toQuery(p)),
  approveSettlementRecovery: (id: number | string, note: string) =>
    api.post<SettlementRecovery>(`/settlement-recoveries/${id}/approve`, { note }),
  rejectSettlementRecovery: (id: number | string, note: string) =>
    api.post<SettlementRecovery>(`/settlement-recoveries/${id}/reject`, { note }),
  recordSettlementRecovery: (id: number | string, body: { reference: string; note?: string }) =>
    api.post<SettlementRecovery>(`/settlement-recoveries/${id}/record`, body),
  payouts: (p?: ListParams) => api.get<Paginated<Payout>>("/payouts", toQuery(p)),
  createPayout: (body: unknown, idempotencyKey: string) =>
    api.post<Payout>("/payouts", body, { "Idempotency-Key": idempotencyKey }),
  payPayout: (id: number | string) => api.post<Payout>(`/payouts/${id}/pay`),

  /**
   * Read-only money reconciliation. Filters only narrow the list; the summary
   * always describes the scanned window (see the API contract).
   */
  reconciliation: (p?: ListParams) =>
    api.get<ReconciliationReport>("/finance/reconciliation", toQuery(p)),

  // Payments, refunds & shipments
  payments: (p?: ListParams) => api.get<Paginated<Payment>>("/payments", toQuery(p)),
  updatePaymentStatus: (id: number | string, status: string, transactionReference?: string) =>
    api.patch<Payment>(`/payments/${id}/status`, { status, transactionReference }),
  refunds: (p?: ListParams) => api.get<Paginated<Refund>>("/refunds", toQuery(p)),
  refund: (id: number | string) => api.get<Refund>(`/refunds/${id}`),
  createRefund: (body: unknown, idempotencyKey: string) =>
    api.post<Refund>("/refunds", body, { "Idempotency-Key": idempotencyKey }),
  approveRefund: (id: number | string) => api.post<Refund>(`/refunds/${id}/approve`),
  completeRefund: (id: number | string, reference: string) =>
    api.post<Refund>(`/refunds/${id}/complete`, { reference }),
  failRefund: (id: number | string, failureReason: string) =>
    api.post<Refund>(`/refunds/${id}/fail`, { failureReason }),
  shipments: (p?: ListParams) => api.get<Paginated<Shipment>>("/shipments", toQuery(p)),
  shipment: (id: number | string) => api.get<Shipment>(`/shipments/${id}`),
  eligiblePartnerOrders: () =>
    api.get<EligiblePartnerOrder[]>("/shipments/eligible-partner-orders"),
  createShipment: (body: unknown) => api.post<Shipment>("/shipments", body),
  updateShipmentStatus: (id: number | string, body: unknown) =>
    api.patch<Shipment>(`/shipments/${id}/status`, body),

  // Quarantine (goods blocked awaiting re-inspection)
  quarantineCases: (p?: ListParams) =>
    api.get<Paginated<QuarantineCase>>("/quarantine-cases", toQuery(p)),
  quarantineCase: (id: number | string) => api.get<QuarantineCase>(`/quarantine-cases/${id}`),
  inspectQuarantine: (id: number | string, body: { result: string; note?: string }) =>
    api.patch<QuarantineCase>(`/quarantine-cases/${id}/inspect`, body),
  resolveQuarantine: (id: number | string, body: { action: "RELEASE" | "SCRAP"; note?: string }) =>
    api.patch<QuarantineCase>(`/quarantine-cases/${id}/resolve`, body),

  // Append-only audit trail
  auditLogs: (p?: ListParams) => api.get<Paginated<AuditLog>>("/audit-logs", toQuery(p)),

  // Backend aggregates for Tổng quan & Báo cáo (no 100-row cap)
  reportsSummary: (params?: { from?: string; to?: string; days?: number }) =>
    api.get<ReportsSummary>("/reports/summary", {
      from: params?.from,
      to: params?.to,
      days: params?.days,
    }),
  reportsDaily: (params?: { from?: string; to?: string; days?: number }) =>
    api.get<ReportsDaily>("/reports/daily", {
      from: params?.from,
      to: params?.to,
      days: params?.days,
    }),
  exportReport: (params: { format: "xlsx" | "pdf"; from?: string; to?: string; days?: number }) =>
    api.download("/reports/export", {
      format: params.format,
      from: params.from,
      to: params.to,
      days: params.days,
    }),
  exportSettlement: (id: number | string, format: "xlsx" | "pdf") =>
    api.download(`/settlements/${id}/export`, { format }),
};
