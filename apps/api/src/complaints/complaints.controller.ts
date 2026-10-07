import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplaintsService } from './complaints.service.js';
import { CreateComplaintDto, UpdateComplaintDto } from './dto/complaint.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('complaints')
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'File a complaint about an order (CUSTOMER)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateComplaintDto) {
    return this.complaintsService.create(user.id, dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List complaints (ADMIN)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.complaintsService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get a complaint (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.complaintsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Resolve or update a complaint (ADMIN)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateComplaintDto) {
    return this.complaintsService.update(id, dto);
  }
}
