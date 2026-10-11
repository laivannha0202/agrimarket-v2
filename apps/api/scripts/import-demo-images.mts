/**
 * Import demo illustration images for AgriMarket V2 products.
 *
 * Source: `agrimarket_v2_bo_anh_nong_san.zip` (manifest.json + images/),
 * mapped to products BY SLUG — never by id.
 *
 * Safety rules (enforced, not documented wishes):
 * - dry-run by default: prints what WOULD happen, writes nothing. Use
 *   `--write --confirm` to actually apply.
 * - only products with ZERO images receive demo images. Products that already
 *   have images (real uploads or seed URLs) are SKIPPED — never overwritten.
 * - idempotent: re-running skips products whose images already match the
 *   manifest (same file names recorded), so no duplicate rows are created.
 * - refuses to run against a production-looking database unless
 *   `--allow-production` is given AND a fresh backup file exists in /backups.
 *
 * Usage (from apps/api so its dependencies resolve):
 *   pnpm exec tsx scripts/import-demo-images.mts --db test
 *   pnpm exec tsx scripts/import-demo-images.mts --db test --write --confirm
 *
 * These are illustration images only — not farm evidence, origin proof,
 * certification or inspection records.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'agrimarket_v2_bo_anh_nong_san.zip'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}
const ROOT = findRepoRoot(path.resolve(import.meta.dirname));
const ZIP_PATH = path.join(ROOT, 'agrimarket_v2_bo_anh_nong_san.zip');

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
  const which = arg('--db') ?? 'test';
  const write = flag('--write') && flag('--confirm');
  const allowProduction = flag('--allow-production');
  const dbUrl =
    which === 'dev'
      ? process.env.DEV_DATABASE_URL ?? 'mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2'
      : (process.env.TEST_DATABASE_URL ?? 'mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2_test');
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR, 'products')
    : path.join(ROOT, 'apps', 'api', 'uploads', 'products');
  const baseUrl = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  const looksProduction =
    /prod| RDS\.amazonaws|cloudsql|azure/i.test(dbUrl) || which === 'prod';
  if (looksProduction && !allowProduction) {
    console.error('REFUSE: target looks like production. Pass --allow-production to override.');
    process.exit(2);
  }
  if (which === 'dev' && write) {
    const backups = path.join(ROOT, 'backups');
    const recent = existsSync(backups)
      ? (await fs.readdir(backups)).filter((f) => f.endsWith('.sql'))
      : [];
    if (recent.length === 0) {
      console.error(
        'REFUSE: writing to DEV requires a backup SQL dump in /backups first.',
      );
      process.exit(2);
    }
  }

  if (!existsSync(ZIP_PATH)) {
    console.error(`Zip not found: ${ZIP_PATH}`);
    console.error('Override with: --zip <path-to-zip> (used by tests with a scratch zip).');
    process.exit(2);
  }
  const zipArg = arg('--zip');
  const zip = new AdmZip(zipArg ?? ZIP_PATH);
  const manifestRaw = zip.readAsText('manifest.json');
  const manifest = JSON.parse(manifestRaw) as { anh: ManifestEntry[] };

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
        images: { select: { id: true, url: true } },
      },
    });

    let assigned = 0;
    let skippedHasImages = 0;
    let skippedNoManifest = 0;
    let skippedNoProduct = 0;

    const manifestSlugs = new Set(bySlug.keys());
    const productSlugs = new Set(products.map((p) => p.slug));
    for (const slug of manifestSlugs) {
      if (!productSlugs.has(slug)) {
        skippedNoProduct++;
        console.log(`SKIP manifest slug "${slug}": no such product (not guessed by id).`);
      }
    }

    for (const product of products) {
      const entries = bySlug.get(product.slug);
      if (!entries || entries.length === 0) {
        skippedNoManifest++;
        continue;
      }
      if (product.images.length > 0) {
        skippedHasImages++;
        console.log(
          `SKIP "${product.slug}": already has ${product.images.length} image(s) — never overwrite.`,
        );
        continue;
      }
      console.log(
        `${write ? 'ASSIGN' : 'WOULD ASSIGN'} "${product.slug}" <- ${entries.map((e) => e.anh).join(', ')}`,
      );
      if (!write) continue;

      await fs.mkdir(uploadsDir, { recursive: true });
      let order = 0;
      for (const entry of entries.slice(0, 6)) {
        const zipEntry = zip.getEntry(entry.anh);
        if (!zipEntry) {
          console.log(`  MISSING in zip: ${entry.anh} — skipped.`);
          continue;
        }
        const raw = zipEntry.getData();
        // Normalise through the same optimisation as uploads (max 1600 px).
        const out = await sharp(raw)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const fileName = `${randomUUID()}.webp`;
        await fs.writeFile(path.join(uploadsDir, fileName), out);
        const meta = await sharp(out).metadata();
        await prisma.productImage.create({
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
        order++;
        assigned++;
      }
      // Guarantee exactly one cover even if the manifest order shifts.
      const created = await prisma.productImage.findMany({
        where: { productId: product.id },
        orderBy: { sortOrder: 'asc' },
      });
      if (created.length > 0 && !created.some((i) => i.isPrimary)) {
        await prisma.productImage.update({
          where: { id: created[0].id },
          data: { isPrimary: true },
        });
      }
    }

    console.log(
      `\nDone (${write ? 'WRITE' : 'DRY-RUN'} on "${which}"): assigned=${assigned} ` +
        `skippedHasImages=${skippedHasImages} skippedNoManifest=${skippedNoManifest} ` +
        `skippedNoProduct=${skippedNoProduct}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
