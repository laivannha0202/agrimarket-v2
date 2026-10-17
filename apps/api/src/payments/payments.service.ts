import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  CreatePaymentDto,
  CreateRefundDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto.js';
import type { Payment, Prisma, Refund } from '../../generated/prisma/client.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
} from '../../generated/prisma/enums.js';

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
    status?: PaymentStatus;
  }): Promise<PaginatedResult<Payment>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.PaymentWhereInput = query.status ? { status: query.status } : {};
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

  /**
   * Confirm a payment status transition (ADMIN only via the controller guard).
   *
   * The only path that marks money collected: moving to PAID stamps `paidAt`
   * and requires a `transactionReference` (courier receipt / gateway reference)
   * so a COD collection is never confirmed without evidence. The ORDER is
   * checked too, because a payment row alone must not claim money the real
   * world has not collected yet:
   *  - a cancelled order can never be marked PAID (money on a cancelled order
   *    is nonsense; the FAILED transition exists for that case);
   *  - a COD payment only becomes PAID once the order is DELIVERED — cash is
   *    collected by the courier at the doorstep, never earlier. Without this
   *    check an operator could confirm a collection for a parcel still in
   *    transit, and the settlement report would book money that does not exist.
   *
   * Re-applying the current status is an idempotent no-op (returns the row
   * untouched, no audit row), while re-entering a terminal status (REFUNDED) is
   * refused. Terminal payments cannot be moved backwards, and a payment can
   * leave PENDING/FAILED only towards PAID.
   *
   * Confirming PAID is a compare-and-set on the status that was read, so two
   * concurrent confirmations cannot both succeed: the loser gets a 409 instead
   * of silently re-stamping `paidAt` and double-logging the collection.
   */
  async updateStatus(id: number, dto: UpdatePaymentStatusDto, actorUserId: number) {
    const payment = await this.findOne(id);
    if (dto.status === payment.status) {
      if (dto.status === PaymentStatus.REFUNDED) {
        throw new BadRequestException(
          `Cannot change payment status from ${payment.status} to ${dto.status}`,
        );
      }
      return payment;
    }
    assertPaymentTransition(payment.status, dto.status);
    if (dto.status === PaymentStatus.PAID) {
      if (!dto.transactionReference?.trim()) {
        throw new BadRequestException(
          'A transaction reference is required to confirm cash collection',
        );
      }
      const order = await this.prisma.order.findUnique({
        where: { id: payment.orderId },
        select: { status: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Cannot confirm a payment for a cancelled order');
      }
      if (payment.method === PaymentMethod.COD && order.status !== OrderStatus.DELIVERED) {
        throw new BadRequestException(
          'Cash on delivery can only be confirmed once the order is delivered',
        );
      }
    }
    const data: Prisma.PaymentUpdateInput = { status: dto.status };
    if (dto.transactionReference) data.transactionReference = dto.transactionReference;

    let updated: Payment;
    if (dto.status === PaymentStatus.PAID) {
      // Compare-and-set, exactly like the order state machine. Two operators (or
      // one double-tap, or a retried request) can pass the guards above
      // concurrently, and a plain `update` would let the loser overwrite
      // `paidAt`/`transactionReference` and write a SECOND audit row for money
      // that was only collected once. Claiming the row with the status it was
      // read at means exactly one request can confirm the collection; the other
      // is told to reload instead of being told it succeeded.
      const claimed = await this.prisma.payment.updateMany({
        where: { id, status: payment.status },
        data: { ...data, paidAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The payment status changed while this request was being processed, please reload',
        );
      }
      updated = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    } else {
      updated = await this.prisma.payment.update({ where: { id }, data });
    }

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
      await this.audit.record(
        {
          actorUserId,
          action: 'REFUND',
          entityType: 'Payment',
          entityId: String(payment.id),
          afterJson: refund,
          reason: dto.reason,
        },
        tx,
      );
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

const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED],
  [PaymentStatus.PAID]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.FAILED]: [PaymentStatus.PAID],
};

function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  const allowed = ALLOWED_PAYMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(`Cannot change payment status from ${from} to ${to}`);
  }
}
