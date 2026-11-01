import { createHash } from 'node:crypto';
import { CheckoutDto, CheckoutSource } from './dto/checkout.dto.js';
import { PaymentMethod } from '../../generated/prisma/enums.js';

/**
 * Identity of a checkout request: which cart rule applies, and what a retry
 * with the same idempotency key must match.
 *
 * Pure functions over the DTO — no database, no service state — extracted from
 * `orders.service.ts` so the idempotency contract can be read (and tested) on
 * its own.
 */

/**
 * Which cart rule applies to this checkout.
 *
 * An explicit `source` always wins. Otherwise the caller's own request decides:
 * lines the client sent explicitly could be a "Mua ngay" purchase, so they are
 * treated as `BUY_NOW` — the conservative branch that never rewrites the cart.
 * When the client sends no lines at all, the server resolved them from the cart
 * itself, which is unambiguously `CART`.
 *
 * The value only ever decides *whether a cart mutation is allowed*. It cannot
 * cause one that the cart state and the ordered lines do not already justify,
 * so a forged `CART` cannot delete a line the order did not pay for and a
 * forged `BUY_NOW` can only leave the cart untouched.
 */
export function resolveCheckoutSource(dto: CheckoutDto): CheckoutSource {
  if (dto.source !== undefined) return dto.source;
  return dto.items && dto.items.length > 0 ? CheckoutSource.BUY_NOW : CheckoutSource.CART;
}

/**
 * Stable hash of the semantically relevant checkout request.
 *
 * Only what the caller actually sent is hashed (address, voucher, payment
 * method, note, the declared checkout source and — when the caller selected
 * lines explicitly — those lines). The source is part of the identity because
 * it decides whether the cart is consumed: replaying a `BUY_NOW` request for a
 * `CART` one (or vice versa) would silently apply the wrong cart rule. A
 * cart-based checkout deliberately does NOT hash the cart contents: the
 * server owns that state, the first request consumes it, and a retry after a
 * lost response must still match so it can replay the order it created. Two
 * different requests that share a key are therefore rejected instead of
 * silently replaying an old order.
 */
export function hashCheckoutRequest(customerId: number, dto: CheckoutDto): string {
  const address = dto.shippingAddress;
  const canonical = JSON.stringify({
    customerId,
    source: dto.source ?? null,
    items: (dto.items ?? [])
      .map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity }))
      .sort((a, b) =>
        a.productVariantId === b.productVariantId
          ? a.quantity - b.quantity
          : a.productVariantId - b.productVariantId,
      ),
    voucherCode: dto.voucherCode?.trim().toUpperCase() ?? null,
    paymentMethod: dto.paymentMethod ?? PaymentMethod.COD,
    note: dto.note?.trim() ?? null,
    expectedGrandTotal: dto.expectedGrandTotal ?? null,
    shippingAddress: {
      recipientName: address.recipientName,
      phone: address.phone,
      province: address.province,
      provinceCode: address.provinceCode ?? null,
      wardCode: address.wardCode ?? null,
      district: address.district ?? null,
      ward: address.ward ?? null,
      village: address.village ?? null,
      detail: address.detail,
    },
  });
  return createHash('sha256').update(canonical).digest('hex');
}
