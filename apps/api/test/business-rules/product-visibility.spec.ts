import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProductsService } from '../../src/products/products.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { RecordStatus } from '../../generated/prisma/enums.js';

/**
 * Public catalogue visibility (C-11).
 *
 * The public list and detail endpoints always pin `status = ACTIVE`; an
 * anonymous caller cannot widen the filter by passing `status=INACTIVE`, and an
 * inactive product's detail is indistinguishable from a missing one (404).
 * The admin routes keep the unfiltered behaviour.
 */
describe('Product public visibility', () => {
  let prisma: MockPrisma;
  let service: ProductsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ProductsService(
      prisma as never,
      { resolvePrices: async () => new Map() } as never,
      { sellableQuantities: async () => new Map() } as never,
      { record: vi.fn(async () => undefined) } as never,
    );
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);
  });

  it('pins the public list to ACTIVE even when status=INACTIVE is requested', async () => {
    await service.findAll({ status: RecordStatus.INACTIVE }, { onlyActive: true });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RecordStatus.ACTIVE }),
      }),
    );
  });

  it('keeps the admin status filter when onlyActive is not set', async () => {
    await service.findAll({ status: RecordStatus.INACTIVE });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RecordStatus.INACTIVE }),
      }),
    );
  });

  it('404s a public detail request for an inactive product', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.findOne(7, { onlyActive: true })).rejects.toThrow(
      /Product not found/,
    );
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7, status: RecordStatus.ACTIVE },
      }),
    );
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('lets the admin detail route open an inactive product', async () => {
    const inactive = {
      id: 7,
      status: RecordStatus.INACTIVE,
      variants: [],
    };
    prisma.product.findUnique.mockResolvedValue(inactive);

    const product = await service.findOne(7);

    expect(product.id).toBe(7);
    expect(prisma.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
  });
});
