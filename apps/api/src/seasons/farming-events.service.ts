import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CreateFarmingEventDto } from './dto/farming-event.dto.js';

@Injectable()
export class FarmingEventsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateFarmingEventDto) {
    return this.prisma.farmingEvent.create({
      data: {
        seasonId: dto.seasonId,
        type: dto.type,
        occurredAt: new Date(dto.occurredAt),
        content: dto.content,
        isPublic: dto.isPublic ?? true,
      },
    });
  }

  findBySeason(seasonId: number) {
    return this.prisma.farmingEvent.findMany({
      where: { seasonId },
      orderBy: { occurredAt: 'desc' },
    });
  }
}
