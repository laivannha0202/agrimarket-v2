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
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    await this.prisma.auditLog.create({
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
