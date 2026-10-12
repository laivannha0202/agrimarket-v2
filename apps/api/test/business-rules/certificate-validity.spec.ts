import { describe, it, expect, beforeEach } from 'vitest';
import {
  CertificatesService,
  certificateValidityAt,
} from '../../src/certificates/certificates.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

const DAY = 86_400_000;

function certRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 1,
    farmId: 9,
    type: 'VietGAP',
    certificateCode: 'VG-HY-2026-014',
    issuer: 'Trung tâm Kiểm định và Chứng nhận Hưng Yên',
    issuedAt: new Date(now - 30 * DAY),
    expiresAt: new Date(now + 30 * DAY),
    fileUrl: 'https://cdn.agrimarket.vn/certs/vg.pdf',
    verificationStatus: 'VERIFIED',
    verifiedAt: new Date(now - 29 * DAY),
    rejectionReason: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('Certificate validity (A3)', () => {
  let prisma: MockPrisma;
  let service: CertificatesService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CertificatesService(prisma as never, audit as never);
  });

  it('is VALID while verified, active, within the window and documented', () => {
    expect(certificateValidityAt(certRow() as never)).toBe('VALID');
  });

  it('is EXPIRED the moment the window closes, even though VERIFIED + ACTIVE are kept', () => {
    const now = Date.now();
    const expired = certRow({ expiresAt: new Date(now - 1_000) });
    // The stored flags are untouched history; only the computed fact changes.
    expect(expired.verificationStatus).toBe('VERIFIED');
    expect(expired.status).toBe('ACTIVE');
    expect(certificateValidityAt(expired as never)).toBe('EXPIRED');
  });

  it('is VALID exactly on the expiry day (inclusive window)', () => {
    const at = new Date('2026-09-07T00:00:00.000Z');
    const edge = certRow({
      issuedAt: new Date('2025-09-02T00:00:00.000Z'),
      expiresAt: new Date('2026-09-07T00:00:00.000Z'),
    });
    expect(certificateValidityAt(edge as never, at)).toBe('VALID');
    expect(
      certificateValidityAt(edge as never, new Date(at.getTime() + 1)),
    ).toBe('EXPIRED');
  });

  it('is INVALID when pending, rejected, inactive or undocumented (and EXPIRED outside the window)', () => {
    expect(certificateValidityAt(certRow({ verificationStatus: 'PENDING' }) as never)).toBe(
      'INVALID',
    );
    expect(certificateValidityAt(certRow({ verificationStatus: 'REJECTED' }) as never)).toBe(
      'INVALID',
    );
    expect(certificateValidityAt(certRow({ status: 'INACTIVE' }) as never)).toBe('INVALID');
    // A not-yet-effective row is outside its validity window: it can never be
    // presented as valid, whatever its paperwork state.
    expect(
      certificateValidityAt(
        certRow({ issuedAt: new Date(Date.now() + DAY) }) as never,
      ),
    ).toBe('EXPIRED');
    expect(certificateValidityAt(certRow({ fileUrl: null }) as never)).toBe('INVALID');
    expect(certificateValidityAt(certRow({ fileUrl: '  ' }) as never)).toBe('INVALID');
  });

  it('findValidByFarm excludes expired VERIFIED rows at read time (cert#11 shape)', () => {
    const now = Date.now();
    prisma.certificate.findMany.mockResolvedValue([
      certRow({ id: 11, certificateCode: 'GG-HY-2025-003', expiresAt: new Date(now - DAY) }),
    ]);
    return service.findValidByFarm(11).then((rows) => {
      expect(rows).toHaveLength(0);
      // The query itself already constrains the window + document at the DB.
      expect(prisma.certificate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            verificationStatus: 'VERIFIED',
            status: 'ACTIVE',
            fileUrl: { not: null },
          }),
        }),
      );
    });
  });

  it('findValidByFarm returns VALID rows with the computed flag', async () => {
    prisma.certificate.findMany.mockResolvedValue([certRow({ id: 9 })]);
    const rows = await service.findValidByFarm(9);
    expect(rows).toHaveLength(1);
    expect(rows[0].validity).toBe('VALID');
  });

  it('verify keeps the paper trail and returns the computed validity', async () => {
    prisma.certificate.findUnique.mockResolvedValue(certRow({ id: 12 }));
    prisma.certificate.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...certRow({ id: 12 }),
      ...data,
    }));
    const cert = await service.verify(12, { verificationStatus: 'VERIFIED' } as never, 1);
    expect(cert.validity).toBe('VALID');
    expect(prisma.certificate.update).toHaveBeenCalled();
  });
});
