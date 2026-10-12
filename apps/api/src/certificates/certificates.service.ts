import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateCertificateDto, VerifyCertificateDto } from './dto/certificate.dto.js';
import type { Certificate, Prisma } from '../../generated/prisma/client.js';
import { CertificateVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';

/**
 * Computed certificate validity, evaluated at read time.
 *
 * A certificate is `VALID` only while it is VERIFIED, ACTIVE, within
 * `[issuedAt, expiresAt]`, and carries a document (`fileUrl`). `EXPIRED` means
 * the only thing wrong is the date window (the paperwork was verified but time
 * ran out); `INVALID` covers every other non-valid state (pending, rejected,
 * inactive, not-yet-effective, missing document). The stored
 * `verificationStatus`/`status` are never rewritten by a read — they stay the
 * historical record — so an expired VERIFIED row keeps its flag but is never
 * presented as currently valid.
 */
export type CertificateValidity = 'VALID' | 'EXPIRED' | 'INVALID';

export function certificateValidityAt(
  cert: Pick<Certificate, 'verificationStatus' | 'status' | 'issuedAt' | 'expiresAt' | 'fileUrl'>,
  at: Date = new Date(),
): CertificateValidity {
  const verified = cert.verificationStatus === CertificateVerificationStatus.VERIFIED;
  const active = cert.status === RecordStatus.ACTIVE;
  const inWindow = cert.issuedAt <= at && cert.expiresAt >= at;
  const hasDocument = (cert.fileUrl ?? '').trim().length > 0;
  if (verified && active && inWindow && hasDocument) return 'VALID';
  // Outside the window the certificate can never be presented as valid,
  // regardless of which other condition also fails: an expired PENDING row is
  // still past its dates, not merely "awaiting verification".
  if (!inWindow) return 'EXPIRED';
  return 'INVALID';
}

export type CertificateWithValidity = Certificate & { validity: CertificateValidity };

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCertificateDto): Promise<CertificateWithValidity> {
    const cert = await this.prisma.certificate.create({
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
    return { ...cert, validity: certificateValidityAt(cert) };
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: CertificateVerificationStatus;
    farmId?: number;
  }): Promise<PaginatedResult<CertificateWithValidity>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.CertificateWhereInput = {
      ...(query.status ? { verificationStatus: query.status } : {}),
      ...(query.farmId ? { farmId: query.farmId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { farm: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.certificate.count({ where }),
    ]);
    const now = new Date();
    const data = rows.map((c) => ({ ...c, validity: certificateValidityAt(c, now) }));
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<CertificateWithValidity> {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');
    return { ...cert, validity: certificateValidityAt(cert) };
  }

  /**
   * AgriMarket only verifies paperwork — it does not issue certificates.
   * Verified certificates are only valid while not expired.
   */
  async verify(id: number, dto: VerifyCertificateDto, actorUserId: number): Promise<CertificateWithValidity> {
    const before = await this.findOne(id);
    if (dto.verificationStatus === CertificateVerificationStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('rejectionReason is required when rejecting a certificate');
    }
    // Verifying paperwork does not resurrect an expired window: a VERIFIED
    // stamp on an out-of-date certificate stays EXPIRED when read (see
    // `certificateValidityAt`) instead of becoming presentable as valid.
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
    return { ...cert, validity: certificateValidityAt(cert) };
  }

  /**
   * Valid = VERIFIED + ACTIVE + within `[issuedAt, expiresAt]` + has a document.
   *
   * Evaluated at read time (`at`), so an expired row is excluded the moment it
   * expires without waiting for any batch job. The stored flags are untouched:
   * expiry is a computed fact, not a rewritten status, which keeps the history
   * (including demo rows such as cert#11) intact while never presenting it as
   * currently valid.
   */
  async findValidByFarm(farmId: number, at: Date = new Date()): Promise<CertificateWithValidity[]> {
    const rows = await this.prisma.certificate.findMany({
      where: {
        farmId,
        verificationStatus: CertificateVerificationStatus.VERIFIED,
        status: 'ACTIVE',
        issuedAt: { lte: at },
        expiresAt: { gte: at },
        fileUrl: { not: null },
      },
    });
    return rows
      .filter((c) => (c.fileUrl ?? '').trim().length > 0)
      .map((c) => ({ ...c, validity: certificateValidityAt(c, at) }))
      .filter((c) => c.validity === 'VALID');
  }
}
