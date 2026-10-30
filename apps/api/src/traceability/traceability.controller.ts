import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TraceabilityService } from './traceability.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('traceability')
@Controller('trace')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('admin/lot/:lotId')
  @ApiOperation({ summary: 'Audit a lot trace chain for completeness (ADMIN)' })
  adminTrace(@Param('lotId', ParseIntPipe) lotId: number) {
    return this.traceabilityService.adminTrace(lotId);
  }

  @Public()
  @Get(':traceCode')
  @ApiOperation({ summary: 'Public product trace by trace code' })
  trace(@Param('traceCode') traceCode: string) {
    return this.traceabilityService.trace(traceCode);
  }
}
