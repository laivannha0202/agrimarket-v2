import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateHarvestDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  seasonId!: number;

  @ApiProperty({ example: '2026-04-12' })
  @IsDateString()
  harvestDate!: string;

  @ApiProperty({ example: 1200.5, minimum: 0.001 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiProperty({ example: 'kg', maxLength: 30 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;

  @ApiProperty({ example: 'Loại 1', maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  grade!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UpdateHarvestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  harvestDate?: string;

  @ApiPropertyOptional({ minimum: 0.001 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  grade?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
