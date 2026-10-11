import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from './inventory.service.js';
import { buildDatedCode, datedCodePrefix, isUniqueViolationOn, nextDatedSequence } from '../common/utils/code.util.js';
import { claimSequence } from '../common/utils/code-sequence.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateWarehouseDocumentDto } from './dto/warehouse-document.dto.js';
import type { Prisma, WarehouseDocument } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  TraceEventType,
  WarehouseDocumentStatus,
  WarehouseDocumentType,
} from '../../generated/prisma/enums.js';

const CODE_ATTEMPTS = 3;

@Injectable()
export class WarehouseDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateWarehouseDocumentDto, actorUserId: number) {
    // Code from the atomic daily counter, claimed inside the same transaction
    // that writes the document. The counter removes the "read MAX(code), both
    // build the same code, one loses on the unique index" race; the retry below
    // stays as the final safety net for a counter that is behind the truth.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.createWithNextCode(dto, actorUserId);
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  private async createWithNextCode(dto: CreateWarehouseDocumentDto, actorUserId: number) {
    const now = new Date();
    const prefix = datedCodePrefix('WHD', now);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.warehouseDocument.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
      });
      const floor = nextDatedSequence(existing.map((row) => row.code), 'WHD', now) - 1;
      const sequence = await claimSequence(tx, prefix, floor);
      const code = buildDatedCode('WHD', sequence, now);
      return tx.warehouseDocument.create({
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
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: WarehouseDocumentStatus;
    type?: WarehouseDocumentType;
  }): Promise<PaginatedResult<WarehouseDocument>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.WarehouseDocumentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.warehouseDocument.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          lines: { include: { productLot: { select: { id: true, code: true } } } },
        },
      }),
      this.prisma.warehouseDocument.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const doc = await this.prisma.warehouseDocument.findUnique({
      where: { id },
      include: {
        warehouse: true,
        // Lines must carry the lot code and variant identity: the detail page
        // shows business names, never raw `#id` placeholders.
        lines: {
          include: {
            productLot: { select: { id: true, code: true } },
            productVariant: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('Warehouse document not found');
    return doc;
  }

  /**
   * Complete a document: applies the stock changes and writes inventory
   * movements for every line. Completing twice is rejected.
   *
   * The status is claimed with a conditional compare-and-set
   * (`UPDATE warehouse_documents SET status = 'COMPLETED' WHERE id = ? AND
   * status = 'DRAFT'`) *before* any stock moves. Two concurrent completions both
   * read DRAFT and both passed the check when the status was read outside the
   * transaction, so the document was applied twice — an INBOUND document added
   * its quantity twice (10/10 rounds in the audit). The compare-and-set lets
   * exactly one caller win; the loser matches 0 rows and is rejected, and its
   * transaction rolls back.
   */
  async complete(id: number, actorUserId: number) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.warehouseDocument.updateMany({
        where: { id, status: WarehouseDocumentStatus.DRAFT },
        data: { status: WarehouseDocumentStatus.COMPLETED, completedAt: new Date() },
      });
      if (claimed.count === 0) {
        // Distinguish "does not exist" from "not a draft" for the caller.
        const exists = await tx.warehouseDocument.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Warehouse document not found');
        throw new BadRequestException('Only DRAFT documents can be completed');
      }

      const doc = await tx.warehouseDocument.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });

      for (const line of doc.lines) {
        const balance = await this.inventory.getOrCreateBalance(
          tx,
          doc.warehouseId,
          line.productLotId,
          line.productVariantId,
        );
        const qty = Number(line.quantity);

        if (doc.type === WarehouseDocumentType.INBOUND || doc.type === WarehouseDocumentType.RETURN) {
          // Atomic on-hand change: concurrent inbound/adjustment traffic on the
          // same balance cannot lose this document's arithmetic.
          const changed = await this.inventory.changeOnHand(tx, balance.id, qty);
          if (!changed) {
            throw new BadRequestException(
              `Could not apply inbound quantity for lot ${line.productLotId}`,
            );
          }
          await this.inventory.recordMovement(tx, {
            warehouseId: doc.warehouseId,
            productLotId: line.productLotId,
            productVariantId: line.productVariantId,
            type:
              doc.type === WarehouseDocumentType.RETURN
                ? InventoryMovementType.RETURN
                : InventoryMovementType.INBOUND,
            quantityDelta: qty,
            beforeQuantity: changed.before,
            afterQuantity: changed.after,
            referenceType: 'WarehouseDocument',
            referenceId: doc.id,
            actorUserId,
          });
        } else if (doc.type === WarehouseDocumentType.OUTBOUND) {
          // The non-negative guard lives in the UPDATE, so it is enforced under
          // the row lock instead of on a value read earlier.
          const changed = await this.inventory.changeOnHand(tx, balance.id, -qty);
          if (!changed) {
            throw new BadRequestException(
              `Outbound would make on-hand negative for lot ${line.productLotId}`,
            );
          }
          await this.inventory.recordMovement(tx, {
            warehouseId: doc.warehouseId,
            productLotId: line.productLotId,
            productVariantId: line.productVariantId,
            type: InventoryMovementType.OUTBOUND,
            quantityDelta: -qty,
            beforeQuantity: changed.before,
            afterQuantity: changed.after,
            referenceType: 'WarehouseDocument',
            referenceId: doc.id,
            actorUserId,
          });
        } else {
          throw new BadRequestException('ADJUSTMENT documents must use the inventory adjust endpoint');
        }
      }

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

      await this.audit.record(
        {
          actorUserId,
          action: 'WAREHOUSE_DOCUMENT_COMPLETE',
          entityType: 'WarehouseDocument',
          entityId: String(id),
          beforeJson: { status: WarehouseDocumentStatus.DRAFT },
          afterJson: { status: WarehouseDocumentStatus.COMPLETED },
        },
        tx,
      );

      return doc;
    });
  }
}
