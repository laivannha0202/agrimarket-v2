/**
 * READ-ONLY QA peek at the DEV database.
 *
 * Purpose: the browser audit must use REAL ids/codes, not invented ones. This
 * script only SELECTs — it never writes, never migrates and never reseeds.
 *
 *   cd apps/api && node qa-db-peek.mjs
 *
 * Connection details are read from apps/api/.env (DATABASE_URL) and are never
 * printed in full.
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envText = readFileSync(resolve(".env"), "utf8");
const databaseUrl = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!databaseUrl) throw new Error("DATABASE_URL not found in apps/api/.env");

const dbName = databaseUrl.split("?")[0].slice(databaseUrl.split("?")[0].lastIndexOf("/") + 1);
console.log(`read-only peek at database "${dbName}"\n`);

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

try {
  const lots = await prisma.productLot.findMany({
    select: {
      id: true, code: true, traceCode: true, status: true, grade: true,
      product: { select: { id: true, name: true, status: true } },
    },
    orderBy: { id: "desc" },
    take: 12,
  });
  console.log("PRODUCT LOTS (newest first):");
  for (const l of lots) {
    console.log(
      `  lot#${l.id} traceCode=${l.traceCode} status=${l.status} grade=${l.grade} ` +
        `product=[${l.product.id}] ${l.product.name} (${l.product.status})`,
    );
  }

  const counts = {
    products: await prisma.product.count(),
    activeProducts: await prisma.product.count({ where: { status: "ACTIVE" } }),
    variants: await prisma.productVariant.count(),
    categories: await prisma.category.count(),
    farms: await prisma.farm.count(),
    certificates: await prisma.certificate.count(),
    verifiedCerts: await prisma.certificate.count({ where: { verificationStatus: "VERIFIED" } }),
    customers: await prisma.user.count({ where: { role: "CUSTOMER" } }),
    orders: await prisma.order.count(),
    reviews: await prisma.review.count(),
    vouchers: await prisma.voucher.count(),
    flashSales: await prisma.flashSale.count(),
  };
  console.log("\nCOUNTS:", JSON.stringify(counts, null, 1));

  const certs = await prisma.certificate.findMany({
    select: {
      id: true, type: true, certificateCode: true, issuer: true, verificationStatus: true,
      status: true, issuedAt: true, expiresAt: true, verifiedAt: true,
      farm: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  });
  console.log("\nCERTIFICATES:");
  for (const c of certs) {
    const now = Date.now();
    const live =
      c.verificationStatus === "VERIFIED" &&
      c.status === "ACTIVE" &&
      c.issuedAt.getTime() <= now &&
      c.expiresAt.getTime() >= now;
    console.log(
      `  cert#${c.id} ${c.type} ${c.certificateCode} issuer="${c.issuer}" ` +
        `verify=${c.verificationStatus} status=${c.status} ` +
        `${c.issuedAt.toISOString().slice(0, 10)}->${c.expiresAt.toISOString().slice(0, 10)} ` +
        `currentlyValid=${live} farm=[${c.farm.id}] ${c.farm.name}`,
    );
  }

  const sales = await prisma.flashSale.findMany({
    select: {
      id: true, name: true, status: true, startsAt: true, endsAt: true,
      _count: { select: { items: true } },
    },
  });
  console.log("\nFLASH SALES:");
  for (const s of sales) {
    const days = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 86_400_000);
    console.log(
      `  fs#${s.id} "${s.name}" status=${s.status} ` +
        `${s.startsAt.toISOString()} -> ${s.endsAt.toISOString()} ` +
        `(span ${days} days, items=${s._count.items})`,
    );
  }

  const vouchers = await prisma.voucher.findMany({
    select: {
      id: true, code: true, name: true, status: true, discountType: true, discountValue: true,
      minOrderAmount: true, usageLimit: true, usedCount: true, perCustomerLimit: true,
      startsAt: true, endsAt: true,
    },
  });
  console.log("\nVOUCHERS:");
  for (const v of vouchers) {
    console.log(
      `  v#${v.id} ${v.code} "${v.name}" ${v.status} ${v.discountType} ${v.discountValue} ` +
        `min=${v.minOrderAmount} used=${v.usedCount}/${v.usageLimit ?? "unlimited"} ` +
        `perCustomer=${v.perCustomerLimit ?? "unlimited"} ` +
        `${v.startsAt.toISOString().slice(0, 10)}->${v.endsAt.toISOString().slice(0, 10)}`,
    );
  }

  const farms = await prisma.farm.findMany({
    select: { id: true, name: true, address: true, status: true },
    orderBy: { id: "asc" },
  });
  console.log("\nFARMS (address text as stored):");
  for (const f of farms) console.log(`  farm#${f.id} ${f.name} status=${f.status}\n      "${f.address}"`);

  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true, status: true },
  });
  console.log("\nCATEGORIES:");
  for (const c of categories) console.log(`  cat#${c.id} ${c.slug} "${c.name}" ${c.status}`);

  const products = await prisma.product.findMany({
    select: {
      id: true, name: true, status: true, farmId: true,
      category: { select: { slug: true } },
      variants: {
        select: {
          id: true, name: true, weight: true, weightUnit: true, saleUnit: true,
          basePrice: true, status: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });
  console.log("\nPRODUCTS + VARIANTS:");
  for (const p of products) {
    console.log(`  prod#${p.id} "${p.name}" cat=${p.category.slug} status=${p.status} farm=${p.farmId}`);
    for (const v of p.variants) {
      console.log(
        `      var#${v.id} name="${v.name}" weight=${v.weight}${v.weightUnit ?? ""} ` +
          `saleUnit=${v.saleUnit} price=${v.basePrice} status=${v.status}`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
