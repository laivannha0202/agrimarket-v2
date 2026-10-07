import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FarmingEventsService } from './farming-events.service.js';
import { CreateFarmingEventDto } from './dto/farming-event.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

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
  create(@Body() dto: CreateFarmingEventDto) {
    return this.farmingEventsService.create(dto);
  }
}
