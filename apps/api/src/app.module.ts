import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { UsersModule } from './users/users.module.js';
import { PartnersModule } from './partners/partners.module.js';
import { FarmsModule } from './farms/farms.module.js';
import { SeasonsModule } from './seasons/seasons.module.js';
import { HarvestsModule } from './harvests/harvests.module.js';
import { CertificatesModule } from './certificates/certificates.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { LotsModule } from './lots/lots.module.js';
import { QualityControlModule } from './quality-control/quality-control.module.js';
import { TraceabilityModule } from './traceability/traceability.module.js';
import { WarehousesModule } from './warehouses/warehouses.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { CartsModule } from './carts/carts.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ShipmentsModule } from './shipments/shipments.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PromotionsModule } from './promotions/promotions.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ComplaintsModule } from './complaints/complaints.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PartnersModule,
    FarmsModule,
    SeasonsModule,
    HarvestsModule,
    CertificatesModule,
    CategoriesModule,
    ProductsModule,
    LotsModule,
    QualityControlModule,
    TraceabilityModule,
    WarehousesModule,
    InventoryModule,
    CartsModule,
    OrdersModule,
    ShipmentsModule,
    PaymentsModule,
    PromotionsModule,
    ReviewsModule,
    ComplaintsModule,
    ReturnsModule,
    FinanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
