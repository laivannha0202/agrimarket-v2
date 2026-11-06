import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import {
  buildPagination,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import {
  deliveryEvidenceProblems,
  loadDeliveryEvidence,
  type DeliveryEvidence,
} from './delivery-evidence.js';
import { SHIPMENT_LEFT_WAREHOUSE_STATUSES } from '../shipments/shipment-statuses.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  OrderStatus,
  PartnerOrderStatus,
  ShipmentStatus,
} from '../../generated/prisma/enums.js';

type Tx = Prisma.TransactionClient;

/**
 * Order status that the shipped-goods evidence supports.
 *
 *   - any parcel of the order already left the warehouse -> SHIPPING
 *   - nothing left yet, but the goods were reserved and packed -> READY_TO_SHIP
 *
 * `PENDING_CONFIRMATION`/`CONFIRMED`/`PREPARING` are never a repair target: an
 * order that reached `DELIVERED` was at least `READY_TO_SHIP` in its own state
 * trail, so reverting below that would invent a history that never happened.
 */
function evidenceStatusFor(statuses: ShipmentStatus[]): OrderStatus {
  const left = statuses.some((s) =>
    SHIPMENT_LEFT_WAREHOUSE_STATUSES.includes(s),
  );
  return (
    left ? OrderStatus.SHIPPING : OrderStatus.READY_TO_SHIP
  ) as OrderStatus;
}

/** One partner order of a repaired order: what it was, what it became. */
export interface ReconciledPartnerOrder {
  id: number;
  code: string;
  partnerName?: string | null;
  previousStatus: PartnerOrderStatus;
  nextStatus: PartnerOrderStatus | null;
}

export interface DeliveryReconciliationDecision {
  orderId: number;
  orderCode: string;
  /** What kind of decision the routine reached (see method docs). */
  action: 'REVERTED' | 'SKIPPED' | 'UNREPAIRABLE' | 'NOT_APPLICABLE';
  previousStatus: OrderStatus | null;
  nextStatus: OrderStatus | null;
  partnerOrders: ReconciledPartnerOrder[];
  /** Evidence problems observed when the decision was made. */
  problems: string[];
  /** Reserved units whose reservation/on-hand/lot arithmetic was restored. */
  restoredUnits: number;
  note?: string;
}

export interface DeliveryReconciliationResult {
  scanned: number;
  reverted: number;
  unrepairable: number;
  actions: DeliveryReconciliationDecision[];
}

/**
 * Shared decision of `inspect` and of the first phases of `repairOrder`, so
 * both paths can never disagree about what a repair would do.
 */
interface Evaluation {
  action: 'NOT_APPLICABLE' | 'UNREPAIRABLE' | 'REPAIRABLE';
  problems: string[];
  note?: string;
  /** The order status the evidence supports (when REPAIRABLE / decide-able). */
  nextStatus: OrderStatus | null;
}

/**
 * Reconcile order statuses against the delivery evidence they must be backed by
 * (see `delivery-evidence.ts` for the single source of that rule).
 *
 * WHY THIS EXISTS
 *
 * Before commit `0a6939f` introduced the delivery-evidence guard, an admin
 * could move an order to `DELIVERED` by hand while its parcels were still
 * travelling (or before a parcel ever existed): the legacy
 * `PATCH /orders/:id/status` had no evidence check. The order was flipped,
 * every partner order was swept to `DELIVERED`, and `consumeOrderStock` ran —
 * stock left the ledger for goods whose delivery nobody had ever confirmed.
 * The guard makes that impossible now, but rows written before it existed stay
 * flagged by the database invariant audit
 * (`order_delivered_without_shipment_evidence`). This service is the planned,
 * evidence-based correction for exactly those rows.
 *
 * WHAT ONE RUN DOES, PER AFFLICTED ORDER, INSIDE ONE `READ COMMITTED`
 * TRANSACTION:
 *
 *   1. `SELECT ... FOR UPDATE` the order row: an operator working on the same
 *      order serialises against this repair.
 *   2. Re-load the evidence *inside* the transaction; a just-committed real
 *      delivery ends the routine (`NOT_APPLICABLE`) — the repair never races a
 *      legitimate one into a double undo.
 *   3. Refuse (`UNREPAIRABLE`) anything that human judgement should own:
 *        - a partner order already carries a real `DELIVERED` shipment with a
 *          `deliveredAt` — partially-delivered legacy rows cannot be undone
 *          without rewriting that true delivery;
 *        - a partner order is `CANCELLED` — its stock went through quarantine
 *          and the return flow already owns those units;
 *        - there are no partner orders to reason about;
 *        - the recorded `OUTBOUND` outflow does not equal the reserved
 *          allocations — the restore arithmetic would not balance.
 *   4. Restore the inventory arithmetic so the row matches the system's own
 *      "shipped but not yet delivered" model: every allocation's `on_hand` and
 *      `reserved` grow back by the allocation quantity, the lot's
 *      `remaining_quantity` grows back (capped at the lot quantity), and one
 *      `ADJUSTMENT` movement per allocation is written
 *      (`referenceType: 'DeliveryReconciliation'`). The ledger stays exact:
 *      the legacy `OUTBOUND` stays as history, the compensating `ADJUSTMENT`
 *      nets it out, and the *real* delivery consumes the reservation later.
 *   5. Compare-and-set the order (`DELIVERED` -> evidence status) and every
 *      partner order still at `DELIVERED` to that same status — the exact
 *      mirror of the legacy sweep that pushed them there. Terminal
 *      (`CANCELLED`) rows are never resurrected. A `0`-row CAS means someone
 *      else moved first: the transaction throws and rolls back (nothing is
 *      half-restored).
 *   6. One audit row (`ORDER_DELIVERY_REVERSED`) records actor, problems,
 *      restored units and both statuses.
 *
 * PAYMENTS ARE NEVER TOUCHED: the repair is a statement about the physical
 * delivery, not about money. A COD payment stays `PENDING` and can be
 * confirmed only after the real delivery completes; a collected online payment
 * simply sits on a SHIPPING order until delivery is confirmed, as with any
 * other order. Settlement/refund money flows keep their own guards.
 */
@Injectable()
export class OrderDeliveryReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrderDeliveryReconciliationService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Off by default: the repair rewrites order statuses, so turning it into an
    // automatic background job is a deployment decision, not a default. Set
    // ORDER_DELIVERY_RECONCILIATION_SWEEP_MINUTES (e.g. `60`) to enable; the
    // interval is that figure in minutes. `0`/unset keeps it off.
    const minutes = Number(
      process.env.ORDER_DELIVERY_RECONCILIATION_SWEEP_MINUTES ?? '0',
    );
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.timer = setInterval(() => {
      void this.reconcileAll({ actorUserId: null }).then(
        (result) => {
          if (result.reverted || result.unrepairable) {
            this.logger.log(
              `Delivery reconciliation: ${result.reverted} reverted, ${result.unrepairable} need review ` +
                `(scanned ${result.scanned})`,
            );
          }
        },
        (error) =>
          this.logger.warn(
            `Delivery reconciliation failed: ${(error as Error).message}`,
          ),
      );
    }, minutes * 60_000);
    // Do not hold the process open just for this timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Admin monitoring list: every `DELIVERED` order whose shipment evidence is
   * incomplete, with the decision a repair would take. Decision-relevant rows
   * are computed from one joined read; ordinary well-evidenced delivery rows
   * cost nothing beyond that single query.
   */
  async list(query: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<DeliveryReconciliationDecision>> {
    const { skip, take, page, limit } = buildPagination(
      query.page,
      query.limit,
    );
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.DELIVERED },
      include: {
        partnerOrders: {
          select: {
            id: true,
            code: true,
            status: true,
            partner: { select: { name: true } },
            shipments: {
              select: { id: true, code: true, status: true, deliveredAt: true },
              orderBy: { id: 'asc' },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });

    const actions: DeliveryReconciliationDecision[] = [];
    for (const order of orders) {
      actions.push(
        this.decideFromJoined(
          order.id,
          order.code,
          order.status,
          order.partnerOrders,
        ),
      );
    }
    const actionable = actions.filter((a) => a.action !== 'NOT_APPLICABLE');
    return paginate(
      actionable.slice(skip, skip + take),
      actionable.length,
      page,
      limit,
    );
  }

  /**
   * Decide — without writing — what a repair run would do with `orderId`.
   * `NOT_APPLICABLE` means the order is already consistent: either the
   * evidence backs the DELIVERED status, or the order is not DELIVERED.
   */
  async inspect(orderId: number): Promise<DeliveryReconciliationDecision> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, code: true, status: true },
    });
    if (!order || order.status !== OrderStatus.DELIVERED) {
      return {
        orderId,
        orderCode: order?.code ?? String(orderId),
        action: 'NOT_APPLICABLE',
        previousStatus: order?.status ?? null,
        nextStatus: null,
        partnerOrders: [],
        problems: [],
        restoredUnits: 0,
        note: 'Đơn hàng không ở trạng thái DELIVERED',
      };
    }

    // Read-only probe outside a transaction: a concurrent delivery can only
    // make the report a moment stale, and the repair re-decides inside its
    // own transaction anyway.
    const evidence = await loadDeliveryEvidence(
      this.prisma as unknown as Tx,
      orderId,
    );
    return this.decide(order.id, order.code, order.status, evidence);
  }

  /**
   * Reconcile one order id. Cold path for ops: `dryRun` reports the same
   * decision without touching the database.
   */
  async reconcileOrder(
    orderId: number,
    { dryRun, actorUserId }: { dryRun?: boolean; actorUserId: number | null },
  ): Promise<DeliveryReconciliationDecision> {
    if (dryRun) return this.inspect(orderId);
    return this.repairOrder(orderId, actorUserId);
  }

  /**
   * Walk every `DELIVERED` order and repair the ones whose evidence is
   * incomplete and which are mechanically repairable. Never throws for a single
   * bad row: the report carries the failure so one blocked order cannot hide
   * the rest.
   */
  async reconcileAll({
    dryRun,
    actorUserId,
  }: {
    dryRun?: boolean;
    actorUserId: number | null;
  }): Promise<DeliveryReconciliationResult> {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.DELIVERED },
      select: { id: true, code: true },
      orderBy: { id: 'asc' },
    });

    // Dry run decides per order exactly like the real run would, but without
    // writing anything: every `SKIPPED` decision is a row the real run would
    // revert.
    if (dryRun) {
      let reverted = 0;
      let unrepairable = 0;
      const actions: DeliveryReconciliationDecision[] = [];
      for (const order of orders) {
        const decision = await this.inspect(order.id);
        if (decision.action === 'SKIPPED') reverted += 1;
        if (decision.action === 'UNREPAIRABLE') unrepairable += 1;
        actions.push(decision);
      }
      return { scanned: orders.length, reverted, unrepairable, actions };
    }

    const actions: DeliveryReconciliationDecision[] = [];
    let reverted = 0;
    let unrepairable = 0;

    for (const order of orders) {
      try {
        const decision = await this.repairOrder(order.id, actorUserId);
        actions.push(decision);
        if (decision.action === 'REVERTED') reverted += 1;
        if (decision.action === 'UNREPAIRABLE') unrepairable += 1;
      } catch (error) {
        // The repair transaction is atomic, so a failure leaves the order
        // exactly as it was. Surface the reason instead of aborting the batch.
        actions.push({
          orderId: order.id,
          orderCode: order.code,
          action: 'UNREPAIRABLE',
          previousStatus: OrderStatus.DELIVERED,
          nextStatus: null,
          partnerOrders: [],
          problems: [],
          restoredUnits: 0,
          note: `Không sửa được: ${(error as Error).message}`,
        });
        unrepairable += 1;
      }
    }

    return { scanned: orders.length, reverted, unrepairable, actions };
  }

  /**
   * One repair run.
   *
   * Returns `REVERTED` when the order was reverted, `NOT_APPLICABLE` when the
   * evidence already backed the status (or someone else moved first), and
   * `UNREPAIRABLE` when a human must decide (partial delivery / cancelled
   * partner order / unbalanced restore arithmetic).
   */
  private async repairOrder(
    orderId: number,
    actorUserId: number | null,
  ): Promise<DeliveryReconciliationDecision> {
    return this.prisma.$transaction(
      async (tx) => {
        // Serialise against any concurrent status write on this order. Without
        // the lock two repairs (or a repair and a confirm-delivery) could both
        // pass their CAS on the same row; the lock keeps the second out before
        // its inventory restore ever runs.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE
        `;
        const order = locked.length
          ? await tx.order.findUniqueOrThrow({
              where: { id: orderId },
              select: { id: true, code: true, status: true },
            })
          : null;
        if (!order) {
          return {
            orderId,
            orderCode: String(orderId),
            action: 'NOT_APPLICABLE',
            previousStatus: null,
            nextStatus: null,
            partnerOrders: [],
            problems: ['Đơn hàng không tồn tại'],
            restoredUnits: 0,
          };
        }
        if (order.status !== OrderStatus.DELIVERED) {
          return {
            orderId: order.id,
            orderCode: order.code,
            action: 'NOT_APPLICABLE',
            previousStatus: order.status,
            nextStatus: null,
            partnerOrders: [],
            problems: [],
            restoredUnits: 0,
          };
        }

        const evidence = await loadDeliveryEvidence(tx, orderId);
        const evaluation = this.evaluate(order.status, evidence);
        if (evaluation.action === 'NOT_APPLICABLE') {
          return {
            orderId: order.id,
            orderCode: order.code,
            action: 'NOT_APPLICABLE',
            previousStatus: order.status,
            nextStatus: null,
            partnerOrders: [],
            problems: [],
            restoredUnits: 0,
            note: 'Bằng chứng giao hàng đầy đủ — không cần sửa',
          };
        }
        if (evaluation.action === 'UNREPAIRABLE') {
          return {
            orderId: order.id,
            orderCode: order.code,
            action: 'UNREPAIRABLE',
            previousStatus: order.status,
            nextStatus: null,
            partnerOrders: this.previewPartnerOrders(
              orderId,
              evidence,
              evaluation,
            ),
            problems: evaluation.problems,
            restoredUnits: 0,
            note: evaluation.note,
          };
        }

        // Everything below only runs when the routine has decided the row is
        // mechanically repairable. Names for the human-readable report.
        const partnerNames = await this.loadPartnerNames(tx, orderId);

        // The restore must net out exactly the recorded outflow. Check it
        // BEFORE claiming anything: if the ledger does not balance against the
        // allocations no restore may touch stock for this order.
        const allocations = await tx.inventoryAllocation.findMany({
          where: { orderItem: { partnerOrder: { orderId } } },
          include: { inventoryBalance: true },
          orderBy: { id: 'asc' },
        });
        this.assertRestoreArithmetic(
          orderId,
          allocations,
          await tx.inventoryMovement.findMany({
            where: {
              type: InventoryMovementType.OUTBOUND,
              referenceType: 'Order',
              referenceId: orderId,
            },
          }),
        );

        const nextOrderStatus = evaluation.nextStatus as OrderStatus;

        // 1. Compare-and-set the order first: only the transaction that claims
        //    the DELIVERED row may restore its stock. The predicate also keeps
        //    a stale decision from acting on an already-repaired row.
        const claimed = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.DELIVERED },
          // The reservation deadline belongs to PENDING_CONFIRMATION only; the
          // sweep must never look at the restored order again.
          data: { status: nextOrderStatus, reservationExpiresAt: null },
        });
        if (claimed.count === 0) {
          throw new ConflictException(
            'The order status changed while the repair was deciding, please reload',
          );
        }

        // 2. Mirror the legacy sweep back: every partner order that still sits
        //    at DELETE-swept `DELIVERED` moves to the order's evidence status.
        //    Rows that already moved (or were cancelled) are reported, never
        //    forced back.
        const claims: ReconciledPartnerOrder[] = [];
        for (const po of evidence.partnerOrders) {
          const previousStatus = po.status;
          let nextStatus: PartnerOrderStatus | null = null;
          if (previousStatus === PartnerOrderStatus.DELIVERED) {
            const claimedPo = await tx.partnerOrder.updateMany({
              where: { id: po.id, status: PartnerOrderStatus.DELIVERED },
              data: { status: nextOrderStatus },
            });
            if (claimedPo.count > 0) nextStatus = nextOrderStatus;
          }
          claims.push({
            id: po.id,
            code: po.code,
            partnerName: partnerNames.get(po.id) ?? null,
            previousStatus,
            nextStatus,
          });
        }

        // 3. Restore the inventory arithmetic (allocation id order keeps the
        //    per-balance writes deterministic): on_hand and reserved grow back
        //    by the allocation quantity, the lot grows back under its cap, and
        //    one compensating ADJUSTMENT movement is recorded. A rejected
        //    guard throws — the transaction rolls back with nothing
        //    half-restored.
        const warehouseIds = [
          ...new Set(allocations.map((a) => a.inventoryBalance.warehouseId)),
        ].sort((a, b) => a - b);
        for (const warehouseId of warehouseIds) {
          // Same warehouse -> balance lock order as consume/release so the
          // repair can never deadlock with a checkout or an inbound document.
          await InventoryService.lockWarehouse(tx, warehouseId);
        }
        let restoredUnits = 0;
        for (const alloc of allocations) {
          const quantity = Number(alloc.quantity);
          const balanceAffected = await tx.$executeRaw`
            UPDATE inventory_balances
               SET on_hand = on_hand + ${quantity},
                   reserved = reserved + ${quantity},
                   updated_at = UTC_TIMESTAMP(3)
             WHERE id = ${alloc.inventoryBalanceId}
          `;
          if (balanceAffected === 0) {
            throw new ConflictException(
              `The inventory balance ${alloc.inventoryBalanceId} disappeared while restoring`,
            );
          }
          // Lot remaining follows the exact reversal of the legacy consume.
          // The cap (`remaining <= quantity`) is the second line of defence
          // against the restore running twice on the same lot.
          const lotAffected = await tx.$executeRaw`
            UPDATE product_lots
               SET remaining_quantity = remaining_quantity + ${quantity},
                   updated_at = UTC_TIMESTAMP(3)
             WHERE id = ${alloc.productLotId}
               AND remaining_quantity + ${quantity} <= quantity
          `;
          if (lotAffected === 0) {
            throw new ConflictException(
              `The lot ${alloc.productLotId} cannot hold ${quantity} more units; restore refused`,
            );
          }
          const balance = await tx.inventoryBalance.findUniqueOrThrow({
            where: { id: alloc.inventoryBalanceId },
            select: {
              warehouseId: true,
              productLotId: true,
              productVariantId: true,
              onHand: true,
            },
          });
          const after = Number(balance.onHand);
          await tx.inventoryMovement.create({
            data: {
              warehouseId: balance.warehouseId,
              productLotId: balance.productLotId,
              productVariantId: balance.productVariantId,
              type: InventoryMovementType.ADJUSTMENT,
              quantityDelta: quantity,
              beforeQuantity: after - quantity,
              afterQuantity: after,
              referenceType: 'DeliveryReconciliation',
              referenceId: orderId,
              note: `Hoàn kho ${quantity} (${alloc.inventoryBalanceId}) do đảo ngược DELIVERED không có bằng chứng giao`,
              createdByUserId: actorUserId ?? null,
            },
          });
          restoredUnits += quantity;
        }

        await this.audit.record(
          {
            actorUserId,
            action: 'ORDER_DELIVERY_REVERSED',
            entityType: 'Order',
            entityId: String(orderId),
            beforeJson: { status: OrderStatus.DELIVERED },
            afterJson: {
              status: nextOrderStatus,
              partnerOrders: claims.map((c) => ({
                id: c.id,
                status: c.nextStatus,
              })),
              restoredUnits,
              problems: evaluation.problems,
            },
            reason:
              'Đơn ghi DELIVERED nhưng thiếu bằng chứng giao hàng (legacy)',
          },
          tx,
        );

        return {
          orderId: order.id,
          orderCode: order.code,
          action: 'REVERTED',
          previousStatus: OrderStatus.DELIVERED,
          nextStatus: nextOrderStatus,
          partnerOrders: claims,
          problems: evaluation.problems,
          restoredUnits,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Names every reason the row needs a human instead of the routine, or
   * evaluates to REPAIRABLE with the target status the evidence supports.
   * NEVER writes anything.
   */
  private evaluate(
    status: OrderStatus,
    evidence: DeliveryEvidence,
  ): Evaluation {
    if (status !== OrderStatus.DELIVERED) {
      return { action: 'NOT_APPLICABLE', problems: [], nextStatus: null };
    }
    const problems = deliveryEvidenceProblems(evidence);
    if (problems.length === 0) {
      return { action: 'NOT_APPLICABLE', problems: [], nextStatus: null };
    }

    const nextStatus = this.plannedTarget(evidence);
    for (const partnerOrder of evidence.partnerOrders) {
      const delivered = partnerOrder.shipments.some(
        (s) => s.status === ShipmentStatus.DELIVERED && s.deliveredAt !== null,
      );
      if (delivered) {
        return {
          action: 'UNREPAIRABLE',
          problems,
          nextStatus,
          note:
            `Đơn đối tác ${partnerOrder.code} đã có vận đơn giao thành công thật — ` +
            'cần quyết định của người kiểm tra, không thể tự đảo ngược',
        };
      }
      if (partnerOrder.status === PartnerOrderStatus.CANCELLED) {
        return {
          action: 'UNREPAIRABLE',
          problems,
          nextStatus,
          note:
            `Đơn đối tác ${partnerOrder.code} đã hủy — hàng đi theo quy trình hoàn/kiểm định, ` +
            'không thể đảo ngược ở đây',
        };
      }
    }
    if (
      problems.some((message) =>
        message.startsWith('Đơn hàng chưa có đơn đối tác'),
      )
    ) {
      return {
        action: 'UNREPAIRABLE',
        problems,
        nextStatus,
        note: 'Đơn hàng chưa có đơn đối tác nào — cấu trúc dữ liệu không thể suy luận trạng thái giao',
      };
    }
    return { action: 'REPAIRABLE', problems, nextStatus };
  }

  /** Non-transactional decision for the monitoring list (`inspect`). */
  private async decide(
    orderId: number,
    orderCode: string,
    status: OrderStatus,
    evidence: DeliveryEvidence,
  ): Promise<DeliveryReconciliationDecision> {
    const partnerNames = await this.loadPartnerNames(
      this.prisma as unknown as Tx,
      orderId,
    );
    const evaluation = this.evaluate(status, evidence);
    return this.decisionFor(
      orderId,
      orderCode,
      status,
      evaluation,
      evidence,
      partnerNames,
    );
  }

  /** Same decision, built from an already-joined Prisma read (`audit`). */
  private decideFromJoined(
    orderId: number,
    orderCode: string,
    status: OrderStatus,
    partnerOrders: Array<{
      id: number;
      code: string;
      status: PartnerOrderStatus;
      partner: { name: string } | null;
      shipments: Array<{
        id: number;
        code: string;
        status: ShipmentStatus;
        deliveredAt: Date | null;
      }>;
    }>,
  ): DeliveryReconciliationDecision {
    const evidence: DeliveryEvidence = {
      partnerOrders: partnerOrders.map((po) => ({
        id: po.id,
        code: po.code,
        status: po.status,
        shipments: po.shipments,
      })),
    };
    const partnerNames = new Map<number, string | null>(
      partnerOrders.map((po) => [po.id, po.partner?.name ?? null]),
    );
    const evaluation = this.evaluate(status, evidence);
    return this.decisionFor(
      orderId,
      orderCode,
      status,
      evaluation,
      evidence,
      partnerNames,
    );
  }

  /** The report shape both decide paths share. */
  private decisionFor(
    orderId: number,
    orderCode: string,
    status: OrderStatus,
    evaluation: Evaluation,
    evidence: DeliveryEvidence,
    partnerNames: Map<number, string | null>,
  ): DeliveryReconciliationDecision {
    const partnerOrders = this.previewPartnerOrders(
      orderId,
      evidence,
      evaluation,
      partnerNames,
    );
    if (evaluation.action === 'NOT_APPLICABLE') {
      return {
        orderId,
        orderCode,
        action: 'NOT_APPLICABLE',
        previousStatus: status,
        nextStatus: null,
        partnerOrders,
        problems: evaluation.problems,
        restoredUnits: 0,
      };
    }
    if (evaluation.action === 'UNREPAIRABLE') {
      return {
        orderId,
        orderCode,
        action: 'UNREPAIRABLE',
        previousStatus: status,
        nextStatus: null,
        partnerOrders,
        problems: evaluation.problems,
        restoredUnits: 0,
        note: evaluation.note,
      };
    }
    return {
      orderId,
      orderCode,
      action: 'SKIPPED',
      previousStatus: status,
      nextStatus: evaluation.nextStatus,
      partnerOrders,
      problems: evaluation.problems,
      restoredUnits: 0,
      note: 'Có thể tự đảo ngược — chạy POST /orders/delivery-reconciliation với `dryRun: false`',
    };
  }

  /**
   * The partner-order rows a decision talks about, with the status they would
   * claim (or `null` when they are not claimed: cancelled rows, and rows a
   * concurrent flow already moved away from DELIVERED).
   */
  private previewPartnerOrders(
    orderId: number,
    evidence: DeliveryEvidence,
    evaluation: Evaluation,
    partnerNames?: Map<number, string | null>,
  ): ReconciledPartnerOrder[] {
    return evidence.partnerOrders.map((po) => {
      const previousStatus = po.status;
      let nextStatus: PartnerOrderStatus | null = null;
      if (
        evaluation.action === 'REPAIRABLE' &&
        previousStatus === PartnerOrderStatus.DELIVERED
      ) {
        nextStatus = evaluation.nextStatus;
      }
      return {
        id: po.id,
        code: po.code,
        partnerName: partnerNames?.get(po.id) ?? null,
        previousStatus,
        nextStatus,
      };
    });
  }

  /** `partnerOrder id -> partner display name`, one query, one map. */
  private async loadPartnerNames(
    tx: Tx,
    orderId: number,
  ): Promise<Map<number, string | null>> {
    const rows = await tx.partnerOrder.findMany({
      where: { orderId },
      select: { id: true, partner: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.partner?.name ?? null]));
  }

  /** Order status the evidence supports (SHIPPING when goods left the warehouse). */
  private plannedTarget(evidence: DeliveryEvidence): OrderStatus {
    return evidenceStatusFor(
      evidence.partnerOrders.flatMap((po) => po.shipments.map((s) => s.status)),
    );
  }

  /**
   * The restore may only run when the recorded `OUTBOUND` outflow for this
   * order equals its reserved allocations, per balance. `consumeOrderStock`
   * wrote one `-quantity` movement per allocation at the legacy DELIVERED flip,
   * so equality is what "the legacy consume charged every reservation exactly
   * once" looks like: any imbalance means hands other than the routine were on
   * this ledger and rewriting it would fabricate or bury stock.
   */
  private assertRestoreArithmetic(
    orderId: number,
    allocations: Array<{
      quantity: Prisma.Decimal;
      inventoryBalanceId: number;
      inventoryBalance: {
        warehouseId: number;
        productLotId: number;
        productVariantId: number;
      };
    }>,
    movements: Array<{
      warehouseId: number;
      productLotId: number;
      productVariantId: number;
      quantityDelta: Prisma.Decimal;
    }>,
  ): void {
    if (allocations.length === 0 && movements.length === 0) {
      return; // an order without stock never needs a restore
    }

    const byBalanceKey = (b: {
      warehouseId: number;
      productLotId: number;
      productVariantId: number;
    }) => `${b.warehouseId}:${b.productLotId}:${b.productVariantId}`;

    const allocTotals = new Map<
      string,
      { balanceId: number; quantity: number }
    >();
    for (const alloc of allocations) {
      const key = byBalanceKey(alloc.inventoryBalance);
      const entry = allocTotals.get(key) ?? {
        balanceId: alloc.inventoryBalanceId,
        quantity: 0,
      };
      entry.quantity += Number(alloc.quantity);
      allocTotals.set(key, entry);
    }

    const outflowTotals = new Map<string, number>();
    for (const movement of movements) {
      const key = byBalanceKey(movement);
      outflowTotals.set(
        key,
        (outflowTotals.get(key) ?? 0) + Number(movement.quantityDelta),
      );
    }

    for (const [key, { balanceId, quantity }] of allocTotals) {
      const outflow = outflowTotals.get(key);
      if (outflow === undefined) {
        throw new ConflictException(
          `Order ${orderId}: balance ${balanceId} has reserved allocations but no recorded outflow — restore refused`,
        );
      }
      if (outflow !== -quantity) {
        throw new ConflictException(
          `Order ${orderId}: balance ${balanceId} outflow ${-outflow} does not match the reserved quantity ${quantity} — restore refused`,
        );
      }
    }
    for (const key of outflowTotals.keys()) {
      if (!allocTotals.has(key)) {
        throw new ConflictException(
          `Order ${orderId}: recorded outflow on balance key ${key} has no matching allocation — restore refused`,
        );
      }
    }
  }
}
