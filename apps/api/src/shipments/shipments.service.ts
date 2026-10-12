import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { buildDatedCode, datedCodePrefix, isUniqueViolationOn, nextDatedSequence } from '../common/utils/code.util.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateShipmentDto, UpdateShipmentStatusDto } from './dto/shipment.dto.js';
import type { Prisma, Shipment } from '../../generated/prisma/client.js';
import { ShipmentStatus, TraceEventType } from '../../generated/prisma/enums.js';

const CODE_ATTEMPTS = 3;

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
    private readonly inventory: InventoryService,
  ) {}

  async create(dto: CreateShipmentDto) {
    const partnerOrder = await this.prisma.partnerOrder.findUnique({
      where: { id: dto.partnerOrderId },
    });
    if (!partnerOrder) throw new NotFoundException('Partner order not found');

    // Code from the highest sequence of the day (never a row count); the unique
    // index on `code` is the final guard, so retry on a collision.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const now = new Date();
        const code = await this.nextShipmentCode(now);
        return await this.prisma.shipment.create({
          data: {
            code,
            partnerOrderId: dto.partnerOrderId,
            carrier: dto.carrier,
            trackingCode: dto.trackingCode,
            status: ShipmentStatus.PENDING,
          },
        });
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  private async nextShipmentCode(now: Date): Promise<string> {
    const prefix = datedCodePrefix('SHP', now);
    const existing = await this.prisma.shipment.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });
    return buildDatedCode(
      'SHP',
      nextDatedSequence(
        existing.map((row) => row.code),
        'SHP',
        now,
      ),
      now,
    );
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
   * parent order and its partner orders become DELIVERED (consuming the
   * order's reservations; COD collection is confirmed separately through the
   * payments module). On RETURNED the returned goods are flagged for
   * quarantine via a trace event — they are never added straight back to
   * sellable stock.
   *
   * Both the shipment and the partner-order transitions are claimed with a
   * conditional compare-and-set inside the transaction, so two concurrent
   * DELIVERED updates (or a shipment racing the orders endpoint) cannot both
   * consume the same reservation or both write the order DELIVERED. Re-applying
   * the current shipment status is a documented no-op for non-terminal states
   * and performs no side effect twice.
   */
  async updateStatus(id: number, dto: UpdateShipmentStatusDto, actorUserId: number) {
    const shipment = await this.findOne(id);
    if (shipment.status === dto.status) {
      // Idempotent replay of the current status: no event, no side effect.
      // Terminal states are still terminal — replaying DELIVERED/RETURNED must
      // not resurrect the consume/return flow — but the replay itself is a
      // no-op success so at-least-once delivery of the same webhook/request is
      // safe. Re-entering a terminal state from a *different* status is still
      // refused by the transition map below.
      return shipment;
    }
    const allowed = SHIPMENT_TRANSITIONS[shipment.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change shipment status from ${shipment.status} to ${dto.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const data: Prisma.ShipmentUpdateInput = { status: dto.status };
      if (dto.status === ShipmentStatus.IN_TRANSIT) data.shippedAt = now;
      if (dto.status === ShipmentStatus.DELIVERED) data.deliveredAt = now;
      if (dto.status === ShipmentStatus.DELIVERY_FAILED) data.failureReason = dto.failureReason;

      // Claim the shipment row only while it still holds the expected status:
      // the loser of a concurrent update matches 0 rows and rolls back instead
      // of writing a second event and re-consuming the reservation.
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

      const partnerOrder = await tx.partnerOrder.findUniqueOrThrow({
        where: { id: shipment.partnerOrderId },
        include: { items: true },
      });

      if (dto.status === ShipmentStatus.DELIVERED) {
        // The partner order is DELIVERED exactly once (compare-and-set); a
        // replayed DELIVERED for an already-DELIVERED partner order records
        // the shipment event but never re-runs the order-level consume.
        await tx.partnerOrder.updateMany({
          where: { id: partnerOrder.id, status: { not: 'DELIVERED' } },
          data: { status: 'DELIVERED' },
        });
        // Order becomes DELIVERED once all partner orders are delivered.
        const remaining = await tx.partnerOrder.count({
          where: { orderId: partnerOrder.orderId, status: { not: 'DELIVERED' } },
        });
        if (remaining === 0) {
          // Guard: if the order was already moved to DELIVERED (e.g. through the
          // orders endpoint), its stock was already consumed there — consuming
          // again would be refused by the atomic guard and fail this shipment
          // update for no reason.
          const claimedOrder = await tx.order.updateMany({
            where: { id: partnerOrder.orderId, status: { not: 'DELIVERED' } },
            data: { status: 'DELIVERED' },
          });
          if (claimedOrder.count > 0) {
            // Goods physically leave the warehouse: consume the order's
            // reservations and write the OUTBOUND movements. COD is
            // deliberately NOT marked PAID — a delivered parcel does not prove
            // the courier collected cash; collection is confirmed through the
            // payments module.
            await this.inventory.consumeOrderStock(tx, partnerOrder.orderId);
          }
        }
      }

      if (dto.status === ShipmentStatus.DELIVERY_FAILED) {
        // A failed last-mile attempt must not resurrect a partner order whose
        // goods already left (DELIVERED): only a non-terminal partner order
        // falls back to SHIPPING, otherwise the failure is recorded on the
        // shipment only.
        await tx.partnerOrder.updateMany({
          where: { id: partnerOrder.id, status: { not: 'DELIVERED' } },
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
}
