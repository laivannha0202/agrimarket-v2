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
import { WarehousesService } from './warehouses.service.js';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('warehouses')
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List warehouses' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.warehousesService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a warehouse by id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.warehousesService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a warehouse (ADMIN)' })
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.warehousesService.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a warehouse (ADMIN)',
    description:
      'Name/address change freely. ACTIVE → INACTIVE is refused with 409 when the warehouse ' +
      'still holds stock (on-hand/reserved/blocked), has a DRAFT document, or serves an open order.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.warehousesService.update(id, dto, user.id);
  }
}
