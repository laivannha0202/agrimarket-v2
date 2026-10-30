import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateSeasonDto, UpdateSeasonDto } from './dto/season.dto.js';
import type { Season, Prisma } from '../../generated/prisma/client.js';
import { RecordStatus, SeasonStatus } from '../../generated/prisma/enums.js';

function parseDate(value: string | undefined, field: string): Date | null {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return date;
}

function requireText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${field} cannot be empty`);
  return trimmed;
}

/**
 * C-14: season/farming/harvest authoring is the root of the public trace chain.
 * A season therefore cannot reference a missing farm, start after its expected
 * harvest, or be silently re-opened after it was cancelled/completed.
 */
@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertDates(plantingDate: Date | null, expectedHarvestDate: Date | null): void {
    if (plantingDate && expectedHarvestDate && expectedHarvestDate < plantingDate) {
      throw new BadRequestException('expectedHarvestDate must be on or after plantingDate');
    }
  }

  async create(dto: CreateSeasonDto, actorUserId?: number) {
    const farm = await this.prisma.farm.findUnique({ where: { id: dto.farmId } });
    if (!farm) throw new BadRequestException('Farm not found');
    if (farm.status !== RecordStatus.ACTIVE) {
      throw new BadRequestException('Cannot create a season for an inactive farm');
    }
    const cropName = requireText(dto.cropName, 'cropName')!;
    const plantingDate = parseDate(dto.plantingDate, 'plantingDate');
    const expectedHarvestDate = parseDate(dto.expectedHarvestDate, 'expectedHarvestDate');
    this.assertDates(plantingDate, expectedHarvestDate);

    const season = await this.prisma.season.create({
      data: {
        farmId: dto.farmId,
        cropName,
        variety: requireText(dto.variety, 'variety'),
        plantingDate,
        expectedHarvestDate,
        expectedYield: dto.expectedYield,
        yieldUnit: requireText(dto.yieldUnit, 'yieldUnit'),
        status: dto.status,
      },
    });
    await this.audit.record({
      actorUserId,
      action: 'SEASON_CREATE',
      entityType: 'Season',
      entityId: String(season.id),
      afterJson: season,
    });
    return season;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: SeasonStatus;
    farmId?: number;
  }): Promise<PaginatedResult<Season>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SeasonWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.farmId ? { farmId: query.farmId } : {}),
    };
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
        farm: { include: { partner: { select: { id: true, code: true, name: true, representativeName: true } } } },
        farmingEvents: { orderBy: { occurredAt: 'desc' } },
        harvests: true,
      },
    });
    if (!season) throw new NotFoundException('Season not found');
    return season;
  }

  async update(id: number, dto: UpdateSeasonDto, actorUserId?: number): Promise<Season> {
    const season = await this.findOne(id);
    if (season.status === SeasonStatus.CANCELLED) {
      throw new BadRequestException('A cancelled season cannot be edited');
    }
    if (season.status === SeasonStatus.COMPLETED) {
      const reopens = dto.status !== undefined && dto.status !== SeasonStatus.COMPLETED;
      const changesClosedData =
        dto.cropName !== undefined ||
        dto.variety !== undefined ||
        dto.plantingDate !== undefined ||
        dto.expectedHarvestDate !== undefined ||
        dto.expectedYield !== undefined ||
        dto.yieldUnit !== undefined;
      if (reopens || changesClosedData) {
        throw new BadRequestException(
          'A completed season is a closed trace record and cannot be edited or re-opened',
        );
      }
    }

    const plantingDate =
      dto.plantingDate === undefined ? season.plantingDate : parseDate(dto.plantingDate, 'plantingDate');
    const expectedHarvestDate =
      dto.expectedHarvestDate === undefined
        ? season.expectedHarvestDate
        : parseDate(dto.expectedHarvestDate, 'expectedHarvestDate');
    this.assertDates(plantingDate, expectedHarvestDate);

    const updated = await this.prisma.season.update({
      where: { id },
      data: {
        cropName: requireText(dto.cropName, 'cropName'),
        variety: dto.variety === undefined ? undefined : requireText(dto.variety, 'variety'),
        plantingDate: plantingDate ?? undefined,
        expectedHarvestDate: expectedHarvestDate ?? undefined,
        expectedYield: dto.expectedYield,
        yieldUnit: dto.yieldUnit === undefined ? undefined : requireText(dto.yieldUnit, 'yieldUnit'),
        status: dto.status,
      },
    });
    await this.audit.record({
      actorUserId,
      action: 'SEASON_UPDATE',
      entityType: 'Season',
      entityId: String(id),
      beforeJson: season,
      afterJson: updated,
    });
    return updated;
  }
}
