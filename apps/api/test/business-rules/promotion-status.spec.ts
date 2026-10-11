import { beforeEach, describe, expect, it } from 'vitest';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { CommissionService } from '../../src/finance/commission.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * Status-only PATCH endpoints added so create-only promotion/finance domains
 * can be deactivated from the admin. Each one must: load the row (404 when
 * missing), change ONLY the status, and return the updated row.
 */
describe('PromotionsService status updates', () => {
  let prisma: MockPrisma;
  let service: PromotionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PromotionsService(prisma as never);
  });

  it('deactivates a voucher', async () => {
    prisma.voucher.findUnique.mockResolvedValue({ id: 1, status: 'ACTIVE' });
    prisma.voucher.update.mockResolvedValue({ id: 1, status: 'INACTIVE' });
    const res = await service.updateVoucherStatus(1, 'INACTIVE');
    expect(res).toEqual({ id: 1, status: 'INACTIVE' });
    expect(prisma.voucher.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'INACTIVE' },
    });
  });

  it('404s for a missing voucher', async () => {
    prisma.voucher.findUnique.mockResolvedValue(null);
    await expect(service.updateVoucherStatus(99, 'INACTIVE')).rejects.toThrow(/not found/i);
  });

  it('deactivates a product discount', async () => {
    prisma.productDiscount.findUnique.mockResolvedValue({ id: 2, status: 'ACTIVE' });
    prisma.productDiscount.update.mockResolvedValue({ id: 2, status: 'INACTIVE' });
    const res = await service.updateProductDiscountStatus(2, 'INACTIVE');
    expect(res).toEqual({ id: 2, status: 'INACTIVE' });
  });

  it('404s for a missing product discount', async () => {
    prisma.productDiscount.findUnique.mockResolvedValue(null);
    await expect(service.updateProductDiscountStatus(99, 'INACTIVE')).rejects.toThrow(/not found/i);
  });

  it('deactivates a flash sale (the safe stop for a running program)', async () => {
    prisma.flashSale.findUnique.mockResolvedValue({ id: 3, status: 'ACTIVE' });
    prisma.flashSale.update.mockResolvedValue({ id: 3, status: 'INACTIVE' });
    const res = await service.updateFlashSaleStatus(3, 'INACTIVE');
    expect(res).toEqual({ id: 3, status: 'INACTIVE' });
  });

  it('404s for a missing flash sale', async () => {
    prisma.flashSale.findUnique.mockResolvedValue(null);
    await expect(service.updateFlashSaleStatus(99, 'INACTIVE')).rejects.toThrow(/not found/i);
  });
});

describe('CommissionService rule status updates', () => {
  let prisma: MockPrisma;
  let service: CommissionService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CommissionService(prisma as never);
  });

  it('deactivates a commission rule without touching the rate', async () => {
    prisma.commissionRule.findUnique.mockResolvedValue({ id: 1, ratePercent: 5 });
    prisma.commissionRule.update.mockResolvedValue({ id: 1, status: 'INACTIVE' });
    const res = await service.updateRuleStatus(1, 'INACTIVE');
    expect(res).toEqual({ id: 1, status: 'INACTIVE' });
    const arg = prisma.commissionRule.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data).toEqual({ status: 'INACTIVE' });
  });

  it('404s for a missing rule', async () => {
    prisma.commissionRule.findUnique.mockResolvedValue(null);
    await expect(service.updateRuleStatus(99, 'INACTIVE')).rejects.toThrow(/not found/i);
  });
});
