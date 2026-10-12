import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  CreateFlashSaleDto,
  CreateProductDiscountDto,
  CreateVoucherDto,
} from './dto/promotion.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { DiscountType, type RecordStatus } from '../../generated/prisma/enums.js';

export interface PriceBreakdown {
  basePrice: number;
  unitPrice: number;
  discountAmount: number;
  source: 'NONE' | 'PRODUCT_DISCOUNT' | 'FLASH_SALE';
}

/**
 * A single-variant price plus the *identity* of the flash-sale item it came
 * from. The id is what lets the checkout consume quota from — and count the
 * per-customer limit against — exactly the program that priced the line, rather
 * than re-deriving it from the price (two sales can share a price).
 */
export interface ResolvedPrice extends PriceBreakdown {
  flashSaleItemId: number | null;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Vouchers -----------------------------------------------------------

  createVoucher(dto: CreateVoucherDto) {
    return this.prisma.voucher.create({
      data: {
        code: dto.code.toUpperCase(),
        name: dto.name,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minOrderAmount: dto.minOrderAmount ?? 0,
        maxDiscount: dto.maxDiscount,
        usageLimit: dto.usageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        status: dto.status,
      },
    });
  }

  async listVouchers(query: {
    page?: number;
    limit?: number;
    status?: RecordStatus;
  }): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.VoucherWhereInput = query.status ? { status: query.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
      this.prisma.voucher.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /** Activate / deactivate a voucher. Only the status changes. */
  async updateVoucherStatus(id: number, status: RecordStatus) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException('Voucher not found');
    return this.prisma.voucher.update({ where: { id }, data: { status } });
  }

  /**
   * Compute a voucher discount for an order subtotal.
   * Throws if the voucher is invalid, expired, out of quota, or already used
   * by this customer beyond the per-customer limit.
   *
   * Read-only: this is the preview / early-validation entry point. The
   * authoritative consumption happens in `consumeVoucher` inside the checkout
   * transaction, because a check performed here (outside that transaction) can
   * be invalidated by a concurrent checkout before the order is written.
   */
  async applyVoucher(
    code: string,
    customerId: number,
    subtotal: number,
    now: Date = new Date(),
  ): Promise<{ voucherId: number; discountAmount: number }> {
    const voucher = await this.prisma.voucher.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    this.assertVoucherUsable(voucher, subtotal, now);
    if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
      throw new BadRequestException('Voucher usage limit reached');
    }
    if (voucher.perCustomerLimit !== null) {
      const used = await this.prisma.voucherRedemption.count({
        where: { voucherId: voucher.id, customerId },
      });
      if (used >= voucher.perCustomerLimit) {
        throw new BadRequestException('You have reached the per-customer limit for this voucher');
      }
    }

    return {
      voucherId: voucher.id,
      discountAmount: PromotionsService.computeVoucherDiscount(voucher, subtotal),
    };
  }

  /**
   * Validate and consume a voucher inside the caller's transaction, returning
   * the authoritative discount.
   *
   * The global `usageLimit` is claimed with a single conditional UPDATE
   * (`used_count = used_count + 1 WHERE used_count + 1 <= usage_limit`), so the
   * limit is enforced by the database under the row's exclusive lock instead of
   * by a read-then-write that two concurrent checkouts could both pass. When
   * the claim fails the caller's transaction rolls back, so a rejected checkout
   * leaves `used_count` untouched.
   *
   * The per-customer limit is counted *after* that lock is held. The UPDATE
   * serialises racing checkouts on the voucher row, and the transaction runs at
   * READ COMMITTED (see `OrdersService`), so the COUNT observes every redemption
   * that committed before the lock was granted — including one written by a
   * concurrent checkout that won the race. The caller inserts its own
   * `VoucherRedemption` row only after this returns, so the COUNT covers
   * strictly the customer's *other* orders.
   */
  async consumeVoucher(
    tx: Prisma.TransactionClient,
    params: { code: string; customerId: number; subtotal: number; now?: Date },
  ): Promise<{ voucherId: number; discountAmount: number }> {
    const now = params.now ?? new Date();
    const voucher = await tx.voucher.findUnique({
      where: { code: params.code.toUpperCase() },
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    this.assertVoucherUsable(voucher, params.subtotal, now);

    const claimed = await tx.$executeRaw`
      UPDATE vouchers
         SET used_count = used_count + 1,
             updated_at = UTC_TIMESTAMP(3)
       WHERE id = ${voucher.id}
         AND (usage_limit IS NULL OR used_count + 1 <= usage_limit)
    `;
    if (claimed === 0) {
      throw new BadRequestException('Voucher usage limit reached');
    }

    if (voucher.perCustomerLimit !== null) {
      const used = await tx.voucherRedemption.count({
        where: { voucherId: voucher.id, customerId: params.customerId },
      });
      if (used >= voucher.perCustomerLimit) {
        throw new BadRequestException('You have reached the per-customer limit for this voucher');
      }
    }

    return {
      voucherId: voucher.id,
      discountAmount: PromotionsService.computeVoucherDiscount(voucher, params.subtotal),
    };
  }

  /** Static usability rules shared by the preview and the consuming path. */
  private assertVoucherUsable(
    voucher: {
      status: string;
      startsAt: Date;
      endsAt: Date;
      minOrderAmount: unknown;
    },
    subtotal: number,
    now: Date,
  ): void {
    if (voucher.status !== 'ACTIVE') throw new BadRequestException('Voucher is not active');
    if (now < voucher.startsAt || now > voucher.endsAt) {
      throw new BadRequestException('Voucher is not within its valid period');
    }
    if (subtotal < Number(voucher.minOrderAmount)) {
      throw new BadRequestException(
        `Order subtotal must be at least ${Number(voucher.minOrderAmount)} to use this voucher`,
      );
    }
  }

  /** Discount for a subtotal, capped by `maxDiscount` and by the subtotal. */
  private static computeVoucherDiscount(
    voucher: { discountType: DiscountType; discountValue: unknown; maxDiscount: unknown },
    subtotal: number,
  ): number {
    let discount =
      voucher.discountType === DiscountType.PERCENT
        ? (subtotal * Number(voucher.discountValue)) / 100
        : Number(voucher.discountValue);
    if (voucher.maxDiscount !== null) {
      discount = Math.min(discount, Number(voucher.maxDiscount));
    }
    return round2(Math.min(discount, subtotal));
  }

  // ----- Product discounts (auto-applied) -----------------------------------

  createProductDiscount(dto: CreateProductDiscountDto) {
    return this.prisma.productDiscount.create({
      data: {
        productVariantId: dto.productVariantId,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        status: dto.status,
      },
    });
  }

  listProductDiscounts(query: { page?: number; limit?: number; status?: RecordStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.ProductDiscountWhereInput = query.status ? { status: query.status } : {};
    return Promise.all([
      this.prisma.productDiscount.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { productVariant: { select: { id: true, sku: true, name: true } } },
      }),
      this.prisma.productDiscount.count({ where }),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }

  /** Activate / deactivate a product discount. Only the status changes. */
  async updateProductDiscountStatus(id: number, status: RecordStatus) {
    const discount = await this.prisma.productDiscount.findUnique({ where: { id } });
    if (!discount) throw new NotFoundException('Product discount not found');
    return this.prisma.productDiscount.update({
      where: { id },
      data: { status },
      include: { productVariant: { select: { id: true, sku: true, name: true } } },
    });
  }

  // ----- Flash sales --------------------------------------------------------

  /**
   * Create a flash sale. The window is validated (`endsAt` after `startsAt`)
   * and a "weekend" label is refused on a programme longer than 7 days: the
   * fs#3 history (a "cuối tuần" name on a 60-day window) misled both operators
   * and customers, so the API now rejects that contradiction instead of
   * storing it. Both checks run before anything is written.
   */
  async createFlashSale(dto: CreateFlashSaleDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(endsAt.getTime() > startsAt.getTime())) {
      throw new BadRequestException('Flash sale endsAt must be after startsAt');
    }
    const spanDays = (endsAt.getTime() - startsAt.getTime()) / 86_400_000;
    if (spanDays > 7 && /cuoi tuan|cuối tuần|weekend/i.test(dto.name)) {
      throw new BadRequestException(
        'A flash sale longer than 7 days must not be labelled as a weekend sale',
      );
    }
    return this.prisma.flashSale.create({
      data: {
        name: dto.name,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        status: dto.status,
        items: {
          create: dto.items.map((i) => ({
            productVariantId: i.productVariantId,
            flashPrice: i.flashPrice,
            quota: i.quota,
            perCustomerLimit: i.perCustomerLimit,
          })),
        },
      },
      include: { items: true },
    });
  }

  listFlashSales(query: { page?: number; limit?: number; status?: RecordStatus }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.FlashSaleWhereInput = query.status ? { status: query.status } : {};
    return Promise.all([
      this.prisma.flashSale.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { items: { include: { productVariant: true } } },
      }),
      this.prisma.flashSale.count({ where }),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }

  /**
   * Activate / deactivate a flash sale. Deactivating is the safe way to stop a
   * running program: checkout's atomic quota claim re-checks `status = ACTIVE`,
   * so an inactive sale can no longer price or sell, while its items and the
   * quota already consumed stay on the record.
   */
  async updateFlashSaleStatus(id: number, status: RecordStatus) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException('Flash sale not found');
    return this.prisma.flashSale.update({
      where: { id },
      data: { status },
      include: { items: { include: { productVariant: true } } },
    });
  }

  /**
   * Resolve the effective unit price for a variant at a point in time.
   * Flash sale wins over product discount. Does NOT consume quota — quota is
   * consumed on order creation via `consumeFlashSaleQuota`, which is handed the
   * `flashSaleItemId` returned here so it charges the *same* item.
   *
   * When several active flash-sale items cover the variant the cheapest one
   * wins; ties are broken by the lowest item id so the choice is deterministic
   * and matches `consumeFlashSaleQuota`'s ordering.
   *
   * NOTE: this is the anonymous/catalog entry point. It does NOT consider the
   * customer's remaining quota or per-customer limit — every eligible item is
   * offered regardless of who asks. Checkout must use
   * `resolvePriceForCustomer`, which skips items this customer can no longer
   * buy (quota exhausted or personal limit reached), so two sales that share a
   * price stay independent programs instead of collapsing onto one item.
   */
  async resolvePrice(
    productVariantId: number,
    now: Date = new Date(),
  ): Promise<ResolvedPrice> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');
    const basePrice = Number(variant.basePrice);

    const flashItems = await this.prisma.flashSaleItem.findMany({
      where: {
        productVariantId,
        flashSale: {
          status: 'ACTIVE',
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
      },
      orderBy: [{ flashPrice: 'asc' }, { id: 'asc' }],
    });
    // Only a flash price that is actually *lower* than the base price is used.
    const flashItem = flashItems.find((i) => Number(i.flashPrice) < basePrice);
    if (flashItem) {
      const flashPrice = Number(flashItem.flashPrice);
      return {
        basePrice,
        unitPrice: flashPrice,
        discountAmount: round2(basePrice - flashPrice),
        source: 'FLASH_SALE',
        flashSaleItemId: flashItem.id,
      };
    }

    const discount = await this.prisma.productDiscount.findFirst({
      where: {
        productVariantId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: { id: 'desc' },
    });
    if (discount) {
      const unitPrice =
        discount.discountType === DiscountType.PERCENT
          ? basePrice * (1 - Number(discount.discountValue) / 100)
          : Math.max(0, basePrice - Number(discount.discountValue));
      const rounded = round2(unitPrice);
      return {
        basePrice,
        unitPrice: rounded,
        discountAmount: round2(basePrice - rounded),
        source: 'PRODUCT_DISCOUNT',
        flashSaleItemId: null,
      };
    }

    return { basePrice, unitPrice: basePrice, discountAmount: 0, source: 'NONE', flashSaleItemId: null };
  }

  /**
   * Checkout pricing for one variant and one customer.
   *
   * Same precedence and deterministic tie-break as `resolvePrice` (cheapest
   * active flash item below the base price wins; ties go to the lowest item
   * id), but items this customer can no longer buy are skipped:
   *
   *   - `soldQuantity + quantity > quota` (no quota left for this purchase), or
   *   - already-purchased (all committed `order_items` for this customer and
   *     this exact `flash_sale_item_id`, any order status — cancelled and
   *     returned purchases keep counting, there is no quota refund)
   *     `+ quantity > perCustomerLimit`.
   *
   * Rows created before `order_items.flash_sale_item_id` existed keep NULL and
   * never match any item, so history is never re-attributed by price.
   *
   * When no flash item remains eligible the same product-discount / NONE
   * fallback as `resolvePrice` applies, and the returned `flashSaleItemId` is
   * `null` so the caller consumes no quota — but ONLY when no active flash
   * item is actually applicable (no active item priced below the base price).
   * When applicable items exist yet none can serve this purchase (quota gone
   * or the customer's personal limit reached on every one of them) the
   * checkout is rejected instead of silently re-priced to the base price: a
   * customer who saw a flash price must not be charged the full price without
   * re-confirming (the `expectedGrandTotal` 409 path), and buying beyond the
   * limit must fail rather than slip through at another price. Which sale
   * blocked the purchase decides the error: if any applicable item still has
   * quota headroom for this quantity, the blocker is personal
   * (`Per-customer flash sale limit`); otherwise the sale itself is empty
   * (`Flash sale quota exceeded`).
   *
   * `client` lets the checkout re-run this inside its transaction (fresh
   * READ COMMITTED snapshot) to close the price-then-claim race; callers
   * outside a transaction omit it.
   */
  async resolvePriceForCustomer(
    productVariantId: number,
    customerId: number,
    quantity: number,
    now: Date = new Date(),
    client?: Prisma.TransactionClient,
  ): Promise<ResolvedPrice> {
    const db = client ?? (this.prisma as unknown as Prisma.TransactionClient);
    const variant = await db.productVariant.findUnique({
      where: { id: productVariantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');
    const basePrice = Number((variant as { basePrice: unknown }).basePrice);

    const flashItems = await db.flashSaleItem.findMany({
      where: {
        productVariantId,
        flashSale: {
          status: 'ACTIVE',
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
      },
      orderBy: [{ flashPrice: 'asc' }, { id: 'asc' }],
    });
    for (const item of flashItems) {
      const flashPrice = Number(item.flashPrice);
      if (!(flashPrice < basePrice)) continue;
      if (item.soldQuantity + quantity > item.quota) continue;
      const purchased = await db.orderItem.aggregate({
        where: {
          flashSaleItemId: item.id,
          partnerOrder: { order: { customerId } },
        },
        _sum: { quantity: true },
      });
      const already = Number(purchased._sum.quantity ?? 0);
      if (already + quantity > item.perCustomerLimit) continue;
      return {
        basePrice,
        unitPrice: flashPrice,
        discountAmount: round2(basePrice - flashPrice),
        source: 'FLASH_SALE',
        flashSaleItemId: item.id,
      };
    }

    // An active flash price below the base price exists for this variant, but
    // every applicable item refused this purchase. Reject rather than silently
    // selling at the base/discount price (see the docblock for the policy).
    const applicable = flashItems.filter((item) => Number(item.flashPrice) < basePrice);
    if (applicable.length > 0) {
      const anyQuotaHeadroom = applicable.some((item) => item.soldQuantity + quantity <= item.quota);
      if (anyQuotaHeadroom) {
        throw new BadRequestException(
          `Per-customer flash sale limit reached for variant ${productVariantId}`,
        );
      }
      throw new BadRequestException(`Flash sale quota exceeded for variant ${productVariantId}`);
    }

    const discount = await db.productDiscount.findFirst({
      where: {
        productVariantId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: { id: 'desc' },
    });
    if (discount) {
      const unitPrice =
        discount.discountType === DiscountType.PERCENT
          ? basePrice * (1 - Number(discount.discountValue) / 100)
          : Math.max(0, basePrice - Number(discount.discountValue));
      const rounded = round2(unitPrice);
      return {
        basePrice,
        unitPrice: rounded,
        discountAmount: round2(basePrice - rounded),
        source: 'PRODUCT_DISCOUNT',
        flashSaleItemId: null,
      };
    }

    return { basePrice, unitPrice: basePrice, discountAmount: 0, source: 'NONE', flashSaleItemId: null };
  }

  /**
   * Batch version of `resolvePrice` for catalog listings.
   *
   * Same precedence, same arithmetic, but resolved with two queries instead of
   * two per variant, so a product list can expose a server-side effective price
   * without an N+1 storm. `resolvePrice` stays the single-variant entry point and
   * both share the calculation helpers below.
   */
  async resolvePrices(
    productVariantIds: number[],
    now: Date = new Date(),
  ): Promise<Map<number, PriceBreakdown>> {
    const result = new Map<number, PriceBreakdown>();
    if (productVariantIds.length === 0) return result;

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: productVariantIds } },
      select: { id: true, basePrice: true },
    });

    const flashItems = await this.prisma.flashSaleItem.findMany({
      where: {
        productVariantId: { in: productVariantIds },
        flashSale: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gte: now } },
      },
      orderBy: [{ flashPrice: 'asc' }, { id: 'asc' }],
    });
    const discounts = await this.prisma.productDiscount.findMany({
      where: {
        productVariantId: { in: productVariantIds },
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: { id: 'desc' },
    });

    // Cheapest flash item wins; newest discount wins.
    const flashByVariant = new Map<number, (typeof flashItems)[number]>();
    for (const item of flashItems) {
      if (!flashByVariant.has(item.productVariantId)) flashByVariant.set(item.productVariantId, item);
    }
    const discountByVariant = new Map<number, (typeof discounts)[number]>();
    for (const discount of discounts) {
      if (!discountByVariant.has(discount.productVariantId)) {
        discountByVariant.set(discount.productVariantId, discount);
      }
    }

    for (const variant of variants) {
      const basePrice = Number(variant.basePrice);
      const flashItem = flashByVariant.get(variant.id);
      if (flashItem && Number(flashItem.flashPrice) < basePrice) {
        const flashPrice = Number(flashItem.flashPrice);
        result.set(variant.id, {
          basePrice,
          unitPrice: flashPrice,
          discountAmount: round2(basePrice - flashPrice),
          source: 'FLASH_SALE',
        });
        continue;
      }
      const discount = discountByVariant.get(variant.id);
      if (discount) {
        const unitPrice =
          discount.discountType === DiscountType.PERCENT
            ? basePrice * (1 - Number(discount.discountValue) / 100)
            : Math.max(0, basePrice - Number(discount.discountValue));
        const rounded = round2(unitPrice);
        result.set(variant.id, {
          basePrice,
          unitPrice: rounded,
          discountAmount: round2(basePrice - rounded),
          source: 'PRODUCT_DISCOUNT',
        });
        continue;
      }
      result.set(variant.id, { basePrice, unitPrice: basePrice, discountAmount: 0, source: 'NONE' });
    }
    return result;
  }

  /**
   * Consume flash-sale quota for one order line. Enforces the global quota and
   * the per-customer limit. Runs inside the caller's transaction.
   *
   * The caller passes the `flashSaleItemId` that the in-transaction
   * `resolvePriceForCustomer` actually charged the line at, so the quota is
   * drawn from — and the per-customer limit is counted against — *that* item.
   * Attribution never falls back to "the price matches", which would confuse
   * two sales that share a price (or a normal purchase that lands on the same
   * price).
   *
   * When the priced program is no longer valid (sale deactivated, window
   * closed, price edited, quota gone) this THROWS and the caller's transaction
   * rolls back — Order, Payment, Inventory, Voucher and quota claims included.
   * It never returns success silently: committing a flash price without
   * consuming its quota (or against a different program's quota) is the exact
   * inconsistency this guard exists to prevent.
   *
   * Both limits are enforced by the database, never by a read-then-write:
   *
   *  1. The global quota is claimed with one conditional UPDATE that JOINS the
   *     parent `flash_sales` row, so `status = ACTIVE`, the time window, the
   *     quota predicate — and, when the caller passes it, the exact
   *     `flash_price` — are all re-evaluated atomically while MySQL holds the
   *     row's exclusive lock. A pre-check alone ("the sale was ACTIVE when we
   *     looked") is not trusted: an Admin deactivation (or price/quota edit)
   *     that commits between the pricing read and this claim makes the UPDATE
   *     match 0 rows instead of charging a stale price. Of N concurrent
   *     checkouts racing for the last unit exactly one wins and
   *     `sold_quantity` can never pass `quota`.
   *
   *  2. The per-customer limit counts this customer's committed purchases of
   *     *this* flash-sale item, after the row lock is held. The UPDATE above
   *     serialises the racing transactions on the flash-item row, and the
   *     transaction runs at READ COMMITTED (see `OrdersService`), so the COUNT
   *     that follows sees every purchase that committed before the lock was
   *     granted. Under REPEATABLE READ the transaction would keep its original
   *     snapshot and count 0 forever, which is what let one customer buy twice.
   *
   * Counting `order_items.flash_sale_item_id` (not `flash_sale_items.sold_quantity`)
   * is what makes this correct for *multiple* concurrent orders from one
   * customer: the aggregate covers the orders that already committed, and the
   * row lock makes sure two racing requests cannot both read the same pre-state.
   */
  async consumeFlashSaleQuota(
    tx: Prisma.TransactionClient,
    params: {
      flashSaleItemId: number;
      quantity: number;
      customerId: number;
      now?: Date;
      expectedUnitPrice?: number;
    },
  ): Promise<void> {
    const now = params.now ?? new Date();
    const item = await tx.flashSaleItem.findFirst({
      where: {
        id: params.flashSaleItemId,
        flashSale: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gte: now } },
      },
    });
    if (!item) {
      // The priced program is no longer valid (deactivated, window closed, or
      // deleted) between pricing and this claim. The line was priced at a flash
      // price, so there is no safe fallback inside this transaction: throw and
      // let the caller roll back instead of committing a flash price with no
      // quota consumed.
      throw new BadRequestException(
        `Flash sale item ${params.flashSaleItemId} is no longer available`,
      );
    }

    // Fast-fail when the flash price moved after the line was priced. The
    // atomic UPDATE below re-checks the same predicate, so a concurrent price
    // edit that lands between these two statements still matches 0 rows.
    if (
      params.expectedUnitPrice !== undefined &&
      Math.abs(Number(item.flashPrice) - params.expectedUnitPrice) > 0.005
    ) {
      throw new BadRequestException(
        `Flash sale price changed for variant ${item.productVariantId}, please re-preview`,
      );
    }

    // (1) Atomic conditional claim on the exact item that priced this line,
    // joined to its parent sale so deactivation / window close / price edit is
    // enforced in the same statement that increments the quota.
    let claimed: number;
    if (params.expectedUnitPrice !== undefined) {
      claimed = await tx.$executeRaw`
        UPDATE flash_sale_items AS i
        INNER JOIN flash_sales AS s ON s.id = i.flash_sale_id
           SET i.sold_quantity = i.sold_quantity + ${params.quantity},
               i.updated_at = UTC_TIMESTAMP(3)
         WHERE i.id = ${item.id}
           AND s.status = 'ACTIVE'
           AND s.starts_at <= UTC_TIMESTAMP(3)
           AND s.ends_at >= UTC_TIMESTAMP(3)
           AND i.flash_price = ${params.expectedUnitPrice}
           AND i.sold_quantity + ${params.quantity} <= i.quota
      `;
    } else {
      claimed = await tx.$executeRaw`
        UPDATE flash_sale_items AS i
        INNER JOIN flash_sales AS s ON s.id = i.flash_sale_id
           SET i.sold_quantity = i.sold_quantity + ${params.quantity},
               i.updated_at = UTC_TIMESTAMP(3)
         WHERE i.id = ${item.id}
           AND s.status = 'ACTIVE'
           AND s.starts_at <= UTC_TIMESTAMP(3)
           AND s.ends_at >= UTC_TIMESTAMP(3)
           AND i.sold_quantity + ${params.quantity} <= i.quota
      `;
    }
    if (claimed === 0) {
      // Diagnose with a fresh read (READ COMMITTED) so the error tells the
      // customer what actually changed; any path here rolls the checkout back.
      const current = await tx.flashSaleItem.findUnique({
        where: { id: item.id },
        include: { flashSale: true },
      });
      if (current) {
        const sale = (current as unknown as { flashSale?: { status?: string } }).flashSale;
        const saleInactive = !sale || sale.status !== 'ACTIVE';
        let windowClosed = false;
        if (!saleInactive) {
          const s = sale as unknown as { startsAt: Date; endsAt: Date };
          if (now < new Date(s.startsAt) || now > new Date(s.endsAt)) windowClosed = true;
        }
        if (saleInactive || windowClosed) {
          throw new BadRequestException(
            `Flash sale item ${item.id} is no longer available`,
          );
        }
        if (
          params.expectedUnitPrice !== undefined &&
          Math.abs(Number((current as unknown as { flashPrice: unknown }).flashPrice) - params.expectedUnitPrice) >
            0.005
        ) {
          throw new BadRequestException(
            `Flash sale price changed for variant ${item.productVariantId}, please re-preview`,
          );
        }
      }
      throw new BadRequestException(
        `Flash sale quota exceeded for variant ${item.productVariantId}`,
      );
    }

    // (2) Per-customer limit, read after the lock above, scoped to this exact
    // flash-sale item. The caller's own order items are already inserted at this
    // point (checkout writes them before reserving stock), so they are included
    // — that is intended: the aggregate represents "this customer's total
    // purchases of this item including this one".
    const perCustomer = await tx.orderItem.aggregate({
      where: {
        flashSaleItemId: item.id,
        partnerOrder: { order: { customerId: params.customerId } },
      },
      _sum: { quantity: true },
    });
    const already = Number(perCustomer._sum.quantity ?? 0);
    if (already > item.perCustomerLimit) {
      throw new BadRequestException(
        `Per-customer flash sale limit reached for variant ${item.productVariantId}`,
      );
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
