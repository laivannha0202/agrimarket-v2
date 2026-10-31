import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { assertPaymentMethodAvailable } from './payment-methods.js';
import { AuditService } from '../common/audit/audit.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { IDEMPOTENCY_SCOPES } from '../common/idempotency/idempotency.constants.js';
import { allocateByGross } from '../common/utils/refund-allocation.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  CompleteRefundDto,
  CreatePaymentDto,
  CreateRefundDto,
  FailRefundDto,
  RefundQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto.js';
import type { Payment, Prisma, Refund } from '../../generated/prisma/client.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  ReturnRequestStatus,
} from '../../generated/prisma/enums.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async create(dto: CreatePaymentDto) {
    // Method must be one this deployment can settle — same rule as checkout.
    assertPaymentMethodAvailable(dto.method);

    return this.prisma.$transaction(async (tx) => {
      // Lock the order row first: without it, two admins both read "no payment
      // yet" and both insert, leaving the order with two liabilities.
      const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM orders WHERE id = ${dto.orderId} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Order not found');

      const order = await tx.order.findUniqueOrThrow({
        where: { id: dto.orderId },
        select: { id: true, status: true, grandTotal: true, payments: { select: { id: true } } },
      });

      // A payment is a liability of an order, never a free input: the amount is
      // derived from the order's grandTotal, and the client cannot choose it.
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Cannot create a payment for a cancelled order');
      }
      if (order.payments.length > 0) {
        throw new ConflictException('This order already has a payment record');
      }

      return tx.payment.create({
        data: {
          orderId: dto.orderId,
          method: dto.method,
          amount: order.grandTotal,
          status: PaymentStatus.PENDING,
        },
      });
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
   * Create a refund in PENDING.
   *
   * Creating a refund is a decision, not a payment: the payment status and the
   * settlement are untouched until the refund is COMPLETED with a proof
   * (`reference`). The cap counts PENDING + APPROVED + COMPLETED, so open
   * requests cannot promise the same money twice; FAILED refunds free their
   * amount again.
   *
   * CONCURRENCY: the parent payment row is locked first and the aggregate is
   * re-read *after* the lock under READ COMMITTED, exactly like the previous
   * immediate-refund flow. `payments.service.refund` is the only path that
   * inserts refund rows.
   */
  async refund(
    dto: CreateRefundDto,
    actorUserId: number,
    idempotencyKey?: string,
  ): Promise<Refund> {
    const payload = {
      paymentId: dto.paymentId,
      amount: dto.amount,
      reason: dto.reason,
      returnRequestId: dto.returnRequestId ?? null,
    };

    // A retry must replay even after the first refund made the payment
    // REFUNDED (the "PAID or PARTIALLY_REFUNDED" precondition below would
    // otherwise reject the retry with a misleading business error).
    if (idempotencyKey) {
      if (!this.idempotency) {
        throw new InternalServerErrorException('Idempotency service is not configured');
      }
      const replayed = await this.idempotency.replay<Refund>({
        scope: IDEMPOTENCY_SCOPES.refundCreate,
        actorUserId,
        key: idempotencyKey,
        payload,
      });
      if (replayed !== null) return replayed;
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }
    const payment = await this.findOne(dto.paymentId);
    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException('Only PAID or PARTIALLY_REFUNDED payments can be refunded');
    }

    const work = async (tx: Prisma.TransactionClient) => {
      // Serialise every refund on the parent payment. The lock also blocks a
      // concurrent `refund.create` (its FK takes a shared lock on this row), so
      // the aggregate below cannot miss an uncommitted insert.
      const locked = await tx.$queryRaw<{ id: number; amount: unknown; status: PaymentStatus }[]>`
        SELECT id, amount, status FROM payments WHERE id = ${payment.id} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Payment not found');
      const current = locked[0];
      if (
        current.status !== PaymentStatus.PAID &&
        current.status !== PaymentStatus.PARTIALLY_REFUNDED
      ) {
        throw new BadRequestException('Only PAID or PARTIALLY_REFUNDED payments can be refunded');
      }

      const refunded = await tx.refund.aggregate({
        where: {
          paymentId: payment.id,
          status: {
            in: [RefundStatus.PENDING, RefundStatus.APPROVED, RefundStatus.COMPLETED],
          },
        },
        _sum: { amount: true },
      });
      const already = Number(refunded._sum.amount ?? 0);
      const paid = Number(current.amount);
      if (round2(already + dto.amount) > paid) {
        throw new BadRequestException(
          `Refund total (${round2(already + dto.amount)}) would exceed paid amount (${paid})`,
        );
      }

      let returnRequest: {
        id: number;
        orderId: number;
        status: ReturnRequestStatus;
        refundId: number | null;
        quantity: unknown;
        orderItem: { unitPriceSnapshot: unknown };
      } | null = null;
      if (dto.returnRequestId) {
        returnRequest = await tx.returnRequest.findUnique({
          where: { id: dto.returnRequestId },
          select: {
            id: true,
            orderId: true,
            status: true,
            refundId: true,
            quantity: true,
            orderItem: { select: { unitPriceSnapshot: true } },
          },
        });
        if (!returnRequest) throw new NotFoundException('Return request not found');
        if (returnRequest.orderId !== payment.orderId) {
          throw new BadRequestException('The return request belongs to a different order');
        }
        if (returnRequest.status !== ReturnRequestStatus.QC_PENDING) {
          throw new BadRequestException(
            'A refund can only be linked while the return is QC_PENDING',
          );
        }
        if (returnRequest.refundId) {
          throw new ConflictException('This return request already has a refund');
        }
        /**
         * The paid amount is only the outer cap. A refund that closes a return
         * must also fit the value of the goods that actually came back:
         * `quantity × unitPriceSnapshot`. Without this, an operator could refund
         * a 1 kg line at 50,000 and still pass 90,000 because the order was
         * paid 100,000.
         */
        const returnValue = round2(
          Number(returnRequest.quantity) * Number(returnRequest.orderItem.unitPriceSnapshot),
        );
        if (round2(dto.amount) > returnValue) {
          throw new BadRequestException(
            `Refund amount (${round2(dto.amount)}) would exceed the value of the returned goods (${returnValue})`,
          );
        }
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: dto.amount,
          reason: dto.reason,
          status: RefundStatus.PENDING,
        },
      });

      if (returnRequest) {
        // Link inside the same transaction: the unique index on
        // `return_requests.refund_id` is the final guard against two refunds
        // claiming one return.
        const linked = await tx.returnRequest.updateMany({
          where: { id: returnRequest.id, refundId: null },
          data: { refundId: refund.id },
        });
        if (linked.count === 0) {
          throw new ConflictException('This return request already has a refund');
        }
      }

      await this.audit.record(
        {
          actorUserId,
          action: 'REFUND_CREATE',
          entityType: 'Refund',
          entityId: String(refund.id),
          afterJson: {
            paymentId: payment.id,
            amount: refund.amount.toString(),
            returnRequestId: dto.returnRequestId ?? null,
          },
          reason: dto.reason,
        },
        tx,
      );
      return refund;
    };

    if (!idempotencyKey) {
      return this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
    }
    return this.idempotency!.run(
      {
        scope: IDEMPOTENCY_SCOPES.refundCreate,
        actorUserId,
        key: idempotencyKey,
        payload,
      },
      work,
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Approve a PENDING refund. Approval records the decision (`approvedAt`) but
   * still moves no money and changes no payment status.
   */
  async approveRefund(id: number, actorUserId: number): Promise<Refund> {
    const refund = await this.requireRefund(id);
    if (refund.status === RefundStatus.APPROVED) return refund;
    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException(
        `Only PENDING refunds can be approved (current: ${refund.status})`,
      );
    }
    const claimed = await this.prisma.refund.updateMany({
      where: { id, status: RefundStatus.PENDING },
      data: { status: RefundStatus.APPROVED, approvedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'The refund status changed while this request was being processed, please reload',
      );
    }
    const updated = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      actorUserId,
      action: 'REFUND_APPROVE',
      entityType: 'Refund',
      entityId: String(id),
      beforeJson: { status: refund.status },
      afterJson: { status: updated.status, approvedAt: updated.approvedAt },
    });
    return updated;
  }

  /**
   * Complete an APPROVED refund with the bank/gateway `reference`.
   *
   * Only completion updates the payment (`PARTIALLY_REFUNDED`/`REFUNDED`) and
   * only COMPLETED refunds are deducted from settlements. If the order was
   * already settled or paid out, one OPEN `SettlementAdjustment` per affected
   * partner order is recorded for manual recovery — historical settlement rows
   * are never rewritten.
   */
  async completeRefund(
    id: number,
    dto: CompleteRefundDto,
    actorUserId: number,
  ): Promise<Refund> {
    if (!dto.reference?.trim()) {
      throw new BadRequestException('A reference is required to complete a refund');
    }
    const preRead = await this.requireRefund(id);
    if (preRead.status === RefundStatus.COMPLETED) return preRead;
    if (preRead.status !== RefundStatus.APPROVED) {
      throw new BadRequestException(
        `Only APPROVED refunds can be completed (current: ${preRead.status})`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Same lock order as refund creation: payment -> refund.
        const locked = await tx.$queryRaw<
          { id: number; amount: unknown; status: PaymentStatus }[]
        >`
          SELECT id, amount, status FROM payments WHERE id = ${preRead.paymentId} FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException('Payment not found');
        const refund = await tx.refund.findUniqueOrThrow({ where: { id } });
        if (refund.status === RefundStatus.COMPLETED) return refund;
        if (refund.status !== RefundStatus.APPROVED) {
          throw new BadRequestException(
            `Only APPROVED refunds can be completed (current: ${refund.status})`,
          );
        }

        const completedAt = new Date();
        // Compare-and-set, not an unconditional update: `failRefund` may have
        // moved the same row to FAILED between the read above and this write.
        // Without the status predicate the later commit would resurrect a
        // failed refund (and the payment/settlement side effects) while the
        // failure audit row already described it as FAILED.
        const claimed = await tx.refund.updateMany({
          where: { id, status: RefundStatus.APPROVED },
          data: {
            status: RefundStatus.COMPLETED,
            reference: dto.reference.trim(),
            completedAt,
          },
        });
        if (claimed.count === 0) {
          const current = await tx.refund.findUniqueOrThrow({ where: { id } });
          // A concurrent completion is idempotent: the other transaction
          // already wrote the payment status and the settlement adjustments.
          if (current.status === RefundStatus.COMPLETED) return current;
          throw new ConflictException(
            'The refund status changed while this request was being processed, please reload',
          );
        }

        const completed = await tx.refund.aggregate({
          where: { paymentId: refund.paymentId, status: RefundStatus.COMPLETED },
          _sum: { amount: true },
        });
        const totalCompleted = round2(Number(completed._sum.amount ?? 0));
        const paid = Number(locked[0].amount);
        await tx.payment.update({
          where: { id: refund.paymentId },
          data: {
            status:
              totalCompleted >= paid
                ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED,
          },
        });

        await this.recordSettlementAdjustments(tx, refund, actorUserId);

        await this.audit.record(
          {
            actorUserId,
            action: 'REFUND_COMPLETE',
            entityType: 'Refund',
            entityId: String(id),
            beforeJson: { status: refund.status },
            afterJson: {
              status: RefundStatus.COMPLETED,
              reference: dto.reference.trim(),
              totalCompleted,
            },
          },
          tx,
        );
        return tx.refund.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Fail a PENDING/APPROVED refund. No money moves, the payment status is not
   * changed, and the return link is released so a corrected refund can be
   * created; the failed row stays for the audit trail.
   */
  async failRefund(id: number, dto: FailRefundDto, actorUserId: number): Promise<Refund> {
    if (!dto.failureReason?.trim()) {
      throw new BadRequestException('A failure reason is required');
    }
    const refund = await this.requireRefund(id);
    if (refund.status === RefundStatus.FAILED) return refund;
    if (refund.status === RefundStatus.COMPLETED) {
      throw new BadRequestException('A completed refund cannot be failed');
    }
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.refund.updateMany({
        where: {
          id,
          status: { in: [RefundStatus.PENDING, RefundStatus.APPROVED] },
        },
        data: { status: RefundStatus.FAILED, failureReason: dto.failureReason.trim() },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'The refund status changed while this request was being processed, please reload',
        );
      }
      await tx.returnRequest.updateMany({
        where: { refundId: id },
        data: { refundId: null },
      });
      await this.audit.record(
        {
          actorUserId,
          action: 'REFUND_FAIL',
          entityType: 'Refund',
          entityId: String(id),
          beforeJson: { status: refund.status },
          afterJson: { status: RefundStatus.FAILED, failureReason: dto.failureReason.trim() },
        },
        tx,
      );
      return tx.refund.findUniqueOrThrow({ where: { id } });
    });
  }

  async findRefund(id: number) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        payment: {
          select: {
            id: true,
            method: true,
            amount: true,
            status: true,
            order: { select: { id: true, code: true } },
          },
        },
        returnRequest: { select: { id: true, status: true } },
        settlementAdjustments: {
          include: { settlement: { select: { id: true, code: true, status: true } } },
        },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  async listRefunds(query: RefundQueryDto) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.RefundWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          payment: {
            select: {
              id: true,
              method: true,
              status: true,
              order: { select: { id: true, code: true } },
            },
          },
          returnRequest: { select: { id: true, status: true } },
          settlementAdjustments: { select: { id: true, status: true, amount: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  private async requireRefund(id: number): Promise<Refund> {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  /**
   * Book the recovery obligation for a refund completed after its partner
   * order was already claimed by a settlement.
   *
   * A linked return is a direct liability of that return's partner order;
   * otherwise the refund is spread over the order's partner orders by gross
   * value with an exact remainder on the last line. Every affected partner
   * order with a settlement line gets one OPEN adjustment; the unique
   * `(refund_id, partner_order_id)` index makes a retry idempotent.
   */
  private async recordSettlementAdjustments(
    tx: Prisma.TransactionClient,
    refund: Refund,
    actorUserId: number,
  ): Promise<void> {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
      select: { orderId: true },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: {
        partnerOrders: {
          select: { id: true, partnerId: true, subtotal: true, discountTotal: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    const linked = await tx.returnRequest.findUnique({
      where: { refundId: refund.id },
      include: { orderItem: { select: { partnerOrderId: true } } },
    });

    const amount = Number(refund.amount);
    let attribution: Map<number, number>;
    if (linked) {
      attribution = new Map([[linked.orderItem.partnerOrderId, amount]]);
    } else {
      attribution = allocateByGross(
        amount,
        order.partnerOrders.map((po) => ({
          id: po.id,
          gross: Number(po.subtotal) - Number(po.discountTotal),
        })),
      );
    }

    for (const [partnerOrderId, attributed] of attribution) {
      if (attributed <= 0) continue;
      const partnerOrder = order.partnerOrders.find((po) => po.id === partnerOrderId);
      if (!partnerOrder) continue;
      const line = await tx.settlementLine.findUnique({
        where: { partnerOrderId },
        select: { settlementId: true },
      });
      if (!line) continue;
      const exists = await tx.settlementAdjustment.findFirst({
        where: { refundId: refund.id, partnerOrderId },
        select: { id: true },
      });
      if (exists) continue;
      await tx.settlementAdjustment.create({
        data: {
          partnerId: partnerOrder.partnerId,
          settlementId: line.settlementId,
          partnerOrderId,
          refundId: refund.id,
          amount: attributed,
          type: 'REFUND_AFTER_SETTLEMENT',
          status: 'OPEN',
          reason: `Hoàn tiền #${refund.id} sau khi đối soát — chờ xử lý`,
          createdByUserId: actorUserId,
        },
      });
    }
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
