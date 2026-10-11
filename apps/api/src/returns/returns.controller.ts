import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReturnsService } from './returns.service.js';
import {
  CreateReturnRequestDto,
  MyReturnQueryDto,
  ReturnQueryDto,
  UpdateReturnRequestDto,
} from './dto/return.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('returns')
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Request a return for a delivered item (CUSTOMER)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReturnRequestDto) {
    return this.returnsService.create(user.id, dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'List my return requests (status filter, CUSTOMER)' })
  myReturns(@CurrentUser() user: AuthenticatedUser, @Query() query: MyReturnQueryDto) {
    return this.returnsService.findForCustomer(user.id, query);
  }

  /**
   * Declared BEFORE `me/:id` on purpose: Nest matches routes in declaration
   * order, so a literal path has to come before the parameterised one or
   * "eligible-items" would be parsed as an `:id` and rejected by ParseIntPipe.
   */
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/eligible-items')
  @ApiOperation({
    summary: 'Delivered items that can still be returned (CUSTOMER)',
    description:
      'Server-side eligibility for the return form: only the caller\'s own DELIVERED order ' +
      'lines appear, each with the quantity still free to claim. `POST /returns` re-checks ' +
      'the same rules, so this list can never authorise an invalid request.',
  })
  eligibleItems(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.returnsService.listEligibleItems(user.id, query);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/:id')
  @ApiOperation({ summary: 'Get one of my return requests (CUSTOMER)' })
  myReturn(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.returnsService.findOneForCustomer(id, user.id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List return requests (status filter, ADMIN)' })
  findAll(@Query() query: ReturnQueryDto) {
    return this.returnsService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get a return request (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.returnsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Advance a return request (ADMIN)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReturnRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.returnsService.updateStatus(id, dto, user.id);
  }
}
