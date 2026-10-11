import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplaintsService } from './complaints.service.js';
import {
  ComplaintQueryDto,
  CreateComplaintDto,
  MyComplaintQueryDto,
  UpdateComplaintDto,
} from './dto/complaint.dto.js';
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

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'List my complaints (status filter, CUSTOMER)' })
  myComplaints(@CurrentUser() user: AuthenticatedUser, @Query() query: MyComplaintQueryDto) {
    return this.complaintsService.findForCustomer(user.id, query);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/:id')
  @ApiOperation({ summary: 'Get one of my complaints (CUSTOMER)' })
  myComplaint(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.complaintsService.findOneForCustomer(id, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List complaints (status filter, ADMIN)' })
  findAll(@Query() query: ComplaintQueryDto) {
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
