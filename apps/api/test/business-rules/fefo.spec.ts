import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

const now = new Date('2026-04-15T00:00:00.000Z');

function balanceRow(overrides: Record<string, unknown>) {
  return {
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
      expiresAt: new Date('2030-05-01T00:00:00.000Z'),
      status: 'SELLABLE',
      qcInspections: [{ result: 'PASS', inspectedAt: now }],
    },
    ...overrides,
  };
}

describe('FEFO allocation', () => {
  let prisma: MockPrisma;
  let service: InventoryService;

  beforeEach(() => {
    prisma = createMockPrisma();
    const audit = { record: async () => undefined };
    service = new InventoryService(prisma as never, audit as never);
  });

  it('picks the lot with the earliest expiry first', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow({
        id: 1,
        productLotId: 1,
        onHand: 50,
        productLot: {
          id: 1,
          expiresAt: new Date('2030-06-01T00:00:00.000Z'),
          status: 'SELLABLE',
          qcInspections: [{ result: 'PASS', inspectedAt: now }],
        },
      }),
      balanceRow({
        id: 2,
        productLotId: 2,
        onHand: 50,
        productLot: {
          id: 2,
          expiresAt: new Date('2030-05-01T00:00:00.000Z'),
          status: 'SELLABLE',
          qcInspections: [{ result: 'PASS', inspectedAt: now }],
        },
      }),
    ]);

    const chosen = await service.allocateFefo(prisma as never, {
      productVariantId: 1,
      quantity: 60,
    });

    expect(chosen).toHaveLength(2);
    expect(chosen[0].productLotId).toBe(2); // earliest expiry
    expect(chosen[0].available).toBe(50);
    expect(chosen[1].productLotId).toBe(1);
    expect(chosen[1].available).toBe(10);
  });

  it('skips lots that are not SELLABLE', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow({
        id: 1,
        productLotId: 1,
        onHand: 100,
        productLot: {
          id: 1,
          expiresAt: new Date('2030-05-01T00:00:00.000Z'),
          status: 'QUARANTINED',
          qcInspections: [{ result: 'PASS', inspectedAt: now }],
        },
      }),
    ]);

    await expect(
      service.allocateFefo(prisma as never, { productVariantId: 1, quantity: 10 }),
    ).rejects.toThrow(/Insufficient sellable stock/);
  });

  it('skips lots whose latest QC did not pass', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow({
        id: 1,
        productLotId: 1,
        onHand: 100,
        productLot: {
          id: 1,
          expiresAt: new Date('2030-05-01T00:00:00.000Z'),
          status: 'SELLABLE',
          qcInspections: [{ result: 'FAIL', inspectedAt: now }],
        },
      }),
    ]);

    await expect(
      service.allocateFefo(prisma as never, { productVariantId: 1, quantity: 10 }),
    ).rejects.toThrow(/Insufficient sellable stock/);
  });

  it('skips lots with no QC inspection at all', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow({
        id: 1,
        productLotId: 1,
        onHand: 100,
        productLot: {
          id: 1,
          expiresAt: new Date('2030-05-01T00:00:00.000Z'),
          status: 'SELLABLE',
          qcInspections: [],
        },
      }),
    ]);

    await expect(
      service.allocateFefo(prisma as never, { productVariantId: 1, quantity: 10 }),
    ).rejects.toThrow(/Insufficient sellable stock/);
  });

  it('skips lots with no available stock', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow({
        id: 1,
        productLotId: 1,
        onHand: 50,
        reserved: 50,
        productLot: {
          id: 1,
          expiresAt: new Date('2030-05-01T00:00:00.000Z'),
          status: 'SELLABLE',
          qcInspections: [{ result: 'PASS', inspectedAt: now }],
        },
      }),
    ]);

    await expect(
      service.allocateFefo(prisma as never, { productVariantId: 1, quantity: 10 }),
    ).rejects.toThrow(/Insufficient sellable stock/);
  });

  it('throws when total available is less than requested', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow({
        id: 1,
        productLotId: 1,
        onHand: 5,
        productLot: {
          id: 1,
          expiresAt: new Date('2030-05-01T00:00:00.000Z'),
          status: 'SELLABLE',
          qcInspections: [{ result: 'PASS', inspectedAt: now }],
        },
      }),
    ]);

    await expect(
      service.allocateFefo(prisma as never, { productVariantId: 1, quantity: 10 }),
    ).rejects.toThrow(/short by 5/);
  });
});
