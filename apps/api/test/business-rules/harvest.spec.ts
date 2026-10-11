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
    // The harvest comes with its season/farm, and the product belongs to the
    // same partner — the partner-consistency check passes for these tests.
    prisma.harvest.findUnique.mockResolvedValue({
      id: 1,
      quantity: 1000,
      harvestDate: new Date(),
      season: { farmId: 10, farm: { partnerId: 1 } },
    } as never);
    prisma.product.findUnique.mockResolvedValue({
      id: 1,
      farmId: 10,
      partnerId: 1,
    } as never);
    // `createLotWithSequence` locks the harvest row and re-reads its quantity.
    prisma.$queryRaw.mockResolvedValue([{ id: 1, quantity: 1000, harvest_date: new Date() }]);
  });

  it('rejects a lot that would exceed the harvest quantity', async () => {
    // 950 already allocated.
    prisma.productLot.aggregate.mockResolvedValue({ _sum: { quantity: 950 } });
    // The sequence is generated before the check, so it needs the code list.
    prisma.productLot.findMany.mockResolvedValue([]);

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
    prisma.productLot.aggregate.mockResolvedValue({ _sum: { quantity: 900 } });
    // The next LOT code comes from the highest existing code of the day.
    prisma.productLot.findMany.mockResolvedValue([]);
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

  it('rejects a product that belongs to a different farm and partner', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 2, farmId: 99, partnerId: 77 } as never);

    await expect(
      lots.create({
        productId: 2,
        harvestId: 1,
        quantity: 10,
        unit: 'kg',
        grade: 'Loại 1',
        expiresAt: '2026-05-01',
      }),
    ).rejects.toThrow(/same farm \(or at least the same partner\)/);
  });

  it('accepts a product with no farm when the partner matches', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 3, farmId: null, partnerId: 1 } as never);
    prisma.productLot.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    prisma.productLot.findMany.mockResolvedValue([]);
    prisma.productLot.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    prisma.traceEvent.create.mockResolvedValue({});

    const lot = await lots.create({
      productId: 3,
      harvestId: 1,
      quantity: 10,
      unit: 'kg',
      grade: 'Loại 1',
      expiresAt: '2026-05-01',
    });

    expect(lot).toBeDefined();
  });
});
