import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';
import { EvidenceSweepService } from './evidence-sweep.service.js';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard.js';
import { ProductsModule } from '../products/products.module.js';

/**
 * Evidence photos for reviews, complaints and returns.
 *
 * `ProductsModule` is imported because `EvidenceService` deliberately reuses
 * `ProductImagesService.validateAndProcess` rather than duplicating the
 * validation pipeline. That module must therefore export it — see
 * `ProductsModule`.
 *
 * The service is exported so the three owning features can bind uploads inside
 * their own create transactions.
 */
@Module({
  imports: [ProductsModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, EvidenceSweepService, OptionalJwtAuthGuard],
  exports: [EvidenceService],
})
export class EvidenceModule {}
