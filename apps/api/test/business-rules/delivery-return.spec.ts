import { describe, it, expect, beforeEach } from 'vitest';
import { ShipmentsService } from '../../src/shipments/shipments.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { QuarantineService } from '../../src/quarantine/quarantine.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import {
  OrderStatus,
  PartnerOrderStatus,
  ShipmentStatus,
  TraceEventType,
} from '../../generated/prisma/enums.js';

/**
 * Shipment lifecycle after P0-B:
 *  - creation only from READY_TO_SHIP and idempotent for the same parcel;
 *  - delivery only while the order/partner order are SHIPPING;
 *  - a returned parcel is quarantined, never made sellable again.
 */
describe('Delivery failure & return rules', () => {
  let prisma: MockPrisma;
  let service: ShipmentsService;
  const audit = { record: async () => undefined };

  function shipmentRow(
    status: ShipmentStatus,
    partnerStatus: PartnerOrderStatus = PartnerOrderStatus.SHIPPING,
    orderStatus: OrderStatus = OrderStatus.SHIPPING,
  ) {
    return {
      id: 1,
      code: 'SHP-1',
      partnerOrderId: 10,
      status,
      partnerOrder: {
        id: 10,
        code: 'PO-1',
        status: partnerStatus,
        order: { id: 5, code: 'ORD-1', status: orderStatus },
      },
    };
  }

  // updateStatus reads the relationship once, then re-reads the locked row,
  // and finally fetches the updated row after its compare-and-set.
  function mockShipmentTransition(
    original: ReturnType<typeof shipmentRow>,
    nextStatus?: ShipmentStatus,
  ) {
    prisma.shipment.findUnique.mockResolvedValue(original);
    prisma.shipment.findUniqueOrThrow.mockResolvedValueOnce(original);
    if (nextStatus) {
      prisma.shipment.findUniqueOrThrow.mockResolvedValueOnce({
        ...original,
        status: nextStatus,
      });
    }
  }

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.partnerOrder.findUnique.mockResolvedValue({ orderId: 5 });
    const inventory = new InventoryService(prisma as never, audit as never);
    service = new ShipmentsService(
      prisma as never,
      audit as never,
      inventory,
      new QuarantineService(prisma as never, audit as never, inventory),
    );
  });

  it('follows the OUT_FOR_DELIVERY -> DELIVERY_FAILED -> RETURNING -> RETURNED path', async () => {
    const base = shipmentRow(ShipmentStatus.OUT_FOR_DELIVERY);
    mockShipmentTransition(base, ShipmentStatus.DELIVERY_FAILED);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerOrder.count.mockResolvedValue(1);

    const updated = await service.updateStatus(
      1,
      { status: ShipmentStatus.DELIVERY_FAILED, failureReason: 'Khách không nhận hàng' },
      99,
    );

    expect(updated.status).toBe(ShipmentStatus.DELIVERY_FAILED);
    expect(prisma.partnerOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: PartnerOrderStatus.SHIPPING },
      }),
    );
    // A failed attempt never marks the order delivered.
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid shipment transition', async () => {
    mockShipmentTransition(shipmentRow(ShipmentStatus.DELIVERED));

    await expect(
      service.updateStatus(1, { status: ShipmentStatus.IN_TRANSIT }, 99),
    ).rejects.toThrow(/Cannot change shipment status/);
  });

  it('creates a shipment only when the order and partner order are READY_TO_SHIP', async () => {
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      status: PartnerOrderStatus.CONFIRMED,
      order: { id: 5, code: 'ORD-1', status: OrderStatus.READY_TO_SHIP },
    });

    await expect(
      service.create({ partnerOrderId: 10, carrier: 'GHN', trackingCode: 'T1' }),
    ).rejects.toThrow(/both the order and the partner order are READY_TO_SHIP/);
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('refuses a shipment for a cancelled order', async () => {
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      status: PartnerOrderStatus.READY_TO_SHIP,
      order: { id: 5, code: 'ORD-1', status: OrderStatus.CANCELLED },
    });

    await expect(
      service.create({ partnerOrderId: 10, carrier: 'GHN', trackingCode: 'T1' }),
    ).rejects.toThrow(/cancelled order/);
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('replays the same shipment instead of opening a second parcel', async () => {
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      status: PartnerOrderStatus.READY_TO_SHIP,
      order: { id: 5, code: 'ORD-1', status: OrderStatus.READY_TO_SHIP },
    });
    const existing = { id: 3, code: 'SHP-3', carrier: 'GHN', trackingCode: 'T1' };
    prisma.shipment.findFirst.mockResolvedValue(existing);

    const created = await service.create({
      partnerOrderId: 10,
      carrier: 'GHN',
      trackingCode: 'T1',
    });

    expect(created).toBe(existing);
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('rejects a second active shipment with a different carrier/tracking (409)', async () => {
    prisma.partnerOrder.findUniqueOrThrow.mockResolvedValue({
      id: 10,
      code: 'PO-1',
      status: PartnerOrderStatus.READY_TO_SHIP,
      order: { id: 5, code: 'ORD-1', status: OrderStatus.READY_TO_SHIP },
    });
    prisma.shipment.findFirst.mockResolvedValue({
      id: 3,
      code: 'SHP-3',
      carrier: 'GHN',
      trackingCode: 'T1',
    });

    await expect(
      service.create({ partnerOrderId: 10, carrier: 'GHTK', trackingCode: 'T2' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('moves both partner order and order to SHIPPING on IN_TRANSIT', async () => {
    const base = shipmentRow(
      ShipmentStatus.READY,
      PartnerOrderStatus.READY_TO_SHIP,
      OrderStatus.READY_TO_SHIP,
    );
    mockShipmentTransition(base, ShipmentStatus.IN_TRANSIT);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await service.updateStatus(1, { status: ShipmentStatus.IN_TRANSIT }, 99);

    expect(prisma.partnerOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: PartnerOrderStatus.READY_TO_SHIP },
      data: { status: PartnerOrderStatus.SHIPPING },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: OrderStatus.READY_TO_SHIP },
      data: { status: OrderStatus.SHIPPING },
    });
  });

  it('DELIVERED consumes the reservation once and a replay is idempotent', async () => {
    const base = shipmentRow(ShipmentStatus.OUT_FOR_DELIVERY);
    mockShipmentTransition(base, ShipmentStatus.DELIVERED);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    // The delivered parcel is the evidence that lets the order roll up.
    prisma.partnerOrder.findMany.mockResolvedValue([
      {
        id: 10,
        code: 'PO-1',
        status: PartnerOrderStatus.DELIVERED,
        shipments: [
          {
            id: 1,
            code: 'SHP-1',
            status: ShipmentStatus.DELIVERED,
            deliveredAt: new Date('2026-11-01T10:00:00.000Z'),
          },
        ],
      },
    ]);
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
    // second consume. The locked row now reads DELIVERED.
    prisma.shipment.findUnique.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERED });
    prisma.shipment.findUniqueOrThrow.mockResolvedValue({ ...base, status: ShipmentStatus.DELIVERED });
    prisma.inventoryMovement.create.mockClear();
    const replay = await service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99);
    expect(replay.status).toBe(ShipmentStatus.DELIVERED);
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.shipment.updateMany).toHaveBeenCalledTimes(1);
  });

  it('refuses DELIVERED unless the order and partner order are SHIPPING', async () => {
    mockShipmentTransition(
      shipmentRow(
        ShipmentStatus.OUT_FOR_DELIVERY,
        PartnerOrderStatus.READY_TO_SHIP,
        OrderStatus.READY_TO_SHIP,
      ),
    );

    await expect(
      service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses DELIVERED for a cancelled order', async () => {
    mockShipmentTransition(
      shipmentRow(
        ShipmentStatus.OUT_FOR_DELIVERY,
        PartnerOrderStatus.CANCELLED,
        OrderStatus.CANCELLED,
      ),
    );

    await expect(
      service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99),
    ).rejects.toThrow(/cancelled order/);
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses cancellation after the parcel left the warehouse', async () => {
    mockShipmentTransition(shipmentRow(ShipmentStatus.OUT_FOR_DELIVERY));

    await expect(
      service.updateStatus(1, { status: ShipmentStatus.CANCELLED }, 99),
    ).rejects.toThrow(/Cannot change shipment status/);
  });

  it('a concurrent DELIVERED loses the compare-and-set instead of consuming twice', async () => {
    mockShipmentTransition(shipmentRow(ShipmentStatus.OUT_FOR_DELIVERY));
    // Another request claimed the row first: 0 rows match.
    prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99)).rejects.toThrow(
      /status changed/,
    );
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('DELIVERED on an already-DELIVERED partner order records the event without consuming again', async () => {
    const base = shipmentRow(
      ShipmentStatus.OUT_FOR_DELIVERY,
      PartnerOrderStatus.DELIVERED,
      OrderStatus.DELIVERED,
    );
    mockShipmentTransition(base, ShipmentStatus.DELIVERED);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    // Partner order already DELIVERED and order already DELIVERED: 0 rows
    // claimed at both levels, no consume.
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    prisma.partnerOrder.findMany.mockResolvedValue([
      {
        id: 10,
        code: 'PO-1',
        status: PartnerOrderStatus.DELIVERED,
        shipments: [
          {
            id: 1,
            code: 'SHP-1',
            status: ShipmentStatus.DELIVERED,
            deliveredAt: new Date('2026-11-01T10:00:00.000Z'),
          },
        ],
      },
    ]);

    const updated = await service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99);

    expect(updated.status).toBe(ShipmentStatus.DELIVERED);
    expect(prisma.shipmentEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('does not roll the order up while a sibling shipment is still active', async () => {
    const base = shipmentRow(ShipmentStatus.OUT_FOR_DELIVERY);
    mockShipmentTransition(base, ShipmentStatus.DELIVERED);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    // A second parcel of the same partner order is still moving.
    prisma.shipment.count.mockResolvedValue(1);
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.partnerOrder.findMany.mockResolvedValue([
      {
        id: 10,
        code: 'PO-1',
        status: PartnerOrderStatus.SHIPPING,
        shipments: [
          {
            id: 1,
            code: 'SHP-1',
            status: ShipmentStatus.DELIVERED,
            deliveredAt: new Date('2026-11-01T10:00:00.000Z'),
          },
          {
            id: 2,
            code: 'SHP-2',
            status: ShipmentStatus.IN_TRANSIT,
            deliveredAt: null,
          },
        ],
      },
    ]);

    await service.updateStatus(1, { status: ShipmentStatus.DELIVERED }, 99);

    // The delivered parcel is recorded, but the order is not complete: the
    // partner order and the parent order must stay SHIPPING.
    expect(prisma.partnerOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('quarantines a RETURNED parcel and never makes the stock sellable again', async () => {
    const base = shipmentRow(ShipmentStatus.RETURNING);
    mockShipmentTransition(base, ShipmentStatus.RETURNED);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.inventoryAllocation.findMany.mockResolvedValue([
      {
        id: 1,
        productLotId: 77,
        quantity: 5,
        inventoryBalance: {
          id: 9,
          warehouseId: 1,
          productLotId: 77,
          productVariantId: 1,
          reserved: 5,
          blocked: 0,
        },
      },
    ]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 1,
      reserved: 0,
      blocked: 5,
      onHand: 100,
    });
    prisma.traceEvent.create.mockResolvedValue({});
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.partnerOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerOrder.count.mockResolvedValue(0);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await service.updateStatus(1, { status: ShipmentStatus.RETURNED }, 99);

    // The units became blocked stock, with one quarantine case for the parcel.
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'QUARANTINE' }),
      }),
    );
    expect(prisma.quarantineCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'SHIPMENT_RETURN',
          quantity: 5,
          stockAddedToBalance: false,
        }),
      }),
    );
    // A RETURNED trace event was written for the lot...
    expect(prisma.traceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: TraceEventType.RETURNED, productLotId: 77 }),
      }),
    );
    // ...the partner order was cancelled and the order followed because no
    // other active partner order remains.
    expect(prisma.partnerOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: PartnerOrderStatus.CANCELLED } }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: OrderStatus.CANCELLED } }),
    );
    // No path adds the units back to sellable stock.
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    const lotStatusUpdates = prisma.productLot.update.mock.calls.filter(
      (c) => (c[0]?.data as { status?: string })?.status === 'SELLABLE',
    );
    expect(lotStatusUpdates).toHaveLength(0);
  });

  it('does not quarantine a returned parcel twice when the order was already cancelled', async () => {
    const base = shipmentRow(
      ShipmentStatus.RETURNING,
      PartnerOrderStatus.CANCELLED,
      OrderStatus.CANCELLED,
    );
    mockShipmentTransition(base, ShipmentStatus.RETURNED);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});
    prisma.partnerOrder.count.mockResolvedValue(0);

    await service.updateStatus(1, { status: ShipmentStatus.RETURNED }, 99);

    // The cancellation path already converted the reservations; a second
    // conversion would fabricate blocked stock that never existed. The lot
    // allocation is still read to build the trace list, but no quarantine
    // movement or case may be created.
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.quarantineCase.create).not.toHaveBeenCalled();
  });

  it('keeps quarantine and stock untouched when RETURNED is replayed', async () => {
    // The delivery webhook is at-least-once: a retry after the first RETURNED
    // committed must be a pure read after the row lock.
    const base = shipmentRow(ShipmentStatus.RETURNED);
    mockShipmentTransition(base);

    const replay = await service.updateStatus(1, { status: ShipmentStatus.RETURNED }, 99);

    expect(replay.status).toBe(ShipmentStatus.RETURNED);
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.quarantineCase.create).not.toHaveBeenCalled();
  });

  it('syncs an order cancellation: pre-handover parcels cancel, travelling parcels return, terminal states stay', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      { id: 1, status: ShipmentStatus.PENDING },
      { id: 2, status: ShipmentStatus.READY },
      { id: 3, status: ShipmentStatus.IN_TRANSIT },
      { id: 4, status: ShipmentStatus.OUT_FOR_DELIVERY },
      { id: 5, status: ShipmentStatus.DELIVERY_FAILED },
      { id: 6, status: ShipmentStatus.RETURNING },
      { id: 7, status: ShipmentStatus.DELIVERED },
      { id: 8, status: ShipmentStatus.RETURNED },
      { id: 9, status: ShipmentStatus.CANCELLED },
    ]);
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});

    await service.syncOrderCancellation(prisma as never, 5, 99);

    expect(prisma.shipment.updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 1, status: ShipmentStatus.PENDING }, data: { status: ShipmentStatus.CANCELLED } },
      { where: { id: 2, status: ShipmentStatus.READY }, data: { status: ShipmentStatus.CANCELLED } },
      { where: { id: 3, status: ShipmentStatus.IN_TRANSIT }, data: { status: ShipmentStatus.RETURNING } },
      { where: { id: 4, status: ShipmentStatus.OUT_FOR_DELIVERY }, data: { status: ShipmentStatus.RETURNING } },
      { where: { id: 5, status: ShipmentStatus.DELIVERY_FAILED }, data: { status: ShipmentStatus.RETURNING } },
    ]);
    expect(prisma.shipmentEvent.create).toHaveBeenCalledTimes(5);
  });

  it('a losing cancellation CAS writes no shipment event', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      { id: 1, status: ShipmentStatus.READY },
      { id: 2, status: ShipmentStatus.OUT_FOR_DELIVERY },
    ]);
    // Shipment 1 was claimed by another request; shipment 2 still wins.
    prisma.shipment.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.shipmentEvent.create.mockResolvedValue({});

    await service.syncOrderCancellation(prisma as never, 5, 99);

    expect(prisma.shipmentEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shipmentId: 2,
        status: ShipmentStatus.RETURNING,
      }),
    });
  });
});
