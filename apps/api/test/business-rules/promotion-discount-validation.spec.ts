import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateProductDiscountDto,
  CreateVoucherDto,
} from '../../src/promotions/dto/promotion.dto.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { DiscountType } from '../../generated/prisma/enums.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const STARTS = '2026-01-01T00:00:00.000Z';
const ENDS = '2026-12-31T23:59:59.000Z';

function voucherPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 'TEST50',
    name: 'Test voucher',
    discountType: DiscountType.PERCENT,
    discountValue: 50,
    startsAt: STARTS,
    endsAt: ENDS,
    ...overrides,
  };
}

function discountPayload(overrides: Record<string, unknown> = {}) {
  return {
    productVariantId: 1,
    discountType: DiscountType.PERCENT,
    discountValue: 50,
    startsAt: STARTS,
    endsAt: ENDS,
    ...overrides,
  };
}

async function errorsFor(
  cls: ClassConstructor<object>,
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  const dto = plainToInstance(cls, payload);
  return validate(dto as object, { whitelist: true });
}

function discountValueMessage(errors: ValidationError[]): string {
  const error = errors.find((e) => e.property === 'discountValue');
  expect(error, 'discountValue must have a validation error').toBeDefined();
  return Object.values(error?.constraints ?? {}).join(' | ');
}

describe('P0-A3 — discount value validation (DTO)', () => {
  it.each([0, 50, 100])('accepts PERCENT %i', async (value) => {
    expect(await errorsFor(CreateVoucherDto, voucherPayload({ discountValue: value }))).toEqual([]);
    expect(
      await errorsFor(CreateProductDiscountDto, discountPayload({ discountValue: value })),
    ).toEqual([]);
  });

  it('accepts a FIXED value above 100 (only PERCENT is capped)', async () => {
    expect(
      await errorsFor(
        CreateVoucherDto,
        voucherPayload({ discountType: DiscountType.FIXED, discountValue: 50000 }),
      ),
    ).toEqual([]);
  });

  it.each([101, 1000])('rejects PERCENT %i', async (value) => {
    const voucherErrors = await errorsFor(
      CreateVoucherDto,
      voucherPayload({ discountValue: value }),
    );
    expect(discountValueMessage(voucherErrors)).toMatch(/must not exceed 100/);

    const discountErrors = await errorsFor(
      CreateProductDiscountDto,
      discountPayload({ discountValue: value }),
    );
    expect(discountValueMessage(discountErrors)).toMatch(/must not exceed 100/);
  });

  it.each([-1, -0.01])('rejects negative values (%s)', async (value) => {
    const errors = await errorsFor(
      CreateVoucherDto,
      voucherPayload({ discountValue: value }),
    );
    expect(discountValueMessage(errors)).toMatch(/must not be negative/);
  });

  /**
   * Regression for the broken `@ValidateIf` layout: the condition was false for
   * FIXED, which skipped `@IsNumber` and `@Min` too. These three values all used
   * to pass validation.
   */
  it.each([-5, 'abc', null, undefined, Infinity, NaN])(
    'rejects an invalid FIXED discountValue (%s)',
    async (value) => {
      const errors = await errorsFor(
        CreateVoucherDto,
        voucherPayload({ discountType: DiscountType.FIXED, discountValue: value }),
      );
      expect(discountValueMessage(errors)).toMatch(/finite number|must not be negative/);
    },
  );

  it.each(['50', {}, []])('rejects a non-number PERCENT value (%s)', async (value) => {
    const errors = await errorsFor(
      CreateProductDiscountDto,
      discountPayload({ discountValue: value }),
    );
    expect(discountValueMessage(errors)).toMatch(/finite number/);
  });
});

describe('P0-A3 — discount value validation (service does not trust DTO)', () => {
  let prisma: MockPrisma;
  let service: PromotionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PromotionsService(prisma as never);
  });

  it('rejects PERCENT 101 for a voucher before writing', async () => {
    await expect(
      service.createVoucher(voucherPayload({ discountValue: 101 }) as never),
    ).rejects.toThrow(/must not exceed 100/);
    expect(prisma.voucher.create).not.toHaveBeenCalled();
  });

  it('rejects a negative FIXED voucher before writing', async () => {
    await expect(
      service.createVoucher(
        voucherPayload({ discountType: DiscountType.FIXED, discountValue: -5 }) as never,
      ),
    ).rejects.toThrow(/must not be negative/);
    expect(prisma.voucher.create).not.toHaveBeenCalled();
  });

  it.each([101, -1, '50', Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid product discount (%s) before writing',
    async (value) => {
      await expect(
        service.createProductDiscount(discountPayload({ discountValue: value }) as never),
      ).rejects.toThrow(/discountValue|PERCENT/);
      expect(prisma.productDiscount.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown discount type at the service boundary', async () => {
    await expect(
      service.createProductDiscount(
        discountPayload({ discountType: 'BOGUS', discountValue: 50 }) as never,
      ),
    ).rejects.toThrow(/discountType must be FIXED or PERCENT/);
    expect(prisma.productDiscount.create).not.toHaveBeenCalled();
  });

  it('persists valid boundary values (0 and 100)', async () => {
    prisma.voucher.create.mockResolvedValue({ id: 1 });
    await service.createVoucher(voucherPayload({ discountValue: 0 }) as never);
    await service.createVoucher(voucherPayload({ discountValue: 100 }) as never);
    expect(prisma.voucher.create).toHaveBeenCalledTimes(2);
  });

  it('keeps updates status-only (discount terms cannot be re-priced through PATCH)', async () => {
    prisma.voucher.findUnique.mockResolvedValue({ id: 7, status: 'ACTIVE' });
    prisma.voucher.update.mockResolvedValue({ id: 7, status: 'INACTIVE' });

    await service.updateVoucherStatus(7, 'INACTIVE');

    expect(prisma.voucher.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'INACTIVE' },
    });
  });
});

describe('P0-A3 — price resolution clamps legacy/invalid PERCENT rows', () => {
  let prisma: MockPrisma;
  let service: PromotionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PromotionsService(prisma as never);
    prisma.productVariant.findUnique.mockResolvedValue({ id: 1, basePrice: 50000 });
    prisma.flashSaleItem.findMany.mockResolvedValue([]);
  });

  function activeDiscount(discountType: DiscountType, discountValue: unknown) {
    prisma.productDiscount.findFirst.mockResolvedValue({ discountType, discountValue });
  }

  it('applies 0%, 50% and 100% exactly', async () => {
    activeDiscount(DiscountType.PERCENT, 0);
    expect((await service.resolvePrice(1)).unitPrice).toBe(50000);
    expect((await service.resolvePrice(1)).discountAmount).toBe(0);

    activeDiscount(DiscountType.PERCENT, 50);
    expect((await service.resolvePrice(1)).unitPrice).toBe(25000);
    expect((await service.resolvePrice(1)).discountAmount).toBe(25000);

    activeDiscount(DiscountType.PERCENT, 100);
    expect((await service.resolvePrice(1)).unitPrice).toBe(0);
    expect((await service.resolvePrice(1)).discountAmount).toBe(50000);
  });

  it('treats a legacy PERCENT 200 row as 100%, never a negative price', async () => {
    activeDiscount(DiscountType.PERCENT, 200);
    const price = await service.resolvePrice(1);
    expect(price.unitPrice).toBe(0);
    expect(price.discountAmount).toBe(50000);
    expect(price.unitPrice).toBeGreaterThanOrEqual(0);
  });

  it('ignores a legacy negative discount instead of increasing the price', async () => {
    activeDiscount(DiscountType.PERCENT, -20);
    const percent = await service.resolvePrice(1);
    expect(percent.unitPrice).toBe(50000);

    activeDiscount(DiscountType.FIXED, -5000);
    const fixed = await service.resolvePrice(1);
    expect(fixed.unitPrice).toBe(50000);
    expect(fixed.discountAmount).toBe(0);
  });

  it('caps FIXED at the base price', async () => {
    activeDiscount(DiscountType.FIXED, 80000);
    const price = await service.resolvePrice(1);
    expect(price.unitPrice).toBe(0);
    expect(price.discountAmount).toBe(50000);
  });

  it('clamps the customer-aware checkout path and the batch path too', async () => {
    activeDiscount(DiscountType.PERCENT, 200);
    const checkoutPrice = await service.resolvePriceForCustomer(1, 9, 1);
    expect(checkoutPrice.unitPrice).toBe(0);

    prisma.productDiscount.findMany.mockResolvedValue([
      { productVariantId: 1, discountType: DiscountType.PERCENT, discountValue: 200 },
    ]);
    prisma.productVariant.findMany.mockResolvedValue([{ id: 1, basePrice: 50000 }]);
    const batch = await service.resolvePrices([1]);
    expect(batch.get(1)?.unitPrice).toBe(0);
  });

  it('caps a 100%+ voucher at the subtotal, never below zero', async () => {
    const base = {
      id: 1,
      code: 'X',
      status: 'ACTIVE',
      minOrderAmount: 0,
      maxDiscount: null,
      usageLimit: null,
      perCustomerLimit: null,
      usedCount: 0,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2026-12-31T00:00:00Z'),
    };

    prisma.voucher.findUnique.mockResolvedValue({
      ...base,
      discountType: DiscountType.PERCENT,
      discountValue: 100,
    });
    expect((await service.applyVoucher('X', 1, 50000, NOW)).discountAmount).toBe(50000);

    prisma.voucher.findUnique.mockResolvedValue({
      ...base,
      discountType: DiscountType.PERCENT,
      discountValue: 200,
    });
    expect((await service.applyVoucher('X', 1, 50000, NOW)).discountAmount).toBe(50000);

    prisma.voucher.findUnique.mockResolvedValue({
      ...base,
      discountType: DiscountType.FIXED,
      discountValue: -5000,
    });
    expect((await service.applyVoucher('X', 1, 50000, NOW)).discountAmount).toBe(0);
  });
});
