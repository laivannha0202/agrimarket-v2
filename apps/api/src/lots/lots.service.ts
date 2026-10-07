import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildDatedCode, formatSequence } from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CreateLotDto, RecallLotDto } from './dto/lot.dto.js';
import type { Prisma, ProductLot } from '../../generated/prisma/client.js';
import { ProductLotStatus, TraceEventType } from '../../generated/prisma/enums.js';

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
   */
  async create(dto: CreateLotDto, actorUserId?: number): Promise<ProductLot> {
    const harvest = await this.prisma.harvest.findUnique({ where: { id: dto.harvestId } });
    if (!harvest) throw new NotFoundException('Harvest not found');

    const allocated = await this.prisma.productLot.aggregate({
      where: { harvestId: dto.harvestId },
      _sum: { quantity: true },
    });
    const already = Number(allocated._sum.quantity ?? 0);
    if (already + dto.quantity > Number(harvest.quantity)) {
      throw new BadRequestException(
        `Total lot quantity (${already + dto.quantity}) would exceed harvest quantity (${Number(harvest.quantity)})`,
      );
    }

    const date = new Date();
    const sameDayCount = await this.prisma.productLot.count({
      where: { createdAt: { gte: startOfDay(date) } },
    });
    const code = buildDatedCode('LOT', sameDayCount + 1, date);
    const traceCode = `TRC-${formatSequence(sameDayCount + 1, 6)}-${date.getTime().toString(36).toUpperCase()}`;

    const lot = await this.prisma.productLot.create({
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

    await this.prisma.traceEvent.create({
      data: {
        productLotId: lot.id,
        type: TraceEventType.HARVEST,
        occurredAt: harvest.harvestDate,
        location: null,
        description: `Lô ${lot.code} được tạo từ vụ thu hoạch ngày ${harvest.harvestDate.toISOString().slice(0, 10)}`,
        isPublic: true,
      },
    });

    await this.audit.record({
      actorUserId,
      action: 'CREATE',
      entityType: 'ProductLot',
      entityId: String(lot.id),
      afterJson: lot,
    });
    return lot;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    productId?: number;
  }): Promise<PaginatedResult<ProductLot>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.ProductLotWhereInput = {
      ...(query.status ? { status: query.status as ProductLotStatus } : {}),
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
        qcInspections: { orderBy: { inspectedAt: 'desc' } },
        traceEvents: { orderBy: { occurredAt: 'asc' } },
        inventoryBalances: true,
      },
    });
    if (!lot) throw new NotFoundException('Product lot not found');
    return lot;
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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
