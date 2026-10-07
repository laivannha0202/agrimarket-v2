import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { CreateAddressDto, CreateUserDto } from './dto/user.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';
import { UserStatus } from '../../generated/prisma/enums.js';

@ApiTags('customers')
@Controller('customers')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Customer-facing: own addresses
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/addresses')
  @ApiOperation({ summary: 'List my addresses (CUSTOMER)' })
  listMyAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listAddresses(user.id);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post('me/addresses')
  @ApiOperation({ summary: 'Add an address (CUSTOMER)' })
  addMyAddress(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    return this.usersService.addAddress(user.id, dto);
  }

  // Admin-facing: user management
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List users (ADMIN)' })
  findAll(@Query() query: PaginationQueryDto, @Query('role') role?: string) {
    return this.usersService.findAll({ ...query, role });
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get a user (ADMIN)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a user (ADMIN)' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a user (ADMIN)' })
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.setStatus(id, UserStatus.INACTIVE);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate a user (ADMIN)' })
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.setStatus(id, UserStatus.ACTIVE);
  }
}
