import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto.js';

@Injectable()
export class CartsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A cart holds no stock reservation — reservation happens at checkout. */
  async getOrCreateCart(customerId: number) {
    const existing = await this.prisma.cart.findUnique({
      where: { customerId },
      include: { items: { include: { productVariant: { include: { product: true } } } } },
    });
    if (existing) return existing;
    return this.prisma.cart.create({
      data: { customerId },
      include: { items: { include: { productVariant: { include: { product: true } } } } },
    });
  }

  async addItem(customerId: number, dto: AddCartItemDto) {
    const cart = await this.getOrCreateCart(customerId);
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.productVariantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        cartId_productVariantId: { cartId: cart.id, productVariantId: dto.productVariantId },
      },
    });
    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: Number(existing.quantity) + dto.quantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: { cartId: cart.id, productVariantId: dto.productVariantId, quantity: dto.quantity },
      });
    }
    return this.getOrCreateCart(customerId);
  }

  async updateItem(customerId: number, itemId: number, dto: UpdateCartItemDto) {
    const cart = await this.getOrCreateCart(customerId);
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw new NotFoundException('Cart item not found');
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity: dto.quantity } });
    return this.getOrCreateCart(customerId);
  }

  async removeItem(customerId: number, itemId: number) {
    const cart = await this.getOrCreateCart(customerId);
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw new NotFoundException('Cart item not found');
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getOrCreateCart(customerId);
  }

  async clear(customerId: number) {
    const cart = await this.getOrCreateCart(customerId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.getOrCreateCart(customerId);
  }
}
