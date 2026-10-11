import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, ArrayMaxSize } from 'class-validator';
import { ComplaintStatus, ComplaintType } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateComplaintDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  orderId!: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  orderItemId?: number;

  @ApiProperty({ enum: ComplaintType })
  @IsEnum(ComplaintType)
  type!: ComplaintType;

  @ApiProperty({ example: 'Rau bị dập nhiều, không đúng chất lượng quảng cáo.' })
  @IsString()
  content!: string;

  /**
   * Ids returned by `POST /evidence`.
   *
   * Optional — a complaint without a photo is still valid. The service verifies
   * each id is an unbound upload owned by this customer before attaching it.
   */
  @ApiPropertyOptional({
    type: [Number],
    example: [7],
    description: 'Evidence image ids from POST /evidence (max 5)',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @ArrayMaxSize(5)
  evidenceIds?: number[];
}

export class UpdateComplaintDto {
  @ApiProperty({ enum: ComplaintStatus })
  @IsEnum(ComplaintStatus)
  status!: ComplaintStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolution?: string;
}

/** Query DTO for `GET /complaints` (admin): strict complaint-status enum. */
export class ComplaintQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  declare status?: ComplaintStatus;
}

/**
 * Query DTO for `GET /complaints/me` (customer). The status filter is validated
 * against the real enum, so an unknown value is a 400 instead of being ignored.
 */
export class MyComplaintQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  declare status?: ComplaintStatus;
}
