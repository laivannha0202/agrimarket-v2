import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsExportService } from './reports-export.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsExportService],
})
export class ReportsModule {}
