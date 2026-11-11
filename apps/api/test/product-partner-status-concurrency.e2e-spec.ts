import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { PartnersService } from '../src/partners/partners.service.js';
import { ProductsService } from '../src/products/products.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
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
const RUN_ID = makeConcurrencyRunId();

function isIsolatedTestDatabase(url: string | undefined): boolean {
  // setup-e2e.ts validates TEST_DATABASE_URL against the original DATABASE_URL
  // before replacing DATABASE_URL with the isolated test URL for the suite.
  // Comparing the two variables here would therefore always reject a valid DB.
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return /(?:^|[_-])(?:test|testing|e2e)(?:$|[_-])/i.test(databaseName) &&
      !/(?:^|[_-])(?:dev|prod|production)(?:$|[_-])/i.test(databaseName);
  } catch {
    return false;
  }
}

const hasIsolatedTestDb = isIsolatedTestDatabase(TEST_URL);

describe.skipIf(!hasIsolatedTestDb)('Product and Partner status concurrency (isolated MariaDB e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;
  let products: ProductsService;
  let partners: PartnersService;
  let adminId: number;
  let sequence = 0;

  async function createSellablePartnerFixture(tag: string) {
    const partner = await prisma.partner.create({
      data: {
        code: world.t(`PARTNER-${tag}`),
        type: 'COOPERATIVE',
        name: world.t(`Partner ${tag}`),
        phone: `09${String(Date.now() + sequence++).slice(-8)}`,
        email: world.t(`${tag}@partner.example.test`),
        taxCode: world.t(`TAX-${tag}`),
        registrationDocumentUrl: 'https://example.test/registration.pdf',
        verificationStatus: 'VERIFIED',
        status: 'ACTIVE',
      },
    });
    world.created.partners.push(partner.id);

    const category = await prisma.category.create({
      data: {
        name: world.t(`Category ${tag}`),
        slug: world.t(`category-${tag}`),
        status: 'ACTIVE',
      },
    });
    world.created.categories.push(category.id);

    const farm = await prisma.farm.create({
      data: {
        code: world.t(`FARM-${tag}`),
        partnerId: partner.id,
        name: world.t(`Farm ${tag}`),
        address: 'E2E isolated test',
        status: 'ACTIVE',
      },
    });
    world.created.farms.push(farm.id);

    return { partner, category, farm };
  }

  beforeAll(async () => {
    if (!TEST_URL) throw new Error('TEST_DATABASE_URL is required for this E2E suite.');
    prisma = createConcurrencyPrisma(TEST_URL);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);
    adminId = await world.admin('product-partner-status');

    const audit = new AuditService(prisma as never);
    products = new ProductsService(
      prisma as never,
      new PromotionsService(prisma as never),
      new InventoryService(prisma as never, audit as never),
      audit,
    );
    partners = new PartnersService(prisma as never, audit);
  });

  afterAll(async () => {
    if (world) await cleanupConcurrencyWorld(world);
    if (prisma) await prisma.$disconnect();
  });

  it('allows only one commit when ACTIVE Product creation races Partner suspension', async () => {
    for (let round = 0; round < 8; round += 1) {
      const fixture = await createSellablePartnerFixture(`RACE-${round}`);
      const [productResult, suspensionResult] = await Promise.allSettled([
        products.create({
          partnerId: fixture.partner.id,
          categoryId: fixture.category.id,
          farmId: fixture.farm.id,
          name: world.t(`Concurrent product ${round}`),
          status: 'ACTIVE',
        }),
        partners.changeBusinessStatus(
          fixture.partner.id,
          { status: 'INACTIVE', reason: `Concurrency round ${round}` },
          adminId,
        ),
      ]);

      if (productResult.status === 'fulfilled') {
        world.created.products.push(productResult.value.id);
      }

      expect(
        [productResult.status, suspensionResult.status].filter((status) => status === 'fulfilled'),
      ).toHaveLength(1);

      const [currentPartner, activeProducts] = await Promise.all([
        prisma.partner.findUniqueOrThrow({ where: { id: fixture.partner.id } }),
        prisma.product.count({
          where: { partnerId: fixture.partner.id, status: 'ACTIVE' },
        }),
      ]);

      if (currentPartner.status === 'INACTIVE') {
        expect(productResult.status).toBe('rejected');
        expect(suspensionResult.status).toBe('fulfilled');
        expect(activeProducts).toBe(0);
      } else {
        expect(currentPartner.status).toBe('ACTIVE');
        expect(productResult.status).toBe('fulfilled');
        expect(suspensionResult.status).toBe('rejected');
        expect(activeProducts).toBe(1);
      }
    }
  });

  it('rejects draft activation after its Partner is suspended', async () => {
    const fixture = await createSellablePartnerFixture('DRAFT-ACTIVATE');
    const draft = await products.create({
      partnerId: fixture.partner.id,
      categoryId: fixture.category.id,
      farmId: fixture.farm.id,
      name: world.t('Draft before suspension'),
      status: 'INACTIVE',
    });
    world.created.products.push(draft.id);

    await partners.changeBusinessStatus(
      fixture.partner.id,
      { status: 'INACTIVE', reason: 'Suspend before activation' },
      adminId,
    );

    await expect(products.update(draft.id, { status: 'ACTIVE' })).rejects.toThrow();
    const persisted = await prisma.product.findUniqueOrThrow({ where: { id: draft.id } });
    expect(persisted.status).toBe('INACTIVE');
  });

  it('rolls back Partner suspension when the transaction fails after the status write', async () => {
    const fixture = await createSellablePartnerFixture('ROLLBACK');
    const auditLogsBefore = await prisma.auditLog.count({
      where: { entityType: 'Partner', entityId: String(fixture.partner.id) },
    });
    const audit = new AuditService(prisma as never);
    let auditWriteCompleted = false;
    const failingPartners = new PartnersService(
      prisma as never,
      {
        record: async (
          input: Parameters<AuditService['record']>[0],
          tx?: Parameters<AuditService['record']>[1],
        ) => {
          await audit.record(input, tx);
          auditWriteCompleted = true;
          throw new Error('Injected failure after audit write');
        },
      } as never,
    );

    await expect(failingPartners.changeBusinessStatus(
      fixture.partner.id,
      { status: 'INACTIVE', reason: 'Rollback check' },
      adminId,
    )).rejects.toThrow('Injected failure after audit write');
    expect(auditWriteCompleted).toBe(true);

    const persisted = await prisma.partner.findUniqueOrThrow({ where: { id: fixture.partner.id } });
    expect(persisted.status).toBe('ACTIVE');
    const auditLogsAfter = await prisma.auditLog.count({
      where: { entityType: 'Partner', entityId: String(fixture.partner.id) },
    });
    expect(auditLogsAfter).toBe(auditLogsBefore);
  });
});
