import { describe, it, expect, beforeEach } from 'vitest';
import { ShipmentsService } from '../../src/shipments/shipments.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { ShipmentStatus, TraceEventType } from '../../generated/prisma/enums.js';

describe('Delivery failure & return rules', () => {
  let prisma: MockPrisma;
  let service: ShipmentsService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ShipmentsService(
      prisma as never,
      audit as never,
      new InventoryService(prisma as never, audit as never),
    );
  });

  it('follows the OUT_FOR_DELIVERY -> DELIVERY_FAILED -> RETURNING -> RETURNED path', async () => {
    const base = {
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
    };
    prisma.shipment.findUnique.mockResolvedValue(base);
    // The shipment row is claimed with a conditional compare-and-set.
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipment.findUniqueOrThrow.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERY_FAILED });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      orderId: 5,
      items: [],
    });
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerOrder.count.mockResolvedValue(1);

    const updated = await service.updateStatus(
      1,
      { status: ShipmentStatus.DELIVERY_FAILED, failureReason: 'Khách không nhận hàng' },
      99,
    );

    expect(updated.status).toBe(ShipmentStatus.DELIVERY_FAILED);
    // Order should not be delivered.
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid shipment transition', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.DELIVERED,
    });

    await expect(
      service.updateStatus(1, { status: ShipmentStatus.IN_TRANSIT }, 99),
    ).rejects.toThrow(/Cannot change shipment status/);
  });

  it('DELIVERED consumes the reservation once and a replay is idempotent', async () => {
    const base = {
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
    };
    prisma.shipment.findUnique.mockResolvedValue(base);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipment.findUniqueOrThrow.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERED });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      orderId: 5,
      items: [],
    });
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.inventoryAllocation.findMany.mockResolvedValue([
      {
        id: 1,
        quantity: 5,
        productLotId: 77,
        inventoryBalanceId: 9,
        inventoryBalance: { id: 9, warehouseId: 1, productLotId: 77, productVariantId: 1 },
      },
    ]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 1,
      onHand: 95,
      reserved: 0,
      blocked: 0,
    });
    prisma.inventoryMovement.create.mockResolvedValue({});

    const updated = await service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99);

    expect(updated.status).toBe(ShipmentStatus.DELIVERED);
    const movement = prisma.inventoryMovement.create.mock.calls[0][0].data as {
      type: string;
      quantityDelta: number;
      referenceType: string;
      referenceId: number;
    };
    expect(movement.type).toBe('OUTBOUND');
    expect(movement.quantityDelta).toBe(-5);
    expect(movement.referenceType).toBe('Order');
    expect(movement.referenceId).toBe(5);

    // Replaying the same DELIVERED status is a no-op: no second event, no
    // second consume. The stored shipment now reads DELIVERED, so the service
    // takes the idempotent early return before opening a transaction.
    prisma.shipment.findUnique.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERED });
    prisma.inventoryMovement.create.mockClear();
    const replay = await service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99);
    expect(replay.status).toBe(ShipmentStatus.DELIVERED);
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.shipment.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a concurrent DELIVERED loses the compare-and-set instead of consuming twice', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
    });
    // Another request claimed the row first: 0 rows match.
    prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99)).rejects.toThrow(
      /status changed/,
    );
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('DELIVERED on an already-DELIVERED partner order records the event without consuming again', async () => {
    const base = {
      id: 2,
      code: 'SHP-2',
      partnerOrderId: 11,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
    };
    prisma.shipment.findUnique.mockResolvedValue(base);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipment.findUniqueOrThrow.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERED });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 11,
      code: 'PO-2',
      orderId: 6,
      items: [],
    });
    // Partner order already DELIVERED and order already DELIVERED: 0 rows
    // claimed at both levels, no consume.
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 6, status: 'DELIVERED' });

    const updated = await service.updateStatus(2, { status: ShipmentStatus.DELIVERED }, 99);

    expect(updated.status).toBe(ShipmentStatus.DELIVERED);
    expect(prisma.shipmentEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('writes a RETURNED trace event and does NOT add stock back to sellable', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.RETURNING,
    });
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipment.findUniqueOrThrow.mockResolvedValue({ id: 1, status: ShipmentStatus.RETURNED });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      orderId: 5,
      items: [],
    });
    prisma.inventoryAllocation.findMany.mockResolvedValue([
      { id: 1, productLotId: 77, quantity: 5 },
    ]);
    prisma.traceEvent.create.mockResolvedValue({});
    prisma.inventoryBalance.update.mockResolvedValue({});
    prisma.inventoryMovement.create.mockResolvedValue({});

    await service.updateStatus(1, { status: ShipmentStatus.RETURNED }, 99);

    // A RETURNED trace event was written for the lot...
    expect(prisma.traceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: TraceEventType.RETURNED, productLotId: 77 }),
      }),
    );
    // ...and the lot status was never set to SELLABLE.
    const lotStatusUpdates = prisma.productLot.update.mock.calls.filter(
      (c) => (c[0]?.data as { status?: string })?.status === 'SELLABLE',
    );
    expect(lotStatusUpdates).toHaveLength(0);
  });
});
