import { describe, it, expect, beforeEach } from 'vitest';
import { LotsService } from '../../src/lots/lots.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

describe('Harvest invariants', () => {
  let prisma: MockPrisma;
  let lots: LotsService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    lots = new LotsService(prisma as never, audit as never);
  });

  it('rejects a lot that would exceed the harvest quantity', async () => {
    prisma.harvest.findUnique.mockResolvedValue({ id: 1, quantity: 1000, harvestDate: new Date() });
    // 950 already allocated.
    prisma.productLot.aggregate.mockResolvedValue({ _sum: { quantity: 950 } });

    await expect(
      lots.create({
        productId: 1,
        harvestId: 1,
        quantity: 100, // 950 + 100 = 1050 > 1000
        unit: 'kg',
        grade: 'Loại 1',
        expiresAt: '2026-05-01',
      }),
    ).rejects.toThrow(/exceed harvest quantity/);
  });

  it('allows a lot that fits exactly within the harvest quantity', async () => {
    prisma.harvest.findUnique.mockResolvedValue({ id: 1, quantity: 1000, harvestDate: new Date() });
    prisma.productLot.aggregate.mockResolvedValue({ _sum: { quantity: 900 } });
    prisma.productLot.count.mockResolvedValue(0);
    prisma.productLot.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    prisma.traceEvent.create.mockResolvedValue({});

    const lot = await lots.create({
      productId: 1,
      harvestId: 1,
      quantity: 100, // 900 + 100 = 1000 exactly
      unit: 'kg',
      grade: 'Loại 1',
      expiresAt: '2026-05-01',
    });

    expect(lot).toBeDefined();
  });

  it('rejects a lot when the harvest does not exist', async () => {
    prisma.harvest.findUnique.mockResolvedValue(null);

    await expect(
      lots.create({
        productId: 1,
        harvestId: 999,
        quantity: 10,
        unit: 'kg',
        grade: 'Loại 1',
        expiresAt: '2026-05-01',
      }),
    ).rejects.toThrow(/Harvest not found/);
  });
});
