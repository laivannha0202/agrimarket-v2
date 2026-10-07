import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommissionService } from './commission.service.js';
import { PayoutsService, SettlementsService } from './settlements.service.js';
import {
  CreateCommissionRuleDto,
  CreatePayoutDto,
  CreateSettlementDto,
} from './dto/finance.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
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
  ) {}

  // Commission rules
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('commission-rules')
  @ApiOperation({ summary: 'List commission rules (ADMIN)' })
  listRules(@Query() query: PaginationQueryDto) {
    return this.commissionService.listRules(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('commission-rules')
  @ApiOperation({ summary: 'Create a commission rule (ADMIN)' })
  createRule(@Body() dto: CreateCommissionRuleDto) {
    return this.commissionService.createRule(dto);
  }

  // Settlements
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('settlements')
  @ApiOperation({ summary: 'List settlements (ADMIN)' })
  listSettlements(@Query() query: PaginationQueryDto) {
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
  @ApiOperation({ summary: 'List payouts (ADMIN)' })
  listPayouts(@Query() query: PaginationQueryDto) {
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
