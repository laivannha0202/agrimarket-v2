import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  buildDatedCode,
  datedCodePrefix,
  nextDatedSequence,
} from '../common/utils/code.util.js';
import { claimSequence } from '../common/utils/code-sequence.js';
import { buildPagination, paginate } from '../common/dto/pagination-query.dto.js';
import { InspectQuarantineDto, QuarantineQueryDto, ResolveQuarantineDto } from './dto/quarantine.dto.js';
import type { Prisma, QuarantineCase } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  QcResult,
  QuarantineCaseStatus,
  TraceEventType,
} from '../../generated/prisma/enums.js';

type Tx = Prisma.TransactionClient;

export const QUARANTINE_SOURCES = {
  orderCancel: 'ORDER_CANCEL',
  shipmentReturn: 'SHIPMENT_RETURN',
  customerReturn: 'RETURN',
  warehouseReturn: 'WAREHOUSE_RETURN',
} as const;

export type QuarantineSourceType =
  (typeof QUARANTINE_SOURCES)[keyof typeof QUARANTINE_SOURCES];

export interface CreateQuarantineCaseInput {
  warehouseId: number;
  productLotId: number;
  productVariantId: number;
  quantity: number;
  sourceType: QuarantineSourceType;
  sourceId?: number | null;
  orderId?: number | null;
  returnRequestId?: number | null;
  reason?: string | null;
  /** true only when the receipt added the units to on-hand (post-delivery return). */
  stockAddedToBalance: boolean;
  createdByUserId?: number | null;
}

export interface QuarantineOrderReservationsInput {
  orderId: number;
  partnerOrderId?: number;
  sourceType: QuarantineSourceType;
  sourceId?: number | null;
  reason?: string | null;
  actorUserId?: number | null;
  /** Add the public RETURNED trace for the physical goods coming back. */
  trace?: boolean;
}

/**
 * Create one quarantine case row and claim its `QTN-YYYYMMDD-NNNN` code from
 * the atomic daily counter.
 *
 * Exported as a plain function (not only as a Nest provider method) so stock
 * paths that do not sit in the quarantine module — the warehouse RETURN
 * document completion — can open the case inside their own transaction without
 * introducing a module cycle. The audit row commits or rolls back with the
 * stock movement that produced the case.
 */
export async function createQuarantineCase(
  tx: Tx,
  audit: AuditService,
  input: CreateQuarantineCaseInput,
): Promise<QuarantineCase> {
  if (!(input.quantity > 0)) {
    throw new BadRequestException('Quarantine quantity must be greater than zero');
  }
  const now = new Date();
  const prefix = datedCodePrefix('QTN', now);
  const existing = await tx.quarantineCase.findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  });
  const floor = nextDatedSequence(existing.map((row) => row.code), 'QTN', now) - 1;
  const sequence = await claimSequence(tx, prefix, floor);
  const code = buildDatedCode('QTN', sequence, now);

  const created = await tx.quarantineCase.create({
    data: {
      code,
      warehouseId: input.warehouseId,
      productLotId: input.productLotId,
      productVariantId: input.productVariantId,
      quantity: input.quantity,
      status: QuarantineCaseStatus.PENDING,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      orderId: input.orderId ?? null,
      returnRequestId: input.returnRequestId ?? null,
      reason: input.reason ?? null,
      stockAddedToBalance: input.stockAddedToBalance,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  await audit.record(
    {
      actorUserId: input.createdByUserId ?? undefined,
      action: 'QUARANTINE_CREATE',
      entityType: 'QuarantineCase',
      entityId: String(created.id),
      afterJson: {
        code: created.code,
        quantity: created.quantity.toString(),
        sourceType: created.sourceType,
        sourceId: created.sourceId,
      },
      reason: input.reason ?? undefined,
    },
    tx,
  );

  return created;
}

/**
 * Quarantine lifecycle.
 *
 *   PENDING -> PASSED -> RELEASED   (blocked quantity becomes sellable again)
 *   PENDING -> FAILED -> SCRAPPED   (blocked quantity leaves the warehouse)
 *
 * The service never releases or scraps on its own: an operator records the
 * inspection and then chooses the resolution. `blocked` is only ever reduced by
 * `release`/`scrap`, and both are guarded database updates, so a double click
 * cannot release the same units twice.
 */
@Injectable()
export class QuarantineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Create one case row and claim its `QTN-YYYYMMDD-NNNN` code from the atomic
   * daily counter. Runs inside the caller's transaction so the stock movement,
   * the case and the audit row commit together.
   */
  async createCase(tx: Tx, input: CreateQuarantineCaseInput): Promise<QuarantineCase> {
    return createQuarantineCase(tx, this.audit, input);
  }

  /**
   * Convert an order's still-reserved allocations into blocked stock and open
   * one quarantine case per allocation.
   *
   * Used when goods have physically left the warehouse (cancel while SHIPPING,
   * or a shipment that came back as RETURNED). The reservation is only moved
   * when the balance still holds it; a concurrent writer makes the whole
   * transaction roll back instead of fabricating blocked stock.
   */
  async quarantineOrderReservations(
    tx: Tx,
    input: QuarantineOrderReservationsInput,
  ): Promise<QuarantineCase[]> {
    const allocations = await tx.inventoryAllocation.findMany({
      where: input.partnerOrderId
        ? { orderItem: { partnerOrderId: input.partnerOrderId } }
        : { orderItem: { partnerOrder: { orderId: input.orderId } } },
      include: { inventoryBalance: true },
      orderBy: { id: 'asc' },
    });

    // Same warehouse -> balance lock order as every other stock writer.
    const warehouseIds = [...new Set(allocations.map((a) => a.inventoryBalance.warehouseId))].sort(
      (a, b) => a - b,
    );
    for (const warehouseId of warehouseIds) {
      await InventoryService.lockWarehouse(tx, warehouseId);
    }

    const cases: QuarantineCase[] = [];
    for (const alloc of allocations) {
      const balance = alloc.inventoryBalance;
      const quantity = Number(alloc.quantity);
      const quarantined = await this.inventory.quarantineStock(tx, balance.id, quantity);
      if (!quarantined) {
        throw new ConflictException(
          'The order stock changed while this request was being processed, please reload',
        );
      }
      await this.inventory.recordMovement(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        type: InventoryMovementType.QUARANTINE,
        quantityDelta: 0,
        beforeQuantity: quarantined.before,
        afterQuantity: quarantined.after,
        referenceType: input.sourceType,
        referenceId: input.sourceId ?? input.orderId,
        note: input.reason ?? 'Hàng chờ kiểm định lại',
        actorUserId: input.actorUserId ?? null,
      });

      const created = await this.createCase(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        quantity,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? input.orderId,
        orderId: input.orderId,
        reason: input.reason,
        stockAddedToBalance: false,
        createdByUserId: input.actorUserId,
      });
      cases.push(created);

      if (input.trace !== false) {
        await tx.traceEvent.create({
          data: {
            productLotId: balance.productLotId,
            type: TraceEventType.RETURNED,
            occurredAt: new Date(),
            description:
              input.sourceType === QUARANTINE_SOURCES.orderCancel
                ? `Đơn hàng bị hủy khi đang giao — hàng hoàn về chờ kiểm định (${created.code})`
                : `Hàng hoàn về kho — chờ kiểm định lại (${created.code})`,
            isPublic: true,
          },
        });
      }
    }
    return cases;
  }

  async findAll(query: QuarantineQueryDto) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.QuarantineCaseWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.returnRequestId ? { returnRequestId: query.returnRequestId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.quarantineCase.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          productLot: { select: { id: true, code: true, traceCode: true } },
          productVariant: { select: { id: true, sku: true, name: true } },
          order: { select: { id: true, code: true } },
          returnRequest: { select: { id: true, status: true } },
        },
      }),
      this.prisma.quarantineCase.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const row = await this.prisma.quarantineCase.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        productLot: { select: { id: true, code: true, traceCode: true } },
        productVariant: { select: { id: true, sku: true, name: true } },
        order: { select: { id: true, code: true } },
        returnRequest: { select: { id: true, status: true } },
      },
    });
    if (!row) throw new NotFoundException('Quarantine case not found');
    return row;
  }

  /**
   * Record the re-inspection. PASS/FAIL only changes the case status; the stock
   * stays blocked until `resolve` is called. Re-inspecting a resolved case is
   * refused, and the conditional claim makes two concurrent inspections race
   * safely.
   */
  async inspect(id: number, dto: InspectQuarantineDto, actorUserId: number) {
    const current = await this.findOne(id);
    if (current.status !== QuarantineCaseStatus.PENDING) {
      throw new BadRequestException(
        `Only PENDING quarantine cases can be inspected (current: ${current.status})`,
      );
    }
    if (dto.result === QcResult.FAIL && !dto.note?.trim()) {
      throw new BadRequestException('QC result FAIL requires a reason in note');
    }
    const status =
      dto.result === QcResult.PASS
        ? QuarantineCaseStatus.PASSED
        : QuarantineCaseStatus.FAILED;

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quarantineCase.updateMany({
        where: { id, status: QuarantineCaseStatus.PENDING },
        data: {
          status,
          inspectedAt: new Date(),
          inspectionNote: dto.note ?? null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The quarantine case changed while this request was being processed, please reload',
        );
      }
      await tx.traceEvent.create({
        data: {
          productLotId: current.productLotId,
          type: TraceEventType.QC,
          occurredAt: new Date(),
          description:
            dto.result === QcResult.PASS
              ? `Kiểm định hàng hoàn đạt (${current.code}) — chờ nhập lại kho`
              : `Kiểm định hàng hoàn không đạt (${current.code}) — chờ xử lý`,
          isPublic: true,
        },
      });
      await this.audit.record(
        {
          actorUserId,
          action: `QUARANTINE_INSPECT_${dto.result}`,
          entityType: 'QuarantineCase',
          entityId: String(id),
          beforeJson: { status: current.status },
          afterJson: { status },
          reason: dto.note,
        },
        tx,
      );
      return tx.quarantineCase.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Resolve a case. RELEASE requires PASSED, SCRAP requires FAILED.
   *
   * RELEASE subtracts from `blocked` (guarded `blocked >= quantity`) and writes
   * `QUARANTINE_RELEASE`. SCRAP subtracts from both `blocked` and `on_hand`
   * (guarded) and reduces the lot's remaining quantity, because the units were
   * still counted there. History rows are never deleted.
   */
  async resolve(id: number, dto: ResolveQuarantineDto, actorUserId: number) {
    const current = await this.findOne(id);
    const expected =
      dto.action === 'RELEASE' ? QuarantineCaseStatus.PASSED : QuarantineCaseStatus.FAILED;
    if (current.status !== expected) {
      throw new BadRequestException(
        dto.action === 'RELEASE'
          ? `Only PASSED quarantine cases can be released (current: ${current.status})`
          : `Only FAILED quarantine cases can be scrapped (current: ${current.status})`,
      );
    }
    const quantity = Number(current.quantity);

    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.inventoryBalance.findUnique({
        where: {
          warehouseId_productLotId_productVariantId: {
            warehouseId: current.warehouseId,
            productLotId: current.productLotId,
            productVariantId: current.productVariantId,
          },
        },
      });
      if (!balance) {
        throw new ConflictException('Inventory balance for this quarantine case no longer exists');
      }

      let movement: { before: number; after: number };
      if (dto.action === 'RELEASE') {
        const released = await this.inventory.releaseBlocked(tx, balance.id, quantity);
        if (!released) {
          throw new ConflictException(
            'The blocked quantity changed while this request was being processed, please reload',
          );
        }
        movement = released;
        await this.inventory.recordMovement(tx, {
          warehouseId: current.warehouseId,
          productLotId: current.productLotId,
          productVariantId: current.productVariantId,
          type: InventoryMovementType.QUARANTINE_RELEASE,
          quantityDelta: 0,
          beforeQuantity: movement.before,
          afterQuantity: movement.after,
          referenceType: 'QuarantineCase',
          referenceId: id,
          note: dto.note ?? `Nhập lại kho bán được (${current.code})`,
          actorUserId,
        });
      } else {
        const scrapped = await this.inventory.scrapBlocked(tx, balance.id, quantity);
        if (!scrapped) {
          throw new ConflictException(
            'The blocked or on-hand quantity changed while this request was being processed, please reload',
          );
        }
        movement = scrapped;
        const lotAffected = await tx.$executeRaw`
          UPDATE product_lots
             SET remaining_quantity = remaining_quantity - ${quantity},
                 updated_at = UTC_TIMESTAMP(3)
           WHERE id = ${current.productLotId}
             AND remaining_quantity >= ${quantity}
        `;
        if (lotAffected === 0) {
          throw new ConflictException(
            'The lot quantity changed while this request was being processed, please reload',
          );
        }
        await this.inventory.recordMovement(tx, {
          warehouseId: current.warehouseId,
          productLotId: current.productLotId,
          productVariantId: current.productVariantId,
          type: InventoryMovementType.SCRAP,
          quantityDelta: -quantity,
          beforeQuantity: movement.before,
          afterQuantity: movement.after,
          referenceType: 'QuarantineCase',
          referenceId: id,
          note: dto.note ?? `Hủy hàng không đạt kiểm định (${current.code})`,
          actorUserId,
        });
      }

      const expectedStatus = expected;
      const nextStatus =
        dto.action === 'RELEASE' ? QuarantineCaseStatus.RELEASED : QuarantineCaseStatus.SCRAPPED;
      const claimed = await tx.quarantineCase.updateMany({
        where: { id, status: expectedStatus },
        data: {
          status: nextStatus,
          resolutionNote: dto.note ?? null,
          resolvedAt: new Date(),
          resolvedByUserId: actorUserId,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The quarantine case changed while this request was being processed, please reload',
        );
      }

      await tx.traceEvent.create({
        data: {
          productLotId: current.productLotId,
          type:
            dto.action === 'RELEASE'
              ? TraceEventType.WAREHOUSE_IN
              : TraceEventType.WAREHOUSE_OUT,
          occurredAt: new Date(),
          description:
            dto.action === 'RELEASE'
              ? `Hàng hoàn đạt kiểm định, nhập lại kho bán (${current.code})`
              : `Hàng hoàn không đạt kiểm định, đã hủy (${current.code})`,
          isPublic: true,
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: `QUARANTINE_${dto.action}`,
          entityType: 'QuarantineCase',
          entityId: String(id),
          beforeJson: { status: current.status, quantity: current.quantity.toString() },
          afterJson: { status: nextStatus, movement },
          reason: dto.note,
        },
        tx,
      );

      return tx.quarantineCase.findUniqueOrThrow({ where: { id } });
    });
  }
}
