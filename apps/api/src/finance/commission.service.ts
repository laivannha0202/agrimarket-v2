import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  buildPagination,
  paginate,
} from '../common/dto/pagination-query.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

/**
 * Commission policy (documented in docs/BUSINESS-RULES.md):
 *   commissionBase = actual goods value after product/flash-sale discounts,
 *   shipping excluded, voucher treated as platform-funded so it does not
 *   reduce the seller's commission base.
 *
 * Rule resolution order: partner+category override > partner override >
 * category override > platform default. Most specific active rule wins.
 */
@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveRatePercent(
    params: { partnerId: number; categoryId: number },
    at: Date = new Date(),
    tx?: Prisma.TransactionClient | PrismaService,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const rules = await db.commissionRule.findMany({
      where: {
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        AND: [
          { OR: [{ partnerId: null }, { partnerId: params.partnerId }] },
          { OR: [{ categoryId: null }, { categoryId: params.categoryId }] },
        ],
      },
    });

    const score = (r: { partnerId: number | null; categoryId: number | null }) =>
      (r.partnerId ? 2 : 0) + (r.categoryId ? 1 : 0);

    if (rules.length === 0) return 0;
    rules.sort((a, b) => score(b) - score(a));
    return Number(rules[0].ratePercent);
  }

  /** commission = round2(commissionBase * ratePercent / 100) */
  computeCommission(commissionBase: number, ratePercent: number): number {
    return Math.round(((commissionBase * ratePercent) / 100) * 100) / 100;
  }

  /**
   * Commission for one partner order.
   *
   * `tx` is used for the rate lookup when the caller is inside a transaction.
   * It must be: the caller holds a pool connection for the duration of its
   * transaction, and reading through `this.prisma` instead would check out a
   * SECOND connection while the first is still held. N concurrent checkouts
   * would then need 2N connections, and once the pool is exhausted every
   * transaction blocks waiting for a connection it can never get — the whole
   * checkout stalls until Prisma's transaction timeout (P2028) fires. Measured:
   * 12 concurrent checkouts took 5060ms and 0/12 succeeded through the outer
   * client, versus 161ms and 12/12 through `tx`.
   */
  async calculateForPartnerOrder(
    tx: Prisma.TransactionClient | PrismaService,
    params: { partnerId: number; categoryId: number; commissionBase: number; at?: Date },
  ): Promise<{ ratePercent: number; commissionAmount: number; payableAmount: number }> {
    const ratePercent = await this.resolveRatePercent(
      { partnerId: params.partnerId, categoryId: params.categoryId },
      params.at,
      tx,
    );
    const commissionAmount = this.computeCommission(params.commissionBase, ratePercent);
    const payableAmount = Math.round((params.commissionBase - commissionAmount) * 100) / 100;
    return { ratePercent, commissionAmount, payableAmount };
  }

  createRule(data: {
    partnerId?: number;
    categoryId?: number;
    ratePercent: number;
    effectiveFrom: string;
    effectiveTo?: string;
  }) {
    return this.prisma.commissionRule.create({
      data: {
        partnerId: data.partnerId,
        categoryId: data.categoryId,
        ratePercent: data.ratePercent,
        effectiveFrom: new Date(data.effectiveFrom),
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      },
    });
  }

  /**
   * Activate / deactivate a commission rule. Only the status changes: the rate
   * and window are frozen because they already priced recorded commissions.
   * An inactive rule is skipped by `resolveRatePercent`, so new orders fall
   * back to a less specific rule without touching history.
   */
  async updateRuleStatus(id: number, status: RecordStatus) {
    const rule = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Commission rule not found');
    return this.prisma.commissionRule.update({
      where: { id },
      data: { status },
      include: {
        partner: { select: { id: true, code: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });
  }

  listRules(query: { page?: number; limit?: number; status?: RecordStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.CommissionRuleWhereInput = query.status ? { status: query.status } : {};
    return Promise.all([
      this.prisma.commissionRule.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          partner: { select: { id: true, code: true, name: true } },
          category: { select: { id: true, name: true } },
        },
      }),
      this.prisma.commissionRule.count({ where }),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }
}
