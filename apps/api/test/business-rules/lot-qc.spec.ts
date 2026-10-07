import { describe, it, expect, beforeEach } from 'vitest';
import { LotsService } from '../../src/lots/lots.service.js';
import { QualityControlService } from '../../src/quality-control/quality-control.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { ProductLotStatus, QcResult } from '../../generated/prisma/enums.js';

describe('Lot & QC rules', () => {
  let prisma: MockPrisma;
  let lots: LotsService;
  let qc: QualityControlService;
  const audit = { record: async () => undefined };

  beforeEach(() => {
    prisma = createMockPrisma();
    lots = new LotsService(prisma as never, audit as never);
    qc = new QualityControlService(prisma as never, audit as never);
  });

  describe('new lot', () => {
    it('starts as PENDING_QC, never SELLABLE', async () => {
      prisma.harvest.findUnique.mockResolvedValue({ id: 1, quantity: 1000, harvestDate: new Date() });
      prisma.productLot.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.productLot.count.mockResolvedValue(0);
      prisma.productLot.create.mockImplementation(async ({ data }: { data: unknown }) => data);
      prisma.traceEvent.create.mockResolvedValue({});

      const lot = await lots.create({
        productId: 1,
        harvestId: 1,
        quantity: 100,
        unit: 'kg',
        grade: 'Loại 1',
        expiresAt: '2026-05-01',
      });

      expect(lot.status).toBe(ProductLotStatus.PENDING_QC);
    });
  });

  describe('isSellable', () => {
    it('is sellable only when SELLABLE and not expired', () => {
      const future = new Date('2026-06-01');
      const past = new Date('2026-01-01');
      const now = new Date('2026-04-01');

      expect(lots.isSellable({ status: ProductLotStatus.SELLABLE, expiresAt: future }, now)).toBe(true);
      expect(lots.isSellable({ status: ProductLotStatus.SELLABLE, expiresAt: past }, now)).toBe(false);
      expect(lots.isSellable({ status: ProductLotStatus.PENDING_QC, expiresAt: future }, now)).toBe(false);
      expect(lots.isSellable({ status: ProductLotStatus.REJECTED, expiresAt: future }, now)).toBe(false);
      expect(lots.isSellable({ status: ProductLotStatus.RECALLED, expiresAt: future }, now)).toBe(false);
    });
  });

  describe('QC PASS', () => {
    it('makes the lot SELLABLE', async () => {
      prisma.productLot.findUnique.mockResolvedValue({ id: 1, status: ProductLotStatus.PENDING_QC });
      prisma.qcInspection.create.mockResolvedValue({ id: 10, result: QcResult.PASS });
      prisma.productLot.update.mockResolvedValue({ id: 1, status: ProductLotStatus.SELLABLE });
      prisma.traceEvent.create.mockResolvedValue({});

      const inspection = await qc.inspect(
        {
          productLotId: 1,
          result: QcResult.PASS,
          appearancePassed: true,
          freshnessPassed: true,
          packagingPassed: true,
          damagePassed: true,
        },
        99,
      );

      expect(inspection.result).toBe(QcResult.PASS);
      expect(prisma.productLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ProductLotStatus.SELLABLE } }),
      );
    });

    it('rejects PASS when a criterion fails', async () => {
      prisma.productLot.findUnique.mockResolvedValue({ id: 1, status: ProductLotStatus.PENDING_QC });

      await expect(
        qc.inspect(
          {
            productLotId: 1,
            result: QcResult.PASS,
            appearancePassed: false,
            freshnessPassed: true,
            damagePassed: true,
          },
          99,
        ),
      ).rejects.toThrow(/all inspection criteria/);
    });
  });

  describe('QC FAIL', () => {
    it('rejects the lot when the product quality fails', async () => {
      prisma.productLot.findUnique.mockResolvedValue({ id: 1, status: ProductLotStatus.PENDING_QC });
      prisma.qcInspection.create.mockResolvedValue({ id: 11, result: QcResult.FAIL });
      prisma.productLot.update.mockResolvedValue({ id: 1, status: ProductLotStatus.REJECTED });
      prisma.traceEvent.create.mockResolvedValue({});

      await qc.inspect(
        {
          productLotId: 1,
          result: QcResult.FAIL,
          appearancePassed: false,
          freshnessPassed: true,
          damagePassed: true,
        },
        99,
      );

      expect(prisma.productLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ProductLotStatus.REJECTED } }),
      );
    });

    it('quarantines the lot when only packaging fails', async () => {
      prisma.productLot.findUnique.mockResolvedValue({ id: 1, status: ProductLotStatus.PENDING_QC });
      prisma.qcInspection.create.mockResolvedValue({ id: 12, result: QcResult.FAIL });
      prisma.productLot.update.mockResolvedValue({ id: 1, status: ProductLotStatus.QUARANTINED });
      prisma.traceEvent.create.mockResolvedValue({});

      await qc.inspect(
        {
          productLotId: 1,
          result: QcResult.FAIL,
          appearancePassed: true,
          freshnessPassed: true,
          packagingPassed: false,
          damagePassed: true,
        },
        99,
      );

      expect(prisma.productLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ProductLotStatus.QUARANTINED } }),
      );
    });
  });
});
