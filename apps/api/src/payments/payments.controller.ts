import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import {
  CreatePaymentDto,
  CreateRefundDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('payments')
  @ApiOperation({ summary: 'List payments (ADMIN)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.paymentsService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('payments/:id')
  @ApiOperation({ summary: 'Get a payment (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('payments')
  @ApiOperation({ summary: 'Create a payment record (ADMIN)' })
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('payments/:id/status')
  @ApiOperation({ summary: 'Update payment status (ADMIN)' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.updateStatus(id, dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('refunds')
  @ApiOperation({ summary: 'List refunds (ADMIN)' })
  listRefunds(@Query() query: PaginationQueryDto) {
    return this.paymentsService.listRefunds(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refunds')
  @ApiOperation({ summary: 'Refund a payment (ADMIN) — cannot exceed paid amount' })
  refund(@Body() dto: CreateRefundDto, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.refund(dto, user.id);
  }
}
