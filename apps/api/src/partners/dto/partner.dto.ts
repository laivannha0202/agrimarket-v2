import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RecordStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreatePartnerDto {
  @ApiProperty({ example: 'HTX Rau quả Minh Châu' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'Nguyễn Văn Minh' })
  @IsString()
  @MaxLength(150)
  representativeName!: string;

  @ApiProperty({ example: '0987654321' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'minhchau@agrimarket.vn' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Thôn Đa Hòa, xã Minh Châu, Hưng Yên' })
  @IsString()
  address!: string;

  @ApiPropertyOptional({ example: '0900123456' })
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ enum: RecordStatus, default: RecordStatus.ACTIVE })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representativeName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

/** Query DTO for `GET /partners`: strict status enum (400 on unknown values). */
export class PartnerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  declare status?: RecordStatus;
}

/**
 * Public (sanitised) partner projection returned by anonymous/customer reads.
 *
 * This is the complete public contract. Tax and bank fields deliberately do not
 * appear here, and the service selects exactly these columns — sensitive values
 * are never loaded into the process for a public request.
 */
export class PartnerPublicResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'PARTNER-0001' })
  code!: string;

  @ApiProperty({ example: 'HTX Rau quả Minh Châu' })
  name!: string;

  @ApiProperty({ example: 'Nguyễn Văn Minh' })
  representativeName!: string;

  @ApiProperty({ example: '0987654321' })
  phone!: string;

  @ApiProperty({ example: 'minhchau@agrimarket.vn' })
  email!: string;

  @ApiProperty({ example: 'Thôn Đa Hòa, xã Minh Châu, Hưng Yên' })
  address!: string;

  @ApiProperty({ enum: RecordStatus })
  status!: RecordStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
