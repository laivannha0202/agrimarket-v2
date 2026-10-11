import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateComplaintDto, UpdateComplaintDto } from './dto/complaint.dto.js';
import type { Complaint, Prisma } from '../../generated/prisma/client.js';
import { ComplaintStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
  ) {}

  async create(customerId: number, dto: CreateComplaintDto): Promise<Complaint> {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new BadRequestException('You can only complain about your own orders');
    }

    /**
     * A complaint may name one line of the order. That line is verified to
     * belong to THIS order before it is stored.
     *
     * Without this check, `orderItemId` was taken on trust: a customer could
     * attach an item id from a different order — including an order belonging
     * to somebody else — and the complaint would record a product the customer
     * never bought from an order they do not own. The FK only proves the id
     * exists; it cannot prove the two belong together, so the check is explicit.
     */
    if (dto.orderItemId !== undefined) {
      const item = await this.prisma.orderItem.findFirst({
        where: { id: dto.orderItemId, partnerOrder: { orderId: order.id } },
        select: { id: true },
      });
      if (!item) {
        throw new BadRequestException('Sản phẩm khiếu nại không thuộc đơn hàng này.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.create({
        data: {
          customerId,
          orderId: dto.orderId,
          orderItemId: dto.orderItemId,
          type: dto.type,
          content: dto.content,
          status: ComplaintStatus.OPEN,
        },
      });
      await this.evidence.bind(tx, customerId, dto.evidenceIds, { complaintId: complaint.id });
      return complaint;
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: ComplaintStatus;
  }): Promise<PaginatedResult<Complaint>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ComplaintWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          order: { select: { id: true, code: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          /**
           * ADMIN moderation list. The photos are the evidence the moderator
           * decides on, so they belong in the row the decision is made from —
           * requiring a second request to see them would just invite approving
           * without looking.
           */
          evidence: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, width: true, height: true, mimeType: true },
          },
        },
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Own complaints. `customerId` is part of the WHERE clause, so another
   * customer's complaint can never appear here and `meta.total` stays exact.
   */
  async findForCustomer(
    customerId: number,
    query: { page?: number; limit?: number; status?: ComplaintStatus },
  ): Promise<PaginatedResult<Complaint>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ComplaintWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { order: { select: { id: true, code: true } } },
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /** Own complaint detail; ownership is enforced in the query (404 otherwise). */
  async findOneForCustomer(id: number, customerId: number): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id, customerId },
      include: {
        order: { select: { id: true, code: true } },
        evidence: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, width: true, height: true, mimeType: true },
        },
      },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return complaint;
  }

  async findOne(id: number): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      include: {
        /**
         * ADMIN view. The evidence is what the moderator actually has to look
         * at to decide the complaint, so it is part of the detail response —
         * and it is safe here because this route is ADMIN-only.
         */
        evidence: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, width: true, height: true, mimeType: true },
        },
      },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return complaint;
  }

  async update(id: number, dto: UpdateComplaintDto): Promise<Complaint> {
    await this.findOne(id);
    return this.prisma.complaint.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolution,
        resolvedAt:
          dto.status === ComplaintStatus.RESOLVED || dto.status === ComplaintStatus.REJECTED
            ? new Date()
            : null,
      },
    });
  }
}
