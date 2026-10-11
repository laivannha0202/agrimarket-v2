import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ArrayMaxSize } from 'class-validator';
import { ReturnRequestStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateReturnRequestDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  orderItemId!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiProperty({ example: 'Hàng bị hư hỏng trong quá trình vận chuyển' })
  @IsString()
  reason!: string;

  /**
   * Ids returned by `POST /evidence`.
   *
   * Optional. Each id must be an unbound upload owned by this customer; the
   * service rejects anything else rather than attaching it.
   */
  @ApiPropertyOptional({
    type: [Number],
    example: [21, 22],
    description: 'Evidence image ids from POST /evidence (max 5)',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @ArrayMaxSize(5)
  evidenceIds?: number[];
}

export class UpdateReturnRequestDto {
  @ApiProperty({ enum: ReturnRequestStatus })
  @IsEnum(ReturnRequestStatus)
  status!: ReturnRequestStatus;

  @ApiPropertyOptional({ description: 'Set when moving to REFUNDED' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  refundId?: number;
}

/** Query DTO for `GET /returns` (admin): strict return-status enum. */
export class ReturnQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReturnRequestStatus })
  @IsOptional()
  @IsEnum(ReturnRequestStatus)
  declare status?: ReturnRequestStatus;
}

/**
 * Query DTO for `GET /returns/me` (customer). The status filter is validated
 * against the real enum so an unknown value is a 400 instead of being ignored,
 * and `meta.total` counts exactly the filtered rows.
 */
export class MyReturnQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReturnRequestStatus })
  @IsOptional()
  @IsEnum(ReturnRequestStatus)
  declare status?: ReturnRequestStatus;
}
