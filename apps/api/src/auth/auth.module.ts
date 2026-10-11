import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [
    PassportModule,
    // In-memory storage is correct here: the limits protect individual auth
    // attempts, and a restart simply clears the counters. A shared store would
    // be needed to survive restarts or to throttle across several API
    // instances, which this single-instance deployment does not have.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('jwtSecret') ?? 'CHANGE_ME',
        signOptions: {
          expiresIn: (config.get<string>('jwtExpiresIn') ?? '7d') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AuthThrottlerGuard],
  exports: [AuthService],
})
export class AuthModule {}
