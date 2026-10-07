import { describe, it, expect, beforeEach } from 'vitest';
import { OrdersService } from '../../src/orders/orders.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { CommissionService } from '../../src/finance/commission.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { PaymentStatus, ProductLotStatus } from '../../generated/prisma/enums.js';

/**
 * These tests exercise checkout behaviour end-to-end at the service level:
 * price snapshots, multi-partner splitting, totals and COD handling.
 */
describe('Order checkout rules', () => {
  let prisma: MockPrisma;
  let service: OrdersService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    const inventory = new InventoryService(prisma as never, audit as never);
    const promotions = new PromotionsService(prisma as never);
    const commission = new CommissionService(prisma as never);
    service = new OrdersService(
      prisma as never,
      inventory,
      promotions,
      commission,
      audit as never,
    );
  });

  function stubVariants() {
    // Two variants from two different partners.
    prisma.productVariant.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => {
      if (where.id === 1) {
        return {
          id: 1,
          sku: 'A-1',
          basePrice: 10000,
          product: { id: 1, partnerId: 1, categoryId: 1, name: 'Sản phẩm A' },
        };
      }
      return {
        id: 2,
        sku: 'B-1',
        basePrice: 20000,
        product: { id: 2, partnerId: 2, categoryId: 1, name: 'Sản phẩm B' },
      };
    });
  }

  function stubNoPromotions() {
    // No active product discount, no flash sale.
    prisma.flashSaleItem.findFirst.mockResolvedValue(null);
    prisma.productDiscount.findFirst.mockResolvedValue(null);
  }

  function stubFefoStock() {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      {
        id: 1,
        warehouseId: 1,
        productLotId: 1,
        productVariantId: 1,
        onHand: 100,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
        productLot: {
          id: 1,
          expiresAt: new Date('2026-12-01'),
          status: ProductLotStatus.SELLABLE,
          qcInspections: [{ result: 'PASS', inspectedAt: new Date() }],
        },
      },
    ]);
  }

  it('snapshots prices and splits the order by partner', async () => {
    stubVariants();
    stubNoPromotions();
    prisma.order.count.mockResolvedValue(0);
    prisma.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 100,
      ...data,
    }));
    prisma.partnerOrder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: Math.floor(Math.random() * 1000),
      ...data,
    }));
    prisma.orderItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: Math.floor(Math.random() * 1000),
      ...data,
    }));
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
    ]);
    // FEFO for variant 1 and variant 2.
    prisma.inventoryBalance.findMany.mockImplementation(
      async ({ where }: { where: { productVariantId: number } }) => [
        {
          id: where.productVariantId,
          warehouseId: 1,
          productLotId: where.productVariantId,
          productVariantId: where.productVariantId,
          onHand: 100,
          reserved: 0,
          blocked: 0,
          unit: 'kg',
          productLot: {
            id: where.productVariantId,
            expiresAt: new Date('2026-12-01'),
            status: ProductLotStatus.SELLABLE,
            qcInspections: [{ result: 'PASS', inspectedAt: new Date() }],
          },
        },
      ],
    );
    prisma.inventoryBalance.findUniqueOrThrow.mockImplementation(
      async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        warehouseId: 1,
        productLotId: where.id,
        productVariantId: where.id,
        onHand: 100,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      }),
    );
    prisma.inventoryBalance.update.mockResolvedValue({});
    prisma.inventoryAllocation.create.mockResolvedValue({});
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.payment.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

    const order = await service.checkout(7, {
      shippingAddress: {
        recipientName: 'Test',
        phone: '0900000000',
        province: 'Hưng Yên',
        detail: 'abc',
      },
      items: [
        { productVariantId: 1, quantity: 2 },
        { productVariantId: 2, quantity: 1 },
      ],
      shippingFee: 20000,
    });

    // subtotal = 2*10000 + 1*20000 = 40000; grandTotal = 60000
    expect(order.subtotal).toBe(40000);
    expect(order.grandTotal).toBe(60000);

    // Two partner orders created (one per partner).
    expect(prisma.partnerOrder.create).toHaveBeenCalledTimes(2);

    // Order item snapshots the unit price.
    const itemCalls = prisma.orderItem.create.mock.calls.map(
      (c) => c[0].data as { unitPriceSnapshot: number; skuSnapshot: string },
    );
    expect(itemCalls.find((i) => i.skuSnapshot === 'A-1')?.unitPriceSnapshot).toBe(10000);
    expect(itemCalls.find((i) => i.skuSnapshot === 'B-1')?.unitPriceSnapshot).toBe(20000);
  });

  it('keeps COD payments PENDING at checkout', async () => {
    stubVariants();
    stubNoPromotions();
    stubFefoStock();
    prisma.order.count.mockResolvedValue(0);
    prisma.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 1,
      ...data,
    }));
    prisma.partnerOrder.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: 1,
      ...(data as object),
    }));
    prisma.orderItem.create.mockResolvedValue({ id: 1 });
    prisma.commissionRule.findMany.mockResolvedValue([
      { id: 1, partnerId: null, categoryId: null, ratePercent: 5 },
    ]);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      warehouseId: 1,
      productLotId: 1,
      productVariantId: 1,
      onHand: 100,
      reserved: 0,
      blocked: 0,
      unit: 'kg',
    });
    prisma.inventoryBalance.update.mockResolvedValue({});
    prisma.inventoryAllocation.create.mockResolvedValue({});
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.payment.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

    await service.checkout(7, {
      shippingAddress: {
        recipientName: 'Test',
        phone: '0900000000',
        province: 'Hưng Yên',
        detail: 'abc',
      },
      items: [{ productVariantId: 1, quantity: 1 }],
      paymentMethod: 'COD',
    });

    const paymentData = prisma.payment.create.mock.calls[0][0].data as { status: string };
    expect(paymentData.status).toBe(PaymentStatus.PENDING);
  });
});
