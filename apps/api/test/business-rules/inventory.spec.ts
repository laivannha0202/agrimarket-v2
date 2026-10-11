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
      // `reserveStock` claims the reservation with a conditional UPDATE and
      // then reads the row back for the movement ledger. The mock reports the
      // post-update state (reserved went 0 -> 20).
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
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
      // The reservation is a conditional UPDATE, not a read-then-write.
      expect(prisma.$executeRaw).toHaveBeenCalled();
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

    it('rejects when the conditional claim loses the race (0 rows)', async () => {
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
      // The friendly pre-check passed, but by the time the atomic UPDATE ran a
      // concurrent checkout had taken the stock, so it matched 0 rows.
      prisma.$executeRaw.mockResolvedValue(0);

      const { service } = makeService(prisma);
      await expect(
        service.reserve({ warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 20 }, 1),
      ).rejects.toThrow(/not enough stock is available/);
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
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
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
      // `reserved = GREATEST(reserved - ?, 0)` runs in the database so a
      // concurrent checkout's reservation is never dropped.
      expect(prisma.$executeRaw).toHaveBeenCalled();
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

  describe('quarantineStock', () => {
    it('moves reserved units into blocked without changing available', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      // After the statement: reserved dropped by 3, blocked rose by 3.
      prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 7,
        blocked: 3,
        unit: 'kg',
      });

      const { service } = makeService(prisma);
      const result = await service.quarantineStock(prisma as never, 1, 3);

      expect(result).not.toBeNull();
      // reserved went 10 -> 7; before/after are the reserved values.
      expect(result?.before).toBe(10);
      expect(result?.after).toBe(7);
      expect(result?.blocked).toBe(3);
      // available = 100 - 7 - 3 = 90, unchanged from 100 - 10 - 0.
      expect(InventoryService.available(100, result?.after ?? 0, result?.blocked ?? 0)).toBe(90);
      // One atomic statement, never a read-then-write.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('refuses to quarantine more than is reserved (guard matches 0 rows)', async () => {
      // reserved (2) < quantity (5): the guarded UPDATE's `reserved >= ?`
      // predicate matches no row, so the service returns null instead of
      // manufacturing blocked stock out of a reservation the balance never had.
      prisma.$executeRaw.mockResolvedValue(0);

      const { service } = makeService(prisma);
      const result = await service.quarantineStock(prisma as never, 1, 5);

      expect(result).toBeNull();
      // The row is never re-read and no blocked stock is invented.
      expect(prisma.inventoryBalance.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('guards the move with `reserved >= quantity` in one statement', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 5,
        blocked: 5,
        unit: 'kg',
      });

      const { service } = makeService(prisma);
      const result = await service.quarantineStock(prisma as never, 1, 5);

      expect(result?.before).toBe(10);
      expect(result?.after).toBe(5);
      expect(result?.blocked).toBe(5);
      // Exactly one statement performs both the guard and the move, so a
      // concurrent reservation cannot be silently clobbered.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    });
  });

  describe('consumeStock (goods leaving the warehouse)', () => {
    it('drops both on_hand and reserved in one guarded statement', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      // After the statement: on_hand 100 -> 95, reserved 10 -> 5.
      prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 95,
        reserved: 5,
        blocked: 0,
        unit: 'kg',
      });

      const { service } = makeService(prisma);
      const result = await service.consumeStock(prisma as never, 1, 5);

      expect(result).not.toBeNull();
      expect(result?.before).toBe(100);
      expect(result?.after).toBe(95);
      // One atomic statement performs the guard and both subtractions.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('returns null when the reservation is gone (guard matches 0 rows)', async () => {
      prisma.$executeRaw.mockResolvedValue(0);

      const { service } = makeService(prisma);
      const result = await service.consumeStock(prisma as never, 1, 5);

      expect(result).toBeNull();
      // The row is never re-read: no movement may be fabricated.
      expect(prisma.inventoryBalance.findUniqueOrThrow).not.toHaveBeenCalled();
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
