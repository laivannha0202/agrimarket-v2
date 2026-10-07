import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  CreatePaymentDto,
  CreateRefundDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto.js';
import type { Payment, Prisma, Refund } from '../../generated/prisma/client.js';
import { PaymentStatus, RefundStatus } from '../../generated/prisma/enums.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreatePaymentDto) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    return this.prisma.payment.create({
      data: {
        orderId: dto.orderId,
        method: dto.method,
        amount: dto.amount,
        status: PaymentStatus.PENDING,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResult<Payment>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.PaymentWhereInput = query.status
      ? { status: query.status as PaymentStatus }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { order: { select: { id: true, code: true } }, refunds: true },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async updateStatus(id: number, dto: UpdatePaymentStatusDto, actorUserId: number) {
    const payment = await this.findOne(id);
    const data: Prisma.PaymentUpdateInput = { status: dto.status };
    if (dto.status === PaymentStatus.PAID) data.paidAt = new Date();
    if (dto.transactionReference) data.transactionReference = dto.transactionReference;
    const updated = await this.prisma.payment.update({ where: { id }, data });
    await this.audit.record({
      actorUserId,
      action: `PAYMENT_${dto.status}`,
      entityType: 'Payment',
      entityId: String(id),
      beforeJson: { status: payment.status },
      afterJson: { status: updated.status },
    });
    return updated;
  }

  /**
   * Refund validation:
   *  - amount > 0
   *  - total refunded (PENDING + COMPLETED) must not exceed the PAID amount
   */
  async refund(dto: CreateRefundDto, actorUserId: number): Promise<Refund> {
    if (dto.amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }
    const payment = await this.findOne(dto.paymentId);
    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException('Only PAID or PARTIALLY_REFUNDED payments can be refunded');
    }

    const refunded = await this.prisma.refund.aggregate({
      where: {
        paymentId: payment.id,
        status: { in: [RefundStatus.PENDING, RefundStatus.COMPLETED] },
      },
      _sum: { amount: true },
    });
    const already = Number(refunded._sum.amount ?? 0);
    const paid = Number(payment.amount);
    if (already + dto.amount > paid) {
      throw new BadRequestException(
        `Refund total (${round2(already + dto.amount)}) would exceed paid amount (${paid})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: dto.amount,
          reason: dto.reason,
          status: RefundStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      const totalRefunded = round2(already + dto.amount);
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status:
            totalRefunded >= paid ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });
      await this.audit.record({
        actorUserId,
        action: 'REFUND',
        entityType: 'Payment',
        entityId: String(payment.id),
        afterJson: refund,
        reason: dto.reason,
      });
      return refund;
    });
  }

  async listRefunds(query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({ skip, take, orderBy: { id: 'desc' } }),
      this.prisma.refund.count(),
    ]);
    return paginate(data, total, page, limit);
  }
}
