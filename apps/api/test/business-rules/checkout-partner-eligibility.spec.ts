import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from '../../src/orders/orders.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { QuarantineService } from '../../src/quarantine/quarantine.service.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { CommissionService } from '../../src/finance/commission.service.js';
import { LocationsService } from '../../src/locations/locations.service.js';
import { createMockPrisma, stubPartnerLock, type MockPrisma } from '../helpers/prisma-mock.js';
import { ProductLotStatus } from '../../generated/prisma/enums.js';

/**
 * Task 05.4.2.5 — a new order may only be created when EVERY line's seller is
 * eligible: Product ACTIVE, ProductVariant ACTIVE (sellable), and Partner
 * ACTIVE + VERIFIED.
 *
 * The rule has to hold for the whole cart, not for the first line that happens
 * to be read: a multi-seller basket with one suspended/unverified partner must
 * create nothing at all (no order, no partner order, no order item, no stock
 * reservation, no payment, and an untouched cart). It also has to hold inside
 * the transaction that writes the order, because the status can change between
 * the pre-flight read and the insert, and it must not be possible to skip it by
 * using "Mua ngay" (BUY_NOW) instead of the cart.
 *
 * These tests are written against the mock Prisma client, so they assert the
 * *decisions* (which writes were attempted) rather than row counts in MySQL;
 * the isolated-database e2e suite covers the same rules end to end.
 */
/** The exact sentence the API must answer with (shared with the storefront). */
const EXACT_MESSAGE =
  'Sản phẩm hiện chưa đủ điều kiện kinh doanh. Vui lòng chọn sản phẩm khác.';

interface Seller {
  status: 'ACTIVE' | 'INACTIVE';
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

interface VariantStub {
  id: number;
  sku: string;
  basePrice: number;
  variantStatus?: 'ACTIVE' | 'INACTIVE';
  productStatus?: 'ACTIVE' | 'INACTIVE';
  partnerId?: number;
  seller: Seller;
}

const SELLABLE: Seller = { status: 'ACTIVE', verificationStatus: 'VERIFIED' };

function variantStub(spec: VariantStub) {
  return {
    id: spec.id,
    sku: spec.sku,
    basePrice: spec.basePrice,
    status: spec.variantStatus ?? 'ACTIVE',
    product: {
      id: spec.id,
      partnerId: spec.partnerId ?? spec.id,
      categoryId: 1,
      name: `Sản phẩm ${spec.sku}`,
      status: spec.productStatus ?? 'ACTIVE',
      partner: spec.seller,
    },
  };
}

describe('Checkout — seller eligibility (Partner ACTIVE + VERIFIED)', () => {
  let prisma: MockPrisma;
  let service: OrdersService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    const inventory = new InventoryService(prisma as never, audit as never);
    const quarantine = new QuarantineService(prisma as never, audit as never, inventory);
    const promotions = new PromotionsService(prisma as never);
    const commission = new CommissionService(prisma as never);
    service = new OrdersService(
      prisma as never,
      inventory,
      promotions,
      commission,
      audit as never,
      new LocationsService(prisma as never),
      quarantine,
    );
  });

  const address = {
    recipientName: 'Test',
    phone: '0900000000',
    province: 'Hưng Yên',
    detail: 'abc',
  };

  /**
   * Stub the whole successful-checkout dependency graph. `variants` is keyed by
   * variant id so a multi-partner cart resolves each line to its own seller.
   */
  function stubCheckout(variants: VariantStub[]) {
    const byId = new Map(variants.map((v) => [v.id, variantStub(v)]));
    prisma.productVariant.findUnique.mockImplementation(
      async ({ where }: { where: { id: number } }) => byId.get(where.id) ?? null,
    );

    // The in-transaction Partner lock re-reads the seller state inside the
    // locking statement itself (`lockSellablePartners`). Each variant's declared
    // seller is what that statement must return, so a test that marks a seller
    // INACTIVE/PENDING is refused by the locked check exactly like the real
    // database would refuse it.
    stubPartnerLock(
      prisma,
      variants.map((variant) => ({
        id: variant.partnerId ?? variant.id,
        status: variant.seller.status,
        verificationStatus: variant.seller.verificationStatus,
      })),
    );

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

    // FEFO plan: one sellable slice per variant, plenty of stock.
    prisma.inventoryBalance.findMany.mockImplementation(
      async ({ where }: { where: { productVariantId?: number } }) => {
        const ids =
          where.productVariantId === undefined
            ? variants.map((v) => v.id)
            : [where.productVariantId];
        return ids.map((productVariantId) => ({
          id: productVariantId,
          warehouseId: 1,
          productLotId: productVariantId,
          productVariantId,
          onHand: 100,
          reserved: 0,
          blocked: 0,
          unit: 'kg',
          productLot: {
            id: productVariantId,
            expiresAt: new Date('2026-12-01'),
            status: ProductLotStatus.SELLABLE,
            qcInspections: [{ result: 'PASS', inspectedAt: new Date() }],
          },
        }));
      },
    );
    prisma.inventoryBalance.findUniqueOrThrow.mockImplementation(
      async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        warehouseId: 1,
        productLotId: where.id,
        productVariantId: where.id,
        onHand: 100,
        reserved: 1,
        blocked: 0,
        unit: 'kg',
      }),
    );
    prisma.inventoryBalance.update.mockResolvedValue({});
    prisma.inventoryAllocation.create.mockResolvedValue({});
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.payment.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    prisma.cartItem.delete.mockResolvedValue({});
    prisma.cartItem.update.mockResolvedValue({});
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });
    prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue(null);
    prisma.checkoutIdempotencyKey.create.mockResolvedValue({ id: 1 });
  }

  /** A cart with the given `[variantId, quantity]` lines. */
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

  /** Every write a successful checkout would perform, in one place. */
  function expectNoOrderSideEffects() {
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.partnerOrder.create).not.toHaveBeenCalled();
    expect(prisma.orderItem.create).not.toHaveBeenCalled();
    expect(prisma.inventoryAllocation.create).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.voucherRedemption.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  }

  function expectCartUntouched() {
    expect(prisma.cartItem.delete).not.toHaveBeenCalled();
    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  }

  /** Assert the rejection is the exact agreed sentence, not just any 400. */
  async function expectRejected(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(EXACT_MESSAGE);
    return error as BadRequestException;
  }

  /* ------------------------------------------------------------- case 1 -- */

  it('Case 1 — VERIFIED + ACTIVE seller: the order is created normally', async () => {
    stubCheckout([{ id: 1, sku: 'A-1', basePrice: 50000, seller: SELLABLE }]);

    const order = await service.checkout(7, {
      shippingAddress: address,
      items: [{ productVariantId: 1, quantity: 2 }],
      paymentMethod: 'COD',
    });

    expect(order.id).toBe(500);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.partnerOrder.create).toHaveBeenCalledTimes(1);
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(1);
    // The reservation and the payment record still happen for an eligible
    // seller: the new gate must not break the normal path.
    expect(prisma.inventoryAllocation.create).toHaveBeenCalledTimes(1);
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    const payment = prisma.payment.create.mock.calls[0][0].data as { status: string };
    expect(payment.status).toBe('PENDING');
  });

  /* ------------------------------------------------------------- case 2 -- */

  it('Case 2 — PENDING seller: checkout is refused and nothing is written', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'ACTIVE', verificationStatus: 'PENDING' },
      },
    ]);
    stubCart([[1, 1]]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        source: 'CART',
      }),
    );

    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  /* ------------------------------------------------------------- case 3 -- */

  it('Case 3 — REJECTED seller: checkout is refused and nothing is written', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'ACTIVE', verificationStatus: 'REJECTED' },
      },
    ]);
    stubCart([[1, 1]]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        source: 'CART',
      }),
    );

    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  /* ------------------------------------------------------------- case 4 -- */

  it('Case 4 — INACTIVE seller: checkout is refused even when VERIFIED', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'INACTIVE', verificationStatus: 'VERIFIED' },
      },
    ]);
    stubCart([[1, 1]]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        source: 'CART',
      }),
    );

    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  it('Case 4b — INACTIVE + PENDING seller: same single rejection message', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'INACTIVE', verificationStatus: 'PENDING' },
      },
    ]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
      }),
    );

    expectNoOrderSideEffects();
  });

  /* ------------------------------------------------------------- case 5 -- */

  it('Case 5 — multi-seller cart with one ineligible partner creates no partial order', async () => {
    // Two lines, two different partners: A is fine, B is suspended. The whole
    // checkout must fail; a "create what is valid" implementation would leave
    // one partner order behind.
    stubCheckout([
      { id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE },
      {
        id: 2,
        sku: 'B-1',
        basePrice: 30000,
        partnerId: 22,
        seller: { status: 'INACTIVE', verificationStatus: 'VERIFIED' },
      },
    ]);
    stubCart([
      [1, 1],
      [2, 1],
    ]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [
          { productVariantId: 1, quantity: 1 },
          { productVariantId: 2, quantity: 1 },
        ],
        source: 'CART',
      }),
    );

    // Not even the valid line got through: no order header, no per-partner
    // split, no item, no reservation for either seller, no payment.
    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  it('Case 5b — the ineligible line is checked even when it is not the first line', async () => {
    // Same as 5 but the bad partner comes second in the request order: the
    // first (valid) line must not be written before the second one is judged.
    stubCheckout([
      { id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE },
      {
        id: 2,
        sku: 'B-1',
        basePrice: 30000,
        partnerId: 22,
        seller: { status: 'ACTIVE', verificationStatus: 'REJECTED' },
      },
    ]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [
          { productVariantId: 1, quantity: 1 },
          { productVariantId: 2, quantity: 1 },
        ],
      }),
    );

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.inventoryAllocation.create).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------- case 6 -- */

  it('Case 6 — BUY_NOW cannot bypass the seller check', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'ACTIVE', verificationStatus: 'PENDING' },
      },
    ]);
    stubCart([]); // nothing in the cart: the lines come straight from the DTO

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
        source: 'BUY_NOW',
      }),
    );

    // The bypass the flag could have opened: no order, no reservation, and the
    // cart is not touched either way.
    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  it('Case 6b — a forged BUY_NOW on a cart-only line still hits the seller check', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'INACTIVE', verificationStatus: 'PENDING' },
      },
    ]);
    stubCart([[1, 2]]);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 2 }],
        source: 'BUY_NOW',
      }),
    );

    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  /* ------------------------------------------------------------- case 7 -- */

  it('Case 7 — a refused checkout leaves cart, stock and payment untouched', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'ACTIVE', verificationStatus: 'REJECTED' },
      },
    ]);
    stubCart([
      [1, 3],
      [9, 2],
    ]);

    // The rejection must arrive before ANY state change: no reservation claim
    // (`$executeRaw` is the conditional stock UPDATE), no movement ledger row,
    // no allocation row, no payment, no cart write.
    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 3 }],
        source: 'CART',
      }),
    );

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.inventoryAllocation.create).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expectNoOrderSideEffects();
    expectCartUntouched();
  });

  it('Case 7b — the preview refuses the same line, so the storefront agrees', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        seller: { status: 'ACTIVE', verificationStatus: 'PENDING' },
      },
    ]);

    await expectRejected(
      service.checkoutPreview(7, { items: [{ productVariantId: 1, quantity: 1 }] }),
    );

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  /* -------------------------------------------- in-transaction re-check -- */

  it('re-checks the seller inside the transaction, so a status change after the pre-flight read still refuses', async () => {
    // The pre-flight read (outside the transaction) sees a sellable seller...
    stubCheckout([{ id: 1, sku: 'A-1', basePrice: 50000, seller: SELLABLE }]);
    const sellable = variantStub({ id: 1, sku: 'A-1', basePrice: 50000, seller: SELLABLE });
    const suspended = variantStub({
      id: 1,
      sku: 'A-1',
      basePrice: 50000,
      seller: { status: 'INACTIVE', verificationStatus: 'PENDING' },
    });

    // ...then the operator suspends the partner before the transaction's own
    // read, which is exactly the race the second check exists for.
    let calls = 0;
    prisma.productVariant.findUnique.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? sellable : suspended;
    });

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
      }),
    );

    // Two reads: the pre-flight one and the in-transaction one.
    expect(calls).toBeGreaterThanOrEqual(2);
    expectNoOrderSideEffects();
  });

  it('reads every line again inside the transaction before writing anything', async () => {
    stubCheckout([
      { id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE },
      { id: 2, sku: 'B-1', basePrice: 30000, partnerId: 22, seller: SELLABLE },
    ]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [
        { productVariantId: 1, quantity: 1 },
        { productVariantId: 2, quantity: 1 },
      ],
    });

    // The in-transaction revalidation happens for every line, not just the
    // first: 2 lines × (pre-flight + transaction) = at least 4 reads, and the
    // first write (order.create) comes after all of them.
    const variantReads = prisma.productVariant.findUnique.mock.calls.length;
    expect(variantReads).toBeGreaterThanOrEqual(4);

    const firstVariantReadOrder = prisma.productVariant.findUnique.mock
      .invocationCallOrder[0];
    const orderCreateOrder = prisma.order.create.mock.invocationCallOrder[0];
    expect(orderCreateOrder).toBeGreaterThan(firstVariantReadOrder);
  });

  /* --------------------------------------------- preserved behaviour ----- */

  it('keeps the variant/product messages for a stopped listing (seller gate is additive)', async () => {
    stubCheckout([
      {
        id: 1,
        sku: 'A-1',
        basePrice: 50000,
        variantStatus: 'INACTIVE',
        seller: SELLABLE,
      },
    ]);

    await expect(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
      }),
    ).rejects.toThrow(/no longer for sale/);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('does not leak the seller status detail in the refusal message', async () => {
    for (const seller of [
      { status: 'ACTIVE', verificationStatus: 'PENDING' },
      { status: 'ACTIVE', verificationStatus: 'REJECTED' },
      { status: 'INACTIVE', verificationStatus: 'VERIFIED' },
    ] as Seller[]) {
      stubCheckout([{ id: 1, sku: 'A-1', basePrice: 50000, seller }]);
      const error = await expectRejected(
        service.checkout(7, {
          shippingAddress: address,
          items: [{ productVariantId: 1, quantity: 1 }],
        }),
      );
      // Same sentence for every cause: the buyer cannot tell PENDING from
      // REJECTED from INACTIVE, and no partner name/id is echoed.
      expect(error.message).toBe(EXACT_MESSAGE);
      expect(error.message).not.toMatch(/PENDING|REJECTED|INACTIVE|VERIFIED/);
      expect(error.message).not.toMatch(/A-1/);
    }
  });

  it('keeps historical orders readable (the gate only guards new writes)', async () => {
    // The check lives in the checkout path only: reading an existing order
    // never loads a partner status, so a seller that was suspended after the
    // sale cannot make the buyer's history disappear.
    prisma.order.findUnique.mockResolvedValue({ id: 42, code: 'ORD-20260101-0001' });

    const order = await service.findOne(42);

    expect(order.id).toBe(42);
    expect(prisma.productVariant.findUnique).not.toHaveBeenCalled();
  });

  /* ------------------------------------- seller lock (task 05.4.2.6) ----- */

  /** The raw statements this service sends, with tagged-template values flattened. */
  function rawCalls(): { text: string; values: unknown[] }[] {
    const flatten = (value: unknown): unknown[] => {
      const nested = value as { strings?: string[]; values?: unknown[] } | null;
      if (nested && Array.isArray(nested.strings) && Array.isArray(nested.values)) {
        return nested.values.flatMap(flatten);
      }
      return [value];
    };
    return prisma.$queryRaw.mock.calls
      .map((call) => call as unknown[])
      .filter((args) => Array.isArray(args[0]))
      .map(([strings, ...values]) => ({
        text: (strings as string[]).join('?'),
        values: values.flatMap(flatten),
      }));
  }

  /** The Partner locking statements (the seller lock of task 05.4.2.6). */
  function partnerLockCalls() {
    return rawCalls().filter((call) => /FROM\s+partners/i.test(call.text));
  }

  it('takes a shared Partner lock for every seller before any write', async () => {
    stubCheckout([
      { id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE },
      { id: 2, sku: 'B-1', basePrice: 30000, partnerId: 22, seller: SELLABLE },
    ]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [
        { productVariantId: 1, quantity: 1 },
        { productVariantId: 2, quantity: 1 },
      ],
    });

    const lockCalls = partnerLockCalls();
    expect(lockCalls).toHaveLength(1);
    // A row lock, not a plain re-read: a plain SELECT cannot serialise against
    // the partner-management write that flips the status.
    expect(lockCalls[0].text).toMatch(/FOR SHARE|FOR UPDATE/);
    // The status pair comes from the SAME statement that takes the lock. A
    // plain read after a locking read can answer from an older snapshot under
    // REPEATABLE READ, so splitting the two would be a correctness bug at any
    // isolation level other than the READ COMMITTED checkout happens to use.
    expect(lockCalls[0].text).toMatch(/status/);
    expect(lockCalls[0].text).toMatch(/verification_status/);
    expect(lockCalls[0].text).toMatch(/ORDER BY id/);
    // Both sellers in one statement, ascending, so a multi-seller checkout
    // cannot deadlock another one that shares the same sellers.
    expect(lockCalls[0].values).toEqual([11, 22]);

    // The lock happens before the first write of the transaction (the order
    // code counter) and before the order row itself.
    const lockIndex = prisma.$queryRaw.mock.calls.findIndex((call) => {
      const arg = call[0] as unknown;
      return Array.isArray(arg) && /FROM\s+partners/i.test((arg as string[]).join('?'));
    });
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[lockIndex];
    expect(lockOrder).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(prisma.order.create.mock.invocationCallOrder[0]);
  });

  it('de-duplicates sellers so one partner with two lines is locked once', async () => {
    stubCheckout([
      { id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE },
      { id: 2, sku: 'A-2', basePrice: 20000, partnerId: 11, seller: SELLABLE },
    ]);

    await service.checkout(7, {
      shippingAddress: address,
      items: [
        { productVariantId: 1, quantity: 1 },
        { productVariantId: 2, quantity: 1 },
      ],
    });

    expect(partnerLockCalls()[0].values).toEqual([11]);
    // Two lines, one seller: still a single partner order.
    expect(prisma.partnerOrder.create).toHaveBeenCalledTimes(1);
  });

  it('refuses when a seller turns unsellable between the read and the lock', async () => {
    // The variant read says ACTIVE + VERIFIED for both, but the row the locking
    // statement returns reports the suspension that landed in between. That is
    // the exact race: the pre-flight and in-transaction reads pass, and only the
    // locked statement can catch it.
    stubCheckout([
      { id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE },
      { id: 2, sku: 'B-1', basePrice: 30000, partnerId: 22, seller: SELLABLE },
    ]);
    stubPartnerLock(prisma, [
      { id: 11, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
      { id: 22, status: 'INACTIVE', verificationStatus: 'VERIFIED' },
    ]);

    const error = await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [
          { productVariantId: 1, quantity: 1 },
          { productVariantId: 2, quantity: 1 },
        ],
      }),
    );

    expect(error.message).toBe(EXACT_MESSAGE);
    // Nothing was written for the seller that is still fine: the whole
    // checkout is refused, not partially created.
    expectNoOrderSideEffects();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('fails closed when a locked seller row cannot be read back', async () => {
    stubCheckout([{ id: 1, sku: 'A-1', basePrice: 50000, partnerId: 11, seller: SELLABLE }]);
    stubPartnerLock(prisma, []);

    await expectRejected(
      service.checkout(7, {
        shippingAddress: address,
        items: [{ productVariantId: 1, quantity: 1 }],
      }),
    );

    expectNoOrderSideEffects();
  });
});
