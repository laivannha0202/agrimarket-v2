import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole, UserStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

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

/**
 * Address payload for `POST /customers/me/addresses`.
 *
 * TWO GENERATIONS, ONE DTO
 *
 * The new model (tỉnh → xã/phường, no huyện) is expressed by `provinceCode` +
 * `wardCode`. When `wardCode` is present the SERVER resolves the official name
 * from the verified catalogue and stores it in `wardName` — the client's own
 * spelling is never trusted, and an unknown code is rejected.
 *
 * `province` / `district` / `ward` remain accepted so an existing client (and a
 * legacy address being edited) keeps working; a request that carries only these
 * is treated as the old free-text form and is NOT silently reinterpreted.
 */
export class CreateAddressDto {
  @ApiProperty({ example: 'Nguyễn Thị Lan' })
  @IsString()
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '0912345678', description: 'Vietnamese mobile number.' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'Hưng Yên' })
  @IsString()
  @MaxLength(120)
  province!: string;

  @ApiPropertyOptional({
    example: '33',
    description: 'Official province code. Required together with `wardCode`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;

  @ApiPropertyOptional({
    example: '11953',
    description:
      'Official 5-digit commune code from `GET /locations/provinces/33/wards`. The display name is resolved server-side.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  wardCode?: string;

  @ApiPropertyOptional({ example: 'Văn Lâm', description: 'Legacy district text (pre-2025 model).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ example: 'Tân Quang', description: 'Legacy commune text (pre-2025 model).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ward?: string;

  @ApiPropertyOptional({ description: 'Thôn / tổ dân phố. Free text — no verified list exists.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  village?: string;

  @ApiProperty({ example: 'Số 12, đường Nguyễn Văn Linh' })
  @IsString()
  @MaxLength(255)
  detail!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isDefault?: boolean;
}

/** `PATCH /customers/me/addresses/:id` — every field optional, at least one. */
export class UpdateAddressDto {
  @ApiPropertyOptional({ example: 'Nguyễn Thị Lan' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'Hưng Yên' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @ApiPropertyOptional({ example: '33' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;

  @ApiPropertyOptional({ example: '11953' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  wardCode?: string;

  @ApiPropertyOptional({ example: 'Văn Lâm' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ example: 'Tân Quang' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ward?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  village?: string;

  @ApiPropertyOptional({ example: 'Số 12, đường Nguyễn Văn Linh' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  detail?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isDefault?: boolean;
}

/** `PATCH /customers/me` — own profile fields. Email/role are not editable here. */
export class UpdateMyProfileDto {
  @ApiPropertyOptional({ example: 'Trần Văn An' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  phone?: string;
}

/**
 * Query DTO for `GET /customers` (admin user list). Strict status/role enums
 * so an unknown value is rejected with a 400 instead of reaching Prisma.
 */
export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  declare status?: UserStatus;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
