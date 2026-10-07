import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import {
  AdjustInventoryDto,
  InboundInventoryDto,
  ReserveInventoryDto,
} from './dto/inventory.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
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
  @ApiOperation({ summary: 'List inventory balances with computed available (ADMIN)' })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('warehouseId') warehouseId?: string,
    @Query('productVariantId') productVariantId?: string,
  ) {
    return this.inventoryService.findAll({
      ...query,
      warehouseId: warehouseId ? parseInt(warehouseId, 10) : undefined,
      productVariantId: productVariantId ? parseInt(productVariantId, 10) : undefined,
    });
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('movements')
  @ApiOperation({ summary: 'List inventory movements (ADMIN)' })
  movements(@Query() query: PaginationQueryDto, @Query('productLotId') productLotId?: string) {
    return this.inventoryService.movements({
      ...query,
      productLotId: productLotId ? parseInt(productLotId, 10) : undefined,
    });
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
