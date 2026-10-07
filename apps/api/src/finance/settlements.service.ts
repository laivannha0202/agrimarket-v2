import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildCode, buildDatedCode } from '../common/utils/code.util.js';
import { buildPagination, paginate } from '../common/dto/pagination-query.dto.js';
import { CreatePayoutDto, CreateSettlementDto } from './dto/finance.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  PartnerOrderStatus,
  PayoutStatus,
  SettlementStatus,
} from '../../generated/prisma/enums.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Settlement formula:
 *   grossAmount - refundAmount - commissionAmount + adjustmentAmount = payableAmount
 * Built from delivered/confirmed PartnerOrders in the period.
 */
@Injectable()
export class SettlementsService {
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

    const partnerOrders = await this.prisma.partnerOrder.findMany({
      where: {
        partnerId: dto.partnerId,
        status: { in: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.SHIPPING, PartnerOrderStatus.READY_TO_SHIP] },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });

    let gross = 0;
    let refundTotal = 0;
    let commissionTotal = 0;
    const lines = partnerOrders.map((po) => {
      const grossAmount = Number(po.subtotal) - Number(po.discountTotal);
      const commissionAmount = Number(po.commissionAmount);
      const payableAmount = round2(grossAmount - commissionAmount);
      gross += grossAmount;
      commissionTotal += commissionAmount;
      return {
        partnerOrderId: po.id,
        grossAmount: round2(grossAmount),
        refundAmount: 0,
        commissionAmount: round2(commissionAmount),
        payableAmount,
      };
    });

    const adjustment = dto.adjustmentAmount ?? 0;
    const payable = round2(gross - refundTotal - commissionTotal + adjustment);

    const count = await this.prisma.settlement.count();
    const code = buildCode('SET', count + 1);

    const settlement = await this.prisma.settlement.create({
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

    await this.audit.record({
      actorUserId,
      action: 'SETTLEMENT_CREATE',
      entityType: 'Settlement',
      entityId: String(settlement.id),
      afterJson: settlement,
    });
    return settlement;
  }

  async findAll(query: { page?: number; limit?: number; status?: string }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.SettlementWhereInput = query.status
      ? { status: query.status as SettlementStatus }
      : {};
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
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreatePayoutDto, actorUserId: number) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: dto.settlementId },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.CONFIRMED && settlement.status !== SettlementStatus.PAID) {
      throw new BadRequestException('Settlement must be CONFIRMED before creating a payout');
    }

    const alreadyPaid = await this.prisma.payout.aggregate({
      where: { settlementId: settlement.id, status: { in: [PayoutStatus.PENDING, PayoutStatus.PAID] } },
      _sum: { amount: true },
    });
    const paidSoFar = Number(alreadyPaid._sum.amount ?? 0);
    const payable = Number(settlement.payableAmount);
    const amount = dto.amount ?? round2(payable - paidSoFar);
    if (amount <= 0) {
      throw new BadRequestException('Payout amount must be greater than zero');
    }
    if (paidSoFar + amount > payable) {
      throw new BadRequestException(
        `Payout would exceed settlement payable amount (${payable}); remaining ${round2(payable - paidSoFar)}`,
      );
    }

    const count = await this.prisma.payout.count();
    const code = buildDatedCode('PAY', count + 1);
    const payout = await this.prisma.payout.create({
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
    await this.audit.record({
      actorUserId,
      action: 'PAYOUT_CREATE',
      entityType: 'Payout',
      entityId: String(payout.id),
      afterJson: payout,
    });
    return payout;
  }

  async markPaid(id: number, actorUserId: number) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Only PENDING payouts can be marked as paid');
    }
    const updated = await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.PAID, paidAt: new Date() },
    });

    // If the settlement is fully paid out, mark it PAID.
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: payout.settlementId },
      include: { payouts: true },
    });
    if (settlement) {
      const paidTotal = settlement.payouts
        .filter((p) => p.status === PayoutStatus.PAID)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      if (paidTotal >= Number(settlement.payableAmount)) {
        await this.prisma.settlement.update({
          where: { id: settlement.id },
          data: { status: SettlementStatus.PAID },
        });
      }
    }

    await this.audit.record({
      actorUserId,
      action: 'PAYOUT_PAID',
      entityType: 'Payout',
      entityId: String(id),
      beforeJson: { status: payout.status },
      afterJson: { status: updated.status },
    });
    return updated;
  }

  async findAll(query: { page?: number; limit?: number; status?: string }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.PayoutWhereInput = query.status
      ? { status: query.status as PayoutStatus }
      : {};
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
