import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { IDEMPOTENCY_SCOPES } from '../common/idempotency/idempotency.constants.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  AdjustInventoryDto,
  InboundInventoryDto,
  ReserveInventoryDto,
} from './dto/inventory.dto.js';
import type { InventoryBalance, Prisma } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  ProductLotStatus,
  QcResult,
  RecordStatus,
} from '../../generated/prisma/enums.js';
import { isUniqueViolationOn } from '../common/utils/code.util.js';

type Tx = Prisma.TransactionClient;

export interface AvailableStock {
  balanceId: number;
  warehouseId: number;
  productLotId: number;
  productVariantId: number;
  onHand: number;
  reserved: number;
  blocked: number;
  available: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  static available(onHand: number, reserved: number, blocked: number): number {
    return onHand - reserved - blocked;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    warehouseId?: number;
    productVariantId?: number;
  }): Promise<PaginatedResult<Record<string, unknown>>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.InventoryBalanceWhereInput = {
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.productVariantId ? { productVariantId: query.productVariantId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          productLot: { select: { id: true, code: true, traceCode: true, status: true, expiresAt: true } },
          productVariant: { select: { id: true, sku: true, name: true } },
        },
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);
    const data = rows.map((b) => this.withAvailable(b));
    return paginate(data, total, page, limit);
  }

  private withAvailable(b: InventoryBalance) {
    const onHand = Number(b.onHand);
    const reserved = Number(b.reserved);
    const blocked = Number(b.blocked);
    return {
      ...b,
      onHand: b.onHand.toString(),
      reserved: b.reserved.toString(),
      blocked: b.blocked.toString(),
      available: InventoryService.available(onHand, reserved, blocked).toFixed(3),
    };
  }

  /**
   * Sellable quantity per variant: stock a checkout could actually reserve.
   *
   * Mirrors `allocateFefo`'s eligibility (SELLABLE lot, not expired, latest QC
   * PASS) so a preview never promises stock the checkout would refuse.
   */
  async sellableQuantities(productVariantIds: number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    for (const id of productVariantIds) result.set(id, 0);
    if (productVariantIds.length === 0) return result;

    const now = new Date();
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        productVariantId: { in: productVariantIds },
        warehouse: { status: RecordStatus.ACTIVE },
        productLot: {
          status: ProductLotStatus.SELLABLE,
          expiresAt: { gte: now },
        },
      },
      include: {
        productLot: {
          include: {
            qcInspections: { orderBy: { inspectedAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    for (const balance of balances) {
      if (balance.productLot.status !== ProductLotStatus.SELLABLE) continue;
      if (balance.productLot.expiresAt < now) continue;
      const latest = balance.productLot.qcInspections[0];
      if (!latest || latest.result !== QcResult.PASS) continue;
      const available = InventoryService.available(
        Number(balance.onHand),
        Number(balance.reserved),
        Number(balance.blocked),
      );
      if (available <= 0) continue;
      result.set(balance.productVariantId, (result.get(balance.productVariantId) ?? 0) + available);
    }
    return result;
  }

  /**
   * Refuse new stock-writing work at an INACTIVE warehouse.
   *
   * The warehouse row is locked (`SELECT ... FOR UPDATE`) before any balance
   * is touched, using the same lock the deactivation path holds: a concurrent
   * ACTIVE → INACTIVE flip serialises here instead of slipping past the check.
   * Adjustments are the documented exception — fixing a miscount at a closed
   * warehouse is allowed, creating new inbound/reserve business is not. The
   * document `complete` path calls this too (see `WarehouseDocumentsService`).
   */
  static async requireActiveWarehouse(
    tx: Tx,
    warehouseId: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: number; status: string }[]>`
      SELECT id, status FROM warehouses WHERE id = ${warehouseId} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('Warehouse not found');
    if (rows[0].status !== RecordStatus.ACTIVE) {
      throw new ConflictException('Kho đã ngừng hoạt động, không thể tạo nghiệp vụ mới');
    }
  }

  /** Inbound stock (e.g. from a completed warehouse-in document). */
  async inbound(dto: InboundInventoryDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      await InventoryService.requireActiveWarehouse(tx, dto.warehouseId);
      const balance = await this.getOrCreateBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      const before = Number(balance.onHand);
      const after = before + dto.quantity;
      const updated = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHand: after },
      });
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.INBOUND,
        quantityDelta: dto.quantity,
        beforeQuantity: before,
        afterQuantity: after,
        note: dto.note,
        actorUserId,
      });
      return this.withAvailable(updated);
    });
  }

  /**
   * Take the warehouse row lock WITHOUT the ACTIVE status gate.
   *
   * BL-07 (round 2, lock order): every other stock-writing path serialises on
   * the warehouse row first (`requireActiveWarehouse`), so inbound / reserve /
   * document flows hold X(warehouse) while they wait for the balance row lock.
   * An `adjust` that claimed the balance row first and then inserted its
   * movement — whose `warehouse_id` FK forces a shared lock on that same
   * warehouse row — inverted the order and formed a real InnoDB deadlock
   * against the inbound path (reproduced on the test DB: Prisma P2034 on the
   * inbound `update`, 2/40 interleavings; the rollback silently dropped one
   * increment). Taking the warehouse lock up front gives `adjust` the same
   * warehouse → balance order.
   *
   * Adjustments remain the documented exception that may run at an INACTIVE
   * warehouse, so this takes the lock only and never checks the status.
   */
  static async lockWarehouse(tx: Tx, warehouseId: number): Promise<void> {
    await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM warehouses WHERE id = ${warehouseId} FOR UPDATE
    `;
  }

  /**
   * Take a SHARED warehouse lock before claiming balances in a path that only
   * inserts child rows referencing the warehouse (checkout reservations).
   *
   * The checkout path does not modify the warehouse, but its movement insert
   * takes an implicit S lock on `warehouses.id` through the FK. Taking that
   * lock explicitly FIRST gives checkout the same `warehouse → balance` order
   * as every warehouse writer, so an inbound/document/adjust transaction that
   * already holds X(warehouse) can never wait on a balance the checkout holds
   * while the checkout waits for S(warehouse) — the cycle reproduced in round 4
   * (`.tmp-verify/round4/checkout-reserve-lock.mts`: 10/10 rounds, inbound and
   * adjust lost with P2034 / 1213).
   *
   * `FOR SHARE` (not `FOR UPDATE`) is deliberate: checkout never changes the
   * warehouse, and shared locks do not conflict with each other, so concurrent
   * checkouts on the same warehouse still run in parallel. It does conflict
   * with the writers' X lock, which is exactly the queueing point we need.
   */
  static async lockWarehouseShared(tx: Tx, warehouseId: number): Promise<void> {
    await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM warehouses WHERE id = ${warehouseId} FOR SHARE
    `;
  }

  /**
   * Signed adjustment (add/subtract a delta). Stock can never go negative and
   * can never undercut `reserved + blocked`.
   *
   * CONCURRENCY (BL-07): the admin adjust path used to read the balance,
   * compute `after = before + delta` in JS and write that absolute value back.
   * Two adjustments racing (e.g. +5 and −3 on on-hand 10) both computed from
   * the same `before`, so one increment was clobbered (lost update). The
   * check-and-write is now a single conditional UPDATE whose guard is
   * re-evaluated by the database while it holds the row's exclusive lock:
   *
   *   on_hand = on_hand + ?
   *   WHERE on_hand + ? >= 0            (never negative)
   *     AND on_hand + ? >= reserved + blocked  (never undercuts commitments)
   *
   * Because the arithmetic runs on the current column values, concurrent
   * adjustments (and inbound/checkout changes interleaving) can never lose an
   * increment, and the movement + audit rows — recorded in the same
   * transaction with values read back AFTER the claimed update — always
   * describe exactly what the balance shows. Plain Prisma transactions do not
   * retry a rejected guard: a rejected update has zero affected rows, and the
   * caller is told the business reason instead of a number computed from a
   * stale snapshot.
   */
  async adjust(dto: AdjustInventoryDto, actorUserId: number, idempotencyKey?: string) {
    if (dto.quantityDelta === 0) {
      throw new BadRequestException('quantityDelta must not be zero');
    }
    const work = async (tx: Tx) => {
      // Same lock order as every other stock-writing path (see lockWarehouse):
      // without it this transaction can deadlock against a concurrent inbound.
      await InventoryService.lockWarehouse(tx, dto.warehouseId);
      let balance: InventoryBalance;
      try {
        balance = await this.getOrCreateBalance(
          tx,
          dto.warehouseId,
          dto.productLotId,
          dto.productVariantId,
        );
      } catch (error) {
        // Two admins adjusting a balance that did not exist yet both ran the
        // get-or-create; the DB unique index makes exactly one of them the
        // creator. The loser re-reads the winner's row and proceeds with the
        // same guarded update instead of failing with a raw P2002.
        if (!isUniqueViolationOn(error, 'warehouseid', 'warehouse_id')) throw error;
        balance = await this.requireBalance(
          tx,
          dto.warehouseId,
          dto.productLotId,
          dto.productVariantId,
        );
      }
      const affected = await tx.$executeRaw`
        UPDATE inventory_balances
           SET on_hand = on_hand + ${dto.quantityDelta}, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ${balance.id}
           AND on_hand + ${dto.quantityDelta} >= 0
           AND on_hand + ${dto.quantityDelta} >= reserved + blocked
      `;
      if (affected === 0) {
        // The guard rejected the change (or the row moved under us). Name the
        // business reason from the current values instead of failing with a
        // raw constraint error.
        const current = await tx.inventoryBalance.findUniqueOrThrow({
          where: { id: balance.id },
        });
        const after = Number(current.onHand) + dto.quantityDelta;
        if (after < 0) {
          throw new BadRequestException('Adjustment would make on-hand quantity negative');
        }
        throw new BadRequestException(
          'Adjustment would make on-hand lower than reserved + blocked quantity',
        );
      }
      const updated = await tx.inventoryBalance.findUniqueOrThrow({
        where: { id: balance.id },
      });
      const after = Number(updated.onHand);
      const before = after - dto.quantityDelta;
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.ADJUSTMENT,
        quantityDelta: dto.quantityDelta,
        beforeQuantity: before,
        afterQuantity: after,
        note: dto.note,
        actorUserId,
      });
      await this.audit.record(
        {
          actorUserId,
          action: 'INVENTORY_ADJUSTMENT',
          entityType: 'InventoryBalance',
          entityId: String(balance.id),
          beforeJson: { onHand: before },
          afterJson: { onHand: after },
          reason: dto.note,
        },
        tx,
      );
      return this.withAvailable(updated);
    };

    // Without a key the behaviour is unchanged (the caller explicitly asked
    // for two independent operations). With a key, the claim and the entire
    // stock write commit or roll back together.
    if (!idempotencyKey) return this.prisma.$transaction(work);
    if (!this.idempotency) {
      throw new InternalServerErrorException('Idempotency service is not configured');
    }
    return this.idempotency.run(
      {
        scope: IDEMPOTENCY_SCOPES.inventoryAdjust,
        actorUserId,
        key: idempotencyKey,
        payload: {
          warehouseId: dto.warehouseId,
          productLotId: dto.productLotId,
          productVariantId: dto.productVariantId,
          quantityDelta: dto.quantityDelta,
          note: dto.note ?? null,
        },
      },
      work,
    );
  }

  /**
   * Reserve `quantity` on one balance, atomically.
   *
   * The whole check-and-write is a single conditional UPDATE:
   * `reserved = reserved + ? WHERE id = ? AND on_hand - reserved - blocked >= ?`.
   * The database re-evaluates the predicate while holding the row's exclusive
   * lock, so two concurrent callers can never both pass the check, and the row
   * is locked exactly once — never upgraded from shared to exclusive.
   *
   * The lock upgrade is what made concurrent checkouts deadlock (MySQL 1213 /
   * Prisma P2034): inserting the `inventory_allocations` row first takes a
   * shared FK lock on the balance, and the follow-up `UPDATE` then has to
   * upgrade it to an exclusive lock while another transaction waits on the
   * same pair in the opposite order. Callers must therefore reserve *before*
   * writing the allocation row.
   *
   * Returns `null` when the balance can no longer cover `quantity` (a
   * concurrent writer took the stock); the caller turns that into its own
   * shortfall error. `before`/`after` are the reserved quantities around the
   * update, for the movement ledger.
   */
  async reserveStock(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET reserved = reserved + ${quantity}, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
         AND on_hand - reserved - blocked >= ${quantity}
    `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.reserved);
    return { balance, before: after - quantity, after };
  }

  /**
   * Release `quantity` from a balance's reservation, atomically.
   *
   * A single conditional UPDATE (`reserved = reserved - ? WHERE id = ? AND
   * reserved >= ?`): the predicate is re-evaluated under the row's exclusive
   * lock, so a concurrent checkout's reservation can never be dropped and a
   * double release can never drive `reserved` below the stock the balance
   * actually holds. Returns `null` when the balance does not hold that many
   * reserved units; the caller must roll back instead of fabricating a release.
   *
   * The previous `GREATEST(reserved - ?, 0)` clamp is deliberately removed: it
   * hid underflow (releasing a reservation the balance never had) and reported
   * a fabricated `before = after + quantity` ledger entry.
   */
  async releaseStock(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET reserved = reserved - ${quantity}, updated_at = UTC_TIMESTAMP(3)
        WHERE id = ${balanceId}
          AND reserved >= ${quantity}
     `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.reserved);
    return { balance, before: after + quantity, after };
  }

  /**
   * Move `quantity` from a balance's reservation into `blocked` (quarantine).
   *
   * Used when an order is cancelled *after* its goods have already left the
   * warehouse (order status `SHIPPING`): those goods must not become sellable
   * again, so the reservation is converted into a blocked quantity instead of
   * being released. The single statement keeps `available = on_hand - reserved -
   * blocked` unchanged, so nothing is freed for resale, and the arithmetic runs
   * on the current column values, so a concurrent checkout's reservation is
   * never clobbered. The blocked units wait for the return/inspection flow
   * (see the delivery-failure and return rules), never for a silent re-sale.
   *
   * The move is guarded by `reserved >= quantity`: the reservation is only
   * converted when the balance actually holds that many reserved units. Without
   * the guard the statement would happily manufacture `blocked` stock out of a
   * reservation the balance never had (`GREATEST(reserved - ?, 0)` clamped the
   * subtraction but still added the full quantity to `blocked`), inflating
   * blocked and corrupting the balance. Returns `null` when the guard rejects
   * the move; the caller must turn that into an error so its transaction rolls
   * back rather than leaving the order half-processed.
   */
  async quarantineStock(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{
    balance: InventoryBalance;
    before: number;
    after: number;
    blocked: number;
  } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET reserved = reserved - ${quantity},
             blocked  = blocked + ${quantity},
             updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
         AND reserved >= ${quantity}
    `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.reserved);
    return { balance, before: after + quantity, after, blocked: Number(balance.blocked) };
  }

  /**
   * Consume `quantity` reserved units: the goods physically leave the warehouse,
   * so BOTH `on_hand` and `reserved` drop in one conditional UPDATE
   * (`WHERE reserved >= ? AND on_hand >= ?`). The predicate is re-evaluated
   * under the row's exclusive lock, so two concurrent consumptions (or a
   * consumption racing a release) can never drive either column negative or
   * consume a reservation the balance no longer holds. Returns `null` when the
   * guard rejected the change; the caller must roll back rather than leave the
   * order half-processed. `before`/`after` are the on-hand quantities around
   * the update, for the movement ledger.
   */
  async consumeStock(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET on_hand = on_hand - ${quantity},
             reserved = reserved - ${quantity},
             updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
         AND reserved >= ${quantity}
         AND on_hand >= ${quantity}
    `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.onHand);
    return { balance, before: after + quantity, after };
  }

  /**
   * Receive physically returned goods after a completed delivery.
   *
   * At delivery, `consumeOrderStock` removed the units from `on_hand` and from
   * the lot's remaining quantity. A post-delivery return really puts the goods
   * back on the shelf, so both `on_hand` and `blocked` grow by the same amount
   * (the units exist but may not be sold until QC releases them), and the lot's
   * remaining quantity grows in the caller's transaction.
   */
  async receiveReturnedStock(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number; blocked: number }> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET on_hand = on_hand + ${quantity},
             blocked = blocked + ${quantity},
             updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
    `;
    if (affected === 0) {
      throw new ConflictException('Inventory balance disappeared while receiving the return');
    }
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.onHand);
    return {
      balance,
      before: after - quantity,
      after,
      blocked: Number(balance.blocked),
    };
  }

  /**
   * Release blocked stock to sellable (`blocked -= quantity`).
   *
   * The guard (`blocked >= quantity`) is evaluated by the database under the
   * row lock, so a double release or a release larger than the blocked
   * quantity is refused instead of driving `blocked` negative. On-hand does
   * not change: the goods were already physically present.
   */
  async releaseBlocked(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number; blocked: number } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET blocked = blocked - ${quantity},
             updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
         AND blocked >= ${quantity}
    `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    return {
      balance,
      before: Number(balance.onHand),
      after: Number(balance.onHand),
      blocked: Number(balance.blocked),
    };
  }

  /**
   * Scrap blocked stock: the goods leave the warehouse without being sold.
   *
   * Both `blocked` and `on_hand` drop in one guarded statement, so the units
   * cannot be scrapped twice and `on_hand` can never go negative. The caller
   * also adjusts the lot's remaining quantity when the receipt had added it.
   */
  async scrapBlocked(
    tx: Tx,
    balanceId: number,
    quantity: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number; blocked: number } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET blocked = blocked - ${quantity},
             on_hand = on_hand - ${quantity},
             updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
         AND blocked >= ${quantity}
         AND on_hand >= ${quantity}
    `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.onHand);
    return {
      balance,
      before: after + quantity,
      after,
      blocked: Number(balance.blocked),
    };
  }

  /**
   * Consume every reservation an order holds: called when the order reaches
   * `DELIVERED`, i.e. the moment its goods physically leave the warehouse.
   *
   * Without this the reservation was held forever (`reserved` never dropped,
   * `on_hand` never fell) — delivered stock stayed "available" and could be
   * oversold while the warehouse no longer held it. Each allocation is consumed
   * atomically (see `consumeStock`) and recorded as an `OUTBOUND` movement tied
   * to the order, so the movement ledger shows the goods leaving. The lot's
   * `remaining_quantity` is decremented in the same transaction so the lot
   * balance shown to customers tracks real deliveries.
   *
   * CONCURRENCY (lock order, round 3): before any balance is touched, every
   * distinct warehouse of the order's allocations is locked (ascending id), so
   * this path holds X(warehouse) → X(balance) like every other stock writer
   * (inbound / document complete / adjust — see `lockWarehouse`). Round 3
   * reproduced the resulting InnoDB deadlock on the test DB: with only
   * X(balance) held here, this path's movement insert needs only a shared FK
   * lock on the same warehouse row the inbound path already holds exclusively,
   * while inbound waits for the balance row — the victim got a raw P2034/1213
   * and its operation was lost (reproducer: `.tmp-verify/round3/`,
   * 30/30 rounds each in modes B and C before the fix). The motif is shared
   * with `OrdersService.releaseOrderReservations` (quarantine/release on
   * cancel) and the manual `release` endpoint, which take the same locks.
   *
   * `lockWarehouse` (not `requireActiveWarehouse`) on purpose: delivering an
   * order must stay possible even if the warehouse was deactivated mid-flight,
   * and this path must not gate on warehouse status it does not judge.
   *
   * Throws `ConflictException` when a balance no longer holds the reservation
   * (a concurrent writer changed it): the caller's transaction rolls back and
   * the operator can reload, instead of fabricating a shipment of stock the
   * warehouse does not have.
   */
  async consumeOrderStock(tx: Tx, orderId: number): Promise<void> {
    const allocations = await tx.inventoryAllocation.findMany({
      where: { orderItem: { partnerOrder: { orderId } } },
      include: { inventoryBalance: true },
    });
    // Lock every touched warehouse FIRST (ascending ids keep two concurrent
    // order transitions from claiming opposite warehouse orders), so the
    // movement inserts below can never deadlock with inbound/document paths.
    const warehouseIds = [...new Set(allocations.map((a) => a.inventoryBalance.warehouseId))].sort(
      (a, b) => a - b,
    );
    for (const warehouseId of warehouseIds) {
      await InventoryService.lockWarehouse(tx, warehouseId);
    }
    for (const alloc of allocations) {
      const quantity = Number(alloc.quantity);
      const consumed = await this.consumeStock(tx, alloc.inventoryBalanceId, quantity);
      if (!consumed) {
        throw new ConflictException(
          'The order stock changed while this request was being processed, please reload',
        );
      }
      // The lot's remaining quantity follows the goods that actually left.
      // Guarded (`remaining_quantity >= ?`) and claimed BEFORE the movement is
      // written: the lot must still hold the units being consumed. The previous
      // `GREATEST(..., 0)` clamp hid underflow and let the ledger claim a
      // shipment of stock the lot never had; a rejected guard now rolls the
      // whole delivery back (409) with no movement left behind.
      const lotAffected = await tx.$executeRaw`
        UPDATE product_lots
           SET remaining_quantity = remaining_quantity - ${quantity},
               updated_at = UTC_TIMESTAMP(3)
         WHERE id = ${alloc.productLotId}
           AND remaining_quantity >= ${quantity}
      `;
      if (lotAffected === 0) {
        throw new ConflictException(
          'The lot stock changed while this request was being processed, please reload',
        );
      }
      const balance = alloc.inventoryBalance;
      await this.recordMovement(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        type: InventoryMovementType.OUTBOUND,
        quantityDelta: -quantity,
        beforeQuantity: consumed.before,
        afterQuantity: consumed.after,
        referenceType: 'Order',
        referenceId: orderId,
        note: 'Giao hàng — hàng rời kho',
      });
    }
  }

  /**
   * Change a balance's on-hand quantity, atomically, without going negative.
   *
   * One conditional UPDATE: `on_hand = on_hand + ? WHERE id = ? AND
   * on_hand + ? >= 0`. The predicate is re-evaluated under the row's exclusive
   * lock, so concurrent stock changes cannot lose each other's arithmetic, and
   * an outbound document can never drive `on_hand` below zero. Returns `null`
   * when the guard rejected the change, with `before`/`after` read back for the
   * movement ledger.
   */
  async changeOnHand(
    tx: Tx,
    balanceId: number,
    delta: number,
  ): Promise<{ balance: InventoryBalance; before: number; after: number } | null> {
    const affected = await tx.$executeRaw`
      UPDATE inventory_balances
         SET on_hand = on_hand + ${delta}, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${balanceId}
         AND on_hand + ${delta} >= 0
    `;
    if (affected === 0) return null;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    const after = Number(balance.onHand);
    return { balance, before: after - delta, after };
  }

  /** Reserve stock for an order. Reserve never exceeds available. */
  async reserve(dto: ReserveInventoryDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      await InventoryService.requireActiveWarehouse(tx, dto.warehouseId);
      const balance = await this.requireBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      const available = InventoryService.available(
        Number(balance.onHand),
        Number(balance.reserved),
        Number(balance.blocked),
      );
      if (dto.quantity > available) {
        throw new BadRequestException(
          `Cannot reserve ${dto.quantity}: only ${available} available`,
        );
      }
      // The read above is only a friendly pre-check; `reserveStock` is the
      // guard, so a concurrent reservation can never oversell the balance.
      const reserved = await this.reserveStock(tx, balance.id, dto.quantity);
      if (!reserved) {
        throw new BadRequestException(
          `Cannot reserve ${dto.quantity}: not enough stock is available`,
        );
      }
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.RESERVE,
        quantityDelta: 0,
        beforeQuantity: reserved.before,
        afterQuantity: reserved.after,
        note: 'Reserve for order',
        actorUserId,
      });
      return this.withAvailable(reserved.balance);
    });
  }

  /**
   * Release a reservation (e.g. order cancelled).
   *
   * CONCURRENCY (lock order, round 3): the warehouse row is locked FIRST (same
   * shared practice as inbound / documents / adjust — see `lockWarehouse`).
   * Without it this path held only X(balance) while its movement insert needed
   * a shared FK lock on the warehouse row an inbound/document path may already
   * hold exclusively (the same reproduced deadlock shape as
   * `consumeOrderStock` / `releaseOrderReservations`; round 3 mode B/C on the
   * test DB). Manual releases at an INACTIVE warehouse stay allowed — this
   * lock deliberately has no status gate.
   */
  async release(dto: ReserveInventoryDto, actorUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      await InventoryService.lockWarehouse(tx, dto.warehouseId);
      const balance = await this.requireBalance(
        tx,
        dto.warehouseId,
        dto.productLotId,
        dto.productVariantId,
      );
      if (dto.quantity > Number(balance.reserved)) {
        throw new BadRequestException('Cannot release more than currently reserved');
      }
      // The read above is only a friendly pre-check; `releaseStock` is the
      // guard, so a concurrent consume/release can never drive `reserved`
      // below the stock the balance actually holds.
      const released = await this.releaseStock(tx, balance.id, dto.quantity);
      if (!released) {
        throw new ConflictException(
          'The order stock changed while this request was being processed, please reload',
        );
      }
      await this.recordMovement(tx, {
        warehouseId: dto.warehouseId,
        productLotId: dto.productLotId,
        productVariantId: dto.productVariantId,
        type: InventoryMovementType.RELEASE,
        quantityDelta: 0,
        beforeQuantity: released.before,
        afterQuantity: released.after,
        note: 'Release reservation',
        actorUserId,
      });
      return this.withAvailable(released.balance);
    });
  }

  /**
   * FEFO allocation: pick sellable lots with the earliest expiry first.
   * Only SELLABLE lots with a latest QC PASS and available stock are eligible.
   */
  async allocateFefo(
    tx: Tx,
    params: { productVariantId: number; quantity: number },
  ): Promise<AvailableStock[]> {
    const now = new Date();
    const balances = await tx.inventoryBalance.findMany({
      where: {
        productVariantId: params.productVariantId,
        warehouse: { status: RecordStatus.ACTIVE },
        productLot: {
          status: ProductLotStatus.SELLABLE,
          expiresAt: { gte: now },
        },
      },
      include: {
        productLot: {
          include: {
            qcInspections: { orderBy: { inspectedAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const eligible = balances
      .filter((b) => {
        // Defensive re-check: never trust the query alone to enforce sellability.
        if (b.productLot.status !== ProductLotStatus.SELLABLE) return false;
        if (b.productLot.expiresAt < now) return false;
        const latest = b.productLot.qcInspections[0];
        if (!latest || latest.result !== QcResult.PASS) return false;
        return InventoryService.available(Number(b.onHand), Number(b.reserved), Number(b.blocked)) > 0;
      })
      .map((b) => ({
        balanceId: b.id,
        warehouseId: b.warehouseId,
        productLotId: b.productLotId,
        productVariantId: b.productVariantId,
        onHand: Number(b.onHand),
        reserved: Number(b.reserved),
        blocked: Number(b.blocked),
        available: InventoryService.available(Number(b.onHand), Number(b.reserved), Number(b.blocked)),
        expiresAt: b.productLot.expiresAt,
      }))
      // Deterministic FEFO: earliest expiry first, balance id as the tie-break
      // so two balances sharing an expiry always allocate in the same order.
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.balanceId - b.balanceId);

    let remaining = params.quantity;
    const chosen: AvailableStock[] = [];
    for (const b of eligible) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.available);
      if (take <= 0) continue;
      chosen.push({ ...b, available: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(
        `Insufficient sellable stock for variant ${params.productVariantId}: short by ${remaining}`,
      );
    }
    return chosen;
  }

  async getOrCreateBalance(
    tx: Tx,
    warehouseId: number,
    productLotId: number,
    productVariantId: number,
  ): Promise<InventoryBalance> {
    const existing = await tx.inventoryBalance.findUnique({
      where: {
        warehouseId_productLotId_productVariantId: { warehouseId, productLotId, productVariantId },
      },
    });
    if (existing) return existing;
    const lot = await tx.productLot.findUnique({ where: { id: productLotId } });
    if (!lot) throw new NotFoundException('Product lot not found');
    return tx.inventoryBalance.create({
      data: { warehouseId, productLotId, productVariantId, unit: lot.unit },
    });
  }

  async requireBalance(
    tx: Tx,
    warehouseId: number,
    productLotId: number,
    productVariantId: number,
  ): Promise<InventoryBalance> {
    const balance = await tx.inventoryBalance.findUnique({
      where: {
        warehouseId_productLotId_productVariantId: { warehouseId, productLotId, productVariantId },
      },
    });
    if (!balance) throw new NotFoundException('Inventory balance not found');
    return balance;
  }

  async recordMovement(
    tx: Tx,
    input: {
      warehouseId: number;
      productLotId: number;
      productVariantId: number;
      type: InventoryMovementType;
      quantityDelta: number;
      beforeQuantity: number;
      afterQuantity: number;
      referenceType?: string;
      referenceId?: number;
      note?: string;
      actorUserId?: number | null;
    },
  ): Promise<void> {
    await tx.inventoryMovement.create({
      data: {
        warehouseId: input.warehouseId,
        productLotId: input.productLotId,
        productVariantId: input.productVariantId,
        type: input.type,
        quantityDelta: input.quantityDelta,
        beforeQuantity: input.beforeQuantity,
        afterQuantity: input.afterQuantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        note: input.note,
        createdByUserId: input.actorUserId ?? null,
      },
    });
  }

  movements(query: { page?: number; limit?: number; productLotId?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.InventoryMovementWhereInput = query.productLotId
      ? { productLotId: query.productLotId }
      : {};
    return Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { productLot: { select: { id: true, code: true } } },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }
}
