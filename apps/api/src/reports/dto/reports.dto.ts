import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional } from 'class-validator';

export class ReportsSummaryQueryDto {
  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    enum: [7, 30],
    description: 'Window length when from/to are omitted (same meaning as /reports/daily)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30])
  days?: number;
}

/**
 * Query for `GET /reports/daily`.
 *
 * Either an explicit `from`/`to` ISO window, or a `days` shortcut (7 or 30)
 * ending on today's Vietnam day. The series is always bucketed by the Vietnam
 * calendar day and zero-filled, so the chart never has holes.
 */
export class ReportsDailyQueryDto {
  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: [7, 30], description: 'Window length when from/to are omitted' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30])
  days?: number;
}

/**
 * Query for `GET /reports/export`.
 *
 * `format` is required and strictly `xlsx` or `pdf` — an unknown value is a 400
 * rather than a silent fallback, so a broken link cannot download the wrong
 * file type. The window fields mirror the summary/daily endpoints so the file
 * always covers the period shown on screen.
 */
export class ReportsExportQueryDto {
  @ApiProperty({ enum: ['xlsx', 'pdf'], description: 'Real file format to produce' })
  @IsIn(['xlsx', 'pdf'])
  format!: 'xlsx' | 'pdf';

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: [7, 30], description: 'Window length when from/to are omitted' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30])
  days?: number;
}
