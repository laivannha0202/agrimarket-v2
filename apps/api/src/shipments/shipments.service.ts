import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { QuarantineService, QUARANTINE_SOURCES } from '../quarantine/quarantine.service.js';
import { buildDatedCode, datedCodePrefix, nextDatedSequence } from '../common/utils/code.util.js';
import { claimSequence } from '../common/utils/code-sequence.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateShipmentDto, UpdateShipmentStatusDto } from './dto/shipment.dto.js';
import type { Prisma, Shipment } from '../../generated/prisma/client.js';
import {
  OrderStatus,
  PartnerOrderStatus,
  ShipmentStatus,
  TraceEventType,
} from '../../generated/prisma/enums.js';

/**
 * A shipment that is still in play for its partner order. Re-creating one is
 * either an idempotent replay (same carrier/tracking) or a conflict.
 */
const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
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

const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: [ShipmentStatus.READY, ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
  READY: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
  IN_TRANSIT: [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERY_FAILED,
    ShipmentStatus.RETURNING,
  ],
  OUT_FOR_DELIVERY: [
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELIVERY_FAILED,
    ShipmentStatus.RETURNING,
  ],
  DELIVERY_FAILED: [ShipmentStatus.RETURNING],
  RETURNING: [ShipmentStatus.RETURNED],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    @Optional() private readonly quarantine?: QuarantineService,
  ) {}

  /**
   * Create a shipment for a partner order.
   *
   * Both the order and the partner order must be READY_TO_SHIP: creating a
   * parcel for an order that is still being prepared (or already cancelled /
   * delivered) invents a physical shipment the warehouse never packed. The
   * partner-order row is locked first, so two concurrent creates serialise and
   * the duplicate check sees the winner's row.
   */
  async create(dto: CreateShipmentDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM partner_orders WHERE id = ${dto.partnerOrderId} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Partner order not found');

      const partnerOrder = await tx.partnerOrder.findUniqueOrThrow({
        where: { id: dto.partnerOrderId },
        include: { order: { select: { id: true, code: true, status: true } } },
      });
      if (
        partnerOrder.status === PartnerOrderStatus.CANCELLED ||
        partnerOrder.order.status === OrderStatus.CANCELLED
      ) {
        throw new ConflictException('Cannot create a shipment for a cancelled order');
      }
      if (
        partnerOrder.status !== PartnerOrderStatus.READY_TO_SHIP ||
        partnerOrder.order.status !== OrderStatus.READY_TO_SHIP
      ) {
        throw new BadRequestException(
          'A shipment can only be created when both the order and the partner order are READY_TO_SHIP',
        );
      }

      const existing = await tx.shipment.findFirst({
        where: {
          partnerOrderId: dto.partnerOrderId,
          status: { in: ACTIVE_SHIPMENT_STATUSES },
        },
        orderBy: { id: 'desc' },
        include: { events: { orderBy: { occurredAt: 'asc' } } },
      });
      if (existing) {
        const sameCarrier = (existing.carrier ?? null) === (dto.carrier ?? null);
        const sameTracking = (existing.trackingCode ?? null) === (dto.trackingCode ?? null);
        if (sameCarrier && sameTracking) {
          // At-least-once retry of the same shipment: return the row instead of
          // opening a second parcel.
          return existing;
        }
        throw new ConflictException(
          'An active shipment already exists for this partner order with a different carrier/tracking code',
        );
      }

      const now = new Date();
      const prefix = datedCodePrefix('SHP', now);
      const todays = await tx.shipment.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
      });
      const floor = nextDatedSequence(todays.map((row) => row.code), 'SHP', now) - 1;
      const sequence = await claimSequence(tx, prefix, floor);
      const code = buildDatedCode('SHP', sequence, now);

      const shipment = await tx.shipment.create({
        data: {
          code,
          partnerOrderId: dto.partnerOrderId,
          carrier: dto.carrier,
          trackingCode: dto.trackingCode,
          status: ShipmentStatus.PENDING,
        },
        include: { events: { orderBy: { occurredAt: 'asc' } } },
      });

      // Packing started: the selected lots enter the public trace timeline.
      const allocations = await tx.inventoryAllocation.findMany({
        where: { orderItem: { partnerOrderId: dto.partnerOrderId } },
        select: { productLotId: true },
      });
      for (const lotId of new Set(allocations.map((a) => a.productLotId))) {
        await tx.traceEvent.create({
          data: {
            productLotId: lotId,
            type: TraceEventType.PACKING,
            occurredAt: now,
            description: `Đóng gói cho vận đơn ${shipment.code}`,
            isPublic: true,
          },
        });
      }

      await this.audit.record(
        {
          actorUserId,
          action: 'SHIPMENT_CREATE',
          entityType: 'Shipment',
          entityId: String(shipment.id),
          afterJson: {
            code: shipment.code,
            partnerOrderId: shipment.partnerOrderId,
            carrier: shipment.carrier,
            trackingCode: shipment.trackingCode,
          },
        },
        tx,
      );

      return shipment;
    });
  }

  async findAll(query: { page?: number; limit?: number; status?: ShipmentStatus }): Promise<PaginatedResult<Shipment>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ShipmentWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          events: { orderBy: { occurredAt: 'asc' } },
          partnerOrder: {
            select: {
              id: true,
              code: true,
              status: true,
              partner: { select: { id: true, code: true, name: true } },
              order: { select: { id: true, code: true, status: true } },
            },
          },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        events: { orderBy: { occurredAt: 'asc' } },
        partnerOrder: {
          select: {
            id: true,
            code: true,
            status: true,
            partner: { select: { id: true, code: true, name: true } },
            order: { select: { id: true, code: true, status: true } },
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  /**
   * Advance shipment status and write a ShipmentEvent.
   *
   * Guards are checked against BOTH the partner order and its parent order:
   *  - DELIVERED requires SHIPPING (or an already-DELIVERED idempotent re-read)
   *    and is refused for a cancelled order;
   *  - moving goods requires a non-cancelled order;
   *  - CANCELLED is only for a parcel not yet handed over; in-transit
   *    cancellations become RETURNING.
   *
   * On DELIVERED the parent order consumes its reservations and the trace
   * chain gets DELIVERED. On RETURNED the still-reserved units are converted
   * once to blocked stock with quarantine cases — never released as sellable.
   */
  async updateStatus(id: number, dto: UpdateShipmentStatusDto, actorUserId: number) {
    const shipment = await this.findOne(id);
    if (shipment.status === dto.status) {
      // Idempotent replay: no event and no second stock side effect.
      return shipment;
    }
    const allowed = SHIPMENT_TRANSITIONS[shipment.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change shipment status from ${shipment.status} to ${dto.status}`,
      );
    }

    const partnerOrder = shipment.partnerOrder;
    const orderStatus = partnerOrder.order.status;
    const orderCancelled = orderStatus === OrderStatus.CANCELLED;
    const partnerCancelled = partnerOrder.status === PartnerOrderStatus.CANCELLED;

    if (dto.status === ShipmentStatus.DELIVERED) {
      if (orderCancelled || partnerCancelled) {
        throw new ConflictException('Cannot deliver a shipment for a cancelled order');
      }
      const orderShippable =
        orderStatus === OrderStatus.SHIPPING || orderStatus === OrderStatus.DELIVERED;
      const partnerShippable =
        partnerOrder.status === PartnerOrderStatus.SHIPPING ||
        partnerOrder.status === PartnerOrderStatus.DELIVERED;
      if (!orderShippable || !partnerShippable) {
        throw new ConflictException(
          'A shipment can only be delivered when the order and partner order are SHIPPING',
        );
      }
    } else if (dto.status !== ShipmentStatus.CANCELLED && dto.status !== ShipmentStatus.RETURNED) {
      if (orderCancelled || partnerCancelled) {
        throw new ConflictException('Cannot move a shipment for a cancelled order');
      }
      if (
        partnerOrder.status === PartnerOrderStatus.DELIVERED ||
        orderStatus === OrderStatus.DELIVERED
      ) {
        throw new ConflictException('Cannot move a shipment after its order was delivered');
      }
    }

    if (dto.status === ShipmentStatus.CANCELLED && orderStatus === OrderStatus.DELIVERED) {
      throw new ConflictException('Cannot cancel a shipment after delivery');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const data: Prisma.ShipmentUpdateInput = { status: dto.status };
      if (dto.status === ShipmentStatus.IN_TRANSIT) data.shippedAt = now;
      if (dto.status === ShipmentStatus.DELIVERED) data.deliveredAt = now;
      if (dto.status === ShipmentStatus.DELIVERY_FAILED) data.failureReason = dto.failureReason;

      // Compare-and-set so two concurrent updates record one event and run the
      // stock side effect once.
      const claimed = await tx.shipment.updateMany({
        where: { id, status: shipment.status },
        data,
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The shipment status changed while this request was being processed, please reload',
        );
      }
      const updated = await tx.shipment.findUniqueOrThrow({ where: { id } });

      await tx.shipmentEvent.create({
        data: { shipmentId: id, status: dto.status, occurredAt: now, note: dto.note },
      });

      const allocations = await tx.inventoryAllocation.findMany({
        where: { orderItem: { partnerOrderId: partnerOrder.id } },
        select: { productLotId: true },
      });
      const lotIds = [...new Set(allocations.map((a) => a.productLotId))];

      if (dto.status === ShipmentStatus.IN_TRANSIT) {
        // The partner order starts shipping. The parent order follows only when
        // no partner order is still being prepared, so multi-partner orders can
        // still create every shipment before the first one leaves.
        await tx.partnerOrder.updateMany({
          where: { id: partnerOrder.id, status: PartnerOrderStatus.READY_TO_SHIP },
          data: { status: PartnerOrderStatus.SHIPPING },
        });
        const preparing = await tx.partnerOrder.count({
          where: {
            orderId: partnerOrder.order.id,
            status: {
              in: [
                PartnerOrderStatus.PENDING_CONFIRMATION,
                PartnerOrderStatus.CONFIRMED,
                PartnerOrderStatus.PREPARING,
                PartnerOrderStatus.READY_TO_SHIP,
              ],
            },
          },
        });
        if (preparing === 0) {
          await tx.order.updateMany({
            where: { id: partnerOrder.order.id, status: OrderStatus.READY_TO_SHIP },
            data: { status: OrderStatus.SHIPPING },
          });
        }
        for (const lotId of lotIds) {
          await tx.traceEvent.create({
            data: {
              productLotId: lotId,
              type: TraceEventType.SHIPPING,
              occurredAt: now,
              description: `Hàng đã lên đường giao (${shipment.code})`,
              isPublic: true,
            },
          });
        }
      }

      if (dto.status === ShipmentStatus.DELIVERED) {
        await tx.partnerOrder.updateMany({
          where: { id: partnerOrder.id, status: { not: PartnerOrderStatus.DELIVERED } },
          data: { status: PartnerOrderStatus.DELIVERED },
        });
        const remaining = await tx.partnerOrder.count({
          where: {
            orderId: partnerOrder.order.id,
            status: { not: PartnerOrderStatus.DELIVERED },
          },
        });
        if (remaining === 0) {
          const claimedOrder = await tx.order.updateMany({
            where: { id: partnerOrder.order.id, status: { not: OrderStatus.DELIVERED } },
            data: { status: OrderStatus.DELIVERED },
          });
          if (claimedOrder.count > 0) {
            // Goods physically leave the warehouse. COD is deliberately NOT
            // marked PAID here: only the payments module confirms collection.
            await this.inventory.consumeOrderStock(tx, partnerOrder.order.id);
          }
        }
        for (const lotId of lotIds) {
          await tx.traceEvent.create({
            data: {
              productLotId: lotId,
              type: TraceEventType.DELIVERED,
              occurredAt: now,
              description: `Giao hàng thành công (${shipment.code})`,
              isPublic: true,
            },
          });
        }
      }

      if (dto.status === ShipmentStatus.DELIVERY_FAILED) {
        // Never resurrect a DELIVERED/CANCELLED partner order; just record the
        // failed attempt on the shipment.
        await tx.partnerOrder.updateMany({
          where: {
            id: partnerOrder.id,
            status: { notIn: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.CANCELLED] },
          },
          data: { status: PartnerOrderStatus.SHIPPING },
        });
      }

      if (dto.status === ShipmentStatus.RETURNED) {
        // The parcel came back. If the order was already cancelled while
        // shipping, its reservations were converted at cancellation time and
        // cases already exist; do not quarantine twice.
        if (partnerOrder.status !== PartnerOrderStatus.CANCELLED && !orderCancelled) {
          if (!this.quarantine) {
            throw new ConflictException('Quarantine service is not configured');
          }
          await this.quarantine.quarantineOrderReservations(tx, {
            orderId: partnerOrder.order.id,
            partnerOrderId: partnerOrder.id,
            sourceType: QUARANTINE_SOURCES.shipmentReturn,
            sourceId: id,
            reason: 'Vận chuyển thất bại — hàng hoàn về kho',
            actorUserId,
          });
        }
        await tx.partnerOrder.updateMany({
          where: {
            id: partnerOrder.id,
            status: { notIn: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.CANCELLED] },
          },
          data: { status: PartnerOrderStatus.CANCELLED },
        });
        const stillActive = await tx.partnerOrder.count({
          where: {
            orderId: partnerOrder.order.id,
            status: { notIn: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.CANCELLED] },
          },
        });
        if (stillActive === 0) {
          await tx.order.updateMany({
            where: { id: partnerOrder.order.id, status: { not: OrderStatus.DELIVERED } },
            data: { status: OrderStatus.CANCELLED },
          });
        }
      }

      await this.audit.record(
        {
          actorUserId,
          action: `SHIPMENT_${dto.status}`,
          entityType: 'Shipment',
          entityId: String(id),
          beforeJson: { status: shipment.status },
          afterJson: { status: dto.status },
          reason: dto.failureReason,
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Keep shipment state consistent when the order is cancelled from the orders
   * module: a parcel not yet handed over is CANCELLED; one already travelling
   * becomes RETURNING so it can come back through quarantine. Idempotent, and
   * terminal shipment states are never rewritten.
   */
  async syncOrderCancellation(
    tx: Prisma.TransactionClient,
    orderId: number,
    actorUserId?: number,
  ): Promise<void> {
    const shipments = await tx.shipment.findMany({
      where: { partnerOrder: { orderId } },
      select: { id: true, status: true },
    });
    for (const shipment of shipments) {
      let next: ShipmentStatus | null = null;
      if (
        shipment.status === ShipmentStatus.PENDING ||
        shipment.status === ShipmentStatus.READY
      ) {
        next = ShipmentStatus.CANCELLED;
      } else if (SHIPMENT_LEFT_WAREHOUSE_STATUSES.includes(shipment.status)) {
        next = ShipmentStatus.RETURNING;
      }
      if (!next) continue;
      const claimed = await tx.shipment.updateMany({
        where: { id: shipment.id, status: shipment.status },
        data: { status: next },
      });
      if (claimed.count === 0) continue;
      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: next,
          occurredAt: new Date(),
          note: 'Đơn hàng đã bị hủy — vận đơn được cập nhật theo',
        },
      });
      await this.audit.record(
        {
          actorUserId,
          action: `SHIPMENT_${next}`,
          entityType: 'Shipment',
          entityId: String(shipment.id),
          beforeJson: { status: shipment.status },
          afterJson: { status: next, reason: 'ORDER_CANCELLED' },
        },
        tx,
      );
    }
  }
}
