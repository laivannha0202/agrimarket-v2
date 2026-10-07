import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RecordStatus } from '../../../generated/prisma/enums.js';

export class CreateWarehouseDto {
  @ApiProperty({ example: 'Kho trung tâm Hưng Yên' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'KCN Phố Nối A, Văn Lâm, Hưng Yên' })
  @IsString()
  address!: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
