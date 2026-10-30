import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  @ApiProperty({ example: 'Tưới nước nhỏ giọt 30 phút buổi sáng', maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * Correcting a farming log is allowed (wrong timestamp/content happens), but the
 * event keeps its season: moving an event between seasons would rewrite two
 * trace chains at once.
 */
export class UpdateFarmingEventDto {
  @ApiPropertyOptional({ enum: FarmingEventType })
  @IsOptional()
  @IsEnum(FarmingEventType)
  type?: FarmingEventType;

  @ApiPropertyOptional({ example: '2026-02-01T07:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
