import { Module } from '@nestjs/common';
import { FarmsController } from './farms.controller.js';
import { FarmsService } from './farms.service.js';

@Module({
  controllers: [FarmsController],
  providers: [FarmsService],
  exports: [FarmsService],
})
export class FarmsModule {}
