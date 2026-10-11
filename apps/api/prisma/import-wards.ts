/**
 * Imports the verified Hưng Yên commune catalogue from the delivered dataset.
 *
 * SOURCE OF TRUTH
 *   `AGRIMARKET_HUNG_YEN_104_XA_PHUONG_2026/AGRIMARKET_HUNG_YEN_2026/`
 *   `hung_yen_104_xa_phuong_2026.json`
 *
 * The JSON is read at import time rather than transcribed into this file. That
 * is deliberate: hand-copying 104 codes into source is exactly how a typo turns
 * into a wrong administrative code, and a re-delivered dataset could not be
 * diffed. The file is validated before anything is written (104 rows, 93 xã +
 * 11 phường, unique 5-character codes, unique names, province 33).
 *
 * IDEMPOTENT
 *   Rows are upserted by `code`. Running it twice changes nothing, and a
 *   re-delivered dataset updates names in place. NOTHING is deleted: a ward that
 *   disappears from a future dataset is left alone rather than being dropped,
 *   because historical addresses and order snapshots may still reference it.
 *
 * Usage:
 *   pnpm --filter @agrimarket/api db:import-wards
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { foldVietnamese } from '../src/common/utils/vietnamese-text.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Where the delivered dataset lives, relative to the repository root. */
const DATASET_RELATIVE_PATH = join(
  'AGRIMARKET_HUNG_YEN_104_XA_PHUONG_2026',
  'AGRIMARKET_HUNG_YEN_2026',
  'hung_yen_104_xa_phuong_2026.json',
);

/** Province code of Hưng Yên in the official 2025 code table. */
const HUNG_YEN_CODE = '33';

interface DatasetWard {
  code: string;
  provinceCode: string;
  provinceName: string;
  type: string;
  name: string;
  fullName: string;
  searchText?: string;
  effectiveFrom?: string;
}

interface Dataset {
  metadata: {
    province: { code: string; name: string; fullName: string };
    counts: { total: number; xa: number; phuong: number };
    legalEffectiveFrom?: string;
  };
  wards: DatasetWard[];
}

function findDatasetPath(): string {
  // The script runs from `apps/api`, but it may also be invoked from the repo
  // root; try both before giving up.
  const candidates = [
    resolve(here, '../../..', DATASET_RELATIVE_PATH),
    resolve(process.cwd(), DATASET_RELATIVE_PATH),
    resolve(process.cwd(), '..', DATASET_RELATIVE_PATH),
    resolve(process.cwd(), '..', '..', DATASET_RELATIVE_PATH),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    `Could not find ${DATASET_RELATIVE_PATH}. Run this from the repository root or apps/api.`,
  );
}

/**
 * Fails loudly on any dataset that does not match the published figures, so a
 * truncated or edited file can never reach the database.
 */
function validateDataset(dataset: Dataset): void {
  const { metadata, wards } = dataset;

  if (metadata.province.code !== HUNG_YEN_CODE) {
    throw new Error(`Dataset province code is ${metadata.province.code}, expected ${HUNG_YEN_CODE}`);
  }
  if (wards.length !== 104) {
    throw new Error(`Dataset has ${wards.length} wards, expected 104`);
  }

  const xa = wards.filter((w) => w.type === 'xa').length;
  const phuong = wards.filter((w) => w.type === 'phuong').length;
  if (xa !== 93 || phuong !== 11) {
    throw new Error(`Dataset has ${xa} xã and ${phuong} phường, expected 93 and 11`);
  }

  const codes = new Set<string>();
  const names = new Set<string>();
  for (const ward of wards) {
    if (!/^\d{5}$/.test(ward.code)) {
      throw new Error(`Ward code ${ward.code} is not exactly 5 digits`);
    }
    if (codes.has(ward.code)) throw new Error(`Duplicate ward code ${ward.code}`);
    codes.add(ward.code);

    if (names.has(ward.fullName)) throw new Error(`Duplicate ward name ${ward.fullName}`);
    names.add(ward.fullName);

    if (ward.provinceCode !== HUNG_YEN_CODE) {
      throw new Error(`Ward ${ward.code} has provinceCode ${ward.provinceCode}, expected 33`);
    }
    const expectedPrefix = ward.type === 'phuong' ? 'Phường ' : 'Xã ';
    if (ward.fullName !== `${expectedPrefix}${ward.name}`) {
      throw new Error(`Ward ${ward.code}: fullName "${ward.fullName}" does not match type ${ward.type}`);
    }
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const datasetPath = findDatasetPath();
  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as Dataset;
  validateDataset(dataset);

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });
  try {
    const province = dataset.metadata.province;

    await prisma.province.upsert({
      where: { code: province.code },
      create: { code: province.code, name: province.name, fullName: province.fullName },
      update: { name: province.name, fullName: province.fullName },
    });

    let written = 0;
    for (const ward of dataset.wards) {
      // `searchText` from the dataset is used when present; otherwise it is
      // derived here with the same folding function the search endpoint uses,
      // so the stored haystack and an incoming query always agree.
      const searchText = ward.searchText ?? foldVietnamese(ward.fullName);

      await prisma.ward.upsert({
        where: { code: ward.code },
        create: {
          code: ward.code,
          provinceCode: ward.provinceCode,
          type: ward.type,
          name: ward.name,
          fullName: ward.fullName,
          searchText,
          effectiveFrom: ward.effectiveFrom ?? dataset.metadata.legalEffectiveFrom ?? null,
        },
        update: {
          provinceCode: ward.provinceCode,
          type: ward.type,
          name: ward.name,
          fullName: ward.fullName,
          searchText,
          effectiveFrom: ward.effectiveFrom ?? dataset.metadata.legalEffectiveFrom ?? null,
        },
      });
      written += 1;
    }

    const total = await prisma.ward.count({ where: { provinceCode: province.code } });
    const active = await prisma.ward.count({
      where: { provinceCode: province.code, status: 'ACTIVE' },
    });

    // eslint-disable-next-line no-console
    console.log(
      [
        `Imported ${written} wards from ${datasetPath}`,
        `Province ${province.code} (${province.fullName}): ${total} rows, ${active} active`,
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
