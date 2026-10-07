import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ReturnRequestStatus } from '../../../generated/prisma/enums.js';

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
