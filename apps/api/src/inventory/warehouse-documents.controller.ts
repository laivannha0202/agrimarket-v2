import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WarehouseDocumentsService } from './warehouse-documents.service.js';
import { CreateWarehouseDocumentDto } from './dto/warehouse-document.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('warehouse-documents')
@Controller('warehouse-documents')
export class WarehouseDocumentsController {
  constructor(private readonly service: WarehouseDocumentsService) {}

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List warehouse documents (ADMIN)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.service.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get a warehouse document (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a draft warehouse document (ADMIN)' })
  create(@Body() dto: CreateWarehouseDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete a document and apply stock changes (ADMIN)' })
  complete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.service.complete(id, user.id);
  }
}
