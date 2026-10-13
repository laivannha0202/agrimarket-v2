import { describe, it, expect, beforeEach } from 'vitest';
import { WarehousesService } from '../../src/warehouses/warehouses.service.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

function makeWarehouseService(prisma: MockPrisma) {
  const audit = { record: async () => undefined };
  return new WarehousesService(prisma as never, audit as never);
}

describe('Warehouse deactivation guard (GĐ2)', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('creates with the next free WH code (never count+1)', async () => {
    prisma.warehouse.findMany.mockResolvedValue([{ code: 'WH-0001' }, { code: 'WH-0003' }]);
    prisma.warehouse.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 9,
      ...args.data,
    }));

    const service = makeWarehouseService(prisma);
    const created = await service.create({ name: 'Kho mới', address: 'Hưng Yên' }, 1);

    expect(created.code).toBe('WH-0004');
  });

  it('rejects a blank name or address', async () => {
    const service = makeWarehouseService(prisma);
    await expect(service.create({ name: '  ', address: 'x' }, 1)).rejects.toThrow(
      /Tên kho/,
    );
    await expect(service.create({ name: 'Kho', address: '  ' }, 1)).rejects.toThrow(
      /Địa chỉ/,
    );
  });

  it('refuses ACTIVE → INACTIVE while on-hand stock remains', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, status: 'ACTIVE' }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ onHand: 5, reserved: 0, blocked: 0 }]);

    const service = makeWarehouseService(prisma);
    await expect(service.update(1, { status: 'INACTIVE' }, 7)).rejects.toThrow(
      /tồn thực tế/,
    );
    expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
  });

  it('refuses ACTIVE → INACTIVE while reserved stock remains', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, status: 'ACTIVE' }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ onHand: 0, reserved: 3, blocked: 0 }]);

    const service = makeWarehouseService(prisma);
    await expect(service.update(1, { status: 'INACTIVE' }, 7)).rejects.toThrow(/giữ chỗ/);
    expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
  });

  it('refuses ACTIVE → INACTIVE while blocked stock remains', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, status: 'ACTIVE' }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ onHand: 0, reserved: 0, blocked: 2 }]);

    const service = makeWarehouseService(prisma);
    await expect(service.update(1, { status: 'INACTIVE' }, 7)).rejects.toThrow(/cách ly/);
    expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
  });

  it('refuses ACTIVE → INACTIVE while a DRAFT document is open', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, status: 'ACTIVE' }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ onHand: 0, reserved: 0, blocked: 0 }]);
    prisma.warehouseDocument.count.mockResolvedValue(2);

    const service = makeWarehouseService(prisma);
    await expect(service.update(1, { status: 'INACTIVE' }, 7)).rejects.toThrow(/phiếu nháp/);
    expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
  });

  it('refuses ACTIVE → INACTIVE while an open order allocation uses the warehouse', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, status: 'ACTIVE' }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ onHand: 0, reserved: 0, blocked: 0 }]);
    prisma.warehouseDocument.count.mockResolvedValue(0);
    prisma.inventoryAllocation.count.mockResolvedValue(1);

    const service = makeWarehouseService(prisma);
    await expect(service.update(1, { status: 'INACTIVE' }, 7)).rejects.toThrow(/cấp phát/);
    expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
  });

  it('deactivates an empty warehouse with no open business', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, status: 'ACTIVE' }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ onHand: 0, reserved: 0, blocked: 0 }]);
    prisma.warehouseDocument.count.mockResolvedValue(0);
    prisma.inventoryAllocation.count.mockResolvedValue(0);
    prisma.warehouse.findUniqueOrThrow.mockResolvedValue({ id: 1, status: 'ACTIVE' });
    prisma.warehouse.updateMany.mockResolvedValue({ count: 1 });

    const service = makeWarehouseService(prisma);
    await service.update(1, { name: 'Kho đóng', status: 'INACTIVE' }, 7);

    expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'INACTIVE' }),
    });
  });
});

describe('Inactive warehouse blocks new stock business (GĐ2)', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('requireActiveWarehouse refuses an INACTIVE warehouse', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'INACTIVE' }]);
    await expect(InventoryService.requireActiveWarehouse(prisma as never, 1)).rejects.toThrow(
      /ngừng hoạt động/,
    );
  });

  it('requireActiveWarehouse passes an ACTIVE warehouse', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'ACTIVE' }]);
    await expect(
      InventoryService.requireActiveWarehouse(prisma as never, 1),
    ).resolves.toBeUndefined();
  });

  it('inbound at an INACTIVE warehouse is refused before any balance write', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'INACTIVE' }]);
    const audit = { record: async () => undefined };
    const service = new InventoryService(prisma as never, audit as never);

    await expect(
      service.inbound({ warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 5 }, 1),
    ).rejects.toThrow(/ngừng hoạt động/);
    expect(prisma.inventoryBalance.findUnique).not.toHaveBeenCalled();
  });

  it('reserve at an INACTIVE warehouse is refused before any balance read', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1, status: 'INACTIVE' }]);
    const audit = { record: async () => undefined };
    const service = new InventoryService(prisma as never, audit as never);

    await expect(
      service.reserve({ warehouseId: 1, productLotId: 1, productVariantId: 1, quantity: 5 }, 1),
    ).rejects.toThrow(/ngừng hoạt động/);
    expect(prisma.inventoryBalance.findUnique).not.toHaveBeenCalled();
  });
});
