import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller.js';
import { CommissionService } from './commission.service.js';
import { PayoutsService, SettlementsService } from './settlements.service.js';

@Module({
  controllers: [FinanceController],
  providers: [CommissionService, SettlementsService, PayoutsService],
  exports: [CommissionService, SettlementsService, PayoutsService],
})
export class FinanceModule {}
