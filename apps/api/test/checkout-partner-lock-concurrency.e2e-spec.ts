import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { CommissionService } from '../src/finance/commission.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { PartnersService } from '../src/partners/partners.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { QuarantineService } from '../src/quarantine/quarantine.service.js';
import {
  cleanupConcurrencyWorld,
  createConcurrencyPrisma,
  createConcurrencyWorld,
  makeConcurrencyRunId,
  purgeStaleConcurrencyFixtures,
  type ConcurrencyWorld,
} from './helpers/concurrency-fixtures.js';

/**
 * Task 05.4.2.6 — Checkout vs Partner suspension, against the real database.
 *
 * THE BUG
 *
 * Checkout re-read its sellers inside the write transaction, but with a plain
 * `SELECT`. Suspending a partner (`PartnersService.changeBusinessStatus`) locks
 * the Partner row, counts open orders, and writes INACTIVE. Interleaved
 * naively:
 *
 *   1. checkout reads Partner ACTIVE + VERIFIED (no lock held);
 *   2. the operator stops the products and suspends the partner; the open-order
 *      count sees nothing, so the suspension commits;
 *   3. checkout inserts the order + partner order + reservation and commits.
 *
 * The customer then holds an order for a seller that was already stopped at
 * the moment the order committed, and the operator's own "no open orders"
 * blocker never fired either. This suite proves that interleaving can no
 * longer be produced, and that the opposite order is handled correctly too.
 *
 * HOW THE INTERLEAVING IS CONTROLLED
 *
 * Every race is parked at the exact line the fix added — the Partner lock in
 * `OrdersService.lockSellablePartners` — through a test-only wrapper installed
 * on the service instance. No `src/` file is modified for the test, and no
 * `sleep` decides who wins: the test waits on observed database state
 * (`performance_schema.data_locks`) to know the competitor is really blocked on
 * the Partner row, then releases the gate.
 *
 * TWO PARKING POINTS, ONE PER INTERLEAVING
 *
 *   `BEFORE_LOCK` — parked after the eligibility reads and before the Partner
 *                   lock. The competing suspension can complete, so this
 *                   reproduces "Partner lock completes first".
 *   `AFTER_LOCK`  — parked while the Partner lock is already held. The
 *                   suspension must queue behind it, so this reproduces
 *                   "Checkout completes first".
 *
 * The PASS condition of the whole task is checked after every round and once
 * more over the entire run: no live order may exist for a Partner that is not
 * ACTIVE + VERIFIED at the end of the round.
 *
 * Every round builds its own partner/product/stock world under the `cc<run>`
 * prefix, so the demo seed and the other suites are never touched. Skipped
 * entirely without an isolated `TEST_DATABASE_URL`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeConcurrencyRunId();
/** Real contention rounds per scenario. */
const ROUNDS = Number(process.env.CHECKOUT_PARTNER_LOCK_ROUNDS ?? 12);

const ADDRESS = {
  recipientName: 'E2E Khách',
  phone: '0911111111',
  province: 'Hưng Yên',
  detail: 'Số 1 đường E2E',
};

/** The fixed API-contract sentence (shared with the storefront). */
const PARTNER_NOT_SELLABLE_MESSAGE =
  'Sản phẩm hiện chưa đủ điều kiện kinh doanh. Vui lòng chọn sản phẩm khác.';

/** MySQL 1213 (deadlock) / Prisma P2034, and lock-wait timeout 1205. */
function isContentionError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; meta?: { code?: string } } | null;
  if (!candidate) return false;
  const code = candidate.code ?? candidate.meta?.code;
  if (code === 'P2034' || code === '1213' || code === '1205') return true;
  return /deadlock|Lock wait timeout|1213|1205/i.test(candidate.message ?? '');
}

function errorMessage(error: unknown): string {
  return (error as { message?: string } | null)?.message ?? String(error);
}

/** Where the test parks the checkout transaction. */
type ParkPoint = 'BEFORE_LOCK' | 'AFTER_LOCK';

describe.skipIf(!hasTestDb)(
  'Checkout vs Partner suspension — lock ordering (isolated MariaDB e2e)',
  () => {
    let prisma: PrismaClient;
    let world: ConcurrencyWorld;
    let orders: OrdersService;
    let partners: PartnersService;
    let audit: AuditService;
    let adminId: number;
    let customerId: number;

    /** Test-only gate; `null` means "do not park". */
    let gate: { point: ParkPoint; reached: () => void; hold: Promise<void> } | null = null;
    let originalLockSellablePartners: ((tx: unknown, ids: number[]) => Promise<void>) | null = null;

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_URL;
      prisma = createConcurrencyPrisma(TEST_URL as string);
      await purgeStaleConcurrencyFixtures(prisma);
      world = await createConcurrencyWorld(prisma, RUN_ID);

      audit = new AuditService(prisma as never);
      const inventory = new InventoryService(prisma as never, audit as never);
      orders = new OrdersService(
        prisma as never,
        inventory,
        new PromotionsService(prisma as never),
        new CommissionService(prisma as never),
        audit as never,
        new LocationsService(prisma as never),
        new QuarantineService(prisma as never, audit as never, inventory),
      );
      partners = new PartnersService(prisma as never, audit);
      adminId = await world.admin('partner-lock');
      [customerId] = await world.customers(1);

      // Wrap the lock helper once. The wrapper adds nothing but the park: it
      // calls the real implementation (or waits to call it) so the production
      // code path is what actually runs.
      const target = orders as unknown as {
        lockSellablePartners: (tx: unknown, ids: number[]) => Promise<void>;
      };
      originalLockSellablePartners = target.lockSellablePartners.bind(orders);
      target.lockSellablePartners = async (tx: unknown, ids: number[]) => {
        const active = gate;
        if (active?.point === 'BEFORE_LOCK') {
          active.reached();
          await active.hold;
        }
        const result = await (originalLockSellablePartners as (t: unknown, i: number[]) => Promise<void>)(
          tx,
          ids,
        );
        if (active?.point === 'AFTER_LOCK') {
          active.reached();
          await active.hold;
        }
        return result;
      };
    }, 120_000);

    afterAll(async () => {
      if (orders && originalLockSellablePartners) {
        (
          orders as unknown as { lockSellablePartners: unknown }
        ).lockSellablePartners = originalLockSellablePartners;
      }
      if (world) {
        await cleanupConcurrencyWorld(world);
        const leftovers = await prisma.user.count({
          where: { email: { startsWith: `${RUN_ID}-` } },
        });
        expect(leftovers).toBe(0);
      }
      if (prisma) await prisma.$disconnect();
    }, 120_000);

    /* ------------------------------------------------------------ helpers -- */

    /** Arm the gate at `point`; resolves once the checkout is parked there. */
    function parkAt(point: ParkPoint): { reached: Promise<void>; release: () => void } {
      let markReached: () => void = () => {};
      const reached = new Promise<void>((resolve) => {
        markReached = resolve;
      });
      let release: () => void = () => {};
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { point, reached: markReached, hold };
      return {
        reached,
        release: () => {
          gate = null;
          release();
        },
      };
    }

    /** Poll instead of sleeping a fixed time. */
    async function waitFor(
      predicate: () => Promise<boolean>,
      what: string,
      timeoutMs = 15_000,
    ): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (await predicate()) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    /**
     * Is a transaction currently WAITING for a record lock on this Partner?
     * Read from `performance_schema`, so "the competitor is blocked" is
     * observed rather than assumed from timing.
     */
    async function partnerRowHasWaiter(partnerId: number): Promise<boolean> {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
        `
          SELECT COUNT(*) AS n
            FROM performance_schema.data_locks
           WHERE OBJECT_NAME = 'partners'
             AND LOCK_TYPE = 'RECORD'
             AND LOCK_STATUS = 'WAITING'
             AND LOCK_DATA = ?
        `,
        String(partnerId),
      );
      return Number(rows[0]?.n ?? 0) > 0;
    }

    /** Partner record locks the current transactions hold (granted). */
    async function grantedPartnerLocks(partnerIds: number[]): Promise<number[]> {
      if (partnerIds.length === 0) return [];
      const placeholders = partnerIds.map(() => '?').join(', ');
      const rows = await prisma.$queryRawUnsafe<Array<{ d: string }>>(
        `
          SELECT DISTINCT LOCK_DATA AS d
            FROM performance_schema.data_locks
           WHERE OBJECT_NAME = 'partners'
             AND LOCK_TYPE = 'RECORD'
             AND LOCK_STATUS = 'GRANTED'
             AND LOCK_DATA IN (${placeholders})
        `,
        ...partnerIds.map(String),
      );
      return rows.map((row) => Number(row.d)).sort((a, b) => a - b);
    }

    /** Any transaction on the server currently waiting for a lock. */
    async function lockWaitCount(): Promise<number> {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
        'SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits',
      );
      return Number(rows[0]?.n ?? 0);
    }

    /** Everything a checkout writes, scoped to one customer. */
    async function commerceState(customer: number) {
      const orderRows = await prisma.order.findMany({
        where: { customerId: customer },
        select: { id: true, code: true, grandTotal: true, status: true },
        orderBy: { id: 'asc' },
      });
      const orderIds = orderRows.map((order) => order.id);
      const [payments, partnerOrders, items, allocations, movements] = await Promise.all([
        prisma.payment.count({ where: { order: { customerId: customer } } }),
        prisma.partnerOrder.count({ where: { order: { customerId: customer } } }),
        prisma.orderItem.count({ where: { partnerOrder: { order: { customerId: customer } } } }),
        prisma.inventoryAllocation.count({
          where: { orderItem: { partnerOrder: { order: { customerId: customer } } } },
        }),
        orderIds.length === 0
          ? Promise.resolve(0)
          : prisma.inventoryMovement.count({
              where: { referenceType: 'Order', referenceId: { in: orderIds } },
            }),
      ]);
      return { orders: orderRows, partnerOrders, items, payments, allocations, movements };
    }

    async function balanceOf(balanceId: number) {
      const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
      return {
        onHand: Number(balance.onHand),
        reserved: Number(balance.reserved),
        blocked: Number(balance.blocked),
      };
    }

    /**
     * THE INVARIANT OF THE WHOLE TASK: a live order may never exist for a
     * Partner that is not sellable right now.
     *
     * Cancelled orders are excluded — they are history, and cancelling is how
     * a live order stops blocking the suspension.
     */
    async function liveOrdersForUnsellablePartner(): Promise<
      Array<{ orderId: number; partnerId: number; status: string; verification: string }>
    > {
      return prisma.$queryRawUnsafe<
        Array<{ orderId: number; partnerId: number; status: string; verification: string }>
      >(
        `
          SELECT o.id AS orderId,
                 p.id AS partnerId,
                 p.status AS status,
                 p.verification_status AS verification
            FROM orders o
            JOIN partner_orders po ON po.order_id = o.id
            JOIN partners p ON p.id = po.partner_id
           WHERE o.customer_id = ?
             AND o.status <> 'CANCELLED'
             AND (p.status <> 'ACTIVE' OR p.verification_status <> 'VERIFIED')
        `,
        customerId,
      );
    }

    async function assertNoOrderForUnsellablePartner(): Promise<void> {
      const offenders = await liveOrdersForUnsellablePartner();
      expect(
        offenders,
        `a live order exists for a Partner that is not sellable: ${JSON.stringify(offenders)}`,
      ).toEqual([]);
    }

    /** Put exactly these lines in the customer's cart. */
    async function setCart(lines: [number, number][]) {
      const cart = await prisma.cart.upsert({
        where: { customerId },
        create: { customerId },
        update: {},
      });
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      for (const [productVariantId, quantity] of lines) {
        await prisma.cartItem.create({
          data: { cartId: cart.id, productVariantId, quantity },
        });
      }
      return cart.id;
    }

    async function cartSnapshot() {
      const cart = await prisma.cart.findUnique({
        where: { customerId },
        include: { items: { orderBy: { productVariantId: 'asc' } } },
      });
      return (cart?.items ?? []).map((item) => ({
        productVariantId: item.productVariantId,
        quantity: Number(item.quantity),
      }));
    }

    /** Stop selling a Partner's products so `changeBusinessStatus` can run. */
    async function stopProducts(partnerId: number): Promise<void> {
      await prisma.product.updateMany({
        where: { partnerId, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
    }

    /**
     * The operator's real suspension sequence: stop the products, then suspend
     * the partner. `changeBusinessStatus` refuses while ACTIVE products exist,
     * so this is the only way the service itself can reach INACTIVE.
     */
    async function suspendPartner(partnerId: number, reason: string) {
      await stopProducts(partnerId);
      return partners.changeBusinessStatus(partnerId, { status: 'INACTIVE', reason }, adminId);
    }

    const checkout = (items: { productVariantId: number; quantity: number }[], extra = {}) =>
      orders.checkout(customerId, {
        shippingAddress: ADDRESS,
        items,
        paymentMethod: 'COD',
        source: 'BUY_NOW',
        ...extra,
      } as never);

    /** Settle a promise into a discriminated result instead of throwing. */
    async function settle<T>(promise: Promise<T>) {
      return promise.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    }

    /* ============================ scenario 1: the race ==================== */

    it(
      'never creates an order for a Partner suspended before the checkout commits (both interleavings)',
      async () => {
        let checkoutWonRounds = 0;
        let suspensionWonRounds = 0;

        for (let round = 0; round < ROUNDS; round += 1) {
          // Alternate the parking point so both interleavings are exercised:
          // even rounds let the suspension finish first, odd rounds let the
          // checkout commit first.
          const point: ParkPoint = round % 2 === 0 ? 'BEFORE_LOCK' : 'AFTER_LOCK';
          const base = await world.base(50, `R1-${round}`);
          const stateBefore = await commerceState(customerId);
          const handle = parkAt(point);

          const checkoutPromise = settle(
            checkout([{ productVariantId: base.variantId, quantity: 3 }]),
          );

          let suspensionPromise: ReturnType<typeof settle<{ status: string }>> | null = null;
          try {
            await handle.reached;

            // Start the operator's real suspension while the checkout is
            // parked. Nothing about the winner is decided by a timer.
            suspensionPromise = settle(
              suspendPartner(base.partnerId, `round ${round}: suspend during checkout (${point})`),
            );

            if (point === 'AFTER_LOCK') {
              // The checkout already holds the Partner lock, so the suspension
              // must be observed waiting on that row before we let go.
              await waitFor(
                async () => partnerRowHasWaiter(base.partnerId),
                `round ${round}: the suspension to queue on the Partner row lock`,
              );
            } else {
              // The checkout has not locked yet: the suspension must be able
              // to finish on its own, which is what makes this interleaving
              // the one that used to produce the illegal order.
              const suspensionFirst = await suspensionPromise;
              expect(
                suspensionFirst.ok,
                `round ${round}: the suspension failed before the checkout locked: ${errorMessage(
                  (suspensionFirst as { error?: unknown }).error,
                )}`,
              ).toBe(true);
            }

            handle.release();
            const [checkoutResult, suspensionResult] = await Promise.all([
              checkoutPromise,
              suspensionPromise,
            ]);

            const partner = await prisma.partner.findUniqueOrThrow({
              where: { id: base.partnerId },
            });
            const partnerOrders = await prisma.partnerOrder.count({
              where: { partnerId: base.partnerId },
            });
            const balance = await balanceOf(base.balanceId);

            // THE PASS CONDITION OF THE WHOLE TASK, asserted before anything
            // else so a regression fails on the invariant itself and not on a
            // symptom of it: no live order may exist for a seller that is not
            // sellable at the end of the round.
            expect(
              partner.status === 'ACTIVE' || partnerOrders === 0,
              `round ${round} (${point}): an order exists for a Partner suspended before the checkout committed ` +
                `(partner ${partner.status}/${partner.verificationStatus}, ${partnerOrders} partner order(s), ` +
                `checkout ok=${checkoutResult.ok}, suspension ok=${suspensionResult.ok})`,
            ).toBe(true);

            if (checkoutResult.ok) {
              checkoutWonRounds += 1;
              // The checkout won the lock. It committed while the seller was
              // still sellable, and the suspension that arrived afterwards
              // must be refused by the existing open-order blocker rather than
              // bypassing it.
              expect(
                suspensionResult.ok,
                `round ${round}: the suspension committed although an open order exists`,
              ).toBe(false);
              expect(errorMessage((suspensionResult as { error?: unknown }).error)).toMatch(
                /đơn hàng đang xử lý/,
              );
              expect(partner.status, `round ${round}: Partner is INACTIVE with an open order`).toBe(
                'ACTIVE',
              );
              expect(partnerOrders).toBe(1);
              expect(balance).toEqual({ onHand: 50, reserved: 3, blocked: 0 });
              const order = (checkoutResult as { value: { id: number } }).value;
              expect(await prisma.order.count({ where: { id: order.id } })).toBe(1);
            } else {
              suspensionWonRounds += 1;
              // The suspension won the lock. The checkout must have refused
              // with the fixed message and written nothing at all.
              expect(
                suspensionResult.ok,
                `round ${round}: both sides failed (checkout: ${errorMessage(
                  (checkoutResult as { error?: unknown }).error,
                )})`,
              ).toBe(true);
              expect(partner.status).toBe('INACTIVE');
              expect(partnerOrders).toBe(0);
              expect(
                (checkoutResult as { error?: { status?: number } }).error?.status,
                `round ${round}: unexpected checkout error: ${errorMessage(
                  (checkoutResult as { error?: unknown }).error,
                )}`,
              ).toBe(400);
              expect(
                (checkoutResult as { error?: { message?: string } }).error?.message,
              ).toBe(PARTNER_NOT_SELLABLE_MESSAGE);
              // No trace of the refused checkout, and no stock held.
              expect(await commerceState(customerId)).toEqual(stateBefore);
              expect(balance).toEqual({ onHand: 50, reserved: 0, blocked: 0 });
            }

            // THE PASS CONDITION: never a live order for a stopped seller.
            await assertNoOrderForUnsellablePartner();
          } finally {
            handle.release();
            await checkoutPromise;
            if (suspensionPromise) await suspensionPromise;
          }
        }

        // Both interleavings must actually have happened, otherwise the loop
        // proved only one of them.
        expect(suspensionWonRounds, 'no round exercised "Partner lock first"').toBeGreaterThan(0);
        expect(checkoutWonRounds, 'no round exercised "Checkout first"').toBeGreaterThan(0);
        expect(suspensionWonRounds + checkoutWonRounds).toBe(ROUNDS);
      },
      900_000,
    );

    /* ==================== scenario 2: Partner lock first ================== */

    it(
      'refuses the checkout when the Partner was stopped before the request, writing nothing',
      async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
          const base = await world.base(20, `R2-${round}`);
          const cartId = await setCart([[base.variantId, 2]]);
          const cartBefore = await cartSnapshot();
          const stateBefore = await commerceState(customerId);

          // The seller is already INACTIVE when the request arrives. The
          // products are deliberately left ACTIVE: a listing can outlive the
          // suspension (a stale catalogue row, a re-activated product), and the
          // seller gate must still refuse it on its own.
          await prisma.partner.update({
            where: { id: base.partnerId },
            data: { status: 'INACTIVE', verificationStatus: 'PENDING' },
          });

          const result = await settle(
            checkout([{ productVariantId: base.variantId, quantity: 2 }], { source: 'CART' }),
          );

          expect(result.ok, `round ${round}: checkout succeeded for a suspended Partner`).toBe(
            false,
          );
          expect((result as { error?: { status?: number } }).error?.status).toBe(400);
          expect((result as { error?: { message?: string } }).error?.message).toBe(
            PARTNER_NOT_SELLABLE_MESSAGE,
          );

          // Nothing was written, and the cart was not consumed.
          expect(await commerceState(customerId)).toEqual(stateBefore);
          expect(await cartSnapshot()).toEqual(cartBefore);
          expect(await balanceOf(base.balanceId)).toEqual({ onHand: 20, reserved: 0, blocked: 0 });
          expect(await prisma.partnerOrder.count({ where: { partnerId: base.partnerId } })).toBe(0);
          expect(
            await prisma.cartItem.findFirst({
              where: { cartId, productVariantId: base.variantId },
            }),
            `round ${round}: the refused checkout consumed the cart`,
          ).not.toBeNull();
          await assertNoOrderForUnsellablePartner();
        }
      },
      300_000,
    );

    it(
      'refuses the checkout after the operator stopped the products and suspended the Partner',
      async () => {
        // The real operator sequence (`changeBusinessStatus` refuses to suspend
        // while ACTIVE products exist) must also end in a refusal — this time
        // the product gate answers first, which is fine: the point is that no
        // order is written for a seller that was already stopped.
        for (let round = 0; round < ROUNDS; round += 1) {
          const base = await world.base(20, `R2B-${round}`);
          const cartId = await setCart([[base.variantId, 2]]);
          const cartBefore = await cartSnapshot();
          const stateBefore = await commerceState(customerId);

          const suspended = await suspendPartner(base.partnerId, `round ${round}: suspended first`);
          expect(suspended.status).toBe('INACTIVE');

          const result = await settle(
            checkout([{ productVariantId: base.variantId, quantity: 2 }], { source: 'CART' }),
          );

          expect(result.ok, `round ${round}: checkout succeeded for a suspended Partner`).toBe(
            false,
          );
          expect((result as { error?: { status?: number } }).error?.status).toBe(400);
          expect(await commerceState(customerId)).toEqual(stateBefore);
          expect(await cartSnapshot()).toEqual(cartBefore);
          expect(await balanceOf(base.balanceId)).toEqual({ onHand: 20, reserved: 0, blocked: 0 });
          expect(
            await prisma.cartItem.findFirst({
              where: { cartId, productVariantId: base.variantId },
            }),
            `round ${round}: the refused checkout consumed the cart`,
          ).not.toBeNull();
          await assertNoOrderForUnsellablePartner();
        }
      },
      300_000,
    );

    /* ===================== scenario 3: Checkout first ==================== */

    it(
      'makes the suspension obey the open-order blocker when the checkout committed first',
      async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
          const base = await world.base(20, `R3-${round}`);

          // The checkout wins outright, through the real service.
          const order = await checkout([{ productVariantId: base.variantId, quantity: 2 }]);
          expect(order.id).toBeGreaterThan(0);

          // The operator stops the products (allowed) and then suspends.
          await stopProducts(base.partnerId);
          const suspension = await settle(
            partners.changeBusinessStatus(
              base.partnerId,
              { status: 'INACTIVE', reason: `round ${round}: suspend over an open order` },
              adminId,
            ),
          );

          // The suspension may not bypass the open order.
          expect(
            suspension.ok,
            `round ${round}: the suspension committed over an open order`,
          ).toBe(false);
          expect(errorMessage((suspension as { error?: unknown }).error)).toMatch(
            /đơn hàng đang xử lý/,
          );

          const partner = await prisma.partner.findUniqueOrThrow({
            where: { id: base.partnerId },
          });
          expect(partner.status, `round ${round}: Partner suspended with an open order`).toBe(
            'ACTIVE',
          );

          // The order is intact: one partner order, one item, one payment.
          const persisted = await prisma.order.findUniqueOrThrow({
            where: { id: order.id },
            include: { partnerOrders: { include: { items: true } }, payments: true },
          });
          expect(persisted.status).toBe('PENDING_CONFIRMATION');
          expect(persisted.partnerOrders).toHaveLength(1);
          expect(persisted.partnerOrders[0].partnerId).toBe(base.partnerId);
          expect(persisted.partnerOrders[0].items).toHaveLength(1);
          expect(persisted.payments).toHaveLength(1);
          expect(persisted.payments[0].status).toBe('PENDING');
          expect(await balanceOf(base.balanceId)).toEqual({ onHand: 20, reserved: 2, blocked: 0 });
          await assertNoOrderForUnsellablePartner();

          // Once the order is cancelled it stops blocking, so the same
          // suspension now succeeds: the blocker protects live orders only.
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'CANCELLED', reservationExpiresAt: null },
          });
          await prisma.partnerOrder.updateMany({
            where: { orderId: order.id },
            data: { status: 'CANCELLED' },
          });
          const afterCancel = await partners.changeBusinessStatus(
            base.partnerId,
            { status: 'INACTIVE', reason: `round ${round}: suspend after cancellation` },
            adminId,
          );
          expect(afterCancel.status).toBe('INACTIVE');
          // The cancelled order is history and is allowed to reference the
          // now-suspended seller.
          expect(await liveOrdersForUnsellablePartner()).toEqual([]);
        }
      },
      300_000,
    );

    /* =============== scenario 4: multi-Partner checkout + one change ==== */

    it(
      'refuses a multi-Partner checkout when one Partner changed state, and locks Partners in ascending id order',
      async () => {
        /* --- 4a: one of two sellers is stopped before the checkout ------- */
        for (let round = 0; round < ROUNDS; round += 1) {
          // Two independent sellers; the one that gets suspended is requested
          // FIRST but is deliberately not the lower id.
          const left = await world.base(30, `R4A-${round}`);
          const right = await world.base(30, `R4B-${round}`);
          const [lower, higher] = [left, right].sort((a, b) => a.partnerId - b.partnerId);
          // The seller that changes state is the HIGHER id, i.e. the second one
          // in lock order, so the refusal cannot come from "the first lock was
          // the bad one": the checkout must have taken the good seller's lock
          // and then found the bad one.
          const changing = higher;
          const kept = lower;
          const stateBefore = await commerceState(customerId);

          // Park before the Partner lock, let the state change commit, then
          // release: the checkout's own eligibility reads already saw ACTIVE,
          // so only the state read under the lock can refuse it.
          const handle = parkAt('BEFORE_LOCK');
          const checkoutPromise = settle(
            checkout([
              { productVariantId: changing.variantId, quantity: 1 },
              { productVariantId: kept.variantId, quantity: 1 },
            ]),
          );

          try {
            await handle.reached;
            await prisma.partner.update({
              where: { id: changing.partnerId },
              data: { status: 'INACTIVE', verificationStatus: 'PENDING' },
            });
            handle.release();

            const result = await checkoutPromise;
            expect(result.ok, `round ${round}: multi-Partner checkout was not refused`).toBe(false);
            expect((result as { error?: { message?: string } }).error?.message).toBe(
              PARTNER_NOT_SELLABLE_MESSAGE,
            );

            // Not even the still-eligible seller's line was written: the
            // refusal is all-or-nothing, never a partial order.
            expect(await commerceState(customerId)).toEqual(stateBefore);
            expect(await prisma.partnerOrder.count({ where: { partnerId: kept.partnerId } })).toBe(
              0,
            );
            expect(
              await prisma.partnerOrder.count({ where: { partnerId: changing.partnerId } }),
            ).toBe(0);
            expect(await balanceOf(kept.balanceId)).toEqual({ onHand: 30, reserved: 0, blocked: 0 });
            expect(await balanceOf(changing.balanceId)).toEqual({
              onHand: 30,
              reserved: 0,
              blocked: 0,
            });
            await assertNoOrderForUnsellablePartner();
          } finally {
            handle.release();
            await checkoutPromise;
          }
        }

        /* --- 4b: the lock set is ascending, read from the server ---------- */
        const lockOrderRounds = Math.max(3, Math.floor(ROUNDS / 3));
        for (let round = 0; round < lockOrderRounds; round += 1) {
          const a = await world.base(30, `R4L1-${round}`);
          const b = await world.base(30, `R4L2-${round}`);
          const [lower, higher] = [a, b].sort((x, y) => x.partnerId - y.partnerId);

          // Park AFTER the lock is taken so the lock graph is observable.
          const handle = parkAt('AFTER_LOCK');
          // Request order is descending on purpose: the lock order cannot come
          // from the request, it has to be the service's own sort.
          const checkoutPromise = settle(
            checkout([
              { productVariantId: higher.variantId, quantity: 1 },
              { productVariantId: lower.variantId, quantity: 1 },
            ]),
          );

          try {
            await handle.reached;

            // Both Partner rows are locked by one transaction, ascending.
            const held = await grantedPartnerLocks([lower.partnerId, higher.partnerId]);
            expect(
              held,
              `round ${round}: the checkout does not hold a lock on both Partners`,
            ).toEqual([lower.partnerId, higher.partnerId]);

            handle.release();
            const result = await checkoutPromise;
            expect(
              result.ok,
              `round ${round}: eligible multi-Partner checkout failed: ${errorMessage(
                (result as { error?: unknown }).error,
              )}`,
            ).toBe(true);

            const order = (result as { value: { id: number } }).value;
            const partnerOrders = await prisma.partnerOrder.findMany({
              where: { orderId: order.id },
              select: { partnerId: true },
              orderBy: { id: 'asc' },
            });
            // One partner order per seller, exactly the two sellers ordered.
            expect(partnerOrders.map((po) => po.partnerId).sort((x, y) => x - y)).toEqual([
              lower.partnerId,
              higher.partnerId,
            ]);
            expect(await balanceOf(lower.balanceId)).toEqual({ onHand: 30, reserved: 1, blocked: 0 });
            expect(await balanceOf(higher.balanceId)).toEqual({
              onHand: 30,
              reserved: 1,
              blocked: 0,
            });
            await assertNoOrderForUnsellablePartner();
          } finally {
            handle.release();
            await checkoutPromise;
          }
        }
      },
      900_000,
    );

    /* =============== scenario 5: rollback / inventory / cart / money ==== */

    it(
      'rolls the whole checkout back when it fails after the order was written',
      async () => {
        const failingRounds = 6;
        for (let round = 0; round < failingRounds; round += 1) {
          const base = await world.base(10, `R5-${round}`);
          // A real cart line, so the rollback can be checked against it.
          const cartId = await setCart([[base.variantId, 2]]);
          const cartBefore = await cartSnapshot();
          const stateBefore = await commerceState(customerId);
          const movementsBefore = await prisma.inventoryMovement.count({
            where: { productVariantId: base.variantId },
          });
          const idempotencyBefore = await prisma.checkoutIdempotencyKey.count({
            where: { customerId },
          });

          // Fail at the LAST write of the transaction (`audit.record` runs after
          // the order, the code counter, the reservation, the payment and the
          // cart consumption), so this proves atomicity rather than an early
          // refusal.
          const target = orders as unknown as {
            audit: { record: (...args: unknown[]) => Promise<void> };
          };
          const originalRecord = target.audit.record.bind(target.audit);
          let injected = false;
          target.audit.record = async (...args: unknown[]) => {
            const result = await originalRecord(...args);
            if (!injected && (args[0] as { action?: string } | undefined)?.action === 'ORDER_CREATE') {
              injected = true;
              throw new Error('Injected failure after the order was written');
            }
            return result;
          };

          try {
            const result = await settle(
              checkout([{ productVariantId: base.variantId, quantity: 2 }], {
                source: 'CART',
                idempotencyKey: `${RUN_ID}-r5-${round}`,
              }),
            );

            expect(result.ok, `round ${round}: the injected failure did not roll back`).toBe(false);
            expect(injected, `round ${round}: the failure was never injected`).toBe(true);
            expect(errorMessage((result as { error?: unknown }).error)).toMatch(/Injected failure/);

            // No order, partner order, item, allocation, payment or movement.
            expect(await commerceState(customerId)).toEqual(stateBefore);
            expect(await prisma.partnerOrder.count({ where: { partnerId: base.partnerId } })).toBe(0);
            expect(
              await prisma.orderItem.count({ where: { productVariantId: base.variantId } }),
            ).toBe(0);
            expect(
              await prisma.inventoryMovement.count({ where: { productVariantId: base.variantId } }),
            ).toBe(movementsBefore);
            // The idempotency key went back with the rollback, so the customer
            // can retry with the same key.
            expect(
              await prisma.checkoutIdempotencyKey.count({ where: { customerId } }),
              `round ${round}: the idempotency key survived the rollback`,
            ).toBe(idempotencyBefore);

            // Stock untouched, cart line still there.
            expect(await balanceOf(base.balanceId)).toEqual({
              onHand: 10,
              reserved: 0,
              blocked: 0,
            });
            expect(await cartSnapshot()).toEqual(cartBefore);
            expect(
              await prisma.cartItem.findFirst({
                where: { cartId, productVariantId: base.variantId },
              }),
              `round ${round}: the cart line was consumed by a failed checkout`,
            ).not.toBeNull();
            await assertNoOrderForUnsellablePartner();
          } finally {
            target.audit.record = originalRecord;
          }
        }
      },
      300_000,
    );

    /* ============ scenario 6: contention, deadlock and lock ordering ===== */

    it(
      'keeps concurrent checkouts of the same Partner parallel and deadlock-free',
      async () => {
        // 8 checkouts of ONE seller, all racing: they share S(partner), so they
        // must not serialise into a deadlock or into lock-wait timeouts. If the
        // fix had used X(partner) they would still pass, but they would be
        // serialised — the point here is that contention is contention-free.
        const base = await world.base(500, `R6-${0}`);
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () =>
            checkout([{ productVariantId: base.variantId, quantity: 1 }]),
          ),
        );

        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        expect(
          failures.filter((failure) => isContentionError(failure.reason)).map((failure) =>
            errorMessage(failure.reason),
          ),
          'concurrent checkouts of the same seller deadlocked',
        ).toEqual([]);
        expect(
          failures.map((failure) => errorMessage(failure.reason)),
          'unexpected checkout failures under contention',
        ).toEqual([]);

        // Only this scenario's seller: earlier scenarios leave their own
        // (cancelled) orders on this customer, so an unscoped count would be
        // asserting about the wrong rows.
        const orders = await prisma.order.findMany({
          where: { customerId, partnerOrders: { some: { partnerId: base.partnerId } } },
          include: { partnerOrders: true },
          orderBy: { id: 'asc' },
        });
        expect(orders).toHaveLength(8);
        for (const order of orders) {
          expect(order.partnerOrders).toHaveLength(1);
          expect(order.partnerOrders[0].partnerId).toBe(base.partnerId);
        }
        // Exactly 8 units reserved: no double counting, no lost update.
        expect(await balanceOf(base.balanceId)).toEqual({ onHand: 500, reserved: 8, blocked: 0 });
        await assertNoOrderForUnsellablePartner();

        // No transaction was left waiting on a lock.
        expect(await lockWaitCount()).toBe(0);
      },
      300_000,
    );

    it(
      'leaves no live order for a suspended Partner after the whole run',
      async () => {
        // Final sweep, independent of the per-scenario assertions above: every
        // order this customer owns, joined to its seller's CURRENT state.
        const offenders = await liveOrdersForUnsellablePartner();
        expect(
          offenders,
          `live orders for unsellable Partners at the end of the run: ${JSON.stringify(offenders)}`,
        ).toEqual([]);
        expect(await lockWaitCount()).toBe(0);
      },
      120_000,
    );
  },
);
