import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateReviewDto, UpdateReviewStatusDto } from './dto/review.dto.js';
import type { Prisma, Review } from '../../generated/prisma/client.js';
import { ReviewStatus } from '../../generated/prisma/enums.js';

/**
 * One row of `GET /reviews/eligible-items`.
 *
 * Deliberately flat and display-oriented: the mobile picker needs a readable
 * order code, a product name, a specification line and a thumbnail. The
 * internal ids travel because the create call needs them, but they are never
 * asked of the customer.
 */
export interface EligibleReviewItem {
  orderItemId: number;
  orderId: number;
  orderCode: string;
  deliveredAt: string;
  productId: number;
  productName: string;
  variantName: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  imageUrl: string | null;
}

type EligibleRow = Prisma.OrderItemGetPayload<{
  include: {
    partnerOrder: {
      include: {
        order: { select: { id: true; code: true; createdAt: true; status: true } };
        partner: { select: { id: true; name: true } };
      };
    };
    productVariant: {
      include: {
        product: {
          select: {
            id: true;
            name: true;
            slug: true;
            images: { select: { url: true } };
          };
        };
      };
    };
  };
}>;

/** Maps a joined order item to the flat shape the picker consumes. */
export function toEligibleItem(row: EligibleRow): EligibleReviewItem {
  const order = row.partnerOrder.order;
  return {
    orderItemId: row.id,
    orderId: order.id,
    orderCode: order.code,
    // The order row has no separate `deliveredAt` column, so the order's own
    // creation time is what travels. It labels the picker only — no eligibility
    // rule is derived from it, so it cannot become a wrong claim about when the
    // parcel arrived.
    deliveredAt: order.createdAt.toISOString(),
    productId: row.productVariant.product.id,
    productName: row.productVariant.product.name,
    variantName: row.productVariant.name,
    sku: row.productVariant.sku,
    quantity: row.quantity.toString(),
    unitPrice: row.unitPriceSnapshot.toString(),
    imageUrl: row.productVariant.product.images[0]?.url ?? null,
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
  ) {}

  /**
   * Only a customer who actually bought the item can review it. The order item
   * must belong to the customer and the order must be delivered.
   */
  async create(customerId: number, dto: CreateReviewDto): Promise<Review> {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: dto.orderItemId },
      include: { partnerOrder: { include: { order: true } }, productVariant: true },
    });
    if (!orderItem) throw new NotFoundException('Order item not found');
    if (orderItem.partnerOrder.order.customerId !== customerId) {
      throw new BadRequestException('You can only review items you purchased');
    }
    if (orderItem.partnerOrder.order.status !== 'DELIVERED') {
      throw new BadRequestException('You can only review delivered orders');
    }

    const existing = await this.prisma.review.findUnique({ where: { orderItemId: dto.orderItemId } });
    if (existing) throw new BadRequestException('This item has already been reviewed');

    /**
     * The review and its photos are created in one transaction.
     *
     * `evidence.bind` refuses any id that is not an unbound upload belonging to
     * this customer, so a forged id cannot attach someone else's photo and
     * cannot steal an image already used on another request. If the bind fails,
     * the review is rolled back too — a review is never left behind claiming
     * photos it does not have.
     */
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          customerId,
          orderItemId: dto.orderItemId,
          productId: orderItem.productVariant.productId,
          rating: dto.rating,
          content: dto.content,
          status: ReviewStatus.APPROVED,
        },
      });
      await this.evidence.bind(tx, customerId, dto.evidenceIds, { reviewId: review.id });
      return review;
    });
  }

  async listForProduct(productId: number, query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReviewWhereInput = { productId, status: ReviewStatus.APPROVED };
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          customer: { select: { fullName: true } },
          /**
           * Only APPROVED reviews reach this query (see `where`), so any image
           * attached to them is already public. Selecting ids and dimensions —
           * never `storageKey` — keeps the file's location out of a public
           * payload; the client renders `/evidence/:id/file`.
           */
          evidence: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, width: true, height: true, mimeType: true },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Own review history. The customer sees their reviews regardless of status
   * (an admin hiding a review is not the same as the customer never writing it),
   * and `orderItemId` lets the UI mark items as already reviewed without
   * guessing from the public product feed.
   */
  async listForCustomer(customerId: number, query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReviewWhereInput = { customerId };
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          product: { select: { id: true, name: true, slug: true } },
          /**
           * The customer's OWN reviews, so their own images are included
           * regardless of moderation status — hiding a review from the
           * storefront is not the same as hiding it from its author, who must
           * be able to see what they submitted and whether it was approved.
           */
          evidence: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, width: true, height: true, mimeType: true },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Items the customer is allowed to review right now, for the "choose a
   * product" step.
   *
   * Eligibility is decided HERE, not on the client: an item qualifies when the
   * order is DELIVERED, the item belongs to the customer, and no review exists
   * for it yet. The client cannot widen that set — `POST /reviews` re-checks all
   * three conditions, so a stale list can only produce a clean business error,
   * never a duplicate review.
   *
   * Paginated like every other list in the API: the customer's history can be
   * long, and "load the first 100 orders and hope" would silently hide items.
   */
  async listEligibleItems(
    customerId: number,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.OrderItemWhereInput = {
      partnerOrder: {
        order: { customerId, status: 'DELIVERED' },
      },
      reviews: { none: { customerId } },
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
              order: { select: { id: true, code: true, createdAt: true, status: true } },
              partner: { select: { id: true, name: true } },
            },
          },
          productVariant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  images: {
                    where: { isPrimary: true },
                    take: 1,
                    select: { url: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.orderItem.count({ where }),
    ]);

    return paginate(rows.map(toEligibleItem), total, page, limit);
  }

  async findAll(query: { page?: number; limit?: number; status?: ReviewStatus }): Promise<PaginatedResult<Review>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReviewWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        // The admin list shows the reviewer next to each review; without this
        // the "Khách hàng" column renders "—" for every row.
        include: {
          product: { select: { id: true, name: true } },
          customer: { select: { id: true, fullName: true } },
          /**
           * The moderation queue. A reviewer deciding whether to APPROVE or HIDE
           * a review has to see the photos it carries — they are often the
           * reason a review is being moderated at all.
           */
          evidence: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, width: true, height: true, mimeType: true },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async updateStatus(id: number, dto: UpdateReviewStatusDto): Promise<Review> {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    return this.prisma.review.update({ where: { id }, data: { status: dto.status } });
  }
}
