import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';import { RecordStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ProductVariantDto {
  @ApiProperty({ example: 'CCB-500G' })
  @IsString()
  sku!: string;

  @ApiProperty({ example: 'Gói 500 g' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ example: 'g' })
  @IsOptional()
  @IsString()
  weightUnit?: string;

  @ApiProperty({ example: 'gói' })
  @IsString()
  saleUnit!: string;

  @ApiProperty({ example: 32000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ProductImageDto {
  @ApiProperty({ example: 'http://localhost:3000/uploads/products/ca-chua-bi-do-1.webp' })
  @IsString()
  url!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateProductDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  partnerId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  categoryId!: number;

  @ApiPropertyOptional({ description: 'Optional marketing farm; real lot origin is via ProductLot' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  farmId?: number;

  @ApiProperty({ example: 'Cà chua bi đỏ' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    example: 'ca-chua-bi-do',
    description: 'Đường dẫn sản phẩm. Bỏ trống để tự tạo từ tên sản phẩm.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @ApiPropertyOptional({ type: [ProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({ type: [ProductImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  farmId?: number;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class CreateVariantDto extends ProductVariantDto {}

/**
 * What an admin may change on an existing sale variant.
 *
 * `sku` is the variant's identity and `weight`/`weightUnit`/`saleUnit` define
 * its unit conversion — all immutable once the variant exists, because past
 * orders, stock balances and lot quantities reference them. Only the display
 * name, the price for NEW orders, and the sale status may change; order
 * snapshots keep the price that was actually charged.
 */
export class UpdateVariantDto {
  @ApiPropertyOptional({ example: 'Gói 500 g' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 32000, description: 'Giá mới cho đơn hàng mới; đơn cũ giữ giá snapshot' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({ enum: RecordStatus, description: 'INACTIVE ngừng bán quy cách trên đơn mới' })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class ReorderImagesDto {
  @ApiProperty({ example: [12, 9, 15] })
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  orderedIds!: number[];
}

/**
 * Query DTO for `GET /products`. Extends the shared pagination base with the
 * category/partner filters and a strict status enum so an unknown status is
 * rejected with a 400 instead of reaching Prisma.
 */
export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  declare status?: RecordStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partnerId?: number;
}
