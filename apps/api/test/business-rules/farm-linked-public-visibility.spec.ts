import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CertificatesService } from '../../src/certificates/certificates.service.js';
import { publicFarmVisibility } from '../../src/farms/farm-visibility.js';
import { FarmingEventsService } from '../../src/seasons/farming-events.service.js';
import { HarvestsService } from '../../src/harvests/harvests.service.js';
import { LotsService } from '../../src/lots/lots.service.js';
import { SeasonsService } from '../../src/seasons/seasons.service.js';
import { TraceabilityService } from '../../src/traceability/traceability.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

const audit = { record: vi.fn().mockResolvedValue(undefined) };

describe('Public Farm visibility through linked resources', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    audit.record.mockClear();
  });

  it('filters public season list and detail by Farm and Partner visibility', async () => {
    const service = new SeasonsService(prisma as never, audit as never);
    prisma.season.findMany.mockResolvedValue([]);
    prisma.season.count.mockResolvedValue(0);
    await service.findAll({});

    expect(prisma.season.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { farm: publicFarmVisibility } }),
    );

    prisma.season.findFirst.mockResolvedValue(null);
    await expect(service.findOne(4)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.season.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 4, farm: publicFarmVisibility } }),
    );
  });

  it('filters public harvest list and detail through the parent season Farm', async () => {
    const service = new HarvestsService(prisma as never, audit as never);
    prisma.harvest.findMany.mockResolvedValue([]);
    prisma.harvest.count.mockResolvedValue(0);
    await service.findAll({});

    const expectedSeason = { is: { farm: publicFarmVisibility } };
    expect(prisma.harvest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { season: expectedSeason } }),
    );

    prisma.harvest.findFirst.mockResolvedValue(null);
    await expect(service.findOne(8)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.harvest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8, season: expectedSeason } }),
    );
  });

  it('filters public lot list and detail through harvest, season and Farm', async () => {
    const service = new LotsService(prisma as never, audit as never);
    prisma.productLot.findMany.mockResolvedValue([]);
    prisma.productLot.count.mockResolvedValue(0);
    await service.findAll({});

    const expectedFarm = {
      is: { season: { is: { farm: publicFarmVisibility } } },
    };
    expect(prisma.productLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { harvest: expectedFarm } }),
    );

    prisma.productLot.findFirst.mockResolvedValue(null);
    await expect(service.findOne(12)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.productLot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, harvest: expectedFarm } }),
    );
  });

  it('filters public certificate list, detail and valid-by-farm reads', async () => {
    const service = new CertificatesService(prisma as never, audit as never);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    await service.findAll({});
    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { farm: publicFarmVisibility } }),
    );

    prisma.certificate.findFirst.mockResolvedValue(null);
    await expect(service.findOne(6)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.certificate.findFirst).toHaveBeenCalledWith({
      where: { id: 6, farm: publicFarmVisibility },
    });

    await service.findValidByFarm(9);
    expect(prisma.certificate.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          farmId: 9,
          farm: publicFarmVisibility,
        }),
      }),
    );
  });

  it('filters public farming-event reads through the parent season Farm', async () => {
    const service = new FarmingEventsService(prisma as never, audit as never);
    prisma.season.findFirst.mockResolvedValue(null);

    await expect(service.findBySeason(14)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.season.findFirst).toHaveBeenCalledWith({
      where: { id: 14, farm: publicFarmVisibility },
      select: { id: true },
    });
    expect(prisma.farmingEvent.findMany).not.toHaveBeenCalled();
  });

  it('does not return a public trace when the linked Farm is outside public visibility', async () => {
    const service = new TraceabilityService(prisma as never);
    prisma.productLot.findFirst.mockResolvedValue(null);

    await expect(service.trace('TRACE-LOCKED-FARM')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.productLot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          traceCode: 'TRACE-LOCKED-FARM',
          harvest: {
            is: { season: { is: { farm: publicFarmVisibility } } },
          },
        },
      }),
    );
  });
});
