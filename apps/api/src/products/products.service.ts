import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PromotionsService, type PriceBreakdown } from '../promotions/promotions.service.js';
import { slugify, uniqueSlug } from '../common/utils/slug.util.js';
import { isUniqueViolationOn } from '../common/utils/code.util.js';
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
  UpdateVariantDto,
} from './dto/product.dto.js';
import type { Prisma, Product, ProductVariant } from '../../generated/prisma/client.js';
import type { RecordStatus } from '../../generated/prisma/enums.js';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  partner: { select: { id: true, code: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: true,
};

/** A variant enriched with the server-side price and live availability. */
export interface PricedVariant extends ProductVariant {
  effectivePrice: PriceBreakdown;
  availableQuantity: number;
  inStock: boolean;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a product. When no slug is sent, one is generated from the name and
   * made unique (`ca-chua-bi-do`, `ca-chua-bi-do-2`, …). A colliding explicit
   * slug is a 409 with a business message instead of a Prisma error dump.
   */
  async create(dto: CreateProductDto) {
    await this.assertFarmBelongsToPartner(dto.farmId, dto.partnerId);
    const slug =
      dto.slug?.trim() ||
      (await uniqueSlug(dto.name, (s) => this.slugTaken(s)));
    try {
      return await this.prisma.product.create({
        data: {
          partnerId: dto.partnerId,
          categoryId: dto.categoryId,
          farmId: dto.farmId,
          name: dto.name,
          slug,
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
    } catch (error) {
      if (isUniqueViolationOn(error, 'slug')) {
        throw new ConflictException('Đường dẫn sản phẩm đã tồn tại. Hãy chọn tên hoặc đường dẫn khác.');
      }
      throw error;
    }
  }

  /**
   * Product list.
   *
   * Each variant carries the backend-resolved `effectivePrice` (flash sale >
   * product discount > base) and its sellable `availableQuantity`, so the
   * storefront never has to re-implement the pricing rules or guess stock. This
   * is a public response: only sellable stock is counted, and no warehouse,
   * lot or cost data is included.
   */
  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: RecordStatus;
    categoryId?: number;
    partnerId?: number;
  }): Promise<PaginatedResult<Product & { variants: PricedVariant[] }>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
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

    const variantIds = data.flatMap((product) => product.variants.map((variant) => variant.id));
    const [prices, availability] = await Promise.all([
      this.promotions.resolvePrices(variantIds),
      this.inventory.sellableQuantities(variantIds),
    ]);

    return paginate(
      data.map((product) => this.withPricing(product, prices, availability)),
      total,
      page,
      limit,
    );
  }

  /** Product detail with priced variants. */
  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');

    const variantIds = product.variants.map((variant) => variant.id);
    const [prices, availability] = await Promise.all([
      this.promotions.resolvePrices(variantIds),
      this.inventory.sellableQuantities(variantIds),
    ]);
    return this.withPricing(product, prices, availability);
  }

  private withPricing(
    product: Product & { variants: ProductVariant[] },
    prices: Map<number, PriceBreakdown>,
    availability: Map<number, number>,
  ): Product & { variants: PricedVariant[] } {
    return {
      ...product,
      variants: product.variants.map((variant) => {
        const availableQuantity = availability.get(variant.id) ?? 0;
        // A deactivated variant is never sellable, whatever the warehouse
        // holds; the checkout rejects it outright (see resolveLines).
        // `availableQuantity` stays truthful (real stock) — only the
        // sellable flag is gated, so stock figures never lie.
        const sellable = variant.status === 'ACTIVE' && availableQuantity > 0;
        return {
          ...variant,
          effectivePrice:
            prices.get(variant.id) ??
            {
              basePrice: Number(variant.basePrice),
              unitPrice: Number(variant.basePrice),
              discountAmount: 0,
              source: 'NONE' as const,
            },
          availableQuantity,
          inStock: sellable,
        };
      }),
    };
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    const existing = await this.requireProduct(id);
    if (dto.farmId !== undefined) {
      await this.assertFarmBelongsToPartner(dto.farmId, existing.partnerId);
    }
    // The slug is the product's stable path: renames never rewrite it unless
    // the caller explicitly sends a new one. Normalise it the same way.
    const data = { ...dto };
    if (data.slug !== undefined) {
      const clean = slugify(data.slug);
      if (!clean) throw new ConflictException('Đường dẫn sản phẩm không hợp lệ.');
      const taken = await this.prisma.product.findUnique({ where: { slug: clean } });
      if (taken && taken.id !== id) {
        throw new ConflictException('Đường dẫn sản phẩm đã tồn tại. Hãy chọn đường dẫn khác.');
      }
      data.slug = clean;
    }
    try {
      return await this.prisma.product.update({ where: { id }, data, include: productInclude });
    } catch (error) {
      if (isUniqueViolationOn(error, 'slug')) {
        throw new ConflictException('Đường dẫn sản phẩm đã tồn tại. Hãy chọn đường dẫn khác.');
      }
      throw error;
    }
  }

  async addVariant(productId: number, dto: CreateVariantDto) {
    await this.requireProduct(productId);
    return this.prisma.productVariant.create({ data: { ...dto, productId } });
  }

  /**
   * Update a sale variant's display name, price for new orders, or sale
   * status. The SKU and unit fields are deliberately not updatable (see
   * `UpdateVariantDto`); past orders keep their price snapshots and stock
   * keeps its unit.
   */
  async updateVariant(id: number, dto: UpdateVariantDto, actorUserId: number) {
    const before = await this.prisma.productVariant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Product variant not found');
    const updated = await this.prisma.productVariant.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      actorUserId,
      action: 'UPDATE_VARIANT',
      entityType: 'ProductVariant',
      entityId: String(id),
      beforeJson: before,
      afterJson: updated,
    });
    return updated;
  }

  private async requireProduct(id: number): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /**
   * The optional marketing farm must belong to the product's selling partner.
   * Cross-partner attribution would make a product advertise a farm its seller
   * does not operate, so an explicit mismatch is a 400 instead of a silent
   * accept. A `null`/absent farm is always allowed.
   */
  private async assertFarmBelongsToPartner(
    farmId: number | undefined,
    partnerId: number,
  ): Promise<void> {
    if (farmId === undefined || farmId === null) return;
    const farm = await this.prisma.farm.findUnique({
      where: { id: farmId },
      select: { partnerId: true },
    });
    if (!farm) {
      throw new BadRequestException('Trang trại không tồn tại.');
    }
    if (farm.partnerId !== partnerId) {
      throw new BadRequestException('Trang trại không thuộc đơn vị bán hàng đã chọn.');
    }
  }

  private async slugTaken(slug: string): Promise<boolean> {
    const found = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    return found !== null;
  }
}
