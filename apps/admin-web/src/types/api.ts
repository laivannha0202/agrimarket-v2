/**
 * Shared API types for AgriMarket Admin.
 *
 * These mirror the response shapes of the V2 backend (see apps/api). Prisma
 * Decimal fields are serialized as strings over JSON, so money/quantity fields
 * are typed as `string` where the backend returns them that way.
 */

export type UserRole = "ADMIN" | "CUSTOMER";
export type UserStatus = "ACTIVE" | "INACTIVE";
export type RecordStatus = "ACTIVE" | "INACTIVE";

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  fullName: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  [key: string]: string | number | undefined;
}

// Catalog -------------------------------------------------------------------

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
  category?: { id: number; name: string; slug: string };
  partner?: { id: number; code: string; name: string };
  images?: ProductImage[];
  variants?: ProductVariant[];
}

// Partners & farms ----------------------------------------------------------

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
  partner?: { id: number; code: string; name: string };
}

export type SeasonStatus =
  | "PLANNED"
  | "GROWING"
  | "HARVESTING"
  | "COMPLETED"
  | "CANCELLED";

export interface Season {
  id: number;
  farmId: number;
  cropName: string;
  variety: string | null;
  plantingDate: string | null;
  expectedHarvestDate: string | null;
  expectedYield: string | null;
  yieldUnit: string | null;
  status: SeasonStatus;
  createdAt: string;
  updatedAt: string;
  farm?: { id: number; code: string; name: string };
}

export type FarmingEventType =
  | "WATERING"
  | "FERTILIZING"
  | "PEST_CHECK"
  | "CARE"
  | "OTHER";

export interface FarmingEvent {
  id: number;
  seasonId: number;
  type: FarmingEventType;
  occurredAt: string;
  content: string;
  isPublic: boolean;
  createdAt: string;
}

export interface Harvest {
  id: number;
  seasonId: number;
  harvestDate: string;
  quantity: string;
  unit: string;
  grade: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  season?: { id: number; cropName: string; farmId: number };
  productLots?: ProductLot[];
}

// Certificates --------------------------------------------------------------

export type CertificateVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface Certificate {
  id: number;
  farmId: number;
  type: string;
  certificateCode: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  fileUrl: string | null;
  verificationStatus: CertificateVerificationStatus;
  verifiedAt: string | null;
  rejectionReason: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  farm?: { id: number; code: string; name: string };
}

// Lots & QC -----------------------------------------------------------------

export type ProductLotStatus =
  | "PENDING_QC"
  | "QUARANTINED"
  | "SELLABLE"
  | "REJECTED"
  | "RECALLED"
  | "EXPIRED"
  | "LOCKED";

export interface QcInspection {
  id: number;
  productLotId: number;
  inspectorUserId: number;
  result: "PASS" | "FAIL";
  appearancePassed: boolean;
  freshnessPassed: boolean;
  packagingPassed: boolean | null;
  damagePassed: boolean;
  note: string | null;
  inspectedAt: string;
  createdAt: string;
  productLot?: { id: number; code: string; traceCode: string; status: ProductLotStatus };
  inspectorUser?: { id: number; fullName: string };
}

export type TraceEventType =
  | "HARVEST"
  | "QC"
  | "PACKING"
  | "WAREHOUSE_IN"
  | "WAREHOUSE_OUT"
  | "SHIPPING"
  | "DELIVERED"
  | "RETURNED";

export interface TraceEvent {
  id: number;
  productLotId: number;
  type: TraceEventType;
  occurredAt: string;
  location: string | null;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
}

export interface ProductLot {
  id: number;
  code: string;
  productId: number;
  harvestId: number;
  quantity: string;
  unit: string;
  remainingQuantity: string;
  grade: string;
  packedAt: string | null;
  expiresAt: string;
  status: ProductLotStatus;
  traceCode: string;
  createdAt: string;
  updatedAt: string;
  product?: Product;
  harvest?: Harvest & { season?: Season & { farm?: Farm } };
  qcInspections?: QcInspection[];
  traceEvents?: TraceEvent[];
  inventoryBalances?: InventoryBalance[];
}

// Warehouse & inventory -----------------------------------------------------

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryBalance {
  id: number;
  warehouseId: number;
  productLotId: number;
  productVariantId: number;
  onHand: string;
  reserved: string;
  blocked: string;
  available: string;
  unit: string;
  createdAt: string;
  updatedAt: string;
  warehouse?: { id: number; code: string; name: string };
  productLot?: {
    id: number;
    code: string;
    traceCode: string;
    status: ProductLotStatus;
    expiresAt: string;
  };
  productVariant?: { id: number; sku: string; name: string };
}

export type InventoryMovementType =
  | "INBOUND"
  | "OUTBOUND"
  | "ADJUSTMENT"
  | "RESERVE"
  | "RELEASE"
  | "RETURN";

export interface InventoryMovement {
  id: number;
  warehouseId: number;
  productLotId: number;
  productVariantId: number;
  type: InventoryMovementType;
  quantityDelta: string;
  beforeQuantity: string;
  afterQuantity: string;
  referenceType: string | null;
  referenceId: number | null;
  note: string | null;
  createdByUserId: number | null;
  createdAt: string;
  productLot?: { id: number; code: string };
}

export type WarehouseDocumentType = "INBOUND" | "OUTBOUND" | "ADJUSTMENT" | "RETURN";
export type WarehouseDocumentStatus = "DRAFT" | "COMPLETED" | "CANCELLED";

export interface WarehouseDocumentLine {
  id: number;
  documentId: number;
  productLotId: number;
  productVariantId: number;
  quantity: string;
  unit: string;
}

export interface WarehouseDocument {
  id: number;
  code: string;
  warehouseId: number;
  type: WarehouseDocumentType;
  sourceType: string | null;
  sourceId: number | null;
  status: WarehouseDocumentStatus;
  note: string | null;
  createdByUserId: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  warehouse?: { id: number; code: string; name: string };
  lines?: WarehouseDocumentLine[];
}

// Orders --------------------------------------------------------------------

export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_TO_SHIP"
  | "SHIPPING"
  | "DELIVERED"
  | "CANCELLED";

export type PaymentMethod = "COD" | "VNPAY" | "MOCK_ONLINE";
export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "FAILED";
export type RefundStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface Refund {
  id: number;
  paymentId: number;
  amount: string;
  reason: string;
  status: RefundStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
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
  order?: { id: number; code: string };
  refunds?: Refund[];
}

export type ShipmentStatus =
  | "PENDING"
  | "READY"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RETURNING"
  | "RETURNED";

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

export type FulfillmentStatus = "PENDING" | "PACKING" | "PACKED" | "CANCELLED";

export interface Fulfillment {
  id: number;
  partnerOrderId: number;
  status: FulfillmentStatus;
  packedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  partner?: { id: number; code?: string; name: string };
  items?: OrderItem[];
  shipments?: Shipment[];
  fulfillments?: Fulfillment[];
}

export interface ShippingAddressSnapshot {
  recipientName: string;
  phone: string;
  province: string;
  district?: string;
  ward?: string;
  village?: string;
  detail: string;
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
  customer?: { id: number; fullName: string; email: string; phone: string | null };
  partnerOrders?: PartnerOrder[];
  payments?: Payment[];
  voucherRedemptions?: { id: number; voucherId: number; discountAmount: string }[];
}

// Returns & complaints ------------------------------------------------------

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
  order?: { id: number; code: string };
  refund?: Refund | null;
}

export type ComplaintType = "PRODUCT_QUALITY" | "DELIVERY" | "WRONG_ITEM" | "OTHER";
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
  order?: { id: number; code: string };
  customer?: { id: number; fullName: string; email: string };
}

// Promotions ----------------------------------------------------------------

export type DiscountType = "PERCENT" | "FIXED";

export interface Voucher {
  id: number;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: string;
  minOrderAmount: string;
  maxDiscount: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  startsAt: string;
  endsAt: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDiscount {
  id: number;
  productVariantId: number;
  discountType: DiscountType;
  discountValue: string;
  startsAt: string;
  endsAt: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  productVariant?: { id: number; sku: string; name: string };
}

export interface FlashSaleItem {
  id: number;
  flashSaleId: number;
  productVariantId: number;
  flashPrice: string;
  quota: number;
  soldQuantity: number;
  perCustomerLimit: number;
  createdAt: string;
  updatedAt: string;
  productVariant?: ProductVariant;
}

export interface FlashSale {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  items?: FlashSaleItem[];
}

// Customers & reviews -------------------------------------------------------

export interface Customer {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  customerProfile?: {
    id: number;
    loyaltyPoints: number;
    dateOfBirth: string | null;
    addresses: Address[];
  } | null;
}

export interface Address {
  id: number;
  customerId: number;
  recipientName: string;
  phone: string;
  province: string;
  district: string | null;
  ward: string | null;
  village: string | null;
  detail: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ReviewStatus = "PENDING" | "APPROVED" | "HIDDEN";

export interface Review {
  id: number;
  customerId: number;
  orderItemId: number;
  productId: number;
  rating: number;
  content: string | null;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  product?: { id: number; name: string };
  customer?: { id: number; fullName: string };
}

// Finance -------------------------------------------------------------------

export interface CommissionRule {
  id: number;
  partnerId: number | null;
  categoryId: number | null;
  ratePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  partner?: { id: number; code: string; name: string } | null;
  category?: { id: number; name: string } | null;
}

export type SettlementStatus = "DRAFT" | "CONFIRMED" | "PAID";

export interface SettlementLine {
  id: number;
  settlementId: number;
  partnerOrderId: number;
  grossAmount: string;
  refundAmount: string;
  commissionAmount: string;
  payableAmount: string;
  createdAt: string;
  partnerOrder?: { id: number; code: string };
}

export interface Settlement {
  id: number;
  code: string;
  partnerId: number;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  refundAmount: string;
  commissionAmount: string;
  adjustmentAmount: string;
  payableAmount: string;
  status: SettlementStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  partner?: { id: number; code: string; name: string };
  lines?: SettlementLine[];
  payouts?: Payout[];
}

export type PayoutStatus = "PENDING" | "PAID" | "FAILED";

export interface Payout {
  id: number;
  code: string;
  settlementId: number;
  partnerId: number;
  amount: string;
  status: PayoutStatus;
  reference: string | null;
  requestedAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  partner?: { id: number; code: string; name: string };
  settlement?: { id: number; code: string };
}
