import { Module } from '@nestjs/common';
import { FarmsController } from './farms.controller.js';
import { FarmsService } from './farms.service.js';
import { OptionalJwtAuthGuard } from '../evidence/optional-jwt-auth.guard.js';

@Module({
  controllers: [FarmsController],
  providers: [FarmsService, OptionalJwtAuthGuard],
  exports: [FarmsService],
})
export class FarmsModule {}
