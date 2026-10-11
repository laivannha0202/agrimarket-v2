import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { DiscountType, RecordStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateVoucherDto {
  @ApiProperty({ example: 'HUNGYEN50K' })
  @IsString()
  code!: string;

  @ApiProperty({ example: 'Giảm 50.000đ cho đơn từ 300.000đ' })
  @IsString()
  name!: string;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiProperty({ example: 50000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountValue!: number;

  @ApiPropertyOptional({ example: 300000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minOrderAmount?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxDiscount?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  usageLimit?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  perCustomerLimit?: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class CreateProductDiscountDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountValue!: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class CreateFlashSaleItemDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: 25000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  flashPrice!: number;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quota!: number;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerLimit!: number;
}

export class CreateFlashSaleDto {
  @ApiProperty({ example: 'Flash Sale cuối tuần Hưng Yên' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '2026-06-01T00:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-06-07T23:59:59.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @ApiProperty({ type: [CreateFlashSaleItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFlashSaleItemDto)
  items!: CreateFlashSaleItemDto[];
}

/**
 * Query DTO shared by `GET /vouchers`, `/product-discounts` and
 * `/flash-sales`. All three are `RecordStatus`-filtered, and the strict enum
 * turns an unknown status into a 400 instead of a Prisma error.
 */
export class PromotionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  declare status?: RecordStatus;
}

/**
 * `PATCH /vouchers/:id`. Only the record status is editable after creation:
 * discount terms and the validity window are fixed once a voucher may have
 * been redeemed, so history is never re-priced by an edit.
 */
export class UpdateVoucherStatusDto {
  @ApiProperty({ enum: RecordStatus })
  @IsEnum(RecordStatus)
  status!: RecordStatus;
}

/** `PATCH /product-discounts/:id` — status only, same reasoning as vouchers. */
export class UpdateProductDiscountStatusDto {
  @ApiProperty({ enum: RecordStatus })
  @IsEnum(RecordStatus)
  status!: RecordStatus;
}

/** `PATCH /flash-sales/:id` — status only. */
export class UpdateFlashSaleStatusDto {
  @ApiProperty({ enum: RecordStatus })
  @IsEnum(RecordStatus)
  status!: RecordStatus;
}
