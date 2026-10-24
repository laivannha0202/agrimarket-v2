import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller.js';
import { ReturnsService } from './returns.service.js';
import { EvidenceModule } from '../evidence/evidence.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { QuarantineModule } from '../quarantine/quarantine.module.js';

@Module({
  imports: [EvidenceModule, InventoryModule, QuarantineModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
