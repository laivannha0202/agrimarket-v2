import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import {
  CreateAddressDto,
  CreateUserDto,
  UpdateAddressDto,
  UpdateMyProfileDto,
  UserQueryDto,
} from './dto/user.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';
import { UserStatus } from '../../generated/prisma/enums.js';

@ApiTags('customers')
@Controller('customers')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Customer-facing: own profile
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Update my profile (name, phone) (CUSTOMER)' })
  updateMyProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMyProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

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

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Patch('me/addresses/:id')
  @ApiOperation({ summary: 'Update one of my addresses (CUSTOMER)' })
  updateMyAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.usersService.updateAddress(user.id, id, dto);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Delete('me/addresses/:id')
  @ApiOperation({ summary: 'Delete one of my addresses (CUSTOMER)' })
  removeMyAddress(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.usersService.removeAddress(user.id, id);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Patch('me/addresses/:id/default')
  @ApiOperation({ summary: 'Make one of my addresses the default (CUSTOMER)' })
  setMyDefaultAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.setDefaultAddress(user.id, id);
  }

  // Admin-facing: user management
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List users (search/status/role filters, ADMIN)' })
  findAll(@Query() query: UserQueryDto) {
    return this.usersService.findAll(query);
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
