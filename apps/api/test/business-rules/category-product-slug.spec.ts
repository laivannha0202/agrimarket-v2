import { beforeEach, describe, expect, it } from 'vitest';
import { CategoriesService } from '../../src/categories/categories.service.js';
import { ProductsService } from '../../src/products/products.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { PartnerVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';

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
    prisma.partner.findUnique.mockResolvedValue({
      status: RecordStatus.ACTIVE,
      verificationStatus: PartnerVerificationStatus.VERIFIED,
    });
    prisma.product.findUnique.mockResolvedValue(null);
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
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('checks farm ownership after acquiring the Farm lock', async () => {
    prisma.farm.findUnique.mockResolvedValue({ partnerId: 99 });

    await expect(
      service.create({ partnerId: 1, categoryId: 1, farmId: 5, name: 'Cà chua' }),
    ).rejects.toThrow(/không thuộc/);

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.farm.findUnique).toHaveBeenCalledOnce();
    expect(prisma.product.create).not.toHaveBeenCalled();
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

  it('does not publish a product for an inactive partner', async () => {
    prisma.partner.findUnique.mockResolvedValue({
      status: RecordStatus.INACTIVE,
      verificationStatus: PartnerVerificationStatus.VERIFIED,
    });
    await expect(service.create({ partnerId: 1, categoryId: 1, name: 'Cà chua' }))
      .rejects.toThrow(/phải được xác minh/);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('does not publish a product for an active but unverified partner', async () => {
    prisma.partner.findUnique.mockResolvedValue({
      status: RecordStatus.ACTIVE,
      verificationStatus: PartnerVerificationStatus.PENDING,
    });
    await expect(service.create({ partnerId: 1, categoryId: 1, name: 'Cà chua' }))
      .rejects.toThrow(/phải được xác minh/);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('allows an inactive draft product for a partner awaiting approval', async () => {
    prisma.partner.findUnique.mockResolvedValue({ status: RecordStatus.INACTIVE });
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.product.create.mockResolvedValue({ id: 1 });
    await service.create({ partnerId: 1, categoryId: 1, name: 'Cà chua', status: RecordStatus.INACTIVE });
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
  });

  it('validates the farm on update against the product partner', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 7, partnerId: 1 });
    prisma.farm.findUnique.mockResolvedValue({ partnerId: 99 });
    await expect(service.update(7, { farmId: 5 })).rejects.toThrow(/không thuộc/);
  });

  it('does not reactivate a product while its partner is inactive', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 7, partnerId: 1 });
    prisma.partner.findUnique.mockResolvedValue({
      status: RecordStatus.INACTIVE,
      verificationStatus: PartnerVerificationStatus.VERIFIED,
    });
    await expect(service.update(7, { status: RecordStatus.ACTIVE })).rejects.toThrow(/phải được xác minh/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('reactivates an existing product transactionally for a verified active partner', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 7, partnerId: 1 });
    prisma.product.update.mockResolvedValue({ id: 7, status: RecordStatus.ACTIVE });

    await expect(service.update(7, { status: RecordStatus.ACTIVE }))
      .resolves.toMatchObject({ id: 7, status: RecordStatus.ACTIVE });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.product.update).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.product.update.mock.invocationCallOrder[0],
    );
  });

  it('creates a published product transactionally and locks the Partner before insertion', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.product.create.mockResolvedValue({ id: 8 });
    await service.create({ partnerId: 1, categoryId: 1, name: 'Rau sạch' });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.product.create).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.product.create.mock.invocationCallOrder[0],
    );
  });

  it('propagates Product insert failures from the transaction', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.product.create.mockRejectedValue(new Error('insert failed'));

    await expect(service.create({ partnerId: 1, categoryId: 1, name: 'Rau sạch' }))
      .rejects.toThrow('insert failed');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.product.create).toHaveBeenCalledOnce();
  });
});
