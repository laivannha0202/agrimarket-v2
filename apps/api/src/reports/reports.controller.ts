import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ReportsDailyQueryDto,
  ReportsExportQueryDto,
  ReportsSummaryQueryDto,
} from './dto/reports.dto.js';
import { ReportsExportService } from './reports-export.service.js';
import { ReportsService } from './reports.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('reports')
@Controller('reports')
@Roles('ADMIN')
@ApiBearerAuth()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exportService: ReportsExportService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Aggregate KPIs for dashboard and reports (ADMIN)',
    description:
      'Counts and sums over the full filtered set (no 100-row cap). ' +
      '`totalOrderValue` is non-cancelled order value created in the window; ' +
      'revenue is cash flow — `grossCollected` is collected payments by ' +
      '`paidAt` (PAID/PARTIALLY_REFUNDED/REFUNDED), `refundTotal` is completed ' +
      'refunds by `completedAt`, `netCollected = gross − refund`. Pass ' +
      '`days=7|30` or an explicit `from`/`to`; the window matches /reports/daily.',
  })
  summary(@Query() query: ReportsSummaryQueryDto) {
    return this.reports.summary(query.from, query.to, query.days);
  }

  @Get('daily')
  @ApiOperation({
    summary: 'Daily orders + revenue series, bucketed by Vietnam day (ADMIN)',
    description:
      'Zero-filled per Vietnam calendar day (UTC+7). Revenue is real money: ' +
      'PAID/PARTIALLY_REFUNDED payments minus COMPLETED refunds. Pass ' +
      '`days=7|30` or an explicit `from`/`to` window.',
  })
  daily(@Query() query: ReportsDailyQueryDto) {
    return this.reports.daily(query.from, query.to, query.days);
  }

  @Get('export')
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
  )
  @ApiOperation({
    summary: 'Export the summary report as a real .xlsx or .pdf (ADMIN)',
    description:
      'Streams a genuine Office Open XML workbook (ExcelJS) or PDF (PDFKit, ' +
      'embedded Unicode font) built from the same full-set aggregates as ' +
      '/reports/summary, over the same window. `format` is required.',
  })
  async export(
    @Query() query: ReportsExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    // Build first: a failure here is still a normal exception and the global
    // filter renders it as JSON. Only a successfully built file touches headers.
    const file = await this.exportService.export(query.format, query.from, query.to, query.days);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.end(file.buffer);
  }
}
