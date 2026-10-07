import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { CommissionService } from '../finance/commission.service.js';
import { buildDatedCode, formatSequence } from '../common/utils/code.util.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import type { Order, Prisma } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  OrderStatus,
  PartnerOrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../generated/prisma/enums.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ResolvedLine {
  productVariantId: number;
  partnerId: number;
  categoryId: number;
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  basePrice: number;
  unitPrice: number;
  subtotal: number;
  discountAmount: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly promotions: PromotionsService,
    private readonly commission: CommissionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checkout:
   *  1. resolve prices (flash sale / product discount) and snapshot them
   *  2. split the order into one PartnerOrder per partner
   *  3. apply voucher (platform-funded)
   *  4. FEFO-allocate and reserve sellable stock
   *  5. create a payment; COD stays PENDING
   */
  async checkout(customerId: number, dto: CheckoutDto): Promise<Order> {
    const rawItems = await this.resolveCheckoutItems(customerId, dto);
    if (rawItems.length === 0) {
      throw new BadRequestException('No items to checkout');
    }

    const lines = await this.resolveLines(rawItems);

    // Group by partner.
    const byPartner = new Map<number, ResolvedLine[]>();
    for (const line of lines) {
      const list = byPartner.get(line.partnerId) ?? [];
      list.push(line);
      byPartner.set(line.partnerId, list);
    }

    const orderSubtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
    const shippingFee = dto.shippingFee ?? 0;

    // Voucher (platform-funded; does not reduce seller commission base).
    let voucherDiscount = 0;
    let voucherId: number | null = null;
    if (dto.voucherCode) {
      const applied = await this.promotions.applyVoucher(dto.voucherCode, customerId, orderSubtotal);
      voucherDiscount = applied.discountAmount;
      voucherId = applied.voucherId;
    }

    const grandTotal = round2(orderSubtotal - voucherDiscount + shippingFee);
    if (grandTotal < 0) {
      throw new BadRequestException('Order total cannot be negative');
    }

    const count = await this.prisma.order.count();
    const orderCode = buildDatedCode('ORD', count + 1);
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.COD;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          code: orderCode,
          customerId,
          shippingAddressSnapshot: dto.shippingAddress as unknown as Prisma.InputJsonValue,
          subtotal: orderSubtotal,
          discountTotal: voucherDiscount,
          shippingFee,
          grandTotal,
          status: OrderStatus.PENDING_CONFIRMATION,
          note: dto.note,
        },
      });

      let partnerIndex = 0;
      for (const [partnerId, partnerLines] of byPartner) {
        partnerIndex += 1;
        const partnerSubtotal = round2(partnerLines.reduce((s, l) => s + l.subtotal, 0));
        const categoryId = partnerLines[0].categoryId;
        const { commissionAmount, payableAmount } = await this.commission.calculateForPartnerOrder(tx, {
          partnerId,
          categoryId,
          commissionBase: partnerSubtotal,
        });

        const partnerOrder = await tx.partnerOrder.create({
          data: {
            code: `${orderCode}-P${formatSequence(partnerIndex, 2)}`,
            orderId: order.id,
            partnerId,
            subtotal: partnerSubtotal,
            discountTotal: 0,
            commissionAmount,
            payableAmount,
            status: PartnerOrderStatus.PENDING_CONFIRMATION,
          },
        });

        for (const line of partnerLines) {
          const orderItem = await tx.orderItem.create({
            data: {
              partnerOrderId: partnerOrder.id,
              productVariantId: line.productVariantId,
              productNameSnapshot: line.productName,
              skuSnapshot: line.sku,
              unitPriceSnapshot: line.unitPrice,
              quantity: line.quantity,
              subtotal: line.subtotal,
              discountAmount: line.discountAmount,
            },
          });

          // FEFO allocation + reservation.
          const allocations = await this.inventory.allocateFefo(tx, {
            productVariantId: line.productVariantId,
            quantity: line.quantity,
          });
          for (const alloc of allocations) {
            await tx.inventoryAllocation.create({
              data: {
                orderItemId: orderItem.id,
                inventoryBalanceId: alloc.balanceId,
                productLotId: alloc.productLotId,
                quantity: alloc.available,
              },
            });
            const balance = await tx.inventoryBalance.findUniqueOrThrow({
              where: { id: alloc.balanceId },
            });
            const newReserved = Number(balance.reserved) + alloc.available;
            await tx.inventoryBalance.update({
              where: { id: alloc.balanceId },
              data: { reserved: newReserved },
            });
            await this.inventory.recordMovement(tx, {
              warehouseId: alloc.warehouseId,
              productLotId: alloc.productLotId,
              productVariantId: line.productVariantId,
              type: InventoryMovementType.RESERVE,
              quantityDelta: 0,
              beforeQuantity: Number(balance.reserved),
              afterQuantity: newReserved,
              referenceType: 'Order',
              referenceId: order.id,
            });
          }

          // Consume flash-sale quota if the price came from a flash sale.
          await this.promotions.consumeFlashSaleQuota(tx, {
            productVariantId: line.productVariantId,
            quantity: line.quantity,
            customerId,
          });
        }
      }

      if (voucherId) {
        await tx.voucherRedemption.create({
          data: { voucherId, customerId, orderId: order.id, discountAmount: voucherDiscount },
        });
        await tx.voucher.update({
          where: { id: voucherId },
          data: { usedCount: { increment: 1 } },
        });
      }

      // Payment record. COD is created as PENDING and only marked PAID on
      // delivery confirmation.
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: paymentMethod,
          amount: grandTotal,
          status: PaymentStatus.PENDING,
        },
      });

      // Clear the cart for items that were purchased.
      await tx.cartItem.deleteMany({
        where: {
          cart: { customerId },
          productVariantId: { in: lines.map((l) => l.productVariantId) },
        },
      });

      await this.audit.record({
        actorUserId: customerId,
        action: 'ORDER_CREATE',
        entityType: 'Order',
        entityId: String(order.id),
        afterJson: { code: order.code, grandTotal },
      });

      return order;
    });
  }

  private async resolveCheckoutItems(customerId: number, dto: CheckoutDto) {
    if (dto.items && dto.items.length > 0) return dto.items;
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: { items: true },
    });
    if (!cart || cart.items.length === 0) return [];
    return cart.items.map((i) => ({
      productVariantId: i.productVariantId,
      quantity: Number(i.quantity),
    }));
  }

  private async resolveLines(
    items: { productVariantId: number; quantity: number }[],
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const item of items) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: item.productVariantId },
        include: { product: true },
      });
      if (!variant) throw new NotFoundException(`Product variant ${item.productVariantId} not found`);
      const price = await this.promotions.resolvePrice(item.productVariantId);
      const subtotal = round2(price.unitPrice * item.quantity);
      lines.push({
        productVariantId: variant.id,
        partnerId: variant.product.partnerId,
        categoryId: variant.product.categoryId,
        productId: variant.product.id,
        productName: variant.product.name,
        sku: variant.sku,
        quantity: item.quantity,
        basePrice: price.basePrice,
        unitPrice: price.unitPrice,
        subtotal,
        discountAmount: round2(price.discountAmount * item.quantity),
      });
    }
    return lines;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }): Promise<PaginatedResult<Order>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status as OrderStatus } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { customer: { fullName: { contains: search } } },
              { customer: { email: { contains: search } } },
              { customer: { phone: { contains: search } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          customer: { select: { id: true, fullName: true, email: true, phone: true } },
          partnerOrders: { include: { partner: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findForCustomer(customerId: number, query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.OrderWhereInput = { customerId };
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        include: {
          partnerOrders: {
            include: {
              partner: { select: { id: true, name: true } },
              items: true,
            },
          },
          payments: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number, customerId?: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        partnerOrders: {
          include: {
            partner: { select: { id: true, code: true, name: true } },
            items: true,
            shipments: true,
            fulfillments: true,
          },
        },
        payments: { include: { refunds: true } },
        voucherRedemptions: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (customerId !== undefined && order.customerId !== customerId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Order state machine. Keeps PartnerOrder statuses in sync. Moving to
   * DELIVERED settles COD payments; CANCELLED releases reservations.
   */
  async updateStatus(id: number, status: OrderStatus, actorUserId: number): Promise<Order> {
    const order = await this.findOne(id);
    assertTransition(order.status, status);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({ where: { id }, data: { status } });
      await tx.partnerOrder.updateMany({
        where: { orderId: id },
        data: { status: status as unknown as PartnerOrderStatus },
      });

      if (status === OrderStatus.DELIVERED) {
        // COD is collected on delivery.
        await tx.payment.updateMany({
          where: { orderId: id, method: PaymentMethod.COD, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.PAID, paidAt: new Date() },
        });
      }

      if (status === OrderStatus.CANCELLED) {
        await this.releaseOrderReservations(tx, id);
      }

      await this.audit.record({
        actorUserId,
        action: 'ORDER_STATUS',
        entityType: 'Order',
        entityId: String(id),
        beforeJson: { status: order.status },
        afterJson: { status },
      });
      return updated;
    });
  }

  private async releaseOrderReservations(tx: Prisma.TransactionClient, orderId: number) {
    const allocations = await tx.inventoryAllocation.findMany({
      where: { orderItem: { partnerOrder: { orderId } } },
      include: { inventoryBalance: true },
    });
    for (const alloc of allocations) {
      const balance = alloc.inventoryBalance;
      const newReserved = Math.max(0, Number(balance.reserved) - Number(alloc.quantity));
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { reserved: newReserved },
      });
      await this.inventory.recordMovement(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        type: InventoryMovementType.RELEASE,
        quantityDelta: 0,
        beforeQuantity: Number(balance.reserved),
        afterQuantity: newReserved,
        referenceType: 'OrderCancel',
        referenceId: orderId,
      });
    }
  }
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY_TO_SHIP, OrderStatus.CANCELLED],
  READY_TO_SHIP: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  SHIPPING: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
  }
}
