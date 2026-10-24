import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditLogController } from './audit-log.controller.js';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
