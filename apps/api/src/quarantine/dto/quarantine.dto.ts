import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { QcResult, QuarantineCaseStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

/** `GET /quarantine-cases` (ADMIN): strict status filter. */
export class QuarantineQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: QuarantineCaseStatus })
  @IsOptional()
  @IsEnum(QuarantineCaseStatus)
  declare status?: QuarantineCaseStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  warehouseId?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  returnRequestId?: number;
}

/**
 * Record the re-inspection result. PASS only makes the case eligible for
 * release; FAIL only makes it eligible for scrap. Neither changes stock.
 */
export class InspectQuarantineDto {
  @ApiProperty({ enum: QcResult })
  @IsEnum(QcResult)
  result!: QcResult;

  @ApiPropertyOptional({
    description: 'Required when result = FAIL; stored as the inspection basis',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Resolve a PASSED case (RELEASE back to sellable) or a FAILED case (SCRAP).
 * The action is validated against the case status in the service; stock is
 * only moved here, never automatically.
 */
export class ResolveQuarantineDto {
  @ApiProperty({ enum: ['RELEASE', 'SCRAP'] })
  @IsIn(['RELEASE', 'SCRAP'])
  action!: 'RELEASE' | 'SCRAP';

  @ApiPropertyOptional({ description: 'Operator note stored on the case' })
  @IsOptional()
  @IsString()
  note?: string;
}
