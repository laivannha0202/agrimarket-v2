/** READ-ONLY final business audit — SELECT only. cd apps/api && npx tsx qa-audit-final.mjs */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const envText = readFileSync(resolve(".env"), "utf8");
const databaseUrl = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
const line = (s = "") => console.log(s);

try {
  line("=== ORDERS (totals via Order -> PartnerOrder -> OrderItem) ===");
  const orders = await prisma.order.findMany({
    include: { partnerOrders: { include: { items: true } }, payments: true },
    orderBy: { id: "asc" },
  });
  const byStatus = {};
  let totalMismatch = 0;
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const items = o.partnerOrders.flatMap((po) => po.items);
    const itemsSum = items.reduce((s, i) => s + Number(i.subtotal), 0);
    const itemsDisc = items.reduce((s, i) => s + Number(i.discountAmount), 0);
    const expected = itemsSum - Number(o.discountTotal) + Number(o.shippingFee);
    const actual = Number(o.grandTotal);
    if (Math.abs(expected - actual) > 1) {
      totalMismatch++;
      line(`  MISMATCH order#${o.id} code=${o.code} status=${o.status} itemsSubtotal=${itemsSum.toFixed(0)} itemDisc=${itemsDisc} orderDiscTotal=${o.discountTotal} ship=${o.shippingFee} expected=${expected.toFixed(0)} grandTotal=${actual} subtotalField=${o.subtotal}`);
    }
  }
  line(`orders by status: ${JSON.stringify(byStatus)}`);
  line(`grandTotal mismatches: ${totalMismatch}/${orders.length}`);

  line("\n=== PAYMENTS / COD ===");
  const payments = await prisma.payment.findMany();
  const payByMethodStatus = {};
  for (const p of payments) {
    const k = `${p.method}/${p.status}`;
    payByMethodStatus[k] = (payByMethodStatus[k] ?? 0) + 1;
  }
  line(JSON.stringify(payByMethodStatus));
  const deliveredNoPaid = await prisma.order.findMany({
    where: { status: "DELIVERED", payments: { none: { status: "PAID" } } },
    select: { id: true, code: true, payments: { select: { method: true, status: true, amount: true } } },
  });
  line(`DELIVERED orders without PAID payment: ${deliveredNoPaid.length}`);
  for (const o of deliveredNoPaid) line(`  order#${o.id} ${o.code} payments=${JSON.stringify(o.payments)}`);

  line("\n=== SHIPMENTS ===");
  const ships = await prisma.shipment.findMany();
  const shipByStatus = {};
  for (const s of ships) shipByStatus[s.status] = (shipByStatus[s.status] ?? 0) + 1;
  line(JSON.stringify(shipByStatus));
  line(`shipments total=${ships.length}`);

  line("\n=== RETURNS ===");
  const returns = await prisma.returnRequest.findMany({ orderBy: { id: "asc" } });
  for (const r of returns) line(`  ret#${r.id} order=${r.orderId} item=${r.orderItemId} qty=${r.quantity} status=${r.status} refund=${r.refundId ?? "-"} reason=${String(r.reason).slice(0, 60)}`);

  line("\n=== COMPLAINTS ===");
  const complaints = await prisma.complaint.findMany({ orderBy: { id: "asc" } });
  for (const c of complaints) line(`  cmp#${c.id} order=${c.orderId} item=${c.orderItemId ?? "-"} status=${c.status} type=${c.type}`);

  line("\n=== LOTS & INVENTORY BALANCES (FEFO) ===");
  const lots = await prisma.productLot.findMany({
    include: { inventoryBalances: true, qcInspections: true }, orderBy: { id: "asc" },
  });
  let expiredSellable = 0;
  for (const l of lots) {
    const onHand = l.inventoryBalances.reduce((s, b) => s + Number(b.onHand), 0);
    const reserved = l.inventoryBalances.reduce((s, b) => s + Number(b.reserved), 0);
    const remaining = Number(l.remainingQuantity);
    const drift = Math.abs(remaining - onHand - reserved);
    if (l.expiresAt.getTime() < Date.now() && l.status === "SELLABLE") {
      expiredSellable++;
      line(`  EXPIRED-SELLABLE lot#${l.id} ${l.traceCode} expiry=${l.expiresAt.toISOString().slice(0, 10)} onHand=${onHand}`);
    }
    if (l.status === "SELLABLE" && onHand <= 0)
      line(`  SELLABLE-ZERO lot#${l.id} ${l.traceCode} onHand=${onHand} reserved=${reserved}`);
    if (drift > 0.001)
      line(`  BALANCE-DRIFT lot#${l.id} ${l.traceCode} remaining=${remaining} onHand=${onHand} reserved=${reserved}`);
    if (l.status === "SELLABLE" && l.qcInspections.length === 0)
      line(`  SELLABLE-NO-QC lot#${l.id} ${l.traceCode}`);
    else if (l.status === "SELLABLE" && !l.qcInspections.some((q) => q.result === "PASS"))
      line(`  SELLABLE-NO-PASS-QC lot#${l.id} ${l.traceCode} qc=${l.qcInspections.map((q) => q.result).join(",")}`);
  }
  line(`lots total=${lots.length}, expired-but-sellable=${expiredSellable}`);

  const movements = await prisma.inventoryMovement.findMany();
  const mvByType = {};
  for (const m of movements) mvByType[m.type] = (mvByType[m.type] ?? 0) + 1;
  line(`inventory movements: ${movements.length} byType=${JSON.stringify(mvByType)}`);
  const whDocs = await prisma.warehouseDocument.findMany();
  const docByType = {};
  for (const d of whDocs) docByType[`${d.type}/${d.status}`] = (docByType[`${d.type}/${d.status}`] ?? 0) + 1;
  line(`warehouse docs: ${whDocs.length} byType=${JSON.stringify(docByType)}`);

  line("\n=== PRODUCT IMAGES ===");
  const products = await prisma.product.findMany({ include: { images: true }, orderBy: { id: "asc" } });
  for (const p of products) {
    if (p.images.length === 0) { line(`  prod#${p.id} "${p.name}" NO IMAGE`); continue; }
    const urls = p.images.map((i) => i.url ?? "").join(" | ");
    line(`  prod#${p.id} "${p.name}" imgs=${p.images.length}: ${urls.slice(0, 150)}`);
  }

  line("\n=== FLASH SALE ITEMS ===");
  const fsItems = await prisma.flashSaleItem.findMany({
    include: { flashSale: true, productVariant: { include: { product: true } } },
  });
  for (const it of fsItems)
    line(`  fsItem#${it.id} fs#${it.flashSaleId} "${it.flashSale.name}" var=${it.productVariantId} (${it.productVariant.product.name}/${it.productVariant.name}) flashPrice=${it.flashPrice} base=${it.productVariant.basePrice} sold=${it.soldQuantity}/${it.quota}`);

  line("\n=== SEASONS & HARVESTS ===");
  const seasons = await prisma.season.findMany({ include: { farm: true, harvests: true } });
  for (const s of seasons) line(`  season#${s.id} "${s.name}" farm=${s.farm.name} status=${s.status} harvests=${s.harvests.length}`);
  const harvests = await prisma.harvest.findMany({ orderBy: { id: "asc" } });
  for (const h of harvests)
    line(`  harvest#${h.id} season=${h.seasonId} date=${h.harvestedAt?.toISOString?.().slice(0, 10)} qty=${h.quantity}${h.unit ?? ""} status=${h.status}`);

  line("\n=== QC ===");
  const qcs = await prisma.qcInspection.findMany({ orderBy: { id: "asc" } });
  for (const q of qcs) line(`  qc#${q.id} lot=${q.productLotId} result=${q.result} inspected=${q.inspectedAt.toISOString().slice(0, 10)}`);

  line("\n=== PARTNERS / WAREHOUSES ===");
  const partners = await prisma.partner.findMany({ orderBy: { id: "asc" } });
  for (const p of partners) line(`  partner#${p.id} "${p.name}" type=${p.type} status=${p.status}`);
  const whs = await prisma.warehouse.findMany();
  for (const w of whs) line(`  warehouse#${w.id} "${w.name}" status=${w.status}`);

  line("\n=== CUSTOMER ADDRESSES (sample 8) ===");
  const addrs = await prisma.address.findMany({ take: 8, orderBy: { id: "asc" } });
  for (const a of addrs)
    line(`  addr#${a.id} user=${a.userId} "${[a.detail, a.ward, a.district, a.province].filter(Boolean).join(", ")}"`);

  line("\n=== ADMIN STAT RECOMPUTE ===");
  const delivered = await prisma.order.findMany({ where: { status: "DELIVERED" }, select: { grandTotal: true } });
  line(`DELIVERED revenue=${delivered.reduce((s, o) => s + Number(o.grandTotal), 0)} from ${delivered.length} orders`);
  const settlementLines = await prisma.settlementLine.findMany();
  line(`settlement lines=${settlementLines.length}`);

  line("\n=== REVIEWS / USERS ===");
  line(`reviews=${await prisma.review.count()} users=${await prisma.user.count()}`);
} finally {
  await prisma.$disconnect();
}
