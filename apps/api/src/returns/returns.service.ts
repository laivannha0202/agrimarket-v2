import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { QuarantineService, QUARANTINE_SOURCES } from '../quarantine/quarantine.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateReturnRequestDto, UpdateReturnRequestDto } from './dto/return.dto.js';
import type { Prisma, ReturnRequest } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  QuarantineCaseStatus,
  RefundStatus,
  ReturnRequestStatus,
  TraceEventType,
} from '../../generated/prisma/enums.js';

/**
 * Statuses that still hold a claim on the returned quantity.
 *
 * A customer may return part of a line, then ask for the rest. The quantity
 * already spoken for is therefore every request that has NOT been rejected or
 * refunded: a REJECTED request releases its quantity back to the customer, and
 * a REFUNDED one is finished. Counting the others is what stops the same unit
 * being promised twice.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ACTIVE_RETURN_STATUSES: ReturnRequestStatus[] = [
  ReturnRequestStatus.REQUESTED,
  ReturnRequestStatus.APPROVED,
  ReturnRequestStatus.RETURNING,
  ReturnRequestStatus.RECEIVED,
  ReturnRequestStatus.QC_PENDING,
];

/**
 * Explicit return state machine. `REFUNDED` and `REJECTED` are terminal; there
 * is no path back to an earlier status, so a rejected request can never be
 * revived to claim the same units again.
 */
const RETURN_TRANSITIONS: Record<ReturnRequestStatus, ReturnRequestStatus[]> = {
  REQUESTED: [ReturnRequestStatus.APPROVED, ReturnRequestStatus.REJECTED],
  APPROVED: [ReturnRequestStatus.RETURNING, ReturnRequestStatus.REJECTED],
  RETURNING: [ReturnRequestStatus.RECEIVED],
  RECEIVED: [ReturnRequestStatus.QC_PENDING],
  QC_PENDING: [ReturnRequestStatus.REFUNDED, ReturnRequestStatus.REJECTED],
  REFUNDED: [],
  REJECTED: [],
};

/**
 * One row of `GET /returns/eligible-items`.
 *
 * `returnableQuantity` is computed by the server from the purchased quantity
 * minus everything already tied up in active requests. The client displays it
 * and cannot raise it — `POST /returns` re-checks against the same sum.
 */
export interface EligibleReturnItem {
  orderItemId: number;
  orderId: number;
  orderCode: string;
  productId: number;
  productName: string;
  variantName: string;
  sku: string;
  /** What was bought. */
  purchasedQuantity: string;
  /** Still free to request: purchased minus active requests. */
  returnableQuantity: string;
  unitPrice: string;
  imageUrl: string | null;
}

/**
 * Return flow: REQUESTED -> APPROVED -> RETURNING -> RECEIVED -> QC_PENDING ->
 * REFUNDED (or REJECTED at any step). Returned goods are quarantined and must
 * pass QC before becoming sellable again — never added straight back.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evidence: EvidenceService,
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly quarantine?: QuarantineService,
  ) {}

  async create(customerId: number, dto: CreateReturnRequestDto): Promise<ReturnRequest> {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: dto.orderItemId },
      include: { partnerOrder: { include: { order: true } } },
    });
    if (!orderItem) throw new NotFoundException('Order item not found');
    const order = orderItem.partnerOrder.order;
    if (order.customerId !== customerId) {
      throw new BadRequestException('You can only return items from your own orders');
    }
    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('Only delivered orders can be returned');
    }

    /**
     * The quantity check is against what is STILL returnable, not the raw
     * purchased quantity.
     *
     * The old rule only compared the request with `orderItem.quantity`, so a
     * customer could ask for the whole line, and then ask for the whole line
     * again: each request passed on its own and the customer ended up promised
     * twice the goods they ever received. Subtracting the active requests makes
     * the second one fail here — but only if the two requests cannot both read
     * the old sum. A transaction alone does NOT provide that: under
     * REPEATABLE READ each transaction keeps its snapshot and both pass
     * (measured: two concurrent full-quantity requests, both accepted).
     *
     * The serialisation point is the parent order-item row: the transaction
     * claims it with `SELECT … FOR UPDATE` before reading the active claims, so
     * a second create for the same item waits at that lock. The concurrent
     * create's insert also takes a shared FK lock on this same row, so it
     * cannot slip an uncommitted request into the sum. The read happens AFTER
     * the lock, under READ COMMITTED (docs/CONCURRENCY-AUDIT.md §2.2), so the
     * loser sees the winner's committed row and is refused with the exact
     * remaining quantity.
     *
     * Scope note: only the create path is serialised here. A status transition
     * that moves a REJECTED request back into an active status could still
     * raise the claimed sum afterwards — that is the missing state machine
     * (BL-03), tracked separately.
     */
    const created = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: number; quantity: unknown }[]>`
          SELECT id, quantity FROM order_items WHERE id = ${orderItem.id} FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException('Order item not found');
        const active = await tx.returnRequest.findMany({
          where: { orderItemId: orderItem.id, status: { in: ACTIVE_RETURN_STATUSES } },
          select: { quantity: true },
        });
        const alreadyClaimed = active.reduce((sum, r) => sum + Number(r.quantity), 0);
        const returnable = Number(locked[0].quantity) - alreadyClaimed;
        if (dto.quantity > returnable) {
          throw new BadRequestException(
            returnable <= 0
              ? 'This item has already been fully claimed in another return request'
              : `You can return at most ${returnable} of this item`,
          );
        }
        const request = await tx.returnRequest.create({
          data: {
            orderId: order.id,
            orderItemId: orderItem.id,
            customerId,
            quantity: dto.quantity,
            reason: dto.reason,
            status: ReturnRequestStatus.REQUESTED,
          },
        });
        await this.evidence.bind(tx, customerId, dto.evidenceIds, { returnId: request.id });
        return request;
      },
      { isolationLevel: 'ReadCommitted' },
    );

    return created;
  }
  /**
   * Items the customer may still return, for the "choose a product" step.
   *
   * One query returns every delivered line of the customer's orders, with the
   * quantity already claimed by active requests folded in. Lines with nothing
   * left are dropped, so the picker never offers a product that would fail on
   * submit.
   */
  async listEligibleItems(
    customerId: number,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.OrderItemWhereInput = {
      partnerOrder: { order: { customerId, status: 'DELIVERED' } },
    };

    const [rows, total] = await Promise.all([
      this.prisma.orderItem.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          partnerOrder: {
            include: {
              order: { select: { id: true, code: true, status: true } },
            },
          },
          productVariant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  images: { where: { isPrimary: true }, take: 1, select: { url: true } },
                },
              },
            },
          },
          returnRequests: {
            where: { status: { in: ACTIVE_RETURN_STATUSES } },
            select: { quantity: true },
          },
        },
      }),
      this.prisma.orderItem.count({ where }),
    ]);

    /**
     * Rows are filtered AFTER the join, because "still returnable" depends on a
     * sum the database cannot express as a simple `where`. The page is therefore
     * taken over the delivered lines and the visible page can be shorter than
     * `limit` — `meta.total` counts delivered lines, which is what the picker
     * paginates over.
     */
    const data = rows
      .map((row) => {
        const claimed = row.returnRequests.reduce((sum, r) => sum + Number(r.quantity), 0);
        const returnable = Number(row.quantity) - claimed;
        return { row, returnable };
      })
      .filter((entry) => entry.returnable > 0)
      .map((entry) => toEligibleReturnItem(entry.row, entry.returnable));

    return paginate(data, total, page, limit);
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: ReturnRequestStatus;
  }): Promise<PaginatedResult<ReturnRequest>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReturnRequestWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          order: { select: { id: true, code: true } },
          refund: true,
          /** ADMIN moderation list: the photos are the evidence for the decision. */
          evidence: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, width: true, height: true, mimeType: true },
          },
        },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Own return requests. `customerId` is part of the WHERE clause, so another
   * customer's request can never appear here and `meta.total` stays exact.
   */
  async findForCustomer(
    customerId: number,
    query: { page?: number; limit?: number; status?: ReturnRequestStatus },
  ): Promise<PaginatedResult<ReturnRequest>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReturnRequestWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { order: { select: { id: true, code: true } }, refund: true },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /** Own return request detail; ownership is enforced in the query (404 otherwise). */
  async findOneForCustomer(id: number, customerId: number): Promise<ReturnRequest> {
    const request = await this.prisma.returnRequest.findFirst({
      where: { id, customerId },
      include: {
        order: { select: { id: true, code: true } },
        refund: true,
        evidence: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, width: true, height: true, mimeType: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Return request not found');
    return request;
  }

  async findOne(id: number): Promise<ReturnRequest> {
    const request = await this.prisma.returnRequest.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, code: true } },
        orderItem: {
          select: {
            id: true,
            quantity: true,
            unitPriceSnapshot: true,
            productNameSnapshot: true,
            partnerOrderId: true,
            partnerOrder: { select: { id: true, code: true, partnerId: true } },
          },
        },
        refund: {
          select: {
            id: true,
            status: true,
            amount: true,
            reference: true,
            completedAt: true,
            payment: { select: { id: true, orderId: true, status: true } },
          },
        },
        quarantineCases: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            code: true,
            quantity: true,
            status: true,
            stockAddedToBalance: true,
          },
        },
        /** ADMIN view: the photos are the evidence for approving the return. */
        evidence: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, width: true, height: true, mimeType: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Return request not found');
    return request;
  }

  /**
   * Refunds an operator may attach to this return.
   *
   * The Admin UI used to ask for a raw `refundId`, which meant the operator had
   * to remember an internal id and could type any number. This endpoint is the
   * server-side definition of "eligible": COMPLETED refunds of the SAME order,
   * not already closing another return, and no larger than the returned goods
   * are worth (`quantity × unitPriceSnapshot`). The UI only has to render the
   * list; `PATCH /returns/:id` re-checks every rule before linking.
   */
  async getEligibleRefunds(id: number) {
    const request = await this.prisma.returnRequest.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        quantity: true,
        refundId: true,
        orderItem: { select: { unitPriceSnapshot: true } },
      },
    });
    if (!request) throw new NotFoundException('Return request not found');

    const returnValue = round2(
      Number(request.quantity) * Number(request.orderItem.unitPriceSnapshot),
    );

    const refunds = await this.prisma.refund.findMany({
      where: {
        payment: { orderId: request.orderId },
        status: RefundStatus.COMPLETED,
        amount: { lte: returnValue },
        OR: [{ returnRequest: { is: null } }, { returnRequest: { id: request.id } }],
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        paymentId: true,
        amount: true,
        reference: true,
        completedAt: true,
        payment: { select: { method: true, status: true } },
        returnRequest: { select: { id: true } },
      },
    });

    return {
      returnRequestId: request.id,
      returnValue: returnValue.toString(),
      data: refunds.map((refund) => ({
        ...refund,
        linkedToThisReturn: refund.returnRequest?.id === request.id,
      })),
    };
  }

  /**
   * Advance a return through its explicit state machine.
   *
   * The return row is locked first, so two operators cannot both run the
   * RECEIVED receipt (which would add the goods to stock twice). Every
   * transition is checked against the map; the request itself is re-read under
   * the lock, never trusted from the caller.
   *
   * RETURNING -> RECEIVED is the physical receipt: the units go back to
   * `onHand` and `blocked`, the lot's remaining quantity grows, and one
   * quarantine case per allocation is opened. QC_PENDING -> REFUNDED requires a
   * COMPLETED refund that belongs to the same order/payment and every
   * quarantine case already RESOLVED.
   */
  async updateStatus(id: number, dto: UpdateReturnRequestDto, actorUserId: number) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number; status: ReturnRequestStatus }[]>`
        SELECT id, status FROM return_requests WHERE id = ${id} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Return request not found');
      const current = await tx.returnRequest.findUniqueOrThrow({
        where: { id },
        include: {
          order: { select: { id: true, code: true } },
          orderItem: {
            select: { id: true, quantity: true, unitPriceSnapshot: true, partnerOrderId: true },
          },
          refund: { include: { payment: { select: { id: true, orderId: true, status: true } } } },
          quarantineCases: { select: { id: true, status: true } },
        },
      });

      if (current.status === dto.status) {
        // Idempotent replay: no second receipt, no second audit row.
        return current;
      }
      const allowed = RETURN_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot change return status from ${current.status} to ${dto.status}`,
        );
      }

      const data: Prisma.ReturnRequestUpdateInput = { status: dto.status };

      if (dto.status === ReturnRequestStatus.RECEIVED) {
        await this.receiveReturnedGoods(tx, current, actorUserId);
        data.receivedAt = new Date();
      }

      if (dto.status === ReturnRequestStatus.REFUNDED) {
        const refundId = dto.refundId ?? current.refundId;
        if (!refundId) {
          throw new BadRequestException('A refundId is required to mark a return as REFUNDED');
        }
        if (current.refundId && current.refundId !== refundId) {
          throw new BadRequestException('This return is already linked to another refund');
        }
        const refund = await tx.refund.findUnique({
          where: { id: refundId },
          include: { payment: { select: { id: true, orderId: true, status: true } } },
        });
        if (!refund) throw new NotFoundException('Refund not found');
        if (refund.status !== RefundStatus.COMPLETED) {
          throw new BadRequestException('The refund must be COMPLETED before the return is REFUNDED');
        }
        if (refund.payment.orderId !== current.orderId) {
          throw new BadRequestException('The refund belongs to a different order');
        }
        // One refund closes at most one return. The unique index is the final
        // guard, but a clear 400 here is better than a raw constraint error.
        const linkedElsewhere = await tx.returnRequest.findFirst({
          where: { refundId, id: { not: id } },
          select: { id: true },
        });
        if (linkedElsewhere) {
          throw new BadRequestException('This refund is already linked to another return request');
        }
        // Money must not exceed the value of the goods that actually came back.
        const returnedValue = round2(
          Number(current.quantity) * Number(current.orderItem.unitPriceSnapshot),
        );
        if (Number(refund.amount) > returnedValue) {
          throw new BadRequestException(
            `The refund (${Number(refund.amount)}) exceeds the value of the returned goods (${returnedValue})`,
          );
        }
        if (current.quarantineCases.length === 0) {
          throw new BadRequestException(
            'The return has no quarantine cases; record the received goods before refunding',
          );
        }
        const unresolved = current.quarantineCases.filter(
          (c) =>
            c.status !== QuarantineCaseStatus.RELEASED &&
            c.status !== QuarantineCaseStatus.SCRAPPED,
        );
        if (unresolved.length > 0) {
          throw new BadRequestException(
            'All quarantine cases for this return must be RELEASED or SCRAPPED before refunding',
          );
        }
        data.refund = { connect: { id: refundId } };
      }

      const updated = await tx.returnRequest.update({ where: { id }, data });
      await this.audit.record(
        {
          actorUserId,
          action: `RETURN_${dto.status}`,
          entityType: 'ReturnRequest',
          entityId: String(id),
          beforeJson: { status: current.status },
          afterJson: { status: updated.status, refundId: updated.refundId },
        },
        tx,
      );
      return tx.returnRequest.findUniqueOrThrow({
        where: { id },
        include: {
          order: { select: { id: true, code: true } },
          refund: true,
          quarantineCases: { orderBy: { id: 'asc' } },
        },
      });
    });
  }

  /**
   * Physical receipt of a post-delivery return.
   *
   * Allocations are consumed in their original order; returns already
   * RECEIVED/QC_PENDING/REFUNDED for the same line are skipped first, so a
   * partial return followed by another partial return cannot put the same units
   * back twice. Each allocation portion adds `onHand` and `blocked` together,
   * increments the lot remaining quantity, writes a RETURN movement and opens a
   * PENDING quarantine case (`stockAddedToBalance = true`).
   */
  private async receiveReturnedGoods(
    tx: Prisma.TransactionClient,
    request: {
      id: number;
      orderId: number;
      orderItemId: number;
      quantity: Prisma.Decimal | number | string;
    },
    actorUserId: number,
  ): Promise<void> {
    if (!this.inventory || !this.quarantine) {
      throw new ConflictException('Inventory/quarantine services are not configured');
    }
    // Serialise receipts for the same order item. The allocation offset below
    // is derived from earlier RECEIVED/QC_PENDING/REFUNDED requests; without
    // this lock two different returns received at the same time both read the
    // pre-receipt sum and map their units onto the same allocation, corrupting
    // lot traceability. The create path already locks this row with the same
    // `FOR UPDATE` claim.
    const lockedItem = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM order_items WHERE id = ${request.orderItemId} FOR UPDATE
    `;
    if (lockedItem.length === 0) {
      throw new ConflictException('The order item no longer exists');
    }
    const allocations = await tx.inventoryAllocation.findMany({
      where: { orderItemId: request.orderItemId },
      include: { inventoryBalance: true },
      orderBy: { id: 'asc' },
    });
    if (allocations.length === 0) {
      throw new ConflictException('No inventory allocation exists for the returned item');
    }

    // Units from earlier, already-received returns of the same line occupy the
    // first allocations; this receipt starts after them.
    const prior = await tx.returnRequest.aggregate({
      where: {
        orderItemId: request.orderItemId,
        id: { not: request.id },
        status: {
          in: [
            ReturnRequestStatus.RECEIVED,
            ReturnRequestStatus.QC_PENDING,
            ReturnRequestStatus.REFUNDED,
          ],
        },
      },
      _sum: { quantity: true },
    });
    let offset = Number(prior._sum.quantity ?? 0);
    let remaining = Number(request.quantity);

    const warehouseIds = [...new Set(allocations.map((a) => a.inventoryBalance.warehouseId))].sort(
      (a, b) => a - b,
    );
    for (const warehouseId of warehouseIds) {
      await InventoryService.lockWarehouse(tx, warehouseId);
    }

    for (const alloc of allocations) {
      if (remaining <= 0) break;
      const allocationQuantity = Number(alloc.quantity);
      if (offset >= allocationQuantity) {
        offset -= allocationQuantity;
        continue;
      }
      const availableInAllocation = allocationQuantity - offset;
      const take = Math.min(remaining, availableInAllocation);
      const balance = alloc.inventoryBalance;

      const received = await this.inventory.receiveReturnedStock(tx, balance.id, take);
      await tx.$executeRaw`
        UPDATE product_lots
           SET remaining_quantity = remaining_quantity + ${take},
               updated_at = UTC_TIMESTAMP(3)
         WHERE id = ${alloc.productLotId}
      `;
      await this.inventory.recordMovement(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        type: InventoryMovementType.RETURN,
        quantityDelta: take,
        beforeQuantity: received.before,
        afterQuantity: received.after,
        referenceType: 'ReturnRequest',
        referenceId: request.id,
        note: 'Nhận hàng hoàn — chờ kiểm định',
        actorUserId,
      });
      const quarantineCase = await this.quarantine.createCase(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        quantity: take,
        sourceType: QUARANTINE_SOURCES.customerReturn,
        sourceId: request.id,
        orderId: request.orderId,
        returnRequestId: request.id,
        reason: 'Hàng hoàn sau giao — chờ kiểm định',
        stockAddedToBalance: true,
        createdByUserId: actorUserId,
      });
      await tx.traceEvent.create({
        data: {
          productLotId: balance.productLotId,
          type: TraceEventType.RETURNED,
          occurredAt: new Date(),
          description: `Đã nhận hàng hoàn — chờ kiểm định (${quarantineCase.code})`,
          isPublic: true,
        },
      });

      remaining -= take;
      offset = 0;
    }

    if (remaining > 0) {
      throw new ConflictException(
        'The returned quantity exceeds what was allocated to this order item',
      );
    }
  }
}

/**
 * Joined row shape used by `listEligibleItems`.
 *
 * Written as a `GetPayload` so the mapper stays in step with the `include`
 * above: adding a field to the query without updating this type is a compile
 * error rather than a silently missing column.
 */
type EligibleReturnRow = Prisma.OrderItemGetPayload<{
  include: {
    partnerOrder: { include: { order: { select: { id: true; code: true; status: true } } } };
    productVariant: {
      include: {
        product: {
          select: { id: true; name: true; images: { select: { url: true } } };
        };
      };
    };
    returnRequests: { select: { quantity: true } };
  };
}>;

/** Maps a joined order item plus its computed returnable quantity. */
export function toEligibleReturnItem(
  row: EligibleReturnRow,
  returnableQuantity: number,
): EligibleReturnItem {
  return {
    orderItemId: row.id,
    orderId: row.partnerOrder.order.id,
    orderCode: row.partnerOrder.order.code,
    productId: row.productVariant.product.id,
    productName: row.productVariant.product.name,
    variantName: row.productVariant.name,
    sku: row.productVariant.sku,
    purchasedQuantity: row.quantity.toString(),
    returnableQuantity: String(returnableQuantity),
    unitPrice: row.unitPriceSnapshot.toString(),
    imageUrl: row.productVariant.product.images[0]?.url ?? null,
  };
}
