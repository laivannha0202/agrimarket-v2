import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FarmingEventsService } from './farming-events.service.js';
import { CreateFarmingEventDto, UpdateFarmingEventDto } from './dto/farming-event.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('farming-events')
@Controller('farming-events')
export class FarmingEventsController {
  constructor(private readonly farmingEventsService: FarmingEventsService) {}

  @Public()
  @Get('season/:seasonId')
  @ApiOperation({ summary: 'List farming events of a season' })
  findBySeason(@Param('seasonId', ParseIntPipe) seasonId: number) {
    return this.farmingEventsService.findBySeason(seasonId);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Record a farming event (ADMIN)' })
  create(@Body() dto: CreateFarmingEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.farmingEventsService.create(dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Correct a farming event (ADMIN)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFarmingEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.farmingEventsService.update(id, dto, user.id);
  }
}
