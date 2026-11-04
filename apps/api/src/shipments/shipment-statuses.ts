import { ShipmentStatus } from '../../generated/prisma/enums.js';

/**
 * A shipment that is still in play for its partner order. Re-creating one is
 * either an idempotent replay (same carrier/tracking) or a conflict.
 */
export const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.PENDING,
  ShipmentStatus.READY,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERY_FAILED,
  ShipmentStatus.RETURNING,
];

/** Statuses that mean the parcel has physically left the warehouse. */
export const SHIPMENT_LEFT_WAREHOUSE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERY_FAILED,
  ShipmentStatus.RETURNING,
];
