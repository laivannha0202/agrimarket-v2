import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import { PartnerType, PartnerVerificationStatus, RecordStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreatePartnerDto {
  @ApiProperty({ enum: PartnerType })
  @IsEnum(PartnerType)
  type!: PartnerType;

  @ApiProperty({ example: 'HTX Rau quả Minh Châu' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn Minh' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  representativeName?: string;

  @ApiProperty({ example: '0987654321' })
  @IsString()
  @Matches(/^\+?[0-9][0-9\s.-]{7,19}$/, { message: 'Số điện thoại không hợp lệ.' })
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: 'minhchau@agrimarket.vn' })
  @IsOptional()
  @IsEmail()
  @MaxLength(191)
  email?: string;

  @ApiPropertyOptional({ example: 'Thôn Đa Hòa, xã Minh Châu, Hưng Yên' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  address?: string;

  @ApiPropertyOptional({ example: '0900123456' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  taxCode?: string;

  @ApiPropertyOptional({ description: 'HTTPS document link' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Đường dẫn giấy tờ phải là HTTPS.' })
  @MaxLength(1000)
  registrationDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  bankAccountName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  bankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  bankName?: string;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ enum: PartnerType })
  @IsOptional()
  @IsEnum(PartnerType)
  type?: PartnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  representativeName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9][0-9\s.-]{7,19}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(191)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  taxCode?: string;

  @ApiPropertyOptional({ description: 'HTTPS document link' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Đường dẫn giấy tờ phải là HTTPS.' })
  @MaxLength(1000)
  registrationDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  bankAccountName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  bankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  bankName?: string;
}

export class PartnerVerificationDto {
  @ApiProperty({ enum: PartnerVerificationStatus })
  @IsEnum(PartnerVerificationStatus)
  verificationStatus!: PartnerVerificationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PartnerBusinessStatusDto {
  @ApiProperty({ enum: RecordStatus })
  @IsEnum(RecordStatus)
  status!: RecordStatus;

  @ApiProperty({ description: 'Reason for business status change' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** Query DTO for `GET /partners`: strict status enum (400 on unknown values). */
export class PartnerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  declare status?: RecordStatus;

  @ApiPropertyOptional({ enum: PartnerType })
  @IsOptional()
  @IsEnum(PartnerType)
  type?: PartnerType;

  @ApiPropertyOptional({ enum: PartnerVerificationStatus })
  @IsOptional()
  @IsEnum(PartnerVerificationStatus)
  verificationStatus?: PartnerVerificationStatus;
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
  representativeName!: string | null;

  @ApiProperty({ example: '0987654321' })
  phone!: string;

  @ApiProperty({ example: 'minhchau@agrimarket.vn' })
  email!: string | null;

  @ApiProperty({ example: 'Thôn Đa Hòa, xã Minh Châu, Hưng Yên' })
  address!: string | null;

  @ApiProperty({ enum: RecordStatus })
  status!: RecordStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
