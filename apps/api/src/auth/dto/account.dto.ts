import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Shared password policy.
 *
 * Deliberately a single exported constant so the API, the Customer Web form and
 * the Mobile form enforce the SAME rule — a password the API accepts must never
 * be rejected by a client-side check, and vice versa.
 *
 * The rule is length-based (10 characters) plus a light composition check,
 * which is what actually resists guessing; it deliberately does not demand
 * symbols, because that pushes people towards predictable substitutions.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

/**
 * At least one letter and one digit. Applied after the length check so the
 * message a customer sees names the real problem.
 */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_PATTERN_MESSAGE =
  'Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số';

/** Trims a string value; `undefined`/`null` pass through untouched. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Normalises an e-mail the same way `AuthService` does before every lookup.
 *
 * Lower-casing here (not only at the database) is what makes
 * `Khach@Example.com` and `khach@example.com` the same account for the unique
 * constraint and for login.
 */
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'khachhang@agrimarket.vn' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Email chưa hợp lệ' })
  @MaxLength(180)
  email!: string;

  @ApiProperty({
    example: 'MatKhau@12345',
    minLength: PASSWORD_MIN_LENGTH,
    description: `Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự, có chữ và số.`,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_PATTERN_MESSAGE })
  password!: string;

  @ApiProperty({ example: 'Trần Văn An' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Vui lòng nhập họ và tên' })
  @MaxLength(120)
  fullName!: string;

  /**
   * Vietnamese mobile number. Accepted in local (`0912345678`) or
   * international (`+84912345678`) form; `AuthService` normalises it to the
   * local 10-digit form before storing.
   */
  @ApiProperty({ example: '0912345678' })
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone!: string;

  /**
   * There is deliberately NO `role` / `status` field.
   *
   * The global ValidationPipe runs with `forbidNonWhitelisted: true`, so a
   * request carrying `role: "ADMIN"` is rejected with a 400 rather than being
   * silently ignored — self-promotion to ADMIN is not merely unhandled, it is
   * unrepresentable.
   */
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'MatKhau@12345' })
  @IsString()
  @MinLength(1, { message: 'Vui lòng nhập mật khẩu hiện tại' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({ example: 'MatKhauMoi@67890', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Mật khẩu mới phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_PATTERN_MESSAGE })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'khachhang@agrimarket.vn' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Email chưa hợp lệ' })
  @MaxLength(180)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token từ liên kết trong email khôi phục.' })
  @IsString()
  @MinLength(16, { message: 'Liên kết khôi phục không hợp lệ' })
  @MaxLength(200)
  token!: string;

  @ApiProperty({ example: 'MatKhauMoi@67890', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Mật khẩu mới phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_PATTERN_MESSAGE })
  newPassword!: string;
}
