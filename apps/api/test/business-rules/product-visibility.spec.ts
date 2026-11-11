import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ProductsController } from '../../src/products/products.controller.js';
import { ProductsService } from '../../src/products/products.service.js';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator.js';
import { OptionalJwtAuthGuard } from '../../src/evidence/optional-jwt-auth.guard.js';
import type { AuthenticatedUser } from '../../src/common/interfaces/authenticated-user.interface.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  PartnerVerificationStatus,
  RecordStatus,
} from '../../generated/prisma/enums.js';

/**
 * Public catalogue visibility (C-11, partner-state gate).
 *
 * A product is public only while BOTH gates hold: the Product is ACTIVE AND its
 * selling Partner is ACTIVE and VERIFIED. Partner PENDING / REJECTED / INACTIVE
 * therefore hides every product of that partner — including an ACTIVE one —
 * from the list, the search and the direct detail read (404, indistinguishable
 * from a missing product whether reached by ID or slug). Request filters can
 * never widen the set, pagination `total` shares the identical `where` as the
 * page data, and ADMIN keeps the unfiltered management view. Nothing is ever
 * auto-mutated: hiding is a read-time filter, not a status change.
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

  const admin: AuthenticatedUser = {
    id: 1,
    email: 'admin@example.test',
    role: 'ADMIN',
    fullName: 'Admin',
  };

  const customer: AuthenticatedUser = {
    id: 2,
    email: 'customer@example.test',
    role: 'CUSTOMER',
    fullName: 'Customer',
  };

  /** The one `where` the public list/detail must pin for non-ADMIN viewers. */
  const publicVisibility = {
    status: RecordStatus.ACTIVE,
    partner: {
      is: {
        status: RecordStatus.ACTIVE,
        verificationStatus: PartnerVerificationStatus.VERIFIED,
      },
    },
  };

  const activeProduct = {
    id: 7,
    status: RecordStatus.ACTIVE,
    partnerId: 3,
    variants: [],
  };

  const hiddenProduct = {
    id: 7,
    status: RecordStatus.INACTIVE,
    partnerId: 3,
    variants: [],
  };

  it('publishes an ACTIVE product of an ACTIVE + VERIFIED partner to guests and CUSTOMERs', async () => {
    for (const viewer of [undefined, customer]) {
      prisma.product.findMany.mockResolvedValue([activeProduct]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findAll({}, viewer);

      expect(prisma.product.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: publicVisibility }),
      );
      expect(result.data).toEqual([activeProduct]);
      expect(result.meta.total).toBe(1);

      prisma.product.findFirst.mockResolvedValue(activeProduct);
      await expect(service.findOne(7, viewer)).resolves.toMatchObject({ id: 7 });

      // Reset the mocks so the next viewer starts clean.
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findFirst.mockResolvedValue(null);
    }
  });

  it.each([
    PartnerVerificationStatus.PENDING,
    PartnerVerificationStatus.REJECTED,
  ] as const)(
    'hides every product while its partner verification status is %s',
    async (_state) => {
      // The gate is a single VERIFIED-only predicate: every non-verified state
      // resolves to the same blocked `where`.
      for (const viewer of [undefined, customer]) {
        await service.findAll({}, viewer);
        expect(prisma.product.findMany).toHaveBeenLastCalledWith(
          expect.objectContaining({ where: publicVisibility }),
        );
      }
    },
  );

  it('hides the products of an INACTIVE partner (verified or not)', async () => {
    for (const viewer of [undefined, customer]) {
      await service.findAll({}, viewer);
      expect(prisma.product.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: RecordStatus.ACTIVE,
            partner: {
              is: {
                status: RecordStatus.ACTIVE,
                verificationStatus: PartnerVerificationStatus.VERIFIED,
              },
            },
          }),
        }),
      );
    }
  });

  it('does not publish an INACTIVE product, whatever the partner state', async () => {
    for (const viewer of [undefined, customer]) {
      await service.findAll({}, viewer);
      expect(prisma.product.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: RecordStatus.ACTIVE }),
        }),
      );
    }
  });

  it('keeps the public list pinned when a status filter is requested', async () => {
    for (const viewer of [undefined, customer]) {
      await service.findAll({ status: RecordStatus.INACTIVE }, viewer);
      expect(prisma.product.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: publicVisibility }),
      );
      expect(prisma.product.count).toHaveBeenLastCalledWith({
        where: publicVisibility,
      });
    }
  });

  it('lets partner/category filters only narrow the public catalogue', async () => {
    await service.findAll({ categoryId: 4, partnerId: 3 }, customer);

    expect(prisma.product.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { ...publicVisibility, categoryId: 4, partnerId: 3 },
      }),
    );
  });

  it('404s a direct detail request for a product outside public visibility (by ID or slug)', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.product.findUnique.mockResolvedValue(null);

    for (const viewer of [undefined, customer]) {
      await expect(service.findOne(7, viewer)).rejects.toThrow(/Product not found/);
      expect(prisma.product.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id: 7, ...publicVisibility } }),
      );
      // The unfiltered read is never used for a public viewer, so the gate
      // holds at the storage layer, not just at rendering time.
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    }
  });

  it('lets ADMIN keep listing plus filtering every status without the partner gate', async () => {
    prisma.product.findMany.mockResolvedValue([hiddenProduct]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.findAll({ status: RecordStatus.INACTIVE }, admin);

    expect(prisma.product.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: RecordStatus.INACTIVE },
      }),
    );
    expect(prisma.product.count).toHaveBeenLastCalledWith({
      where: { status: RecordStatus.INACTIVE },
    });
    expect(result.data).toEqual([hiddenProduct]);

    // A plain ADMIN list call has no partner predicate at all.
    await service.findAll({}, admin);
    expect(prisma.product.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ partner: expect.anything() }),
      }),
    );
  });

  it('lets ADMIN open a hidden product by ID for management', async () => {
    prisma.product.findUnique.mockResolvedValue(hiddenProduct);

    await expect(service.findOne(7, admin)).resolves.toMatchObject({
      id: 7,
      status: RecordStatus.INACTIVE,
    });
    expect(prisma.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('uses the identical visibility filter for page data and total count', async () => {
    prisma.product.count.mockResolvedValue(3);

    const result = await service.findAll(
      {
        page: 2,
        limit: 1,
        status: RecordStatus.INACTIVE,
        categoryId: 4,
        partnerId: 3,
        search: '  Cà chua  ',
      },
      customer,
    );

    const where = {
      ...publicVisibility,
      categoryId: 4,
      partnerId: 3,
      OR: [
        { name: { contains: 'Cà chua' } },
        { slug: { contains: 'Cà chua' } },
        { variants: { some: { sku: { contains: 'Cà chua' } } } },
      ],
    };
    expect(prisma.product.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where, skip: 1, take: 1 }),
    );
    expect(prisma.product.count).toHaveBeenLastCalledWith({ where });
    expect(result.meta).toEqual({
      page: 2,
      limit: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it('recognises an optional identity on the public read routes and keeps ADMIN routes gated', () => {
    for (const method of ['findAll', 'findOne'] as const) {
      const handler = Reflect.get(ProductsController.prototype, method);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        OptionalJwtAuthGuard,
      );
    }
    for (const method of ['findAllAdmin', 'findOneAdmin'] as const) {
      const handler = Reflect.get(ProductsController.prototype, method);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toContain('ADMIN');
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
  });
});
