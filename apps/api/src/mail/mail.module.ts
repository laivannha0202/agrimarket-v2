import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * Global so `AuthService` can inject `MailService` without every feature module
 * having to re-import it.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
