import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/account.dto.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

/**
 * Authentication for both Customer Web and Mobile.
 *
 * There is exactly ONE auth surface: both clients call these same routes, so an
 * account created on the Web signs in on Mobile and vice versa. Nothing here is
 * duplicated per client.
 *
 * Rate limits are per-route and deliberately tight on the routes that can be
 * brute-forced or used to send mail. `AuthThrottlerGuard` counts by IP *and* by
 * the submitted e-mail/phone, so hammering one account from many addresses is
 * still throttled.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive a JWT access token' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * Public self-registration. Always creates a CUSTOMER — the DTO carries no
   * role field, and the global ValidationPipe rejects unknown properties, so
   * `role: "ADMIN"` is a 400 rather than a privilege escalation.
   */
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new customer account' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Starts password recovery. The response never reveals whether the address is
   * registered.
   */
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password-reset link by e-mail' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /** Completes recovery with the single-use token from the e-mail. */
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a recovery token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }

  /**
   * Changes the signed-in user's password.
   *
   * Returns a fresh token: the change invalidates every token issued earlier,
   * so the device that made the change needs a current one to stay signed in
   * while other devices are signed out.
   */
  @Patch('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change my password (requires the current password)' })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }
}
