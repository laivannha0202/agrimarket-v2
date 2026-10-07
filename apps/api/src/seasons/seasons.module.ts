import { Module } from '@nestjs/common';
import { SeasonsController } from './seasons.controller.js';
import { SeasonsService } from './seasons.service.js';
import { FarmingEventsController } from './farming-events.controller.js';
import { FarmingEventsService } from './farming-events.service.js';

@Module({
  controllers: [SeasonsController, FarmingEventsController],
  providers: [SeasonsService, FarmingEventsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
