import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateHarvestDto, UpdateHarvestDto } from './dto/harvest.dto.js';
import type { Harvest, Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class HarvestsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateHarvestDto) {
    return this.prisma.harvest.create({
      data: {
        seasonId: dto.seasonId,
        harvestDate: new Date(dto.harvestDate),
        quantity: dto.quantity,
        unit: dto.unit,
        grade: dto.grade,
        note: dto.note,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Harvest>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.HarvestWhereInput = {};
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
    const harvest = await this.prisma.harvest.findUnique({
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
  async update(id: number, dto: UpdateHarvestDto): Promise<Harvest> {
    await this.findOne(id);
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
    return this.prisma.harvest.update({
      where: { id },
      data: {
        harvestDate: dto.harvestDate ? new Date(dto.harvestDate) : undefined,
        quantity: dto.quantity,
        unit: dto.unit,
        grade: dto.grade,
        note: dto.note,
      },
    });
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
