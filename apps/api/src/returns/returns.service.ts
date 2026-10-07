import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateReturnRequestDto, UpdateReturnRequestDto } from './dto/return.dto.js';
import type { Prisma, ReturnRequest } from '../../generated/prisma/client.js';
import { ReturnRequestStatus } from '../../generated/prisma/enums.js';

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
    if (dto.quantity > Number(orderItem.quantity)) {
      throw new BadRequestException('Return quantity cannot exceed the purchased quantity');
    }

    return this.prisma.returnRequest.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem.id,
        customerId,
        quantity: dto.quantity,
        reason: dto.reason,
        status: ReturnRequestStatus.REQUESTED,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResult<ReturnRequest>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ReturnRequestWhereInput = query.status
      ? { status: query.status as ReturnRequestStatus }
      : {};
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

  async findOne(id: number): Promise<ReturnRequest> {
    const request = await this.prisma.returnRequest.findUnique({ where: { id } });
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
