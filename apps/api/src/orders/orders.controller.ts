import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { UpdateOrderStatusDto } from './dto/order-status.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post('checkout')
  @ApiOperation({ summary: 'Checkout: create order, split by partner, reserve stock (CUSTOMER)' })
  checkout(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckoutDto) {
    return this.ordersService.checkout(user.id, dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'List my orders (CUSTOMER)' })
  myOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.ordersService.findForCustomer(user.id, query);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/:id')
  @ApiOperation({ summary: 'Get one of my orders (CUSTOMER)' })
  myOrder(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List all orders (ADMIN)' })
  findAll(@Query() query: PaginationQueryDto) {
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
