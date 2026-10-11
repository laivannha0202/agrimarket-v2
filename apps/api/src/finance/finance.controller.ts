import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CommissionService } from './commission.service.js';
import { PayoutsService, SettlementsService } from './settlements.service.js';
import { SettlementExportService } from './settlement-export.service.js';
import {
  CommissionRuleQueryDto,
  CreateCommissionRuleDto,
  CreatePayoutDto,
  CreateSettlementDto,
  PayoutQueryDto,
  SettlementExportQueryDto,
  SettlementQueryDto,
  UpdateCommissionRuleStatusDto,
} from './dto/finance.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('finance')
@Controller()
export class FinanceController {
  constructor(
    private readonly commissionService: CommissionService,
    private readonly settlementsService: SettlementsService,
    private readonly payoutsService: PayoutsService,
    private readonly settlementExportService: SettlementExportService,
  ) {}

  // Commission rules
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('commission-rules')
  @ApiOperation({ summary: 'List commission rules (status filter, ADMIN)' })
  listRules(@Query() query: CommissionRuleQueryDto) {
    return this.commissionService.listRules(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('commission-rules')
  @ApiOperation({ summary: 'Create a commission rule (ADMIN)' })
  createRule(@Body() dto: CreateCommissionRuleDto) {
    return this.commissionService.createRule(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('commission-rules/:id')
  @ApiOperation({ summary: 'Activate / deactivate a commission rule (ADMIN)' })
  updateRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommissionRuleStatusDto,
  ) {
    return this.commissionService.updateRuleStatus(id, dto.status);
  }

  // Settlements
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('settlements')
  @ApiOperation({ summary: 'List settlements (status filter, ADMIN)' })
  listSettlements(@Query() query: SettlementQueryDto) {
    return this.settlementsService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('settlements/:id')
  @ApiOperation({ summary: 'Get a settlement (ADMIN)' })
  getSettlement(@Param('id', ParseIntPipe) id: number) {
    return this.settlementsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('settlements/:id/export')
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
  )
  @ApiOperation({
    summary: 'Export a settlement statement as a real .xlsx or .pdf (ADMIN)',
    description:
      'Streams the stored reconciliation statement (header + lines + payouts) ' +
      'as a genuine Excel workbook or PDF. `format` is required.',
  })
  async exportSettlement(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SettlementExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.settlementExportService.export(id, query.format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.end(file.buffer);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('settlements')
  @ApiOperation({ summary: 'Create a settlement for a partner period (ADMIN)' })
  createSettlement(@Body() dto: CreateSettlementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settlementsService.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('settlements/:id/confirm')
  @ApiOperation({ summary: 'Confirm a settlement (ADMIN)' })
  confirmSettlement(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.settlementsService.confirm(id, user.id);
  }

  // Payouts
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('payouts')
  @ApiOperation({ summary: 'List payouts (status filter, ADMIN)' })
  listPayouts(@Query() query: PayoutQueryDto) {
    return this.payoutsService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('payouts')
  @ApiOperation({ summary: 'Create a payout for a confirmed settlement (ADMIN)' })
  createPayout(@Body() dto: CreatePayoutDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payoutsService.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('payouts/:id/pay')
  @ApiOperation({ summary: 'Mark a payout as paid (ADMIN)' })
  payPayout(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.payoutsService.markPaid(id, user.id);
  }
}
