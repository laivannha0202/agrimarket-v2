import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

export class UpdateCartItemDto {
  @ApiPropertyOptional({ example: 3 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;
}
