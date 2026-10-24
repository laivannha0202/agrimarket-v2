import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QuarantineService } from './quarantine.service.js';
import {
  InspectQuarantineDto,
  QuarantineQueryDto,
  ResolveQuarantineDto,
} from './dto/quarantine.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('quarantine')
@Controller('quarantine-cases')
export class QuarantineController {
  constructor(private readonly quarantineService: QuarantineService) {}

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List quarantine cases (status/warehouse/return filter, ADMIN)' })
  findAll(@Query() query: QuarantineQueryDto) {
    return this.quarantineService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get a quarantine case (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.quarantineService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/inspect')
  @ApiOperation({
    summary: 'Record a re-inspection result (ADMIN)',
    description:
      'PASS -> PASSED (eligible for release), FAIL -> FAILED (eligible for scrap) with a required note. ' +
      'Stock is unchanged here: release/scrap is an explicit second step.',
  })
  inspect(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InspectQuarantineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quarantineService.inspect(id, dto, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/resolve')
  @ApiOperation({
    summary: 'Release or scrap a quarantine case (ADMIN)',
    description:
      'RELEASE is only allowed after PASS (blocked -> sellable). SCRAP is only allowed after FAIL ' +
      '(blocked and on-hand decrease, lot remaining quantity decreases).',
  })
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveQuarantineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quarantineService.resolve(id, dto, user.id);
  }
}
