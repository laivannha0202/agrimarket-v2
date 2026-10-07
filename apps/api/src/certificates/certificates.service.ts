import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateCertificateDto, VerifyCertificateDto } from './dto/certificate.dto.js';
import type { Certificate, Prisma } from '../../generated/prisma/client.js';
import { CertificateVerificationStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  create(dto: CreateCertificateDto) {
    return this.prisma.certificate.create({
      data: {
        farmId: dto.farmId,
        type: dto.type,
        certificateCode: dto.certificateCode,
        issuer: dto.issuer,
        issuedAt: new Date(dto.issuedAt),
        expiresAt: new Date(dto.expiresAt),
        fileUrl: dto.fileUrl,
        status: dto.status,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResult<Certificate>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.CertificateWhereInput = query.status
      ? { verificationStatus: query.status as CertificateVerificationStatus }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { farm: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Certificate> {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');
    return cert;
  }

  /**
   * AgriMarket only verifies paperwork — it does not issue certificates.
   * Verified certificates are only valid while not expired.
   */
  async verify(id: number, dto: VerifyCertificateDto, actorUserId: number): Promise<Certificate> {
    const before = await this.findOne(id);
    if (dto.verificationStatus === CertificateVerificationStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('rejectionReason is required when rejecting a certificate');
    }
    const cert = await this.prisma.certificate.update({
      where: { id },
      data: {
        verificationStatus: dto.verificationStatus,
        verifiedAt:
          dto.verificationStatus === CertificateVerificationStatus.PENDING ? null : new Date(),
        rejectionReason:
          dto.verificationStatus === CertificateVerificationStatus.REJECTED
            ? dto.rejectionReason
            : null,
      },
    });
    await this.audit.record({
      actorUserId,
      action: `CERTIFICATE_${dto.verificationStatus}`,
      entityType: 'Certificate',
      entityId: String(id),
      beforeJson: before,
      afterJson: cert,
      reason: dto.rejectionReason,
    });
    return cert;
  }

  /** Valid = VERIFIED, ACTIVE, and not expired at the given time. */
  async findValidByFarm(farmId: number, at: Date = new Date()): Promise<Certificate[]> {
    return this.prisma.certificate.findMany({
      where: {
        farmId,
        verificationStatus: CertificateVerificationStatus.VERIFIED,
        status: 'ACTIVE',
        issuedAt: { lte: at },
        expiresAt: { gte: at },
      },
    });
  }
}
