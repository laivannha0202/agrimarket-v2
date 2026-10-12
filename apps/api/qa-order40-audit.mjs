/**
 * READ-ONLY: audit trail touching order #40 and its payment #39 (any entity).
 * Run: cd apps/api && npx tsx qa-order40-audit.mjs
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const envText = readFileSync(resolve(".env"), "utf8");
const databaseUrl = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
const J = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x), 1);
const rows = await prisma.auditLog.findMany({
  where: { OR: [{ entityType: "Order", entityId: "40" }, { entityType: "Payment", entityId: "39" }, { entityType: "PartnerOrder", entityId: "46" }, { action: { contains: "ORDER" } }] },
  orderBy: { id: "asc" },
});
console.log("count:", rows.length);
for (const a of rows) console.log(J({ id: a.id, action: a.action, entity: `${a.entityType}#${a.entityId}`, actor: a.actorUserId, at: a.createdAt, before: a.beforeJson, after: a.afterJson, reason: a.reason }));
const users = await prisma.user.findMany({ where: { id: { in: [13, 19] } }, select: { id: true, email: true, role: true } });
console.log("USERS:", J(users));
await prisma.$disconnect();
