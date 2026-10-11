import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { CommissionService } from '../finance/commission.service.js';
import {
  buildDatedCode,
  datedCodePrefix,
  formatSequence,
  isUniqueViolationOn,
  nextDatedSequence,
} from '../common/utils/code.util.js';
import { claimSequence } from '../common/utils/code-sequence.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CheckoutDto, CheckoutPreviewDto, type CheckoutAddressDto } from './dto/checkout.dto.js';
import { calculateShippingFee } from './shipping-policy.js';
import { LocationsService } from '../locations/locations.service.js';
import { normalizeVietnamesePhone } from '../common/utils/phone.util.js';
import { normalizeWhitespace } from '../common/utils/vietnamese-text.js';
import type { Order, Prisma } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  OrderStatus,
  PartnerOrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../generated/prisma/enums.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 100;
const CODE_ATTEMPTS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validates and normalises the shipping address before it is snapshotted.
 *
 * The snapshot is a historical record: once written it is never recomputed, so
 * whatever is stored here is what the order will show forever. That makes this
 * the right place to enforce the parts a client must not be trusted with:
 *
 *   - the recipient name and the detail line must be non-empty after trimming;
 *   - the phone must be a valid Vietnamese mobile number, normalised to the
 *     local 10-digit form;
 *   - when a `wardCode` is supplied it MUST resolve in the verified catalogue of
 *     the given province, and the OFFICIAL name is what gets snapshotted — a
 *     forged commune name cannot travel with a valid code, and a code from
 *     another province is refused.
 *
 * A legacy address (free text only, no ward code) is snapshotted as sent, so an
 * order placed from an address saved before the 2025 reorganisation still shows
 * exactly the address the customer chose.
 */
async function resolveAddressSnapshot(
  locations: LocationsService,
  address: CheckoutAddressDto,
): Promise<Record<string, unknown>> {
  const recipientName = normalizeWhitespace(address.recipientName ?? '');
  if (!recipientName) throw new BadRequestException('Vui lòng nhập tên người nhận');

  const detail = normalizeWhitespace(address.detail ?? '');
  if (!detail) throw new BadRequestException('Vui lòng nhập địa chỉ chi tiết');

  const phone = normalizeVietnamesePhone(address.phone ?? '');
  if (!phone) throw new BadRequestException('Số điện thoại chưa hợp lệ');

  const snapshot: Record<string, unknown> = {
    recipientName,
    phone,
    detail,
  };

  const village = address.village ? normalizeWhitespace(address.village) : '';
  if (village) snapshot.village = village;

  const wardCode = address.wardCode?.trim();
  if (wardCode) {
    const provinceCode = address.provinceCode?.trim();
    if (!provinceCode) {
      throw new BadRequestException('Thiếu mã tỉnh/thành phố cho xã/phường đã chọn');
    }
    const ward = await locations.findWard(provinceCode, wardCode);
    if (!ward) {
      throw new BadRequestException('Xã/phường không hợp lệ hoặc không thuộc tỉnh đã chọn');
    }
    // Official names from the catalogue, never the client's text.
    snapshot.provinceCode = ward.provinceCode;
    snapshot.wardCode = ward.code;
    snapshot.wardName = ward.fullName;
    snapshot.ward = ward.fullName;
    snapshot.province = ward.provinceName;
    return snapshot;
  }

  // Legacy shape: snapshot the free-text levels exactly as supplied.
  const province = address.province ? normalizeWhitespace(address.province) : '';
  if (!province) throw new BadRequestException('Vui lòng nhập tỉnh/thành phố');
  snapshot.province = province;

  if (address.district?.trim()) snapshot.district = normalizeWhitespace(address.district);
  if (address.ward?.trim()) snapshot.ward = normalizeWhitespace(address.ward);

  return snapshot;
}

/** Checkout line after the backend resolved price and snapshot data. */
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
  priceSource: 'NONE' | 'PRODUCT_DISCOUNT' | 'FLASH_SALE';
  /**
   * The exact flash-sale item this line was priced at, or `null`. Quota is
   * consumed from this id, so the charged price and the charged quota always
   * belong to the same program.
   */
  flashSaleItemId: number | null;
}

/** One line of a checkout preview: authoritative price + live availability. */
export interface CheckoutPreviewLine {
  productVariantId: number;
  productName: string;
  sku: string;
  quantity: number;
  basePrice: number;
  unitPrice: number;
  discountAmount: number;
  subtotal: number;
  priceSource: ResolvedLine['priceSource'];
  availableQuantity: number;
  available: boolean;
}

export interface CheckoutPreview {
  items: CheckoutPreviewLine[];
  itemCount: number;
  subtotal: number;
  discountTotal: number;
  voucher: { code: string; discountAmount: number } | null;
  shippingFee: number;
  grandTotal: number;
}

/**
 * Order detail as seen by the customer who owns the order.
 *
 * Deliberately excludes seller-side data (commission, payable amounts,
 * settlement rows) and internal warehouse ids. Lot traceability is exposed
 * through the public `traceCode` of the allocated lots, and shipments are
 * returned with their event timeline so the customer can follow the delivery.
 */
const customerOrderInclude = {
  partnerOrders: {
    select: {
      id: true,
      code: true,
      orderId: true,
      partnerId: true,
      subtotal: true,
      discountTotal: true,
      status: true,
      partner: { select: { id: true, code: true, name: true } },
      items: {
        select: {
          id: true,
          partnerOrderId: true,
          productVariantId: true,
          productNameSnapshot: true,
          skuSnapshot: true,
          unitPriceSnapshot: true,
          quantity: true,
          subtotal: true,
          discountAmount: true,
          createdAt: true,
          updatedAt: true,
          allocations: {
            select: {
              quantity: true,
              productLot: {
                select: {
                  code: true,
                  traceCode: true,
                  grade: true,
                  unit: true,
                  expiresAt: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      shipments: {
        select: {
          id: true,
          code: true,
          partnerOrderId: true,
          carrier: true,
          trackingCode: true,
          status: true,
          failureReason: true,
          shippedAt: true,
          deliveredAt: true,
          createdAt: true,
          updatedAt: true,
          events: {
            select: { id: true, status: true, occurredAt: true, note: true },
            orderBy: { occurredAt: 'asc' as const },
          },
        },
      },
      fulfillments: {
        select: { id: true, partnerOrderId: true, status: true, createdAt: true, updatedAt: true },
      },
    },
    orderBy: { id: 'asc' as const },
  },
  payments: { include: { refunds: true } },
  voucherRedemptions: true,
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly promotions: PromotionsService,
    private readonly commission: CommissionService,
    private readonly audit: AuditService,
    private readonly locations: LocationsService,
  ) {}

  /**
   * Checkout:
   *  1. resolve prices (flash sale / product discount) and snapshot them
   *  2. split the order into one PartnerOrder per partner
   *  3. apply voucher (platform-funded)
   *  4. FEFO-allocate and reserve sellable stock
   *  5. create a payment; COD stays PENDING
   *
   * The shipping fee is decided here (`calculateShippingFee`) — the client
   * cannot send one (the DTO has no such field, and unknown fields are
   * rejected), so the displayed total can never be manipulated from the client.
   *
   * When the caller sends an idempotency key the request becomes retry-safe:
   * the same key + the same payload returns the original order instead of
   * creating a second one, and the same key + a different payload is rejected
   * with 409. Without a key the behaviour is exactly as before.
   */
  async checkout(customerId: number, dto: CheckoutDto): Promise<Order> {
    const key = this.normalizeIdempotencyKey(dto.idempotencyKey);
    const requestHash = key ? hashCheckoutRequest(customerId, dto) : undefined;

    // The key is consulted BEFORE the cart is resolved: the first request
    // consumes the cart, so a retry that arrives after a lost response would
    // otherwise fail with "No items to checkout" instead of replaying the order
    // it already created. Only a request whose key was never used needs items.
    if (key && requestHash) {
      const replay = await this.findIdempotentOrder(customerId, key, requestHash);
      if (replay) return replay;
    }

    const rawItems = await this.resolveCheckoutItems(customerId, dto);
    if (rawItems.length === 0) {
      throw new BadRequestException('No items to checkout');
    }

    // The address is validated against the verified catalogue BEFORE the
    // transaction opens, so an invalid commune is refused without claiming a
    // voucher, an order code or any stock. The resulting snapshot is passed in
    // and written verbatim: it is a historical record, never recomputed later.
    const addressSnapshot = await resolveAddressSnapshot(this.locations, dto.shippingAddress);

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.createOrder(
          customerId,
          dto,
          rawItems,
          addressSnapshot,
          key,
          requestHash,
        );
      } catch (error) {
        // A concurrent request with the same key committed first: return its
        // order (or the 409 for a hash mismatch) instead of failing.
        if (key && requestHash && isUniqueViolationOn(error, 'checkout_idempotency_keys')) {
          const replay = await this.findIdempotentOrder(customerId, key, requestHash);
          if (replay) return replay;
          if (attempt < CODE_ATTEMPTS) continue;
        }
        // Two orders generated the same dated code: recompute and retry.
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /**
   * Price + availability preview for the checkout screen. Uses exactly the same
   * price resolution, voucher validation and shipping policy as the real
   * checkout, so the amount shown before submitting is the amount charged.
   */
  async checkoutPreview(customerId: number, dto: CheckoutPreviewDto): Promise<CheckoutPreview> {
    const rawItems = await this.resolveCheckoutItems(customerId, dto);
    if (rawItems.length === 0) {
      throw new BadRequestException('No items to checkout');
    }
    const lines = await this.resolveLines(rawItems, customerId);
    const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
    const shippingFee = calculateShippingFee(subtotal);

    let discountTotal = 0;
    let voucher: CheckoutPreview['voucher'] = null;
    if (dto.voucherCode) {
      const applied = await this.promotions.applyVoucher(dto.voucherCode, customerId, subtotal);
      discountTotal = applied.discountAmount;
      voucher = { code: dto.voucherCode.toUpperCase(), discountAmount: applied.discountAmount };
    }

    const availability = await this.inventory.sellableQuantities(
      lines.map((l) => l.productVariantId),
    );

    return {
      items: lines.map((line) => {
        const availableQuantity = availability.get(line.productVariantId) ?? 0;
        return {
          productVariantId: line.productVariantId,
          productName: line.productName,
          sku: line.sku,
          quantity: line.quantity,
          basePrice: line.basePrice,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          subtotal: line.subtotal,
          priceSource: line.priceSource,
          availableQuantity,
          available: availableQuantity >= line.quantity,
        };
      }),
      itemCount: lines.length,
      subtotal,
      discountTotal,
      voucher,
      shippingFee,
      grandTotal: round2(subtotal - discountTotal + shippingFee),
    };
  }

  private normalizeIdempotencyKey(raw?: string): string | undefined {
    const key = raw?.trim();
    if (!key) return undefined;
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency key is too long (max ${MAX_IDEMPOTENCY_KEY_LENGTH} characters)`,
      );
    }
    return key;
  }

  /**
   * Returns the order a previous request with this key created, or `null` when
   * the key was never used. Throws 409 when the key was used with a different
   * payload, or when the previous checkout is still in flight.
   */
  private async findIdempotentOrder(
    customerId: number,
    key: string,
    requestHash: string,
  ): Promise<Order | null> {
    const existing = await this.prisma.checkoutIdempotencyKey.findUnique({
      where: { customerId_key: { customerId, key } },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'This idempotency key was already used with a different checkout payload',
      );
    }
    if (existing.orderId === null) {
      throw new ConflictException('This checkout is still being processed, please retry');
    }
    const order = await this.prisma.order.findUnique({ where: { id: existing.orderId } });
    if (!order) {
      throw new ConflictException('The order created for this idempotency key is no longer available');
    }
    return order;
  }

  private async createOrder(
    customerId: number,
    dto: CheckoutDto,
    rawItems: { productVariantId: number; quantity: number }[],
    addressSnapshot: Record<string, unknown>,
    key?: string,
    requestHash?: string,
  ): Promise<Order> {
    const lines = await this.resolveLines(rawItems, customerId);

    const paymentMethod = dto.paymentMethod ?? PaymentMethod.COD;
    const now = new Date();

    // READ COMMITTED is required, not cosmetic. The transaction claims scarce
    // resources (order-code counter, flash quota, voucher usage) with
    // conditional UPDATEs and then *counts* what is committed to enforce a
    // per-customer limit. Under MySQL's default REPEATABLE READ the transaction
    // keeps the snapshot it took at its first read, so a count that runs after
    // the row lock is granted would still not see the purchase a concurrent
    // checkout committed while this one waited — the limit would be bypassed
    // exactly in the race it exists for. READ COMMITTED gives every statement a
    // fresh snapshot, so the count observes those commits. Verified against
    // MySQL 8 through the mariadb adapter.
    return this.prisma.$transaction(
      async (tx) => {
        // Re-resolve every line against the transaction's fresh snapshot before
        // anything is written. The pre-transaction pricing above can be
        // invalidated by a concurrent checkout (a flash sale ends, its quota is
        // taken, or this customer's purchases hit a per-customer limit), and
        // charging the stale price while consuming a different program's quota
        // is exactly the A-price/B-quota mismatch this guard exists to prevent.
        // The re-resolved program (or the discount/NONE fallback when no flash
        // item remains eligible) is what the order item snapshots and what
        // quota is consumed from, so price, order item and quota always agree.
        // A re-price changes the totals below, and the `expectedGrandTotal`
        // guard then answers 409 instead of silently charging a new amount.
        // Policy when the cheapest sale is exhausted: fall through to the next
        // eligible sale at *its* price (deterministic `flashPrice asc, id asc`
        // order), never charge one program's price against another's quota.
        for (const line of lines) {
          const price = await this.promotions.resolvePriceForCustomer(
            line.productVariantId,
            customerId,
            line.quantity,
            now,
            tx,
          );
          line.basePrice = price.basePrice;
          line.unitPrice = price.unitPrice;
          line.subtotal = round2(price.unitPrice * line.quantity);
          line.discountAmount = round2(price.discountAmount * line.quantity);
          line.priceSource = price.source;
          line.flashSaleItemId = price.flashSaleItemId;
        }

        // Group by partner (from the revalidated lines).
        const byPartner = new Map<number, ResolvedLine[]>();
        for (const line of lines) {
          const list = byPartner.get(line.partnerId) ?? [];
          list.push(line);
          byPartner.set(line.partnerId, list);
        }

        const orderSubtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
        // Shipping is decided by the backend, never by the client.
        const shippingFee = calculateShippingFee(orderSubtotal);

        const orderCode = await this.nextOrderCode(tx, now);

        // Voucher (platform-funded; does not reduce seller commission base).
        // Consumed here, inside the transaction, so the usage limit is enforced
        // atomically and a rejected checkout rolls the claim back.
        let voucherDiscount = 0;
        let voucherId: number | null = null;
        if (dto.voucherCode) {
          const applied = await this.promotions.consumeVoucher(tx, {
            code: dto.voucherCode,
            customerId,
            subtotal: orderSubtotal,
            now,
          });
          voucherDiscount = applied.discountAmount;
          voucherId = applied.voucherId;
        }

        const grandTotal = round2(orderSubtotal - voucherDiscount + shippingFee);
        if (grandTotal < 0) {
          throw new BadRequestException('Order total cannot be negative');
        }

        // Price/promotion guard between preview and confirm. A flash sale or
        // product discount can start/end, or a voucher's quota can run out,
        // between the customer seeing the preview total and confirming. When the
        // client echoes the total it saw we refuse a silent re-price: the whole
        // transaction rolls back (no voucher claim, no reservation), the
        // customer re-previews, and confirms the new amount. Checked here, after
        // the voucher claim but still inside the transaction, so a mismatch costs
        // nothing.
        if (dto.expectedGrandTotal !== undefined) {
          const expected = round2(dto.expectedGrandTotal);
          if (expected !== grandTotal) {
            throw new ConflictException(
              `The order total changed from ${expected} to ${grandTotal}. ` +
                'Please review the updated price and confirm again.',
            );
          }
        }

        const order = await tx.order.create({
          data: {
            code: orderCode,
            customerId,
            shippingAddressSnapshot: addressSnapshot as unknown as Prisma.InputJsonValue,
            subtotal: orderSubtotal,
            discountTotal: voucherDiscount,
            shippingFee,
            grandTotal,
            status: OrderStatus.PENDING_CONFIRMATION,
            note: dto.note,
          },
        });

        // Written inside the transaction: a rolled-back checkout leaves no key,
        // so the customer can retry, and a committed one can be replayed.
        if (key && requestHash) {
          await tx.checkoutIdempotencyKey.create({
            data: { customerId, key, requestHash, orderId: order.id },
          });
        }

        let partnerIndex = 0;
        for (const [partnerId, partnerLines] of byPartner) {
          partnerIndex += 1;
          const partnerSubtotal = round2(partnerLines.reduce((s, l) => s + l.subtotal, 0));
          const categoryId = partnerLines[0].categoryId;
          const { commissionAmount, payableAmount } = await this.commission.calculateForPartnerOrder(
            tx,
            {
              partnerId,
              categoryId,
              commissionBase: partnerSubtotal,
            },
          );

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
                flashSaleItemId: line.flashSaleItemId,
              },
            });

            // FEFO allocation + reservation.
            //
            // `allocateFefo` only *reads* the balances, so the chosen quantities
            // are a plan, not a guarantee: two concurrent checkouts can plan
            // against the same free unit. Each planned slice is therefore
            // claimed with the atomic, conditional `reserveStock`
            // (`reserved = reserved + ? WHERE on_hand - reserved - blocked >= ?`),
            // which re-checks the predicate while holding the row lock. When a
            // slice can no longer be claimed (a concurrent checkout took it) the
            // shortfall is retried from a fresh FEFO plan, so the caller either
            // gets its full quantity or a clear "insufficient stock" error — and
            // `reserved` can never exceed `on_hand - blocked`.
            await this.reserveLine(tx, order.id, orderItem.id, line);

            // Consume flash-sale quota only when the line was actually charged a
            // flash price, and from exactly the item that priced it. A line that
            // resolved to NONE / PRODUCT_DISCOUNT — or whose flash price was not
            // below the base price — never touches quota.
            if (line.flashSaleItemId !== null) {
              await this.promotions.consumeFlashSaleQuota(tx, {
                flashSaleItemId: line.flashSaleItemId,
                quantity: line.quantity,
                customerId,
                now,
                expectedUnitPrice: line.unitPrice,
              });
            }
          }
        }

        // The voucher's `used_count` was already claimed atomically by
        // `consumeVoucher`; this records who used it.
        if (voucherId) {
          await tx.voucherRedemption.create({
            data: { voucherId, customerId, orderId: order.id, discountAmount: voucherDiscount },
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

        await this.audit.record(
          {
            actorUserId: customerId,
            action: 'ORDER_CREATE',
            entityType: 'Order',
            entityId: String(order.id),
            afterJson: { code: order.code, grandTotal },
          },
          tx,
        );

        return order;
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Claim `line.quantity` units for one order line, FEFO.
   *
   * The FEFO plan (`allocateFefo`) is a read; claiming is an atomic conditional
   * update per balance (`InventoryService.reserveStock`). A concurrent checkout
   * may take a planned slice between the two, so a failed claim re-plans the
   * *remaining* quantity from the current database state and tries again. Each
   * claim is immediately recorded as an `InventoryAllocation` row, so the
   * allocation ledger and `reserved` always move together.
   *
   * `allocateFefo` throws when the sellable total is short, which is the final
   * answer: the checkout rolls back with a clear "insufficient stock" error and
   * no partial reservation survives (the caller's transaction is rolled back).
   */
  private async reserveLine(
    tx: Prisma.TransactionClient,
    orderId: number,
    orderItemId: number,
    line: ResolvedLine,
  ): Promise<void> {
    let remaining = line.quantity;

    while (remaining > 0) {
      // Fresh plan against committed state; throws when stock is short.
      const plan = await this.inventory.allocateFefo(tx, {
        productVariantId: line.productVariantId,
        quantity: remaining,
      });

      let claimed = 0;
      for (const slice of plan) {
        const reserved = await this.inventory.reserveStock(tx, slice.balanceId, slice.available);
        if (!reserved) continue; // another checkout took this slice: re-plan
        await tx.inventoryAllocation.create({
          data: {
            orderItemId,
            inventoryBalanceId: slice.balanceId,
            productLotId: slice.productLotId,
            quantity: slice.available,
          },
        });
        await this.inventory.recordMovement(tx, {
          warehouseId: slice.warehouseId,
          productLotId: slice.productLotId,
          productVariantId: line.productVariantId,
          type: InventoryMovementType.RESERVE,
          quantityDelta: 0,
          beforeQuantity: reserved.before,
          afterQuantity: reserved.after,
          referenceType: 'Order',
          referenceId: orderId,
        });
        claimed += slice.available;
      }

      if (claimed === 0) {
        // Nothing could be claimed: the stock this plan saw is gone. One more
        // pass re-reads the balances; if it is still empty `allocateFefo`
        // throws the shortfall error, which is the correct answer.
        const retry = await this.inventory.allocateFefo(tx, {
          productVariantId: line.productVariantId,
          quantity: remaining,
        });
        if (retry.length === 0) {
          throw new BadRequestException(
            `Insufficient sellable stock for variant ${line.productVariantId}: short by ${remaining}`,
          );
        }
        continue;
      }

      remaining -= claimed;
    }
  }

  /**
   * Next `ORD-YYYYMMDD-NNNN` code for today.
   *
   * Claimed from the atomic `code_sequences` counter (see `claimSequence`), so
   * two concurrent checkouts can never build the same code. The counter is
   * taken as the transaction's *first* write, before any inventory row is
   * locked, which gives every concurrent checkout the same lock order
   * (counter → balances) and removes the deadlocks that the old
   * "read MAX(code), collide, retry" loop produced (MySQL 1213 / P2034, plus
   * P2028 timeouts).
   *
   * `floor` still reads today's codes: it is the safety net for a counter that
   * is behind the truth (e.g. orders created before this counter was deployed),
   * and `GREATEST` inside `claimSequence` folds it in without ever going
   * backwards. The unique index on `orders.code` remains the last guard and
   * `checkout` still retries on a collision.
   */
  private async nextOrderCode(tx: Prisma.TransactionClient, now: Date): Promise<string> {
    const prefix = datedCodePrefix('ORD', now);
    const existing = await tx.order.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });
    const floor = nextDatedSequence(
      existing.map((row) => row.code),
      'ORD',
      now,
    ) - 1;
    const sequence = await claimSequence(tx, prefix, floor);
    return buildDatedCode('ORD', sequence, now);
  }

  private async resolveCheckoutItems(
    customerId: number,
    dto: { items?: { productVariantId: number; quantity: number }[] },
  ) {
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
    customerId: number,
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const item of items) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: item.productVariantId },
        include: { product: true },
      });
      if (!variant) throw new NotFoundException(`Product variant ${item.productVariantId} not found`);
      // A deactivated variant (or product) can never enter a new order — this
      // single check covers both preview and checkout, so the storefront and
      // the API cannot disagree. Past orders are untouched (price snapshots).
      if (variant.status !== 'ACTIVE') {
        throw new BadRequestException(`Product variant ${variant.sku} is no longer for sale`);
      }
      if (variant.product.status !== 'ACTIVE') {
        throw new BadRequestException(`Product ${variant.product.name} is no longer for sale`);
      }
      // Customer-aware pricing: skip flash items this customer can no longer
      // buy (quota exhausted or personal limit reached) so two sales that
      // share a price stay independent programs. The in-transaction
      // revalidation in `createOrder` re-runs this against the fresh snapshot.
      const price = await this.promotions.resolvePriceForCustomer(
        item.productVariantId,
        customerId,
        item.quantity,
      );
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
        priceSource: price.source,
        flashSaleItemId: price.flashSaleItemId,
      });
    }
    return lines;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: OrderStatus;
  }): Promise<PaginatedResult<Order>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
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

  /** Customer order list. `status` is filtered in SQL so `meta.total` is exact. */
  async findForCustomer(
    customerId: number,
    query: { page?: number; limit?: number; status?: OrderStatus },
  ) {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const where: Prisma.OrderWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };
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
   * Customer-facing order detail. Ownership is part of the query, so another
   * customer's order is indistinguishable from a missing one (404).
   */
  async findOneForCustomer(id: number, customerId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId },
      include: customerOrderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Order state machine. Keeps PartnerOrder statuses in sync. Moving to
   * DELIVERED settles COD payments; CANCELLED releases reservations.
   */
  async updateStatus(id: number, status: OrderStatus, actorUserId: number): Promise<Order> {
    const order = await this.findOne(id);
    assertTransition(order.status, status);
    return this.applyStatusChange(id, status, actorUserId, order.status, 'ORDER_STATUS');
  }

  /**
   * Customer self-service cancellation. Runs the same state machine as the
   * admin path (so an illegal transition is a 400) and releases the order's
   * inventory reservations exactly like an admin cancellation.
   */
  async cancelForCustomer(id: number, customerId: number, actorUserId: number): Promise<Order> {
    const order = await this.findOneForCustomer(id, customerId);
    assertTransition(order.status, OrderStatus.CANCELLED);
    return this.applyStatusChange(id, OrderStatus.CANCELLED, actorUserId, order.status, 'ORDER_CANCEL');
  }

  /**
   * Move an order to `status`, atomically, and apply the side effects.
   *
   * The state machine is re-checked *inside* the transaction as a conditional
   * compare-and-set (`UPDATE orders SET status = ? WHERE id = ? AND status =
   * expected`). Reading the status first and then writing it unconditionally is
   * a lost update: two concurrent cancellations both read
   * `PENDING_CONFIRMATION`, both passed `assertTransition`, and both released
   * the order's reservations — `reserved` dropped twice and two RELEASE
   * movements were written for one order (10/10 rounds in the audit). With the
   * predicate on the row, the loser matches 0 rows and is rejected.
   *
   * This also settles cancel-vs-deliver: whichever transition commits first
   * holds the row lock, and the other's predicate no longer matches, so an order
   * can never end up DELIVERED *and* have its stock released.
   */
  private async applyStatusChange(
    id: number,
    status: OrderStatus,
    actorUserId: number,
    previousStatus: OrderStatus,
    auditAction: string,
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      let updated: Order;
      if (status === previousStatus) {
        // Re-applying the current status is a documented no-op for non-terminal
        // states (see `assertTransition`). No side effect may run twice, so the
        // row is returned untouched.
        updated = await tx.order.findUniqueOrThrow({ where: { id } });
      } else {
        const claimed = await tx.order.updateMany({
          where: { id, status: previousStatus },
          data: { status },
        });
        if (claimed.count === 0) {
          throw new ConflictException(
            'The order status changed while this request was being processed, please reload',
          );
        }
        updated = await tx.order.findUniqueOrThrow({ where: { id } });
      }

      await tx.partnerOrder.updateMany({
        where: { orderId: id },
        data: { status: status as unknown as PartnerOrderStatus },
      });

      if (status === OrderStatus.DELIVERED) {
        // The goods physically leave the warehouse at this moment: consume the
        // order's reservations (on_hand and reserved both drop) and record the
        // OUTBOUND movements. Without this the reservation was held forever and
        // delivered stock stayed sellable.
        //
        // COD is deliberately NOT marked PAID here. Delivery success proves the
        // parcel arrived; it does not prove the courier collected cash. The
        // collection is confirmed explicitly through `PATCH /payments/:id/status`
        // (ADMIN) — the only path that sets `paidAt` for a COD payment.
        await this.inventory.consumeOrderStock(tx, id);
      }

      if (status === OrderStatus.CANCELLED) {
        // Goods that have already left the warehouse (the order was SHIPPING)
        // must NOT be released back to sellable stock: physically they are in
        // transit, so making the reservation available again would oversell
        // stock the warehouse no longer holds. Their reservation is converted to
        // a blocked (quarantine) quantity instead, keeping `available = on_hand -
        // reserved - blocked` unchanged; the units then wait for the return /
        // re-inspection flow (see the delivery-failure and return rules).
        // Everything still in the warehouse (PENDING_CONFIRMATION … READY_TO_SHIP)
        // is released as before.
        const goodsLeftWarehouse = previousStatus === OrderStatus.SHIPPING;
        await this.releaseOrderReservations(tx, id, goodsLeftWarehouse);
      }

      await this.audit.record(
        {
          actorUserId,
          action: auditAction,
          entityType: 'Order',
          entityId: String(id),
          beforeJson: { status: previousStatus },
          afterJson: { status },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Give an order's reserved stock back — or, when the goods have already left
   * the warehouse, quarantine it instead.
   *
   * Each release is the atomic `releaseStock`
   * (`reserved = GREATEST(reserved - ?, 0)`), never a read-then-write: the
   * balance is shared with other live orders, and computing
   * `newReserved = reserved - qty` from a value read earlier would drop a
   * concurrent checkout's reservation. The status compare-and-set above is what
   * guarantees this runs once per order.
   *
   * `quarantine` is set for a cancellation from `SHIPPING`: the physical goods
   * are in transit, so releasing them as sellable would oversell stock the
   * warehouse no longer holds. `quarantineStock` moves the reserved units into
   * `blocked` in one statement, so `available` does not change and the units
   * wait for the return / re-inspection flow.
   */
  private async releaseOrderReservations(
    tx: Prisma.TransactionClient,
    orderId: number,
    quarantine = false,
  ) {
    const allocations = await tx.inventoryAllocation.findMany({
      where: { orderItem: { partnerOrder: { orderId } } },
      include: { inventoryBalance: true },
    });
    for (const alloc of allocations) {
      const balance = alloc.inventoryBalance;
      const quantity = Number(alloc.quantity);
      let moved: { before: number; after: number };
      if (quarantine) {
        // The reservation is only converted when the balance still holds it.
        // `null` means a concurrent writer already released/changed it, so the
        // order's stock state no longer matches its allocation and proceeding
        // would fabricate blocked stock. Throw so the transaction rolls back
        // (the order is not cancelled, the caller can reload and retry).
        const quarantined = await this.inventory.quarantineStock(tx, balance.id, quantity);
        if (!quarantined) {
          throw new ConflictException(
            'The order stock changed while this request was being processed, please reload',
          );
        }
        moved = quarantined;
      } else {
        moved = await this.inventory.releaseStock(tx, balance.id, quantity);
      }
      await this.inventory.recordMovement(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        type: quarantine
          ? InventoryMovementType.QUARANTINE
          : InventoryMovementType.RELEASE,
        quantityDelta: 0,
        beforeQuantity: moved.before,
        afterQuantity: moved.after,
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
  // Re-applying the current status is a no-op, but the two terminal statuses
  // (DELIVERED, CANCELLED) must not be re-entered: re-cancelling a cancelled
  // order would release the reservations a second time.
  if (from === to) {
    if (ALLOWED_TRANSITIONS[from].length > 0) return;
    throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
  }
}

/**
 * Stable hash of the semantically relevant checkout request.
 *
 * Only what the caller actually sent is hashed (address, voucher, payment
 * method, note and — when the caller selected lines explicitly — those lines).
 * A cart-based checkout deliberately does NOT hash the cart contents: the
 * server owns that state, the first request consumes it, and a retry after a
 * lost response must still match so it can replay the order it created. Two
 * different requests that share a key are therefore rejected instead of
 * silently replaying an old order.
 */
function hashCheckoutRequest(customerId: number, dto: CheckoutDto): string {
  const address = dto.shippingAddress;
  const canonical = JSON.stringify({
    customerId,
    items: (dto.items ?? [])
      .map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity }))
      .sort((a, b) =>
        a.productVariantId === b.productVariantId
          ? a.quantity - b.quantity
          : a.productVariantId - b.productVariantId,
      ),
    voucherCode: dto.voucherCode?.trim().toUpperCase() ?? null,
    paymentMethod: dto.paymentMethod ?? PaymentMethod.COD,
    note: dto.note?.trim() ?? null,
    expectedGrandTotal: dto.expectedGrandTotal ?? null,
    shippingAddress: {
      recipientName: address.recipientName,
      phone: address.phone,
      province: address.province,
      provinceCode: address.provinceCode ?? null,
      wardCode: address.wardCode ?? null,
      district: address.district ?? null,
      ward: address.ward ?? null,
      village: address.village ?? null,
      detail: address.detail,
    },
  });
  return createHash('sha256').update(canonical).digest('hex');
}
