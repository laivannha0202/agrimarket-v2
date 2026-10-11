import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PayoutStatus, RecordStatus, SettlementStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

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

/**
 * Query DTO for `GET /settlements`. The strict enum is the point: previously
 * an unknown status reached Prisma and surfaced as a 500.
 */
export class SettlementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  declare status?: SettlementStatus;
}

/** Query DTO for `GET /payouts` — strict enum, unknown status → 400. */
export class PayoutQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsEnum(PayoutStatus)
  declare status?: PayoutStatus;
}

/** Query DTO for `GET /commission-rules` — strict record-status enum. */
export class CommissionRuleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  declare status?: RecordStatus;
}

/**
 * `PATCH /commission-rules/:id`. Only the record status is editable: the rate
 * and effective window are the inputs to commission already recorded on past
 * orders, so changing them would silently re-price settled history.
 */
export class UpdateCommissionRuleStatusDto {
  @ApiProperty({ enum: RecordStatus })
  @IsEnum(RecordStatus)
  status!: RecordStatus;
}

/**
 * Query for `GET /settlements/:id/export`.
 *
 * `format` is required and strictly `xlsx` or `pdf`, matching
 * `/reports/export`, so a wrong link cannot silently produce the wrong file.
 */
export class SettlementExportQueryDto {
  @ApiProperty({ enum: ['xlsx', 'pdf'], description: 'Real file format to produce' })
  @IsIn(['xlsx', 'pdf'])
  format!: 'xlsx' | 'pdf';
}
