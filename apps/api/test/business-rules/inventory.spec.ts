import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

function makeService(prisma: MockPrisma) {
  const audit = { record: vi.fn(async () => undefined) };
  return { service: new InventoryService(prisma as never, audit as never), audit };
}

describe('Inventory rules', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('available = onHand - reserved - blocked', () => {
    it('computes available stock', () => {
      expect(InventoryService.available(100, 30, 10)).toBe(60);
    });

    it('can be zero', () => {
      expect(InventoryService.available(50, 50, 0)).toBe(0);
    });
  });

  describe('reserve', () => {
    it('reserves when enough is available', async () => {
      prisma.inventoryBalance.findUnique.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      });
      prisma.inventoryBalance.update.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 20,
        blocked: 0,
        unit: 'kg',
      });
      prisma.inventoryMovement.create.mockResolvedValue({});

      const { service } = makeService(prisma);
      const result = await service.reserve(
        { warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 20 },
        1,
      );

      expect(result.available).toBe('80.000');
      expect(prisma.inventoryBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reserved: 20 } }),
      );
    });

    it('rejects reserving more than available', async () => {
      prisma.inventoryBalance.findUnique.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 10,
        reserved: 5,
        blocked: 3,
        unit: 'kg',
      });

      const { service } = makeService(prisma);
      await expect(
        service.reserve({ warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 5 }, 1),
      ).rejects.toThrow(/only 2 available/);
    });
  });

  describe('release', () => {
    it('releases a reservation', async () => {
      prisma.inventoryBalance.findUnique.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 20,
        blocked: 0,
        unit: 'kg',
      });
      prisma.inventoryBalance.update.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 5,
        blocked: 0,
        unit: 'kg',
      });
      prisma.inventoryMovement.create.mockResolvedValue({});

      const { service } = makeService(prisma);
      const result = await service.release(
        { warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 15 },
        1,
      );
      expect(result.available).toBe('95.000');
    });

    it('rejects releasing more than reserved', async () => {
      prisma.inventoryBalance.findUnique.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 5,
        blocked: 0,
        unit: 'kg',
      });

      const { service } = makeService(prisma);
      await expect(
        service.release({ warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 10 }, 1),
      ).rejects.toThrow(/more than currently reserved/);
    });
  });

  describe('adjust', () => {
    it('rejects an adjustment that would make stock negative', async () => {
      prisma.inventoryBalance.findUnique.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 5,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      });

      const { service } = makeService(prisma);
      await expect(
        service.adjust(
          { warehouseId: 1, productLotId: 1, productVariantId: 1, quantityDelta: -10 },
          1,
        ),
      ).rejects.toThrow(/negative/);
    });
  });
});
