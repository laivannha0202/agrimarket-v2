import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CertificatesService } from './certificates.service.js';
import { CreateCertificateDto, VerifyCertificateDto } from './dto/certificate.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List certificates' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.certificatesService.findAll(query);
  }

  @Public()
  @Get('farm/:farmId/valid')
  @ApiOperation({ summary: 'List valid (verified, non-expired) certificates of a farm' })
  findValid(@Param('farmId', ParseIntPipe) farmId: number) {
    return this.certificatesService.findValidByFarm(farmId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a certificate by id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.certificatesService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Register a certificate for verification (ADMIN)' })
  create(@Body() dto: CreateCertificateDto) {
    return this.certificatesService.create(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/verify')
  @ApiOperation({ summary: 'Verify or reject a certificate (ADMIN)' })
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificatesService.verify(id, dto, user.id);
  }
}
