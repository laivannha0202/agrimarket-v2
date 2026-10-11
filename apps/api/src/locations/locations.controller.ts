import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service.js';
import { WardQueryDto } from './dto/location.dto.js';
import { Public } from '../common/decorators/public.decorator.js';

/**
 * Public, read-only administrative catalogue.
 *
 * Public on purpose: the address form is filled in before/while signing in, and
 * the data is published Government reference data — there is nothing to protect.
 * Nothing here is writable, so there is no route that could be abused.
 *
 * The 104 Hưng Yên communes are served from here and nowhere else. Customer Web
 * and Mobile both call these endpoints; neither embeds its own list.
 */
@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Public()
  @Get('provinces')
  @ApiOperation({ summary: 'List provinces available for delivery' })
  listProvinces() {
    return this.locationsService.listProvinces();
  }

  @Public()
  @Get('provinces/:code')
  @ApiOperation({ summary: 'Get one province by code' })
  @ApiParam({ name: 'code', example: '33' })
  getProvince(@Param('code') code: string) {
    return this.locationsService.getProvince(code);
  }

  /**
   * Communes of a province, with optional accent-insensitive search.
   *
   * `GET /locations/provinces/33/wards?search=pho%20hien` returns
   * `Phường Phố Hiến` even though the customer typed no accents.
   */
  @Public()
  @Get('provinces/:code/wards')
  @ApiOperation({ summary: 'List communes (xã/phường) of a province, searchable' })
  @ApiParam({ name: 'code', example: '33' })
  listWards(@Param('code') code: string, @Query() query: WardQueryDto) {
    return this.locationsService.listWards(code, query);
  }

  @Public()
  @Get('provinces/:code/wards/:wardCode')
  @ApiOperation({ summary: 'Get one commune by its official code' })
  @ApiParam({ name: 'code', example: '33' })
  @ApiParam({ name: 'wardCode', example: '11953' })
  async getWard(@Param('code') code: string, @Param('wardCode') wardCode: string) {
    // A missing code is a 404, not an empty object: the client must never be
    // able to treat an unknown code as a valid selection.
    return this.locationsService.findWardOrFail(code, wardCode);
  }
}
