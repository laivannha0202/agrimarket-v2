import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { LocationsModule } from '../locations/locations.module.js';

@Module({
  imports: [InventoryModule, PromotionsModule, FinanceModule, LocationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
