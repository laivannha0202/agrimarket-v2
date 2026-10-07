import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import {
  CreateFlashSaleDto,
  CreateProductDiscountDto,
  CreateVoucherDto,
} from './dto/promotion.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { DiscountType } from '../../generated/prisma/enums.js';

export interface PriceBreakdown {
  basePrice: number;
  unitPrice: number;
  discountAmount: number;
  source: 'NONE' | 'PRODUCT_DISCOUNT' | 'FLASH_SALE';
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
  }): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany({ skip, take, orderBy: { id: 'desc' } }),
      this.prisma.voucher.count(),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * Compute a voucher discount for an order subtotal.
   * Throws if the voucher is invalid, expired, out of quota, or already used
   * by this customer beyond the per-customer limit.
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
    if (voucher.status !== 'ACTIVE') throw new BadRequestException('Voucher is not active');
    if (now < voucher.startsAt || now > voucher.endsAt) {
      throw new BadRequestException('Voucher is not within its valid period');
    }
    if (subtotal < Number(voucher.minOrderAmount)) {
      throw new BadRequestException(
        `Order subtotal must be at least ${Number(voucher.minOrderAmount)} to use this voucher`,
      );
    }
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

    let discount =
      voucher.discountType === DiscountType.PERCENT
        ? (subtotal * Number(voucher.discountValue)) / 100
        : Number(voucher.discountValue);

    if (voucher.maxDiscount !== null) {
      discount = Math.min(discount, Number(voucher.maxDiscount));
    }
    discount = Math.min(discount, subtotal);
    return { voucherId: voucher.id, discountAmount: round2(discount) };
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

  listProductDiscounts(query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    return Promise.all([
      this.prisma.productDiscount.findMany({
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { productVariant: { select: { id: true, sku: true, name: true } } },
      }),
      this.prisma.productDiscount.count(),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }

  // ----- Flash sales --------------------------------------------------------

  createFlashSale(dto: CreateFlashSaleDto) {
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

  listFlashSales(query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    return Promise.all([
      this.prisma.flashSale.findMany({
        skip,
        take,
        orderBy: { id: 'desc' },
        include: { items: { include: { productVariant: true } } },
      }),
      this.prisma.flashSale.count(),
    ]).then(([data, total]) => paginate(data, total, page, limit));
  }

  /**
   * Resolve the effective unit price for a variant at a point in time.
   * Flash sale wins over product discount. Does NOT consume quota — quota is
   * consumed on order creation via `consumeFlashSaleQuota`.
   */
  async resolvePrice(
    productVariantId: number,
    now: Date = new Date(),
  ): Promise<PriceBreakdown> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');
    const basePrice = Number(variant.basePrice);

    const flashItem = await this.prisma.flashSaleItem.findFirst({
      where: {
        productVariantId,
        flashSale: {
          status: 'ACTIVE',
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
      },
      orderBy: { flashPrice: 'asc' },
    });
    if (flashItem && Number(flashItem.flashPrice) < basePrice) {
      const flashPrice = Number(flashItem.flashPrice);
      return {
        basePrice,
        unitPrice: flashPrice,
        discountAmount: round2(basePrice - flashPrice),
        source: 'FLASH_SALE',
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
      };
    }

    return { basePrice, unitPrice: basePrice, discountAmount: 0, source: 'NONE' };
  }

  /**
   * Consume flash-sale quota for a variant. Enforces global quota and the
   * per-customer limit. Runs inside the caller's transaction.
   */
  async consumeFlashSaleQuota(
    tx: Prisma.TransactionClient,
    params: { productVariantId: number; quantity: number; customerId: number; now?: Date },
  ): Promise<void> {
    const now = params.now ?? new Date();
    const item = await tx.flashSaleItem.findFirst({
      where: {
        productVariantId: params.productVariantId,
        flashSale: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gte: now } },
      },
    });
    if (!item) return;

    if (item.soldQuantity + params.quantity > item.quota) {
      throw new BadRequestException(
        `Flash sale quota exceeded for variant ${params.productVariantId}`,
      );
    }

    const perCustomer = await tx.orderItem.aggregate({
      where: {
        productVariantId: params.productVariantId,
        partnerOrder: { order: { customerId: params.customerId } },
      },
      _sum: { quantity: true },
    });
    const already = Number(perCustomer._sum.quantity ?? 0);
    if (already + params.quantity > item.perCustomerLimit) {
      throw new BadRequestException(
        `Per-customer flash sale limit reached for variant ${params.productVariantId}`,
      );
    }

    await tx.flashSaleItem.update({
      where: { id: item.id },
      data: { soldQuantity: item.soldQuantity + params.quantity },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
