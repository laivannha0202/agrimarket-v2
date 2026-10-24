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
import {
  CreatePartnerDto,
  PartnerPublicResponseDto,
  UpdatePartnerDto,
} from './dto/partner.dto.js';
import type { Partner, Prisma } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

/**
 * The only columns a public/customer read may load. Keeping this as a Prisma
 * `select` (rather than fetching the full row and deleting fields in memory)
 * means bank/tax values never leave the database for an anonymous request.
 */
export const PUBLIC_PARTNER_SELECT = {
  id: true,
  code: true,
  name: true,
  representativeName: true,
  phone: true,
  email: true,
  address: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PartnerSelect;

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

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: RecordStatus;
    },
    viewer?: AuthenticatedUser,
  ): Promise<PaginatedResult<Partner> | PaginatedResult<PartnerPublicResponseDto>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.PartnerWhereInput = {
      ...(query.status ? { status: query.status } : {}),
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

    const total = this.prisma.partner.count({ where });
    const orderBy: Prisma.PartnerOrderByWithRelationInput = { id: 'desc' };

    if (viewer?.role === 'ADMIN') {
      const [data, count] = await Promise.all([
        this.prisma.partner.findMany({ where, skip, take, orderBy }),
        total,
      ]);
      return paginate(data, count, page, limit);
    }

    const [data, count] = await Promise.all([
      this.prisma.partner.findMany({
        where,
        skip,
        take,
        orderBy,
        select: PUBLIC_PARTNER_SELECT,
      }),
      total,
    ]);
    return paginate(data, count, page, limit);
  }

  async findOne(
    id: number,
    viewer?: AuthenticatedUser,
  ): Promise<Partner | PartnerPublicResponseDto> {
    if (viewer?.role === 'ADMIN') {
      const partner = await this.prisma.partner.findUnique({ where: { id } });
      if (!partner) throw new NotFoundException('Partner not found');
      return partner;
    }

    const partner = await this.prisma.partner.findUnique({
      where: { id },
      select: PUBLIC_PARTNER_SELECT,
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  async update(id: number, dto: UpdatePartnerDto, actorUserId?: number): Promise<Partner> {
    // The audit snapshot must contain the FULL pre-image. Calling `findOne(id)`
    // without a viewer would return the public projection and silently drop the
    // bank/tax fields from `beforeJson`.
    const before = await this.prisma.partner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Partner not found');

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
