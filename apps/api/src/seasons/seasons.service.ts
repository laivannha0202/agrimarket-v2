import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateSeasonDto, UpdateSeasonDto } from './dto/season.dto.js';
import type { Season, Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class SeasonsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSeasonDto) {
    return this.prisma.season.create({
      data: {
        farmId: dto.farmId,
        cropName: dto.cropName,
        variety: dto.variety,
        plantingDate: dto.plantingDate ? new Date(dto.plantingDate) : null,
        expectedHarvestDate: dto.expectedHarvestDate ? new Date(dto.expectedHarvestDate) : null,
        expectedYield: dto.expectedYield,
        yieldUnit: dto.yieldUnit,
        status: dto.status,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResult<Season>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SeasonWhereInput = query.status
      ? { status: query.status as Prisma.SeasonWhereInput['status'] }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.season.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { farm: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.season.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const season = await this.prisma.season.findUnique({
      where: { id },
      include: {
        farm: { include: { partner: true } },
        farmingEvents: { orderBy: { occurredAt: 'desc' } },
        harvests: true,
      },
    });
    if (!season) throw new NotFoundException('Season not found');
    return season;
  }

  async update(id: number, dto: UpdateSeasonDto): Promise<Season> {
    await this.findOne(id);
    return this.prisma.season.update({
      where: { id },
      data: {
        cropName: dto.cropName,
        variety: dto.variety,
        plantingDate: dto.plantingDate ? new Date(dto.plantingDate) : undefined,
        expectedHarvestDate: dto.expectedHarvestDate ? new Date(dto.expectedHarvestDate) : undefined,
        expectedYield: dto.expectedYield,
        yieldUnit: dto.yieldUnit,
        status: dto.status,
      },
    });
  }
}
