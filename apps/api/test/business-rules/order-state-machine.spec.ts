import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  ALLOWED_ORDER_TRANSITIONS,
  assertOrderTransition,
  canTransitionOrder,
} from '../../src/orders/order-state-machine.js';
import { hashCheckoutRequest, resolveCheckoutSource } from '../../src/orders/checkout-request.js';
import { CheckoutSource } from '../../src/orders/dto/checkout.dto.js';
import { OrderStatus, PaymentMethod } from '../../generated/prisma/enums.js';

const address = {
  recipientName: 'Nguyễn Văn Nhận',
  phone: '0912345678',
  province: 'Hưng Yên',
  detail: 'Số 1',
};

function checkoutDto(overrides: Record<string, unknown> = {}) {
  return {
    shippingAddress: address,
    paymentMethod: PaymentMethod.COD,
    ...overrides,
  } as never;
}

describe('order state machine', () => {
  it('walks the happy path and nothing else', () => {
    const happy = [
      [OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED],
      [OrderStatus.CONFIRMED, OrderStatus.PREPARING],
      [OrderStatus.PREPARING, OrderStatus.READY_TO_SHIP],
      [OrderStatus.READY_TO_SHIP, OrderStatus.SHIPPING],
      [OrderStatus.SHIPPING, OrderStatus.DELIVERED],
    ] as const;
    for (const [from, to] of happy) {
      expect(canTransitionOrder(from, to)).toBe(true);
    }
  });

  it('allows cancellation from every non-terminal status and never from a terminal one', () => {
    for (const status of Object.values(OrderStatus)) {
      if (status === OrderStatus.DELIVERED || status === OrderStatus.CANCELLED) {
        expect(canTransitionOrder(status, OrderStatus.CANCELLED)).toBe(false);
        expect(canTransitionOrder(status, OrderStatus.DELIVERED)).toBe(false);
        continue;
      }
      expect(canTransitionOrder(status, OrderStatus.CANCELLED)).toBe(true);
    }
  });

  it('never skips a step', () => {
    expect(canTransitionOrder(OrderStatus.PENDING_CONFIRMATION, OrderStatus.SHIPPING)).toBe(false);
    expect(canTransitionOrder(OrderStatus.CONFIRMED, OrderStatus.DELIVERED)).toBe(false);
  });

  it('treats re-applying a status as a no-op only off a terminal state', () => {
    expect(canTransitionOrder(OrderStatus.CONFIRMED, OrderStatus.CONFIRMED)).toBe(true);
    // Re-cancelling would release the reservations a second time.
    expect(canTransitionOrder(OrderStatus.CANCELLED, OrderStatus.CANCELLED)).toBe(false);
    expect(canTransitionOrder(OrderStatus.DELIVERED, OrderStatus.DELIVERED)).toBe(false);
  });

  it('reports an illegal edge as 400, not a database error', () => {
    expect(() =>
      assertOrderTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED),
    ).toThrow(BadRequestException);
    expect(() =>
      assertOrderTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED),
    ).toThrow(/Cannot change order status/);
  });

  it('declares no outgoing edge for the terminal statuses', () => {
    expect(ALLOWED_ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ALLOWED_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe('checkout request identity', () => {
  it('treats an explicit source as authoritative', () => {
    expect(resolveCheckoutSource(checkoutDto({ source: CheckoutSource.CART }))).toBe(
      CheckoutSource.CART,
    );
    expect(resolveCheckoutSource(checkoutDto({ source: CheckoutSource.BUY_NOW }))).toBe(
      CheckoutSource.BUY_NOW,
    );
  });

  it('infers BUY_NOW for client lines and CART when the server resolves the cart', () => {
    expect(
      resolveCheckoutSource(checkoutDto({ items: [{ productVariantId: 1, quantity: 1 }] })),
    ).toBe(CheckoutSource.BUY_NOW);
    expect(resolveCheckoutSource(checkoutDto())).toBe(CheckoutSource.CART);
  });

  it('hashes the same request to the same key regardless of line order', () => {
    const a = hashCheckoutRequest(
      7,
      checkoutDto({
        items: [
          { productVariantId: 2, quantity: 1 },
          { productVariantId: 1, quantity: 3 },
        ],
      }),
    );
    const b = hashCheckoutRequest(
      7,
      checkoutDto({
        items: [
          { productVariantId: 1, quantity: 3 },
          { productVariantId: 2, quantity: 1 },
        ],
      }),
    );
    expect(a).toBe(b);
  });

  it('changes the key when the customer, address, voucher or payment method changes', () => {
    const base = hashCheckoutRequest(7, checkoutDto());
    expect(hashCheckoutRequest(8, checkoutDto())).not.toBe(base);
    expect(
      hashCheckoutRequest(7, checkoutDto({ shippingAddress: { ...address, detail: 'Số 2' } })),
    ).not.toBe(base);
    expect(hashCheckoutRequest(7, checkoutDto({ voucherCode: 'GIAM10' }))).not.toBe(base);
    expect(
      hashCheckoutRequest(7, checkoutDto({ paymentMethod: PaymentMethod.VNPAY })),
    ).not.toBe(base);
  });

  it('normalises the voucher code so a retry with different casing still replays', () => {
    expect(hashCheckoutRequest(7, checkoutDto({ voucherCode: ' giam10 ' }))).toBe(
      hashCheckoutRequest(7, checkoutDto({ voucherCode: 'GIAM10' })),
    );
  });

  it('includes the declared source, because it decides whether the cart is consumed', () => {
    expect(hashCheckoutRequest(7, checkoutDto({ source: CheckoutSource.CART }))).not.toBe(
      hashCheckoutRequest(7, checkoutDto({ source: CheckoutSource.BUY_NOW })),
    );
  });
});
