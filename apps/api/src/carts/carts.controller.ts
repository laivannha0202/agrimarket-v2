import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CartsService } from './carts.service.js';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('carts')
@Controller('carts')
export class CartsController {
  constructor(private readonly cartsService: CartsService) {}

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get my cart (CUSTOMER)' })
  getCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cartsService.getOrCreateCart(user.id);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post('me/items')
  @ApiOperation({ summary: 'Add an item to my cart (CUSTOMER)' })
  addItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto) {
    return this.cartsService.addItem(user.id, dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Patch('me/items/:itemId')
  @ApiOperation({ summary: 'Update a cart item quantity (CUSTOMER)' })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartsService.updateItem(user.id, itemId, dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Delete('me/items/:itemId')
  @ApiOperation({ summary: 'Remove a cart item (CUSTOMER)' })
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.cartsService.removeItem(user.id, itemId);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Delete('me')
  @ApiOperation({ summary: 'Clear my cart (CUSTOMER)' })
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.cartsService.clear(user.id);
  }
}
