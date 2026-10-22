import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { CommissionService } from '../src/finance/commission.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import {
  cleanupConcurrencyWorld,
  createConcurrencyPrisma,
  createConcurrencyWorld,
  makeConcurrencyRunId,
  purgeStaleConcurrencyFixtures,
  type ConcurrencyWorld,
} from './helpers/concurrency-fixtures.js';

/**
 * Checkout `reserveLine` lock order (round 4).
 *
 * Round 3 documented the shape statically: checkout held X(inventory_balances)
 * and only then inserted its RESERVE movement, whose `warehouse_id` FK needs
 * S(warehouses), while inbound/adjust held X(warehouses) and waited for the
 * same balance. Round 4 reproduced it with a scheduler gate
 * (`.tmp-verify/round4/checkout-reserve-lock.mts`): 10/10 forced rounds for
 * inbound and 10/10 for adjust lost the competing write to P2034 / MySQL 1213.
 *
 * These regression tests keep the gate but assert BOTH effects commit. The fix
 * is `OrdersService.lockCheckoutWarehouses` + `lockWarehouseShared`: checkout
 * takes S(warehouse) for every warehouse it can allocate from (ascending)
 * BEFORE any balance, so it can never close the cycle.
 *
 * `recordMovement` is wrapped only to park the real checkout transaction at the
 * exact point between `reserveStock` and the movement insert; no `src/` code is
 * altered for the test. Skipped without `TEST_DATABASE_URL`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);
const RUN_ID = makeConcurrencyRunId();
const ROUNDS = Number(process.env.CHECKOUT_LOCK_ROUNDS ?? 10);

describe.skipIf(!hasTestDb)('AgriMarket API — checkout reserveLine lock order (e2e)', () => {
  let prisma: PrismaClient;
  let world: ConcurrencyWorld;
  let inventory: InventoryService;
  let orders: OrdersService;

  const address = { recipientName: 'K', phone: '0900000000', province: 'Hưng Yên', detail: 'x' };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- test-only gate at the reproduced window -----------------------------
  let originalRecordMovement: (tx: unknown, input: unknown) => Promise<void>;
  let gateArmed = false;
  let gateReachedResolve: (() => void) | null = null;
  let gateHold: Promise<void> = Promise.resolve();
  let gateRelease: (() => void) | null = null;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createConcurrencyPrisma(TEST_URL as string);
    await purgeStaleConcurrencyFixtures(prisma);
    world = await createConcurrencyWorld(prisma, RUN_ID);

    const audit = new AuditService(prisma as never);
    inventory = new InventoryService(prisma as never, audit as never);
    orders = new OrdersService(
      prisma as never,
      inventory,
      new PromotionsService(prisma as never),
      new CommissionService(prisma as never),
      audit as never,
      new LocationsService(prisma as never),
    );

    originalRecordMovement = (inventory as any).recordMovement.bind(inventory);
    (inventory as any).recordMovement = async (tx: any, input: any) => {
      if (gateArmed && input.type === 'RESERVE') {
        gateArmed = false;
        gateReachedResolve?.();
        await gateHold;
      }
      return originalRecordMovement(tx, input);
    };
  });

  afterAll(async () => {
    if (inventory) {
      (inventory as any).recordMovement = originalRecordMovement;
    }
    if (world) {
      await cleanupConcurrencyWorld(world);
      const leftovers = await prisma.user.count({ where: { email: { startsWith: `${RUN_ID}-` } } });
      expect(leftovers).toBe(0);
      await prisma.$disconnect();
    }
  });

  function armGate(): { reached: Promise<void>; release: () => void } {
    gateArmed = true;
    const reached = new Promise<void>((resolve) => {
      gateReachedResolve = resolve;
    });
    gateHold = new Promise<void>((resolve) => {
      gateRelease = resolve;
    });
    return {
      reached,
      release: () => {
        gateArmed = false;
        gateRelease?.();
      },
    };
  }

  async function runRace(
    mode: 'inbound' | 'adjust',
    round: number,
  ): Promise<{
    checkoutOk: boolean;
    competingOk: boolean;
    reason?: unknown;
    onHand?: number;
    reserved?: number;
    reserveMoves?: number;
    competingMoves?: number;
  }> {
    const base = await world.base(10, `LK${mode}${round}`);
    const [customerId] = await world.customers(1);
    const adminId = await world.admin(`lk-${mode}-${round}`);
    const gate = armGate();

    const checkoutPromise = orders.checkout(customerId, {
      shippingAddress: address,
      items: [{ productVariantId: base.variantId, quantity: 5 }],
    } as never);
    await Promise.race([gate.reached, sleep(3000)]);
    await sleep(10);

    const competingPromise =
      mode === 'inbound'
        ? inventory.inbound(
            {
              warehouseId: base.warehouseId,
              productLotId: base.lotId,
              productVariantId: base.variantId,
              quantity: 7,
              note: `lock-${round}`,
            } as never,
            adminId,
          )
        : inventory.adjust(
            {
              warehouseId: base.warehouseId,
              productLotId: base.lotId,
              productVariantId: base.variantId,
              quantityDelta: 7,
              note: `lock-${round}`,
            } as never,
            adminId,
          );

    await sleep(25);
    gate.release();

    const [checkoutResult, competingResult] = await Promise.allSettled([
      checkoutPromise,
      competingPromise,
    ]);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: base.balanceId } });
    const moves = await prisma.inventoryMovement.findMany({
      where: { productVariantId: base.variantId },
    });
    const competingType = mode === 'inbound' ? 'INBOUND' : 'ADJUSTMENT';
    const state = {
      onHand: Number(balance.onHand),
      reserved: Number(balance.reserved),
      reserveMoves: moves.filter((m) => m.type === 'RESERVE').length,
      competingMoves: moves.filter((m) => m.type === competingType).length,
    };
    if (checkoutResult.status === 'rejected') {
      return {
        checkoutOk: false,
        competingOk: competingResult.status === 'fulfilled',
        reason: checkoutResult.reason,
        ...state,
      };
    }
    if (competingResult.status === 'rejected') {
      return { checkoutOk: true, competingOk: false, reason: competingResult.reason, ...state };
    }
    return { checkoutOk: true, competingOk: true, ...state };
  }

  it('checkout reservation and inbound both commit when they interleave (10 rounds)', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const result = await runRace('inbound', round);
      expect(result.checkoutOk, `round ${round}: checkout failed: ${String(result.reason)}`).toBe(true);
      expect(result.competingOk, `round ${round}: inbound failed: ${String(result.reason)}`).toBe(true);
      expect(result.onHand).toBe(17);
      expect(result.reserved).toBe(5);
      expect(result.reserveMoves).toBe(1);
      expect(result.competingMoves).toBe(1);
    }
  }, 120_000);

  it('checkout reservation and adjust both commit when they interleave (10 rounds)', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const result = await runRace('adjust', round);
      expect(result.checkoutOk, `round ${round}: checkout failed: ${String(result.reason)}`).toBe(true);
      expect(result.competingOk, `round ${round}: adjust failed: ${String(result.reason)}`).toBe(true);
      expect(result.onHand).toBe(17);
      expect(result.reserved).toBe(5);
      expect(result.reserveMoves).toBe(1);
      expect(result.competingMoves).toBe(1);
    }
  }, 120_000);
});
