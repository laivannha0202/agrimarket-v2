import { beforeEach, describe, expect, it } from 'vitest';
import { CategoriesService } from '../../src/categories/categories.service.js';
import { ProductsService } from '../../src/products/products.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

describe('CategoriesService auto-slug', () => {
  let prisma: MockPrisma;
  let service: CategoriesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CategoriesService(prisma as never);
  });

  it('generates a slug from the name when none is given', async () => {
    prisma.category.findUnique.mockResolvedValue(null);
    prisma.category.create.mockImplementation(async ({ data }: { data: { slug: string } }) => data);

    await service.create({ name: 'Rau ăn lá' });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Rau ăn lá', slug: 'rau-an-la', status: undefined },
    });
  });

  it('appends a counter while the generated slug is taken', async () => {
    prisma.category.findUnique
      .mockResolvedValueOnce({ id: 1 }) // rau-an-la taken
      .mockResolvedValueOnce(null); // rau-an-la-2 free
    prisma.category.create.mockImplementation(async ({ data }: { data: { slug: string } }) => data);

    await service.create({ name: 'Rau ăn lá' });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Rau ăn lá', slug: 'rau-an-la-2', status: undefined },
    });
  });

  it('keeps an explicit slug', async () => {
    prisma.category.create.mockImplementation(async ({ data }: { data: { slug: string } }) => data);

    await service.create({ name: 'Rau ăn lá', slug: 'rau-la' });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Rau ăn lá', slug: 'rau-la', status: undefined },
    });
  });
});

describe('ProductsService farm/partner validation', () => {
  let prisma: MockPrisma;
  let service: ProductsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ProductsService(
      prisma as never,
      { resolvePrices: async () => new Map() } as never,
      { sellableQuantities: async () => new Map() } as never,
      { record: async () => undefined } as never,
    );
  });

  it('rejects a farm that belongs to another partner', async () => {
    prisma.farm.findUnique.mockResolvedValue({ partnerId: 99 });
    await expect(
      service.create({ partnerId: 1, categoryId: 1, farmId: 5, name: 'Cà chua' }),
    ).rejects.toThrow(/không thuộc/);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('accepts a farm that belongs to the partner', async () => {
    prisma.farm.findUnique.mockResolvedValue({ partnerId: 1 });
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.product.create.mockResolvedValue({ id: 1 });
    await service.create({ partnerId: 1, categoryId: 1, farmId: 5, name: 'Cà chua' });
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown farm', async () => {
    prisma.farm.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ partnerId: 1, categoryId: 1, farmId: 5, name: 'Cà chua' }),
    ).rejects.toThrow(/không tồn tại/);
  });

  it('allows a product without a farm', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.product.create.mockResolvedValue({ id: 1 });
    await service.create({ partnerId: 1, categoryId: 1, name: 'Cà chua' });
    expect(prisma.farm.findUnique).not.toHaveBeenCalled();
  });

  it('validates the farm on update against the product partner', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 7, partnerId: 1 });
    prisma.farm.findUnique.mockResolvedValue({ partnerId: 99 });
    await expect(service.update(7, { farmId: 5 })).rejects.toThrow(/không thuộc/);
  });
});
