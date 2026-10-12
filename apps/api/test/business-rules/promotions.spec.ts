import { describe, it, expect, beforeEach } from 'vitest';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { DiscountType } from '../../generated/prisma/enums.js';

describe('Flash sale & promotion rules', () => {
  let prisma: MockPrisma;
  let service: PromotionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PromotionsService(prisma as never);
  });

  describe('flash sale quota', () => {
    const flashSaleWindow = {
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date('2026-06-07T23:59:59Z'),
    };

    it('rejects when the atomic quota claim matches no row', async () => {
      // The global quota is claimed by a conditional UPDATE
      // (`sold_quantity + ? <= quota`). When it would be exceeded the statement
      // matches 0 rows; the service must turn that into the quota error instead
      // of overselling. (Previously this was a read-then-write that every
      // concurrent checkout passed — 10/10 rounds oversold in the audit.)
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 10,
        soldQuantity: 9,
        perCustomerLimit: 5,
        flashSale: flashSaleWindow,
      });
      prisma.$executeRaw.mockResolvedValue(0); // quota guard rejected the claim

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 2,
          customerId: 1,
        }),
      ).rejects.toThrow(/quota exceeded/);
    });

    it('rejects when the per-customer limit would be exceeded', async () => {
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 100,
        soldQuantity: 0,
        perCustomerLimit: 2,
        flashSale: flashSaleWindow,
      });
      prisma.$executeRaw.mockResolvedValue(1); // quota claim succeeded
      // The aggregate includes this order's items; the customer now holds 3
      // units against a limit of 2, so this purchase must be refused.
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 1,
          customerId: 1,
        }),
      ).rejects.toThrow(/Per-customer flash sale limit/);
    });

    it('accepts a purchase that lands exactly on the per-customer limit', async () => {
      // Regression guard for the double-counting bug: the old code compared
      // `already + quantity > limit`, which rejected a legitimate purchase
      // whose total *equals* the limit. The aggregate already includes this
      // order's items, so the correct test is `already > limit`.
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 100,
        soldQuantity: 0,
        perCustomerLimit: 2,
        flashSale: flashSaleWindow,
      });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 2 } }); // this order is the 2nd unit

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 1,
          customerId: 1,
        }),
      ).resolves.toBeUndefined();
    });

    it('attributes the purchase to the exact flash-sale item that priced it', async () => {
      // The per-customer aggregate is scoped to `flash_sale_item_id`, never to a
      // price match: two sales that share a price (or a normal purchase that
      // lands on the flash price) can never be confused with one another.
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 7,
        flashSaleId: 42,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 100,
        soldQuantity: 0,
        perCustomerLimit: 2,
        flashSale: flashSaleWindow,
      });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });

      await service.consumeFlashSaleQuota(prisma as never, {
        flashSaleItemId: 7,
        quantity: 1,
        customerId: 9,
      });

      // The item is looked up by its own id, and the aggregate is scoped to it.
      const findWhere = prisma.flashSaleItem.findFirst.mock.calls[0][0].where as {
        id: number;
        flashSale: { status: string };
      };
      expect(findWhere.id).toBe(7);
      expect(findWhere.flashSale.status).toBe('ACTIVE');

      const where = prisma.orderItem.aggregate.mock.calls[0][0].where as {
        flashSaleItemId: number;
        partnerOrder: { order: { customerId: number } };
      };
      expect(where.flashSaleItemId).toBe(7);
      expect(where.partnerOrder.order.customerId).toBe(9);
      // No price-match heuristic remains in the aggregate.
      expect(where).not.toHaveProperty('unitPriceSnapshot');
      expect(where).not.toHaveProperty('productVariantId');
    });

    it('claims the quota with an atomic conditional UPDATE', async () => {
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 100,
        soldQuantity: 5,
        perCustomerLimit: 10,
        flashSale: flashSaleWindow,
      });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      await service.consumeFlashSaleQuota(prisma as never, {
        flashSaleItemId: 1,
        quantity: 3,
        customerId: 1,
      });

      // The increment and the quota check are the same statement; there is no
      // read-then-write on `soldQuantity`.
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.flashSaleItem.update).not.toHaveBeenCalled();
    });

    it('rejects when the priced flash item is no longer active (no silent success)', async () => {
      // The sale ended (or was deactivated) between pricing and checkout. The
      // line was priced at a flash price, so committing it without consuming
      // quota would charge a flash price from a dead program. The checkout must
      // fail and roll back instead.
      prisma.flashSaleItem.findFirst.mockResolvedValue(null);
      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 3,
          customerId: 1,
        }),
      ).rejects.toThrow(/no longer available/);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.flashSaleItem.update).not.toHaveBeenCalled();
    });

    it('rejects when the flash price moved after pricing', async () => {
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 12000,
        quota: 100,
        soldQuantity: 0,
        perCustomerLimit: 10,
        flashSale: flashSaleWindow,
      });
      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 1,
          customerId: 1,
          expectedUnitPrice: 10000,
        }),
      ).rejects.toThrow(/price changed/);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    /**
     * The expired-sale path, end to end through the checkout.
     *
     * The claim's own SQL re-checks `status = ACTIVE` AND the window
     * (`starts_at <= UTC_TIMESTAMP(3) <= ends_at`), so an Admin deactivation or
     * a window that closed between pricing and checkout makes the UPDATE match 0
     * rows. These tests assert both halves: the lookup refuses an out-of-window
     * sale, and the conditional claim does not silently succeed when it does
     * return one.
     */
    it('looks the item up inside its sale window', async () => {
      const now = new Date('2026-10-10T12:00:00Z');
      prisma.flashSaleItem.findFirst.mockResolvedValue(null);

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 1,
          customerId: 1,
          now,
        }),
      ).rejects.toThrow(/no longer available/);

      const where = prisma.flashSaleItem.findFirst.mock.calls[0][0].where as {
        flashSale: { status: string; startsAt: { lte: Date }; endsAt: { gte: Date } };
      };
      expect(where.flashSale.status).toBe('ACTIVE');
      expect(where.flashSale.startsAt.lte).toEqual(now);
      expect(where.flashSale.endsAt.gte).toEqual(now);
    });

    it('does not commit a flash price when the window closed before the claim', async () => {
      // The row is returned (the read raced the deadline), but the atomic
      // UPDATE re-evaluates the window and matches nothing.
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 100,
        soldQuantity: 0,
        perCustomerLimit: 10,
        flashSale: flashSaleWindow,
      });
      prisma.$executeRaw.mockResolvedValue(0);
      // The diagnostic re-read finds the sale window already closed.
      prisma.flashSaleItem.findUnique.mockResolvedValue({
        id: 1,
        productVariantId: 1,
        flashPrice: 1000,
        flashSale: { status: 'ACTIVE', startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2026-01-07T00:00:00Z') },
      });

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          flashSaleItemId: 1,
          quantity: 1,
          customerId: 1,
          now: new Date('2026-10-10T12:00:00Z'),
        }),
      ).rejects.toThrow(/no longer available/);
    });
  });

  describe('voucher validation', () => {
    const now = new Date('2026-06-01');

    it('rejects an expired voucher', async () => {
      prisma.voucher.findUnique.mockResolvedValue({
        id: 1,
        code: 'X',
        status: 'ACTIVE',
        discountType: DiscountType.FIXED,
        discountValue: 10000,
        minOrderAmount: 0,
        maxDiscount: null,
        usageLimit: null,
        perCustomerLimit: null,
        usedCount: 0,
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-03-01'),
      });

      await expect(service.applyVoucher('X', 1, 100000, now)).rejects.toThrow(
        /not within its valid period/,
      );
    });

    it('rejects when the subtotal is below the minimum', async () => {
      prisma.voucher.findUnique.mockResolvedValue({
        id: 1,
        code: 'X',
        status: 'ACTIVE',
        discountType: DiscountType.FIXED,
        discountValue: 10000,
        minOrderAmount: 300000,
        maxDiscount: null,
        usageLimit: null,
        perCustomerLimit: null,
        usedCount: 0,
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-12-31'),
      });

      await expect(service.applyVoucher('X', 1, 100000, now)).rejects.toThrow(/at least 300000/);
    });

    it('caps a percent discount at maxDiscount', async () => {
      prisma.voucher.findUnique.mockResolvedValue({
        id: 1,
        code: 'X',
        status: 'ACTIVE',
        discountType: DiscountType.PERCENT,
        discountValue: 50,
        minOrderAmount: 0,
        maxDiscount: 40000,
        usageLimit: null,
        perCustomerLimit: null,
        usedCount: 0,
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-12-31'),
      });

      const result = await service.applyVoucher('X', 1, 200000, now);
      expect(result.discountAmount).toBe(40000); // 50% of 200000 = 100000, capped at 40000
    });

    it('enforces the per-customer limit', async () => {
      prisma.voucher.findUnique.mockResolvedValue({
        id: 1,
        code: 'X',
        status: 'ACTIVE',
        discountType: DiscountType.FIXED,
        discountValue: 10000,
        minOrderAmount: 0,
        maxDiscount: null,
        usageLimit: null,
        perCustomerLimit: 1,
        usedCount: 0,
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-12-31'),
      });
      prisma.voucherRedemption.count.mockResolvedValue(1);

      await expect(service.applyVoucher('X', 1, 100000, now)).rejects.toThrow(
        /per-customer limit/,
      );
    });
  });

  describe('voucher consumption (checkout path)', () => {
    const now = new Date('2026-06-01');
    const baseVoucher = {
      id: 1,
      code: 'X',
      status: 'ACTIVE',
      discountType: DiscountType.FIXED,
      discountValue: 10000,
      minOrderAmount: 0,
      maxDiscount: null,
      usageLimit: 5,
      perCustomerLimit: null,
      usedCount: 0,
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-12-31'),
    };

    it('claims the usage limit with a conditional UPDATE', async () => {
      prisma.voucher.findUnique.mockResolvedValue(baseVoucher);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.consumeVoucher(prisma as never, {
        code: 'X',
        customerId: 1,
        subtotal: 100000,
        now,
      });

      expect(result.discountAmount).toBe(10000);
      // The usage limit is enforced by the database, not a read-then-write.
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('rejects when the usage-limit claim matches no row', async () => {
      prisma.voucher.findUnique.mockResolvedValue({ ...baseVoucher, usageLimit: 1, usedCount: 1 });
      prisma.$executeRaw.mockResolvedValue(0);

      await expect(
        service.consumeVoucher(prisma as never, {
          code: 'X',
          customerId: 1,
          subtotal: 100000,
          now,
        }),
      ).rejects.toThrow(/usage limit reached/);
    });

    it('counts the per-customer limit after the usage claim', async () => {
      prisma.voucher.findUnique.mockResolvedValue({ ...baseVoucher, perCustomerLimit: 1 });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.voucherRedemption.count.mockResolvedValue(1);

      await expect(
        service.consumeVoucher(prisma as never, {
          code: 'X',
          customerId: 1,
          subtotal: 100000,
          now,
        }),
      ).rejects.toThrow(/per-customer limit/);
    });
  });

  describe('price resolution', () => {
    it('uses the flash sale price when it is cheaper than the base price', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([{ id: 5, flashPrice: 20000 }]);

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('FLASH_SALE');
      expect(price.unitPrice).toBe(20000);
      expect(price.flashSaleItemId).toBe(5);
    });

    it('ignores a flash price that is not lower than the base price', async () => {
      // The flash item exists and is active, but its price is >= base: the
      // flash price must NOT be applied, and no quota may be consumed for it.
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([{ id: 5, flashPrice: 30000 }]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('NONE');
      expect(price.unitPrice).toBe(30000);
      expect(price.flashSaleItemId).toBeNull();
    });

    it('picks the cheapest active flash item deterministically on a price tie', async () => {
      // Two overlapping sales at the same price: the service requests
      // `flashPrice asc, id asc` so the lowest item id wins deterministically,
      // and returns that id so quota is drawn from exactly that item. The mock
      // returns the rows the database would already have ordered.
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 4, flashPrice: 20000 },
        { id: 9, flashPrice: 20000 },
      ]);

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('FLASH_SALE');
      expect(price.unitPrice).toBe(20000);
      expect(price.flashSaleItemId).toBe(4);

      const orderBy = prisma.flashSaleItem.findMany.mock.calls[0][0].orderBy as unknown;
      expect(orderBy).toEqual([{ flashPrice: 'asc' }, { id: 'asc' }]);
    });

    it('picks the cheapest flash item when overlapping sales differ in price', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      // findMany is already ordered `flashPrice asc, id asc` by the service.
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 3, flashPrice: 18000 },
        { id: 8, flashPrice: 22000 },
      ]);

      const price = await service.resolvePrice(1);
      expect(price.unitPrice).toBe(18000);
      expect(price.flashSaleItemId).toBe(3);
    });

    it('applies a percent product discount when there is no flash sale', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([]);
      prisma.productDiscount.findFirst.mockResolvedValue({
        discountType: DiscountType.PERCENT,
        discountValue: 10,
      });

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('PRODUCT_DISCOUNT');
      expect(price.unitPrice).toBe(45000);
      expect(price.flashSaleItemId).toBeNull();
    });

    it('returns the base price when there are no promotions', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('NONE');
      expect(price.unitPrice).toBe(50000);
      expect(price.flashSaleItemId).toBeNull();
    });

    /**
     * An expired programme must not keep pricing.
     *
     * The window is applied as a `WHERE` predicate on the parent sale
     * (`startsAt <= now`, `endsAt >= now`), so the database never returns an
     * item from a sale outside its window. These tests assert that predicate is
     * actually sent — a regression that dropped it would silently keep selling
     * "flash" prices after the campaign ended, which is exactly the state the
     * user reported seeing.
     */
    it('queries only sales whose window contains `now`', async () => {
      const now = new Date('2026-10-10T12:00:00Z');
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      await service.resolvePrice(1, now);

      const where = prisma.flashSaleItem.findMany.mock.calls[0][0].where as {
        flashSale: { status: string; startsAt: { lte: Date }; endsAt: { gte: Date } };
      };
      expect(where.flashSale.status).toBe('ACTIVE');
      expect(where.flashSale.startsAt.lte).toEqual(now);
      expect(where.flashSale.endsAt.gte).toEqual(now);
    });

    it('falls back to the base price when the sale has ended', async () => {
      // The database applies the window predicate, so an ended sale yields no
      // rows at all: the variant prices at base, never at the stale flash price.
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const afterEnd = new Date('2026-10-10T12:00:00Z');
      const price = await service.resolvePrice(1, afterEnd);

      expect(price.source).toBe('NONE');
      expect(price.unitPrice).toBe(50000);
      expect(price.flashSaleItemId).toBeNull();
    });

    it('does not use a flash price that is not below the base price', async () => {
      // Guards the same outcome from the other side: even if a row were
      // returned, a price that is not a genuine discount is refused.
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([{ id: 7, flashPrice: 60000 }]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('NONE');
      expect(price.unitPrice).toBe(50000);
      expect(price.flashSaleItemId).toBeNull();
    });
  });

  describe('customer-aware price resolution', () => {
    it('returns the base price when there are no promotions', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.source).toBe('NONE');
      expect(price.unitPrice).toBe(50000);
      expect(price.flashSaleItemId).toBeNull();
    });

    it('picks the cheapest eligible item when the customer has headroom', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 3, flashPrice: 18000, quota: 50, soldQuantity: 0, perCustomerLimit: 50 },
        { id: 8, flashPrice: 22000, quota: 50, soldQuantity: 0, perCustomerLimit: 50 },
      ]);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.source).toBe('FLASH_SALE');
      expect(price.unitPrice).toBe(18000);
      expect(price.flashSaleItemId).toBe(3);
    });

    it('skips an item the customer already maxed and prices from the next same-price program', async () => {
      // Core regression for "two flash sales sharing a price are independent
      // per-customer programs": the second purchase must be attributed to the
      // second program, not rejected against the first one's limit.
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 4, flashPrice: 10000, quota: 50, soldQuantity: 1, perCustomerLimit: 1 },
        { id: 5, flashPrice: 10000, quota: 50, soldQuantity: 0, perCustomerLimit: 1 },
      ]);
      prisma.orderItem.aggregate.mockImplementation(async ({ where }: { where: { flashSaleItemId: number } }) => ({
        _sum: { quantity: where.flashSaleItemId === 4 ? 1 : 0 },
      }));

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.source).toBe('FLASH_SALE');
      expect(price.unitPrice).toBe(10000);
      expect(price.flashSaleItemId).toBe(5);
    });

    it('accepts a purchase that lands exactly on the per-customer limit', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 4, flashPrice: 10000, quota: 50, soldQuantity: 1, perCustomerLimit: 2 },
      ]);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.flashSaleItemId).toBe(4);
    });

    it('rejects with the per-customer error when every applicable item is personally maxed', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 4, flashPrice: 10000, quota: 50, soldQuantity: 2, perCustomerLimit: 2 },
      ]);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });

      await expect(service.resolvePriceForCustomer(1, 9, 1)).rejects.toThrow(
        /Per-customer flash sale limit/,
      );
      expect(prisma.productDiscount.findFirst).not.toHaveBeenCalled();
    });

    it('rejects with the quota error when every applicable item is exhausted', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 4, flashPrice: 10000, quota: 1, soldQuantity: 1, perCustomerLimit: 99 },
      ]);

      await expect(service.resolvePriceForCustomer(1, 9, 1)).rejects.toThrow(
        /quota exceeded/,
      );
      expect(prisma.orderItem.aggregate).not.toHaveBeenCalled();
    });

    it('skips a quota-exhausted cheapest item and prices from the next sale at its price', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 4, flashPrice: 8000, quota: 1, soldQuantity: 1, perCustomerLimit: 50 },
        { id: 5, flashPrice: 10000, quota: 50, soldQuantity: 0, perCustomerLimit: 50 },
      ]);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.unitPrice).toBe(10000);
      expect(price.flashSaleItemId).toBe(5);
    });

    it('falls back to NONE without throwing when the flash price is not below base', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([
        { id: 5, flashPrice: 30000, quota: 50, soldQuantity: 0, perCustomerLimit: 50 },
      ]);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.source).toBe('NONE');
      expect(price.flashSaleItemId).toBeNull();
    });

    it('falls back to the product discount when no flash item applies', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findMany.mockResolvedValue([]);
      prisma.productDiscount.findFirst.mockResolvedValue({
        discountType: DiscountType.PERCENT,
        discountValue: 10,
      });

      const price = await service.resolvePriceForCustomer(1, 9, 1);
      expect(price.source).toBe('PRODUCT_DISCOUNT');
      expect(price.unitPrice).toBe(45000);
      expect(price.flashSaleItemId).toBeNull();
    });
  });

  describe('flash sale creation guard (A4)', () => {
    const item = { productVariantId: 1, flashPrice: 50000, quota: 100, perCustomerLimit: 2 };

    it('rejects a window that ends before it starts', async () => {
      await expect(
        service.createFlashSale({
          name: 'Flash Sale nông sản Hưng Yên',
          startsAt: '2026-11-06T17:00:00.000Z',
          endsAt: '2026-09-07T17:00:00.000Z',
          items: [item],
        }),
      ).rejects.toThrow(/after startsAt/);
      expect(prisma.flashSale.create).not.toHaveBeenCalled();
    });

    it('rejects a weekend label on a 60-day programme (fs#3 shape)', async () => {
      await expect(
        service.createFlashSale({
          name: 'Flash Sale cuối tuần Hưng Yên',
          startsAt: '2026-09-07T17:00:00.000Z',
          endsAt: '2026-11-06T17:00:00.000Z',
          items: [item],
        }),
      ).rejects.toThrow(/weekend/);
      expect(prisma.flashSale.create).not.toHaveBeenCalled();
    });

    it('accepts a weekend label inside a 7-day window', async () => {
      prisma.flashSale.create.mockResolvedValue({ id: 9 });
      const sale = await service.createFlashSale({
        name: 'Flash Sale cuối tuần Hưng Yên',
        startsAt: '2026-09-07T17:00:00.000Z',
        endsAt: '2026-09-13T17:00:00.000Z',
        items: [item],
      });
      expect(sale).toEqual({ id: 9 });
    });
  });
});
