import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * The audit row belongs to the transaction of the change it describes, and it
 * must be written through that transaction's connection. Writing it through the
 * outer client instead checks out a SECOND pool connection while the caller
 * still holds its first, which stalls the whole checkout under concurrency
 * (measured: 0/12 concurrent checkouts, 5060ms, all P2028).
 */
describe('Audit trail', () => {
  let prisma: MockPrisma;
  let service: AuditService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AuditService(prisma as never);
  });

  it('writes through the transaction client when one is passed', async () => {
    const tx = createMockPrisma();
    tx.auditLog.create.mockResolvedValue({ id: 1 });

    await service.record(
      { actorUserId: 1, action: 'ORDER_CREATE', entityType: 'Order', entityId: '5' },
      tx as never,
    );

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    // The outer client must not be touched: that would be a second connection.
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('falls back to the outer client for non-transactional callers', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 1 });

    await service.record({
      actorUserId: 1,
      action: 'ORDER_CREATE',
      entityType: 'Order',
      entityId: '5',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
