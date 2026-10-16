/**
 * Proves an EXPIRED flash sale stops being priced, and that a live one still is.
 *
 * The user's report was that a campaign could keep showing flash prices after it
 * ended. The rule lives in the pricing query (`startsAt <= now <= endsAt` plus
 * `status = ACTIVE`), so this script creates two programmes on the TEST database
 * — one whose window has closed, one still open — and asserts the *service's own
 * price resolution* honours the difference.
 *
 * It calls `PromotionsService.resolvePrice` directly rather than HTTP, so it
 * exercises the exact code the catalog and checkout use while running entirely
 * against the isolated TEST database (no dev API involved).
 *
 * Everything it writes is removed at the end, and it refuses to run against a
 * database whose name does not end in `_test`.
 *
 * Run: npm exec --workspace @agrimarket/api -- tsx prisma/verify-flash-expiry.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';

/** Reads `.env` from the package root, wherever the script is invoked from. */
function loadEnv(): Record<string, string> {
  const candidates = ['.env', 'apps/api/.env', '../../.env'];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv();
const url = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not configured');
  process.exit(2);
}
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  console.error(`refusing to run against "${dbName}" — expected a *_test database`);
  process.exit(2);
}
console.log(`database: ${dbName}\n`);

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });
const service = new PromotionsService(prisma as never);

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) failures += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  // A variant that carries no other promotion, so the flash price is the only
  // thing that could change the answer.
  const variant = await prisma.productVariant.findFirst({
    where: { status: 'ACTIVE', product: { status: 'ACTIVE' } },
    orderBy: { id: 'asc' },
  });
  if (!variant) {
    console.error('no active variant to test with');
    process.exit(2);
  }
  const basePrice = Number(variant.basePrice);
  const flashPrice = Math.max(1, Math.round(basePrice * 0.5));

  // Baseline: no promotion in the way.
  const baseline = await service.resolvePrice(variant.id);
  check(
    'baseline prices at base with no promotion',
    baseline.source === 'NONE' && baseline.unitPrice === basePrice,
    `${baseline.unitPrice} (${baseline.source}), base ${basePrice}`,
  );

  console.log(`\nvariant: ${variant.sku} (${variant.name}) base ${basePrice}, test flash ${flashPrice}\n`);

  // ---- 1. an EXPIRED programme ---------------------------------------------
  const expired = await prisma.flashSale.create({
    data: {
      name: 'ZZZ verification — expired window',
      startsAt: new Date(Date.now() - 3 * 86_400_000),
      endsAt: new Date(Date.now() - 86_400_000),
      status: 'ACTIVE', // still marked active, but the window has closed
      items: {
        create: {
          productVariantId: variant.id,
          flashPrice,
          quota: 10,
          soldQuantity: 0,
          perCustomerLimit: 5,
        },
      },
    },
    include: { items: true },
  });

  // ---- 2. a RUNNING programme (positive control) ---------------------------
  const running = await prisma.flashSale.create({
    data: {
      name: 'ZZZ verification — running window',
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      status: 'ACTIVE',
      items: {
        create: {
          productVariantId: variant.id,
          flashPrice,
          quota: 10,
          soldQuantity: 0,
          perCustomerLimit: 5,
        },
      },
    },
    include: { items: true },
  });

  try {
    // While only the EXPIRED programme is in play the price must stay at base.
    await prisma.flashSale.update({
      where: { id: running.id },
      data: { status: 'INACTIVE' },
    });
    const withExpiredOnly = await service.resolvePrice(variant.id);
    check(
      'an expired window is NOT priced (base price is used)',
      withExpiredOnly.source === 'NONE' && withExpiredOnly.unitPrice === basePrice,
      `${withExpiredOnly.unitPrice} (${withExpiredOnly.source}) vs flash ${flashPrice}`,
    );
    check(
      'the expired programme is not attached to the price',
      withExpiredOnly.flashSaleItemId === null,
      `flashSaleItemId=${withExpiredOnly.flashSaleItemId}`,
    );

    // Inside the window the same programme MUST price (positive control, so the
    // test cannot pass merely because flash sales are ignored altogether).
    await prisma.flashSale.update({
      where: { id: running.id },
      data: { status: 'ACTIVE' },
    });
    const withRunning = await service.resolvePrice(variant.id);
    check(
      'a live window IS priced (positive control)',
      withRunning.source === 'FLASH_SALE' && withRunning.unitPrice === flashPrice,
      `${withRunning.unitPrice} (${withRunning.source}) vs flash ${flashPrice}`,
    );
    check(
      'the live price points at the running programme, not the expired one',
      withRunning.flashSaleItemId === running.items[0].id,
      `got item ${withRunning.flashSaleItemId}, expected ${running.items[0].id}`,
    );

    // A deactivated programme inside its own window must also stop pricing.
    await prisma.flashSale.update({ where: { id: running.id }, data: { status: 'INACTIVE' } });
    const withDeactivated = await service.resolvePrice(variant.id);
    check(
      'a deactivated programme stops pricing even inside its window',
      withDeactivated.source === 'NONE' && withDeactivated.unitPrice === basePrice,
      `${withDeactivated.unitPrice} (${withDeactivated.source})`,
    );

    // And the boundary: a window that closed one second ago is already over.
    await prisma.flashSale.update({
      where: { id: running.id },
      data: { status: 'ACTIVE', endsAt: new Date(Date.now() - 1_000) },
    });
    const justExpired = await service.resolvePrice(variant.id);
    check(
      'a window that closed a second ago is no longer priced',
      justExpired.source === 'NONE' && justExpired.unitPrice === basePrice,
      `${justExpired.unitPrice} (${justExpired.source})`,
    );

    // ...while a window that opens in a second is not priced yet either.
    await prisma.flashSale.update({
      where: { id: running.id },
      data: { startsAt: new Date(Date.now() + 1_000), endsAt: new Date(Date.now() + 3_600_000) },
    });
    const notStarted = await service.resolvePrice(variant.id);
    check(
      'a window that has not opened yet is not priced',
      notStarted.source === 'NONE' && notStarted.unitPrice === basePrice,
      `${notStarted.unitPrice} (${notStarted.source})`,
    );
  } finally {
    for (const sale of [expired, running]) {
      await prisma.flashSaleItem.deleteMany({ where: { flashSaleId: sale.id } });
      await prisma.flashSale.delete({ where: { id: sale.id } });
    }
    const remaining = await prisma.flashSale.count({
      where: { name: { startsWith: 'ZZZ verification' } },
    });
    check('verification programmes removed', remaining === 0, `${remaining} left`);
    await prisma.$disconnect();
  }

  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err: Error) => {
  console.error('aborted:', err.message);
  await prisma.$disconnect();
  process.exit(2);
});
