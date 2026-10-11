import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { passwordVersion } from './password-version.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

export interface JwtPayload {
  sub: number;
  email: string;
  role: 'ADMIN' | 'CUSTOMER';
  /**
   * Password version the token was issued for — see `passwordVersion`.
   * Absent on tokens minted before this claim existed; those fall back to the
   * `iat` comparison below.
   */
  pwd?: number;
  /** Standard JWT issued-at, in seconds. Set automatically when signing. */
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwtSecret') ?? 'CHANGE_ME',
    });
  }

  /**
   * Validates the token on every authenticated request.
   *
   * The user row is re-read each time, which is what makes an account
   * deactivation take effect immediately rather than at token expiry.
   *
   * The password-version check is what actually ends a session after a password
   * change. A JWT is stateless — it cannot be deleted from a session store that
   * does not exist — so instead every token carrying a DIFFERENT password
   * version is refused. That signs out every device that was open when the
   * password changed, including an attacker's, while the device that made the
   * change keeps working with the fresh token it received.
   *
   * Comparing versions rather than timestamps matters: `iat` is truncated to
   * whole seconds, so a token issued in the same second as the change is
   * indistinguishable from the token the change issued. An exact version has no
   * such ambiguity, so there is no need for the fudge window an `iat`
   * comparison requires. Tokens minted before this claim existed have no `pwd`
   * and fall back to the `iat` comparison.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid token');
    }

    const currentVersion = passwordVersion(user.passwordChangedAt);
    if (typeof payload.pwd === 'number') {
      if (payload.pwd !== currentVersion) {
        throw new UnauthorizedException('Invalid token');
      }
    } else if (user.passwordChangedAt && typeof payload.iat === 'number') {
      // Legacy token without `pwd`: keep the original second-precision check so
      // a session opened before a password change is still ended.
      if (payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000) {
        throw new UnauthorizedException('Invalid token');
      }
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
    };
  }
}
