import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import {
  CompleteRefundDto,
  CreatePaymentDto,
  CreateRefundDto,
  FailRefundDto,
  PaymentQueryDto,
  RefundQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('payments')
  @ApiOperation({ summary: 'List payments (status filter, ADMIN)' })
  findAll(@Query() query: PaymentQueryDto) {
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
  @ApiOperation({ summary: 'List refunds (status filter, ADMIN)' })
  listRefunds(@Query() query: RefundQueryDto) {
    return this.paymentsService.listRefunds(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('refunds/:id')
  @ApiOperation({ summary: 'Get a refund with its payment, return and reconciliation rows (ADMIN)' })
  findRefund(@Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.findRefund(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refunds')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Stable client-generated key per logical refund. Reusing it with the same payload replays ' +
      'the original refund instead of refunding twice; a different payload is rejected with 409.',
  })
  @ApiOperation({
    summary: 'Request a refund (ADMIN) — PENDING, cannot exceed paid amount',
    description:
      'Creates the refund in PENDING. Money is only moved by approve -> complete; completion ' +
      'requires a bank/gateway reference and only then updates the payment and settlement.',
  })
  refund(
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.paymentsService.refund(dto, user.id, idempotencyKey);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refunds/:id/approve')
  @ApiOperation({ summary: 'Approve a PENDING refund (ADMIN)' })
  approveRefund(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.approveRefund(id, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refunds/:id/complete')
  @ApiOperation({
    summary: 'Complete an APPROVED refund with a payment reference (ADMIN)',
    description:
      'Requires `reference` (bank/gateway proof). Only this step moves the payment to ' +
      'PARTIALLY_REFUNDED/REFUNDED and books settlement reconciliation adjustments.',
  })
  completeRefund(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteRefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.completeRefund(id, dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('refunds/:id/fail')
  @ApiOperation({ summary: 'Fail a PENDING/APPROVED refund and release its return link (ADMIN)' })
  failRefund(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FailRefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.failRefund(id, dto, user.id);
  }
}
