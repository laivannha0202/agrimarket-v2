import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PartnersService,
  PUBLIC_PARTNER_SELECT,
} from '../../src/partners/partners.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import type { AuthenticatedUser } from '../../src/common/interfaces/authenticated-user.interface.js';

const SENSITIVE_FIELDS = ['taxCode', 'bankAccountName', 'bankAccountNumber', 'bankName'] as const;

const fullPartner = {
  id: 11,
  code: 'PARTNER-0011',
  name: 'HTX Rau sạch',
  representativeName: 'Nguyễn Văn A',
  phone: '0987654321',
  email: 'a@partner.vn',
  address: 'Hưng Yên',
  status: 'ACTIVE',
  taxCode: 'TAX-SECRET-001',
  bankAccountName: 'Nguyễn Văn A',
  bankAccountNumber: '9704000000000001',
  bankName: 'VietinBank',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const publicPartner = {
  id: fullPartner.id,
  code: fullPartner.code,
  name: fullPartner.name,
  representativeName: fullPartner.representativeName,
  phone: fullPartner.phone,
  email: fullPartner.email,
  address: fullPartner.address,
  status: fullPartner.status,
  createdAt: fullPartner.createdAt,
  updatedAt: fullPartner.updatedAt,
};

const admin: AuthenticatedUser = {
  id: 1,
  email: 'admin@agrimarket.vn',
  role: 'ADMIN',
  fullName: 'Admin',
  phone: '0900000000',
};

const customer: AuthenticatedUser = {
  id: 2,
  email: 'customer@agrimarket.vn',
  role: 'CUSTOMER',
  fullName: 'Customer',
  phone: '0911111111',
};

describe('P0-A2 — partner public projection', () => {
  let prisma: MockPrisma;
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: PartnersService;

  beforeEach(() => {
    prisma = createMockPrisma();
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new PartnersService(prisma as never, audit as never);
  });

  it('never selects tax/bank columns for anonymous or customer reads', () => {
    expect(Object.keys(PUBLIC_PARTNER_SELECT).sort()).toEqual(
      [
        'address',
        'code',
        'createdAt',
        'email',
        'id',
        'name',
        'phone',
        'representativeName',
        'status',
        'updatedAt',
      ].sort(),
    );
    for (const field of SENSITIVE_FIELDS) {
      expect(PUBLIC_PARTNER_SELECT).not.toHaveProperty(field);
    }
  });

  it('uses the public select for the list and returns only public fields', async () => {
    prisma.partner.findMany.mockResolvedValue([publicPartner]);
    prisma.partner.count.mockResolvedValue(1);

    const result = await service.findAll({ page: 1, limit: 20 }, customer);

    const args = prisma.partner.findMany.mock.calls[0][0] as {
      select?: Record<string, boolean>;
    };
    expect(args.select).toEqual(PUBLIC_PARTNER_SELECT);
    expect(result.data[0]).not.toHaveProperty('taxCode');
    expect(result.data[0]).not.toHaveProperty('bankAccountNumber');
  });

  it('uses the public select for detail reads by anonymous/customer viewers', async () => {
    prisma.partner.findUnique.mockResolvedValue({ ...fullPartner });

    await service.findOne(11);
    const anonymousArgs = prisma.partner.findUnique.mock.calls[0][0] as {
      select?: Record<string, boolean>;
    };
    expect(anonymousArgs.select).toEqual(PUBLIC_PARTNER_SELECT);

    await service.findOne(11, customer);
    const customerArgs = prisma.partner.findUnique.mock.calls[1][0] as {
      select?: Record<string, boolean>;
    };
    expect(customerArgs.select).toEqual(PUBLIC_PARTNER_SELECT);
  });

  it('keeps the full row for ADMIN list/detail responses', async () => {
    prisma.partner.findMany.mockResolvedValue([fullPartner]);
    prisma.partner.count.mockResolvedValue(1);
    const list = await service.findAll({}, admin);
    const listArgs = prisma.partner.findMany.mock.calls[0][0] as { select?: unknown };
    expect(listArgs.select).toBeUndefined();
    expect(list.data[0]).toMatchObject({
      taxCode: fullPartner.taxCode,
      bankAccountNumber: fullPartner.bankAccountNumber,
    });

    prisma.partner.findUnique.mockResolvedValue(fullPartner);
    const detail = await service.findOne(11, admin);
    const detailArgs = prisma.partner.findUnique.mock.calls[0][0] as { select?: unknown };
    expect(detailArgs.select).toBeUndefined();
    expect(detail).toMatchObject({
      taxCode: fullPartner.taxCode,
      bankName: fullPartner.bankName,
    });
  });

  it('writes the full pre-image (including bank/tax) to the audit trail on update', async () => {
    prisma.partner.findUnique.mockResolvedValue(fullPartner);
    prisma.partner.update.mockResolvedValue({ ...fullPartner, name: 'HTX Mới' });

    await service.update(11, { name: 'HTX Mới' } as never, 1);

    // `findOne(id)` without a viewer would have returned the public projection;
    // the update must use a full findUnique so beforeJson keeps sensitive fields.
    const findArgs = prisma.partner.findUnique.mock.calls[0][0] as { select?: unknown };
    expect(findArgs.select).toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        beforeJson: expect.objectContaining({
          taxCode: fullPartner.taxCode,
          bankAccountName: fullPartner.bankAccountName,
          bankAccountNumber: fullPartner.bankAccountNumber,
          bankName: fullPartner.bankName,
        }),
      }),
      prisma,
    );
  });
});
