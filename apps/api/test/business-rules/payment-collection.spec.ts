import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../generated/prisma/enums.js';

/**
 * `PATCH /payments/:id/status` → PAID is the only "money was collected" path.
 *
 * Two independent guards protect it:
 *  1. a transaction reference (courier receipt / gateway reference) is always
 *     required, so a collection is never confirmed without evidence;
 *  2. the ORDER must justify the collection — COD cash is only collected at
 *     delivery, and no payment of a cancelled order can ever be PAID.
 */
describe('Payment collection rules (PATCH /payments/:id/status)', () => {
  let prisma: MockPrisma;
  let service: PaymentsService;
  const audit = { record: vi.fn(async () => undefined) };

  beforeEach(() => {
    prisma = createMockPrisma();
    audit.record.mockClear();
    service = new PaymentsService(prisma as never, audit as never);
  });

  function stubPayment(overrides: Record<string, unknown> = {}) {
    const payment = {
      id: 1,
      orderId: 7,
      method: PaymentMethod.COD,
      amount: 100000,
      status: PaymentStatus.PENDING,
      ...overrides,
    };
    prisma.payment.findUnique.mockResolvedValue(payment);
    return payment;
  }

  it('refuses PAID without a transaction reference', async () => {
    stubPayment();

    await expect(
      service.updateStatus(1, { status: PaymentStatus.PAID }, 99),
    ).rejects.toThrow(/transaction reference/i);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('refuses COD PAID before the order is DELIVERED', async () => {
    stubPayment();
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.SHIPPING });

    await expect(
      service.updateStatus(1, { status: PaymentStatus.PAID, transactionReference: 'REC-1' }, 99),
    ).rejects.toThrow(/delivered/i);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('refuses PAID on a cancelled order, even for an online method', async () => {
    stubPayment({ method: PaymentMethod.VNPAY });
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.CANCELLED });

    await expect(
      service.updateStatus(1, { status: PaymentStatus.PAID, transactionReference: 'GW-9' }, 99),
    ).rejects.toThrow(/cancelled order/i);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('confirms COD collection once the order is DELIVERED', async () => {
    stubPayment();
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.DELIVERED });
    // The CAS claim wins and the row is re-read in its new state.
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    });

    const updated = await service.updateStatus(
      1,
      { status: PaymentStatus.PAID, transactionReference: 'COURIER-77' },
      99,
    );

    expect(updated.status).toBe(PaymentStatus.PAID);
    // The claim is conditional on the status that was read: exactly one request
    // can make a PENDING COD payment PAID.
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: PaymentStatus.PENDING },
      data: expect.objectContaining({
        status: PaymentStatus.PAID,
        transactionReference: 'COURIER-77',
        paidAt: expect.any(Date),
      }),
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('confirms a prepaid online payment before delivery', async () => {
    // VNPay/MOCK_ONLINE money arrives at payment time, so the DELIVERED gate is
    // COD-only; the reference and the cancelled-order guard still apply.
    stubPayment({ method: PaymentMethod.VNPAY });
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.READY_TO_SHIP });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 1, status: PaymentStatus.PAID });

    const updated = await service.updateStatus(
      1,
      { status: PaymentStatus.PAID, transactionReference: 'GW-123' },
      99,
    );

    expect(updated.status).toBe(PaymentStatus.PAID);
  });

  it('does not collect the same COD payment twice (repeat request)', async () => {
    // The payment is already PAID: re-applying the current status is a no-op, so
    // a double-tap cannot re-stamp `paidAt` or log a second collection.
    stubPayment({ status: PaymentStatus.PAID, paidAt: new Date('2026-01-01T00:00:00Z') });

    const result = await service.updateStatus(
      1,
      { status: PaymentStatus.PAID, transactionReference: 'COURIER-77' },
      99,
    );

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a concurrent second confirmation instead of double-collecting (409)', async () => {
    stubPayment();
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.DELIVERED });
    // Both requests read PENDING; the other one claimed the row first, so this
    // predicate no longer matches and 0 rows are claimed.
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateStatus(1, { status: PaymentStatus.PAID, transactionReference: 'C-2' }, 99),
    ).rejects.toBeInstanceOf(ConflictException);

    // No second audit row, no fabricated state, no money booked twice.
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.payment.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('never flips an online payment to COD money on a cancelled order', async () => {
    // MOCK_ONLINE is not COD, so the delivered gate does not apply — but the
    // cancelled-order guard does, independently of the method.
    stubPayment({ method: PaymentMethod.MOCK_ONLINE });
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.CANCELLED });

    await expect(
      service.updateStatus(1, { status: PaymentStatus.PAID, transactionReference: 'X-1' }, 99),
    ).rejects.toThrow(/cancelled order/i);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});
