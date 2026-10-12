/**
 * READ-ONLY: payment/audit/return trail for orders #14,#15,#18,#40 (DEV).
 * Run: cd apps/api && npx tsx qa-order40-pay.mjs
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const envText = readFileSync(resolve(".env"), "utf8");
const databaseUrl = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
const J = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x), 1);
for (const id of [14, 15, 18, 40]) {
  const pays = await prisma.payment.findMany({ where: { orderId: id } });
  console.log(`ORDER#${id} payments:`, J(pays.map((p) => ({ id: p.id, method: p.method, status: p.status, paidAt: p.paidAt, txn: p.transactionReference, createdAt: p.createdAt, updatedAt: p.updatedAt }))));
  const pa = await prisma.auditLog.findMany({ where: { entityType: "Payment" }, orderBy: { id: "asc" } });
  const rel = pa.filter((a) => { try { const j = JSON.parse(String(a.afterJson ?? "{}")); return true; } catch { return true; } });
  void rel;
  const mine = await prisma.auditLog.findMany({ where: { entityType: { in: ["Payment"] } }, orderBy: { id: "asc" }, take: 200 });
  void mine;
  const rets = await prisma.returnRequest.findMany({ where: { orderId: id }, include: { refund: true } });
  console.log(`ORDER#${id} returns:`, J(rets.map((r) => ({ id: r.id, qty: Number(r.quantity), status: r.status, refund: r.refund ? { id: r.refund.id, amount: Number(r.refund.amount), status: r.refund.status } : null }))));
}
const payAudit = await prisma.auditLog.findMany({ where: { entityType: "Payment", entityId: { in: ["39", "14", "15", "18"] } }, orderBy: { id: "asc" } });
console.log("PAYMENT audit rows for #14,#15,#18,#39:", J(payAudit.map((a) => ({ id: a.id, action: a.action, entityId: a.entityId, actor: a.actorUserId, at: a.createdAt, before: a.beforeJson, after: a.afterJson }))));
const allPayAudit = await prisma.auditLog.findMany({ where: { action: { startsWith: "PAYMENT" } }, orderBy: { id: "asc" } });
console.log("ALL PAYMENT_* audit rows:", J(allPayAudit.map((a) => ({ id: a.id, action: a.action, entityId: a.entityId, actor: a.actorUserId, at: a.createdAt }))));
await prisma.$disconnect();
