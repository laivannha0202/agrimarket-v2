import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

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
  ): Promise<number> {
    const rules = await this.prisma.commissionRule.findMany({
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

  async calculateForPartnerOrder(
    tx: Prisma.TransactionClient | PrismaService,
    params: { partnerId: number; categoryId: number; commissionBase: number; at?: Date },
  ): Promise<{ ratePercent: number; commissionAmount: number; payableAmount: number }> {
    const ratePercent = await this.resolveRatePercent(
      { partnerId: params.partnerId, categoryId: params.categoryId },
      params.at,
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

  listRules(query: { page?: number; limit?: number }) {
    const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(Math.floor(query.limit), 100) : 20;
    return Promise.all([
      this.prisma.commissionRule.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          partner: { select: { id: true, code: true, name: true } },
          category: { select: { id: true, name: true } },
        },
      }),
      this.prisma.commissionRule.count(),
    ]).then(([data, total]) => ({
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }));
  }
}
