import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import {
  CertificateVerificationStatus,
  RecordStatus,
} from '../../../generated/prisma/enums.js';

export class CreateCertificateDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  farmId!: number;

  @ApiProperty({ example: 'VietGAP' })
  @IsString()
  type!: string;

  @ApiProperty({ example: 'VG-HY-2026-014' })
  @IsString()
  certificateCode!: string;

  @ApiProperty({ example: 'Trung tâm Kiểm định Hưng Yên' })
  @IsString()
  issuer!: string;

  @ApiProperty({ example: '2026-01-05' })
  @IsDateString()
  issuedAt!: string;

  @ApiProperty({ example: '2027-01-04' })
  @IsDateString()
  expiresAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileUrl?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class VerifyCertificateDto {
  @ApiProperty({ enum: CertificateVerificationStatus, example: CertificateVerificationStatus.VERIFIED })
  @IsEnum(CertificateVerificationStatus)
  verificationStatus!: CertificateVerificationStatus;

  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
