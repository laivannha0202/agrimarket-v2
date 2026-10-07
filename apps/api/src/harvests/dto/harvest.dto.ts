import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateHarvestDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  seasonId!: number;

  @ApiProperty({ example: '2026-04-12' })
  @IsDateString()
  harvestDate!: string;

  @ApiProperty({ example: 1200.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiProperty({ example: 'kg' })
  @IsString()
  unit!: string;

  @ApiProperty({ example: 'Loại 1' })
  @IsString()
  grade!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateHarvestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  harvestDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
