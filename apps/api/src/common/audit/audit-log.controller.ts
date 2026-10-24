import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service.js';
import { AuditLogQueryDto } from './dto/audit-log.dto.js';
import { Roles } from '../decorators/roles.decorator.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly audit: AuditService) {}

  @Roles('ADMIN')
  @Get()
  @ApiOperation({ summary: 'List audit-trail rows (action/entity/actor/date filter, ADMIN)' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.audit.findAll(query);
  }
}
