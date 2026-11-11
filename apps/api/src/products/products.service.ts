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
import { PartnerVerificationStatus, RecordStatus } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';
// Public catalogue and public Farm reads share one partner eligibility rule: a
// partner sells something to the storefront only while it is ACTIVE and
// VERIFIED. Reusing the single constant keeps the two gates from drifting.
import { publicPartnerVisibility } from '../farms/farm-visibility.js';

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
    const slug =
      dto.slug?.trim() ||
      (await uniqueSlug(dto.name, (s) => this.slugTaken(s)));
    const data = {
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
    };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Match farm transfer's lock order: Farm -> Partner -> Product.
          // Drafts also retain the Farm lock when linked to a Farm, but do not
          // require an eligible Partner until they are published.
          if (dto.farmId !== undefined && dto.farmId !== null) {
            await tx.$queryRaw<Array<{ id: number }>>`
              SELECT id FROM farms WHERE id = ${dto.farmId} FOR UPDATE
            `;
          }
          await this.assertFarmBelongsToPartner(dto.farmId, dto.partnerId, tx);
          if (dto.status !== RecordStatus.INACTIVE) {
            await this.assertPartnerCanSell(dto.partnerId, tx);
          }
          return tx.product.create({ data, include: productInclude });
        },
        { isolationLevel: 'ReadCommitted' },
      );
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
   *
   * Public visibility (guest + CUSTOMER, C-11) needs BOTH gates: the product is
   * ACTIVE and its partner is ACTIVE + VERIFIED. Partner PENDING / REJECTED /
   * INACTIVE hides every product of that partner, the `status` query parameter
   * is ignored for non-ADMIN callers (it can never widen the set), and
   * `findMany` and `count` share the identical `where` so pagination totals
   * never mention hidden rows. ADMIN keeps the unfiltered management view.
   */
  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: RecordStatus;
      categoryId?: number;
      partnerId?: number;
    },
    viewer?: AuthenticatedUser,
  ): Promise<PaginatedResult<Product & { variants: PricedVariant[] }>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const isAdmin = viewer?.role === 'ADMIN';
    const where: Prisma.ProductWhereInput = {
      // ADMIN keeps the status filter; anonymous/customer callers are pinned to
      // the public set: ACTIVE product sold by an ACTIVE, VERIFIED partner.
      ...(isAdmin
        ? query.status
          ? { status: query.status }
          : {}
        : {
            status: RecordStatus.ACTIVE,
            partner: publicPartnerVisibility,
          }),
      // partnerId/categoryId/search only ever narrow the (already gated) set.
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

  /**
   * Product detail with priced variants.
   *
   * Public reads (guest + CUSTOMER) resolve the product under the same gate as
   * the list: an INACTIVE product or a product whose partner is PENDING /
   * REJECTED / INACTIVE is indistinguishable from a missing one — whether the
   * caller reaches it by ID or by slug — so both return 404. ADMIN (whose token
   * the controller recognises) still opens any product, by ID, for editing.
   */
  async findOne(id: number, viewer?: AuthenticatedUser) {
    const product =
      viewer?.role === 'ADMIN'
        ? await this.prisma.product.findUnique({
            where: { id },
            include: productInclude,
          })
        : await this.prisma.product.findFirst({
            where: {
              id,
              status: RecordStatus.ACTIVE,
              partner: publicPartnerVisibility,
            },
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
      if (dto.status === RecordStatus.ACTIVE || dto.farmId !== undefined) {
        return await this.prisma.$transaction(
          async (tx) => {
            // Farm must be locked before Partner to match transferPartner().
            if (typeof dto.farmId === 'number') {
              await tx.$queryRaw<Array<{ id: number }>>`
                SELECT id FROM farms WHERE id = ${dto.farmId} FOR UPDATE
              `;
            }
            if (dto.farmId !== undefined) {
              await this.assertFarmBelongsToPartner(dto.farmId, existing.partnerId, tx);
            }
            if (dto.status === RecordStatus.ACTIVE) {
              await this.assertPartnerCanSell(existing.partnerId, tx);
            }
            return tx.product.update({ where: { id }, data, include: productInclude });
          },
          { isolationLevel: 'ReadCommitted' },
        );
      }
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
    db: Pick<Prisma.TransactionClient, 'farm'> = this.prisma,
  ): Promise<void> {
    if (farmId === undefined || farmId === null) return;
    const farm = await db.farm.findUnique({
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

  /**
   * Serialize every Product publication with Partner status/verification
   * changes. Call only inside the Product transaction, after any Farm lock.
   */
  private async assertPartnerCanSell(
    partnerId: number,
    tx: Pick<Prisma.TransactionClient, '$queryRaw' | 'partner'>,
  ): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM partners WHERE id = ${partnerId} FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundException('Partner not found');

    const partner = await tx.partner.findUnique({
      where: { id: partnerId },
      select: { status: true, verificationStatus: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    if (
      partner.status !== RecordStatus.ACTIVE ||
      partner.verificationStatus !== PartnerVerificationStatus.VERIFIED
    ) {
      throw new BadRequestException('Đối tác phải được xác minh và đang hoạt động để kinh doanh sản phẩm.');
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
