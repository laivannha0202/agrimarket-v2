import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller.js';
import { ReturnsService } from './returns.service.js';
import { EvidenceModule } from '../evidence/evidence.module.js';

@Module({
  imports: [EvidenceModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
