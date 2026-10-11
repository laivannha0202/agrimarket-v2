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
