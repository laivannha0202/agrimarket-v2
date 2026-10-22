import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { WarehouseDocumentsController } from './warehouse-documents.controller.js';
import { WarehouseDocumentsService } from './warehouse-documents.service.js';
import { IdempotencyModule } from '../common/idempotency/idempotency.module.js';

@Module({
  imports: [IdempotencyModule],
  controllers: [InventoryController, WarehouseDocumentsController],
  providers: [InventoryService, WarehouseDocumentsService],
  exports: [InventoryService],
})
export class InventoryModule {}
