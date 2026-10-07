import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service.js';
import { CreateReviewDto, UpdateReviewStatusDto } from './dto/review.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Public()
  @Get('product/:productId')
  @ApiOperation({ summary: 'List approved reviews of a product (public)' })
  listForProduct(@Param('productId', ParseIntPipe) productId: number, @Query() query: PaginationQueryDto) {
    return this.reviewsService.listForProduct(productId, query);
  }

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Review a purchased order item (CUSTOMER)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.id, dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List all reviews (ADMIN)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.reviewsService.findAll(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id/status')
  @ApiOperation({ summary: 'Approve or hide a review (ADMIN)' })
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReviewStatusDto) {
    return this.reviewsService.updateStatus(id, dto);
  }
}
