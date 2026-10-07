import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import type { Category, Prisma } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: dto });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResult<Category>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.CategoryWhereInput = query.status
      ? { status: query.status as RecordStatus }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.category.findMany({ where, skip, take, orderBy: { id: 'asc' } }),
      this.prisma.category.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }
}
