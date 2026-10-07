import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildCode } from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto.js';
import type { Partner, Prisma } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreatePartnerDto, actorUserId?: number): Promise<Partner> {
    const count = await this.prisma.partner.count();
    const code = buildCode('PARTNER', count + 1);
    const partner = await this.prisma.partner.create({ data: { ...dto, code } });
    await this.audit.record({
      actorUserId,
      action: 'CREATE',
      entityType: 'Partner',
      entityId: String(partner.id),
      afterJson: partner,
    });
    return partner;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }): Promise<PaginatedResult<Partner>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.PartnerWhereInput = {
      ...(query.status ? { status: query.status as RecordStatus } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { name: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.partner.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
      this.prisma.partner.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Partner> {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  async update(id: number, dto: UpdatePartnerDto, actorUserId?: number): Promise<Partner> {
    const before = await this.findOne(id);
    const partner = await this.prisma.partner.update({ where: { id }, data: dto });
    await this.audit.record({
      actorUserId,
      action: 'UPDATE',
      entityType: 'Partner',
      entityId: String(id),
      beforeJson: before,
      afterJson: partner,
    });
    return partner;
  }
}
