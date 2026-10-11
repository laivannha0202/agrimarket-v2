import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min, ArrayMaxSize } from 'class-validator';
import { ReviewStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateReviewDto {
  @ApiProperty({ example: 1, description: 'The order item being reviewed (must be purchased)' })
  @Type(() => Number)
  @IsInt()
  orderItemId!: number;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Cà chua tươi, đóng gói cẩn thận, giao nhanh.' })
  @IsOptional()
  @IsString()
  content?: string;

  /**
   * Ids returned by `POST /evidence`, in display order.
   *
   * Optional: photos are a supplement to the review, not a requirement. Each id
   * must be an unbound upload belonging to this customer — the service enforces
   * that, so an id from another account is rejected rather than attached.
   */
  @ApiPropertyOptional({
    type: [Number],
    example: [12, 13],
    description: 'Evidence image ids from POST /evidence (max 5)',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @ArrayMaxSize(5)
  evidenceIds?: number[];
}

export class UpdateReviewStatusDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status!: ReviewStatus;
}

/** Query DTO for `GET /reviews` (admin): strict review-status enum. */
export class ReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  declare status?: ReviewStatus;
}
