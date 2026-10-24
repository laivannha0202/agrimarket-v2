import { describe, it, expect, beforeEach } from 'vitest';
import { QuarantineService } from '../../src/quarantine/quarantine.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { QcResult, QuarantineCaseStatus } from '../../generated/prisma/enums.js';

/**
 * Quarantine never releases stock automatically:
 *   PENDING -> PASSED -> RELEASED  (blocked decreases, stock becomes sellable)
 *   PENDING -> FAILED -> SCRAPPED  (blocked + on-hand decrease, lot shrinks)
 */
describe('Quarantine lifecycle', () => {
  let prisma: MockPrisma;
  let service: QuarantineService;
  const audit = { record: async () => undefined };

  function caseRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      code: 'QTN-20261023-0001',
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      quantity: 5,
      status: QuarantineCaseStatus.PENDING,
      sourceType: 'ORDER_CANCEL',
      stockAddedToBalance: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new QuarantineService(
      prisma as never,
      audit as never,
      new InventoryService(prisma as never, audit as never),
    );
  });

  it('creates a case with a dated QTN code inside the caller transaction', async () => {
    prisma.quarantineCase.findMany.mockResolvedValue([]);
    prisma.quarantineCase.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 3, ...data }),
    );

    const created = await service.createCase(prisma as never, {
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      quantity: 5,
      sourceType: 'ORDER_CANCEL',
      sourceId: 11,
      orderId: 11,
      stockAddedToBalance: false,
    });

    expect(created.code).toMatch(/^QTN-\d{8}-0001$/);
    expect(prisma.quarantineCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quantity: 5,
        status: QuarantineCaseStatus.PENDING,
        sourceType: 'ORDER_CANCEL',
        orderId: 11,
      }),
    });
  });

  it('records PASS without moving stock', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(caseRow());
    prisma.quarantineCase.updateMany.mockResolvedValue({ count: 1 });
    prisma.traceEvent.create.mockResolvedValue({});
    prisma.quarantineCase.findUniqueOrThrow.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.PASSED }),
    );

    const updated = await service.inspect(1, { result: QcResult.PASS }, 99);

    expect(updated.status).toBe(QuarantineCaseStatus.PASSED);
    expect(prisma.quarantineCase.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: QuarantineCaseStatus.PENDING },
      data: expect.objectContaining({ status: QuarantineCaseStatus.PASSED }),
    });
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
  });

  it('requires a note when the re-inspection fails', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(caseRow());

    await expect(
      service.inspect(1, { result: QcResult.FAIL }, 99),
    ).rejects.toThrow(/requires a reason/);
    expect(prisma.quarantineCase.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to re-inspect a resolved case', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.RELEASED }),
    );

    await expect(
      service.inspect(1, { result: QcResult.PASS }, 99),
    ).rejects.toThrow(/Only PENDING quarantine cases/);
  });

  it('RELEASE moves blocked stock back to sellable and records QUARANTINE_RELEASE', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.PASSED }),
    );
    prisma.inventoryBalance.findUnique.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      onHand: 100,
      reserved: 0,
      blocked: 5,
    });
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      onHand: 100,
      reserved: 0,
      blocked: 0,
    });
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.quarantineCase.updateMany.mockResolvedValue({ count: 1 });
    prisma.traceEvent.create.mockResolvedValue({});
    prisma.quarantineCase.findUniqueOrThrow.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.RELEASED }),
    );

    const resolved = await service.resolve(1, { action: 'RELEASE' }, 99);

    expect(resolved.status).toBe(QuarantineCaseStatus.RELEASED);
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'QUARANTINE_RELEASE',
        quantityDelta: 0,
        referenceType: 'QuarantineCase',
        referenceId: 1,
      }),
    });
    // Release must not change on-hand or the lot's remaining quantity.
    expect(prisma.productLot.update).not.toHaveBeenCalled();
    expect(prisma.quarantineCase.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: QuarantineCaseStatus.PASSED },
      data: expect.objectContaining({ status: QuarantineCaseStatus.RELEASED }),
    });
  });

  it('refuses RELEASE before the case passed inspection', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(caseRow());

    await expect(service.resolve(1, { action: 'RELEASE' }, 99)).rejects.toThrow(
      /Only PASSED quarantine cases/,
    );
    expect(prisma.inventoryBalance.findUnique).not.toHaveBeenCalled();
  });

  it('SCRAP reduces blocked and on-hand, shrinks the lot and records SCRAP', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.FAILED }),
    );
    prisma.inventoryBalance.findUnique.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      onHand: 100,
      reserved: 0,
      blocked: 5,
    });
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      onHand: 95,
      reserved: 0,
      blocked: 0,
    });
    prisma.inventoryMovement.create.mockResolvedValue({});
    prisma.quarantineCase.updateMany.mockResolvedValue({ count: 1 });
    prisma.traceEvent.create.mockResolvedValue({});
    prisma.quarantineCase.findUniqueOrThrow.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.SCRAPPED }),
    );

    const resolved = await service.resolve(
      1,
      { action: 'SCRAP', note: 'Mốc hỏng' },
      99,
    );

    expect(resolved.status).toBe(QuarantineCaseStatus.SCRAPPED);
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'SCRAP',
        quantityDelta: -5,
        referenceType: 'QuarantineCase',
      }),
    });
    // Two raw stock statements: the guarded balance update and the guarded lot
    // remaining-quantity decrement.
    const lotStatement = prisma.$executeRaw.mock.calls.find((call) =>
      String(call[0]).includes('product_lots'),
    );
    expect(lotStatement).toBeDefined();
    expect(prisma.quarantineCase.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: QuarantineCaseStatus.FAILED },
      data: expect.objectContaining({ status: QuarantineCaseStatus.SCRAPPED }),
    });
  });

  it('rolls back SCRAP when the lot no longer holds the quantity', async () => {
    prisma.quarantineCase.findUnique.mockResolvedValue(
      caseRow({ status: QuarantineCaseStatus.FAILED }),
    );
    prisma.inventoryBalance.findUnique.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      onHand: 100,
      reserved: 0,
      blocked: 5,
    });
    // First raw statement claims blocked/on-hand, second is the lot guard.
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.inventoryBalance.findUniqueOrThrow.mockResolvedValue({
      id: 9,
      warehouseId: 1,
      productLotId: 77,
      productVariantId: 9,
      onHand: 95,
      reserved: 0,
      blocked: 0,
    });

    await expect(service.resolve(1, { action: 'SCRAP' }, 99)).rejects.toThrow(
      /lot quantity changed/,
    );
    expect(prisma.quarantineCase.updateMany).not.toHaveBeenCalled();
  });
});
