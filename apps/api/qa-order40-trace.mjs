/**
 * READ-ONLY deep trace of order #40 (DELIVERED via order-status path, no shipment).
 * Only SELECTs — never writes. Run: cd apps/api && npx tsx qa-order40-trace.mjs
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envText = readFileSync(resolve(".env"), "utf8");
const databaseUrl = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!databaseUrl) throw new Error("DATABASE_URL not found in apps/api/.env");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
const J = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x), 1);

const o = await prisma.order.findUniqueOrThrow({
  where: { id: 40 },
  include: {
    partnerOrders: {
      include: {
        items: { include: { allocations: { include: { inventoryBalance: true } } } },
        shipments: { include: { events: true } },
        fulfillments: true,
        settlementLines: true,
      },
    },
    payments: { include: { refunds: true } },
  },
});
console.log("ORDER:", J({ id: o.id, code: o.code, status: o.status, customerId: o.customerId, createdAt: o.createdAt, updatedAt: o.updatedAt }));
for (const po of o.partnerOrders) {
  console.log("PARTNERORDER:", J({ id: po.id, code: po.code, status: po.status }));
  for (const it of po.items) {
    console.log("  ITEM:", J({ id: it.id, variant: it.productVariantId, qty: Number(it.quantity) }));
    for (const a of it.allocations) {
      console.log("    ALLOC:", J({ id: a.id, lot: a.productLotId, balance: a.inventoryBalanceId, qty: Number(a.quantity), onHand: Number(a.inventoryBalance.onHand), reserved: Number(a.inventoryBalance.reserved), blocked: Number(a.inventoryBalance.blocked) }));
    }
  }
  console.log("  shipments:", po.shipments.length, "fulfillments:", po.fulfillments.length, "settlementLines:", po.settlementLines.length);
  for (const s of po.shipments) console.log("  SHIPMENT:", J({ id: s.id, code: s.code, status: s.status, events: s.events.map((e) => e.status) }));
}
console.log("PAYMENTS:", J(o.payments.map((p) => ({ id: p.id, method: p.method, status: p.status, paidAt: p.paidAt }))));
const mv = await prisma.inventoryMovement.findMany({ where: { productLotId: 53 }, orderBy: { id: "asc" } });
console.log("MOVEMENTS on lot#53:", J(mv.map((m) => ({ id: m.id, type: m.type, delta: Number(m.quantityDelta), before: Number(m.beforeQuantity), after: Number(m.afterQuantity), ref: `${m.referenceType}#${m.referenceId}` }))));
const docs = await prisma.warehouseDocument.findMany({ where: { lines: { some: { productLotId: 53 } } }, include: { lines: true } });
console.log("WAREHOUSE DOCS touching lot#53:", J(docs.map((d) => ({ id: d.id, code: d.code, type: d.type, status: d.status }))));
const audit = await prisma.auditLog.findMany({ where: { entityType: "Order", entityId: "40" }, orderBy: { id: "asc" } });
console.log("AUDIT Order#40:", J(audit.map((a) => ({ id: a.id, action: a.action, actor: a.actorUserId, at: a.createdAt, before: a.beforeJson, after: a.afterJson }))));
const rets = await prisma.returnRequest.findMany({ where: { orderId: 40 } });
const cmps = await prisma.complaint.findMany({ where: { orderId: 40 } });
console.log("returns:", rets.length, "complaints:", cmps.length);
await prisma.$disconnect();
