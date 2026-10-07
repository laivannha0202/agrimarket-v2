import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import {
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import type { Prisma, Product } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  partner: { select: { id: true, code: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: true,
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        partnerId: dto.partnerId,
        categoryId: dto.categoryId,
        farmId: dto.farmId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        status: dto.status,
        images: dto.images
          ? { create: dto.images.map((i) => ({ ...i })) }
          : undefined,
        variants: dto.variants
          ? { create: dto.variants.map((v) => ({ ...v })) }
          : undefined,
      },
      include: productInclude,
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    categoryId?: number;
    partnerId?: number;
  }): Promise<PaginatedResult<Product>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status as RecordStatus } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { slug: { contains: search } },
              { variants: { some: { sku: { contains: search } } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    await this.findOne(id);
    return this.prisma.product.update({ where: { id }, data: dto, include: productInclude });
  }

  async addVariant(productId: number, dto: CreateVariantDto) {
    await this.findOne(productId);
    return this.prisma.productVariant.create({ data: { ...dto, productId } });
  }
}
