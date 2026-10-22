import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller.js';
import { CommissionService } from './commission.service.js';
import { PayoutsService, SettlementsService } from './settlements.service.js';
import { SettlementExportService } from './settlement-export.service.js';
import { IdempotencyModule } from '../common/idempotency/idempotency.module.js';

@Module({
  imports: [IdempotencyModule],
  controllers: [FinanceController],
  providers: [CommissionService, SettlementsService, PayoutsService, SettlementExportService],
  exports: [CommissionService, SettlementsService, PayoutsService],
})
export class FinanceModule {}
