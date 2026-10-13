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
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WarehouseDocumentStatus,
  WarehouseDocumentType,
} from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class WarehouseDocumentLineDto {
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

  @ApiProperty({ example: 'kg' })
  @IsString()
  unit!: string;
}

export class CreateWarehouseDocumentDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  warehouseId!: number;

  @ApiProperty({ enum: WarehouseDocumentType })
  @IsEnum(WarehouseDocumentType)
  type!: WarehouseDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sourceId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: [WarehouseDocumentLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WarehouseDocumentLineDto)
  lines!: WarehouseDocumentLineDto[];
}

/**
 * Edit a DRAFT document (ADMIN).
 *
 * Only drafts may be edited: a COMPLETED/CANCELLED document is immutable and
 * must be corrected through a controlled adjustment document instead. The
 * warehouse, type and source linkage never change here — editing must not
 * rewrite the business origin of the document. Lines are replaced wholesale
 * (validated like creation: lot/variant exist, quantity positive, no duplicate
 * lot+variant pair), so the draft always holds a coherent set.
 */
export class UpdateWarehouseDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ type: [WarehouseDocumentLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WarehouseDocumentLineDto)
  lines?: WarehouseDocumentLineDto[];
}

/** Query DTO for `GET /warehouse-documents`: strict status/type enums. */
export class WarehouseDocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WarehouseDocumentStatus })
  @IsOptional()
  @IsEnum(WarehouseDocumentStatus)
  declare status?: WarehouseDocumentStatus;

  @ApiPropertyOptional({ enum: WarehouseDocumentType })
  @IsOptional()
  @IsEnum(WarehouseDocumentType)
  type?: WarehouseDocumentType;
}
