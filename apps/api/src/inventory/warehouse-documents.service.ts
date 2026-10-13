import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from './inventory.service.js';
import { buildDatedCode, datedCodePrefix, isUniqueViolationOn, nextDatedSequence } from '../common/utils/code.util.js';
import { claimSequence } from '../common/utils/code-sequence.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto } from './dto/warehouse-document.dto.js';
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
      await InventoryService.requireActiveWarehouse(tx, dto.warehouseId);
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
   * Edit a DRAFT document (ADMIN): note and/or the full line set.
   *
   * Only DRAFT documents may be edited — COMPLETED and CANCELLED rows are
   * immutable, and a document carrying a business source (`sourceType`, e.g.
   * created from an order/return flow) cannot have its lines rewritten by hand
   * because that would break the originating process. No balance or movement is
   * touched: stock is only written at COMPLETE time, so editing a draft never
   * changes inventory.
   *
   * Concurrency: the row is re-read and re-validated inside one transaction and
   * the write is a conditional `updateMany ... WHERE status = DRAFT`. A draft
   * that was completed/cancelled concurrently matches 0 rows and the edit is
   * refused instead of resurrecting or forking the document.
   */
  async updateDraft(id: number, dto: UpdateWarehouseDocumentDto, actorUserId: number) {
    if (dto.note === undefined && dto.lines === undefined) {
      throw new BadRequestException('Không có gì để cập nhật');
    }
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.warehouseDocument.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!doc) throw new NotFoundException('Warehouse document not found');
      if (doc.status !== WarehouseDocumentStatus.DRAFT) {
        throw new BadRequestException('Chỉ được sửa phiếu đang ở trạng thái nháp');
      }
      if (doc.sourceType) {
        throw new BadRequestException(
          'Phiếu sinh tự động từ nghiệp vụ nguồn không được sửa thủ công',
        );
      }
      await InventoryService.requireActiveWarehouse(tx, doc.warehouseId);

      let lines = doc.lines;
      if (dto.lines !== undefined) {
        this.assertNoDuplicateLines(dto.lines);
        for (const line of dto.lines) {
          await this.assertDraftLine(tx, line);
        }
        await tx.warehouseDocumentLine.deleteMany({ where: { documentId: id } });
        await tx.warehouseDocumentLine.createMany({
          data: dto.lines.map((l) => ({
            documentId: id,
            productLotId: l.productLotId,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            unit: l.unit.trim(),
          })),
        });
        lines = await tx.warehouseDocumentLine.findMany({ where: { documentId: id } });
      }

      const claimed = await tx.warehouseDocument.updateMany({
        where: { id, status: WarehouseDocumentStatus.DRAFT },
        data: { note: dto.note ?? doc.note },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Trạng thái phiếu đã thay đổi trong lúc sửa, vui lòng tải lại',
        );
      }

      await this.audit.record(
        {
          actorUserId,
          action: 'WAREHOUSE_DOCUMENT_UPDATE_DRAFT',
          entityType: 'WarehouseDocument',
          entityId: String(id),
          beforeJson: { note: doc.note, lines: doc.lines },
          afterJson: { note: dto.note ?? doc.note, lines },
        },
        tx,
      );

      return tx.warehouseDocument.findUniqueOrThrow({
        where: { id },
        include: {
          warehouse: true,
          lines: {
            include: {
              productLot: { select: { id: true, code: true } },
              productVariant: { select: { id: true, sku: true, name: true } },
            },
          },
        },
      });
    });
  }

  /**
   * Cancel a DRAFT document (ADMIN): `DRAFT → CANCELLED`.
   *
   * The schema already carries CANCELLED, so no migration is needed. A
   * cancelled document can never be completed, edited or reopened; it writes no
   * movement and changes no balance — it stays readable for history only. The
   * claim is a conditional compare-and-set, so a concurrent complete/cancel
   * pair lets exactly one branch win and a retried cancel is idempotent.
   */
  async cancelDraft(id: number, actorUserId: number) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the document row first: concurrent cancels serialise here, so the
      // second waiter reads CANCELLED (not its own DRAFT snapshot under
      // REPEATABLE READ) and takes the idempotent no-op path below.
      const locked = await tx.$queryRaw<
        { id: number; status: string; sourceType: string | null }[]
      >`
        SELECT id, status, source_type AS sourceType
          FROM warehouse_documents WHERE id = ${id} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Warehouse document not found');
      if (locked[0].status === WarehouseDocumentStatus.CANCELLED) {
        return tx.warehouseDocument.findUniqueOrThrow({
          where: { id },
          include: {
            warehouse: true,
            lines: {
              include: {
                productLot: { select: { id: true, code: true } },
                productVariant: { select: { id: true, sku: true, name: true } },
              },
            },
          },
        });
      }
      if (locked[0].status !== WarehouseDocumentStatus.DRAFT) {
        throw new BadRequestException('Chỉ được hủy phiếu đang ở trạng thái nháp');
      }
      const doc = await tx.warehouseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.sourceType) {
        throw new BadRequestException(
          'Phiếu sinh tự động từ nghiệp vụ nguồn không được hủy thủ công',
        );
      }
      const claimed = await tx.warehouseDocument.updateMany({
        where: { id, status: WarehouseDocumentStatus.DRAFT },
        data: { status: WarehouseDocumentStatus.CANCELLED },
      });
      if (claimed.count === 0) {
        // The row was locked above, so reaching here means a peer branch won
        // first: re-read (the peer's commit is visible now) and return
        // idempotently when it was another cancel.
        const current = await tx.warehouseDocument.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        });
        if (current.status === WarehouseDocumentStatus.CANCELLED) {
          return tx.warehouseDocument.findUniqueOrThrow({
            where: { id },
            include: {
              warehouse: true,
              lines: {
                include: {
                  productLot: { select: { id: true, code: true } },
                  productVariant: { select: { id: true, sku: true, name: true } },
                },
              },
            },
          });
        }
        throw new ConflictException(
          'Trạng thái phiếu đã thay đổi trong lúc hủy, vui lòng tải lại',
        );
      }
      await this.audit.record(
        {
          actorUserId,
          action: 'WAREHOUSE_DOCUMENT_CANCEL',
          entityType: 'WarehouseDocument',
          entityId: String(id),
          beforeJson: { status: WarehouseDocumentStatus.DRAFT },
          afterJson: { status: WarehouseDocumentStatus.CANCELLED },
        },
        tx,
      );
      return tx.warehouseDocument.findUniqueOrThrow({
        where: { id },
        include: {
          warehouse: true,
          lines: {
            include: {
              productLot: { select: { id: true, code: true } },
              productVariant: { select: { id: true, sku: true, name: true } },
            },
          },
        },
      });
    });
  }

  private assertNoDuplicateLines(lines: { productLotId: number; productVariantId: number }[]): void {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = `${line.productLotId}:${line.productVariantId}`;
      if (seen.has(key)) {
        throw new BadRequestException('Phiếu không được có hai dòng trùng lô + quy cách');
      }
      seen.add(key);
    }
  }

  private async assertDraftLine(
    tx: Prisma.TransactionClient,
    line: { productLotId: number; productVariantId: number; quantity: number; unit: string },
  ): Promise<void> {
    if (!(line.quantity > 0)) {
      throw new BadRequestException('Số lượng dòng hàng phải dương');
    }
    if (!line.unit?.trim()) {
      throw new BadRequestException('Đơn vị tính dòng hàng không được để trống');
    }
    const lot = await tx.productLot.findUnique({
      where: { id: line.productLotId },
      select: { id: true, unit: true },
    });
    if (!lot) throw new BadRequestException(`Lô hàng #${line.productLotId} không tồn tại`);
    const variant = await tx.productVariant.findUnique({
      where: { id: line.productVariantId },
      select: { id: true, productId: true },
    });
    if (!variant) throw new BadRequestException(`Quy cách #${line.productVariantId} không tồn tại`);
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
      // Lock order is warehouse → document everywhere (create / updateDraft /
      // complete / deactivate all take the warehouse row first). `updateDraft`
      // holds the warehouse lock while rewriting lines and claims the document
      // row last; claiming the document here first would invert the order and
      // deadlock an edit racing a complete (E2E H proved it: the loser died
      // with a P2034 instead of a clean 409).
      const header = await tx.warehouseDocument.findUnique({
        where: { id },
        select: { id: true, warehouseId: true },
      });
      if (!header) throw new NotFoundException('Warehouse document not found');
      await InventoryService.requireActiveWarehouse(tx, header.warehouseId);

      const claimed = await tx.warehouseDocument.updateMany({
        where: { id, status: WarehouseDocumentStatus.DRAFT },
        data: { status: WarehouseDocumentStatus.COMPLETED, completedAt: new Date() },
      });
      if (claimed.count === 0) {
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
