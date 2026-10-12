/**
 * READ-ONLY forensic audit for findings A1 (lot balance drift) and A2 (missing
 * OUTBOUND movements). Only SELECTs — never writes.
 *
 *   cd apps/api && node qa-a1-a2-audit.mjs
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envText = readFileSync(resolve(".env"), "utf8");
const databaseUrl = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!databaseUrl) throw new Error("DATABASE_URL not found in apps/api/.env");
const dbName = databaseUrl.split("?")[0].slice(databaseUrl.split("?")[0].lastIndexOf("/") + 1);
console.log(`read-only A1/A2 audit on database "${dbName}"\n`);

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

const lots = await prisma.productLot.findMany({
  include: {
    inventoryBalances: true,
    inventoryMovements: { orderBy: { id: "asc" } },
    qcInspections: { orderBy: { inspectedAt: "desc" } },
  },
  orderBy: { id: "asc" },
});

console.log("=== A1: per-lot drift under BOTH candidate invariants ===");
console.log("lot | qty | remaining | onHand | reserved | blocked | drift_A(remaining vs on+res) | drift_B(remaining vs on+res+blocked)");
let aCount = 0, bCount = 0;
const drifted = [];
for (const l of lots) {
  const on = l.inventoryBalances.reduce((s, b) => s + Number(b.onHand), 0);
  const res = l.inventoryBalances.reduce((s, b) => s + Number(b.reserved), 0);
  const blk = l.inventoryBalances.reduce((s, b) => s + Number(b.blocked), 0);
  const rem = Number(l.remainingQuantity);
  const dA = rem - on - res;
  const dB = rem - on - res - blk;
  if (Math.abs(dA) > 0.001) aCount++;
  if (Math.abs(dB) > 0.001) bCount++;
  if (Math.abs(dA) > 0.001 || Math.abs(dB) > 0.001) {
    drifted.push({ l, on, res, blk, rem, dA, dB });
    console.log(
      `  lot#${l.id} ${l.traceCode} status=${l.status} qty=${l.quantity} remaining=${rem} ` +
        `onHand=${on} reserved=${res} blocked=${blk} | driftA=${dA} driftB=${dB} ` +
        `qc=${l.qcInspections.map((q) => q.result).join("/") || "-"}`,
    );
  }
}
console.log(`\nlots drifted under formula A (on+res): ${aCount}`);
console.log(`lots drifted under formula B (on+res+blocked): ${bCount}`);

console.log("\n=== A1 detail: movements + allocations + orders for each drifted lot ===");
for (const { l, on, res, blk, rem, dA, dB } of drifted) {
  console.log(`\n--- lot#${l.id} ${l.traceCode} remaining=${rem} on=${on} res=${res} blk=${blk} driftA=${dA} driftB=${dB}`);
  if (l.inventoryMovements.length === 0) console.log("  (no movements)");
  for (const m of l.inventoryMovements) {
    console.log(
      `  mv#${m.id} ${m.type} delta=${m.quantityDelta} before=${m.beforeQuantity} after=${m.afterQuantity} ` +
        `ref=${m.referenceType ?? "-"}#${m.referenceId ?? "-"} note=${(m.note ?? "").slice(0, 50)} at=${m.createdAt.toISOString()}`,
    );
  }
  const allocs = await prisma.inventoryAllocation.findMany({
    where: { productLotId: l.id },
    include: {
      orderItem: { include: { partnerOrder: { include: { order: { select: { id: true, code: true, status: true } } } } } },
    },
    orderBy: { id: "asc" },
  });
  for (const a of allocs) {
    const o = a.orderItem?.partnerOrder?.order;
    console.log(`  alloc#${a.id} qty=${a.quantity} order=${o ? `#${o.id} ${o.code} ${o.status}` : "?"}`);
  }
}

console.log("\n=== A2: DELIVERED orders — full fulfilment chain ===");
const delivered = await prisma.order.findMany({
  where: { status: "DELIVERED" },
  include: {
    partnerOrders: {
      include: {
        shipments: { include: { events: true } },
        items: { include: { allocations: true } },
      },
    },
  },
});
for (const o of delivered) {
  console.log(`\norder#${o.id} ${o.code} status=${o.status} created=${o.createdAt.toISOString()} updated=${o.updatedAt.toISOString()}`);
  for (const po of o.partnerOrders) {
    console.log(`  partnerOrder#${po.id} ${po.code} status=${po.status}`);
    for (const it of po.items) {
      for (const a of it.allocations) {
        console.log(`    alloc#${a.id} lot=${a.productLotId} balance=${a.inventoryBalanceId} qty=${a.quantity}`);
      }
    }
    for (const s of po.shipments) {
      console.log(`    shipment#${s.id} ${s.code} status=${s.status} deliveredAt=${s.deliveredAt?.toISOString() ?? "-"}`);
      for (const e of s.events) console.log(`      event ${e.status} at ${e.occurredAt.toISOString()}`);
    }
  }
  const outbound = await prisma.inventoryMovement.findMany({
    where: { type: "OUTBOUND", referenceType: "Order", referenceId: o.id },
  });
  console.log(`  OUTBOUND movements referencing this order: ${outbound.length}`);
}

console.log("\n=== Movement ledger summary per type (all time) ===");
const mv = await prisma.inventoryMovement.groupBy({ by: ["type"], _count: { id: true } });
console.log(JSON.stringify(mv));

await prisma.$disconnect();
