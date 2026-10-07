import { Module } from '@nestjs/common';
import { HarvestsController } from './harvests.controller.js';
import { HarvestsService } from './harvests.service.js';

@Module({
  controllers: [HarvestsController],
  providers: [HarvestsService],
  exports: [HarvestsService],
})
export class HarvestsModule {}
