import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ComplaintStatus, ComplaintType } from '../../../generated/prisma/enums.js';

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
