import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductLotStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateLotDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  harvestId!: number;

  @ApiProperty({ example: 300 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiProperty({ example: 'kg' })
  @IsString()
  unit!: string;

  @ApiProperty({ example: 'Loại 1' })
  @IsString()
  grade!: string;

  @ApiProperty({ example: '2026-04-20' })
  @IsDateString()
  expiresAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  packedAt?: string;
}

export class RecallLotDto {
  @ApiProperty({ example: 'Phát hiện dư lượng thuốc bảo vệ thực vật vượt ngưỡng' })
  @IsString()
  reason!: string;
}

/** Query DTO for `GET /lots`: product filter plus a strict lot-status enum. */
export class LotQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProductLotStatus })
  @IsOptional()
  @IsEnum(ProductLotStatus)
  declare status?: ProductLotStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;
}
