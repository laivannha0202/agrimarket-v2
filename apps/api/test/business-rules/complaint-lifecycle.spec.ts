import { describe, it, expect, beforeEach } from 'vitest';
import { ComplaintsService } from '../../src/complaints/complaints.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { ComplaintStatus } from '../../generated/prisma/enums.js';

/**
 * Complaint lifecycle (C-15).
 *
 *   OPEN -> PROCESSING -> RESOLVED | REJECTED
 *   OPEN -> REJECTED
 *
 * RESOLVED/REJECTED are terminal, closing requires a resolution, and the status
 * is claimed with a compare-and-set so two operators cannot both decide.
 */
describe('Complaint state machine', () => {
  let prisma: MockPrisma;
  let service: ComplaintsService;

  const complaint = (status: ComplaintStatus) => ({
    id: 5,
    status,
    resolution: null,
    resolvedAt: null,
  });

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ComplaintsService(prisma as never, {} as never);
  });

  it('moves OPEN to PROCESSING without requiring a resolution', async () => {
    const current = complaint(ComplaintStatus.OPEN);
    prisma.complaint.findUnique.mockResolvedValue(current);
    prisma.complaint.updateMany.mockResolvedValue({ count: 1 });
    prisma.complaint.findUniqueOrThrow.mockResolvedValue({
      ...current,
      status: ComplaintStatus.PROCESSING,
    });

    const updated = await service.update(5, { status: ComplaintStatus.PROCESSING });

    expect(updated.status).toBe(ComplaintStatus.PROCESSING);
    expect(prisma.complaint.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: ComplaintStatus.OPEN },
      data: { status: ComplaintStatus.PROCESSING, resolvedAt: null },
    });
  });

  it('refuses OPEN -> RESOLVED because the case was never processed', async () => {
    prisma.complaint.findUnique.mockResolvedValue(complaint(ComplaintStatus.OPEN));

    await expect(
      service.update(5, { status: ComplaintStatus.RESOLVED, resolution: 'Đã xử lý' }),
    ).rejects.toThrow(/Cannot change complaint status from OPEN to RESOLVED/);
    expect(prisma.complaint.updateMany).not.toHaveBeenCalled();
  });

  it('requires a resolution to resolve a PROCESSING complaint', async () => {
    prisma.complaint.findUnique.mockResolvedValue(complaint(ComplaintStatus.PROCESSING));

    await expect(
      service.update(5, { status: ComplaintStatus.RESOLVED, resolution: '   ' }),
    ).rejects.toThrow(/resolution is required/);
    expect(prisma.complaint.updateMany).not.toHaveBeenCalled();
  });

  it('resolves a PROCESSING complaint and stamps resolvedAt', async () => {
    const current = complaint(ComplaintStatus.PROCESSING);
    prisma.complaint.findUnique.mockResolvedValue(current);
    prisma.complaint.updateMany.mockResolvedValue({ count: 1 });
    prisma.complaint.findUniqueOrThrow.mockResolvedValue({
      ...current,
      status: ComplaintStatus.RESOLVED,
      resolution: 'Đã hoàn tiền',
      resolvedAt: new Date(),
    });

    await service.update(5, {
      status: ComplaintStatus.RESOLVED,
      resolution: '  Đã hoàn tiền  ',
    });

    expect(prisma.complaint.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: ComplaintStatus.PROCESSING },
      data: expect.objectContaining({
        status: ComplaintStatus.RESOLVED,
        resolution: 'Đã hoàn tiền',
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it('allows OPEN -> REJECTED with a reason', async () => {
    const current = complaint(ComplaintStatus.OPEN);
    prisma.complaint.findUnique.mockResolvedValue(current);
    prisma.complaint.updateMany.mockResolvedValue({ count: 1 });
    prisma.complaint.findUniqueOrThrow.mockResolvedValue({
      ...current,
      status: ComplaintStatus.REJECTED,
      resolution: 'Không đủ căn cứ',
    });

    await service.update(5, {
      status: ComplaintStatus.REJECTED,
      resolution: 'Không đủ căn cứ',
    });

    expect(prisma.complaint.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: ComplaintStatus.OPEN },
      data: expect.objectContaining({ status: ComplaintStatus.REJECTED }),
    });
  });

  it('treats a terminal status as final', async () => {
    prisma.complaint.findUnique.mockResolvedValue({
      ...complaint(ComplaintStatus.RESOLVED),
      resolution: 'Đã hoàn tiền',
    });

    await expect(
      service.update(5, { status: ComplaintStatus.PROCESSING }),
    ).rejects.toThrow(/Cannot change complaint status from RESOLVED to PROCESSING/);
    expect(prisma.complaint.updateMany).not.toHaveBeenCalled();
  });

  it('treats re-applying the current status as an idempotent replay', async () => {
    const current = complaint(ComplaintStatus.REJECTED);
    prisma.complaint.findUnique.mockResolvedValue(current);

    expect(await service.update(5, { status: ComplaintStatus.REJECTED })).toBe(current);
    expect(prisma.complaint.updateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when another operator changed the status first', async () => {
    prisma.complaint.findUnique.mockResolvedValue(complaint(ComplaintStatus.PROCESSING));
    prisma.complaint.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(5, {
        status: ComplaintStatus.RESOLVED,
        resolution: 'Đã xử lý',
      }),
    ).rejects.toThrow(/changed while this request was being processed/);
  });
});
