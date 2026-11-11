import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import {
  buildCode,
  isUniqueViolationOn,
  nextSequence,
} from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import {
  CreateFarmDto,
  TransferFarmPartnerDto,
  UpdateFarmDto,
} from './dto/farm.dto.js';
import type { Farm, Prisma } from '../../generated/prisma/client.js';
import { PartnerVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';
import { publicPartnerVisibility } from './farm-visibility.js';

const CODE_ATTEMPTS = 3;
const farmInclude = {
  partner: { select: { id: true, code: true, name: true } },
} satisfies Prisma.FarmInclude;

@Injectable()
export class FarmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(prisma),
  ) {}

  async create(dto: CreateFarmDto): Promise<Farm> {
    const targetStatus = dto.status ?? RecordStatus.ACTIVE;
    await this.assertPartnerCanUseFarmStatus(dto.partnerId, targetStatus);

    // Sequence from the highest existing code (never a row count), with a retry
    // when a concurrent insert wins the race for the same number.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.createWithNextCode(dto);
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS)
          continue;
        throw error;
      }
    }
  }

  private async createWithNextCode(dto: CreateFarmDto): Promise<Farm> {
    const existing = await this.prisma.farm.findMany({
      where: { code: { startsWith: 'FARM-' } },
      select: { code: true },
    });
    const code = buildCode(
      'FARM',
      nextSequence(
        existing.map((row) => row.code),
        'FARM',
      ),
    );
    return this.prisma.farm.create({
      data: {
        ...dto,
        code,
        status: dto.status ?? RecordStatus.ACTIVE,
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
  }, viewer?: AuthenticatedUser): Promise<PaginatedResult<Farm>> {
    const { skip, take, page, limit } = buildPagination(
      query.page,
      query.limit,
    );
    const search = normalizeSearch(query.search);
    const isAdmin = viewer?.role === 'ADMIN';
    const where: Prisma.FarmWhereInput = {
      ...(isAdmin
        ? query.status
          ? { status: query.status }
          : {}
        : {
            status: RecordStatus.ACTIVE,
            partner: publicPartnerVisibility,
          }),
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
        include: farmInclude,
      }),
      this.prisma.farm.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number, viewer?: AuthenticatedUser) {
    if (viewer?.role === 'ADMIN') return this.findOneUnfiltered(id);

    const farm = await this.prisma.farm.findFirst({
      where: {
        id,
        status: RecordStatus.ACTIVE,
        partner: publicPartnerVisibility,
      },
      include: farmInclude,
    });
    if (!farm) throw new NotFoundException('Farm not found');
    return farm;
  }

  private async findOneUnfiltered(id: number) {
    const farm = await this.prisma.farm.findUnique({
      where: { id },
      include: farmInclude,
    });
    if (!farm) throw new NotFoundException('Farm not found');
    return farm;
  }

  async update(id: number, dto: UpdateFarmDto): Promise<Farm> {
    // This method is ADMIN-only at the controller. Resolve drafts without the
    // public visibility predicate so an administrator can still edit them.
    const farm = await this.findOneUnfiltered(id);
    if (dto.status === RecordStatus.ACTIVE) {
      await this.assertPartnerCanUseFarmStatus(
        farm.partnerId,
        RecordStatus.ACTIVE,
      );
    }
    return this.prisma.farm.update({ where: { id }, data: dto });
  }

  async transferPartner(
    id: number,
    dto: TransferFarmPartnerDto,
    actor: AuthenticatedUser,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Insufficient permissions');
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Vui lòng nhập lý do chuyển trang trại.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Lock the Farm before reading its status or checking relations. InnoDB
        // foreign-key writes that attach Product/Season/Certificate rows need a
        // shared lock on this row, so they serialize before or after this move.
        await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM farms WHERE id = ${id} FOR UPDATE
        `;
        const farm = await tx.farm.findUnique({
          where: { id },
          include: farmInclude,
        });
        if (!farm) throw new NotFoundException('Farm not found');
        if (farm.status !== RecordStatus.INACTIVE) {
          throw new ConflictException('Chỉ có thể chuyển trang trại đang INACTIVE.');
        }
        if (farm.partnerId === dto.newPartnerId) {
          throw new ConflictException('Trang trại đang thuộc HTX/đối tác này.');
        }

        // Lock the destination so it cannot be suspended or unverified between
        // eligibility validation and commit.
        await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM partners WHERE id = ${dto.newPartnerId} FOR UPDATE
        `;
        const newPartner = await tx.partner.findUnique({
          where: { id: dto.newPartnerId },
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            verificationStatus: true,
          },
        });
        if (!newPartner) throw new NotFoundException('Đối tác tiếp nhận không tồn tại.');
        if (
          newPartner.status !== RecordStatus.ACTIVE ||
          newPartner.verificationStatus !== PartnerVerificationStatus.VERIFIED
        ) {
          throw new BadRequestException(
            'HTX/đối tác tiếp nhận phải VERIFIED và đang ACTIVE.',
          );
        }

        // These are the Farm's direct business roots. Harvest, farming events,
        // product lots and trace events are descendants of Season or Product;
        // with the foreign keys intact, none can exist without one of these.
        const [productCount, seasonCount, certificateCount] = await Promise.all([
          tx.product.count({ where: { farmId: id } }),
          tx.season.count({ where: { farmId: id } }),
          tx.certificate.count({ where: { farmId: id } }),
        ]);
        if (productCount + seasonCount + certificateCount > 0) {
          throw new ConflictException(
            'Không thể chuyển trang trại đã có sản phẩm, mùa vụ hoặc chứng nhận liên kết.',
          );
        }

        const updated = await tx.farm.update({
          where: { id },
          data: { partnerId: newPartner.id },
          include: farmInclude,
        });
        await this.audit.record(
          {
            actorUserId: actor.id,
            action: 'FARM_PARTNER_TRANSFER',
            entityType: 'Farm',
            entityId: String(id),
            beforeJson: {
              partnerId: farm.partnerId,
              partner: farm.partner,
            },
            afterJson: {
              partnerId: newPartner.id,
              partner: {
                id: newPartner.id,
                code: newPartner.code,
                name: newPartner.name,
              },
            },
            reason,
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  private async assertPartnerCanUseFarmStatus(
    partnerId: number,
    farmStatus: RecordStatus,
  ): Promise<void> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, status: true, verificationStatus: true },
    });
    if (!partner) throw new NotFoundException('Đối tác không tồn tại.');

    // INACTIVE farms act as drafts and may be declared while partner review is pending.
    if (farmStatus === RecordStatus.INACTIVE) return;

    if (
      partner.status !== RecordStatus.ACTIVE ||
      partner.verificationStatus !== PartnerVerificationStatus.VERIFIED
    ) {
      throw new BadRequestException(
        'Đối tác phải được xác minh (VERIFIED) và đang hoạt động kinh doanh (ACTIVE) để tạo hoặc kích hoạt trang trại.',
      );
    }
  }
}
