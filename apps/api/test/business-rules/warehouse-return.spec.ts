import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarehouseDocumentsService } from '../../src/inventory/warehouse-documents.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * A manual warehouse RETURN document is a physical receipt, not a saleable
 * inbound: the units must go straight into quarantine until QC decides.
 */
describe('Warehouse RETURN document (P0-C)', () => {
  let prisma: MockPrisma;
  let inventory: {
    getOrCreateBalance: ReturnType<typeof vi.fn>;
    changeOnHand: ReturnType<typeof vi.fn>;
    receiveReturnedStock: ReturnType<typeof vi.fn>;
    recordMovement: ReturnType<typeof vi.fn>;
  };
  let service: WarehouseDocumentsService;

  const returnDoc = {
    id: 70,
    code: 'WHD-20261023-0007',
    warehouseId: 3,
    type: 'RETURN',
    status: 'DRAFT',
    sourceType: null,
    note: null,
    lines: [{ id: 1, productLotId: 77, productVariantId: 9, quantity: 5, unit: 'kg' }],
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    // One mock serves both the warehouse ACTIVE lock and the QTN sequence read.
    prisma.$queryRaw.mockResolvedValue([{ id: 3, status: 'ACTIVE', value: 1 }]);
    prisma.warehouseDocument.findUnique.mockResolvedValue({
      id: 70,
      warehouseId: 3,
    });
    prisma.warehouseDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(returnDoc);

    inventory = {
      getOrCreateBalance: vi.fn(async () => ({ id: 42 })),
      changeOnHand: vi.fn(async () => ({ before: 0, after: 5 })),
      receiveReturnedStock: vi.fn(async () => ({ before: 10, after: 15, blocked: 5 })),
      recordMovement: vi.fn(async () => undefined),
    };
    const audit = { record: async () => undefined };
    service = new WarehouseDocumentsService(
      prisma as never,
      inventory as never,
      audit as never,
    );
  });

  it('adds on-hand and blocked together, opens a quarantine case and never calls sellable inbound', async () => {
    await service.complete(70, 7);

    expect(inventory.receiveReturnedStock).toHaveBeenCalledWith(prisma, 42, 5);
    expect(inventory.changeOnHand).not.toHaveBeenCalled();
    expect(inventory.recordMovement).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'RETURN',
        quantityDelta: 5,
        beforeQuantity: 10,
        afterQuantity: 15,
        referenceType: 'WarehouseDocument',
        referenceId: 70,
      }),
    );
    expect(prisma.quarantineCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        warehouseId: 3,
        productLotId: 77,
        productVariantId: 9,
        quantity: 5,
        status: 'PENDING',
        sourceType: 'WAREHOUSE_RETURN',
        sourceId: 70,
        stockAddedToBalance: true,
      }),
    });
    expect(prisma.traceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productLotId: 77, type: 'RETURNED' }),
    });
    const traceTypes = prisma.traceEvent.create.mock.calls.map(
      (call) => (call[0] as { data: { type: string } }).data.type,
    );
    expect(traceTypes).not.toContain('WAREHOUSE_IN');
  });

  it('rolls the receipt back when the quarantine case cannot be created', async () => {
    prisma.quarantineCase.create.mockRejectedValueOnce(new Error('case write failed'));

    await expect(service.complete(70, 7)).rejects.toThrow('case write failed');
    // The service never swallows the failure: the caller's transaction owns the
    // rollback, so stock cannot commit without its quarantine case.
    expect(inventory.receiveReturnedStock).toHaveBeenCalled();
  });
});
