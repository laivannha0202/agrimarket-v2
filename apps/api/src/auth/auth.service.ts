import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { normalizeVietnamesePhone } from '../common/utils/phone.util.js';
import { passwordVersion } from './password-version.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';
import type { ChangePasswordDto, ForgotPasswordDto, RegisterDto, ResetPasswordDto } from './dto/account.dto.js';

/** bcrypt cost. Matches the cost already used by `UsersService.create`. */
const BCRYPT_ROUNDS = 10;

/**
 * How long a password-reset token stays valid.
 *
 * One hour is long enough to open a mail on a phone and short enough that a
 * leaked link is not a durable key to the account.
 */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * The exact response `forgotPassword` returns, whatever happens.
 *
 * It is a module-level constant so every exit path returns the same object —
 * a caller cannot distinguish "account exists and mail was sent" from "no such
 * account" by comparing responses. That is what stops the endpoint from being
 * used to enumerate registered e-mail addresses.
 */
const FORGOT_PASSWORD_RESPONSE = {
  message:
    'Nếu email này có tài khoản AgriMarket, chúng tôi đã gửi liên kết đặt lại mật khẩu.',
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async validateCredentials(email: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.findActiveUser(email, password);
    return toAuthenticatedUser(user);
  }

  async login(email: string, password: string) {
    const user = await this.findActiveUser(email, password);
    // `pwd` carries the account's password version, so the token can be tied to
    // the exact password it was issued for (see `JwtStrategy`).
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      pwd: passwordVersion(user.passwordChangedAt),
    });
    return { accessToken, user: toAuthenticatedUser(user) };
  }

  /** Looks up an ACTIVE account and verifies the password, or throws a 401. */
  private async findActiveUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  async me(userId: number): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
    };
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Public self-registration.
   *
   * The role is hardcoded to CUSTOMER: the request DTO has no role field at all,
   * and the global `ValidationPipe` rejects unknown properties, so a payload
   * carrying `role: "ADMIN"` is answered with a 400 instead of being ignored.
   *
   * The `User` and its `CustomerProfile` are created in ONE transaction: a
   * profile-less customer could not own a cart or an address, so a half-created
   * account must not be observable.
   *
   * A duplicate e-mail is caught from the unique index rather than a prior read
   * (see `createUser`), so two simultaneous registrations of the same address
   * cannot both succeed.
   */
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const phone = normalizeVietnamesePhone(dto.phone);
    if (!phone) {
      throw new BadRequestException('Số điện thoại chưa hợp lệ');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const created = await this.createUserOrConflict({
      email,
      passwordHash,
      fullName: dto.fullName.trim(),
      phone,
    });

    await this.audit.record({
      actorUserId: created.id,
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: String(created.id),
      // The password and its hash are never written to the audit trail.
      afterJson: { email: created.email, role: created.role },
    });

    // No session is issued: the customer signs in on the login screen. One
    // consistent flow for Web and Mobile, and it keeps "register" from being a
    // way to obtain a token without ever proving the address is reachable.
    return {
      id: created.id,
      email: created.email,
      fullName: created.fullName,
      role: created.role,
    };
  }

  /**
   * Creates the user, translating a unique-constraint violation into a 409.
   *
   * Relying on the database constraint (instead of "check then insert") is what
   * makes concurrent registration safe: only one of two racing inserts can win,
   * and the loser gets the same error a sequential duplicate would.
   */
  private async createUserOrConflict(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) =>
        tx.user.create({
          data: {
            email: input.email,
            passwordHash: input.passwordHash,
            fullName: input.fullName,
            phone: input.phone,
            role: 'CUSTOMER',
            status: 'ACTIVE',
            customerProfile: { create: {} },
          },
          select: { id: true, email: true, fullName: true, role: true },
        }),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Email này đã được đăng ký');
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Change password (authenticated)
  // -------------------------------------------------------------------------

  /**
   * Changes the password of the signed-in user.
   *
   * The current password is re-verified server-side: a stolen token alone must
   * not be enough to lock the owner out of their own account.
   *
   * On success `passwordChangedAt` is stamped, which invalidates every token
   * issued earlier (see `JwtStrategy`). A fresh token is returned so the caller
   * can stay signed in on the device that made the change, while every other
   * device is signed out.
   */
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Mật khẩu hiện tại chưa đúng');

    const sameAsOld = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (sameAsOld) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const changedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: changedAt },
      });
      // Any outstanding recovery link is void once the password is known.
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: changedAt },
      });
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: String(userId),
      // Only the fact of the change is recorded — never a password or a hash.
      afterJson: { changedAt: changedAt.toISOString() },
    });

    // The fresh token carries the NEW password version, so it survives the
    // change it was issued by while every earlier token stops matching.
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      pwd: passwordVersion(changedAt),
    });

    return { accessToken };
  }

  // -------------------------------------------------------------------------
  // Password recovery
  // -------------------------------------------------------------------------

  /**
   * Starts password recovery.
   *
   * The response is IDENTICAL whether or not the address is registered, so the
   * endpoint cannot be used to discover which e-mails have accounts. Work is
   * only done for a real, active account.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.status !== 'ACTIVE') {
      // Same response, same shape, no mail. Nothing distinguishes this branch.
      return { ...FORGOT_PASSWORD_RESPONSE, delivery: this.deliveryInfo() };
    }

    // 32 random bytes: far beyond guessing, and the value is only ever stored
    // as a SHA-256 hash.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Supersede any earlier unused link so only the newest one works.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
    });

    const resetUrl = `${this.customerWebUrl()}/dat-lai-mat-khau?token=${encodeURIComponent(rawToken)}`;

    try {
      await this.mail.send({
        to: user.email,
        subject: 'Đặt lại mật khẩu AgriMarket',
        text: [
          `Xin chào ${user.fullName},`,
          '',
          'Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản AgriMarket này.',
          'Mở liên kết dưới đây để đặt mật khẩu mới:',
          '',
          resetUrl,
          '',
          'Liên kết chỉ dùng được một lần và hết hạn sau 60 phút.',
          'Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.',
        ].join('\n'),
      });
    } catch {
      // A delivery failure is logged by MailService without the token, and the
      // caller still receives the neutral response: telling the client that
      // delivery failed would leak that the account exists.
      this.logger.warn('Password recovery mail could not be delivered');
    }

    await this.audit.record({
      actorUserId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: String(user.id),
      // The token (and its hash) is deliberately NOT audited.
      afterJson: { expiresAt: expiresAt.toISOString() },
    });

    return { ...FORGOT_PASSWORD_RESPONSE, delivery: this.deliveryInfo() };
  }

  /**
   * Completes recovery with a token from the e-mail.
   *
   * The token is consumed in the same transaction that writes the new password,
   * and the update is conditional on `usedAt: null`, so two simultaneous
   * submissions of the same link cannot both succeed — the loser sees the same
   * "invalid or expired" error a reused token would produce.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = hashResetToken(dto.token.trim());
    const now = new Date();

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, status: true, email: true, role: true } } },
    });

    if (!record || record.usedAt !== null || record.expiresAt <= now) {
      throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    }
    if (record.user.status !== 'ACTIVE') {
      throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      // Claim the token first. `count === 0` means another request already used
      // it between the read above and here.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
        );
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: now },
      });

      // Every other outstanding link for this account is void too.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
    });

    await this.audit.record({
      actorUserId: record.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: String(record.userId),
      afterJson: { resetAt: now.toISOString() },
    });

    // The customer is sent to the login screen and signs in with the new
    // password — the same single flow used after registration.
    return { message: 'Mật khẩu đã được đặt lại. Vui lòng đăng nhập lại.' };
  }

  /** Reports whether recovery mail is really delivered, or only captured. */
  private deliveryInfo() {
    return {
      mode: this.mail.mode,
      delivered: this.mail.isRealDelivery,
    };
  }

  private customerWebUrl(): string {
    return (this.config.get<string>('customerWebUrl') ?? 'http://localhost:3002').replace(
      /\/+$/,
      '',
    );
  }
}

/**
 * SHA-256 of a reset token.
 *
 * A fast hash is correct here (unlike for passwords): the token is 32 random
 * bytes, so there is no dictionary to attack, and lookup must stay cheap.
 */
export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Maps a user row onto the request-scoped identity. */
function toAuthenticatedUser(user: {
  id: number;
  email: string;
  role: 'ADMIN' | 'CUSTOMER';
  fullName: string;
  phone: string | null;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    phone: user.phone,
  };
}

/**
 * True for Prisma's unique-constraint violation (P2002).
 *
 * Checked structurally rather than with `instanceof` so it also works for the
 * error shape that crosses a transaction boundary.
 */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
