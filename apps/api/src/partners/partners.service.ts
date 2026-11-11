import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildCode, isUniqueViolation, isUniqueViolationOn, nextSequence, uniqueViolationTarget } from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import {
  CreatePartnerDto,
  PartnerBusinessStatusDto,
  PartnerPublicResponseDto,
  PartnerVerificationDto,
  UpdatePartnerDto,
} from './dto/partner.dto.js';
import type { Partner, Prisma } from '../../generated/prisma/client.js';
import { PartnerType, PartnerVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';
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
    if (dto.type === PartnerType.UNSPECIFIED) {
      throw new BadRequestException('Vui lòng chọn loại đối tác.');
    }
    const data = this.normalizeFields(dto);
    if (!data.name || !data.phone) throw new BadRequestException('Tên và số điện thoại không được để trống.');
    await this.assertNoDuplicate(data);
    // Retry only code collisions; never reuse deleted codes or delete existing rows.
    for (let attempt = 0; attempt < 5; attempt++) {
      const codes = await this.prisma.partner.findMany({
        where: { code: { startsWith: 'PARTNER-' } },
        select: { code: true },
      });
      const code = buildCode('PARTNER', nextSequence(codes.map((item) => item.code), 'PARTNER'));
      try {
        return await this.prisma.$transaction(async (tx) => {
          const partner = await tx.partner.create({
            data: { ...data, code, status: RecordStatus.INACTIVE, verificationStatus: PartnerVerificationStatus.PENDING },
          });
          await this.audit.record({
            actorUserId, action: 'CREATE', entityType: 'Partner', entityId: String(partner.id), afterJson: partner,
          }, tx);
          return partner;
        });
      } catch (error) {
        if (isUniqueViolationOn(error, 'partners_code_key')) continue;
        if (isUniqueViolation(error)) throw this.duplicateError(error);
        throw error;
      }
    }
    throw new ConflictException('Không cấp được mã đối tác. Vui lòng thử lại.');
  }

  private duplicateError(error: unknown): ConflictException {
    const target = uniqueViolationTarget(error);
    if (target.includes('phone')) return new ConflictException('Số điện thoại đã được sử dụng bởi đối tác khác.');
    if (target.includes('email')) return new ConflictException('Email đã được sử dụng bởi đối tác khác.');
    if (target.includes('tax_code') || target.includes('taxcode')) {
      return new ConflictException('Mã số thuế đã được sử dụng bởi đối tác khác.');
    }
    return new ConflictException('Thông tin đối tác bị trùng. Vui lòng kiểm tra lại.');
  }

  private normalizeFields<T extends CreatePartnerDto | UpdatePartnerDto>(dto: T): T {
    const cleaned = { ...dto } as Record<string, unknown>;
    for (const key of [
      'name', 'representativeName', 'phone', 'email', 'address', 'taxCode',
      'registrationDocumentUrl', 'bankAccountName', 'bankAccountNumber', 'bankName',
    ]) {
      const value = cleaned[key];
      if (typeof value === 'string') cleaned[key] = value.trim() || null;
    }
    return cleaned as T;
  }

  private async assertNoDuplicate(
    data: { phone?: string | null; email?: string | null; taxCode?: string | null },
    excludeId?: number,
  ) {
    const checks = [
      { key: 'phone', label: 'Số điện thoại', value: data.phone },
      { key: 'email', label: 'Email', value: data.email },
      { key: 'taxCode', label: 'Mã số thuế', value: data.taxCode },
    ] as const;
    for (const check of checks) {
      if (!check.value) continue;
      const existing = await this.prisma.partner.findFirst({
        where: { [check.key]: check.value, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (existing) throw new ConflictException(`${check.label} đã được sử dụng bởi đối tác khác.`);
    }
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: RecordStatus;
      type?: PartnerType;
      verificationStatus?: PartnerVerificationStatus;
    },
    viewer?: AuthenticatedUser,
  ): Promise<PaginatedResult<Partner> | PaginatedResult<PartnerPublicResponseDto>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.PartnerWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
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
    if (dto.type === PartnerType.UNSPECIFIED) {
      throw new BadRequestException('Vui lòng chọn loại đối tác.');
    }
    const data = this.normalizeFields(dto);
    if (data.name === null || data.phone === null) {
      throw new BadRequestException('Tên và số điện thoại không được để trống.');
    }
    await this.assertNoDuplicate(data, id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM partners WHERE id = ${id} FOR UPDATE
        `;
        // Preserve the full pre-image for audit and commit both writes atomically.
        const before = await tx.partner.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('Partner not found');
        const legalChanged =
          (data.type !== undefined && data.type !== before.type) ||
          (data.name !== undefined && data.name !== before.name) ||
          (data.taxCode !== undefined && data.taxCode !== before.taxCode) ||
          (data.registrationDocumentUrl !== undefined && data.registrationDocumentUrl !== before.registrationDocumentUrl);
        if (legalChanged && before.status === RecordStatus.ACTIVE &&
            before.verificationStatus === PartnerVerificationStatus.VERIFIED) {
          throw new ConflictException('Cần tạm khóa kinh doanh trước khi sửa thông tin pháp lý đã xác minh.');
        }
        const partner = await tx.partner.update({
          where: { id },
          data: {
            ...data,
            ...(legalChanged && before.verificationStatus === PartnerVerificationStatus.VERIFIED
              ? { verificationStatus: PartnerVerificationStatus.PENDING }
              : {}),
          },
        });
        await this.audit.record({
          actorUserId,
          action: 'UPDATE',
          entityType: 'Partner',
          entityId: String(id),
          beforeJson: before,
          afterJson: partner,
        }, tx);
        return partner;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.duplicateError(error);
      throw error;
    }
  }

  async impact(id: number) {
    const existing = await this.prisma.partner.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Partner not found');
    const [farms, activeFarms, products, activeProducts, openOrders] = await Promise.all([
      this.prisma.farm.count({ where: { partnerId: id } }),
      this.prisma.farm.count({ where: { partnerId: id, status: RecordStatus.ACTIVE } }),
      this.prisma.product.count({ where: { partnerId: id } }),
      this.prisma.product.count({ where: { partnerId: id, status: RecordStatus.ACTIVE } }),
      this.prisma.partnerOrder.count({
        where: { partnerId: id, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      }),
    ]);
    return { farms, activeFarms, products, activeProducts, openOrders };
  }

  async verify(id: number, dto: PartnerVerificationDto, actorUserId: number) {
    if (dto.verificationStatus === PartnerVerificationStatus.REJECTED && !dto.reason?.trim()) {
      throw new BadRequestException('Vui lòng nhập lý do từ chối xác minh.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM partners WHERE id = ${id} FOR UPDATE
      `;
      const before = await tx.partner.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Partner not found');
      if (before.status === RecordStatus.ACTIVE && dto.verificationStatus !== PartnerVerificationStatus.VERIFIED) {
        throw new ConflictException('Cần tạm khóa kinh doanh trước khi thay đổi trạng thái xác minh hồ sơ.');
      }
      if (dto.verificationStatus === PartnerVerificationStatus.VERIFIED &&
          (before.type === PartnerType.UNSPECIFIED || !before.registrationDocumentUrl ||
          (before.type !== PartnerType.INDIVIDUAL && !before.taxCode))) {
        throw new BadRequestException('Chưa đủ hồ sơ pháp lý để xác minh (loại hình, giấy tờ và mã số thuế/đăng ký).');
      }
      const partner = await tx.partner.update({ where: { id }, data: { verificationStatus: dto.verificationStatus } });
      await this.audit.record({
        actorUserId, action: `PARTNER_VERIFY_${dto.verificationStatus}`, entityType: 'Partner',
        entityId: String(id), beforeJson: before, afterJson: partner, reason: dto.reason?.trim(),
      }, tx);
      return partner;
    });
  }

  async changeBusinessStatus(id: number, dto: PartnerBusinessStatusDto, actorUserId: number) {
    if (!dto.reason?.trim()) throw new BadRequestException('Vui lòng nhập lý do thay đổi trạng thái.');
    return this.prisma.$transaction(async (tx) => {
      // Product publication takes this same Partner lock before inserting or
      // activating a Product. Re-read and evaluate blockers only after the lock
      // so one of the competing operations must observe the other's commit.
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM partners WHERE id = ${id} FOR UPDATE
      `;
      const before = await tx.partner.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Partner not found');
      if (dto.status === RecordStatus.ACTIVE && before.verificationStatus !== PartnerVerificationStatus.VERIFIED) {
        throw new BadRequestException('Chỉ có thể kích hoạt kinh doanh khi hồ sơ đã xác minh.');
      }
      if (dto.status === RecordStatus.INACTIVE && before.status !== RecordStatus.INACTIVE) {
        const [activeProducts, openOrders] = await Promise.all([
          tx.product.count({ where: { partnerId: id, status: RecordStatus.ACTIVE } }),
          tx.partnerOrder.count({ where: { partnerId: id, status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
        ]);
        if (activeProducts || openOrders) {
          throw new ConflictException(`Cần xử lý ${activeProducts} sản phẩm đang bán và ${openOrders} đơn hàng đang xử lý trước khi khóa.`);
        }
      }
      const partner = await tx.partner.update({ where: { id }, data: { status: dto.status } });
      await this.audit.record({
        actorUserId, action: `PARTNER_BUSINESS_${dto.status}`, entityType: 'Partner',
        entityId: String(id), beforeJson: before, afterJson: partner, reason: dto.reason.trim(),
      }, tx);
      return partner;
    });
  }

  async history(id: number) {
    const partner = await this.prisma.partner.findUnique({ where: { id }, select: { id: true } });
    if (!partner) throw new NotFoundException('Partner not found');
    // Return metadata only. Full audit snapshots contain bank details.
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Partner', entityId: String(id) },
      select: {
        id: true, action: true, reason: true, createdAt: true,
        actorUser: { select: { fullName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
  }
}
