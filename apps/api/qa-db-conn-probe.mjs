/**
 * READ-ONLY QA connection probe.
 *
 * The API (Prisma + @prisma/adapter-mariadb) reported "Database is not
 * reachable" while MySQL84 was listening. This probe checks whether the URL
 * needs `allowPublicKeyRetrieval=true` (MySQL 8.4 `caching_sha2_password`
 * after a server restart, no TLS on localhost).
 *
 *   cd apps/api && npm exec -- tsx qa-db-conn-probe.mjs
 *
 * Never writes. Safe to delete.
 */
import { readFileSync } from "node:fs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";

const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const url = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "").trim();
console.log("URL (password masked):", url.replace(/:[^:@]+@/, ":***@"));

for (const variant of [
  { label: "plain                     ", url },
  { label: "allowPublicKeyRetrieval=1 ", url: url.includes("?") ? `${url}&allowPublicKeyRetrieval=true` : `${url}?allowPublicKeyRetrieval=true` },
]) {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(variant.url) });
  try {
    const rows = await prisma.$queryRaw`SELECT VERSION() AS v, COUNT(*) AS n FROM Product`;
    console.log(variant.label, "=> OK. MySQL", rows[0].v, "Product rows:", Number(rows[0].n));
  } catch (err) {
    console.log(variant.label, "=> FAIL:", JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 500));
  } finally {
    await prisma.$disconnect();
  }
}
