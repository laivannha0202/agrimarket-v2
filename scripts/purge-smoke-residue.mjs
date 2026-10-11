/**
 * Removes the residue left in the TEST database by `address-auth-smoke.mjs`.
 *
 * WHY THIS EXISTS
 *   The smoke script registers a real customer through the public API, places a
 *   real order and then cleans up everything the API lets it clean up (it
 *   cancels the order, deletes its addresses and clears its cart). There is
 *   deliberately NO customer self-delete route, so the account row itself — and
 *   the cancelled order graph hanging off it — stays behind. Without this tool
 *   every smoke run would leave another `smoke…@agrimarket.vn` account in the
 *   shared TEST database.
 *
 * WHY IT DOES NOT REUSE `test/helpers/e2e-fixtures.ts`
 *   `purgeRun` follows `partnerOrders[].partnerId` into the partner/product
 *   graph and deletes it. That is correct for the e2e suites, which create their
 *   own throwaway catalogue — but a smoke order is placed against the *demo*
 *   catalogue, so the same cascade would delete demo partners, products and
 *   lots. This tool therefore only ever deletes rows reachable from a
 *   `smoke…` account and never touches the catalogue, warehouses or balances.
 *
 * STOCK SAFETY
 *   An order that still holds a reservation keeps `inventory_balances.reserved`
 *   raised, and deleting its `inventory_allocations` rows would leak that
 *   reservation forever (the demo catalogue would under-report sellable stock).
 *   So the reservation is released first, with the same single statement
 *   `InventoryService.releaseStock` uses (`reserved = GREATEST(reserved - ?, 0)`,
 *   evaluated on the current column value), and only for orders that were not
 *   already cancelled — cancelling through the API already released them.
 *
 * SAFETY
 *   Dry-run by default: nothing is written unless `--apply` is passed, and the
 *   run aborts unless the operator names the TEST database explicitly and that
 *   name matches `TEST_DATABASE_URL` in `apps/api/.env`.
 *
 * Usage (the Prisma client is TypeScript, so run it through tsx):
 *   cd apps/api
 *   npx tsx ../../scripts/purge-smoke-residue.mjs --confirm-test-db=agrimarket_v2_test
 *   npx tsx ../../scripts/purge-smoke-residue.mjs --confirm-test-db=agrimarket_v2_test --apply
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaMariaDb } from '../apps/api/node_modules/@prisma/adapter-mariadb/dist/index.js';
import { PrismaClient } from '../apps/api/generated/prisma/client.js';

const CONFIRM_FLAG = '--confirm-test-db=';
const APPLY = process.argv.includes('--apply');

/** Email prefix the smoke script uses for every account it creates. */
const SMOKE_PREFIX = 'smoke';

/** Order states that hold no reservation (the API already released it). */
const RESERVATION_FREE_STATUSES = new Set(['CANCELLED']);

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function databaseNameOf(url) {
  const withoutQuery = String(url).split('?')[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
}

function resolveTestUrl() {
  const confirmed = process.argv.find((a) => a.startsWith(CONFIRM_FLAG))?.slice(CONFIRM_FLAG.length);
  if (!confirmed) {
    console.error(`FATAL: refusing to run without ${CONFIRM_FLAG}<db>.`);
    process.exit(2);
  }
  if (!/test/i.test(confirmed)) {
    console.error(`FATAL: "${confirmed}" does not look like a TEST database — refusing to run`);
    process.exit(2);
  }

  const envPath = join(root, 'apps', 'api', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('TEST_DATABASE_URL='));
  if (!line) {
    console.error('FATAL: TEST_DATABASE_URL is not set in apps/api/.env — refusing to run');
    process.exit(2);
  }
  const raw = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  if (databaseNameOf(raw) !== confirmed) {
    console.error(
      `FATAL: you confirmed "${confirmed}" but TEST_DATABASE_URL points at "${databaseNameOf(raw)}"`,
    );
    process.exit(2);
  }
  return raw;
}

const url = resolveTestUrl();
console.log(`TEST database: ${databaseNameOf(url)}`);
console.log(APPLY ? 'mode: APPLY (rows will be deleted)\n' : 'mode: DRY RUN (nothing is written)\n');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

/** Every delete this tool performs, so the plan can be printed before applying. */
function makePlan() {
  return [];
}

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: SMOKE_PREFIX } },
    select: { id: true, email: true },
    orderBy: { id: 'asc' },
  });
  if (users.length === 0) {
    console.log('No `smoke…` accounts found — nothing to do.');
    return;
  }
  const userIds = users.map((u) => u.id);
  console.log(`Found ${users.length} smoke account(s):`);
  for (const u of users) console.log(`  #${u.id} ${u.email}`);

  const orders = await prisma.order.findMany({
    where: { customerId: { in: userIds } },
    select: { id: true, code: true, status: true },
    orderBy: { id: 'asc' },
  });
  const orderIds = orders.map((o) => o.id);

  const partnerOrders = await prisma.partnerOrder.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true },
  });
  const partnerOrderIds = partnerOrders.map((p) => p.id);

  const orderItems = await prisma.orderItem.findMany({
    where: { partnerOrderId: { in: partnerOrderIds } },
    select: { id: true },
  });
  const orderItemIds = orderItems.map((i) => i.id);

  const shipments = await prisma.shipment.findMany({
    where: { partnerOrderId: { in: partnerOrderIds } },
    select: { id: true },
  });
  const shipmentIds = shipments.map((s) => s.id);

  const payments = await prisma.payment.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true },
  });
  const paymentIds = payments.map((p) => p.id);

  const carts = await prisma.cart.findMany({
    where: { customerId: { in: userIds } },
    select: { id: true },
  });
  const cartIds = carts.map((c) => c.id);

  const profiles = await prisma.customerProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const profileIds = profiles.map((p) => p.id);

  const allocations = await prisma.inventoryAllocation.findMany({
    where: { orderItemId: { in: orderItemIds } },
    select: {
      id: true,
      quantity: true,
      inventoryBalanceId: true,
      orderItem: { select: { partnerOrder: { select: { orderId: true } } } },
    },
  });

  // ---- reservation release ------------------------------------------------
  const ordersById = new Map(orders.map((o) => [o.id, o]));
  const releases = [];
  for (const alloc of allocations) {
    const orderId = alloc.orderItem.partnerOrder.orderId;
    const status = ordersById.get(orderId)?.status;
    if (status && RESERVATION_FREE_STATUSES.has(status)) continue;
    releases.push({ balanceId: alloc.inventoryBalanceId, quantity: Number(alloc.quantity), orderId });
  }

  const plan = [
    ['inventory_balances (release reserved)', releases.length],
    ['shipment_events', shipmentIds.length],
    ['shipments', shipmentIds.length],
    ['fulfillments', partnerOrderIds.length],
    ['return_requests', orderIds.length],
    ['complaints', orderIds.length],
    ['reviews', orderItemIds.length],
    ['voucher_redemptions', orderIds.length],
    ['settlement_lines', partnerOrderIds.length],
    ['refunds', paymentIds.length],
    ['payments', paymentIds.length],
    ['inventory_allocations', orderItemIds.length],
    ['inventory_movements (referenceId = order)', orderIds.length],
    ['checkout_idempotency_keys', userIds.length],
    ['order_items', orderItemIds.length],
    ['partner_orders', partnerOrderIds.length],
    ['orders', orderIds.length],
    ['cart_items', cartIds.length],
    ['carts', cartIds.length],
    ['addresses', profileIds.length],
    ['customer_profiles', profileIds.length],
    ['password_reset_tokens', userIds.length],
    ['audit_logs', userIds.length],
    ['users', userIds.length],
  ];

  console.log('\norders:');
  for (const o of orders) {
    const held = releases.filter((r) => r.orderId === o.id).length;
    console.log(`  #${o.id} ${o.code} ${o.status}${held ? ` — will release ${held} reservation(s)` : ''}`);
  }
  if (orders.length === 0) console.log('  (none)');

  console.log('\nplan (row counts are upper bounds; relations narrow them):');
  for (const [label, count] of plan) console.log(`  ${String(count).padStart(4)}  ${label}`);

  if (!APPLY) {
    console.log('\nDry run complete — re-run with --apply to delete these rows.');
    return;
  }

  // ---- release the reservations first ------------------------------------
  for (const r of releases) {
    await prisma.$executeRaw`
      UPDATE inventory_balances
         SET reserved = GREATEST(reserved - ${r.quantity}, 0), updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${r.balanceId}
    `;
  }
  if (releases.length > 0) console.log(`\nreleased ${releases.length} reservation(s)`);

  // ---- delete, children first --------------------------------------------
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  await prisma.fulfillment.deleteMany({ where: { partnerOrderId: { in: partnerOrderIds } } });
  await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.complaint.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.review.deleteMany({
    where: { OR: [{ customerId: { in: userIds } }, { orderItemId: { in: orderItemIds } }] },
  });
  await prisma.voucherRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.settlementLine.deleteMany({ where: { partnerOrderId: { in: partnerOrderIds } } });
  await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.inventoryAllocation.deleteMany({ where: { orderItemId: { in: orderItemIds } } });
  await prisma.inventoryMovement.deleteMany({
    where: {
      OR: [
        { referenceId: { in: orderIds }, referenceType: { in: ['Order', 'OrderCancel'] } },
        { createdByUserId: { in: userIds } },
      ],
    },
  });
  await prisma.checkoutIdempotencyKey.deleteMany({
    where: { OR: [{ customerId: { in: userIds } }, { orderId: { in: orderIds } }] },
  });
  await prisma.orderItem.deleteMany({ where: { id: { in: orderItemIds } } });
  await prisma.partnerOrder.deleteMany({ where: { id: { in: partnerOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } });
  await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
  await prisma.address.deleteMany({ where: { customerId: { in: profileIds } } });
  await prisma.customerProfile.deleteMany({ where: { id: { in: profileIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  const left = await prisma.user.count({ where: { email: { startsWith: SMOKE_PREFIX } } });
  console.log(`deleted ${userIds.length} smoke account(s); ${left} remaining`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
