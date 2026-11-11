import { beforeEach, describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../src/common/audit/audit.service.js';
import { FarmsService } from '../../src/farms/farms.service.js';
import { PartnerVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

const oldPartner = { id: 7, code: 'HTX-007', name: 'HTX cũ' };
const newPartner = {
  id: 9,
  code: 'HTX-009',
  name: 'HTX mới',
  status: RecordStatus.ACTIVE,
  verificationStatus: PartnerVerificationStatus.VERIFIED,
};
const farm = {
  id: 15,
  code: 'FARM-015',
  partnerId: oldPartner.id,
  partner: oldPartner,
  status: RecordStatus.INACTIVE,
  name: 'Trang trại A',
};
const admin = {
  id: 42,
  email: 'admin@example.test',
  role: 'ADMIN' as const,
  fullName: 'Admin',
};

describe('FarmsService.transferPartner', () => {
  let prisma: MockPrisma;
  let service: FarmsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new FarmsService(prisma as never, new AuditService(prisma as never));
    prisma.farm.findUnique.mockResolvedValue(farm);
    prisma.farm.update.mockImplementation(async ({ data }) => ({ ...farm, ...data }));
    prisma.partner.findUnique.mockResolvedValue(newPartner);
    prisma.product.count.mockResolvedValue(0);
    prisma.season.count.mockResolvedValue(0);
    prisma.certificate.count.mockResolvedValue(0);
    prisma.auditLog.create.mockResolvedValue({ id: 101 });
  });

  it('transfers an inactive farm and writes the complete audit record in the same transaction', async () => {
    const result = await service.transferPartner(
      farm.id,
      { newPartnerId: newPartner.id, reason: '  Điều chỉnh đơn vị quản lý.  ' },
      admin,
    );

    expect(result).toMatchObject({ partnerId: newPartner.id });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.product.count.mock.invocationCallOrder[0],
    );
    expect(prisma.farm.update).toHaveBeenCalledWith({
      where: { id: farm.id },
      data: { partnerId: newPartner.id },
      include: { partner: { select: { id: true, code: true, name: true } } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: admin.id,
        action: 'FARM_PARTNER_TRANSFER',
        entityType: 'Farm',
        entityId: String(farm.id),
        beforeJson: { partnerId: oldPartner.id, partner: oldPartner },
        afterJson: {
          partnerId: newPartner.id,
          partner: { id: newPartner.id, code: newPartner.code, name: newPartner.name },
        },
        reason: 'Điều chỉnh đơn vị quản lý.',
      },
    });
  });

  it('rejects a caller who is not an ADMIN before opening a transaction', async () => {
    await expect(
      service.transferPartner(farm.id, { newPartnerId: 9, reason: 'reason' }, {
        ...admin,
        role: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a blank reason', async () => {
    await expect(
      service.transferPartner(farm.id, { newPartnerId: 9, reason: '   ' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing farm', async () => {
    prisma.farm.findUnique.mockResolvedValue(null);
    await expect(
      service.transferPartner(farm.id, { newPartnerId: 9, reason: 'reason' }, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects an ACTIVE farm', async () => {
    prisma.farm.findUnique.mockResolvedValue({ ...farm, status: RecordStatus.ACTIVE });
    await expect(
      service.transferPartner(farm.id, { newPartnerId: 9, reason: 'reason' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects transferring to the current partner', async () => {
    await expect(
      service.transferPartner(farm.id, { newPartnerId: oldPartner.id, reason: 'reason' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.partner.findUnique).not.toHaveBeenCalled();
    expect(prisma.farm.update).not.toHaveBeenCalled();
  });

  it('rejects a destination partner that does not exist', async () => {
    prisma.partner.findUnique.mockResolvedValue(null);
    await expect(
      service.transferPartner(farm.id, { newPartnerId: 99, reason: 'reason' }, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.farm.update).not.toHaveBeenCalled();
  });

  it.each([
    ['INACTIVE business', { status: RecordStatus.INACTIVE }],
    ['unverified partner', { verificationStatus: PartnerVerificationStatus.PENDING }],
    ['rejected partner', { verificationStatus: PartnerVerificationStatus.REJECTED }],
  ])('rejects a destination with %s', async (_label, overrides) => {
    prisma.partner.findUnique.mockResolvedValue({ ...newPartner, ...overrides });
    await expect(
      service.transferPartner(farm.id, { newPartnerId: 99, reason: 'reason' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['product', 'season', 'certificate'] as const)(
    'rejects a farm that already has a linked %s',
    async (relation) => {
      prisma[relation].count.mockResolvedValue(1);
      await expect(
        service.transferPartner(farm.id, { newPartnerId: 9, reason: 'reason' }, admin),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.farm.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('propagates an audit failure so the database transaction cannot commit the farm change', async () => {
    const tx = createMockPrisma();
    tx.farm.findUnique.mockResolvedValue(farm);
    tx.farm.update.mockImplementation(async ({ data }) => ({ ...farm, ...data }));
    tx.partner.findUnique.mockResolvedValue(newPartner);
    tx.product.count.mockResolvedValue(0);
    tx.season.count.mockResolvedValue(0);
    tx.certificate.count.mockResolvedValue(0);
    const auditError = new Error('audit storage unavailable');
    tx.auditLog.create.mockRejectedValue(auditError);
    prisma.$transaction.mockImplementation(async (callback) =>
      (callback as (client: MockPrisma) => Promise<unknown>)(tx),
    );

    await expect(
      service.transferPartner(farm.id, { newPartnerId: 9, reason: 'reason' }, admin),
    ).rejects.toBe(auditError);

    // Both writes use the transaction client. Prisma rolls the farm update
    // back when the audit insert rejects, and never writes through the root client.
    expect(tx.farm.update).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
