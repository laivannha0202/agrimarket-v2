import { beforeEach, describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FarmsController } from '../../src/farms/farms.controller.js';
import { FarmsService } from '../../src/farms/farms.service.js';
import { OptionalJwtAuthGuard } from '../../src/evidence/optional-jwt-auth.guard.js';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../src/common/interfaces/authenticated-user.interface.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  PartnerVerificationStatus,
  RecordStatus,
} from '../../generated/prisma/enums.js';

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

const publicVisibility = {
  status: RecordStatus.ACTIVE,
  partner: {
    is: {
      status: RecordStatus.ACTIVE,
      verificationStatus: PartnerVerificationStatus.VERIFIED,
    },
  },
};

const draftFarm = {
  id: 17,
  partnerId: 7,
  status: RecordStatus.INACTIVE,
  name: 'Farm draft',
  address: 'Draft address',
};

const activeFarmOfSuspendedPartner = {
  id: 18,
  partnerId: 7,
  status: RecordStatus.ACTIVE,
  name: 'Farm của đối tác đang bị khóa',
  address: 'Suspended partner address',
  partner: { id: 7, code: 'PARTNER-0007', name: 'Suspended partner' },
};

describe('Farm public visibility', () => {
  let prisma: MockPrisma;
  let service: FarmsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new FarmsService(prisma as never);
    prisma.farm.findMany.mockResolvedValue([]);
    prisma.farm.count.mockResolvedValue(0);
  });

  it('keeps anonymous list requests restricted to ACTIVE farms of ACTIVE + VERIFIED partners', async () => {
    await service.findAll({ status: RecordStatus.INACTIVE });

    expect(prisma.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: publicVisibility }),
    );
    expect(prisma.farm.count).toHaveBeenCalledWith({ where: publicVisibility });
  });

  it('keeps CUSTOMER list requests restricted to ACTIVE farms of ACTIVE + VERIFIED partners', async () => {
    await service.findAll({ status: RecordStatus.INACTIVE }, customer);

    expect(prisma.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: publicVisibility }),
    );
    expect(prisma.farm.count).toHaveBeenCalledWith({ where: publicVisibility });
  });

  it('does not publish any INACTIVE farm in the public list', async () => {
    await service.findAll({ status: RecordStatus.INACTIVE });

    expect(prisma.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RecordStatus.ACTIVE }),
      }),
    );
    expect(prisma.farm.count).toHaveBeenCalledWith({
      where: publicVisibility,
    });
  });

  it.each(['INACTIVE', 'PENDING', 'REJECTED'])(
    'does not publish an ACTIVE farm when its partner is %s',
    async (_partnerState) => {
      await service.findAll({}, customer);

      expect(prisma.farm.findMany).toHaveBeenCalledWith(
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
    },
  );

  it('hides an ACTIVE farm from anonymous and CUSTOMER reads while its partner is INACTIVE', async () => {
    prisma.farm.findMany.mockResolvedValue([]);
    prisma.farm.count.mockResolvedValue(0);

    for (const viewer of [undefined, customer]) {
      const result = await service.findAll({ partnerId: 7 }, viewer);
      expect(result.data).toEqual([]);
      expect(prisma.farm.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { ...publicVisibility, partnerId: 7 },
        }),
      );
    }

    prisma.farm.findFirst.mockResolvedValue(null);
    await expect(service.findOne(activeFarmOfSuspendedPartner.id, customer)).rejects.toThrow(
      'Farm not found',
    );
    expect(prisma.farm.findFirst).toHaveBeenCalledWith({
      where: { id: activeFarmOfSuspendedPartner.id, ...publicVisibility },
      include: { partner: { select: { id: true, code: true, name: true } } },
    });
  });

  it('returns an ACTIVE farm when its partner satisfies the public eligibility predicate', async () => {
    const eligibleFarm = {
      id: 8,
      status: RecordStatus.ACTIVE,
      partnerId: 7,
      partner: { id: 7, code: 'PARTNER-0007', name: 'Eligible partner' },
    };
    prisma.farm.findMany.mockResolvedValue([eligibleFarm]);
    prisma.farm.count.mockResolvedValue(1);

    const result = await service.findAll({}, customer);

    expect(result.data).toEqual([eligibleFarm]);
    expect(result.meta.total).toBe(1);
  });

  it('returns 404 for direct access to a farm outside public visibility', async () => {
    prisma.farm.findFirst.mockResolvedValue(null);

    await expect(service.findOne(17, customer)).rejects.toThrow(
      'Farm not found',
    );
    expect(prisma.farm.findFirst).toHaveBeenCalledWith({
      where: { id: 17, ...publicVisibility },
      include: {
        partner: { select: { id: true, code: true, name: true } },
      },
    });
    expect(prisma.farm.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 to an anonymous visitor requesting an inactive farm by ID', async () => {
    prisma.farm.findFirst.mockResolvedValue(null);

    await expect(service.findOne(17)).rejects.toThrow('Farm not found');
    expect(prisma.farm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 17, ...publicVisibility } }),
    );
  });

  it('lets ADMIN list inactive farms without the public partner predicate', async () => {
    prisma.farm.findMany.mockResolvedValue([draftFarm]);
    prisma.farm.count.mockResolvedValue(1);

    const result = await service.findAll(
      { status: RecordStatus.INACTIVE },
      admin,
    );

    expect(result.data).toEqual([draftFarm]);
    expect(prisma.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: RecordStatus.INACTIVE } }),
    );
    expect(prisma.farm.count).toHaveBeenCalledWith({
      where: { status: RecordStatus.INACTIVE },
    });
  });

  it('lets ADMIN open an inactive draft by ID', async () => {
    prisma.farm.findUnique.mockResolvedValue(draftFarm);

    await expect(service.findOne(17, admin)).resolves.toEqual(draftFarm);
    expect(prisma.farm.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 17 } }),
    );
    expect(prisma.farm.findFirst).not.toHaveBeenCalled();
  });

  it('lets ADMIN list and open an ACTIVE farm linked to an INACTIVE partner', async () => {
    prisma.farm.findMany.mockResolvedValue([activeFarmOfSuspendedPartner]);
    prisma.farm.count.mockResolvedValue(1);

    const list = await service.findAll({ partnerId: 7 }, admin);

    expect(list.data).toEqual([activeFarmOfSuspendedPartner]);
    expect(prisma.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partnerId: 7 },
        include: { partner: { select: { id: true, code: true, name: true } } },
      }),
    );

    prisma.farm.findUnique.mockResolvedValue(activeFarmOfSuspendedPartner);
    await expect(service.findOne(activeFarmOfSuspendedPartner.id, admin)).resolves.toEqual(
      activeFarmOfSuspendedPartner,
    );
    expect(prisma.farm.findUnique).toHaveBeenCalledWith({
      where: { id: activeFarmOfSuspendedPartner.id },
      include: { partner: { select: { id: true, code: true, name: true } } },
    });
  });

  it('keeps ADMIN able to update an inactive draft', async () => {
    prisma.farm.findUnique.mockResolvedValue(draftFarm);
    prisma.farm.update.mockResolvedValue({
      ...draftFarm,
      name: 'Updated draft',
    });

    const result = await service.update(17, { name: 'Updated draft' });

    expect(result.name).toBe('Updated draft');
    expect(prisma.farm.update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { name: 'Updated draft' },
    });
  });

  it('uses the identical visibility filter for page data and total count', async () => {
    prisma.farm.count.mockResolvedValue(3);

    const result = await service.findAll(
      {
        page: 2,
        limit: 1,
        status: RecordStatus.INACTIVE,
        partnerId: 7,
        search: '  Minh Chau  ',
      },
      customer,
    );

    const where = {
      ...publicVisibility,
      partnerId: 7,
      OR: [
        { code: { contains: 'Minh Chau' } },
        { name: { contains: 'Minh Chau' } },
        { address: { contains: 'Minh Chau' } },
      ],
    };
    expect(prisma.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 1, take: 1 }),
    );
    expect(prisma.farm.count).toHaveBeenCalledWith({ where });
    expect(result.meta).toEqual({
      page: 2,
      limit: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it('uses optional JWT identity on both public read routes', () => {
    for (const method of ['findAll', 'findOne'] as const) {
      const handler = Reflect.get(FarmsController.prototype, method);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        OptionalJwtAuthGuard,
      );
    }
  });
});
