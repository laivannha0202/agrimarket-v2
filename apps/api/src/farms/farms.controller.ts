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
import { FarmsService } from './farms.service.js';
import { CreateFarmDto, UpdateFarmDto } from './dto/farm.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('farms')
@Controller('farms')
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List farms' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.farmsService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a farm by id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.farmsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a farm (ADMIN)' })
  create(@Body() dto: CreateFarmDto) {
    return this.farmsService.create(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a farm (ADMIN)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFarmDto) {
    return this.farmsService.update(id, dto);
  }
}
