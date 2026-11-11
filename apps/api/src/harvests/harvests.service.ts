import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateHarvestDto, UpdateHarvestDto } from './dto/harvest.dto.js';
import type { Harvest, Prisma } from '../../generated/prisma/client.js';
import { SeasonStatus } from '../../generated/prisma/enums.js';
import { publicFarmVisibility } from '../farms/farm-visibility.js';

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Harvest records bridge a season and its product lots. A harvest therefore
 * must point at a real, writable season, cannot be dated before planting or in
 * the future, and its quantity can never fall below what has already been
 * allocated to lots (that would make the public trace chain inconsistent).
 */
@Injectable()
export class HarvestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertHarvestDate(value: string, plantingDate: Date | null): Date {
    const harvestDate = new Date(value);
    if (Number.isNaN(harvestDate.getTime())) {
      throw new BadRequestException('harvestDate is not a valid date');
    }
    if (harvestDate.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException('harvestDate cannot be in the future');
    }
    if (plantingDate && harvestDate < plantingDate) {
      throw new BadRequestException('harvestDate cannot be before the season plantingDate');
    }
    return harvestDate;
  }

  async create(dto: CreateHarvestDto, actorUserId?: number) {
    const season = await this.prisma.season.findUnique({
      where: { id: dto.seasonId },
      select: { id: true, status: true, plantingDate: true },
    });
    if (!season) throw new BadRequestException('Season not found');
    if (season.status === SeasonStatus.CANCELLED) {
      throw new BadRequestException('Cannot record a harvest on a cancelled season');
    }
    if (season.status === SeasonStatus.COMPLETED) {
      throw new BadRequestException('Cannot record a harvest on a completed season');
    }
    const unit = dto.unit.trim();
    const grade = dto.grade.trim();
    if (!unit || !grade) throw new BadRequestException('unit and grade are required');

    const harvest = await this.prisma.harvest.create({
      data: {
        seasonId: dto.seasonId,
        harvestDate: this.assertHarvestDate(dto.harvestDate, season.plantingDate),
        quantity: dto.quantity,
        unit,
        grade,
        note: dto.note?.trim() || undefined,
      },
    });
    await this.audit.record({
      actorUserId,
      action: 'HARVEST_CREATE',
      entityType: 'Harvest',
      entityId: String(harvest.id),
      afterJson: harvest,
    });
    return harvest;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Harvest>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.HarvestWhereInput = {
      season: { is: { farm: publicFarmVisibility } },
    };
    const [data, total] = await Promise.all([
      this.prisma.harvest.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { season: { select: { id: true, cropName: true, farmId: true } } },
      }),
      this.prisma.harvest.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    return this.findOneByVisibility(id, true);
  }

  private async findOneByVisibility(id: number, publicOnly: boolean) {
    const harvest = publicOnly
      ? await this.prisma.harvest.findFirst({
          where: { id, season: { is: { farm: publicFarmVisibility } } },
          include: { productLots: true, season: { include: { farm: true } } },
        })
      : await this.prisma.harvest.findUnique({
          where: { id },
          include: { productLots: true, season: { include: { farm: true } } },
        });
    if (!harvest) throw new NotFoundException('Harvest not found');
    return harvest;
  }

  /**
   * Harvest quantity is the ceiling for all lots created from it.
   * We allow correcting it upward, but never below the sum of existing lots.
   */
  async update(id: number, dto: UpdateHarvestDto, actorUserId?: number): Promise<Harvest> {
    const before = await this.findOneByVisibility(id, false);
    if (before.season.status === SeasonStatus.CANCELLED) {
      throw new BadRequestException('Cannot edit a harvest on a cancelled season');
    }
    if (before.season.status === SeasonStatus.COMPLETED) {
      throw new BadRequestException('Cannot edit a harvest on a completed season');
    }
    const harvestDate =
      dto.harvestDate === undefined
        ? undefined
        : this.assertHarvestDate(dto.harvestDate, before.season.plantingDate);

    if (dto.quantity !== undefined) {
      const lots = await this.prisma.productLot.aggregate({
        where: { harvestId: id },
        _sum: { quantity: true },
      });
      const allocated = Number(lots._sum.quantity ?? 0);
      if (dto.quantity < allocated) {
        throw new BadRequestException(
          `Harvest quantity cannot be less than the total quantity already allocated to lots (${allocated})`,
        );
      }
    }
    const unit = dto.unit === undefined ? undefined : dto.unit.trim();
    const grade = dto.grade === undefined ? undefined : dto.grade.trim();
    if (unit === '' || grade === '') {
      throw new BadRequestException('unit and grade cannot be empty');
    }

    const harvest = await this.prisma.harvest.update({
      where: { id },
      data: {
        harvestDate,
        quantity: dto.quantity,
        unit,
        grade,
        note: dto.note === undefined ? undefined : dto.note.trim() || null,
      },
    });
    await this.audit.record({
      actorUserId,
      action: 'HARVEST_UPDATE',
      entityType: 'Harvest',
      entityId: String(id),
      beforeJson: before,
      afterJson: harvest,
    });
    return harvest;
  }

  /** Sum of quantities already turned into lots for a harvest. */
  async allocatedQuantity(harvestId: number): Promise<number> {
    const agg = await this.prisma.productLot.aggregate({
      where: { harvestId },
      _sum: { quantity: true },
    });
    return Number(agg._sum.quantity ?? 0);
  }
}
