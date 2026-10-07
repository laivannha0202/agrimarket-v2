import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { QcResult } from '../../../generated/prisma/enums.js';

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
