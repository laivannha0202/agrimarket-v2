import { describe, it, expect, beforeEach } from 'vitest';
import {
  PayoutsService,
  SettlementsService,
} from '../../src/finance/settlements.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { PartnerOrderStatus, PayoutStatus } from '../../generated/prisma/enums.js';

describe('Settlement formula', () => {
  let prisma: MockPrisma;
  let service: SettlementsService;

  const audit = { record: async () => undefined };

  const partnerOrder = (overrides: Record<string, unknown>) => ({
    partnerId: 1,
    subtotal: 0,
    discountTotal: 0,
    commissionAmount: 0,
    payableAmount: 0,
    status: PartnerOrderStatus.DELIVERED,
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SettlementsService(prisma as never, audit as never);
  });

  it('computes gross - refund - commission + adjustment = payable', async () => {
    prisma.partnerOrder.findMany.mockResolvedValue([
      partnerOrder({
        id: 1,
        orderId: 10,
        subtotal: 100000,
        commissionAmount: 5000,
        payableAmount: 95000,
      }),
      partnerOrder({
        id: 2,
        orderId: 10,
        subtotal: 200000,
        discountTotal: 20000,
        commissionAmount: 9000,
        payableAmount: 171000,
      }),
    ]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.settlement.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
    );

    const settlement = await service.create(
      {
        partnerId: 1,
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.000Z',
        adjustmentAmount: 1000,
      },
      99,
    );

    // gross = 100000 + (200000 - 20000) = 280000
    // commission = 5000 + 9000 = 14000
    // payable = 280000 - 0 - 14000 + 1000 = 267000
    expect(Number(settlement.grossAmount)).toBe(280000);
    expect(Number(settlement.commissionAmount)).toBe(14000);
    expect(Number(settlement.payableAmount)).toBe(267000);
  });

  it('deducts COMPLETED refunds proportionally by gross with an exact remainder', async () => {
    prisma.partnerOrder.findMany.mockResolvedValue([
      partnerOrder({ id: 1, orderId: 10, subtotal: 100000, commissionAmount: 5000 }),
      partnerOrder({ id: 2, orderId: 10, subtotal: 200000, discountTotal: 20000, commissionAmount: 9000 }),
    ]);
    prisma.refund.findMany.mockResolvedValue([
      {
        amount: 7000,
        payment: { orderId: 10 },
        returnRequest: null,
      },
    ]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.settlement.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
    );

    const settlement = await service.create(
      {
        partnerId: 1,
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.000Z',
      },
      99,
    );

    // 7000 split 100000:180000 => 2500 / 4500 exactly (no lost cent).
    expect(Number(settlement.refundAmount)).toBe(7000);
    const lines = (settlement as unknown as { lines: { create: { partnerOrderId: number; refundAmount: number }[] } })
      .lines.create;
    expect(Number(lines.find((l) => l.partnerOrderId === 1)?.refundAmount)).toBe(2500);
    expect(Number(lines.find((l) => l.partnerOrderId === 2)?.refundAmount)).toBe(4500);
    expect(Number(settlement.payableAmount)).toBe(280000 - 7000 - 14000);
  });

  it('attributes a refund linked to a return directly to that partner order', async () => {
    prisma.partnerOrder.findMany.mockResolvedValue([
      partnerOrder({ id: 1, orderId: 10, subtotal: 100000, commissionAmount: 5000 }),
      partnerOrder({ id: 2, orderId: 10, subtotal: 200000, discountTotal: 20000, commissionAmount: 9000 }),
    ]);
    prisma.refund.findMany.mockResolvedValue([
      {
        amount: 6000,
        payment: { orderId: 10 },
        returnRequest: { orderItem: { partnerOrderId: 2 } },
      },
    ]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.settlement.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
    );

    const settlement = await service.create(
      {
        partnerId: 1,
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.000Z',
      },
      99,
    );

    const lines = (settlement as unknown as { lines: { create: { partnerOrderId: number; refundAmount: number }[] } })
      .lines.create;
    expect(Number(lines.find((l) => l.partnerOrderId === 1)?.refundAmount)).toBe(0);
    expect(Number(lines.find((l) => l.partnerOrderId === 2)?.refundAmount)).toBe(6000);
  });

  it('only selects DELIVERED partner orders that no settlement claimed and whose order has collected money', async () => {
    prisma.partnerOrder.findMany.mockResolvedValue([]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.settlement.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
    );

    // Nothing eligible is a business error, not an empty statement: a DRAFT
    // with no lines is not a payable period, and a create that starts after a
    // concurrent winner commits would otherwise leave a second, empty row.
    await expect(
      service.create(
        {
          partnerId: 1,
          periodStart: '2026-04-01T00:00:00.000Z',
          periodEnd: '2026-04-30T23:59:59.000Z',
        },
        99,
      ),
    ).rejects.toThrow(/No delivered, paid partner orders/);
    expect(prisma.settlement.create).not.toHaveBeenCalled();

    // Money on an order still in transit is not payable: READY_TO_SHIP and
    // SHIPPING are excluded. A DELIVERED parcel whose COD was never confirmed
    // (no PAID payment with paidAt) is not collected revenue either. An order
    // already claimed by any settlement (DRAFT included) can never be claimed
    // again.
    expect(prisma.partnerOrder.findMany).toHaveBeenCalledWith({
      where: {
        partnerId: 1,
        status: PartnerOrderStatus.DELIVERED,
        createdAt: {
          gte: new Date('2026-04-01T00:00:00.000Z'),
          lte: new Date('2026-04-30T23:59:59.000Z'),
        },
        settlementLines: { none: {} },
        order: {
          payments: {
            some: {
              status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
              paidAt: { not: null },
            },
          },
        },
      },
    });
  });

  it('rejects an invalid period', async () => {
    await expect(
      service.create(
        {
          partnerId: 1,
          periodStart: '2026-04-30T00:00:00.000Z',
          periodEnd: '2026-04-01T00:00:00.000Z',
        },
        99,
      ),
    ).rejects.toThrow(/periodEnd must be after periodStart/);
  });

  it('still retries a code collision (unique index on settlements.code)', async () => {
    // A real eligible order, otherwise the empty-period guard fires first.
    prisma.partnerOrder.findMany.mockResolvedValue([
      partnerOrder({ id: 7, orderId: 10, subtotal: 100000, commissionAmount: 0 }),
    ]);
    prisma.settlement.findMany.mockResolvedValue([{ code: 'SET-0001' }]);
    prisma.settlement.create
      .mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), {
          code: 'P2002',
          meta: { target: 'settlements_code_key' },
        }),
      )
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 2,
        ...data,
      }));

    const settlement = await service.create(
      {
        partnerId: 1,
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.000Z',
      },
      99,
    );
    expect(settlement.id).toBe(2);
    expect(prisma.settlement.create).toHaveBeenCalledTimes(2);
  });

  it('maps a concurrent double-claim (P2002 on partner_order_id) to a 409, not a raw error', async () => {
    prisma.partnerOrder.findMany.mockResolvedValue([
      partnerOrder({ id: 7, subTotal: 100000, subtotal: 100000, payableAmount: 100000 }),
    ]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.settlement.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: 'settlement_lines_partner_order_id_key' },
      }),
    );

    await expect(
      service.create(
        {
          partnerId: 1,
          periodStart: '2026-04-01T00:00:00.000Z',
          periodEnd: '2026-04-30T23:59:59.000Z',
        },
        99,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('blocks confirming a settlement while an adjustment is OPEN', async () => {
    prisma.settlement.findUnique.mockResolvedValue({
      id: 4,
      status: 'DRAFT',
    });
    prisma.settlementAdjustment.count.mockResolvedValue(1);

    await expect(service.confirm(4, 99)).rejects.toThrow(/OPEN reconciliation adjustment/);
    expect(prisma.settlement.update).not.toHaveBeenCalled();
  });
});

describe('Payout reconciliation guards', () => {
  let prisma: MockPrisma;
  let service: PayoutsService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PayoutsService(prisma as never, audit as never);
  });

  it('blocks marking a payout paid while its settlement has an OPEN adjustment', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 1,
      settlementId: 4,
      status: PayoutStatus.PENDING,
    });
    prisma.settlementAdjustment.count.mockResolvedValue(1);

    await expect(service.markPaid(1, 99)).rejects.toThrow(/OPEN reconciliation adjustment/);
    expect(prisma.payout.update).not.toHaveBeenCalled();
  });
});
