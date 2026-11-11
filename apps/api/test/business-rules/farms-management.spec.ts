import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FarmsService } from '../../src/farms/farms.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  PartnerVerificationStatus,
  RecordStatus,
} from '../../generated/prisma/enums.js';

const eligiblePartner = {
  id: 7,
  status: RecordStatus.ACTIVE,
  verificationStatus: PartnerVerificationStatus.VERIFIED,
};

describe('Farm partner eligibility', () => {
  let prisma: MockPrisma;
  let service: FarmsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new FarmsService(prisma as never);
    prisma.partner.findUnique.mockResolvedValue(eligiblePartner);
    prisma.farm.findMany.mockResolvedValue([]);
    prisma.farm.create.mockImplementation(async ({ data }) => ({
      id: 1,
      ...data,
    }));
  });

  it('creates an active farm for a verified partner whose business is active', async () => {
    const farm = await service.create({
      partnerId: 7,
      name: 'Farm A',
      address: 'Address A',
    });

    expect(farm).toMatchObject({ partnerId: 7, status: RecordStatus.ACTIVE });
    expect(prisma.partner.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, status: true, verificationStatus: true },
    });
    expect(prisma.farm.create).toHaveBeenCalledOnce();
  });

  it('rejects a partner that does not exist', async () => {
    prisma.partner.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ partnerId: 99, name: 'Farm A', address: 'Address A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.farm.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'PENDING verification',
      { verificationStatus: PartnerVerificationStatus.PENDING },
    ],
    [
      'REJECTED verification',
      { verificationStatus: PartnerVerificationStatus.REJECTED },
    ],
    ['INACTIVE business', { status: RecordStatus.INACTIVE }],
  ])(
    'rejects an active farm for a partner with %s',
    async (_label, overrides) => {
      prisma.partner.findUnique.mockResolvedValue({
        ...eligiblePartner,
        ...overrides,
      });

      await expect(
        service.create({ partnerId: 7, name: 'Farm A', address: 'Address A' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.farm.create).not.toHaveBeenCalled();
    },
  );

  it('allows an inactive draft farm while the partner is pending review', async () => {
    prisma.partner.findUnique.mockResolvedValue({
      ...eligiblePartner,
      status: RecordStatus.INACTIVE,
      verificationStatus: PartnerVerificationStatus.PENDING,
    });

    const farm = await service.create({
      partnerId: 7,
      name: 'Draft farm',
      address: 'Address A',
      status: RecordStatus.INACTIVE,
    });

    expect(farm).toMatchObject({ status: RecordStatus.INACTIVE, partnerId: 7 });
    expect(prisma.farm.create).toHaveBeenCalledOnce();
  });

  it('does not allow a draft farm to be activated until its partner is eligible', async () => {
    prisma.farm.findUnique.mockResolvedValue({
      id: 3,
      partnerId: 7,
      status: RecordStatus.INACTIVE,
    });
    prisma.partner.findUnique.mockResolvedValue({
      ...eligiblePartner,
      verificationStatus: PartnerVerificationStatus.PENDING,
    });

    await expect(
      service.update(3, { status: RecordStatus.ACTIVE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.farm.update).not.toHaveBeenCalled();
  });
});
