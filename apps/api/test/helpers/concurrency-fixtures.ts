import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Isolated fixtures for the concurrency suite.
 *
 * The concurrency scenarios create their own tiny slice of the domain
 * (partner → category → farm → product → variant → season → harvest → lot →
 * QC PASS → warehouse → balance) so each round starts from a known stock level
 * and never depends on — or collides with — the demo seed or the other e2e
 * suites.
 *
 * Every marker carries the run prefix `cc<runId>-`, which is deliberately
 * distinct from the `e2e…` prefix the HTTP suites use, so their "no leftovers"
 * assertions never see these rows. `purgeConcurrencyFixtures` removes exactly
 * what a run created, and is also called up-front to heal a run that was killed
 * before its `afterAll` could execute.
 */

/** Prefix shared by every row this suite creates. */
export const CONCURRENCY_PREFIX = 'cc';

export interface ConcurrencyBase {
  partnerId: number;
  categoryId: number;
  farmId: number;
  productId: number;
  variantId: number;
  seasonId: number;
  harvestId: number;
  lotId: number;
  warehouseId: number;
  balanceId: number;
}

export interface ConcurrencyWorld {
  prisma: PrismaClient;
  runId: string;
  /** All ids created, for precise cleanup. */
  created: {
    users: number[];
    partners: number[];
    categories: number[];
    farms: number[];
    products: number[];
    variants: number[];
    seasons: number[];
    harvests: number[];
    lots: number[];
    warehouses: number[];
  };
  /** Tag a marker with this run's prefix. */
  t: (suffix: string) => string;
  /** Create one self-contained base with `onHand` sellable units. */
  base: (onHand: number, tag: string) => Promise<ConcurrencyBase>;
  /** Create `n` CUSTOMER users (with a profile), returning their ids. */
  customers: (n: number) => Promise<number[]>;
  /** Create one ADMIN user, returning its id. */
  admin: (tag: string) => Promise<number>;
}

export function createConcurrencyPrisma(testUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaMariaDb(testUrl) });
}

export function makeConcurrencyRunId(): string {
  return `${CONCURRENCY_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
    .toString(36)
    .padStart(3, '0')}`;
}

export async function createConcurrencyWorld(
  prisma: PrismaClient,
  runId: string,
): Promise<ConcurrencyWorld> {
  const t = (suffix: string) => `${runId}-${suffix}`;
  const passwordHash = await bcrypt.hash('Concurrency@12345', 4);
  const created: ConcurrencyWorld['created'] = {
    users: [],
    partners: [],
    categories: [],
    farms: [],
    products: [],
    variants: [],
    seasons: [],
    harvests: [],
    lots: [],
    warehouses: [],
  };

  const admin = async (tag: string): Promise<number> => {
    const user = await prisma.user.create({
      data: {
        // Namespaced so it can never collide (case-insensitively, MySQL's
        // default collation) with the QC inspector created by `base()`.
        email: t(`admin-adm-${tag}@x.vn`),
        passwordHash,
        fullName: 'a',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    created.users.push(user.id);
    return user.id;
  };

  const customers = async (n: number): Promise<number[]> => {
    const ids: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const user = await prisma.user.create({
        data: {
          email: t(`c${i}-${created.users.length}@x.vn`),
          passwordHash,
          fullName: `c${i}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          customerProfile: { create: {} },
        },
      });
      ids.push(user.id);
      created.users.push(user.id);
    }
    return ids;
  };

  const base = async (onHand: number, tag: string): Promise<ConcurrencyBase> => {
    const partner = await prisma.partner.create({
      data: {
        code: t(`P${tag}`),
        name: t('P'),
        representativeName: 'x',
        phone: '0900000000',
        email: t(`p${tag}@x.vn`),
        address: 'x',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.category.create({
      data: { name: t(`C${tag}`), slug: t(`c${tag}`), status: 'ACTIVE' },
    });
    const farm = await prisma.farm.create({
      data: { code: t(`F${tag}`), partnerId: partner.id, name: t('F'), address: 'x', status: 'ACTIVE' },
    });
    const product = await prisma.product.create({
      data: {
        partnerId: partner.id,
        categoryId: category.id,
        farmId: farm.id,
        name: t(`Prod${tag}`),
        slug: t(`prod${tag}`),
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: t(`SKU-${tag}`),
        name: 'v',
        saleUnit: 'kg',
        basePrice: 30000,
        status: 'ACTIVE',
      },
    });
    const season = await prisma.season.create({
      data: { farmId: farm.id, cropName: t(`S${tag}`), status: 'GROWING' },
    });
    const harvest = await prisma.harvest.create({
      data: { seasonId: season.id, harvestDate: new Date(), quantity: 1000, unit: 'kg', grade: 'A' },
    });
    const lot = await prisma.productLot.create({
      data: {
        code: t(`LOT${tag}`),
        productId: product.id,
        harvestId: harvest.id,
        quantity: 1000,
        unit: 'kg',
        remainingQuantity: 1000,
        grade: 'A',
        expiresAt: new Date(Date.now() + 86400000 * 30),
        status: 'SELLABLE',
        traceCode: t(`TRC${tag}`),
      },
    });
    const inspectorId = await admin(`insp-${tag}`);
    await prisma.qcInspection.create({
      data: {
        productLotId: lot.id,
        inspectorUserId: inspectorId,
        result: 'PASS',
        appearancePassed: true,
        freshnessPassed: true,
        packagingPassed: true,
        damagePassed: true,
        inspectedAt: new Date(),
      },
    });
    const warehouse = await prisma.warehouse.create({
      data: { code: t(`WH${tag}`), name: 'WH', address: 'x', status: 'ACTIVE' },
    });
    const balance = await prisma.inventoryBalance.create({
      data: {
        warehouseId: warehouse.id,
        productLotId: lot.id,
        productVariantId: variant.id,
        onHand,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      },
    });

    created.partners.push(partner.id);
    created.categories.push(category.id);
    created.farms.push(farm.id);
    created.products.push(product.id);
    created.variants.push(variant.id);
    created.seasons.push(season.id);
    created.harvests.push(harvest.id);
    created.lots.push(lot.id);
    created.warehouses.push(warehouse.id);

    return {
      partnerId: partner.id,
      categoryId: category.id,
      farmId: farm.id,
      productId: product.id,
      variantId: variant.id,
      seasonId: season.id,
      harvestId: harvest.id,
      lotId: lot.id,
      warehouseId: warehouse.id,
      balanceId: balance.id,
    };
  };

  return { prisma, runId, created, t, base, customers, admin };
}

/** Delete everything a run created, children first. Safe to call twice. */
export async function cleanupConcurrencyWorld(world: ConcurrencyWorld): Promise<void> {
  await purgeCreated(world.prisma, world.runId, world.created);
}

/**
 * Remove the rows described by `created`. Exported so the stale-run healer can
 * reuse the exact same deletion order without fabricating a whole world.
 */
export async function purgeCreated(
  prisma: PrismaClient,
  runId: string,
  created: ConcurrencyWorld['created'],
): Promise<void> {
  const variants = created.variants;
  const users = created.users;

  await prisma.inventoryAllocation.deleteMany({
    where: { inventoryBalance: { productVariantId: { in: variants } } },
  });
  await prisma.checkoutIdempotencyKey.deleteMany({ where: { customerId: { in: users } } });
  await prisma.voucherRedemption.deleteMany({ where: { customerId: { in: users } } });
  await prisma.payment.deleteMany({ where: { order: { customerId: { in: users } } } });
  await prisma.orderItem.deleteMany({ where: { productVariantId: { in: variants } } });
  await prisma.partnerOrder.deleteMany({ where: { order: { customerId: { in: users } } } });
  await prisma.order.deleteMany({ where: { customerId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.inventoryMovement.deleteMany({ where: { productVariantId: { in: variants } } });
  await prisma.inventoryBalance.deleteMany({ where: { productVariantId: { in: variants } } });
  await prisma.warehouseDocumentLine.deleteMany({
    where: { productVariantId: { in: variants } },
  });
  await prisma.warehouseDocument.deleteMany({ where: { warehouseId: { in: created.warehouses } } });
  await prisma.flashSaleItem.deleteMany({ where: { productVariantId: { in: variants } } });
  await prisma.flashSale.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.voucher.deleteMany({ where: { code: { startsWith: runId } } });
  await prisma.qcInspection.deleteMany({ where: { productLotId: { in: created.lots } } });
  await prisma.traceEvent.deleteMany({ where: { productLotId: { in: created.lots } } });
  await prisma.productLot.deleteMany({ where: { id: { in: created.lots } } });
  await prisma.harvest.deleteMany({ where: { id: { in: created.harvests } } });
  await prisma.season.deleteMany({ where: { id: { in: created.seasons } } });
  await prisma.productVariant.deleteMany({ where: { id: { in: variants } } });
  await prisma.product.deleteMany({ where: { id: { in: created.products } } });
  await prisma.farm.deleteMany({ where: { id: { in: created.farms } } });
  await prisma.category.deleteMany({ where: { id: { in: created.categories } } });
  await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouses } } });
  await prisma.commissionRule.deleteMany({ where: { partnerId: { in: created.partners } } });
  await prisma.partner.deleteMany({ where: { id: { in: created.partners } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

/**
 * Heal the test database after a run that was killed before cleanup: remove any
 * leftover rows whose markers still carry the `cc` prefix.
 */
export async function purgeStaleConcurrencyFixtures(prisma: PrismaClient): Promise<void> {
  const runIds = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value !== 'string') return;
    if (!value.startsWith(CONCURRENCY_PREFIX)) return;
    const runId = value.split('-')[0];
    if (runId.length > CONCURRENCY_PREFIX.length) runIds.add(runId);
  };

  for (const u of await prisma.user.findMany({
    where: { email: { startsWith: CONCURRENCY_PREFIX } },
    select: { email: true },
  })) {
    collect(u.email);
  }
  for (const p of await prisma.partner.findMany({
    where: { code: { startsWith: CONCURRENCY_PREFIX } },
    select: { code: true },
  })) {
    collect(p.code);
  }
  for (const w of await prisma.warehouse.findMany({
    where: { code: { startsWith: CONCURRENCY_PREFIX } },
    select: { code: true },
  })) {
    collect(w.code);
  }

  for (const runId of runIds) {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: `${runId}-` } },
      select: { id: true },
    });
    const partners = await prisma.partner.findMany({
      where: { code: { startsWith: `${runId}-` } },
      select: { id: true },
    });
    const warehouses = await prisma.warehouse.findMany({
      where: { code: { startsWith: `${runId}-` } },
      select: { id: true },
    });
    const variants = await prisma.productVariant.findMany({
      where: { sku: { startsWith: `${runId}-` } },
      select: { id: true, productId: true },
    });
    const productIds = [...new Set(variants.map((v) => v.productId))];
    const lots = await prisma.productLot.findMany({
      where: { code: { startsWith: `${runId}-` } },
      select: { id: true, harvestId: true },
    });
    const harvestIds = [...new Set(lots.map((l) => l.harvestId))];
    const seasons = await prisma.season.findMany({
      where: { cropName: { startsWith: `${runId}-` } },
      select: { id: true, farmId: true },
    });
    const farmIds = [...new Set(seasons.map((s) => s.farmId))];
    const categories = await prisma.category.findMany({
      where: { slug: { startsWith: `${runId}-` } },
      select: { id: true },
    });

    await purgeCreated(prisma, runId, {
      users: users.map((u) => u.id),
      partners: partners.map((p) => p.id),
      categories: categories.map((c) => c.id),
      farms: farmIds,
      products: productIds,
      variants: variants.map((v) => v.id),
      seasons: seasons.map((s) => s.id),
      harvests: harvestIds,
      lots: lots.map((l) => l.id),
      warehouses: warehouses.map((w) => w.id),
    });
  }
}
