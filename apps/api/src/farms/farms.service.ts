import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildCode, isUniqueViolationOn, nextSequence } from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CreateFarmDto, UpdateFarmDto } from './dto/farm.dto.js';
import type { Farm, Prisma } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

const CODE_ATTEMPTS = 3;

@Injectable()
export class FarmsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateFarmDto): Promise<Farm> {
    // Sequence from the highest existing code (never a row count), with a retry
    // when a concurrent insert wins the race for the same number.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.createWithNextCode(dto);
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  private async createWithNextCode(dto: CreateFarmDto): Promise<Farm> {
    const existing = await this.prisma.farm.findMany({
      where: { code: { startsWith: 'FARM-' } },
      select: { code: true },
    });
    const code = buildCode('FARM', nextSequence(existing.map((row) => row.code), 'FARM'));
    return this.prisma.farm.create({
      data: {
        ...dto,
        code,
        latitude: dto.latitude,
        longitude: dto.longitude,
        areaHa: dto.areaHa,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: RecordStatus;
    partnerId?: number;
  }): Promise<PaginatedResult<Farm>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.FarmWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { name: { contains: search } },
              { address: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.farm.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { partner: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.farm.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const farm = await this.prisma.farm.findUnique({
      where: { id },
      include: { partner: { select: { id: true, code: true, name: true } } },
    });
    if (!farm) throw new NotFoundException('Farm not found');
    return farm;
  }

  async update(id: number, dto: UpdateFarmDto): Promise<Farm> {
    await this.findOne(id);
    return this.prisma.farm.update({ where: { id }, data: dto });
  }
}
