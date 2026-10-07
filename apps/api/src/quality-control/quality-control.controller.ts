import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QualityControlService } from './quality-control.service.js';
import { CreateQcInspectionDto } from './dto/qc.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('quality-control')
@Controller('qc')
export class QualityControlController {
  constructor(private readonly qcService: QualityControlService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List QC inspections' })
  findAll(@Query() query: PaginationQueryDto, @Query('productLotId') productLotId?: string) {
    return this.qcService.findAll({
      ...query,
      productLotId: productLotId ? parseInt(productLotId, 10) : undefined,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a QC inspection by id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.qcService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Inspect a lot (ADMIN) — PASS makes it SELLABLE, FAIL rejects it' })
  create(@Body() dto: CreateQcInspectionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.qcService.inspect(dto, user.id);
  }
}
