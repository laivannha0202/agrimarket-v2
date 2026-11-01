import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { IDEMPOTENCY_SCOPES } from '../common/idempotency/idempotency.constants.js';
import { buildCode, buildDatedCode, datedCodePrefix, isUniqueViolationOn, nextDatedSequence, nextSequence } from '../common/utils/code.util.js';
import { buildPagination, paginate } from '../common/dto/pagination-query.dto.js';
import { allocateByGross } from '../common/utils/refund-allocation.js';
import {
  CreatePayoutDto,
  CreateSettlementDto,
  DecideSettlementRecoveryDto,
  RecordSettlementRecoveryDto,
  ReviewSettlementAdjustmentDto,
  SettlementAdjustmentQueryDto,
  SettlementRecoveryQueryDto,
} from './dto/finance.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Payout } from '../../generated/prisma/client.js';
import {
  PartnerOrderStatus,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  SettlementAdjustmentResolution,
  SettlementAdjustmentStatus,
  SettlementRecoveryStatus,
  SettlementStatus,
} from '../../generated/prisma/enums.js';

const UNRESOLVED_RECOVERY_STATUSES = [
  SettlementRecoveryStatus.PENDING_APPROVAL,
  SettlementRecoveryStatus.APPROVED,
] as const;

const CODE_ATTEMPTS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Settlement formula:
 *   grossAmount - refundAmount - commissionAmount + adjustmentAmount = payableAmount
 *
 * Built from DELIVERED partner orders in the period only — money on an order
 * still in transit is not payable yet, and an order already claimed by another
 * settlement can never be claimed again (each partner order contributes to at
 * most one settlement line, across all periods).
 *
 * ONE ORDER, ONE SETTLEMENT
 *
 * The "already claimed" filter (`settlementLines: { none: {} }`) only works if
 * two creates cannot both read the same unclaimed set. Two concurrent creates
 * used to: both selected the same partner orders, both inserted their lines,
 * and the same order was claimed by two settlements (measured: 4 lines for 2
 * orders). The database now enforces the invariant with a UNIQUE index on
 * `settlement_lines.partner_order_id` (migration
 * `20261019000000_settlement_line_unique_partner_order`), and a losing create
 * is mapped to a 409 here instead of a raw constraint error. Corrections for
 * an already-settled period are expressed through the settlement-level
 * `adjustmentAmount`, not by claiming the same order twice.
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSettlementDto, actorUserId: number) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }

    /**
     * SETTLEMENT vs REFUND COMPLETION
     *
     * A settlement snapshots the completed refunds it knows about. Reading
     * those refunds and inserting the lines used to be separate, unlocked
     * steps: a refund could complete in the gap and then be counted in
     * NEITHER place — the settlement had already read the refund table (so the
     * line deducted nothing) and `recordSettlementAdjustments` ran before the
     * line existed (so it recorded no reconciliation row). The partner was
     * silently overpaid and the refund left no trace.
     *
     * The whole create now runs in one READ COMMITTED transaction that claims
     * every payment of the orders being settled with `FOR UPDATE` (ascending id,
     * so two settlements cannot deadlock each other). `completeRefund` locks the
     * same payment row before it writes, so the two operations serialise:
     *   - refund commits first  -> its refund row is visible here and is
     *     deducted from the line (no adjustment needed);
     *   - settlement commits first -> the refund waits, then finds the
     *     settlement line and records an OPEN reconciliation adjustment.
     * Either way the money is accounted for exactly once.
     */
    const attemptCreate = () =>
      this.prisma.$transaction(
        async (tx) => {
          // Only DELIVERED partner orders whose ORDER actually carries
          // collected money are settled. A delivered parcel with no PAID
          // payment (e.g. COD not confirmed yet) is not revenue and must not be
          // paid out. `paidAt` is part of the check so a mis-set status cannot
          // book money never collected. `settlementLines: { none: {} }`
          // excludes every order already claimed by a settlement (DRAFT
          // included), so the same order can never be paid twice across two
          // periods.
          const partnerOrders = await tx.partnerOrder.findMany({
            where: {
              partnerId: dto.partnerId,
              status: PartnerOrderStatus.DELIVERED,
              createdAt: { gte: periodStart, lte: periodEnd },
              settlementLines: { none: {} },
              order: {
                payments: {
                  some: {
                    /**
                     * `REFUNDED` stays in the list on purpose. A fully refunded
                     * order still has a settlement line, with the completed
                     * refund deducted from that partner order, so the partner
                     * nets to zero instead of silently disappearing from the
                     * statement (an order missing from a period is far harder to
                     * reconcile than one shown at zero). The collection guard
                     * below is what stops an uncollected order from being paid.
                     */
                    status: {
                      in: [
                        PaymentStatus.PAID,
                        PaymentStatus.PARTIALLY_REFUNDED,
                        PaymentStatus.REFUNDED,
                      ],
                    },
                    paidAt: { not: null },
                  },
                },
              },
            },
            /**
             * The order's own totals and payments come back with the candidate
             * rows so the collection check below needs no second round trip
             * (and cannot read a different snapshot than the filter did).
             */
            include: {
              order: {
                select: {
                  grandTotal: true,
                  payments: { select: { amount: true, status: true, paidAt: true } },
                },
              },
            },
          });

          const candidateOrderIds = [...new Set(partnerOrders.map((po) => po.orderId))];
          // A settlement is a statement about money that is actually owed for
          // delivered, collected orders. If nothing is eligible, creating an
          // empty DRAFT only pollutes the period (and a concurrent create that
          // starts after the winner commits would otherwise leave a second,
          // empty settlement behind). Fail with a business error instead.
          if (partnerOrders.length === 0) {
            throw new BadRequestException(
              'No delivered, paid partner orders are eligible for this settlement period',
            );
          }
          await tx.$queryRaw`
            SELECT id FROM payments
             WHERE order_id IN (${Prisma.join(candidateOrderIds)})
             ORDER BY id
               FOR UPDATE
          `;

          /**
           * EVIDENCE OF COLLECTION, NOT JUST A STATUS
           *
           * `payments.status` says a row was confirmed; the amount it carries is
           * what the customer actually owed. Historical/partially backfilled
           * data can hold a PAID payment whose amount is lower than the order's
           * grand total (an under-collected order). Settling it would pay the
           * partner for money the shop never received.
           *
           * Read after the payment locks, so a concurrent collection cannot slip
           * between the check and the line insert. Orders that fail the check
           * are excluded (not silently rewritten) and logged; the finance
           * reconciliation view lists them with an explicit reason.
           */
          const fullyCollected = partnerOrders.filter((po) => {
            const collected = round2(
              po.order.payments
                .filter(
                  (payment) =>
                    payment.paidAt !== null && payment.status !== PaymentStatus.FAILED,
                )
                .reduce((sum, payment) => sum + Number(payment.amount), 0),
            );
            const obligation = Number(po.order.grandTotal);
            return collected + 0.01 >= obligation;
          });
          if (fullyCollected.length !== partnerOrders.length) {
            const excluded = [
              ...new Set(
                partnerOrders
                  .filter((po) => !fullyCollected.includes(po))
                  .map((po) => po.orderId),
              ),
            ];
            this.logger.warn(
              `Settlement for partner ${dto.partnerId} excluded ${excluded.length} order(s) without full collection evidence: ${excluded.join(', ')}`,
            );
          }
          if (fullyCollected.length === 0) {
            throw new BadRequestException(
              'No delivered partner orders have full collection evidence for this settlement period',
            );
          }
          const orderIds = [...new Set(fullyCollected.map((po) => po.orderId))];

          /**
           * Completed refunds are deducted from the line of the partner order
           * that actually bears them:
           *  - a refund linked to a return is a direct liability of that
           *    return's partner order;
           *  - an unlinked refund is spread over every partner order of the
           *    same order by gross value (exact remainder on the last line).
           * PENDING/APPROVED refunds are decisions, not money movements, so
           * they are deliberately excluded; only COMPLETED reduces a
           * settlement. Read AFTER the payment locks (see above).
           */
          const refundsByPartnerOrder = await this.loadCompletedRefundAttribution(
            orderIds,
            tx,
          );

          let gross = 0;
          let refundTotal = 0;
          let commissionTotal = 0;
          const lines = fullyCollected.map((po) => {
            const grossAmount = round2(Number(po.subtotal) - Number(po.discountTotal));
            const refundAmount = round2(refundsByPartnerOrder.get(po.id) ?? 0);
            const commissionAmount = round2(Number(po.commissionAmount));
            const payableAmount = round2(grossAmount - refundAmount - commissionAmount);
            gross += grossAmount;
            refundTotal += refundAmount;
            commissionTotal += commissionAmount;
            return {
              partnerOrderId: po.id,
              grossAmount,
              refundAmount,
              commissionAmount,
              payableAmount,
            };
          });

          const adjustment = dto.adjustmentAmount ?? 0;
          const payable = round2(gross - refundTotal - commissionTotal + adjustment);

          // Sequence from the highest existing code (never a row count); the
          // caller retries the whole transaction if a concurrent insert wins
          // the race for the same number.
          const existing = await tx.settlement.findMany({
            where: { code: { startsWith: 'SET-' } },
            select: { code: true },
          });
          const code = buildCode('SET', nextSequence(existing.map((row) => row.code), 'SET'));
          return tx.settlement.create({
            data: {
              code,
              partnerId: dto.partnerId,
              periodStart,
              periodEnd,
              grossAmount: round2(gross),
              refundAmount: round2(refundTotal),
              commissionAmount: round2(commissionTotal),
              adjustmentAmount: adjustment,
              payableAmount: payable,
              status: SettlementStatus.DRAFT,
              lines: { create: lines },
            },
            include: { lines: true },
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );

    let settlement;
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          settlement = await attemptCreate();
          break;
        } catch (error) {
          if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
          throw error;
        }
      }
    } catch (error) {
      // A concurrent create claimed one of these partner orders first. The
      // create is one transaction, so the loser leaves no partial settlement
      // behind — it is told to reload and pick the period again.
      if (isUniqueViolationOn(error, 'partner_order_id')) {
        throw new ConflictException(
          'One or more partner orders were claimed by another settlement just now, please reload',
        );
      }
      throw error;
    }

    await this.audit.record({
      actorUserId,
      action: 'SETTLEMENT_CREATE',
      entityType: 'Settlement',
      entityId: String(settlement.id),
      afterJson: settlement,
    });
    return settlement;
  }

  async findAll(query: { page?: number; limit?: number; status?: SettlementStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SettlementWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { partner: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.settlement.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      include: {
        partner: true,
        lines: { include: { partnerOrder: { select: { id: true, code: true } } } },
        payouts: true,
      },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    return settlement;
  }

  async confirm(id: number, actorUserId: number) {
    const settlement = await this.findOne(id);
    if (settlement.status !== SettlementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT settlements can be confirmed');
    }
    // An OPEN refund-after-settlement row means money is owed back to the
    // customer but the recovery policy has not been decided. Confirming (and
    // therefore allowing payouts) would pay the partner money that is already
    // owed elsewhere.
    const openAdjustments = await this.prisma.settlementAdjustment.count({
      where: { settlementId: id, status: SettlementAdjustmentStatus.OPEN },
    });
    if (openAdjustments > 0) {
      throw new ConflictException(
        `Settlement has ${openAdjustments} OPEN reconciliation adjustment(s); review them before confirming`,
      );
    }
    // A DEDUCT_NEXT review creates an approval-waiting recovery. Even though the
    // adjustment is REVIEWED, confirming/paying before the recovery decision is
    // made would let the partner keep money the customer already got back.
    const unresolvedRecoveries = await this.prisma.settlementRecovery.count({
      where: {
        adjustment: { settlementId: id },
        status: { in: [...UNRESOLVED_RECOVERY_STATUSES] },
      },
    });
    if (unresolvedRecoveries > 0) {
      throw new ConflictException(
        `Settlement has ${unresolvedRecoveries} unresolved recovery request(s); approve or reject them before confirming`,
      );
    }
    const updated = await this.prisma.settlement.update({
      where: { id },
      data: { status: SettlementStatus.CONFIRMED, confirmedAt: new Date() },
    });
    await this.audit.record({
      actorUserId,
      action: 'SETTLEMENT_CONFIRM',
      entityType: 'Settlement',
      entityId: String(id),
      beforeJson: { status: settlement.status },
      afterJson: { status: updated.status },
    });
    return updated;
  }

  async findAdjustments(query: SettlementAdjustmentQueryDto) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SettlementAdjustmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.settlementId ? { settlementId: query.settlementId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.settlementAdjustment.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          partner: { select: { id: true, code: true, name: true } },
          settlement: { select: { id: true, code: true, status: true } },
          partnerOrder: { select: { id: true, code: true } },
          refund: { select: { id: true, amount: true, status: true, completedAt: true } },
        },
      }),
      this.prisma.settlementAdjustment.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Record the human decision for an OPEN adjustment. The reviewer, note and
   * timestamp live on the row; the original settlement is never rewritten.
   *
   * DEDUCT_NEXT additionally opens a SettlementRecovery in PENDING_APPROVAL.
   * That is intentionally NOT a debit: a second human must approve the recovery,
   * and a payout is blocked for the partner until it is recorded or rejected.
   * WRITE_OFF/MANUAL need no recovery row.
   */
  async reviewAdjustment(
    id: number,
    dto: ReviewSettlementAdjustmentDto,
    actorUserId: number,
  ) {
    if (!dto.note?.trim()) {
      throw new BadRequestException('A resolution note is required');
    }
    const adjustment = await this.prisma.settlementAdjustment.findUnique({ where: { id } });
    if (!adjustment) throw new NotFoundException('Settlement adjustment not found');
    if (adjustment.status === SettlementAdjustmentStatus.REVIEWED) {
      return adjustment;
    }

    const reviewed = await this.prisma.$transaction(async (tx) => {
      // Serialise the decision with payout creation for this partner: a payout
      // must either see the unresolved recovery or commit before it exists.
      await tx.$queryRaw`SELECT id FROM partners WHERE id = ${adjustment.partnerId} FOR UPDATE`;
      const claimed = await tx.settlementAdjustment.updateMany({
        where: { id, status: SettlementAdjustmentStatus.OPEN },
        data: {
          status: SettlementAdjustmentStatus.REVIEWED,
          resolution: dto.resolution as SettlementAdjustmentResolution,
          resolutionNote: dto.note.trim(),
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The adjustment changed while this request was being processed, please reload',
        );
      }
      const updated = await tx.settlementAdjustment.findUniqueOrThrow({ where: { id } });

      if (
        dto.resolution === SettlementAdjustmentResolution.DEDUCT_NEXT &&
        Number(updated.amount) > 0
      ) {
        const recovery = await tx.settlementRecovery.upsert({
          where: { adjustmentId: updated.id },
          create: {
            partnerId: updated.partnerId,
            adjustmentId: updated.id,
            amount: updated.amount,
            status: SettlementRecoveryStatus.PENDING_APPROVAL,
            reason: updated.reason,
            requestedByUserId: actorUserId,
          },
          update: {},
        });
        await this.audit.record(
          {
            actorUserId,
            action: 'SETTLEMENT_RECOVERY_REQUEST',
            entityType: 'SettlementRecovery',
            entityId: String(recovery.id),
            afterJson: {
              status: recovery.status,
              amount: recovery.amount,
              adjustmentId: recovery.adjustmentId,
              partnerId: recovery.partnerId,
            },
          },
          tx,
        );
      }
      return updated;
    });

    await this.audit.record({
      actorUserId,
      action: 'SETTLEMENT_ADJUSTMENT_REVIEW',
      entityType: 'SettlementAdjustment',
      entityId: String(id),
      beforeJson: { status: adjustment.status },
      afterJson: {
        status: reviewed.status,
        resolution: reviewed.resolution,
        resolutionNote: reviewed.resolutionNote,
      },
    });
    return reviewed;
  }

  /** List recovery requests, newest first, with their source adjustment. */
  async findRecoveries(query: SettlementRecoveryQueryDto) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SettlementRecoveryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.settlementRecovery.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          partner: { select: { id: true, code: true, name: true } },
          adjustment: {
            include: {
              settlement: { select: { id: true, code: true, status: true } },
              partnerOrder: { select: { id: true, code: true } },
              refund: { select: { id: true, amount: true, status: true, completedAt: true } },
            },
          },
        },
      }),
      this.prisma.settlementRecovery.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Second human approval. Still moves no money; APPROVED keeps the payout
   * block in place until the recovery is recorded or rejected.
   */
  async approveRecovery(id: number, dto: DecideSettlementRecoveryDto, actorUserId: number) {
    const note = dto.note?.trim();
    if (!note) throw new BadRequestException('A decision note is required');
    return this.decideRecovery(id, 'approve', note, actorUserId);
  }

  /** Reject an approval-waiting recovery. Rejection also closes the payout block. */
  async rejectRecovery(id: number, dto: DecideSettlementRecoveryDto, actorUserId: number) {
    const note = dto.note?.trim();
    if (!note) throw new BadRequestException('A decision note is required');
    return this.decideRecovery(id, 'reject', note, actorUserId);
  }

  private async decideRecovery(
    id: number,
    decision: 'approve' | 'reject',
    note: string,
    actorUserId: number,
  ) {
    const recovery = await this.prisma.settlementRecovery.findUnique({ where: { id } });
    if (!recovery) throw new NotFoundException('Settlement recovery not found');
    const target =
      decision === 'approve'
        ? SettlementRecoveryStatus.APPROVED
        : SettlementRecoveryStatus.REJECTED;
    if (recovery.status === target) return recovery;
    if (recovery.status !== SettlementRecoveryStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Recovery is ${recovery.status}; only PENDING_APPROVAL can be ${decision === 'approve' ? 'approved' : 'rejected'}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partners WHERE id = ${recovery.partnerId} FOR UPDATE`;
      const claimed = await tx.settlementRecovery.updateMany({
        where: { id, status: SettlementRecoveryStatus.PENDING_APPROVAL },
        data:
          decision === 'approve'
            ? {
                status: SettlementRecoveryStatus.APPROVED,
                decisionNote: note,
                approvedByUserId: actorUserId,
                approvedAt: new Date(),
              }
            : {
                status: SettlementRecoveryStatus.REJECTED,
                decisionNote: note,
                rejectedByUserId: actorUserId,
                rejectedAt: new Date(),
              },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The recovery changed while this request was being processed, please reload',
        );
      }
      const updated = await tx.settlementRecovery.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          actorUserId,
          action:
            decision === 'approve'
              ? 'SETTLEMENT_RECOVERY_APPROVE'
              : 'SETTLEMENT_RECOVERY_REJECT',
          entityType: 'SettlementRecovery',
          entityId: String(id),
          beforeJson: { status: recovery.status },
          afterJson: { status: updated.status, decisionNote: updated.decisionNote },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Close an APPROVED recovery with proof (bank reference or the settlement it
   * was offset against). Payouts unblock only after this explicit record.
   */
  async recordRecovery(id: number, dto: RecordSettlementRecoveryDto, actorUserId: number) {
    const reference = dto.reference?.trim();
    if (!reference) throw new BadRequestException('A recovery reference is required');
    const recovery = await this.prisma.settlementRecovery.findUnique({ where: { id } });
    if (!recovery) throw new NotFoundException('Settlement recovery not found');
    if (recovery.status === SettlementRecoveryStatus.RECORDED) return recovery;
    if (recovery.status !== SettlementRecoveryStatus.APPROVED) {
      throw new ConflictException(
        'Only an APPROVED recovery can be recorded as recovered',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partners WHERE id = ${recovery.partnerId} FOR UPDATE`;
      const claimed = await tx.settlementRecovery.updateMany({
        where: { id, status: SettlementRecoveryStatus.APPROVED },
        data: {
          status: SettlementRecoveryStatus.RECORDED,
          recoveryReference: reference,
          decisionNote: dto.note?.trim()
            ? [recovery.decisionNote, dto.note.trim()].filter(Boolean).join('\n')
            : recovery.decisionNote,
          recordedByUserId: actorUserId,
          recordedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The recovery changed while this request was being processed, please reload',
        );
      }
      const updated = await tx.settlementRecovery.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          actorUserId,
          action: 'SETTLEMENT_RECOVERY_RECORD',
          entityType: 'SettlementRecovery',
          entityId: String(id),
          beforeJson: { status: recovery.status },
          afterJson: {
            status: updated.status,
            recoveryReference: updated.recoveryReference,
          },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Completed-refund attribution for the given orders. See `create` for the
   * direct-return vs proportional rule.
   */
  private async loadCompletedRefundAttribution(
    orderIds: number[],
    client: Prisma.TransactionClient,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (orderIds.length === 0) return result;

    const [partnerOrders, refunds] = await Promise.all([
      client.partnerOrder.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, orderId: true, subtotal: true, discountTotal: true },
        orderBy: { id: 'asc' },
      }),
      client.refund.findMany({
        where: {
          status: RefundStatus.COMPLETED,
          payment: { orderId: { in: orderIds } },
        },
        select: {
          amount: true,
          payment: { select: { orderId: true } },
          returnRequest: {
            select: { orderItem: { select: { partnerOrderId: true } } },
          },
        },
      }),
    ]);

    const byOrder = new Map<number, { id: number; gross: number }[]>();
    for (const po of partnerOrders) {
      const list = byOrder.get(po.orderId) ?? [];
      list.push({
        id: po.id,
        gross: Number(po.subtotal) - Number(po.discountTotal),
      });
      byOrder.set(po.orderId, list);
    }

    const add = (partnerOrderId: number, amount: number) => {
      result.set(partnerOrderId, round2((result.get(partnerOrderId) ?? 0) + amount));
    };

    for (const refund of refunds) {
      const amount = Number(refund.amount);
      const linkedPartnerOrderId = refund.returnRequest?.orderItem?.partnerOrderId;
      if (linkedPartnerOrderId) {
        add(linkedPartnerOrderId, amount);
        continue;
      }
      const allocation = allocateByGross(
        amount,
        byOrder.get(refund.payment.orderId) ?? [],
      );
      for (const [partnerOrderId, share] of allocation) add(partnerOrderId, share);
    }
    return result;
  }
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  /**
   * Runs a code-generating insert, retrying when a concurrent insert claimed
   * the same code first (unique index on `code` is the final guard).
   */
  private async createWithRetry<T>(create: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await create();
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  async create(dto: CreatePayoutDto, actorUserId: number, idempotencyKey?: string) {
    const payload = {
      settlementId: dto.settlementId,
      amount: dto.amount ?? null,
      reference: dto.reference ?? null,
    };

    // A retry must replay even if the first payout changed the state checked
    // below. This lookup is metadata-only; the atomic claim still happens in
    // the same transaction as the payout insert.
    if (idempotencyKey) {
      if (!this.idempotency) {
        throw new InternalServerErrorException('Idempotency service is not configured');
      }
      const replayed = await this.idempotency.replay<Payout>({
        scope: IDEMPOTENCY_SCOPES.payoutCreate,
        actorUserId,
        key: idempotencyKey,
        payload,
      });
      if (replayed !== null) return replayed;
    }

    const settlement = await this.prisma.settlement.findUnique({
      where: { id: dto.settlementId },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.CONFIRMED && settlement.status !== SettlementStatus.PAID) {
      throw new BadRequestException('Settlement must be CONFIRMED before creating a payout');
    }
    if (dto.amount != null && dto.amount <= 0) {
      throw new BadRequestException('Payout amount must be greater than zero');
    }

    /**
     * CONCURRENCY (BL-06)
     *
     * The check-then-insert used to run OUTSIDE any transaction: two requests
     * both read `paidSoFar = 0`, both passed the guard, and both inserted —
     * the settlement could be paid out more than `payableAmount` (payments a
     * partner refund could later never cover). Every payout therefore runs in
     * one transaction that:
     *
     *  1. claims the settlement row with `SELECT … FOR UPDATE` — all payouts
     *     on the same settlement queue on this lock, exactly like a refund
     *     claims its parent payment (payments.service.refund);
     *  2. RE-READS the payout total *after* the lock was granted and re-checks
     *     the remainder against the freshly locked payable;
     *  3. inserts the payout inside the same transaction (the code-collision
     *     retry keeps the `code` unique index as the final guard).
     *
     * The transaction uses `ReadCommitted` for the same doc-measured reason as
     * `refund`: under REPEATABLE READ the re-read would keep its pre-lock
     * snapshot and pass the guard again. A client retry is safe by
     * construction — the second attempt re-reads the now-committed payout, so
     * it either pays the true remainder or is refused; it can never
     * re-apply the same amount into the same gap and double-spend.
     */
    const work = async (tx: Prisma.TransactionClient) => {
        // Serialise every payout on the settlement; markPaid only needs this
        // row writer-side, so a concurrent payment marking waits here instead
        // of colliding on the guard below.
        const locked = await tx.$queryRaw<
          { id: number; payable_amount: unknown; status: SettlementStatus }[]
        >`
          SELECT id, payable_amount, status
            FROM settlements
           WHERE id = ${settlement.id} FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException('Settlement not found');
        const current = locked[0];
        if (
          current.status !== SettlementStatus.CONFIRMED &&
          current.status !== SettlementStatus.PAID
        ) {
          throw new BadRequestException('Settlement must be CONFIRMED before creating a payout');
        }
        const openAdjustments = await tx.settlementAdjustment.count({
          where: {
            settlementId: settlement.id,
            status: SettlementAdjustmentStatus.OPEN,
          },
        });
        if (openAdjustments > 0) {
          throw new BadRequestException(
            `Settlement has ${openAdjustments} OPEN reconciliation adjustment(s); resolve them before paying out`,
          );
        }
        // Serialise against review/decision writes for this partner, then check
        // the partner-level recovery obligations. A late refund can belong to
        // an older settlement; paying any settlement of that partner would let
        // the approved recovery be bypassed.
        await tx.$queryRaw`SELECT id FROM partners WHERE id = ${settlement.partnerId} FOR UPDATE`;
        const unresolvedRecoveries = await tx.settlementRecovery.count({
          where: {
            partnerId: settlement.partnerId,
            status: { in: [...UNRESOLVED_RECOVERY_STATUSES] },
          },
        });
        if (unresolvedRecoveries > 0) {
          throw new BadRequestException(
            `Partner has ${unresolvedRecoveries} unresolved recovery request(s); approve and record or reject them before paying out`,
          );
        }

        const alreadyPaid = await tx.payout.aggregate({
          where: { settlementId: settlement.id, status: { in: [PayoutStatus.PENDING, PayoutStatus.PAID] } },
          _sum: { amount: true },
        });
        const paidSoFar = Number(alreadyPaid._sum.amount ?? 0);
        const payable = Number(current.payable_amount);
        const amount = dto.amount ?? round2(payable - paidSoFar);
        if (amount <= 0) {
          throw new BadRequestException('Payout amount must be greater than zero');
        }
        if (round2(paidSoFar + amount) > payable) {
          throw new BadRequestException(
            `Payout would exceed settlement payable amount (${payable}); remaining ${round2(payable - paidSoFar)}`,
          );
        }

        const payout = await this.createWithRetry(async () => {
          const now = new Date();
          const prefix = datedCodePrefix('PAY', now);
          const existing = await tx.payout.findMany({
            where: { code: { startsWith: prefix } },
            select: { code: true },
          });
          const code = buildDatedCode(
            'PAY',
            nextDatedSequence(
              existing.map((row) => row.code),
              'PAY',
              now,
            ),
            now,
          );
          return tx.payout.create({
            data: {
              code,
              settlementId: settlement.id,
              partnerId: settlement.partnerId,
              amount,
              status: PayoutStatus.PENDING,
              reference: dto.reference,
              requestedAt: new Date(),
            },
          });
        });
        await this.audit.record(
          {
            actorUserId,
            action: 'PAYOUT_CREATE',
            entityType: 'Payout',
            entityId: String(payout.id),
            afterJson: payout,
          },
          tx,
        );
        return payout;
    };

    if (!idempotencyKey) {
      return this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
    }
    return this.idempotency!.run(
      {
        scope: IDEMPOTENCY_SCOPES.payoutCreate,
        actorUserId,
        key: idempotencyKey,
        payload,
      },
      work,
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async markPaid(id: number, actorUserId: number) {
    const existing = await this.prisma.payout.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payout not found');
    if (existing.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Only PENDING payouts can be marked as paid');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Same lock order as create(): settlement, then partner. Re-read the
        // payout after the locks so a concurrent payment attempt cannot use a
        // stale PENDING row.
        const locked = await tx.$queryRaw<
          { id: number; partner_id: number; status: SettlementStatus }[]
        >`
          SELECT id, partner_id, status FROM settlements
           WHERE id = ${existing.settlementId} FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException('Settlement not found');
        const partnerId = locked[0].partner_id;
        await tx.$queryRaw`SELECT id FROM partners WHERE id = ${partnerId} FOR UPDATE`;

        const payout = await tx.payout.findUnique({ where: { id } });
        if (!payout) throw new NotFoundException('Payout not found');
        if (payout.status !== PayoutStatus.PENDING) {
          throw new BadRequestException('Only PENDING payouts can be marked as paid');
        }
        // A payout created before a late refund must not be paid while that
        // refund's recovery decision is still OPEN or waiting for approval.
        const openAdjustments = await tx.settlementAdjustment.count({
          where: {
            settlementId: payout.settlementId,
            status: SettlementAdjustmentStatus.OPEN,
          },
        });
        if (openAdjustments > 0) {
          throw new BadRequestException(
            `Settlement has ${openAdjustments} OPEN reconciliation adjustment(s); resolve them before paying out`,
          );
        }
        const unresolvedRecoveries = await tx.settlementRecovery.count({
          where: {
            partnerId,
            status: { in: [...UNRESOLVED_RECOVERY_STATUSES] },
          },
        });
        if (unresolvedRecoveries > 0) {
          throw new BadRequestException(
            `Partner has ${unresolvedRecoveries} unresolved recovery request(s); approve and record or reject them before paying out`,
          );
        }

        const updated = await tx.payout.update({
          where: { id },
          data: { status: PayoutStatus.PAID, paidAt: new Date() },
        });

        // If the settlement is fully paid out, mark it PAID.
        const settlement = await tx.settlement.findUnique({
          where: { id: payout.settlementId },
          include: { payouts: true },
        });
        if (settlement) {
          const paidTotal = settlement.payouts
            .filter((p) => p.status === PayoutStatus.PAID)
            .reduce((sum, p) => sum + Number(p.amount), 0);
          if (paidTotal >= Number(settlement.payableAmount)) {
            await tx.settlement.update({
              where: { id: settlement.id },
              data: { status: SettlementStatus.PAID },
            });
          }
        }

        await this.audit.record(
          {
            actorUserId,
            action: 'PAYOUT_PAID',
            entityType: 'Payout',
            entityId: String(id),
            beforeJson: { status: payout.status },
            afterJson: { status: updated.status },
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async findAll(query: { page?: number; limit?: number; status?: PayoutStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.PayoutWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { partner: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.payout.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }
}
