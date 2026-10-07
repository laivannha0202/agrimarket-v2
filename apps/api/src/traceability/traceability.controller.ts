import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TraceabilityService } from './traceability.service.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('traceability')
@Controller('trace')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Public()
  @Get(':traceCode')
  @ApiOperation({ summary: 'Public product trace by trace code' })
  trace(@Param('traceCode') traceCode: string) {
    return this.traceabilityService.trace(traceCode);
  }
}
