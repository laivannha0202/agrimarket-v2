import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';

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
}
