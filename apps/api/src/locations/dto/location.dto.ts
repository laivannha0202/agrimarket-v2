import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Hard cap on how many communes one call may return.
 *
 * The whole Hưng Yên catalogue is 104 rows and the address picker deliberately
 * loads all of them in a single request, then filters locally (which is why
 * there is no per-keystroke request). The cap therefore has to sit ABOVE 104:
 * the generic `MAX_PAGE_LIMIT` of 100 would silently truncate the list and
 * leave the last few communes impossible to select in any client.
 */
export const MAX_WARD_LIMIT = 500;

/**
 * Query DTO for `GET /locations/provinces/:code/wards`.
 *
 * The default is the full catalogue, so a caller that does not paginate still
 * receives every commune of the province.
 */
export class WardQueryDto {
  @ApiPropertyOptional({
    example: 'pho hien',
    description:
      'Free-text search. Accents are optional: "pho hien" matches "Phường Phố Hiến".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: '1-based page number. `limit` is capped so one call can return the whole catalogue.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ example: 200, default: 200, maximum: MAX_WARD_LIMIT })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WARD_LIMIT)
  @IsOptional()
  limit: number = 200;
}

/** One province as returned to a client. */
export class ProvinceResponseDto {
  @ApiProperty({ example: '33' })
  code!: string;

  @ApiProperty({ example: 'Hưng Yên' })
  name!: string;

  @ApiProperty({ example: 'Tỉnh Hưng Yên' })
  fullName!: string;
}

/** One commune-level unit as returned to a client. */
export class WardResponseDto {
  @ApiProperty({ example: '11953', description: 'Official 5-digit code, always a string.' })
  code!: string;

  @ApiProperty({ example: 'Phường Phố Hiến', description: 'Official name with prefix — display this.' })
  fullName!: string;

  @ApiProperty({ example: 'Phố Hiến', description: 'Official name without the prefix.' })
  name!: string;

  @ApiProperty({ example: 'phuong', enum: ['xa', 'phuong'] })
  type!: string;

  @ApiProperty({ example: '33' })
  provinceCode!: string;

  @ApiProperty({ example: 'Hưng Yên' })
  provinceName!: string;

  @ApiProperty({ example: '2025-07-01' })
  effectiveFrom!: string | null;

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE'] })
  status!: string;
}
