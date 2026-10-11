import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller.js';
import { CommissionService } from './commission.service.js';
import { PayoutsService, SettlementsService } from './settlements.service.js';
import { SettlementExportService } from './settlement-export.service.js';

@Module({
  controllers: [FinanceController],
  providers: [CommissionService, SettlementsService, PayoutsService, SettlementExportService],
  exports: [CommissionService, SettlementsService, PayoutsService],
})
export class FinanceModule {}
