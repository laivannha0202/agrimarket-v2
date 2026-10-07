import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { FarmingEventType } from '../../../generated/prisma/enums.js';

export class CreateFarmingEventDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  seasonId!: number;

  @ApiProperty({ enum: FarmingEventType, example: FarmingEventType.WATERING })
  @IsEnum(FarmingEventType)
  type!: FarmingEventType;

  @ApiProperty({ example: '2026-02-01T07:30:00.000Z' })
  @IsDateString()
  occurredAt!: string;

  @ApiProperty({ example: 'Tưới nước nhỏ giọt 30 phút buổi sáng' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
