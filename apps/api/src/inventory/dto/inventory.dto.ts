import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { InventoryMovementType } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class AdjustInventoryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  warehouseId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productLotId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: -5, description: 'Signed delta; must not drive stock negative' })
  @Type(() => Number)
  @IsNumber()
  quantityDelta!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class InboundInventoryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  warehouseId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productLotId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReserveInventoryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  warehouseId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productLotId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional({ enum: InventoryMovementType })
  @IsOptional()
  @IsEnum(InventoryMovementType)
  type?: InventoryMovementType;
}

/**
 * Query DTO for `GET /inventory`: filter balances by warehouse/variant.
 *
 * `status` and `search` are omitted because an inventory balance has no status
 * of its own (the lot does) and the service does not search; advertising them
 * would let callers send parameters that are silently ignored.
 */
export class InventoryQueryDto extends OmitType(PaginationQueryDto, ['status', 'search'] as const) {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productVariantId?: number;
}

/**
 * Query DTO for `GET /inventory/movements`: filter by lot.
 *
 * The ledger is append-only with no status column and is not searched, so
 * `status`/`search` are omitted rather than advertised as no-ops.
 */
export class InventoryMovementQueryDto extends OmitType(PaginationQueryDto, [
  'status',
  'search',
] as const) {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productLotId?: number;
}
