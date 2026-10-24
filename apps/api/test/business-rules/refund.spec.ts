import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  PaymentStatus,
  RefundStatus,
  ReturnRequestStatus,
} from '../../generated/prisma/enums.js';

/**
 * Refund lifecycle after P0-D:
 *
 *   POST /refunds -> PENDING -> APPROVED -> COMPLETED
 *                              \-> FAILED
 *
 * Creating/approving a refund is a decision, not a money movement: only
 * completion updates the payment and deducts from settlements.
 */
describe('Refund rules', () => {
  let prisma: MockPrisma;
  let service: PaymentsService;
  const audit = { record: async () => undefined };

  const paidPayment = {
    id: 1,
    orderId: 1,
    method: 'COD',
    amount: 100000,
    status: PaymentStatus.PAID,
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PaymentsService(prisma as never, audit as never);
    prisma.$queryRaw.mockResolvedValue([
      { id: 1, amount: '100000', status: PaymentStatus.PAID },
    ]);
  });

  it('rejects a non-positive refund amount', async () => {
    await expect(
      service.refund({ paymentId: 1, amount: 0, reason: 'x' }, 99),
    ).rejects.toThrow(/greater than zero/);
  });

  it('rejects a refund that exceeds the paid amount', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 60000 } });

    await expect(
      service.refund({ paymentId: 1, amount: 50000, reason: 'x' }, 99),
    ).rejects.toThrow(/would exceed paid amount/);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('creates a PENDING refund and does NOT move money or change the payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prisma.refund.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
    );

    const refund = await service.refund(
      { paymentId: 1, amount: 40000, reason: 'Hàng dập' },
      99,
    );

    expect(refund.status).toBe(RefundStatus.PENDING);
    expect(prisma.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 1,
        amount: 40000,
        status: RefundStatus.PENDING,
      }),
    });
    // Approval/completion is the only path that touches payment status.
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('re-checks the locked payment: a concurrent refund that finished first is honoured', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...paidPayment,
      status: PaymentStatus.PARTIALLY_REFUNDED,
    });
    prisma.$queryRaw.mockResolvedValue([
      { id: 1, amount: '100000', status: PaymentStatus.REFUNDED },
    ]);

    await expect(
      service.refund({ paymentId: 1, amount: 10000, reason: 'muộn' }, 99),
    ).rejects.toThrow(/Only PAID or PARTIALLY_REFUNDED/);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('rejects refunding a PENDING payment', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...paidPayment,
      status: PaymentStatus.PENDING,
    });

    await expect(
      service.refund({ paymentId: 1, amount: 10000, reason: 'x' }, 99),
    ).rejects.toThrow(/Only PAID or PARTIALLY_REFUNDED/);
  });

  it('links a refund to a QC_PENDING return exactly once', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: 2,
      orderId: 1,
      status: ReturnRequestStatus.QC_PENDING,
      refundId: null,
      quantity: '1.000',
      orderItem: { unitPriceSnapshot: '40000.00' },
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prisma.refund.create.mockResolvedValue({ id: 5, paymentId: 1, amount: 40000 });
    prisma.returnRequest.updateMany.mockResolvedValue({ count: 1 });

    await service.refund(
      { paymentId: 1, amount: 40000, reason: 'Hoàn hàng', returnRequestId: 2 },
      99,
    );

    expect(prisma.returnRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 2, refundId: null },
      data: { refundId: 5 },
    });
  });

  it('rejects a return link that is not QC_PENDING', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: 2,
      orderId: 1,
      status: ReturnRequestStatus.RECEIVED,
      refundId: null,
      quantity: '1.000',
      orderItem: { unitPriceSnapshot: '40000.00' },
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await expect(
      service.refund(
        { paymentId: 1, amount: 40000, reason: 'Hoàn hàng', returnRequestId: 2 },
        99,
      ),
    ).rejects.toThrow(/QC_PENDING/);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('rejects a return link that belongs to a different order', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: 2,
      orderId: 999,
      status: ReturnRequestStatus.QC_PENDING,
      refundId: null,
      quantity: '1.000',
      orderItem: { unitPriceSnapshot: '40000.00' },
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await expect(
      service.refund(
        { paymentId: 1, amount: 40000, reason: 'Hoàn hàng', returnRequestId: 2 },
        99,
      ),
    ).rejects.toThrow(/different order/);
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(prisma.returnRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a refund that exceeds the value of the returned goods even below the paid cap', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: 2,
      orderId: 1,
      status: ReturnRequestStatus.QC_PENDING,
      refundId: null,
      quantity: '1.000',
      orderItem: { unitPriceSnapshot: '40000.00' },
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await expect(
      service.refund(
        { paymentId: 1, amount: 60000, reason: 'Hoàn hàng', returnRequestId: 2 },
        99,
      ),
    ).rejects.toThrow(/value of the returned goods/);
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(prisma.returnRequest.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a refund equal to the value of the returned goods', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: 2,
      orderId: 1,
      status: ReturnRequestStatus.QC_PENDING,
      refundId: null,
      quantity: '1.500',
      orderItem: { unitPriceSnapshot: '40000.00' },
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prisma.refund.create.mockResolvedValue({ id: 5, paymentId: 1, amount: 60000 });
    prisma.returnRequest.updateMany.mockResolvedValue({ count: 1 });

    await service.refund(
      { paymentId: 1, amount: 60000, reason: 'Hoàn hàng', returnRequestId: 2 },
      99,
    );

    expect(prisma.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 60000, status: RefundStatus.PENDING }),
    });
    expect(prisma.returnRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 2, refundId: null },
      data: { refundId: 5 },
    });
  });

  it('rejects a return that already has a refund', async () => {
    prisma.payment.findUnique.mockResolvedValue(paidPayment);
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: 2,
      orderId: 1,
      status: ReturnRequestStatus.QC_PENDING,
      refundId: 7,
      quantity: '1.000',
      orderItem: { unitPriceSnapshot: '40000.00' },
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await expect(
      service.refund(
        { paymentId: 1, amount: 40000, reason: 'Hoàn hàng', returnRequestId: 2 },
        99,
      ),
    ).rejects.toThrow(/already has a refund/);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('approves a PENDING refund without changing the payment', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.PENDING,
    });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.refund.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.APPROVED,
      approvedAt: new Date(),
    });

    const approved = await service.approveRefund(1, 99);

    expect(approved.status).toBe(RefundStatus.APPROVED);
    expect(prisma.refund.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: RefundStatus.PENDING },
      data: expect.objectContaining({ status: RefundStatus.APPROVED }),
    });
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('treats approving an already APPROVED refund as idempotent', async () => {
    const approved = {
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.APPROVED,
    };
    prisma.refund.findUnique.mockResolvedValue(approved);

    expect(await service.approveRefund(1, 99)).toBe(approved);
    expect(prisma.refund.updateMany).not.toHaveBeenCalled();
  });

  it('requires a reference to complete a refund', async () => {
    await expect(service.completeRefund(1, { reference: '  ' }, 99)).rejects.toThrow(
      /reference is required/,
    );
    expect(prisma.refund.findUnique).not.toHaveBeenCalled();
  });

  it('only completes an APPROVED refund', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.PENDING,
    });

    await expect(
      service.completeRefund(1, { reference: 'BANK-1' }, 99),
    ).rejects.toThrow(/Only APPROVED refunds can be completed/);
  });

  it('completes an APPROVED refund and marks the payment PARTIALLY_REFUNDED', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.APPROVED,
    });
    prisma.refund.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 1,
        paymentId: 1,
        amount: 40000,
        status: RefundStatus.APPROVED,
      })
      .mockResolvedValue({
        id: 1,
        paymentId: 1,
        amount: 40000,
        status: RefundStatus.COMPLETED,
        reference: 'BANK-1',
      });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 40000 } });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.update.mockResolvedValue({});
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ orderId: 1 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 1, partnerOrders: [] });
    prisma.returnRequest.findUnique.mockResolvedValue(null);

    const completed = await service.completeRefund(1, { reference: 'BANK-1' }, 99);

    expect(completed.status).toBe(RefundStatus.COMPLETED);
    expect(prisma.refund.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: RefundStatus.APPROVED },
      data: expect.objectContaining({
        status: RefundStatus.COMPLETED,
        reference: 'BANK-1',
      }),
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: PaymentStatus.PARTIALLY_REFUNDED },
    });
    expect(prisma.settlementAdjustment.create).not.toHaveBeenCalled();
  });

  it('marks the payment REFUNDED when the completed total reaches the paid amount', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 2,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.APPROVED,
    });
    prisma.refund.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 2,
        paymentId: 1,
        amount: 40000,
        status: RefundStatus.APPROVED,
      })
      .mockResolvedValue({ id: 2, status: RefundStatus.COMPLETED });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.update.mockResolvedValue({});
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ orderId: 1 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 1, partnerOrders: [] });
    prisma.returnRequest.findUnique.mockResolvedValue(null);

    await service.completeRefund(2, { reference: 'BANK-2' }, 99);

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: PaymentStatus.REFUNDED },
    });
  });

  it('books one OPEN adjustment for a refund completed after its partner order was settled', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 3,
      paymentId: 1,
      amount: 30000,
      status: RefundStatus.APPROVED,
    });
    prisma.refund.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 3,
        paymentId: 1,
        amount: 30000,
        status: RefundStatus.APPROVED,
      })
      .mockResolvedValue({ id: 3, status: RefundStatus.COMPLETED });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 30000 } });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.update.mockResolvedValue({});
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ orderId: 1 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      partnerOrders: [{ id: 9, partnerId: 3, subtotal: 100000, discountTotal: 0 }],
    });
    prisma.returnRequest.findUnique.mockResolvedValue(null);
    prisma.settlementLine.findUnique.mockResolvedValue({ settlementId: 4 });
    prisma.settlementAdjustment.findFirst.mockResolvedValue(null);
    prisma.settlementAdjustment.create.mockResolvedValue({ id: 1 });

    await service.completeRefund(3, { reference: 'BANK-3' }, 99);

    expect(prisma.settlementAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerId: 3,
        settlementId: 4,
        partnerOrderId: 9,
        refundId: 3,
        amount: 30000,
        status: 'OPEN',
        type: 'REFUND_AFTER_SETTLEMENT',
      }),
    });
  });

  it('does not resurrect a refund that a concurrent failure moved out of APPROVED', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.APPROVED,
    });
    prisma.refund.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 1,
        paymentId: 1,
        amount: 40000,
        status: RefundStatus.APPROVED,
      })
      .mockResolvedValue({
        id: 1,
        paymentId: 1,
        amount: 40000,
        status: RefundStatus.FAILED,
        failureReason: 'Ngân hàng từ chối',
      });
    // The conditional UPDATE found no APPROVED row: failRefund committed first.
    prisma.refund.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.completeRefund(1, { reference: 'BANK-1' }, 99),
    ).rejects.toThrow(/status changed/);

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.settlementAdjustment.create).not.toHaveBeenCalled();
  });

  it('fails a PENDING/APPROVED refund, leaves the payment alone and releases the return link', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.APPROVED,
    });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.returnRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.refund.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      status: RefundStatus.FAILED,
      failureReason: 'Sai tài khoản',
    });

    const failed = await service.failRefund(1, { failureReason: 'Sai tài khoản' }, 99);

    expect(failed.status).toBe(RefundStatus.FAILED);
    expect(prisma.returnRequest.updateMany).toHaveBeenCalledWith({
      where: { refundId: 1 },
      data: { refundId: null },
    });
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('refuses to fail a COMPLETED refund', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 1,
      paymentId: 1,
      amount: 40000,
      status: RefundStatus.COMPLETED,
    });

    await expect(
      service.failRefund(1, { failureReason: 'Muộn' }, 99),
    ).rejects.toThrow(/completed refund cannot be failed/);
  });
});
