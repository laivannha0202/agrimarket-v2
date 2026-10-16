import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateReturnRequestDto, UpdateReturnRequestDto } from './dto/return.dto.js';
import type { Prisma, ReturnRequest } from '../../generated/prisma/client.js';
import { ReturnRequestStatus } from '../../generated/prisma/enums.js';

/**
 * Statuses that still hold a claim on the returned quantity.
 *
 * A customer may return part of a line, then ask for the rest. The quantity
 * already spoken for is therefore every request that has NOT been rejected or
 * refunded: a REJECTED request releases its quantity back to the customer, and
 * a REFUNDED one is finished. Counting the others is what stops the same unit
 * being promised twice.
 */
const ACTIVE_RETURN_STATUSES: ReturnRequestStatus[] = [
  ReturnRequestStatus.REQUESTED,
  ReturnRequestStatus.APPROVED,
  ReturnRequestStatus.RETURNING,
  ReturnRequestStatus.RECEIVED,
  ReturnRequestStatus.QC_PENDING,
];

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
     * the second one fail here, and the check runs inside the same transaction
     * as the insert so two simultaneous requests cannot both see the old sum.
     */
    const created = await this.prisma.$transaction(async (tx) => {
      const active = await tx.returnRequest.findMany({
        where: { orderItemId: orderItem.id, status: { in: ACTIVE_RETURN_STATUSES } },
        select: { quantity: true },
      });
      const alreadyClaimed = active.reduce((sum, r) => sum + Number(r.quantity), 0);
      const returnable = Number(orderItem.quantity) - alreadyClaimed;
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
    });

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

  async updateStatus(id: number, dto: UpdateReturnRequestDto, actorUserId: number) {
    const request = await this.findOne(id);
    if (dto.status === ReturnRequestStatus.REFUNDED && !dto.refundId && !request.refundId) {
      throw new BadRequestException('A refundId is required to mark a return as REFUNDED');
    }
    const updated = await this.prisma.returnRequest.update({
      where: { id },
      data: { status: dto.status, refundId: dto.refundId ?? request.refundId },
    });
    await this.audit.record({
      actorUserId,
      action: `RETURN_${dto.status}`,
      entityType: 'ReturnRequest',
      entityId: String(id),
      beforeJson: { status: request.status },
      afterJson: { status: updated.status },
    });
    return updated;
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
