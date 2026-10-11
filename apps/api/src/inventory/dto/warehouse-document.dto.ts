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
