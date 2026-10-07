import { Module } from '@nestjs/common';
import { LotsController } from './lots.controller.js';
import { LotsService } from './lots.service.js';

@Module({
  controllers: [LotsController],
  providers: [LotsService],
  exports: [LotsService],
})
export class LotsModule {}
