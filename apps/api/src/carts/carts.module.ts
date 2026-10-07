import { Module } from '@nestjs/common';
import { CartsController } from './carts.controller.js';
import { CartsService } from './carts.service.js';

@Module({
  controllers: [CartsController],
  providers: [CartsService],
  exports: [CartsService],
})
export class CartsModule {}
