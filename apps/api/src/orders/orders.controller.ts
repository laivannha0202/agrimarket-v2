import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service.js';
import { CheckoutDto, CheckoutPreviewDto } from './dto/checkout.dto.js';
import { MyOrderQueryDto, OrderQueryDto, UpdateOrderStatusDto } from './dto/order-status.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * The idempotency key can be sent as a body field or as the standard
   * `Idempotency-Key` header; the body field wins when both are present.
   */
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post('checkout')
  @ApiOperation({
    summary: 'Checkout: create order, split by partner, reserve stock (CUSTOMER)',
    description:
      'The shipping fee is decided by the backend. Send an `Idempotency-Key` header ' +
      '(or `idempotencyKey` in the body) to make the request retry-safe: the same key ' +
      'with the same payload returns the original order, a different payload is a 409.',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = dto.idempotencyKey?.trim() || idempotencyKey?.trim();
    return this.ordersService.checkout(user.id, key ? { ...dto, idempotencyKey: key } : dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post('checkout-preview')
  @ApiOperation({
    summary: 'Preview checkout totals and stock (CUSTOMER)',
    description:
      'Backend-computed prices, voucher discount, shipping fee and grand total for the ' +
      'given lines (or the current cart), plus the sellable quantity per line. ' +
      'Nothing is created and no stock is reserved.',
  })
  checkoutPreview(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckoutPreviewDto) {
    return this.ordersService.checkoutPreview(user.id, dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'List my orders (status filter, CUSTOMER)' })
  myOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: MyOrderQueryDto) {
    return this.ordersService.findForCustomer(user.id, query);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/:id')
  @ApiOperation({
    summary: 'Get one of my orders with allocated lot trace codes and shipment events (CUSTOMER)',
  })
  myOrder(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOneForCustomer(id, user.id);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post('me/:id/cancel')
  @ApiOperation({
    summary: 'Cancel my order (CUSTOMER)',
    description:
      'Runs the order state machine: only PENDING_CONFIRMATION, CONFIRMED, PREPARING, ' +
      'READY_TO_SHIP and SHIPPING orders can be cancelled. Reservations are released.',
  })
  cancelMyOrder(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.ordersService.cancelForCustomer(id, user.id, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List all orders (search/status filters, ADMIN)' })
  findAll(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get an order (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/status')
  @ApiOperation({ summary: 'Advance order status (ADMIN) — DELIVERED settles COD' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateStatus(id, dto.status, user.id);
  }
}
