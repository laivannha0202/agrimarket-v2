import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LotsService } from './lots.service.js';
import { CreateLotDto, RecallLotDto } from './dto/lot.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('lots')
@Controller('lots')
export class LotsController {
  constructor(private readonly lotsService: LotsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List product lots' })
  findAll(@Query() query: PaginationQueryDto, @Query('productId') productId?: string) {
    return this.lotsService.findAll({
      ...query,
      productId: productId ? parseInt(productId, 10) : undefined,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a lot with QC, trace events and inventory' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.lotsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a lot from a harvest (ADMIN) — starts as PENDING_QC' })
  create(@Body() dto: CreateLotDto, @CurrentUser() user: AuthenticatedUser) {
    return this.lotsService.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post(':id/recall')
  @ApiOperation({ summary: 'Recall a lot (ADMIN) — removes it from sellable stock' })
  recall(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecallLotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lotsService.recall(id, dto, user.id);
  }
}
