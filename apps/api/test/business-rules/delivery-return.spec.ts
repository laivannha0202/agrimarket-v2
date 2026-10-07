import { describe, it, expect, beforeEach } from 'vitest';
import { ShipmentsService } from '../../src/shipments/shipments.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { ShipmentStatus, TraceEventType } from '../../generated/prisma/enums.js';

describe('Delivery failure & return rules', () => {
  let prisma: MockPrisma;
  let service: ShipmentsService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ShipmentsService(prisma as never, audit as never);
  });

  it('follows the OUT_FOR_DELIVERY -> DELIVERY_FAILED -> RETURNING -> RETURNED path', async () => {
    const base = {
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
    };
    prisma.shipment.findUnique.mockResolvedValue(base);
    prisma.shipment.update.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERY_FAILED });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      orderId: 5,
      items: [],
    });
    prisma.partnerOrder.update.mockResolvedValue({});
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

  it('writes a RETURNED trace event and does NOT add stock back to sellable', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status: ShipmentStatus.RETURNING,
    });
    prisma.shipment.update.mockResolvedValue({ id: 1, status: ShipmentStatus.RETURNED });
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
