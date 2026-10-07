import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateQcInspectionDto } from './dto/qc.dto.js';
import type { Prisma, QcInspection } from '../../generated/prisma/client.js';
import { ProductLotStatus, QcResult, TraceEventType } from '../../generated/prisma/enums.js';

@Injectable()
export class QualityControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record a QC inspection and drive the lot status accordingly.
   *
   *  - PASS with all criteria passing -> lot becomes SELLABLE
   *  - FAIL                          -> lot becomes REJECTED (or QUARANTINED
   *                                     if only packaging is the issue)
   *
   * The client can never set SELLABLE directly: only this backend flow can.
   */
  async inspect(dto: CreateQcInspectionDto, inspectorUserId: number): Promise<QcInspection> {
    const lot = await this.prisma.productLot.findUnique({ where: { id: dto.productLotId } });
    if (!lot) throw new NotFoundException('Product lot not found');
    if (lot.status === ProductLotStatus.RECALLED) {
      throw new BadRequestException('Cannot inspect a recalled lot');
    }

    const allCriteriaPassed =
      dto.appearancePassed &&
      dto.freshnessPassed &&
      dto.damagePassed &&
      (dto.packagingPassed ?? true);

    if (dto.result === QcResult.PASS && !allCriteriaPassed) {
      throw new BadRequestException('QC result PASS requires all inspection criteria to pass');
    }

    let nextStatus: ProductLotStatus;
    if (dto.result === QcResult.PASS) {
      nextStatus = ProductLotStatus.SELLABLE;
    } else {
      nextStatus = dto.packagingPassed === false ? ProductLotStatus.QUARANTINED : ProductLotStatus.REJECTED;
    }

    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.qcInspection.create({
        data: {
          productLotId: dto.productLotId,
          inspectorUserId,
          result: dto.result,
          appearancePassed: dto.appearancePassed,
          freshnessPassed: dto.freshnessPassed,
          packagingPassed: dto.packagingPassed,
          damagePassed: dto.damagePassed,
          note: dto.note,
          inspectedAt: new Date(),
        },
      });

      await tx.productLot.update({
        where: { id: dto.productLotId },
        data: { status: nextStatus },
      });

      await tx.traceEvent.create({
        data: {
          productLotId: dto.productLotId,
          type: TraceEventType.QC,
          occurredAt: new Date(),
          location: null,
          description:
            dto.result === QcResult.PASS
              ? `Kiểm định chất lượng đạt (QC PASS) — lô đủ điều kiện bán`
              : `Kiểm định chất lượng không đạt (QC FAIL)`,
          isPublic: true,
        },
      });

      await this.audit.record({
        actorUserId: inspectorUserId,
        action: `QC_${dto.result}`,
        entityType: 'ProductLot',
        entityId: String(dto.productLotId),
        beforeJson: { status: lot.status },
        afterJson: { status: nextStatus, inspectionId: inspection.id },
        reason: dto.note,
      });

      return inspection;
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    productLotId?: number;
  }): Promise<PaginatedResult<QcInspection>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.QcInspectionWhereInput = query.productLotId
      ? { productLotId: query.productLotId }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.qcInspection.findMany({
        where,
        skip,
        take,
        orderBy: { inspectedAt: 'desc' },
        include: {
          productLot: { select: { id: true, code: true, traceCode: true, status: true } },
          inspectorUser: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.qcInspection.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<QcInspection> {
    const inspection = await this.prisma.qcInspection.findUnique({ where: { id } });
    if (!inspection) throw new NotFoundException('QC inspection not found');
    return inspection;
  }
}
