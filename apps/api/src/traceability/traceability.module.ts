import { Module } from '@nestjs/common';
import { TraceabilityController } from './traceability.controller.js';
import { TraceabilityService } from './traceability.service.js';

@Module({
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
  exports: [TraceabilityService],
})
export class TraceabilityModule {}
