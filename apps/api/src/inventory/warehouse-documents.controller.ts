import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WarehouseDocumentsService } from './warehouse-documents.service.js';
import {
  CreateWarehouseDocumentDto,
  UpdateWarehouseDocumentDto,
  WarehouseDocumentQueryDto,
} from './dto/warehouse-document.dto.js';
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
  @ApiOperation({ summary: 'List warehouse documents (status/type filters, ADMIN)' })
  findAll(@Query() query: WarehouseDocumentQueryDto) {
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

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a DRAFT document note/lines (ADMIN)',
    description:
      'Only DRAFT documents without a business source may be edited. COMPLETED/CANCELLED rows ' +
      'are immutable; stock is untouched until COMPLETE.',
  })
  updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWarehouseDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateDraft(id, dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a DRAFT document (ADMIN)',
    description:
      'DRAFT → CANCELLED. No stock or movement is written; a cancelled document can never be ' +
      'completed, edited or reopened.',
  })
  cancelDraft(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancelDraft(id, user.id);
  }
}
