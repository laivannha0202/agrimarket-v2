import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { PaymentStatus, RefundStatus } from '../../generated/prisma/enums.js';

/**
 * The refund now serialises on the parent payment inside a READ COMMITTED
 * transaction: the `$queryRaw` mock is the `SELECT … FOR UPDATE` that returns
 * the locked payment row. A test overrides it to simulate a concurrent refund
 * having changed the status (REFUNDED) before the lock was granted.
 */
describe('Refund rules', () => {
  let prisma: MockPrisma;
  let service: PaymentsService;
  const audit = { record: async () => undefined };

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
    prisma.payment.findUnique.mockResolvedValue({
      id: 1,
      orderId: 1,
      method: 'COD',
      amount: 100000,
      status: PaymentStatus.PAID,
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 60000 } });

    await expect(
      service.refund({ paymentId: 1, amount: 50000, reason: 'x' }, 99),
    ).rejects.toThrow(/would exceed paid amount/);
    // The check runs against the values read AFTER the row lock, so no refund
    // row may exist.
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('allows a refund within the paid amount and marks the payment PARTIALLY_REFUNDED', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: 1,
      orderId: 1,
      method: 'COD',
      amount: 100000,
      status: PaymentStatus.PAID,
    });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prisma.refund.create.mockResolvedValue({ id: 1, amount: 40000, status: RefundStatus.COMPLETED });
    prisma.payment.update.mockResolvedValue({});

    await service.refund({ paymentId: 1, amount: 40000, reason: 'Hàng dập' }, 99);

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: PaymentStatus.PARTIALLY_REFUNDED } }),
    );
  });

  it('marks the payment REFUNDED when the full amount is refunded', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: 1,
      orderId: 1,
      method: 'COD',
      amount: 100000,
      status: PaymentStatus.PARTIALLY_REFUNDED,
    });
    prisma.$queryRaw.mockResolvedValue([
      { id: 1, amount: '100000', status: PaymentStatus.PARTIALLY_REFUNDED },
    ]);
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 60000 } });
    prisma.refund.create.mockResolvedValue({ id: 2, amount: 40000, status: RefundStatus.COMPLETED });
    prisma.payment.update.mockResolvedValue({});

    await service.refund({ paymentId: 1, amount: 40000, reason: 'Hoàn nốt' }, 99);

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: PaymentStatus.REFUNDED } }),
    );
  });

  it('re-checks the locked payment: a concurrent refund that finished first is honoured', async () => {
    // The pre-lock read saw PARTIALLY_REFUNDED, but by the time the lock was
    // granted the payment was fully refunded by the competing request.
    prisma.payment.findUnique.mockResolvedValue({
      id: 1,
      orderId: 1,
      method: 'COD',
      amount: 100000,
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
      id: 1,
      orderId: 1,
      method: 'COD',
      amount: 100000,
      status: PaymentStatus.PENDING,
    });

    await expect(
      service.refund({ paymentId: 1, amount: 10000, reason: 'x' }, 99),
    ).rejects.toThrow(/Only PAID or PARTIALLY_REFUNDED/);
  });
});
