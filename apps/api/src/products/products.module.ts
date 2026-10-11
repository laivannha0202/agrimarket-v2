import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductImagesController } from './product-images.controller.js';
import { ProductsService } from './products.service.js';
import { ProductImagesService } from './product-images.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';

@Module({
  imports: [InventoryModule, PromotionsModule],
  controllers: [ProductsController, ProductImagesController],
  providers: [ProductsService, ProductImagesService],
  exports: [ProductsService, ProductImagesService],
})
export class ProductsModule {}
