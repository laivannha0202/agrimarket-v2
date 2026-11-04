import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  PartnerOrderStatus,
  ShipmentStatus,
} from '../../generated/prisma/enums.js';
import { ACTIVE_SHIPMENT_STATUSES } from '../shipments/shipment-statuses.js';

/**
 * Delivery evidence for one order.
 *
 * An order is only "delivered" when every partner order actually has a parcel
 * that reached the customer. The order status alone is not evidence: it is a
 * rollup that an operator (or a buggy caller) can set by hand. This module is
 * the single place that decides whether the physical evidence exists, so the
 * manual order transition and the shipment rollup cannot disagree.
 */
export interface DeliveryEvidenceShipment {
  id: number;
  code: string;
  status: ShipmentStatus;
  deliveredAt: Date | null;
}

export interface DeliveryEvidencePartnerOrder {
  id: number;
  code: string;
  status: PartnerOrderStatus;
  shipments: DeliveryEvidenceShipment[];
}

export interface DeliveryEvidence {
  partnerOrders: DeliveryEvidencePartnerOrder[];
}

/**
 * Read the evidence inside the caller's transaction, so the decision is made
 * against the same snapshot that will be used to change the order.
 */
export async function loadDeliveryEvidence(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<DeliveryEvidence> {
  const partnerOrders = await tx.partnerOrder.findMany({
    where: { orderId },
    select: {
      id: true,
      code: true,
      status: true,
      shipments: {
        select: { id: true, code: true, status: true, deliveredAt: true },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });
  return { partnerOrders };
}

/**
 * Name every reason the evidence is insufficient. An empty array means the
 * order may be marked DELIVERED. The checks are intentionally independent:
 * a cancelled partner order is a problem even if another parcel was delivered,
 * and an active sibling shipment is a problem even if one parcel already
 * arrived (the order is not fully settled yet).
 */
export function deliveryEvidenceProblems(evidence: DeliveryEvidence): string[] {
  if (evidence.partnerOrders.length === 0) {
    return ['Đơn hàng chưa có đơn đối tác nào'];
  }

  const problems: string[] = [];
  for (const partnerOrder of evidence.partnerOrders) {
    if (partnerOrder.status === PartnerOrderStatus.CANCELLED) {
      problems.push(`Đơn đối tác ${partnerOrder.code} đã bị hủy`);
      continue;
    }

    const delivered = partnerOrder.shipments.some(
      (shipment) =>
        shipment.status === ShipmentStatus.DELIVERED && shipment.deliveredAt !== null,
    );
    if (!delivered) {
      problems.push(`Đơn đối tác ${partnerOrder.code} chưa có vận đơn giao thành công`);
    }

    const active = partnerOrder.shipments.some((shipment) =>
      ACTIVE_SHIPMENT_STATUSES.includes(shipment.status),
    );
    if (active) {
      problems.push(`Đơn đối tác ${partnerOrder.code} còn vận đơn đang xử lý`);
    }
  }
  return problems;
}

/**
 * Refuse the DELIVERED transition unless every partner order is backed by a
 * completed delivery. The message lists the concrete missing evidence so the
 * operator knows which shipment to update instead of guessing.
 */
export function assertDeliveryEvidence(evidence: DeliveryEvidence): void {
  const problems = deliveryEvidenceProblems(evidence);
  if (problems.length > 0) {
    throw new ConflictException(
      `Không thể đánh dấu đơn đã giao khi chưa đủ bằng chứng: ${problems.join('; ')}`,
    );
  }
}
