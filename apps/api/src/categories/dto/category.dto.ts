import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { RecordStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Rau ăn lá' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    example: 'rau-an-la',
    description: 'Đường dẫn danh mục. Bỏ trống để tự tạo từ tên danh mục.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  slug?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

/** Query DTO for `GET /categories`: real `search` plus a strict status enum. */
export class CategoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  declare status?: RecordStatus;
}
