import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { slugify, uniqueSlug } from '../common/utils/slug.util.js';
import { isUniqueViolationOn } from '../common/utils/code.util.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import type { Category, Prisma } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a category. When no slug is sent, one is generated from the name and
   * made unique (`rau-an-la`, `rau-an-la-2`, …); a colliding explicit slug is a
   * 409 with a business message instead of a Prisma error dump.
   */
  async create(dto: CreateCategoryDto): Promise<Category> {
    const slug =
      dto.slug?.trim() || (await uniqueSlug(dto.name, (s) => this.slugTaken(s)));
    try {
      return await this.prisma.category.create({
        data: { name: dto.name, slug, status: dto.status },
      });
    } catch (error) {
      if (isUniqueViolationOn(error, 'slug')) {
        throw new ConflictException('Đường dẫn danh mục đã tồn tại. Hãy chọn tên khác.');
      }
      throw error;
    }
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: RecordStatus;
  }): Promise<PaginatedResult<Category>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.CategoryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [{ name: { contains: search } }, { slug: { contains: search } }],
          }
        : {}),
    };
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

  /**
   * Update a category. The slug is the category's stable path: a rename never
   * rewrites it unless the caller explicitly sends a new one, so existing links
   * keep resolving. A colliding explicit slug is a 409.
   */
  async update(id: number, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(id);
    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.slug !== undefined) {
      const clean = slugify(dto.slug);
      if (!clean) throw new ConflictException('Đường dẫn danh mục không hợp lệ.');
      const taken = await this.prisma.category.findUnique({ where: { slug: clean } });
      if (taken && taken.id !== id) {
        throw new ConflictException('Đường dẫn danh mục đã tồn tại. Hãy chọn đường dẫn khác.');
      }
      data.slug = clean;
    }
    try {
      return await this.prisma.category.update({ where: { id }, data });
    } catch (error) {
      if (isUniqueViolationOn(error, 'slug')) {
        throw new ConflictException('Đường dẫn danh mục đã tồn tại. Hãy chọn đường dẫn khác.');
      }
      throw error;
    }
  }

  private async slugTaken(slug: string): Promise<boolean> {
    const found = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    return found !== null;
  }
}
