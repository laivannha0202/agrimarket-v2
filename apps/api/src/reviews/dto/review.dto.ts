import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReviewStatus } from '../../../generated/prisma/enums.js';

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
}

export class UpdateReviewStatusDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status!: ReviewStatus;
}
