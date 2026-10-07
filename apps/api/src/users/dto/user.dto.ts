import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole, UserStatus } from '../../../generated/prisma/enums.js';

export class CreateUserDto {
  @ApiProperty({ example: 'khachhang@agrimarket.vn' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'MatKhau@123' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: 'Trần Văn An' })
  @IsString()
  fullName!: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.CUSTOMER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Nguyễn Thị Lan' })
  @IsString()
  recipientName!: string;

  @ApiProperty({ example: '0912345678' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: 'Hưng Yên' })
  @IsString()
  province!: string;

  @ApiPropertyOptional({ example: 'Văn Lâm' })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({ example: 'Tân Quang' })
  @IsOptional()
  @IsString()
  ward?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  village?: string;

  @ApiProperty({ example: 'Số 12, đường Nguyễn Văn Linh' })
  @IsString()
  detail!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isDefault?: boolean;
}
