import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ShipmentStatus } from '../../../generated/prisma/enums.js';

export class CreateShipmentDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  partnerOrderId!: number;

  @ApiPropertyOptional({ example: 'GHN' })
  @IsOptional()
  @IsString()
  carrier?: string;

  @ApiPropertyOptional({ example: 'GHN123456789' })
  @IsOptional()
  @IsString()
  trackingCode?: string;
}

export class UpdateShipmentStatusDto {
  @ApiProperty({ enum: ShipmentStatus })
  @IsEnum(ShipmentStatus)
  status!: ShipmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 'Khách không nhận hàng' })
  @IsOptional()
  @IsString()
  failureReason?: string;
}
