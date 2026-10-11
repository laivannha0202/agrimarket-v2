import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildDatedCode, datedCodePrefix, formatSequence, isUniqueViolationOn, nextDatedSequence } from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CreateLotDto, RecallLotDto } from './dto/lot.dto.js';
import type { Prisma, ProductLot } from '../../generated/prisma/client.js';
import { ProductLotStatus, TraceEventType } from '../../generated/prisma/enums.js';

const CODE_ATTEMPTS = 3;

@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a lot from a harvest. The sum of all lots of a harvest must never
   * exceed the harvest quantity — this is the core traceability invariant.
   * A new lot always starts as PENDING_QC: it can never be SELLABLE directly.
   *
   * The product must belong to the same farm as the harvest's season (or, for a
   * product with no farm, at least to the same partner): a lot is the physical
   * goods of one harvest, so attributing it to another producer's product would
   * make the public trace chain claim an origin the goods never had.
   *
   * The Σ ≤ harvest check runs inside the same transaction as the insert and
   * re-reads the harvest with `SELECT ... FOR UPDATE` (`lockHarvest`), so two
   * concurrent creations for one harvest serialise on the row: the second one
   * sees the first one's committed lot and is refused instead of both passing
   * the check and overshooting the harvest.
   */
  async create(dto: CreateLotDto, actorUserId?: number): Promise<ProductLot> {
    const harvest = await this.prisma.harvest.findUnique({
      where: { id: dto.harvestId },
      include: { season: { include: { farm: true } } },
    });
    if (!harvest) throw new NotFoundException('Harvest not found');

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');
    const sameFarm = product.farmId !== null && product.farmId === harvest.season.farmId;
    const samePartner = product.partnerId === harvest.season.farm.partnerId;
    if (!sameFarm && !samePartner) {
      throw new BadRequestException(
        'The product must belong to the same farm (or at least the same partner) as the harvest',
      );
    }

    const date = new Date();
    // Sequence from the highest code of the day (never a row count); the unique
    // indexes on `code` / `trace_code` are the final guard, so retry on a clash.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const sequence = await this.nextLotSequence(date);
        return await this.createLotWithSequence(dto, harvest, sequence, date, actorUserId);
      } catch (error) {
        if (isUniqueViolationOn(error, 'code', 'trace_code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /**
   * Re-read the harvest inside the transaction, holding the row (`FOR UPDATE`)
   * until the lot insert commits. Two concurrent lot creations for the same
   * harvest therefore serialise here: the second one's aggregate sees the first
   * one's committed lot. Returns the locked harvest row.
   */
  private async lockHarvest(tx: Prisma.TransactionClient, harvestId: number) {
    const rows = await tx.$queryRaw<
      { id: number; quantity: unknown; harvest_date: Date }[]
    >`SELECT id, quantity, harvest_date FROM harvests WHERE id = ${harvestId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Harvest not found');
    return rows[0];
  }

  private async nextLotSequence(date: Date): Promise<number> {
    const prefix = datedCodePrefix('LOT', date);
    const existing = await this.prisma.productLot.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });
    return nextDatedSequence(
      existing.map((row) => row.code),
      'LOT',
      date,
    );
  }

  private async createLotWithSequence(
    dto: CreateLotDto,
    harvest: { id: number; harvestDate: Date; quantity: unknown },
    sequence: number,
    date: Date,
    actorUserId?: number,
  ): Promise<ProductLot> {
    const code = buildDatedCode('LOT', sequence, date);
    const traceCode = `TRC-${formatSequence(sequence, 6)}-${date.getTime().toString(36).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      // Lock the harvest row first: the Σ-check and the insert are then atomic
      // against concurrent creations for the same harvest (see `lockHarvest`).
      const locked = await this.lockHarvest(tx, dto.harvestId);
      const allocated = await tx.productLot.aggregate({
        where: { harvestId: dto.harvestId },
        _sum: { quantity: true },
      });
      const already = Number(allocated._sum.quantity ?? 0);
      if (already + dto.quantity > Number(locked.quantity)) {
        throw new BadRequestException(
          `Total lot quantity (${already + dto.quantity}) would exceed harvest quantity (${Number(locked.quantity)})`,
        );
      }

      const lot = await tx.productLot.create({
        data: {
          code,
          traceCode,
          productId: dto.productId,
          harvestId: dto.harvestId,
          quantity: dto.quantity,
          unit: dto.unit,
          remainingQuantity: dto.quantity,
          grade: dto.grade,
          packedAt: dto.packedAt ? new Date(dto.packedAt) : null,
          expiresAt: new Date(dto.expiresAt),
          status: ProductLotStatus.PENDING_QC,
        },
      });

      await tx.traceEvent.create({
        data: {
          productLotId: lot.id,
          type: TraceEventType.HARVEST,
          occurredAt: harvest.harvestDate,
          location: null,
          description: `Lô ${lot.code} được tạo từ vụ thu hoạch ngày ${harvest.harvestDate.toISOString().slice(0, 10)}`,
          isPublic: true,
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'CREATE',
          entityType: 'ProductLot',
          entityId: String(lot.id),
          afterJson: lot,
        },
        tx,
      );
      return lot;
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: ProductLotStatus;
    productId?: number;
  }): Promise<PaginatedResult<ProductLot>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.ProductLotWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { traceCode: { contains: search } },
              { product: { name: { contains: search } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.productLot.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          product: { select: { id: true, name: true, slug: true } },
          qcInspections: { orderBy: { inspectedAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.productLot.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const lot = await this.prisma.productLot.findUnique({
      where: { id },
      include: {
        product: { include: { partner: true, category: true } },
        harvest: { include: { season: { include: { farm: true } } } },
        // The inspector is shown next to each QC row; without this the detail
        // page renders "—" for a value the QC list already displays.
        qcInspections: {
          orderBy: { inspectedAt: 'desc' },
          include: { inspectorUser: { select: { id: true, fullName: true } } },
        },
        traceEvents: { orderBy: { occurredAt: 'asc' } },
        // The stock table needs the warehouse and sale-variant names, not just
        // their ids. `available` is derived (on_hand − reserved − blocked) the
        // same way `InventoryService.withAvailable` computes it for the list.
        inventoryBalances: {
          include: {
            warehouse: { select: { id: true, code: true, name: true } },
            productVariant: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
    if (!lot) throw new NotFoundException('Product lot not found');
    return {
      ...lot,
      inventoryBalances: lot.inventoryBalances.map((b) => ({
        ...b,
        onHand: b.onHand.toString(),
        reserved: b.reserved.toString(),
        blocked: b.blocked.toString(),
        available: (
          Number(b.onHand) -
          Number(b.reserved) -
          Number(b.blocked)
        ).toFixed(3),
      })),
    };
  }

  /** Latest QC inspection of a lot (the one that decides sellability). */
  async latestInspection(lotId: number) {
    return this.prisma.qcInspection.findFirst({
      where: { productLotId: lotId },
      orderBy: { inspectedAt: 'desc' },
    });
  }

  /**
   * A lot is sellable only if: status is SELLABLE (which is only set after a
   * QC PASS) and it is not expired. This is the single source of truth used by
   * FEFO allocation.
   */
  isSellable(lot: { status: ProductLotStatus; expiresAt: Date }, at: Date = new Date()): boolean {
    return lot.status === ProductLotStatus.SELLABLE && lot.expiresAt >= at;
  }

  async recall(id: number, dto: RecallLotDto, actorUserId: number): Promise<ProductLot> {
    const before = await this.findOne(id);
    const lot = await this.prisma.productLot.update({
      where: { id },
      data: { status: ProductLotStatus.RECALLED },
    });
    await this.audit.record({
      actorUserId,
      action: 'RECALL',
      entityType: 'ProductLot',
      entityId: String(id),
      beforeJson: before,
      afterJson: lot,
      reason: dto.reason,
    });
    return lot;
  }
}
