import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import {
  AdjustInventoryDto,
  InboundInventoryDto,
  InventoryMovementQueryDto,
  InventoryQueryDto,
  ReserveInventoryDto,
} from './dto/inventory.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List inventory balances (warehouseId/productVariantId filters)' })
  findAll(@Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('movements')
  @ApiOperation({ summary: 'List inventory movements (productLotId filter)' })
  movements(@Query() query: InventoryMovementQueryDto) {
    return this.inventoryService.movements(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('inbound')
  @ApiOperation({ summary: 'Receive stock into a warehouse (ADMIN)' })
  inbound(@Body() dto: InboundInventoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.inbound(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('adjust')
  @ApiOperation({ summary: 'Adjust stock (ADMIN) — cannot go negative' })
  adjust(@Body() dto: AdjustInventoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.adjust(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('reserve')
  @ApiOperation({ summary: 'Reserve stock (ADMIN)' })
  reserve(@Body() dto: ReserveInventoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.reserve(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('release')
  @ApiOperation({ summary: 'Release a stock reservation (ADMIN)' })
  release(@Body() dto: ReserveInventoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.release(dto, user.id);
  }
}
