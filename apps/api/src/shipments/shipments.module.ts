import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { QuarantineModule } from '../quarantine/quarantine.module.js';

@Module({
  imports: [InventoryModule, QuarantineModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
