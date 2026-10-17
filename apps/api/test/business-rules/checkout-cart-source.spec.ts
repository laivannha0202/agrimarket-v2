import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { OrdersService } from '../../src/orders/orders.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { CommissionService } from '../../src/finance/commission.service.js';
import { LocationsService } from '../../src/locations/locations.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { ProductLotStatus } from '../../generated/prisma/enums.js';

/**
 * "Mua ngay" must never rewrite the cart, and a cart checkout must consume
 * exactly the lines it paid for.
 *
 * The original bug: after a successful order the backend ran
 * `cartItem.deleteMany({ productVariantId: { in: <ordered variants> } })` no
 * matter where the lines came from. Buying B with "Mua ngay" therefore deleted
 * a B that was already sitting in the cart — quantity and all — and the cart
 * could be silently emptied by browsing.
 *
 * The rule is now split by the declared source:
 *
 *   BUY_NOW  -> the cart is not read, not added to, not decremented, not cleared.
 *   CART     -> the ordered quantity is subtracted from the matching cart line;
 *               the line disappears only when it is emptied; a line the order
 *               did not include is never touched.
 *
 * The flag is never *trusted* to unlock a deletion: every cart write is derived
 * from the server's own cart state plus the lines the order actually paid for,
 * so a forged `CART` cannot delete a line that was not ordered and a forged
 * `BUY_NOW` can only leave the cart alone.
 */
describe('Checkout cart handling — Buy Now vs cart checkout', () => {
  let prisma: MockPrisma;
  let service: OrdersService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    const inventory = new InventoryService(prisma as never, audit as never);
    const promotions = new PromotionsService(prisma as never);
    const commission = new CommissionService(prisma as never);
    service = new OrdersService(
      prisma as never,
      inventory,
      promotions,
      commission,
      audit as never,
      new LocationsService(prisma as never),
    );
  });

  const address = {
    recipientName: 'Test',
    phone: '0900000000',
    province: 'Hưng Yên',
    detail: 'abc',
  };

  /** A cart holding exactly the given `[variantId, quantity]` lines. */
  function stubCart(lines: [number, number][]) {
    prisma.cart.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      items: lines.map(([productVariantId, quantity], index) => ({
        id: 100 + index,
        productVariantId,
        quantity,
      })),
    });
  }

  /** Every cart write this checkout performed, whatever form it took. */
  function cartWrites() {
    return [
      ...prisma.cartItem.delete.mock.calls,
      ...prisma.cartItem.deleteMany.mock.calls,
      ...prisma.cartItem.update.mock.calls,
    ];
  }

  function stubCheckout() {
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 1,
      sku: 'A-1',
      basePrice: 50000,
      status: 'ACTIVE',
      product: { id: 1, partnerId: 1, categoryId: 1, name: 'Sản phẩm A', status: 'ACTIVE' },
    });
    prisma.flashSaleItem.findMany.mockResolvedValue([]);
    prisma.productDiscount.findFirst.mockResolvedValue(null);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 500,
      ...data,
    }));
    prisma.partnerOrder.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: 900,
      ...(data as object),
    }));
    prisma.orderItem.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: 700,
      ...(data as object),
    }));
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
    ]);
    prisma.inventoryBalance.findMany.mockResolvedValue([
      {
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
        productLot: {
          id: 1,
          expiresAt: new Date('2026-12-01'),
          status: ProductLotStatus.SELLABLE,
          qcInspections: [{ result: 'PASS', inspectedAt: new Date() }],
        },
      },
    ]);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      warehouseId: 1,
      productLotId: 1,
      productVariantId: 1,
      onHand: 100,
      reserved: 0,
      blocked: 0,
      unit: 'kg',
    });
    prisma.inventoryBalance.update.mockResolvedValue({});
    prisma.inventoryAllocation.create.mockResolvedValue({});
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.payment.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    prisma.cartItem.delete.mockResolvedValue({});
    prisma.cartItem.update.mockResolvedValue({});
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue(null);
    prisma.checkoutIdempotencyKey.create.mockResolvedValue({ id: 1 });
    prisma.productVariant.findMany.mockResolvedValue([]);
  }

  /* ------------------------------------------------------------ BUY_NOW -- */

  it('Case 1 — cart holds A, "Mua ngay" B: only B is ordered and the cart is untouched', async () => {
    stubCheckout();
    stubCart([[9, 1]]); // the cart holds A (variant 9)

    const order = await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      source: 'BUY_NOW',
    });

    expect(order.id).toBe(500);
    // A is still in the cart: nothing was added and nothing was removed.
    expect(cartWrites()).toHaveLength(0);
    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('Case 2 — cart holds 3 B, "Mua ngay" 1 B: the cart keeps all 3', async () => {
    stubCheckout();
    stubCart([[1, 3]]); // the SAME variant is already in the cart

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      source: 'BUY_NOW',
    });

    // The regression: this used to delete the whole B line (3 units) because
    // the variant id matched. Neither a decrement nor a delete is allowed.
    expect(cartWrites()).toHaveLength(0);
  });

  it('Case 3 — cart holds 2 A and 3 B, "Mua ngay" 1 B: the order has exactly one line and one B', async () => {
    stubCheckout();
    stubCart([
      [9, 2],
      [1, 3],
    ]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      source: 'BUY_NOW',
    });

    // Exactly one order item, for one B — no duplicate line, no cart line.
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(1);
    const item = prisma.orderItem.create.mock.calls[0][0].data as {
      productVariantId: number;
      quantity: number;
    };
    expect(item.productVariantId).toBe(1);
    expect(item.quantity).toBe(1);
    expect(cartWrites()).toHaveLength(0);
  });

  it('treats explicit lines without a declared source as BUY_NOW (never rewrites the cart)', async () => {
    stubCheckout();
    stubCart([[1, 3]]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      // no `source`: an older client. The non-destructive branch is chosen.
    });

    expect(cartWrites()).toHaveLength(0);
  });

  /* --------------------------------------------------------------- CART -- */

  it('Case 4 — a cart checkout consumes exactly the ordered quantity', async () => {
    stubCheckout();
    stubCart([
      [9, 2],
      [1, 3],
    ]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 3 }],
      source: 'CART',
    });

    // B was fully paid for: its line goes. A was never part of the order.
    expect(prisma.cartItem.delete).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 101 } });
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('Case 4 — a partial cart checkout keeps the unpaid remainder', async () => {
    stubCheckout();
    stubCart([[1, 3]]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 2 }],
      source: 'CART',
    });

    // 3 - 2 = 1 stays in the cart instead of the whole line being wiped.
    expect(prisma.cartItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { quantity: 1 },
    });
    expect(prisma.cartItem.delete).not.toHaveBeenCalled();
  });

  it('Case 4 — a cart checkout with no explicit lines consumes the whole cart', async () => {
    stubCheckout();
    stubCart([
      [9, 2],
      [1, 3],
    ]);

    // The line ids come from the cart the server itself read.
    prisma.cart.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      items: [
        { id: 101, productVariantId: 1, quantity: 3 },
      ],
    });

    await service.checkout(7, { shippingAddress: address });

    expect(prisma.cartItem.delete).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 101 } });
  });

  it('never clears the cart when the checkout fails', async () => {
    stubCheckout();
    stubCart([[1, 3]]);
    // No sellable stock: `allocateFefo` throws before anything is committed.
    prisma.inventoryBalance.findMany.mockResolvedValue([]);

    await expect(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        source: 'CART',
      }),
    ).rejects.toThrow(/Insufficient sellable stock/i);

    // The cart is consumed only after every line is reserved and the payment
    // row exists, so a checkout that dies on stock never reaches the cart at
    // all — and a real transaction rolls the earlier writes back regardless.
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(cartWrites()).toHaveLength(0);
  });

  /* ------------------------------------------------- forged source abuse -- */

  it('refuses to delete a cart line the order did not pay for (forged CART)', async () => {
    stubCheckout();
    stubCart([
      [9, 5],
      [1, 2],
    ]);

    // The client claims CART but only orders variant 1. Variant 9's line must
    // survive: cart writes are derived from the ordered lines, not from the flag.
    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 2 }],
      source: 'CART',
    });

    expect(prisma.cartItem.delete).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 101 } });
    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('caps a forged over-order at the cart quantity instead of writing a negative line', async () => {
    stubCheckout();
    stubCart([[1, 2]]);

    // The client orders 5 while the cart holds only 2: the line is emptied, and
    // no negative quantity is ever written back.
    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 5 }],
      source: 'CART',
    });

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 100 } });
    for (const call of prisma.cartItem.update.mock.calls) {
      const quantity = (call[0].data as { quantity: number }).quantity;
      expect(quantity).toBeGreaterThan(0);
    }
  });

  it('does nothing when a claimed cart line is not in the cart at all', async () => {
    stubCheckout();
    stubCart([[9, 2]]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      source: 'CART',
    });

    expect(cartWrites()).toHaveLength(0);
  });

  it('treats the source as part of the request identity (retry with another source is a 409)', async () => {
    stubCheckout();
    stubCart([[1, 1]]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      source: 'BUY_NOW',
      idempotencyKey: 'source-key',
    });

    const storedHash = (prisma.checkoutIdempotencyKey.create.mock.calls[0][0].data as {
      requestHash: string;
    }).requestHash;
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      key: 'source-key',
      requestHash: storedHash,
      orderId: 500,
    });

    // Same key and lines, different source: replaying would apply the wrong
    // cart rule, so it is refused instead of silently replayed.
    await expect(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        source: 'CART',
        idempotencyKey: 'source-key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('replays a BUY_NOW retry with the same key and leaves the cart alone', async () => {
    stubCheckout();
    stubCart([[1, 1]]);

    const dto = {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      source: 'BUY_NOW' as const,
      idempotencyKey: 'buy-now-retry',
    };
    const first = await service.checkout(7, dto);
    expect(first.id).toBe(500);

    const storedHash = (prisma.checkoutIdempotencyKey.create.mock.calls[0][0].data as {
      requestHash: string;
    }).requestHash;
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      key: 'buy-now-retry',
      requestHash: storedHash,
      orderId: 500,
    });
    prisma.order.findUnique.mockResolvedValue({ id: 500, code: 'ORD-20261017-0001' });

    const second = await service.checkout(7, dto);

    expect(second.id).toBe(500);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(cartWrites()).toHaveLength(0);
  });
});
