import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementsService } from '../../src/finance/settlements.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { PartnerOrderStatus } from '../../generated/prisma/enums.js';

describe('Settlement formula', () => {
  let prisma: MockPrisma;
  let service: SettlementsService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SettlementsService(prisma as never, audit as never);
  });

  it('computes gross - refund - commission + adjustment = payable', async () => {
    prisma.partnerOrder.findMany.mockResolvedValue([
      {
        id: 1,
        partnerId: 1,
        subtotal: 100000,
        discountTotal: 0,
        commissionAmount: 5000,
        payableAmount: 95000,
        status: PartnerOrderStatus.DELIVERED,
      },
      {
        id: 2,
        partnerId: 1,
        subtotal: 200000,
        discountTotal: 20000,
        commissionAmount: 9000,
        payableAmount: 171000,
        status: PartnerOrderStatus.DELIVERED,
      },
    ]);
    prisma.settlement.count.mockResolvedValue(0);
    prisma.settlement.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 1,
      ...data,
    }));

    const settlement = await service.create(
      {
        partnerId: 1,
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.000Z',
        adjustmentAmount: 1000,
      },
      99,
    );

    // gross = 100000 + (200000 - 20000) = 280000
    // commission = 5000 + 9000 = 14000
    // payable = 280000 - 0 - 14000 + 1000 = 267000
    expect(Number(settlement.grossAmount)).toBe(280000);
    expect(Number(settlement.commissionAmount)).toBe(14000);
    expect(Number(settlement.payableAmount)).toBe(267000);
  });

  it('rejects an invalid period', async () => {
    await expect(
      service.create(
        {
          partnerId: 1,
          periodStart: '2026-04-30T00:00:00.000Z',
          periodEnd: '2026-04-01T00:00:00.000Z',
        },
        99,
      ),
    ).rejects.toThrow(/periodEnd must be after periodStart/);
  });
});
