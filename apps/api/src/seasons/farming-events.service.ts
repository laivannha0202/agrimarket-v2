import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { CreateFarmingEventDto, UpdateFarmingEventDto } from './dto/farming-event.dto.js';
import { SeasonStatus } from '../../generated/prisma/enums.js';

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Farming logs are part of the public trace chain. They can be corrected, but
 * not on a cancelled/completed season, not with an empty text, and not with a
 * timestamp in the future (which would fabricate work that has not happened).
 */
@Injectable()
export class FarmingEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertOccurredAt(value: string): Date {
    const occurredAt = new Date(value);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt is not a valid date');
    }
    if (occurredAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException('occurredAt cannot be in the future');
    }
    return occurredAt;
  }

  private assertSeasonWritable(status: SeasonStatus): void {
    if (status === SeasonStatus.CANCELLED) {
      throw new BadRequestException('Cannot record farming activity on a cancelled season');
    }
    if (status === SeasonStatus.COMPLETED) {
      throw new BadRequestException('Cannot record farming activity on a completed season');
    }
  }

  async create(dto: CreateFarmingEventDto, actorUserId?: number) {
    const season = await this.prisma.season.findUnique({
      where: { id: dto.seasonId },
      select: { id: true, status: true },
    });
    if (!season) throw new BadRequestException('Season not found');
    this.assertSeasonWritable(season.status);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('content cannot be empty');

    const event = await this.prisma.farmingEvent.create({
      data: {
        seasonId: dto.seasonId,
        type: dto.type,
        occurredAt: this.assertOccurredAt(dto.occurredAt),
        content,
        isPublic: dto.isPublic ?? true,
      },
    });
    await this.audit.record({
      actorUserId,
      action: 'FARMING_EVENT_CREATE',
      entityType: 'FarmingEvent',
      entityId: String(event.id),
      afterJson: event,
    });
    return event;
  }

  async update(id: number, dto: UpdateFarmingEventDto, actorUserId?: number) {
    const before = await this.prisma.farmingEvent.findUnique({
      where: { id },
      include: { season: { select: { status: true } } },
    });
    if (!before) throw new NotFoundException('Farming event not found');
    this.assertSeasonWritable(before.season.status);
    const content = dto.content === undefined ? undefined : dto.content.trim();
    if (content !== undefined && !content) {
      throw new BadRequestException('content cannot be empty');
    }

    const event = await this.prisma.farmingEvent.update({
      where: { id },
      data: {
        type: dto.type,
        occurredAt:
          dto.occurredAt === undefined ? undefined : this.assertOccurredAt(dto.occurredAt),
        content,
        isPublic: dto.isPublic,
      },
    });
    await this.audit.record({
      actorUserId,
      action: 'FARMING_EVENT_UPDATE',
      entityType: 'FarmingEvent',
      entityId: String(id),
      beforeJson: before,
      afterJson: event,
    });
    return event;
  }

  async findBySeason(seasonId: number) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true },
    });
    if (!season) throw new NotFoundException('Season not found');
    return this.prisma.farmingEvent.findMany({
      where: { seasonId },
      orderBy: { occurredAt: 'desc' },
    });
  }
}
