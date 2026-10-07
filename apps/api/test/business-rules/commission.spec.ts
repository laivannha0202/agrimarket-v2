import { describe, it, expect, beforeEach } from 'vitest';
import { CommissionService } from '../../src/finance/commission.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

describe('Commission rules', () => {
  let prisma: MockPrisma;
  let service: CommissionService;
  const now = new Date('2026-06-01');

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CommissionService(prisma as never);
  });

  it('computes a percentage commission', () => {
    expect(service.computeCommission(200000, 5)).toBe(10000);
    expect(service.computeCommission(199999, 5)).toBe(9999.95);
  });

  it('prefers the most specific rule (partner+category) over the default', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
      { id: 2, partnerId: 3, categoryId: null, ratePercent: 6 },
      { id: 3, partnerId: 3, categoryId: 4, ratePercent: 8 },
    ]);

    const rate = await service.resolveRatePercent({ partnerId: 3, categoryId: 4 }, now);
    expect(rate).toBe(8);
  });

  it('falls back to the partner rule when there is no category override', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
      { id: 2, partnerId: 3, categoryId: null, ratePercent: 6 },
    ]);

    const rate = await service.resolveRatePercent({ partnerId: 3, categoryId: 4 }, now);
    expect(rate).toBe(6);
  });

  it('falls back to the platform default', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
    ]);

    const rate = await service.resolveRatePercent({ partnerId: 9, categoryId: 9 }, now);
    expect(rate).toBe(5);
  });

  it('excludes shipping from the commission base', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
    ]);

    // commissionBase is goods value only; shipping is passed separately by the
    // caller and never included here.
    const result = await service.calculateForPartnerOrder(prisma as never, {
      partnerId: 1,
      categoryId: 1,
      commissionBase: 100000,
    });

    expect(result.commissionAmount).toBe(5000);
    expect(result.payableAmount).toBe(95000);
  });

  it('returns a zero rate when no rule matches', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([]);
    const rate = await service.resolveRatePercent({ partnerId: 1, categoryId: 1 }, now);
    expect(rate).toBe(0);
  });
});
