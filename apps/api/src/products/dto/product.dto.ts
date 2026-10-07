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
} from 'class-validator';
import { RecordStatus } from '../../../generated/prisma/enums.js';

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
  @ApiProperty({ example: 'https://cdn.agrimarket.vn/products/ca-chua-bi.jpg' })
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

  @ApiProperty({ example: 'ca-chua-bi-do' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  slug!: string;

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
