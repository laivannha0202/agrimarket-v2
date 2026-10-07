import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  AdjustInventoryDto,
  InboundInventoryDto,
  ReserveInventoryDto,
} from './dto/inventory.dto.js';
import type { InventoryBalance, Prisma } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  ProductLotStatus,
  QcResult,
} from '../../generated/prisma/enums.js';

type Tx = Prisma.TransactionClient;

export interface AvailableStock {
  balanceId: number;
  warehouseId: number;
  productLotId: number;
  productVariantId: number;
  onHand: number;
  reserved: number;
  blocked: number;
  available: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static available(onHand: number, reserved: number, blocked: number): number {
    return onHand - reserved - blocked;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    warehouseId?: number;
    productVariantId?: number;
  }): Promise<PaginatedResult<Record<string, unknown>>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.InventoryBalanceWhereInput = {
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.productVariantId ? { productVariantId: query.productVariantId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          productLot: { select: { id: true, code: true, traceCode: true, status: true, expiresAt: true } },
          productVariant: { select: { id: true, sku: true, name: true } },
        },
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);
    const data = rows.map((b) => this.withAvailable(b));
    return paginate(data, total, page, limit);
  }

  private withAvailable(b: InventoryBalance) {
    const onHand = Number(b.onHand);
    const reserved = Number(b.reserved);
    const blocked = Number(b.blocked);
    return {
      ...b,
      onHand: b.onHand.toString(),
      reserved: b.reserved.toString(),
      blocked: b.blocked.toString(),
      available: InventoryService.available(onHand, reserved, blocked).toFixed(3),
    };
  }

  /** Inbound stock (e.g. from a completed warehouse-in document). */
  async inbound(dto: InboundInventoryDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.getOrCreateBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      const before = Number(balance.onHand);
      const after = before + dto.quantity;
      const updated = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHand: after },
      });
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.INBOUND,
        quantityDelta: dto.quantity,
        beforeQuantity: before,
        afterQuantity: after,
        note: dto.note,
        actorUserId,
      });
      return this.withAvailable(updated);
    });
  }

  /** Signed adjustment. Stock can never go negative. */
  async adjust(dto: AdjustInventoryDto, actorUserId: number) {
    if (dto.quantityDelta === 0) {
      throw new BadRequestException('quantityDelta must not be zero');
    }
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.getOrCreateBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      const before = Number(balance.onHand);
      const after = before + dto.quantityDelta;
      if (after < 0) {
        throw new BadRequestException('Adjustment would make on-hand quantity negative');
      }
      if (after < Number(balance.reserved) + Number(balance.blocked)) {
        throw new BadRequestException(
          'Adjustment would make on-hand lower than reserved + blocked quantity',
        );
      }
      const updated = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHand: after },
      });
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.ADJUSTMENT,
        quantityDelta: dto.quantityDelta,
        beforeQuantity: before,
        afterQuantity: after,
        note: dto.note,
        actorUserId,
      });
      await this.audit.record({
        actorUserId,
        action: 'INVENTORY_ADJUSTMENT',
        entityType: 'InventoryBalance',
        entityId: String(balance.id),
        beforeJson: { onHand: before },
        afterJson: { onHand: after },
        reason: dto.note,
      });
      return this.withAvailable(updated);
    });
  }

  /** Reserve stock for an order. Reserve never exceeds available. */
  async reserve(dto: ReserveInventoryDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.requireBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      const available = InventoryService.available(
        Number(balance.onHand),
        Number(balance.reserved),
        Number(balance.blocked),
      );
      if (dto.quantity > available) {
        throw new BadRequestException(
          `Cannot reserve ${dto.quantity}: only ${available} available`,
        );
      }
      const updated = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { reserved: Number(balance.reserved) + dto.quantity },
      });
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.RESERVE,
        quantityDelta: 0,
        beforeQuantity: Number(balance.reserved),
        afterQuantity: Number(updated.reserved),
        note: 'Reserve for order',
        actorUserId,
      });
      return this.withAvailable(updated);
    });
  }

  /** Release a reservation (e.g. order cancelled). */
  async release(dto: ReserveInventoryDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.requireBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      if (dto.quantity > Number(balance.reserved)) {
        throw new BadRequestException('Cannot release more than currently reserved');
      }
      const updated = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { reserved: Number(balance.reserved) - dto.quantity },
      });
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.RELEASE,
        quantityDelta: 0,
        beforeQuantity: Number(balance.reserved),
        afterQuantity: Number(updated.reserved),
        note: 'Release reservation',
        actorUserId,
      });
      return this.withAvailable(updated);
    });
  }

  /**
   * FEFO allocation: pick sellable lots with the earliest expiry first.
   * Only SELLABLE lots with a latest QC PASS and available stock are eligible.
   */
  async allocateFefo(
    tx: Tx,
    params: { productVariantId: number; quantity: number },
  ): Promise<AvailableStock[]> {
    const now = new Date();
    const balances = await tx.inventoryBalance.findMany({
      where: {
        productVariantId: params.productVariantId,
        productLot: {
          status: ProductLotStatus.SELLABLE,
          expiresAt: { gte: now },
        },
      },
      include: {
        productLot: {
          include: {
            qcInspections: { orderBy: { inspectedAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const eligible = balances
      .filter((b) => {
        // Defensive re-check: never trust the query alone to enforce sellability.
        if (b.productLot.status !== ProductLotStatus.SELLABLE) return false;
        if (b.productLot.expiresAt < now) return false;
        const latest = b.productLot.qcInspections[0];
        if (!latest || latest.result !== QcResult.PASS) return false;
        return InventoryService.available(Number(b.onHand), Number(b.reserved), Number(b.blocked)) > 0;
      })
      .map((b) => ({
        balanceId: b.id,
        warehouseId: b.warehouseId,
        productLotId: b.productLotId,
        productVariantId: b.productVariantId,
        onHand: Number(b.onHand),
        reserved: Number(b.reserved),
        blocked: Number(b.blocked),
        available: InventoryService.available(Number(b.onHand), Number(b.reserved), Number(b.blocked)),
        expiresAt: b.productLot.expiresAt,
      }))
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());

    let remaining = params.quantity;
    const chosen: AvailableStock[] = [];
    for (const b of eligible) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.available);
      if (take <= 0) continue;
      chosen.push({ ...b, available: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(
        `Insufficient sellable stock for variant ${params.productVariantId}: short by ${remaining}`,
      );
    }
    return chosen;
  }

  async getOrCreateBalance(
    tx: Tx,
    warehouseId: number,
    productLotId: number,
    productVariantId: number,
  ): Promise<InventoryBalance> {
    const existing = await tx.inventoryBalance.findUnique({
      where: {
        warehouseId_productLotId_productVariantId: { warehouseId, productLotId, productVariantId },
      },
    });
    if (existing) return existing;
    const lot = await tx.productLot.findUnique({ where: { id: productLotId } });
    if (!lot) throw new NotFoundException('Product lot not found');
    return tx.inventoryBalance.create({
      data: { warehouseId, productLotId, productVariantId, unit: lot.unit },
    });
  }

  async requireBalance(
    tx: Tx,
    warehouseId: number,
    productLotId: number,
    productVariantId: number,
  ): Promise<InventoryBalance> {
    const balance = await tx.inventoryBalance.findUnique({
      where: {
        warehouseId_productLotId_productVariantId: { warehouseId, productLotId, productVariantId },
      },
    });
    if (!balance) throw new NotFoundException('Inventory balance not found');
    return balance;
  }

  async recordMovement(
    tx: Tx,
    input: {
      warehouseId: number;
      productLotId: number;
      productVariantId: number;
      type: InventoryMovementType;
      quantityDelta: number;
      beforeQuantity: number;
      afterQuantity: number;
      referenceType?: string;
      referenceId?: number;
      note?: string;
      actorUserId?: number | null;
    },
  ): Promise<void> {
    await tx.inventoryMovement.create({
      data: {
        warehouseId: input.warehouseId,
        productLotId: input.productLotId,
        productVariantId: input.productVariantId,
        type: input.type,
        quantityDelta: input.quantityDelta,
        beforeQuantity: input.beforeQuantity,
        afterQuantity: input.afterQuantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        note: input.note,
        createdByUserId: input.actorUserId ?? null,
      },
    });
  }

  movements(query: { page?: number; limit?: number; productLotId?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.InventoryMovementWhereInput = query.productLotId
      ? { productLotId: query.productLotId }
      : {};
    return Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { productLot: { select: { id: true, code: true } } },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }
}
