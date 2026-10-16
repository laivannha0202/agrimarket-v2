/**
 * Restore local product-image rows from a previous DEV dump.
 *
 * Context: `replace-seed-images.mts` normally re-links `cdn.agrimarket.vn`
 * seed rows to the WebP files from `agrimarket_v2_bo_anh_nong_san.zip`. That
 * zip is no longer in the repo, but the same mapping (slug -> files under
 * `uploads/products/`) is recorded verbatim in the DEV dump
 * `backups/agrimarket_v2-dev-pre-chronology-backfill-20261010.sql`, and the
 * files themselves are still on disk. This script replays exactly that
 * mapping — it never guesses a file for a product.
 *
 * Safety rules (same ethos as `replace-seed-images.mts`):
 * - a row is "seed" ONLY when its URL contains `cdn.agrimarket.vn`;
 * - a product is touched ONLY when it has >= 1 seed row AND zero real rows;
 * - a mapping entry whose file is missing from disk is skipped, never faked;
 * - dry-run by default; `--write --confirm` applies; writing to DEV requires
 *   at least one `.sql` dump in /backups (safety net);
 * - only `product_images` rows change.
 *
 * Usage (from apps/api):
 *   npm exec tsx scripts/restore-seed-images-from-backup.mts --dump ..\..\backups\agrimarket_v2-dev-pre-chronology-backfill-20261010.sql
 *   npm exec tsx scripts/restore-seed-images-from-backup.mts --dump <same> --write --confirm
 */
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';

/** The ONLY marker of a replaceable demo row. Never widen this. */
const SEED_URL_MARKER = 'cdn.agrimarket.vn';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'backups'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

/** Split the `VALUES ...` tail of an INSERT into top-level tuples. */
function splitTuples(valuesSection: string): string[] {
  const tuples: string[] = [];
  let inQuote = false;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < valuesSection.length; i++) {
    const ch = valuesSection[i];
    if (inQuote) {
      if (ch === '\\') i++; // escaped char
      else if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) start = i + 1;
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0 && start >= 0) tuples.push(valuesSection.slice(start, i));
      continue;
    }
  }
  return tuples;
}

/** Split one tuple body into fields (handles quoted strings + escapes). */
function splitFields(tuple: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let current = '';
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inQuote) {
      if (ch === '\\') {
        const next = tuple[++i];
        if (next === 'n') current += '\n';
        else if (next === 'r') current += '\r';
        else if (next === 't') current += '\t';
        else current += next;
        continue;
      }
      if (ch === "'") {
        inQuote = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      continue;
    }
    if (ch === ',') {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

function unquote(value: string): string | null {
  return value === 'NULL' ? null : value;
}

interface MappedImage {
  file: string;
  sortOrder: number;
  isPrimary: boolean;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

async function main(): Promise<void> {
  const which = arg('--db') ?? 'dev';
  const write = flag('--write') && flag('--confirm');
  const dumpArg = arg('--dump');
  if (!dumpArg) {
    console.error('REFUSE: pass --dump <path-to-sql-dump>.');
    process.exit(2);
  }
  if (which !== 'dev' && which !== 'test') {
    console.error(`REFUSE: unknown --db "${which}" (use dev|test).`);
    process.exit(2);
  }

  const root = findRepoRoot(path.resolve(import.meta.dirname));
  const dumpPath = path.resolve(dumpArg);
  if (!existsSync(dumpPath)) {
    console.error(`REFUSE: dump not found: ${dumpPath}`);
    process.exit(2);
  }

  const dbUrl =
    which === 'dev'
      ? (process.env.DEV_DATABASE_URL ??
        'mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2')
      : (process.env.TEST_DATABASE_URL ??
        'mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2_test');
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR, 'products')
    : path.join(root, 'apps', 'api', 'uploads', 'products');
  const baseUrl = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  if (which === 'dev' && write) {
    const dumps = existsSync(path.join(root, 'backups'))
      ? (await fs.readdir(path.join(root, 'backups'))).filter((f) => f.endsWith('.sql'))
      : [];
    if (dumps.length === 0) {
      console.error('REFUSE: writing to DEV requires a backup SQL dump in /backups first.');
      process.exit(2);
    }
    console.log(`Backup gate OK (${dumps.length} dump(s) in /backups).`);
  }

  const sql = await fs.readFile(dumpPath, 'utf8');
  const lines = sql.split(/\r?\n/);

  // ---- Parse products: id -> slug ----------------------------------------
  const slugById = new Map<number, string>();
  for (const line of lines) {
    if (!line.startsWith('INSERT INTO `products` VALUES ')) continue;
    const values = line.slice('INSERT INTO `products` VALUES '.length).replace(/;\s*$/, '');
    for (const tuple of splitTuples(values)) {
      const f = splitFields(tuple);
      const id = Number(f[0]);
      const slug = unquote(f[5]);
      if (Number.isFinite(id) && slug) slugById.set(id, slug);
    }
  }

  // ---- Parse product_images: slug -> mapped files ------------------------
  const bySlug = new Map<string, MappedImage[]>();
  for (const line of lines) {
    if (!line.startsWith('INSERT INTO `product_images` VALUES ')) continue;
    const values = line.slice('INSERT INTO `product_images` VALUES '.length).replace(/;\s*$/, '');
    for (const tuple of splitTuples(values)) {
      const f = splitFields(tuple);
      const productId = Number(f[1]);
      const url = unquote(f[2]) ?? '';
      if (!url.includes('/uploads/products/')) continue;
      const slug = slugById.get(productId);
      if (!slug) continue;
      const file = url.split('/').pop() ?? '';
      const list = bySlug.get(slug) ?? [];
      list.push({
        file,
        sortOrder: Number(f[3]) || 0,
        isPrimary: Number(f[4]) === 1,
        mimeType: unquote(f[6]),
        width: f[7] === 'NULL' ? null : Number(f[7]),
        height: f[8] === 'NULL' ? null : Number(f[8]),
        sizeBytes: f[9] === 'NULL' ? null : Number(f[9]),
      });
      bySlug.set(slug, list);
    }
  }
  for (const list of bySlug.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  console.log(
    `Parsed dump: ${slugById.size} product(s), ${bySlug.size} slug(s) with local image mapping.`,
  );

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
    let skippedNoMapping = 0;
    let missingFiles = 0;

    const mappedSlugs = new Set(bySlug.keys());
    const productSlugs = new Set(products.map((p) => p.slug));
    for (const slug of mappedSlugs) {
      if (!productSlugs.has(slug)) {
        console.log(`NOTE: dump slug "${slug}" has no product in the target DB (skipped).`);
      }
    }

    for (const product of products) {
      const mapping = bySlug.get(product.slug);
      if (!mapping || mapping.length === 0) {
        skippedNoMapping++;
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

      const usable: MappedImage[] = [];
      for (const entry of mapping) {
        if (!entry.file || !existsSync(path.join(uploadsDir, entry.file))) {
          missingFiles++;
          console.log(`  MISSING on disk: ${entry.file} — skipped, not faked.`);
          continue;
        }
        usable.push(entry);
      }
      if (usable.length === 0) {
        console.log(`SKIP "${product.slug}": no mapped file exists on disk.`);
        continue;
      }

      console.log(
        `${write ? 'RESTORE' : 'WOULD RESTORE'} "${product.slug}": ` +
          `${seedRows.length} seed row(s) -> ${usable.map((e) => e.file).join(', ')}`,
      );
      if (!write) continue;

      const created: { id: number; primary: boolean }[] = [];
      for (const entry of usable) {
        const row = await prisma.productImage.create({
          data: {
            productId: product.id,
            url: `${baseUrl}/uploads/products/${entry.file}`,
            sortOrder: entry.sortOrder,
            isPrimary: entry.isPrimary,
            mimeType: entry.mimeType ?? 'image/webp',
            width: entry.width,
            height: entry.height,
            sizeBytes: entry.sizeBytes,
          },
        });
        created.push({ id: row.id, primary: row.isPrimary });
        createdRows++;
      }
      // Guarantee exactly one cover, mirroring the sibling scripts.
      if (created.length > 0 && !created.some((c) => c.primary)) {
        await prisma.productImage.update({
          where: { id: created[0].id },
          data: { isPrimary: true },
        });
      }
      // Seed rows reference remote files that never existed locally: DB-only delete.
      await prisma.productImage.deleteMany({ where: { id: { in: seedRows.map((r) => r.id) } } });
      deletedSeedRows += seedRows.length;
      replacedProducts++;
    }

    console.log(
      `\nDone (${write ? 'WRITE' : 'DRY-RUN'} on "${which}"): ` +
        `replacedProducts=${replacedProducts} deletedSeedRows=${deletedSeedRows} ` +
        `createdRows=${createdRows} skippedReal=${skippedReal} skippedClean=${skippedClean} ` +
        `skippedNoMapping=${skippedNoMapping} missingFiles=${missingFiles}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
