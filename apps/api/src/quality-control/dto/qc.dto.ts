import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { QcResult } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreateQcInspectionDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productLotId!: number;

  @ApiProperty({ enum: QcResult, example: QcResult.PASS })
  @IsEnum(QcResult)
  result!: QcResult;

  @ApiProperty({ example: true })
  @IsBoolean()
  appearancePassed!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  freshnessPassed!: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  packagingPassed?: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  damagePassed!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Query DTO for `GET /qc`: filter by the inspected lot.
 *
 * `status` and `search` are omitted because a QC inspection has no status of
 * its own (the lot does) and the service does not search; advertising them
 * would let callers send parameters that are silently ignored.
 */
export class QcQueryDto extends OmitType(PaginationQueryDto, ['status', 'search'] as const) {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productLotId?: number;
}
