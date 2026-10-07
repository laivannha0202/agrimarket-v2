import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateReviewDto, UpdateReviewStatusDto } from './dto/review.dto.js';
import type { Prisma, Review } from '../../generated/prisma/client.js';
import { ReviewStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.review.create({
      data: {
        customerId,
        orderItemId: dto.orderItemId,
        productId: orderItem.productVariant.productId,
        rating: dto.rating,
        content: dto.content,
        status: ReviewStatus.APPROVED,
      },
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
        include: { customer: { select: { fullName: true } } },
      }),
      this.prisma.review.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findAll(query: { page?: number; limit?: number; status?: string }): Promise<PaginatedResult<Review>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReviewWhereInput = query.status
      ? { status: query.status as ReviewStatus }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { product: { select: { id: true, name: true } } },
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
