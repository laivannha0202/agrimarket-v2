import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PartnersService } from '../../src/partners/partners.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { PartnerType, PartnerVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';

const existing = {
  id: 7,
  code: 'PARTNER-0007',
  type: PartnerType.COOPERATIVE,
  name: 'HTX Miền Bắc',
  phone: '0987654321',
  taxCode: '0109999999',
  registrationDocumentUrl: 'https://example.org/document.pdf',
  verificationStatus: PartnerVerificationStatus.VERIFIED,
  status: RecordStatus.INACTIVE,
  bankAccountNumber: '123456789',
};

function installLinkedFarmMutationMocks(prisma: MockPrisma) {
  const farms = [
    { id: 41, partnerId: existing.id, status: RecordStatus.ACTIVE },
    { id: 42, partnerId: existing.id, status: RecordStatus.INACTIVE },
  ];
  const before = structuredClone(farms);

  prisma.farm.update.mockImplementation(
    async ({ where, data }: { where: { id: number }; data: Partial<(typeof farms)[number]> }) => {
      const farm = farms.find((row) => row.id === where.id);
      if (!farm) throw new Error('Farm not found in test fixture');
      Object.assign(farm, data);
      return farm;
    },
  );
  prisma.farm.updateMany.mockImplementation(
    async ({ where, data }: { where: { partnerId?: number }; data: Partial<(typeof farms)[number]> }) => {
      let count = 0;
      for (const farm of farms) {
        if (where.partnerId !== undefined && farm.partnerId === where.partnerId) {
          Object.assign(farm, data);
          count += 1;
        }
      }
      return { count };
    },
  );

  return { farms, before };
}

describe('Partner management business rules', () => {
  let prisma: MockPrisma;
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: PartnersService;

  beforeEach(() => {
    prisma = createMockPrisma();
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new PartnersService(prisma as never, audit as never);
    prisma.partner.findFirst.mockResolvedValue(null);
    prisma.partner.findMany.mockResolvedValue([{ code: existing.code }]);
    prisma.partner.findUnique.mockResolvedValue(existing);
    prisma.partner.create.mockImplementation(async ({ data }) => ({ id: 8, ...data }));
    prisma.partner.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    prisma.product.count.mockResolvedValue(0);
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.farm.count.mockResolvedValue(0);
  });

  it('creates a pending, inactive partner and records the creation transactionally', async () => {
    const created = await service.create({
      type: PartnerType.INDIVIDUAL, name: 'Trang trại mới', phone: '0912345678',
    } as never, 1);
    expect(created).toMatchObject({
      code: 'PARTNER-0008', status: RecordStatus.INACTIVE,
      verificationStatus: PartnerVerificationStatus.PENDING,
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE' }), prisma);
  });

  it('rejects missing name, phone and unclassified partner types', async () => {
    await expect(service.create({ type: PartnerType.UNSPECIFIED, name: 'A', phone: '0912345678' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ type: PartnerType.COMPANY, name: '   ', phone: '0912345678' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('detects an existing duplicate phone before inserting', async () => {
    prisma.partner.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.create({ type: PartnerType.COMPANY, name: 'A', phone: '0912345678' } as never))
      .rejects.toThrow('Số điện thoại');
    expect(prisma.partner.create).not.toHaveBeenCalled();
  });

  it('returns a field-specific conflict for a concurrent duplicate key violation', async () => {
    prisma.partner.create.mockRejectedValue({ code: 'P2002', meta: { target: 'partners_email_key' } });
    await expect(service.create({
      type: PartnerType.COMPANY, name: 'A', phone: '0912345678', email: 'x@example.org',
    } as never)).rejects.toThrow('Email');
    expect(prisma.partner.create).toHaveBeenCalledTimes(1);
  });

  it('retries only generated-code collisions', async () => {
    prisma.partner.create
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: 'partners_code_key' } })
      .mockResolvedValueOnce({ id: 9, code: 'PARTNER-0009' });
    prisma.partner.findMany
      .mockResolvedValueOnce([{ code: 'PARTNER-0007' }])
      .mockResolvedValueOnce([{ code: 'PARTNER-0008' }]);
    await expect(service.create({ type: PartnerType.INDIVIDUAL, name: 'A', phone: '0912345678' } as never))
      .resolves.toMatchObject({ code: 'PARTNER-0009' });
  });

  it('allows clearing optional fields and resets verification after legal edits', async () => {
    const updated = await service.update(existing.id, { taxCode: null, bankAccountNumber: null } as never, 1);
    expect(updated).toMatchObject({ taxCode: null, bankAccountNumber: null, verificationStatus: 'PENDING' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ beforeJson: existing, action: 'UPDATE' }), prisma,
    );
  });

  it('does not reset verification for changes to contact details', async () => {
    const updated = await service.update(existing.id, { email: 'new@example.org' } as never, 1);
    expect(updated.verificationStatus).toBe(PartnerVerificationStatus.VERIFIED);
  });

  it('prevents edits to verified legal details while business is active', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, status: RecordStatus.ACTIVE });
    await expect(service.update(existing.id, { taxCode: 'new-tax-code' } as never, 1))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.partner.update).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();

    await expect(service.update(existing.id, { phone: '0912345678' } as never, 1)).resolves.toBeDefined();
  });

  it('prevents withdrawing verification while business is active', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, status: RecordStatus.ACTIVE });
    await expect(service.verify(existing.id, {
      verificationStatus: PartnerVerificationStatus.REJECTED, reason: 'Giấy tờ hết hạn',
    }, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it('blocks verification without complete legal evidence', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, registrationDocumentUrl: null });
    await expect(service.verify(existing.id, { verificationStatus: PartnerVerificationStatus.VERIFIED }, 1))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it('requires a rejection reason, and records successful review', async () => {
    await expect(service.verify(existing.id, {
      verificationStatus: PartnerVerificationStatus.REJECTED,
    }, 1)).rejects.toBeInstanceOf(BadRequestException);
    await service.verify(existing.id, { verificationStatus: PartnerVerificationStatus.VERIFIED }, 1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PARTNER_VERIFY_VERIFIED' }), prisma,
    );
  });

  it('denies activation until the profile is verified', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, verificationStatus: PartnerVerificationStatus.PENDING });
    await expect(service.changeBusinessStatus(existing.id, {
      status: RecordStatus.ACTIVE, reason: 'Đủ điều kiện',
    }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects whitespace-only reasons for status changes', async () => {
    await expect(service.changeBusinessStatus(existing.id, {
      status: RecordStatus.ACTIVE, reason: '   ',
    }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    { activeProducts: 2, openOrders: 0 },
    { activeProducts: 0, openOrders: 1 },
    { activeProducts: 2, openOrders: 1 },
  ])('blocks suspension when products or unfinished orders remain (%o)', async ({ activeProducts, openOrders }) => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, status: RecordStatus.ACTIVE });
    prisma.product.count.mockResolvedValue(activeProducts);
    prisma.partnerOrder.count.mockResolvedValue(openOrders);
    await expect(service.changeBusinessStatus(existing.id, {
      status: RecordStatus.INACTIVE, reason: 'Tạm khóa',
    }, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { partnerId: existing.id, status: RecordStatus.ACTIVE },
    });
    expect(prisma.partnerOrder.count).toHaveBeenCalledWith({
      where: { partnerId: existing.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
    });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.product.count.mock.invocationCallOrder[0],
    );
    expect(prisma.partner.update).not.toHaveBeenCalled();
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.farm.updateMany).not.toHaveBeenCalled();
  });

  it('allows suspending a partner with ACTIVE farms when no product or order blocker remains', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, status: RecordStatus.ACTIVE });
    // Model an existing ACTIVE Farm; Farm counts are not a suspension blocker.
    prisma.farm.count.mockResolvedValue(1);

    const updated = await service.changeBusinessStatus(existing.id, {
      status: RecordStatus.INACTIVE, reason: 'Ngừng hoạt động',
    }, 1);

    expect(updated.status).toBe(RecordStatus.INACTIVE);
    // Farm count is not part of the existing suspension blocker rules.
    expect(prisma.farm.count).not.toHaveBeenCalled();
    expect(prisma.partner.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { status: RecordStatus.INACTIVE },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.partner.findUnique.mock.invocationCallOrder[0],
    );
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.farm.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PARTNER_BUSINESS_INACTIVE', reason: 'Ngừng hoạt động' }), prisma,
    );
  });

  it('preserves linked farm status and partnerId when a partner is suspended', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, status: RecordStatus.ACTIVE });
    const { farms, before } = installLinkedFarmMutationMocks(prisma);

    await service.changeBusinessStatus(existing.id, {
      status: RecordStatus.INACTIVE, reason: 'Tạm khóa đối tác',
    }, 1);

    expect(farms).toEqual(before);
    expect(prisma.partner.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { status: RecordStatus.INACTIVE },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.farm.updateMany).not.toHaveBeenCalled();
    expect(prisma.farm.delete).not.toHaveBeenCalled();
    expect(prisma.farm.deleteMany).not.toHaveBeenCalled();
  });

  it('reactivates a verified partner without changing linked farm statuses or relations', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...existing, status: RecordStatus.INACTIVE });
    prisma.partner.update.mockResolvedValue({ ...existing, status: RecordStatus.ACTIVE });
    const { farms, before } = installLinkedFarmMutationMocks(prisma);

    const updated = await service.changeBusinessStatus(existing.id, {
      status: RecordStatus.ACTIVE, reason: 'Đối tác hoạt động trở lại',
    }, 1);

    expect(updated.status).toBe(RecordStatus.ACTIVE);
    expect(farms).toEqual(before);
    expect(prisma.partner.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { status: RecordStatus.ACTIVE },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.farm.update).not.toHaveBeenCalled();
    expect(prisma.farm.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PARTNER_BUSINESS_ACTIVE' }), prisma,
    );
  });

  it('requires a real partner for impact and history', async () => {
    prisma.partner.findUnique.mockResolvedValue(null);
    await expect(service.impact(100)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.history(100)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns filtered and paginated partners', async () => {
    prisma.partner.count.mockResolvedValue(1);
    prisma.partner.findMany.mockResolvedValue([existing]);
    const result = await service.findAll({
      page: 1, limit: 10, search: 'HTX', status: RecordStatus.INACTIVE,
      type: PartnerType.COOPERATIVE, verificationStatus: PartnerVerificationStatus.VERIFIED,
    }, { role: 'ADMIN' } as never);
    expect(result.meta.total).toBe(1);
    expect(prisma.partner.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: PartnerType.COOPERATIVE, status: RecordStatus.INACTIVE,
        verificationStatus: PartnerVerificationStatus.VERIFIED, OR: expect.any(Array),
      }),
    }));
  });
});
