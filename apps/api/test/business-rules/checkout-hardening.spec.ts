import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { OrdersService } from '../../src/orders/orders.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { CommissionService } from '../../src/finance/commission.service.js';
import { LocationsService } from '../../src/locations/locations.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { FLAT_SHIPPING_FEE } from '../../src/orders/shipping-policy.js';
import { ProductLotStatus } from '../../generated/prisma/enums.js';

/**
 * Checkout hardening: the shipping fee is backend-decided, a forged client fee
 * cannot reach the order, an idempotency key makes retries safe, and customer
 * cancellation runs the same state machine as the admin path.
 */
describe('Checkout hardening', () => {
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
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue(null);
    prisma.checkoutIdempotencyKey.create.mockResolvedValue({ id: 1 });
  }

  const address = {
    recipientName: 'Test',
    phone: '0900000000',
    province: 'Hưng Yên',
    detail: 'abc',
  };

  it('uses the backend shipping fee and ignores nothing from the client', async () => {
    stubCheckout();

    const order = await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 2 }],
    });

    // subtotal = 2 * 50000
    expect(order.subtotal).toBe(100000);
    expect(order.shippingFee).toBe(FLAT_SHIPPING_FEE);
    expect(order.grandTotal).toBe(100000 + FLAT_SHIPPING_FEE);
  });

  it('takes the shipping fee from the policy, not from the DTO', async () => {
    stubCheckout();

    // A forged `shippingFee` in the payload is not part of CheckoutDto, so the
    // global ValidationPipe rejects it with a 400 before the service runs. At
    // the service level the field is simply ignored.
    const order = await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      // @ts-expect-error deliberately forged field
      shippingFee: 0,
    });

    expect(order.shippingFee).toBe(FLAT_SHIPPING_FEE);
    expect(order.grandTotal).toBe(50000 + FLAT_SHIPPING_FEE);
  });

  it('returns the original order for a repeated key with the same payload', async () => {
    stubCheckout();
    const dto = {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      idempotencyKey: 'retry-key-1',
    };

    const first = await service.checkout(7, dto);
    expect(first.id).toBe(500);

    // Simulate the retry: the key row now exists and points at the order.
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      key: 'retry-key-1',
      requestHash: (prisma.checkoutIdempotencyKey.create.mock.calls[0][0].data as {
        requestHash: string;
      }).requestHash,
      orderId: 500,
    });
    prisma.order.findUnique.mockResolvedValue({ id: 500, code: 'ORD-20260415-0001' });

    const second = await service.checkout(7, dto);
    expect(second.id).toBe(500);
    // No second order, no second reservation.
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('replays the order even when the retry finds an empty cart', async () => {
    stubCheckout();
    const dto = {
      shippingAddress: address,
      idempotencyKey: 'lost-response-key',
    };

    // First request: cart-based (no explicit items), cart has one line.
    prisma.cart.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      items: [{ productVariantId: 1, quantity: 1 }],
    });
    const first = await service.checkout(7, dto);
    expect(first.id).toBe(500);

    // The first call consumed the cart; the retry therefore resolves no items.
    prisma.cart.findUnique.mockResolvedValue({ id: 1, customerId: 7, items: [] });
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      key: 'lost-response-key',
      requestHash: (prisma.checkoutIdempotencyKey.create.mock.calls[0][0].data as {
        requestHash: string;
      }).requestHash,
      orderId: 500,
    });
    prisma.order.findUnique.mockResolvedValue({ id: 500, code: 'ORD-20260415-0001' });

    const retry = await service.checkout(7, dto);
    expect(retry.id).toBe(500);
    // No second order, and the empty cart never produced a 400.
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a repeated key with a different payload (409)', async () => {
    stubCheckout();
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue({
      id: 1,
      customerId: 7,
      key: 'retry-key-2',
      requestHash: 'a-different-hash',
      orderId: 500,
    });

    await expect(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        idempotencyKey: 'retry-key-2',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('replays the committed order when a concurrent retry loses the key race', async () => {
    stubCheckout();

    // The key insert collides because a concurrent request with the same key
    // committed first. Capture the hash the service computed so the stored row
    // looks like it came from the same payload.
    let computedHash = '';
    prisma.checkoutIdempotencyKey.create.mockImplementationOnce(
      async ({ data }: { data: { requestHash: string } }) => {
        computedHash = data.requestHash;
        throw { code: 'P2002', meta: { target: 'checkout_idempotency_keys_customer_id_key_key' } };
      },
    );

    prisma.checkoutIdempotencyKey.findUnique
      .mockResolvedValueOnce(null) // first lookup: key not used yet
      .mockImplementation(async () => ({
        id: 1,
        customerId: 7,
        key: 'race-key',
        requestHash: computedHash,
        orderId: 500,
      }));
    prisma.order.findUnique.mockResolvedValue({ id: 500, code: 'ORD-20260415-0001' });

    const order = await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
      idempotencyKey: 'race-key',
    });

    expect(order.id).toBe(500);
    // The losing attempt is rolled back by the real transaction (the mock does
    // not simulate that), so what matters here is that the caller got the order
    // the concurrent request committed instead of an error or a second order.
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.checkoutIdempotencyKey.findUnique).toHaveBeenCalledTimes(2);
  });

  it('retries the order code when a concurrent checkout took it', async () => {
    stubCheckout();
    prisma.order.create
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: 'orders_code_key' } })
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 501,
        ...data,
      }));

    const order = await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 1 }],
    });

    expect(order.id).toBe(501);
    expect(prisma.order.create).toHaveBeenCalledTimes(2);
  });

  it('previews the same totals the checkout charges, without creating anything', async () => {
    stubCheckout();

    const preview = await service.checkoutPreview(7, {
      items: [{ productVariantId: 1, quantity: 3 }],
    });

    expect(preview.subtotal).toBe(150000);
    expect(preview.shippingFee).toBe(FLAT_SHIPPING_FEE);
    expect(preview.grandTotal).toBe(150000 + FLAT_SHIPPING_FEE);
    expect(preview.items[0].available).toBe(true);
    expect(preview.items[0].availableQuantity).toBe(100);
    expect(preview.items[0].priceSource).toBe('NONE');
    // A preview must never write.
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.inventoryAllocation.create).not.toHaveBeenCalled();
  });

  it('marks a preview line as unavailable when stock is short', async () => {
    stubCheckout();
    prisma.inventoryBalance.findMany.mockResolvedValue([
      {
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 2,
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

    const preview = await service.checkoutPreview(7, {
      items: [{ productVariantId: 1, quantity: 5 }],
    });

    expect(preview.items[0].availableQuantity).toBe(2);
    expect(preview.items[0].available).toBe(false);
  });

  describe('price/promotion guard between preview and confirm', () => {
    it('accepts the checkout when the echoed total matches the recomputed total', async () => {
      stubCheckout();

      // subtotal 100000 + flat shipping 20000 = 120000.
      const order = await service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 2 }],
        expectedGrandTotal: 100000 + FLAT_SHIPPING_FEE,
      });

      expect(order.grandTotal).toBe(100000 + FLAT_SHIPPING_FEE);
    });

    it('rejects a stale total with 409 instead of silently charging the new price', async () => {
      stubCheckout();

      // The customer saw 90000 on the preview, but the price/promotion changed
      // and the recomputed total is 120000: the checkout must not proceed.
      await expect(
        service.checkout(7, {
          shippingAddress: address,
          items: [{ productVariantId: 1, quantity: 2 }],
          expectedGrandTotal: 90000,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      // The mismatch costs nothing: no order, no reservation, no voucher claim.
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.inventoryAllocation.create).not.toHaveBeenCalled();
    });

    it('re-resolves the price when the client does not echo a total', async () => {
      stubCheckout();

      const order = await service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
      });

      expect(order.grandTotal).toBe(50000 + FLAT_SHIPPING_FEE);
    });
  });

  it('cancels the customer\'s own order and releases reservations', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 500,
      customerId: 7,
      status: 'PENDING_CONFIRMATION',
    });
    // The state machine is a compare-and-set: the cancellation claims the row
    // only while it is still PENDING_CONFIRMATION.
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 500, status: 'CANCELLED' });
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.inventoryAllocation.findMany.mockResolvedValue([
      {
        id: 1,
        quantity: 2,
        inventoryBalance: {
          id: 1,
          warehouseId: 1,
          productLotId: 1,
          productVariantId: 1,
          reserved: 2,
        },
      },
    ]);
    // `releaseStock` runs the atomic `reserved = GREATEST(reserved - ?, 0)`.
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      warehouseId: 1,
      productLotId: 1,
      productVariantId: 1,
      reserved: 0,
    });
    prisma.inventoryMovement.create.mockResolvedValue({});

    const order = await service.cancelForCustomer(500, 7, 7);

    expect(order.status).toBe('CANCELLED');
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 500, status: 'PENDING_CONFIRMATION' } }),
    );
    // The release is written as a RELEASE movement for the cancel.
    const movement = prisma.inventoryMovement.create.mock.calls[0][0].data as {
      type: string;
      referenceType: string;
    };
    expect(movement.type).toBe('RELEASE');
    expect(movement.referenceType).toBe('OrderCancel');
  });

  it('quarantines reservations when a SHIPPING order is cancelled', async () => {
    // The goods have already left the warehouse, so cancelling must NOT make
    // them sellable again: the reservation becomes a blocked quantity instead.
    prisma.order.findFirst.mockResolvedValue({
      id: 500,
      customerId: 7,
      status: 'SHIPPING',
    });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 500, status: 'CANCELLED' });
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.inventoryAllocation.findMany.mockResolvedValue([
      {
        id: 1,
        quantity: 2,
        inventoryBalance: {
          id: 1,
          warehouseId: 1,
          productLotId: 1,
          productVariantId: 1,
          reserved: 2,
        },
      },
    ]);
    prisma.$executeRaw.mockResolvedValue(1);
    // After `quarantineStock`: reserved 2 -> 0, blocked 0 -> 2.
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      warehouseId: 1,
      productLotId: 1,
      productVariantId: 1,
      reserved: 0,
      blocked: 2,
    });
    prisma.inventoryMovement.create.mockResolvedValue({});

    const order = await service.cancelForCustomer(500, 7, 7);

    expect(order.status).toBe('CANCELLED');
    // The move is recorded as a QUARANTINE, not a RELEASE, so the units are not
    // offered for resale.
    const movement = prisma.inventoryMovement.create.mock.calls[0][0].data as {
      type: string;
      referenceType: string;
    };
    expect(movement.type).toBe('QUARANTINE');
    expect(movement.referenceType).toBe('OrderCancel');
    // `quarantineStock` moved reserved -> blocked in one statement.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a cancel whose compare-and-set loses the race (409)', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 500,
      customerId: 7,
      status: 'PENDING_CONFIRMATION',
    });
    // A concurrent request moved the order first, so the predicate no longer
    // matches and 0 rows are claimed: the double release is refused.
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancelForCustomer(500, 7, 7)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.inventoryAllocation.findMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order that is not the customer\'s (404)', async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.cancelForCustomer(500, 7, 7)).rejects.toThrow(/Order not found/);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses an illegal cancel (DELIVERED is terminal)', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 500,
      customerId: 7,
      status: 'DELIVERED',
    });

    await expect(service.cancelForCustomer(500, 7, 7)).rejects.toThrow(
      /Cannot change order status from DELIVERED to CANCELLED/,
    );
  });

  describe('DELIVERED — stock leaves, COD is NOT auto-settled', () => {
    function stubDelivery() {
      prisma.order.findUnique.mockResolvedValue({
        id: 500,
        customerId: 7,
        status: 'SHIPPING',
      });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 500, status: 'DELIVERED' });
      prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryAllocation.findMany.mockResolvedValue([
        {
          id: 1,
          quantity: 5,
          productLotId: 77,
          inventoryBalanceId: 9,
          inventoryBalance: {
            id: 9,
            warehouseId: 1,
            productLotId: 77,
            productVariantId: 1,
          },
        },
      ]);
      // `consumeStock` claim wins; read-back shows on_hand 100 -> 95.
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
        id: 9,
        warehouseId: 1,
        productLotId: 77,
        productVariantId: 1,
        onHand: 95,
        reserved: 0,
        blocked: 0,
      });
      prisma.inventoryMovement.create.mockResolvedValue({});
    }

    it('consumes the reservation and writes an OUTBOUND movement', async () => {
      stubDelivery();

      const order = await service.updateStatus(500, 'DELIVERED' as never, 7);

      expect(order.status).toBe('DELIVERED');
      const movement = prisma.inventoryMovement.create.mock.calls[0][0].data as {
        type: string;
        quantityDelta: number;
        referenceType: string;
        referenceId: number;
      };
      expect(movement.type).toBe('OUTBOUND');
      expect(movement.quantityDelta).toBe(-5);
      expect(movement.referenceType).toBe('Order');
      expect(movement.referenceId).toBe(500);
    });

    it('never marks COD PAID on delivery', async () => {
      stubDelivery();

      await service.updateStatus(500, 'DELIVERED' as never, 7);

      // The payment status is untouched: collection is confirmed separately.
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('rolls back with 409 when the reservation no longer exists', async () => {
      stubDelivery();
      // The guarded consume matches 0 rows: a concurrent writer changed the
      // balance, so delivery must not pretend the goods left.
      prisma.$executeRaw.mockResolvedValue(0);

      await expect(service.updateStatus(500, 'DELIVERED' as never, 7)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  it('filters my orders in SQL and returns an exact total', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(3);

    const result = await service.findForCustomer(7, { page: 1, limit: 10, status: 'SHIPPING' });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 7, status: 'SHIPPING' } }),
    );
    expect(prisma.order.count).toHaveBeenCalledWith({ where: { customerId: 7, status: 'SHIPPING' } });
    expect(result.meta.total).toBe(3);
  });
});
