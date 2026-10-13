import { describe, it, expect, beforeEach } from 'vitest';
import { WarehouseDocumentsService } from '../../src/inventory/warehouse-documents.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

function makeService(prisma: MockPrisma) {
  const inventory = {
    getOrCreateBalance: async () => ({ id: 1 }),
    changeOnHand: async () => ({ before: 0, after: 1 }),
    recordMovement: async () => undefined,
  };
  const audit = { record: async () => undefined };
  return new WarehouseDocumentsService(prisma as never, inventory as never, audit as never);
}

const draftDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  warehouseId: 1,
  type: 'INBOUND',
  status: 'DRAFT',
  sourceType: null,
  note: 'ghi chú cũ',
  lines: [{ id: 10, productLotId: 1, productVariantId: 1, quantity: 5, unit: 'kg' }],
  ...overrides,
});

describe('Warehouse DRAFT edit/cancel (GĐ3)', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    // Warehouse is ACTIVE by default in these scenarios.
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'ACTIVE' }]);
  });

  it('edits the note of a DRAFT without touching stock', async () => {
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc());
    prisma.warehouseDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(draftDoc({ note: 'mới' }));

    const service = makeService(prisma);
    await service.updateDraft(1, { note: 'mới' }, 7);

    expect(prisma.warehouseDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'DRAFT' },
      data: { note: 'mới' },
    });
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('replaces DRAFT lines after validating lot/variant', async () => {
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc());
    prisma.productLot.findUnique.mockResolvedValue({ id: 1, unit: 'kg' });
    prisma.productVariant.findUnique.mockResolvedValue({ id: 2, productId: 3 });
    prisma.warehouseDocumentLine.deleteMany.mockResolvedValue({ count: 1 });
    prisma.warehouseDocumentLine.createMany.mockResolvedValue({ count: 1 });
    prisma.warehouseDocumentLine.findMany.mockResolvedValue([]);
    prisma.warehouseDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(draftDoc());

    const service = makeService(prisma);
    await service.updateDraft(
      1,
      { lines: [{ productLotId: 1, productVariantId: 2, quantity: 4, unit: 'kg' }] },
      7,
    );

    expect(prisma.warehouseDocumentLine.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 1 },
    });
    expect(prisma.warehouseDocumentLine.createMany).toHaveBeenCalled();
  });

  it('rejects duplicate lot+variant lines', async () => {
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc());

    const service = makeService(prisma);
    await expect(
      service.updateDraft(
        1,
        {
          lines: [
            { productLotId: 1, productVariantId: 1, quantity: 2, unit: 'kg' },
            { productLotId: 1, productVariantId: 1, quantity: 3, unit: 'kg' },
          ],
        },
        7,
      ),
    ).rejects.toThrow(/trùng/);
  });

  it('rejects editing a COMPLETED document', async () => {
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc({ status: 'COMPLETED' }));

    const service = makeService(prisma);
    await expect(service.updateDraft(1, { note: 'x' }, 7)).rejects.toThrow(/nháp/);
    expect(prisma.warehouseDocument.updateMany).not.toHaveBeenCalled();
  });

  it('rejects editing a document with a business source', async () => {
    prisma.warehouseDocument.findUnique.mockResolvedValue(
      draftDoc({ sourceType: 'Order', sourceId: 5 }),
    );

    const service = makeService(prisma);
    await expect(service.updateDraft(1, { note: 'x' }, 7)).rejects.toThrow(/nguồn/);
  });

  it('cancels a DRAFT with DRAFT → CANCELLED and no stock change', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'DRAFT', sourceType: null }]);
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc());
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(draftDoc());
    prisma.warehouseDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(
      draftDoc({ status: 'CANCELLED' }),
    );

    const service = makeService(prisma);
    await service.cancelDraft(1, 7);

    expect(prisma.warehouseDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'DRAFT' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('cancel is idempotent when already CANCELLED', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'CANCELLED', sourceType: null }]);
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc({ status: 'CANCELLED' }));
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(
      draftDoc({ status: 'CANCELLED' }),
    );

    const service = makeService(prisma);
    await service.cancelDraft(1, 7);

    expect(prisma.warehouseDocument.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cancelling a COMPLETED document', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'COMPLETED', sourceType: null }]);
    prisma.warehouseDocument.findUnique.mockResolvedValue(draftDoc({ status: 'COMPLETED' }));

    const service = makeService(prisma);
    await expect(service.cancelDraft(1, 7)).rejects.toThrow(/nháp/);
    expect(prisma.warehouseDocument.updateMany).not.toHaveBeenCalled();
  });

  it('a cancel losing a concurrent cancel race returns the CANCELLED row idempotently', async () => {
    // This branch won the row lock and read DRAFT; the peer cancel commits
    // first so the conditional claim matches 0 rows, but the re-read sees
    // CANCELLED and returns idempotently.
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'DRAFT', sourceType: null }]);
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValueOnce(draftDoc());
    prisma.warehouseDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValueOnce({ status: 'CANCELLED' });
    prisma.warehouseDocument.findUniqueOrThrow.mockResolvedValue(
      draftDoc({ status: 'CANCELLED' }),
    );

    const service = makeService(prisma);
    let auditCalls = 0;
    (service as unknown as { audit: { record: () => Promise<void> } }).audit = {
      record: async () => {
        auditCalls += 1;
      },
    };
    const result = await service.cancelDraft(1, 7);

    expect(result.status).toBe('CANCELLED');
    expect(auditCalls).toBe(0);
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });
});
