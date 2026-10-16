import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    prisma.payment.update.mockResolvedValue({
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
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          status: PaymentStatus.PAID,
          transactionReference: 'COURIER-77',
          paidAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('confirms a prepaid online payment before delivery', async () => {
    // VNPay/MOCK_ONLINE money arrives at payment time, so the DELIVERED gate is
    // COD-only; the reference and the cancelled-order guard still apply.
    stubPayment({ method: PaymentMethod.VNPAY });
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.READY_TO_SHIP });
    prisma.payment.update.mockResolvedValue({ id: 1, status: PaymentStatus.PAID });

    const updated = await service.updateStatus(
      1,
      { status: PaymentStatus.PAID, transactionReference: 'GW-123' },
      99,
    );

    expect(updated.status).toBe(PaymentStatus.PAID);
  });
});
