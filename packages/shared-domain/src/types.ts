/**
 * Domain types shared by Customer Web and Mobile.
 *
 * These are string-literal unions of exactly the enums the backend exposes.
 * Both apps keep their own `OrderStatus`-style aliases in their API type files;
 * the literals are identical, so the two are structurally interchangeable and
 * no response contract changes.
 */

/** Status badge tone. Deliberately a plain union: each platform maps it to its
 * own colours (Mantine CSS variables on Web, `toneColors` on Mobile). */
export type Tone = "green" | "blue" | "yellow" | "red" | "gray" | "orange";

export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_TO_SHIP"
  | "SHIPPING"
  | "DELIVERED"
  | "CANCELLED";

export type PaymentMethod = "COD" | "VNPAY" | "MOCK_ONLINE";

export type PaymentStatus = "PENDING" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED";

export type ShipmentStatus =
  | "PENDING"
  | "READY"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RETURNING"
  | "RETURNED";

export type ReturnRequestStatus =
  | "REQUESTED"
  | "APPROVED"
  | "RETURNING"
  | "RECEIVED"
  | "QC_PENDING"
  | "REFUNDED"
  | "REJECTED";

export type ComplaintType = "PRODUCT_QUALITY" | "DELIVERY" | "WRONG_ITEM" | "OTHER";

export type ComplaintStatus = "OPEN" | "PROCESSING" | "RESOLVED" | "REJECTED";
