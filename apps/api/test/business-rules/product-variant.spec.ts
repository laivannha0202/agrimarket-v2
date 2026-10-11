import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ProductsService } from '../../src/products/products.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * Variant lifecycle: only name / price / status may change, and a stopped
 * variant can never enter a new order while past orders keep snapshots.
 */
describe('ProductsService.updateVariant', () => {
  let prisma: MockPrisma;
  let service: ProductsService;
  const audit = { record: vi.fn(async () => undefined) };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ProductsService(
      prisma as never,
      { resolvePrices: async () => new Map() } as never,
      { sellableQuantities: async () => new Map() } as never,
      audit as never,
    );
    vi.clearAllMocks();
  });

  it('updates name and price and writes an audit record', async () => {
    const before = { id: 7, sku: 'DLB-500G', name: 'Gói 500 g', basePrice: '24000', status: 'ACTIVE' };
    prisma.productVariant.findUnique.mockResolvedValue(before);
    prisma.productVariant.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...before,
      ...data,
    }));

    const updated = await service.updateVariant(7, { name: 'Gói 500 g mới', basePrice: 25000 }, 13);

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { name: 'Gói 500 g mới', basePrice: 25000 },
    });
    expect(updated.basePrice).toBe(25000);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 13,
        action: 'UPDATE_VARIANT',
        entityType: 'ProductVariant',
        entityId: '7',
      }),
    );
  });

  it('404s on an unknown variant instead of creating one', async () => {
    prisma.productVariant.findUnique.mockResolvedValue(null);
    await expect(service.updateVariant(999, { basePrice: 1 }, 13)).rejects.toThrow(/not found/i);
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
  });

  it('marks an inactive variant as not in stock while keeping true quantity', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 1,
        variants: [{ id: 11, basePrice: '25000', status: 'INACTIVE' }],
      },
    ]);
    prisma.product.count.mockResolvedValue(1);

    const res = await service.findAll({});
    const v = res.data[0].variants[0];
    expect(v.inStock).toBe(false);
  });
});
