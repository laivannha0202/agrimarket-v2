import { Module } from '@nestjs/common';
import { QualityControlController } from './quality-control.controller.js';
import { QualityControlService } from './quality-control.service.js';

@Module({
  controllers: [QualityControlController],
  providers: [QualityControlService],
  exports: [QualityControlService],
})
export class QualityControlModule {}
