import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

/**
 * Populates `req.user` when a valid token is present, but never rejects.
 *
 * WHY THIS EXISTS
 *
 * The global `JwtAuthGuard` skips its work entirely for a `@Public()` route, so
 * `req.user` stays undefined even when the caller sends a valid token. That is
 * fine for a genuinely open endpoint, but the evidence file route needs both
 * behaviours at once: an anonymous visitor may read an APPROVED review photo,
 * while the reviewer, the owner of a complaint/return, and an ADMIN must also
 * be recognised so they can read their own private evidence.
 *
 * Attaching this guard to such a route runs the JWT strategy and, on success,
 * sets `req.user`. On failure it resolves to `undefined` instead of throwing:
 *
 *  - An expired token viewing a public image still works (the customer does not
 *    lose access to public content just because their session aged out).
 *  - A forged or malformed token is treated as anonymous, so the endpoint never
 *    confirms or denies whether a token was valid.
 *
 * This guard only ever ADDS identity. It never grants access on its own: the
 * route still decides what that identity is allowed to read.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Returning the user (or `undefined`) rather than rethrowing is what makes
   * this "optional". `err`, `info` and `context` are ignored on purpose — the
   * caller is simply anonymous when anything is wrong with the token.
   */
  handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser | undefined {
    return user || undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Anonymous access is allowed, so a bad token is not an error here.
    }
    return true;
  }
}
