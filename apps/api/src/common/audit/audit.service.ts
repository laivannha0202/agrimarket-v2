import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuditLog, Prisma } from '../../../generated/prisma/client.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../dto/pagination-query.dto.js';
import type { AuditLogQueryDto } from './dto/audit-log.dto.js';

export interface AuditRecordInput {
  actorUserId?: number | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
}

/**
 * Simple audit trail for important state changes (QC, certificate verification,
 * lot recall, inventory adjustments, order state, refunds, commission,
 * settlement, payout). Not used for read requests.
 *
 * `tx` must be passed by any caller that is already inside a transaction. The
 * audit row belongs to that transaction (it should roll back with the change it
 * describes), and writing it through the outer client would check out a SECOND
 * pool connection while the caller still holds its first. N concurrent
 * transactions would then need 2N connections and deadlock once the pool is
 * exhausted — measured on the checkout path as 0/12 succeeding with 5s P2028
 * timeouts, against 12/12 in 161ms when the write goes through `tx`.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeJson: (input.beforeJson ?? undefined) as Prisma.InputJsonValue | undefined,
        afterJson: (input.afterJson ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: input.reason ?? null,
      },
    });
  }

  /**
   * Read side of the audit trail. The trail is append-only: this exposes the
   * recorded history to an ADMIN and never mutates or deletes a row.
   */
  async findAll(query: AuditLogQueryDto): Promise<
    PaginatedResult<
      AuditLog & { actorUser: { id: number; fullName: string; email: string } | null }
    >
  > {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search } },
              { entityType: { contains: search } },
              { entityId: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { actorUser: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }
}
