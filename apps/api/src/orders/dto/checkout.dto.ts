import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/enums.js';

export class CheckoutAddressDto {
  @ApiProperty({ example: 'Nguyễn Thị Lan' })
  @IsString()
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '0912345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'Hưng Yên' })
  @IsString()
  @MaxLength(120)
  province!: string;

  /**
   * Official province code. When supplied together with `wardCode`, the backend
   * resolves the commune from the verified catalogue and snapshots the OFFICIAL
   * name — a client cannot put an invented commune into an order.
   */
  @ApiPropertyOptional({ example: '33' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;

  @ApiPropertyOptional({
    example: '11953',
    description: 'Official commune code from `GET /locations/provinces/33/wards`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  wardCode?: string;

  @ApiPropertyOptional({ example: 'Văn Lâm', description: 'Legacy district text.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ example: 'Tân Quang', description: 'Legacy commune text.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ward?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  village?: string;

  @ApiProperty({ example: 'Số 12, đường Nguyễn Văn Linh' })
  @IsString()
  @MaxLength(255)
  detail!: string;
}

export class CheckoutItemDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

/**
 * Where the ordered lines came from — and therefore whether the cart may be
 * touched once the order commits.
 *
 * - `CART`: the lines are cart lines. The backend consumes exactly the ordered
 *   quantity from the matching cart line and deletes a line only when it is
 *   emptied, so a partial cart checkout leaves the remainder in place.
 * - `BUY_NOW`: a direct purchase ("Mua ngay"). The cart is never read for the
 *   order and never written: buying B does not add B to the cart, does not
 *   decrement a B already there, and does not remove it.
 *
 * The flag can only ever *suppress* a cart mutation — it never unlocks one.
 * Cart writes stay derived from the server's own cart state and from the lines
 * actually ordered, so a forged `BUY_NOW` merely leaves the customer's cart
 * untouched, and a forged `CART` cannot delete a line the order did not pay for.
 *
 * Declared as a const object + union (the shape Prisma generates) rather than a
 * TypeScript `enum`, so plain `'BUY_NOW'` literals — which is what JSON bodies,
 * the shared `CheckoutSource` type and the web/mobile payload builders use — are
 * assignable without an import dance.
 */
export const CheckoutSource = {
  CART: 'CART',
  BUY_NOW: 'BUY_NOW',
} as const;

export type CheckoutSource = (typeof CheckoutSource)[keyof typeof CheckoutSource];

/**
 * Checkout request.
 *
 * There is deliberately NO `shippingFee` field: the fee is decided by the
 * backend (`calculateShippingFee`) and a client cannot influence the total. The
 * global ValidationPipe rejects unknown properties, so a forged `shippingFee`
 * is answered with a 400 instead of being silently ignored.
 */
export class CheckoutDto {
  @ApiProperty({ type: CheckoutAddressDto })
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  shippingAddress!: CheckoutAddressDto;

  @ApiPropertyOptional({ type: [CheckoutItemDto], description: 'Defaults to the current cart' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items?: CheckoutItemDto[];

  @ApiPropertyOptional({ example: 'HUNGYEN50K' })
  @IsOptional()
  @IsString()
  voucherCode?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.COD })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /**
   * Declares whether `items` are cart lines or a direct "Mua ngay" purchase.
   *
   * Optional for backward compatibility, and the default is deliberately the
   * non-destructive branch: explicit lines are treated as `BUY_NOW` (the cart is
   * left alone) unless the caller says otherwise. An omitted `items` is always
   * `CART`, because then the server itself resolved the lines from the cart.
   */
  @ApiPropertyOptional({
    enum: CheckoutSource,
    description: 'CART (default when items are omitted) or BUY_NOW',
  })
  @IsOptional()
  @IsEnum(CheckoutSource)
  source?: CheckoutSource;

  /**
   * The grand total the customer saw on the preview screen. When present the
   * backend re-resolves prices/voucher/shipping and refuses the checkout with a
   * 409 if the total no longer matches, instead of silently charging a different
   * amount. Optional so non-UI clients (and retries) keep working; when omitted
   * the price is simply re-resolved at checkout time.
   */
  @ApiPropertyOptional({
    example: 170000,
    description:
      'Grand total from `POST /orders/checkout-preview`; a mismatch returns 409 so the customer can re-confirm.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedGrandTotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  /**
   * Optional client-generated key that makes the checkout retry-safe: the same
   * key with the same payload returns the original order instead of creating a
   * second one. The `Idempotency-Key` header is accepted as well.
   */
  @ApiPropertyOptional({ example: '9f1c0b7e-3a4d-4c1f-8f6e-2f0f6a1c9d3b' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}

/**
 * Checkout preview request: the same line selection as `CheckoutDto` without
 * any address, because nothing is created and no snapshot is taken.
 *
 * There is deliberately no `shippingFee` here either: the preview reports the
 * backend-computed fee, and a client-supplied one is rejected as unknown.
 */
export class CheckoutPreviewDto {
  @ApiPropertyOptional({ type: [CheckoutItemDto], description: 'Defaults to the current cart' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items?: CheckoutItemDto[];

  @ApiPropertyOptional({ example: 'HUNGYEN50K' })
  @IsOptional()
  @IsString()
  voucherCode?: string;
}
