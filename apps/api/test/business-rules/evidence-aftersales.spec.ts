import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EvidenceService, MAX_EVIDENCE_PER_REQUEST } from '../../src/evidence/evidence.service.js';
import { EvidenceSweepService } from '../../src/evidence/evidence-sweep.service.js';
import { ReviewsService } from '../../src/reviews/reviews.service.js';
import { ReturnsService } from '../../src/returns/returns.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * Unit-level rules for the after-sales evidence work.
 *
 * The e2e suite proves the whole path over HTTP against a real database; these
 * tests pin the decisions that must hold even when the surrounding query
 * changes — in particular that `bind` cannot be talked into attaching a foreign
 * or already-used image, and that a return is bounded by the REMAINING
 * quantity rather than the purchased one.
 */

const audit = { record: async () => undefined };
const images = {} as never;

describe('Evidence binding rules', () => {
  let prisma: MockPrisma;
  let service: EvidenceService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new EvidenceService(prisma as never, images);
  });

  const tx = () => prisma as never;

  it("accepts the caller's own unbound uploads and returns the count", async () => {
    prisma.evidenceImage.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.evidenceImage.updateMany.mockResolvedValue({ count: 2 });

    const bound = await service.bind(tx(), 7, [1, 2], { complaintId: 50 });

    expect(bound).toBe(2);
    // The owner is part of the WHERE clause, so a foreign row can never match.
    expect(prisma.evidenceImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [1, 2] },
          uploadedById: 7,
          reviewId: null,
          complaintId: null,
          returnId: null,
        }),
      }),
    );
  });

  it('de-duplicates ids so the same image cannot be attached twice in one call', async () => {
    prisma.evidenceImage.findMany.mockResolvedValue([{ id: 3 }]);
    prisma.evidenceImage.updateMany.mockResolvedValue({ count: 1 });

    const bound = await service.bind(tx(), 7, [3, 3, 3], { reviewId: 9 });

    expect(bound).toBe(1);
    expect(prisma.evidenceImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [3] } }) }),
    );
  });

  it('rejects a foreign or already-bound id instead of attaching what it can', async () => {
    // Only one of the two requested ids matched: the other is not the caller's.
    prisma.evidenceImage.findMany.mockResolvedValue([{ id: 1 }]);

    await expect(service.bind(tx(), 7, [1, 999], { complaintId: 50 })).rejects.toThrow(
      /không hợp lệ|thuộc yêu cầu khác/i,
    );
    // Nothing is written when the set is not exactly what was asked for.
    expect(prisma.evidenceImage.updateMany).not.toHaveBeenCalled();
  });

  it('rejects more than the per-request cap before touching the database', async () => {
    const tooMany = Array.from({ length: MAX_EVIDENCE_PER_REQUEST + 1 }, (_, i) => i + 1);

    await expect(service.bind(tx(), 7, tooMany, { returnId: 3 })).rejects.toThrow(
      new RegExp(String(MAX_EVIDENCE_PER_REQUEST)),
    );
    expect(prisma.evidenceImage.findMany).not.toHaveBeenCalled();
  });

  it('is a no-op when no images are supplied', async () => {
    const bound = await service.bind(tx(), 7, undefined, { reviewId: 1 });
    expect(bound).toBe(0);
    expect(prisma.evidenceImage.findMany).not.toHaveBeenCalled();
  });
});

describe('Evidence read policy', () => {
  let prisma: MockPrisma;
  let service: EvidenceService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new EvidenceService(prisma as never, images);
  });

  const row = (over: Record<string, unknown>) => ({
    id: 1,
    storageKey: 'a.png',
    review: null,
    complaint: null,
    returnReq: null,
    ...over,
  });

  it('gives an unbound upload to nobody, not even its uploader', async () => {
    prisma.evidenceImage.findUnique.mockResolvedValue(row({}));
    const { access } = await service.resolveForRead(1, { id: 7, role: 'CUSTOMER' });
    expect(access).toBe('none');
  });

  it('gives a complaint image to its owner and to an admin, and to nobody else', async () => {
    prisma.evidenceImage.findUnique.mockResolvedValue(row({ complaint: { customerId: 7 } }));

    expect((await service.resolveForRead(1, { id: 7, role: 'CUSTOMER' })).access).toBe('owner');
    expect((await service.resolveForRead(1, { id: 99, role: 'ADMIN' })).access).toBe('admin');
    expect((await service.resolveForRead(1, { id: 8, role: 'CUSTOMER' })).access).toBe('none');
    expect((await service.resolveForRead(1, null)).access).toBe('none');
  });

  it('gives a return image to its owner and to an admin, never to the public', async () => {
    prisma.evidenceImage.findUnique.mockResolvedValue(row({ returnReq: { customerId: 7 } }));

    expect((await service.resolveForRead(1, { id: 7, role: 'CUSTOMER' })).access).toBe('owner');
    expect((await service.resolveForRead(1, { id: 99, role: 'ADMIN' })).access).toBe('admin');
    expect((await service.resolveForRead(1, null)).access).toBe('none');
  });

  it('exposes a review image publicly ONLY while the review is APPROVED', async () => {
    for (const status of ['PENDING', 'HIDDEN'] as const) {
      prisma.evidenceImage.findUnique.mockResolvedValue(
        row({ review: { customerId: 7, status } }),
      );
      expect((await service.resolveForRead(1, null)).access).toBe('none');
      expect((await service.resolveForRead(1, { id: 8, role: 'CUSTOMER' })).access).toBe('none');
    }

    prisma.evidenceImage.findUnique.mockResolvedValue(
      row({ review: { customerId: 7, status: 'APPROVED' } }),
    );
    expect((await service.resolveForRead(1, null)).access).toBe('public');
  });

  it('still gives the reviewer and an admin access to their own PENDING review', async () => {
    prisma.evidenceImage.findUnique.mockResolvedValue(
      row({ review: { customerId: 7, status: 'PENDING' } }),
    );
    expect((await service.resolveForRead(1, { id: 7, role: 'CUSTOMER' })).access).toBe('owner');
    expect((await service.resolveForRead(1, { id: 99, role: 'ADMIN' })).access).toBe('owner');
  });
});

describe('Review eligibility', () => {
  let prisma: MockPrisma;
  let service: ReviewsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ReviewsService(prisma as never, { bind: async () => 0 } as never);
  });

  it("scopes the eligible query to the caller's own delivered, unreviewed items", async () => {
    prisma.orderItem.findMany.mockResolvedValue([]);
    prisma.orderItem.count.mockResolvedValue(0);

    await service.listEligibleItems(42, { page: 1, limit: 10 });

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          partnerOrder: { order: { customerId: 42, status: 'DELIVERED' } },
          reviews: { none: { customerId: 42 } },
        }),
      }),
    );
  });

  it('refuses a review for an item the customer does not own', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 1,
      partnerOrder: { order: { customerId: 999, status: 'DELIVERED' } },
      productVariant: { productId: 5 },
    });

    await expect(service.create(42, { orderItemId: 1, rating: 5 })).rejects.toThrow(/purchased/i);
  });

  it('refuses a review for an order that is not delivered', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 1,
      partnerOrder: { order: { customerId: 42, status: 'SHIPPING' } },
      productVariant: { productId: 5 },
    });

    await expect(service.create(42, { orderItemId: 1, rating: 5 })).rejects.toThrow(/delivered/i);
  });

  it('refuses a second review on the same item', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 1,
      partnerOrder: { order: { customerId: 42, status: 'DELIVERED' } },
      productVariant: { productId: 5 },
    });
    prisma.review.findUnique.mockResolvedValue({ id: 3 });

    await expect(service.create(42, { orderItemId: 1, rating: 5 })).rejects.toThrow(
      /already been reviewed/i,
    );
  });
});

describe('Return quantity is bounded by what is left', () => {
  let prisma: MockPrisma;
  let service: ReturnsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ReturnsService(prisma as never, audit as never, { bind: async () => 0 } as never);
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 1,
      quantity: 5,
      partnerOrder: { order: { id: 10, customerId: 42, status: 'DELIVERED' } },
    });
  });

  it('subtracts active requests before checking the requested quantity', async () => {
    // 4 of 5 already claimed, so only 1 is left.
    prisma.returnRequest.findMany.mockResolvedValue([{ quantity: '4' }]);

    await expect(
      service.create(42, { orderItemId: 1, quantity: 2, reason: 'Vượt' }),
    ).rejects.toThrow(/at most 1/i);
    expect(prisma.returnRequest.create).not.toHaveBeenCalled();
  });

  it('accepts a request that fits in what is left', async () => {
    prisma.returnRequest.findMany.mockResolvedValue([{ quantity: '4' }]);
    prisma.returnRequest.create.mockResolvedValue({ id: 9 });

    const created = await service.create(42, { orderItemId: 1, quantity: 1, reason: 'Trả nốt' });

    expect(created).toEqual({ id: 9 });
    expect(prisma.returnRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 1, orderItemId: 1 }) }),
    );
  });

  it('says the item is fully claimed when nothing is left', async () => {
    prisma.returnRequest.findMany.mockResolvedValue([{ quantity: '5' }]);

    await expect(
      service.create(42, { orderItemId: 1, quantity: 1, reason: 'Thêm' }),
    ).rejects.toThrow(/fully claimed/i);
  });

  it('does not count REJECTED or REFUNDED requests against the customer', async () => {
    // Nothing active: the whole purchased quantity is still free.
    prisma.returnRequest.findMany.mockResolvedValue([]);
    prisma.returnRequest.create.mockResolvedValue({ id: 11 });

    await service.create(42, { orderItemId: 1, quantity: 5, reason: 'Hợp lệ' });

    // Only the statuses that still hold a claim are queried, so a rejected
    // request can never block a legitimate one.
    expect(prisma.returnRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderItemId: 1,
          status: { in: ['REQUESTED', 'APPROVED', 'RETURNING', 'RECEIVED', 'QC_PENDING'] },
        }),
      }),
    );
  });

  it('refuses a return for an order that is not delivered', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 1,
      quantity: 5,
      partnerOrder: { order: { id: 10, customerId: 42, status: 'SHIPPING' } },
    });

    await expect(
      service.create(42, { orderItemId: 1, quantity: 1, reason: 'Sớm' }),
    ).rejects.toThrow(/delivered/i);
  });

  it('refuses a return for another customer item', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 1,
      quantity: 5,
      partnerOrder: { order: { id: 10, customerId: 999, status: 'DELIVERED' } },
    });

    await expect(
      service.create(42, { orderItemId: 1, quantity: 1, reason: 'Không phải của tôi' }),
    ).rejects.toThrow(/your own orders/i);
  });
});

describe('Evidence sweep housekeeping', () => {
  let prisma: MockPrisma;
  let evidence: EvidenceService;
  let sweep: EvidenceSweepService;

  beforeEach(() => {
    prisma = createMockPrisma();
    evidence = new EvidenceService(prisma as never, images);
    sweep = new EvidenceSweepService(evidence, prisma as never);
  });

  afterEach(() => {
    sweep.onModuleDestroy();
  });

  it('deletes only unbound rows older than the TTL', async () => {
    prisma.evidenceImage.findMany.mockResolvedValue([]);

    await sweep.sweep();

    expect(prisma.evidenceImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          // All three owner columns null: a bound image is never swept.
          reviewId: null,
          complaintId: null,
          returnId: null,
          createdAt: { lt: expect.any(Date) },
        }),
      }),
    );
  });

  it('logs and swallows a database failure instead of crashing the API', async () => {
    prisma.evidenceImage.findMany.mockRejectedValue(new Error('db down'));

    await expect(sweep.sweep()).resolves.toBe(0);
  });

  it('does nothing when there is nothing to remove', async () => {
    prisma.evidenceImage.findMany.mockResolvedValue([]);

    await expect(sweep.sweep()).resolves.toBe(0);
    expect(prisma.evidenceImage.deleteMany).not.toHaveBeenCalled();
  });
});



