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
    it('rejects when the global quota would be exceeded', async () => {
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 10,
        soldQuantity: 9,
        perCustomerLimit: 5,
      });

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          productVariantId: 1,
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
      });
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });

      await expect(
        service.consumeFlashSaleQuota(prisma as never, {
          productVariantId: 1,
          quantity: 1,
          customerId: 1,
        }),
      ).rejects.toThrow(/Per-customer flash sale limit/);
    });

    it('increments soldQuantity when within quota and limit', async () => {
      prisma.flashSaleItem.findFirst.mockResolvedValue({
        id: 1,
        flashSaleId: 1,
        productVariantId: 1,
        flashPrice: 1000,
        quota: 100,
        soldQuantity: 5,
        perCustomerLimit: 10,
      });
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.flashSaleItem.update.mockResolvedValue({});

      await service.consumeFlashSaleQuota(prisma as never, {
        productVariantId: 1,
        quantity: 3,
        customerId: 1,
      });

      expect(prisma.flashSaleItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { soldQuantity: 8 } }),
      );
    });

    it('does nothing when the variant is not in an active flash sale', async () => {
      prisma.flashSaleItem.findFirst.mockResolvedValue(null);
      await service.consumeFlashSaleQuota(prisma as never, {
        productVariantId: 1,
        quantity: 3,
        customerId: 1,
      });
      expect(prisma.flashSaleItem.update).not.toHaveBeenCalled();
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

  describe('price resolution', () => {
    it('uses the flash sale price when it is cheaper than the base price', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 30000 });
      prisma.flashSaleItem.findFirst.mockResolvedValue({ flashPrice: 20000 });

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('FLASH_SALE');
      expect(price.unitPrice).toBe(20000);
    });

    it('applies a percent product discount when there is no flash sale', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findFirst.mockResolvedValue(null);
      prisma.productDiscount.findFirst.mockResolvedValue({
        discountType: DiscountType.PERCENT,
        discountValue: 10,
      });

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('PRODUCT_DISCOUNT');
      expect(price.unitPrice).toBe(45000);
    });

    it('returns the base price when there are no promotions', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
      prisma.flashSaleItem.findFirst.mockResolvedValue(null);
      prisma.productDiscount.findFirst.mockResolvedValue(null);

      const price = await service.resolvePrice(1);
      expect(price.source).toBe('NONE');
      expect(price.unitPrice).toBe(50000);
    });
  });
});
