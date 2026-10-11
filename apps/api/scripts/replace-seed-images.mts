/**
 * Replace unreachable seed-demo image rows with the WebP files from
 * `agrimarket_v2_bo_anh_nong_san.zip`, mapped BY SLUG from manifest.json.
 *
 * Scope guard (enforced, not a wish):
 * - a row is "seed" ONLY when its URL contains `cdn.agrimarket.vn`.
 *   Anything else (`/uploads/...` user uploads, external URLs) is "real".
 * - a product is touched ONLY when it has >= 1 seed row AND zero real rows.
 *   Products with any real image are SKIPPED entirely — never overwritten,
 *   never reordered, never deleted.
 * - idempotent: a second run finds no seed rows left, so every product is
 *   SKIPPED and zero rows are created. Re-running never duplicates.
 * - dry-run by default. `--write --confirm` applies. `--db dev --write`
 *   additionally requires a `.sql` backup in /backups (refuses otherwise).
 * - only `product_images` rows change. No product, order, inventory or other
 *   data is written.
 *
 * Storage reuses the product-image pipeline: sharp WebP (quality 82,
 * longest side <= 1600, never enlarged), random UUID file names under
 * `<uploads>/products/`, absolute public URLs, mime/size/dimension metadata.
 *
 * Usage (from apps/api):
 *   pnpm exec tsx scripts/replace-seed-images.mts --db dev
 *   pnpm exec tsx scripts/replace-seed-images.mts --db dev --write --confirm
 */
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';

/** The ONLY marker of a replaceable demo row. Never widen this. */
export const SEED_URL_MARKER = 'cdn.agrimarket.vn';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'agrimarket_v2_bo_anh_nong_san.zip'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

interface ManifestEntry {
  slug: string;
  ten_san_pham: string;
  anh: string;
  vai_tro: 'cover' | 'gallery';
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const which = arg('--db') ?? 'dev';
  const write = flag('--write') && flag('--confirm');

  const dbUrl =
    which === 'dev'
      ? (process.env.DEV_DATABASE_URL ??
        'mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2')
      : (process.env.TEST_DATABASE_URL ??
        'mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2_test');
  const root = findRepoRoot(path.resolve(import.meta.dirname));
  const zipArg = arg('--zip');
  const zipPath = zipArg ?? path.join(root, 'agrimarket_v2_bo_anh_nong_san.zip');
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR, 'products')
    : path.join(root, 'apps', 'api', 'uploads', 'products');
  const baseUrl = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  if (which !== 'dev' && which !== 'test') {
    console.error(`REFUSE: unknown --db "${which}" (use dev|test).`);
    process.exit(2);
  }
  if (which === 'dev' && write) {
    const backups = path.join(root, 'backups');
    const dumps = existsSync(backups)
      ? (await fs.readdir(backups)).filter((f) => f.endsWith('.sql'))
      : [];
    if (dumps.length === 0) {
      console.error('REFUSE: writing to DEV requires a backup SQL dump in /backups first.');
      process.exit(2);
    }
    console.log(`Backup gate OK (${dumps.length} dump(s) in /backups).`);
  }

  if (!existsSync(zipPath)) {
    console.error(`Zip not found: ${zipPath}`);
    process.exit(2);
  }
  const zip = new AdmZip(zipPath);
  const manifest = JSON.parse(zip.readAsText('manifest.json')) as { anh: ManifestEntry[] };
  const bySlug = new Map<string, ManifestEntry[]>();
  for (const entry of manifest.anh) {
    const list = bySlug.get(entry.slug) ?? [];
    list.push(entry);
    bySlug.set(entry.slug, list);
  }
  for (const list of bySlug.values()) {
    list.sort((a, b) =>
      a.vai_tro === b.vai_tro ? a.anh.localeCompare(b.anh) : a.vai_tro === 'cover' ? -1 : 1,
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(dbUrl) });
  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        images: { select: { id: true, url: true, isPrimary: true } },
      },
      orderBy: { id: 'asc' },
    });

    let replacedProducts = 0;
    let deletedSeedRows = 0;
    let createdRows = 0;
    let skippedReal = 0;
    let skippedClean = 0;
    let skippedNoManifest = 0;
    let skippedNoProduct = 0;

    const productSlugs = new Set(products.map((p) => p.slug));
    for (const slug of bySlug.keys()) {
      if (!productSlugs.has(slug)) {
        skippedNoProduct++;
        console.log(`SKIP manifest slug "${slug}": no such product (never guessed by id).`);
      }
    }

    for (const product of products) {
      const entries = bySlug.get(product.slug);
      if (!entries || entries.length === 0) {
        skippedNoManifest++;
        continue;
      }
      const seedRows = product.images.filter((i) => i.url.includes(SEED_URL_MARKER));
      const realRows = product.images.filter((i) => !i.url.includes(SEED_URL_MARKER));
      if (realRows.length > 0) {
        skippedReal++;
        console.log(
          `SKIP "${product.slug}": has ${realRows.length} real image(s) — never overwrite.`,
        );
        continue;
      }
      if (seedRows.length === 0) {
        skippedClean++;
        console.log(`SKIP "${product.slug}": no seed rows (already replaced).`);
        continue;
      }

      console.log(
        `${write ? 'REPLACE' : 'WOULD REPLACE'} "${product.slug}": ` +
          `${seedRows.length} seed row(s) -> ${entries.map((e) => e.anh).join(', ')}`,
      );
      if (!write) continue;

      await fs.mkdir(uploadsDir, { recursive: true });
      const created: { id: number; url: string; primary: boolean }[] = [];
      let order = 0;
      for (const entry of entries.slice(0, 6)) {
        const zipEntry = zip.getEntry(entry.anh);
        if (!zipEntry) {
          console.log(`  MISSING in zip: ${entry.anh} — skipped.`);
          continue;
        }
        const out = await sharp(zipEntry.getData())
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const fileName = `${randomUUID()}.webp`;
        await fs.writeFile(path.join(uploadsDir, fileName), out);
        const meta = await sharp(out).metadata();
        const row = await prisma.productImage.create({
          data: {
            productId: product.id,
            url: `${baseUrl}/uploads/products/${fileName}`,
            sortOrder: order,
            isPrimary: entry.vai_tro === 'cover' && order === 0,
            mimeType: 'image/webp',
            width: meta.width ?? null,
            height: meta.height ?? null,
            sizeBytes: out.length,
          },
        });
        created.push({ id: row.id, url: row.url, primary: row.isPrimary });
        order++;
        createdRows++;
      }
      if (created.length > 0 && !created.some((c) => c.primary)) {
        await prisma.productImage.update({
          where: { id: created[0].id },
          data: { isPrimary: true },
        });
        created[0].primary = true;
      }
      // Seed rows reference remote files that never existed locally, so only
      // the DB rows are removed — after the replacements are committed.
      await prisma.productImage.deleteMany({ where: { id: { in: seedRows.map((r) => r.id) } } });
      deletedSeedRows += seedRows.length;
      replacedProducts++;
      for (const c of created) {
        console.log(`  + id=${c.id} ${c.primary ? '*' : '-'} ${c.url}`);
      }
    }

    console.log(
      `\nDone (${write ? 'WRITE' : 'DRY-RUN'} on "${which}"): ` +
        `replacedProducts=${replacedProducts} deletedSeedRows=${deletedSeedRows} ` +
        `createdRows=${createdRows} skippedReal=${skippedReal} ` +
        `skippedClean=${skippedClean} skippedNoManifest=${skippedNoManifest} ` +
        `skippedNoProduct=${skippedNoProduct}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
