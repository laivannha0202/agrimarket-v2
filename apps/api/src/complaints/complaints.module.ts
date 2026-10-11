import { Module } from '@nestjs/common';
import { ComplaintsController } from './complaints.controller.js';
import { ComplaintsService } from './complaints.service.js';
import { EvidenceModule } from '../evidence/evidence.module.js';

@Module({
  imports: [EvidenceModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
