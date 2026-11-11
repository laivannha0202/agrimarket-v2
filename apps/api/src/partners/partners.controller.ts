import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartnersService } from './partners.service.js';
import {
  CreatePartnerDto,
  PartnerBusinessStatusDto,
  PartnerQueryDto,
  PartnerVerificationDto,
  UpdatePartnerDto,
} from './dto/partner.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { OptionalJwtAuthGuard } from '../evidence/optional-jwt-auth.guard.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('partners')
@Controller('partners')
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'List partners (search/status filters)' })
  findAll(@Query() query: PartnerQueryDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.partnersService.findAll(query, user);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Get a partner by id' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.partnersService.findOne(id, user);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id/impact')
  @ApiOperation({ summary: 'Count linked farms, active products and open orders before suspension (ADMIN)' })
  impact(@Param('id', ParseIntPipe) id: number) {
    return this.partnersService.impact(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id/history')
  @ApiOperation({ summary: 'Partner audit history without confidential snapshots (ADMIN)' })
  history(@Param('id', ParseIntPipe) id: number) {
    return this.partnersService.history(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a partner (ADMIN)' })
  create(@Body() dto: CreatePartnerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.partnersService.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a partner (ADMIN)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePartnerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.update(id, dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/verification')
  @ApiOperation({ summary: 'Review partner legal documents (ADMIN)' })
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PartnerVerificationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.verify(id, dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/business-status')
  @ApiOperation({ summary: 'Activate or suspend partner business activity (ADMIN)' })
  changeBusinessStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PartnerBusinessStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.changeBusinessStatus(id, dto, user.id);
  }
}
