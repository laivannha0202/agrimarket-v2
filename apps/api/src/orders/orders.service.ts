import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { CommissionService } from '../finance/commission.service.js';
import { QuarantineService, QUARANTINE_SOURCES } from '../quarantine/quarantine.service.js';
import { ShipmentsService } from '../shipments/shipments.service.js';
import { SHIPMENT_LEFT_WAREHOUSE_STATUSES } from '../shipments/shipment-statuses.js';
import { assertDeliveryEvidence, loadDeliveryEvidence } from './delivery-evidence.js';
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
import { CheckoutDto, CheckoutPreviewDto, CheckoutSource, type CheckoutAddressDto } from './dto/checkout.dto.js';
import { calculateShippingFee } from './shipping-policy.js';
import { assertOrderTransition } from './order-state-machine.js';
import { hashCheckoutRequest, resolveCheckoutSource } from './checkout-request.js';
import { LocationsService } from '../locations/locations.service.js';
import { normalizeVietnamesePhone } from '../common/utils/phone.util.js';
import { normalizeWhitespace } from '../common/utils/vietnamese-text.js';
import { reservationTtlMsForMethod } from './reservation-policy.js';
import { assertPaymentMethodAvailable } from '../payments/payment-methods.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Order } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  OrderStatus,
  PartnerOrderStatus,
  PartnerVerificationStatus,
  PaymentMethod,
  PaymentStatus,
  RecordStatus,
} from '../../generated/prisma/enums.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 100;
const CODE_ATTEMPTS = 3;

/**
 * Refusal returned for every line whose seller may not trade right now.
 *
 * Deliberately one fixed sentence with no product/partner name in it: the
 * storefront must not disclose *why* a listing became unsellable (a rejected
 * legal file is not the buyer's business), and the buyer only needs to know the
 * line cannot be bought. The exact wording is part of the API contract with the
 * web app, so it is a constant, not a formatted string.
 */
const PARTNER_NOT_SELLABLE_MESSAGE =
  'Sản phẩm hiện chưa đủ điều kiện kinh doanh. Vui lòng chọn sản phẩm khác.';

/**
 * A seller may only sell when it is both ACTIVE (not suspended) and VERIFIED
 * (its legal file passed review). Same rule as the public catalogue
 * (`publicPartnerVisibility`) and product publication
 * (`ProductsService.assertPartnerCanSell`), so a product cannot be bought from a
 * seller the storefront would refuse to list it under.
 */
function isPartnerSellable(
  partner: { status: string; verificationStatus: string } | null | undefined,
): boolean {
  return (
    partner?.status === RecordStatus.ACTIVE &&
    partner.verificationStatus === PartnerVerificationStatus.VERIFIED
  );
}

/** A payment in one of these states means real money is already involved. */
const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Quantities are `Decimal(18,3)` (kg/gram precision), so cart arithmetic must
 * round to three decimals — `0.3 - 0.1` is `0.19999999999999998` in binary
 * floating point and would be written back as an off-by-an-epsilon quantity.
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
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
  voucherRedemptions: { include: { voucher: { select: { code: true } } } },
} satisfies Prisma.OrderInclude;

/**
 * Admin order detail payload.
 *
 * Adds the internal finance trail (partner commission -> settlement line ->
 * payouts, plus late-refund reconciliation rows) and the full shipment event
 * timeline on top of the customer shape. It is read-only: nothing here is
 * recomputed, and every amount is the stored snapshot. Customers never receive
 * this shape — `findOneForCustomer` keeps its own whitelist.
 */
const adminOrderInclude = {
  customer: { select: { id: true, fullName: true, email: true, phone: true } },
  partnerOrders: {
    include: {
      partner: { select: { id: true, code: true, name: true } },
      items: {
        include: {
          productVariant: { select: { saleUnit: true, weightUnit: true } },
          allocations: {
            include: { productLot: { select: { code: true, traceCode: true, unit: true } } },
          },
        },
      },
      shipments: {
        include: { events: { orderBy: { occurredAt: 'asc' as const } } },
        orderBy: { id: 'asc' as const },
      },
      fulfillments: true,
      settlementLines: {
        include: {
          settlement: {
            select: {
              id: true,
              code: true,
              status: true,
              payableAmount: true,
              refundAmount: true,
              adjustmentAmount: true,
              confirmedAt: true,
              payouts: {
                select: {
                  id: true,
                  code: true,
                  amount: true,
                  status: true,
                  reference: true,
                  paidAt: true,
                },
                orderBy: { id: 'asc' as const },
              },
            },
          },
        },
      },
      settlementAdjustments: { orderBy: { id: 'asc' as const } },
    },
    orderBy: { id: 'asc' as const },
  },
  payments: { include: { refunds: true } },
  voucherRedemptions: { include: { voucher: { select: { code: true } } } },
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
    @Optional() private readonly quarantine?: QuarantineService,
    @Optional() private readonly shipments?: ShipmentsService,
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
    // A method in the enum is not a method this deployment can settle. Online
    // gateways are refused until one is actually integrated, so an order can
    // never be created in a state that can only be paid by a callback that
    // does not exist.
    assertPaymentMethodAvailable(paymentMethod);
    const checkoutSource = resolveCheckoutSource(dto);
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
        // SELLER ELIGIBILITY, RE-CHECKED AT THE WRITE STEP.
        //
        // `resolveLines` above already refused an ineligible line, but it read
        // through the pooled client *before* this transaction opened. Between
        // that read and the first write below, an operator can suspend a
        // partner or move its verification back to PENDING/REJECTED, and the
        // order would then be written for a seller that is no longer allowed to
        // trade. Nothing about the decision may come from the request, so the
        // rule is re-evaluated here on the transaction's own snapshot, for
        // EVERY line (a multi-seller cart has no "the valid one" — one
        // ineligible seller refuses the whole checkout), and before any
        // resource is claimed: no order row, no order code, no voucher
        // redemption, no stock reservation, no payment. If any line fails, the
        // `BadRequestException` rolls the transaction back, so the cart is left
        // exactly as it was (cart consumption is the last write).
        //
        // Each fresh read also *rebinds* the line to the seller it actually has
        // now, so the lock set and the per-partner split below are built from
        // the same rows this loop judged — never from the pre-transaction
        // snapshot. (Only the seller is rebound: category, price and name
        // snapshots keep the pre-flight resolution, so pricing and commission
        // rules are untouched by this lock.)
        const sellerIds: number[] = [];
        for (const line of lines) {
          const variant = await this.loadSellableVariant(tx, line.productVariantId);
          line.partnerId = variant.product.partnerId;
          sellerIds.push(line.partnerId);
        }

        // LOCK THE SELLERS, THEN JUDGE THEM AGAIN UNDER THE LOCK.
        //
        // The reads above are plain SELECTs: they can judge an ACTIVE +
        // VERIFIED seller and still write the order after a concurrent
        // suspension commits, because nothing stopped that suspension from
        // landing between the read and the insert. `lockSellablePartners` takes
        // a shared row lock (`FOR SHARE`) on every seller — the lock that
        // conflicts with the `FOR UPDATE` the partner-management paths take —
        // and judges the state returned by that locking statement, so the two
        // paths can only interleave as "status change first -> checkout
        // refuses" or "checkout first -> status change hits the open-order
        // blocker".
        //
        // Runs before the order-code counter, the voucher claim, the order row
        // and every warehouse/balance lock: nothing is claimed for a seller that
        // may not sell.
        await this.lockSellablePartners(tx, sellerIds);

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
            // The reservation has a deadline from the moment it is created. The
            // sweep only cancels orders whose deadline has passed AND that have
            // no paid payment and no shipment.
            reservationExpiresAt: new Date(
              now.getTime() +
                reservationTtlMsForMethod(paymentMethod, {
                  defaultTtl: process.env.ORDER_RESERVATION_TTL_MINUTES,
                  codTtl: process.env.ORDER_RESERVATION_TTL_MINUTES_COD,
                }),
            ),
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

        // Pre-lock every warehouse that currently holds a balance this checkout
        // could reserve from, BEFORE any balance is claimed (see
        // `lockCheckoutWarehouses`). The whole order's lines are covered by one
        // sorted set; a balance created after this query is covered by the
        // per-slice shared lock in `reserveLine`.
        await this.lockCheckoutWarehouses(tx, lines);

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

        // Payment record. COD starts PENDING; delivery does not change it.
        // An ADMIN confirms the cash collection separately with a reference.
        await tx.payment.create({
          data: {
            orderId: order.id,
            method: paymentMethod,
            amount: grandTotal,
            status: PaymentStatus.PENDING,
          },
        });

        // Consume the cart lines this order actually paid for — and only when
        // the caller declared the lines came from the cart. A "Mua ngay" order
        // never touches the cart, so buying B leaves an existing B line (and
        // every other line) exactly as it was.
        await this.consumeCartLines(tx, customerId, lines, checkoutSource);

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
   * Consume the ordered quantity from the customer's cart — never more.
   *
   * Runs inside the checkout transaction, so a failed checkout leaves the cart
   * exactly as it was. `BUY_NOW` is a no-op: a direct purchase must not add,
   * decrement or remove any cart line, even for the very variant being bought.
   *
   * For `CART` the rule is quantity-accurate rather than line-granular: the
   * ordered quantity is subtracted from the matching cart line and the line is
   * deleted only when nothing is left, so a partial cart checkout
   * (`cart: 3 B`, `order: 1 B`) keeps the remaining 2 B. A line the order did
   * not include is never touched, and a cart line the order did not actually
   * pay for cannot be deleted — the mutation is derived from the server's own
   * cart state plus the order's own lines.
   */
  private async consumeCartLines(
    tx: Prisma.TransactionClient,
    customerId: number,
    lines: { productVariantId: number; quantity: number }[],
    source: CheckoutSource,
  ): Promise<void> {
    if (source !== CheckoutSource.CART) return;

    const cart = await tx.cart.findUnique({
      where: { customerId },
      include: { items: true },
    });
    if (!cart || cart.items.length === 0) return;

    const ordered = new Map(lines.map((line) => [line.productVariantId, line.quantity]));
    for (const item of cart.items) {
      const paid = ordered.get(item.productVariantId);
      if (paid === undefined) continue;

      const remaining = round3(Number(item.quantity) - paid);
      if (remaining <= 0) {
        await tx.cartItem.delete({ where: { id: item.id } });
      } else {
        await tx.cartItem.update({ where: { id: item.id }, data: { quantity: remaining } });
      }
    }
  }

  /**
   * Lock every Partner that sells a line of this checkout and decide, from the
   * rows returned BY THAT LOCKING READ, whether all of them may still trade.
   *
   * THE RACE THIS CLOSES
   *
   * The eligibility read in `createOrder` is a plain `SELECT`: it is fresh at
   * statement time but it holds nothing, so a partner suspension can land
   * between the read and the insert:
   *
   *   1. checkout reads Partner ACTIVE + VERIFIED (no lock);
   *   2. suspension locks the row, counts 0 open orders, commits INACTIVE;
   *   3. checkout inserts the order + partner order + reservation and commits.
   *
   * The customer then holds an order for a seller that was already stopped when
   * the order committed — and the suspension's own open-order blocker saw
   * nothing, so the operator's guard did not fire either. A plain re-read does
   * not help: it can always be followed by the same gap.
   *
   * THE FIX
   *
   * Lock the Partner rows with `FOR SHARE` and read `status` /
   * `verification_status` *from the locking statement*. InnoDB then serialises
   * this checkout against every X(partner) writer — the same lock
   * `PartnersService.changeBusinessStatus` / `verify` / `update` and
   * `ProductsService.assertPartnerCanSell` take:
   *
   *   - suspension commits first  -> this lock waits for it, then reads
   *     INACTIVE and refuses the whole checkout with
   *     `PARTNER_NOT_SELLABLE_MESSAGE`;
   *   - checkout commits first    -> the suspension waits for this lock, then
   *     its open-order count sees the freshly committed partner order and
   *     refuses with the existing "handle open orders first" conflict. The
   *     order stands, and it was created while the seller was still eligible.
   *
   * WHY THE STATUS COMES FROM THE LOCKING STATEMENT, NOT A SECOND READ
   *
   * A locking read always returns the latest committed row version, but a
   * *plain* read that follows it inside the same transaction can still answer
   * from an older consistent snapshot: verified on MySQL 8 through this
   * adapter under REPEATABLE READ, where `SELECT ... FOR SHARE` returned
   * INACTIVE while the `partner.findMany` right after it returned the stale
   * ACTIVE. Reading the pair in the same statement that takes the lock makes
   * the decision correct at any isolation level instead of only under the
   * READ COMMITTED this transaction currently requests.
   *
   * WHY `FOR SHARE` AND NOT `FOR UPDATE`
   *
   * Checkout never writes a Partner; it only needs the writers to queue behind
   * it. `FOR SHARE` is exactly that (`InventoryService.lockWarehouseShared`
   * documents the same reasoning for warehouses): it conflicts with the
   * suspension's X lock, which is the queueing point we need, while two
   * checkouts of the same seller still run in parallel instead of serialising
   * every order for a popular partner. Verified against MySQL 8: two `FOR
   * SHARE` holders coexist, and both a `changeBusinessStatus` X lock and a
   * product-publication X lock wait for them.
   *
   * LOCK ORDER
   *
   * One statement for the whole set, ascending Partner id and de-duplicated
   * first, so two multi-seller checkouts that share sellers take those rows in
   * the same order and cannot deadlock each other. It runs before the
   * order-code counter and before every warehouse/balance lock, so the order is
   * `partner -> code counter -> warehouse -> balance`. The `partner_orders`
   * insert below needs an S(partner) lock through its FK, which is compatible
   * with the S lock already held here (verified: the insert does not block).
   *
   * The refusal message is the fixed API-contract sentence (never a partner id
   * or the specific reason), identical to the pre-flight gate, so a client
   * cannot distinguish "was already stopped" from "was stopped mid-checkout".
   */
  private async lockSellablePartners(
    tx: Prisma.TransactionClient,
    partnerIds: number[],
  ): Promise<void> {
    const ids = [...new Set(partnerIds)].sort((a, b) => a - b);
    if (ids.length === 0) return;

    // Snake_case columns are read as-is (no alias) so the result shape does not
    // depend on how the driver maps aliases; the mapping happens in TS below.
    const locked = await tx.$queryRaw<
      Array<{ id: number; status: string; verification_status: string }>
    >`
      SELECT id, status, verification_status
        FROM partners
       WHERE id IN (${Prisma.join(ids)})
       ORDER BY id
         FOR SHARE
    `;

    // Fail closed on a short result: the ids came from a variant -> product
    // join in this same transaction, so a missing row means a concurrent
    // delete, and a money path must not guess.
    if (locked.length !== ids.length) {
      throw new BadRequestException(PARTNER_NOT_SELLABLE_MESSAGE);
    }
    for (const partner of locked) {
      if (
        !isPartnerSellable({
          status: partner.status,
          verificationStatus: partner.verification_status,
        })
      ) {
        throw new BadRequestException(PARTNER_NOT_SELLABLE_MESSAGE);
      }
    }
  }

  /**
   * Take shared warehouse locks for every warehouse this checkout could touch,
   * in ascending id order, BEFORE the first balance is claimed.
   *
   * Round 4 reproduced the deadlock this prevents (`.tmp-verify/round4/`):
   * `reserveLine` held X(balance) after `reserveStock`, then its RESERVE
   * movement insert needed S(warehouse) through the FK, while inbound/adjust
   * held X(warehouse) and waited for that same balance. Inbound and adjust
   * lost all 10/10 forced rounds with P2034 / MySQL 1213.
   *
   * The set covers every warehouse that holds a balance of the ordered variants
   * at this point in the transaction. A balance created by a concurrent inbound
   * after this query is covered by the per-slice `lockWarehouseShared` call in
   * `reserveLine`, so the `warehouse -> balance` order still holds.
   * `FOR SHARE` keeps concurrent checkouts parallel; it only serialises against
   * writers holding X(warehouse).
   */
  private async lockCheckoutWarehouses(
    tx: Prisma.TransactionClient,
    lines: ResolvedLine[],
  ): Promise<void> {
    const productVariantIds = [...new Set(lines.map((line) => line.productVariantId))];
    if (productVariantIds.length === 0) return;
    const balances = await tx.inventoryBalance.findMany({
      where: {
        productVariantId: { in: productVariantIds },
        warehouse: { status: RecordStatus.ACTIVE },
      },
      select: { warehouseId: true },
      distinct: ['warehouseId'],
    });
    const warehouseIds = [...new Set(balances.map((balance) => balance.warehouseId))].sort(
      (a, b) => a - b,
    );
    for (const warehouseId of warehouseIds) {
      await InventoryService.lockWarehouseShared(tx, warehouseId);
    }
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
   *
   * LOCK ORDER: `createOrder` calls `lockCheckoutWarehouses` first, which takes
   * S(warehouse) for every warehouse these lines can allocate from, in
   * ascending order. The `recordMovement` inserts below therefore already hold
   * the S lock their `warehouse_id` FK needs, instead of acquiring it *after*
   * X(balance) and closing a cycle with inbound/adjust/document-complete
   * (reproduced 10/10 in `.tmp-verify/round4/checkout-reserve-lock.mts`).
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
        // `lockCheckoutWarehouses` covered every warehouse that had a balance
        // when the transaction started. A concurrent inbound can create a new
        // balance in another warehouse after that query (READ COMMITTED gives
        // this statement a fresh snapshot), so take this warehouse's shared
        // lock before the balance's X lock as well. That keeps the
        // `warehouse -> balance` order for balances that did not exist at
        // pre-lock time; re-locking a warehouse already in the pre-lock set is
        // a no-op for conflict purposes.
        await InventoryService.lockWarehouseShared(tx, slice.warehouseId);
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

  /**
   * Load one ordered variant together with the two things that decide whether
   * it may be sold at all: its Product and that Product's Partner (the seller).
   *
   * `db` is the Prisma client *or* a transaction client, so the exact same rule
   * runs twice with no chance of drift:
   *
   *   1. `resolveLines` (outside the transaction) for the preview and for the
   *      early refusal — nothing is claimed, no voucher/code/stock is touched;
   *   2. the eligibility loop at the top of the checkout transaction (inside
   *      it, on the fresh READ COMMITTED snapshot) so a status change that
   *      landed between the pre-flight read and the write still refuses the
   *      order.
   *
   * Three independent gates, all server-side:
   *
   *   - the variant is ACTIVE (`ProductVariant.status`);
   *   - its Product is ACTIVE (`Product.status`);
   *   - its seller is ACTIVE and VERIFIED (`Partner.status` +
   *     `Partner.verificationStatus`) — the same pair the public catalogue and
   *     product publication already require (`publicPartnerVisibility`,
   *     `ProductsService.assertPartnerCanSell`). Without it a suspended or
   *     unverified seller could still take money through a stale listing.
   *
   * A missing partner relation is treated as "not sellable": the relation is
   * required in the schema, so the only way to see it absent is an incomplete
   * read, and failing closed is the safe answer for a money path.
   */
  private async loadSellableVariant(
    db: Pick<Prisma.TransactionClient, 'productVariant'>,
    productVariantId: number,
  ) {
    const variant = await db.productVariant.findUnique({
      where: { id: productVariantId },
      include: {
        product: {
          include: { partner: { select: { status: true, verificationStatus: true } } },
        },
      },
    });
    if (!variant) throw new NotFoundException(`Product variant ${productVariantId} not found`);
    // A deactivated variant (or product) can never enter a new order — this
    // single check covers both preview and checkout, so the storefront and
    // the API cannot disagree. Past orders are untouched (price snapshots).
    if (variant.status !== RecordStatus.ACTIVE) {
      throw new BadRequestException(`Product variant ${variant.sku} is no longer for sale`);
    }
    if (variant.product.status !== RecordStatus.ACTIVE) {
      throw new BadRequestException(`Product ${variant.product.name} is no longer for sale`);
    }
    // The seller gate. Message is intentionally generic and identical for
    // PENDING / REJECTED / INACTIVE partners: the buyer must not learn why a
    // seller was stopped, and the storefront keys its copy off this sentence.
    if (!isPartnerSellable(variant.product.partner)) {
      throw new BadRequestException(PARTNER_NOT_SELLABLE_MESSAGE);
    }
    return variant;
  }

  private async resolveLines(
    items: { productVariantId: number; quantity: number }[],
    customerId: number,
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const item of items) {
      const variant = await this.loadSellableVariant(this.prisma, item.productVariantId);
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
            items: {
              include: {
                productVariant: { select: { saleUnit: true, weightUnit: true } },
                allocations: { include: { productLot: { select: { code: true, traceCode: true, unit: true } } } },
              },
            },
            shipments: true,
            fulfillments: true,
          },
        },
        payments: { include: { refunds: true } },
        voucherRedemptions: { include: { voucher: { select: { code: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (customerId !== undefined && order.customerId !== customerId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /** Admin detail: the full operational + internal-finance view of one order. */
  async findOneForAdmin(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: adminOrderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
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
   * Order state machine. Keeps PartnerOrder statuses in sync. DELIVERED
   * consumes stock but does not settle COD; CANCELLED releases/quarantines
   * reservations.
   */
  async updateStatus(id: number, status: OrderStatus, actorUserId: number): Promise<Order> {
    const order = await this.findOne(id);
    assertOrderTransition(order.status, status);
    return this.applyStatusChange(id, status, actorUserId, order.status, 'ORDER_STATUS');
  }

  /**
   * Customer self-service cancellation. Runs the same state machine as the
   * admin path (so an illegal transition is a 400) and releases the order's
   * inventory reservations exactly like an admin cancellation.
   */
  async cancelForCustomer(id: number, customerId: number, actorUserId: number): Promise<Order> {
    const order = await this.findOneForCustomer(id, customerId);
    assertOrderTransition(order.status, OrderStatus.CANCELLED);
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
    actorUserId: number | null,
    previousStatus: OrderStatus,
    auditAction: string,
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      // DELIVERED is a statement about the physical parcel, not a status an
      // operator may assert by hand. The evidence is read inside the same
      // transaction as the compare-and-set below, so a delivery that is still
      // in transit cannot slip through on a stale read.
      if (status === OrderStatus.DELIVERED) {
        assertDeliveryEvidence(await loadDeliveryEvidence(tx, id));
      }

      let updated: Order;
      if (status === previousStatus) {
        // Re-applying the current status is a documented no-op for non-terminal
        // states (see `assertTransition`). No side effect may run twice, so the
        // row is returned untouched.
        updated = await tx.order.findUniqueOrThrow({ where: { id } });
      } else {
        const claimed = await tx.order.updateMany({
          where: { id, status: previousStatus },
          // The deadline belongs to the PENDING_CONFIRMATION reservation only.
          // Once the order moves on, clearing it keeps the sweep from ever
          // looking at a live order again.
          data: { status, reservationExpiresAt: null },
        });
        if (claimed.count === 0) {
          throw new ConflictException(
            'The order status changed while this request was being processed, please reload',
          );
        }
        updated = await tx.order.findUniqueOrThrow({ where: { id } });
      }

      // Keep partner orders in step without resurrecting terminal rows:
      //  - DELIVERED never overwrites a cancelled partner order (the evidence
      //    check above already refuses that combination);
      //  - CANCELLED never overwrites a partner order that already delivered;
      //  - the intermediate statuses only move non-terminal rows.
      if (status === OrderStatus.DELIVERED) {
        await tx.partnerOrder.updateMany({
          where: {
            orderId: id,
            status: { notIn: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.CANCELLED] },
          },
          data: { status: PartnerOrderStatus.DELIVERED },
        });
      } else if (status === OrderStatus.CANCELLED) {
        await tx.partnerOrder.updateMany({
          where: {
            orderId: id,
            status: { notIn: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.CANCELLED] },
          },
          data: { status: PartnerOrderStatus.CANCELLED },
        });
      } else {
        await tx.partnerOrder.updateMany({
          where: {
            orderId: id,
            status: { notIn: [PartnerOrderStatus.DELIVERED, PartnerOrderStatus.CANCELLED] },
          },
          data: { status: status as unknown as PartnerOrderStatus },
        });
      }

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
        // Goods that have already left the warehouse must NOT be released back
        // to sellable stock: physically they are in transit, so making the
        // reservation available again would oversell stock the warehouse no
        // longer holds. Their reservation is converted to blocked stock and one
        // quarantine case per allocation is opened; the units then wait for the
        // return / re-inspection flow. Everything still in the warehouse is
        // released as before.
        //
        // The order status is not the only signal: an operator can cancel an
        // order whose shipment already left while the order row still says
        // READY_TO_SHIP. Any shipment in a left-warehouse state counts.
        const shipments = await tx.shipment.findMany({
          where: { partnerOrder: { orderId: id } },
          select: { status: true },
        });
        const goodsLeftWarehouse =
          previousStatus === OrderStatus.SHIPPING ||
          shipments.some((s) => SHIPMENT_LEFT_WAREHOUSE_STATUSES.includes(s.status));
        if (goodsLeftWarehouse) {
          if (!this.quarantine) {
            throw new ConflictException('Quarantine service is not configured');
          }
          await this.quarantine.quarantineOrderReservations(tx, {
            orderId: id,
            sourceType: QUARANTINE_SOURCES.orderCancel,
            sourceId: id,
            reason: 'Đơn hàng bị hủy khi hàng đã rời kho — chờ kiểm định lại',
            actorUserId,
          });
        } else {
          await this.releaseOrderReservations(tx, id);
        }
        // Keep shipment history in step: pre-handover -> CANCELLED, in-transit
        // -> RETURNING. Never delete the timeline.
        await this.shipments?.syncOrderCancellation(tx, id, actorUserId ?? undefined);
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
   * Cancel one order whose reservation deadline has passed.
   *
   * Deliberately conservative: only PENDING_CONFIRMATION orders are eligible,
   * and an order with a paid/refunded payment or any shipment is left alone.
   * The cancellation itself goes through `applyStatusChange`, so it uses the
   * same compare-and-set and the same guarded stock release as an operator
   * cancellation — a concurrent confirm/cancel wins and the sweep reports a
   * race instead of releasing twice.
   *
   * Returns a result instead of throwing for the ordinary "not eligible"
   * cases: the scheduler must be able to walk a batch without one stale row
   * aborting the whole sweep.
   */
  async expireReservation(
    id: number,
    now: Date = new Date(),
  ): Promise<{ expired: boolean; reason?: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        reservationExpiresAt: true,
        payments: { select: { status: true } },
        partnerOrders: { select: { shipments: { select: { id: true } } } },
      },
    });
    if (!order) return { expired: false, reason: 'NOT_FOUND' };
    if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
      return { expired: false, reason: 'NOT_PENDING' };
    }
    if (!order.reservationExpiresAt || order.reservationExpiresAt > now) {
      return { expired: false, reason: 'NOT_DUE' };
    }
    if (order.payments.some((payment) => SETTLED_PAYMENT_STATUSES.includes(payment.status))) {
      return { expired: false, reason: 'PAID' };
    }
    if (order.partnerOrders.some((partnerOrder) => partnerOrder.shipments.length > 0)) {
      return { expired: false, reason: 'SHIPMENT' };
    }

    try {
      await this.applyStatusChange(
        id,
        OrderStatus.CANCELLED,
        null,
        OrderStatus.PENDING_CONFIRMATION,
        'ORDER_RESERVATION_EXPIRED',
      );
      return { expired: true };
    } catch (error) {
      if (error instanceof ConflictException) {
        return { expired: false, reason: 'RACED' };
      }
      throw error;
    }
  }

  /**
   * Give a still-warehoused order's reserved stock back.
   *
   * Each release is the atomic guarded `releaseStock`
   * (`reserved = reserved - ? WHERE reserved >= ?`), never a read-then-write
   * and never a clamping write: the balance is shared with other live orders,
   * and computing `newReserved = reserved - qty` from a value read earlier
   * would drop a concurrent checkout's reservation. The status compare-and-set
   * above is what guarantees this runs once per order; the row guard is what
   * guarantees the single run cannot release a reservation the balance no
   * longer holds (a lost race rolls back with 409 instead of fabricating
   * stock).
   *
   * Cancellations after the goods left the warehouse do NOT call this: they go
   * through `QuarantineService.quarantineOrderReservations`, which converts the
   * reservation to blocked stock and opens a quarantine case.
   */
  private async releaseOrderReservations(
    tx: Prisma.TransactionClient,
    orderId: number,
  ) {
    const allocations = await tx.inventoryAllocation.findMany({
      where: { orderItem: { partnerOrder: { orderId } } },
      include: { inventoryBalance: true },
    });
    // CONCURRENCY (lock order, round 3): lock every touched warehouse FIRST
    // (ascending ids), mirroring `InventoryService.lockWarehouse` and the rest
    // of the stock writers (inbound / documents / adjust / delivery consume —
    // `consumeOrderStock`). With only X(balance) held, this path inserts its
    // QUARANTINE/RELEASE movement below and needs a shared FK lock on the very
    // warehouse row an inbound/document path can already hold exclusively —
    // round 3 reproduced that InnoDB deadlock 30/30 rounds each mode
    // (Prisma P2034 on the inbound update; MySQL 1213 on the document path):
    // the victim lost its committed work and surfaced a raw DB error. Claiming
    // the warehouse rows up front puts every path on the same `warehouse →
    // balance` order, so both sides queue instead of closing a cycle.
    // `lockWarehouse` only (no status gate): cancelling an order at a
    // deactivated warehouse must still be possible.
    const warehouseIds = [...new Set(allocations.map((a) => a.inventoryBalance.warehouseId))].sort(
      (a, b) => a - b,
    );
    for (const warehouseId of warehouseIds) {
      await InventoryService.lockWarehouse(tx, warehouseId);
    }
    for (const alloc of allocations) {
      const balance = alloc.inventoryBalance;
      const quantity = Number(alloc.quantity);
      // Guarded release: `null` means a concurrent writer already
      // consumed/released the reservation the allocation points at. The order's
      // stock state no longer matches its allocation, so the whole cancellation
      // rolls back (the order is not cancelled) instead of fabricating a
      // release of stock the balance never had.
      const released = await this.inventory.releaseStock(tx, balance.id, quantity);
      if (!released) {
        throw new ConflictException(
          'The order stock changed while this request was being processed, please reload',
        );
      }
      await this.inventory.recordMovement(tx, {
        warehouseId: balance.warehouseId,
        productLotId: balance.productLotId,
        productVariantId: balance.productVariantId,
        type: InventoryMovementType.RELEASE,
        quantityDelta: 0,
        beforeQuantity: released.before,
        afterQuantity: released.after,
        referenceType: 'OrderCancel',
        referenceId: orderId,
      });
    }
  }
}
