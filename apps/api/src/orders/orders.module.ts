import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrderDocumentService } from './order-document.service.js';
import { OrderReservationExpiryService } from './order-reservation-expiry.service.js';
import { OrderDeliveryReconciliationService } from './order-delivery-reconciliation.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { QuarantineModule } from '../quarantine/quarantine.module.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';

@Module({
  imports: [
    InventoryModule,
    PromotionsModule,
    FinanceModule,
    LocationsModule,
    QuarantineModule,
    ShipmentsModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderReservationExpiryService,
    OrderDocumentService,
    OrderDeliveryReconciliationService,
  ],
  exports: [OrdersService, OrderReservationExpiryService, OrderDocumentService],
})
export class OrdersModule {}
