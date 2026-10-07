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
import { HarvestsService } from './harvests.service.js';
import { CreateHarvestDto, UpdateHarvestDto } from './dto/harvest.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('harvests')
@Controller('harvests')
export class HarvestsController {
  constructor(private readonly harvestsService: HarvestsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List harvests' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.harvestsService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a harvest with its lots' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.harvestsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a harvest (ADMIN)' })
  create(@Body() dto: CreateHarvestDto) {
    return this.harvestsService.create(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a harvest (ADMIN) — cannot go below allocated lots' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHarvestDto) {
    return this.harvestsService.update(id, dto);
  }
}
