import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildDatedCode } from '../common/utils/code.util.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateShipmentDto, UpdateShipmentStatusDto } from './dto/shipment.dto.js';
import type { Prisma, Shipment } from '../../generated/prisma/client.js';
import { ShipmentStatus, TraceEventType } from '../../generated/prisma/enums.js';

const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: [ShipmentStatus.READY, ShipmentStatus.IN_TRANSIT],
  READY: [ShipmentStatus.IN_TRANSIT],
  IN_TRANSIT: [ShipmentStatus.OUT_FOR_DELIVERY, ShipmentStatus.DELIVERY_FAILED],
  OUT_FOR_DELIVERY: [ShipmentStatus.DELIVERED, ShipmentStatus.DELIVERY_FAILED],
  DELIVERY_FAILED: [ShipmentStatus.RETURNING],
  RETURNING: [ShipmentStatus.RETURNED],
  DELIVERED: [],
  RETURNED: [],
};

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateShipmentDto) {
    const partnerOrder = await this.prisma.partnerOrder.findUnique({
      where: { id: dto.partnerOrderId },
    });
    if (!partnerOrder) throw new NotFoundException('Partner order not found');
    const count = await this.prisma.shipment.count();
    const code = buildDatedCode('SHP', count + 1);
    return this.prisma.shipment.create({
      data: {
        code,
        partnerOrderId: dto.partnerOrderId,
        carrier: dto.carrier,
        trackingCode: dto.trackingCode,
        status: ShipmentStatus.PENDING,
      },
    });
  }

  async findAll(query: { page?: number; limit?: number; status?: string }): Promise<PaginatedResult<Shipment>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ShipmentWhereInput = query.status
      ? { status: query.status as ShipmentStatus }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { events: { orderBy: { occurredAt: 'asc' } } },
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { events: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  /**
   * Advance shipment status and write a ShipmentEvent. On DELIVERED the
   * parent order and its partner orders become DELIVERED (which also settles
   * COD). On RETURNED the returned goods are flagged for quarantine via a
   * trace event — they are never added straight back to sellable stock.
   */
  async updateStatus(id: number, dto: UpdateShipmentStatusDto, actorUserId: number) {
    const shipment = await this.findOne(id);
    if (shipment.status !== dto.status) {
      const allowed = SHIPMENT_TRANSITIONS[shipment.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot change shipment status from ${shipment.status} to ${dto.status}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const data: Prisma.ShipmentUpdateInput = { status: dto.status };
      if (dto.status === ShipmentStatus.IN_TRANSIT) data.shippedAt = now;
      if (dto.status === ShipmentStatus.DELIVERED) data.deliveredAt = now;
      if (dto.status === ShipmentStatus.DELIVERY_FAILED) data.failureReason = dto.failureReason;

      const updated = await tx.shipment.update({ where: { id }, data });

      await tx.shipmentEvent.create({
        data: { shipmentId: id, status: dto.status, occurredAt: now, note: dto.note },
      });

      const partnerOrder = await tx.partnerOrder.findUniqueOrThrow({
        where: { id: shipment.partnerOrderId },
        include: { items: true },
      });

      if (dto.status === ShipmentStatus.DELIVERED) {
        await tx.partnerOrder.update({
          where: { id: partnerOrder.id },
          data: { status: 'DELIVERED' },
        });
        // Order becomes DELIVERED once all partner orders are delivered.
        const remaining = await tx.partnerOrder.count({
          where: { orderId: partnerOrder.orderId, status: { not: 'DELIVERED' } },
        });
        if (remaining === 0) {
          await tx.order.update({ where: { id: partnerOrder.orderId }, data: { status: 'DELIVERED' } });
          await tx.payment.updateMany({
            where: { orderId: partnerOrder.orderId, method: 'COD', status: 'PENDING' },
            data: { status: 'PAID', paidAt: now },
          });
        }
      }

      if (dto.status === ShipmentStatus.DELIVERY_FAILED) {
        await tx.partnerOrder.update({
          where: { id: partnerOrder.id },
          data: { status: 'SHIPPING' },
        });
      }

      if (dto.status === ShipmentStatus.RETURNED) {
        // Returned goods must go through quarantine, never straight to sellable.
        const allocations = await tx.inventoryAllocation.findMany({
          where: { orderItem: { partnerOrderId: partnerOrder.id } },
        });
        for (const alloc of allocations) {
          await tx.traceEvent.create({
            data: {
              productLotId: alloc.productLotId,
              type: TraceEventType.RETURNED,
              occurredAt: now,
              description: `Hàng hoàn từ đơn ${partnerOrder.code} — chờ kiểm định lại`,
              isPublic: true,
            },
          });
        }
      }

      await this.audit.record({
        actorUserId,
        action: `SHIPMENT_${dto.status}`,
        entityType: 'Shipment',
        entityId: String(id),
        beforeJson: { status: shipment.status },
        afterJson: { status: dto.status },
        reason: dto.failureReason,
      });

      return updated;
    });
  }
}
