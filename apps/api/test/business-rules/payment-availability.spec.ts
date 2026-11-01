import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  assertPaymentMethodAvailable,
  availablePaymentMethods,
  isGatewayIntegrated,
  isOnlinePaymentEnabled,
  isPaymentMethodAvailable,
  PAYMENT_GATEWAYS,
} from '../../src/payments/payment-methods.js';
import {
  DEFAULT_COD_RESERVATION_TTL_MINUTES,
  DEFAULT_ORDER_RESERVATION_TTL_MINUTES,
  reservationTtlMsForMethod,
} from '../../src/orders/reservation-policy.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../generated/prisma/enums.js';

describe('Payment method availability', () => {
  it('always allows COD', () => {
    expect(isPaymentMethodAvailable(PaymentMethod.COD, { onlineEnabled: 'false' })).toBe(true);
    expect(isPaymentMethodAvailable(PaymentMethod.COD, { onlineEnabled: 'true' })).toBe(true);
  });

  it('refuses online methods unless the deployment flag is exactly true', () => {
    for (const raw of [undefined, '', 'false', '0', 'yes']) {
      expect(isOnlinePaymentEnabled(raw)).toBe(false);
      expect(
        isPaymentMethodAvailable(PaymentMethod.VNPAY, { onlineEnabled: raw, nodeEnv: 'test' }),
      ).toBe(false);
    }
    expect(isOnlinePaymentEnabled(' TRUE ')).toBe(true);
  });

  it('ships no integrated gateway, so the flag alone never enables VNPAY', () => {
    // The regression this guards: a deployment with PAYMENTS_ONLINE_ENABLED=true
    // and no VNPay integration used to accept VNPAY at checkout, producing an
    // order nobody could pay.
    expect(PAYMENT_GATEWAYS).toEqual({});
    expect(isGatewayIntegrated(PaymentMethod.VNPAY)).toBe(false);
    for (const nodeEnv of ['development', 'test', 'production']) {
      expect(
        isPaymentMethodAvailable(PaymentMethod.VNPAY, { onlineEnabled: 'true', nodeEnv }),
      ).toBe(false);
    }
  });

  it('enables an online method only when the flag AND an adapter are present', () => {
    const gateways = {
      [PaymentMethod.VNPAY]: { provider: 'vnpay', sandboxOnly: false },
    };
    expect(
      isPaymentMethodAvailable(PaymentMethod.VNPAY, {
        onlineEnabled: 'true',
        nodeEnv: 'production',
        gateways,
      }),
    ).toBe(true);
    // Adapter without the operator switch is still refused.
    expect(
      isPaymentMethodAvailable(PaymentMethod.VNPAY, {
        onlineEnabled: 'false',
        nodeEnv: 'production',
        gateways,
      }),
    ).toBe(false);
  });

  it('refuses MOCK_ONLINE in production even when the flag is on', () => {
    const gateways = {
      [PaymentMethod.MOCK_ONLINE]: { provider: 'mock', sandboxOnly: true },
    };
    expect(
      isPaymentMethodAvailable(PaymentMethod.MOCK_ONLINE, {
        onlineEnabled: 'true',
        nodeEnv: 'production',
        gateways,
      }),
    ).toBe(false);
    expect(
      isPaymentMethodAvailable(PaymentMethod.MOCK_ONLINE, {
        onlineEnabled: 'true',
        nodeEnv: 'development',
        gateways,
      }),
    ).toBe(true);
    // The mock stub is not a gateway: without an adapter it is refused too.
    expect(
      isPaymentMethodAvailable(PaymentMethod.MOCK_ONLINE, {
        onlineEnabled: 'true',
        nodeEnv: 'development',
      }),
    ).toBe(false);
  });

  it('lists only methods the deployment can actually settle', () => {
    expect(availablePaymentMethods({ onlineEnabled: 'false' })).toEqual([PaymentMethod.COD]);
    // Flag on, but nothing integrated: COD remains the only choice.
    expect(
      availablePaymentMethods({ onlineEnabled: 'true', nodeEnv: 'production' }),
    ).toEqual([PaymentMethod.COD]);
    expect(
      availablePaymentMethods({
        onlineEnabled: 'true',
        nodeEnv: 'production',
        gateways: { [PaymentMethod.VNPAY]: { provider: 'vnpay', sandboxOnly: false } },
      }),
    ).toEqual([PaymentMethod.COD, PaymentMethod.VNPAY]);
  });

  it('reports an unconfigured method as 503, not a client error', () => {
    expect(() =>
      assertPaymentMethodAvailable(PaymentMethod.VNPAY, { onlineEnabled: 'false' }),
    ).toThrow(ServiceUnavailableException);
  });
});

describe('Reservation TTL by payment method', () => {
  it('gives COD a full business day by default', () => {
    expect(reservationTtlMsForMethod(PaymentMethod.COD, {})).toBe(
      DEFAULT_COD_RESERVATION_TTL_MINUTES * 60_000,
    );
    expect(DEFAULT_COD_RESERVATION_TTL_MINUTES).toBe(24 * 60);
  });

  it('keeps the short window for methods that wait on a payment callback', () => {
    expect(reservationTtlMsForMethod(PaymentMethod.VNPAY, {})).toBe(
      DEFAULT_ORDER_RESERVATION_TTL_MINUTES * 60_000,
    );
  });

  it('honours per-method overrides', () => {
    expect(
      reservationTtlMsForMethod(PaymentMethod.COD, { defaultTtl: '10', codTtl: '90' }),
    ).toBe(90 * 60_000);
    expect(
      reservationTtlMsForMethod(PaymentMethod.VNPAY, { defaultTtl: '10', codTtl: '90' }),
    ).toBe(10 * 60_000);
  });

  it('fails closed on an invalid COD override', () => {
    expect(() => reservationTtlMsForMethod(PaymentMethod.COD, { codTtl: '0' })).toThrow(
      /ORDER_RESERVATION_TTL_MINUTES_COD/,
    );
  });
});

describe('PaymentsService.create', () => {
  let prisma: MockPrisma;
  let service: PaymentsService;
  const audit = { record: vi.fn(async () => undefined) };
  const originalFlag = process.env.PAYMENTS_ONLINE_ENABLED;

  beforeEach(() => {
    prisma = createMockPrisma();
    audit.record.mockClear();
    service = new PaymentsService(prisma as never, audit as never);
    process.env.PAYMENTS_ONLINE_ENABLED = 'false';
  });

  function stubOrder(overrides: Record<string, unknown> = {}) {
    const order = {
      id: 7,
      status: OrderStatus.PENDING_CONFIRMATION,
      grandTotal: '250000.00',
      payments: [],
      ...overrides,
    };
    prisma.order.findUniqueOrThrow.mockResolvedValue(order);
    prisma.payment.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: 1,
      ...(data as object),
    }));
    return order;
  }

  it('refuses an order that does not exist (row lock found nothing)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.create({ orderId: 404, method: PaymentMethod.COD })).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('derives the amount from the order and ignores the client value', async () => {
    stubOrder();

    const payment = await service.create({
      orderId: 7,
      method: PaymentMethod.COD,
      amount: 1,
    });

    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: {
        orderId: 7,
        method: PaymentMethod.COD,
        amount: '250000.00',
        status: PaymentStatus.PENDING,
      },
    });
    expect(payment.amount).toBe('250000.00');
  });

  it('refuses a payment for a cancelled order', async () => {
    stubOrder({ status: OrderStatus.CANCELLED });

    await expect(service.create({ orderId: 7, method: PaymentMethod.COD })).rejects.toThrow(
      /cancelled/i,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('refuses a duplicate payment row', async () => {
    stubOrder({ payments: [{ id: 3 }] });

    await expect(service.create({ orderId: 7, method: PaymentMethod.COD })).rejects.toThrow(
      /already has a payment/i,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('refuses an online method this deployment cannot settle', async () => {
    stubOrder();

    await expect(service.create({ orderId: 7, method: PaymentMethod.VNPAY })).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('restores the environment flag', () => {
    if (originalFlag === undefined) delete process.env.PAYMENTS_ONLINE_ENABLED;
    else process.env.PAYMENTS_ONLINE_ENABLED = originalFlag;
  });
});
