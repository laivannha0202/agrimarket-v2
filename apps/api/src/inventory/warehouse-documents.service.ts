import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from './inventory.service.js';
import { buildDatedCode } from '../common/utils/code.util.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateWarehouseDocumentDto } from './dto/warehouse-document.dto.js';
import type { Prisma, WarehouseDocument } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  TraceEventType,
  WarehouseDocumentStatus,
  WarehouseDocumentType,
} from '../../generated/prisma/enums.js';

@Injectable()
export class WarehouseDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateWarehouseDocumentDto, actorUserId: number) {
    const count = await this.prisma.warehouseDocument.count();
    const code = buildDatedCode('WHD', count + 1);
    return this.prisma.warehouseDocument.create({
      data: {
        code,
        warehouseId: dto.warehouseId,
        type: dto.type,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        note: dto.note,
        createdByUserId: actorUserId,
        status: WarehouseDocumentStatus.DRAFT,
        lines: {
          create: dto.lines.map((l) => ({
            productLotId: l.productLotId,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            unit: l.unit,
          })),
        },
      },
      include: { lines: true },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
    type?: string;
  }): Promise<PaginatedResult<WarehouseDocument>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.WarehouseDocumentWhereInput = {
      ...(query.status ? { status: query.status as WarehouseDocumentStatus } : {}),
      ...(query.type ? { type: query.type as WarehouseDocumentType } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.warehouseDocument.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          lines: true,
        },
      }),
      this.prisma.warehouseDocument.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const doc = await this.prisma.warehouseDocument.findUnique({
      where: { id },
      include: { warehouse: true, lines: true },
    });
    if (!doc) throw new NotFoundException('Warehouse document not found');
    return doc;
  }

  /**
   * Complete a document: applies the stock changes and writes inventory
   * movements for every line. Completing twice is rejected.
   */
  async complete(id: number, actorUserId: number) {
    const doc = await this.findOne(id);
    if (doc.status !== WarehouseDocumentStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT documents can be completed');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const line of doc.lines) {
        const balance = await this.inventory.getOrCreateBalance(
          tx,
          doc.warehouseId,
          line.productLotId,
          line.productVariantId,
        );
        const qty = Number(line.quantity);
        const before = Number(balance.onHand);

        if (doc.type === WarehouseDocumentType.INBOUND || doc.type === WarehouseDocumentType.RETURN) {
          const after = before + qty;
          await tx.inventoryBalance.update({ where: { id: balance.id }, data: { onHand: after } });
          await this.inventory.recordMovement(tx, {
            warehouseId: doc.warehouseId,
            productLotId: line.productLotId,
            productVariantId: line.productVariantId,
            type:
              doc.type === WarehouseDocumentType.RETURN
                ? InventoryMovementType.RETURN
                : InventoryMovementType.INBOUND,
            quantityDelta: qty,
            beforeQuantity: before,
            afterQuantity: after,
            referenceType: 'WarehouseDocument',
            referenceId: doc.id,
            actorUserId,
          });
        } else if (doc.type === WarehouseDocumentType.OUTBOUND) {
          const after = before - qty;
          if (after < 0) {
            throw new BadRequestException(
              `Outbound would make on-hand negative for lot ${line.productLotId}`,
            );
          }
          await tx.inventoryBalance.update({ where: { id: balance.id }, data: { onHand: after } });
          await this.inventory.recordMovement(tx, {
            warehouseId: doc.warehouseId,
            productLotId: line.productLotId,
            productVariantId: line.productVariantId,
            type: InventoryMovementType.OUTBOUND,
            quantityDelta: -qty,
            beforeQuantity: before,
            afterQuantity: after,
            referenceType: 'WarehouseDocument',
            referenceId: doc.id,
            actorUserId,
          });
        } else {
          throw new BadRequestException('ADJUSTMENT documents must use the inventory adjust endpoint');
        }
      }

      const completed = await tx.warehouseDocument.update({
        where: { id },
        data: { status: WarehouseDocumentStatus.COMPLETED, completedAt: new Date() },
      });

      // Warehouse-in becomes part of the public trace timeline.
      if (doc.type === WarehouseDocumentType.INBOUND) {
        for (const line of doc.lines) {
          await tx.traceEvent.create({
            data: {
              productLotId: line.productLotId,
              type: TraceEventType.WAREHOUSE_IN,
              occurredAt: new Date(),
              description: `Nhập kho theo phiếu ${doc.code}`,
              isPublic: true,
            },
          });
        }
      }

      await this.audit.record({
        actorUserId,
        action: 'WAREHOUSE_DOCUMENT_COMPLETE',
        entityType: 'WarehouseDocument',
        entityId: String(id),
        beforeJson: { status: doc.status },
        afterJson: { status: completed.status },
      });

      return completed;
    });
  }
}
