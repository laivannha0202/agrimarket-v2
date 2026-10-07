import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { WarehouseDocumentsController } from './warehouse-documents.controller.js';
import { WarehouseDocumentsService } from './warehouse-documents.service.js';

@Module({
  controllers: [InventoryController, WarehouseDocumentsController],
  providers: [InventoryService, WarehouseDocumentsService],
  exports: [InventoryService],
})
export class InventoryModule {}
