import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { FarmsService } from '../src/farms/farms.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ProductsService } from '../src/products/products.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import {
  cleanupConcurrencyWorld,
  createConcurrencyPrisma,
  createConcurrencyWorld,
  makeConcurrencyRunId,
  purgeStaleConcurrencyFixtures,
  type ConcurrencyWorld,
} from './helpers/concurrency-fixtures.js';

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeConcurrencyRunId();

describe.skipIf(!hasTestDb)('Farm partner transfer concurrency (MariaDB e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;

  beforeAll(async () => {
    prisma = createConcurrencyPrisma(TEST_URL as string);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);
  });

  afterAll(async () => {
    if (world) await cleanupConcurrencyWorld(world);
    if (prisma) await prisma.$disconnect();
  });

  it('serializes a Product link racing with a transfer so only one can commit', async () => {
    const base = await world.base(1, 'FARM-XFER');
    const destination = await prisma.partner.create({
      data: {
        code: world.t('PARTNER-XFER-DEST'),
        name: world.t('Transfer destination'),
        phone: `093${Date.now().toString().slice(-7)}`,
        email: world.t('transfer-destination@example.test'),
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
    });
    world.created.partners.push(destination.id);
    const adminId = await world.admin('farm-transfer');

    const audit = new AuditService(prisma as never);
    const farms = new FarmsService(prisma as never, audit);
    const products = new ProductsService(
      prisma as never,
      new PromotionsService(prisma as never),
      new InventoryService(prisma as never, audit as never),
      audit,
    );

    for (let round = 0; round < 5; round += 1) {
      const farm = await prisma.farm.create({
        data: {
          code: world.t(`FARM-XFER-${round}`),
          partnerId: base.partnerId,
          name: world.t(`Transfer farm ${round}`),
          address: 'Hưng Yên',
          status: 'INACTIVE',
        },
      });
      world.created.farms.push(farm.id);

      const [transferResult, productResult] = await Promise.allSettled([
        farms.transferPartner(
          farm.id,
          { newPartnerId: destination.id, reason: `Concurrency round ${round}` },
          {
            id: adminId,
            email: world.t('admin@example.test'),
            role: 'ADMIN',
            fullName: 'Concurrency Admin',
          },
        ),
        products.create({
          partnerId: base.partnerId,
          categoryId: base.categoryId,
          farmId: farm.id,
          name: world.t(`Race product ${round}`),
          status: 'INACTIVE',
        }),
      ]);

      if (productResult.status === 'fulfilled') {
        world.created.products.push(productResult.value.id);
      }

      // With both paths locking the same Farm row, exactly one operation wins:
      // Product first -> transfer sees it and rejects; transfer first -> Product
      // re-reads the new partner and rejects its stale old-partner association.
      expect(
        [transferResult.status, productResult.status].filter(
          (status) => status === 'fulfilled',
        ),
      ).toHaveLength(1);

      const [currentFarm, linkedProducts, transferAudits] = await Promise.all([
        prisma.farm.findUniqueOrThrow({ where: { id: farm.id } }),
        prisma.product.count({ where: { farmId: farm.id } }),
        prisma.auditLog.count({ where: { entityType: 'Farm', entityId: String(farm.id) } }),
      ]);

      if (currentFarm.partnerId === destination.id) {
        expect(transferResult.status).toBe('fulfilled');
        expect(productResult.status).toBe('rejected');
        expect(linkedProducts).toBe(0);
        expect(transferAudits).toBe(1);
      } else {
        expect(currentFarm.partnerId).toBe(base.partnerId);
        expect(transferResult.status).toBe('rejected');
        expect(productResult.status).toBe('fulfilled');
        expect(linkedProducts).toBe(1);
        expect(transferAudits).toBe(0);
      }
    }
  });
});
