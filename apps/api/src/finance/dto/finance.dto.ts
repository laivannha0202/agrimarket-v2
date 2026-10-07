import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCommissionRuleDto {
  @ApiPropertyOptional({ example: 1, description: 'Null = applies to all partners' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  partnerId?: number;

  @ApiPropertyOptional({ example: 1, description: 'Null = applies to all categories' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ratePercent!: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class CreateSettlementDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  partnerId!: number;

  @ApiProperty({ example: '2026-04-01T00:00:00.000Z' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-04-30T23:59:59.000Z' })
  @IsDateString()
  periodEnd!: string;

  @ApiPropertyOptional({ example: 0, description: 'Manual adjustment (can be negative)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  adjustmentAmount?: number;
}

export class CreatePayoutDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  settlementId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;
}
