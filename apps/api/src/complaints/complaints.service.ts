import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateComplaintDto, UpdateComplaintDto } from './dto/complaint.dto.js';
import type { Complaint, Prisma } from '../../generated/prisma/client.js';
import { ComplaintStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(customerId: number, dto: CreateComplaintDto): Promise<Complaint> {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new BadRequestException('You can only complain about your own orders');
    }
    return this.prisma.complaint.create({
      data: {
        customerId,
        orderId: dto.orderId,
        orderItemId: dto.orderItemId,
        type: dto.type,
        content: dto.content,
        status: ComplaintStatus.OPEN,
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResult<Complaint>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ComplaintWhereInput = query.status
      ? { status: query.status as ComplaintStatus }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          order: { select: { id: true, code: true } },
          customer: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findUnique({ where: { id } });
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
