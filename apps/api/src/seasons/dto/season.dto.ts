import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SeasonStatus } from '../../../generated/prisma/enums.js';

export class CreateSeasonDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  farmId!: number;

  @ApiProperty({ example: 'Cà chua bi' })
  @IsString()
  @MaxLength(150)
  cropName!: string;

  @ApiPropertyOptional({ example: 'Cà chua bi đỏ F1' })
  @IsOptional()
  @IsString()
  variety?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  plantingDate?: string;

  @ApiPropertyOptional({ example: '2026-04-10' })
  @IsOptional()
  @IsDateString()
  expectedHarvestDate?: string;

  @ApiPropertyOptional({ example: 8.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedYield?: number;

  @ApiPropertyOptional({ example: 'tấn' })
  @IsOptional()
  @IsString()
  yieldUnit?: string;

  @ApiPropertyOptional({ enum: SeasonStatus })
  @IsOptional()
  @IsEnum(SeasonStatus)
  status?: SeasonStatus;
}

export class UpdateSeasonDto extends CreateSeasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  declare farmId: number;

  @ApiPropertyOptional()
  @IsOptional()
  declare cropName: string;
}
