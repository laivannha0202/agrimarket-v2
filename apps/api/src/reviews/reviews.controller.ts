import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service.js';
import {
  CreateReviewDto,
  ReviewQueryDto,
  UpdateReviewStatusDto,
} from './dto/review.dto.js';
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

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary: 'List my reviews with the reviewed order-item ids (CUSTOMER)',
    description:
      'Returns the customer\'s own reviews (any status). Each row carries ' +
      '`orderItemId`, so the UI can tell which purchased items were already reviewed.',
  })
  myReviews(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.reviewsService.listForCustomer(user.id, query);
  }

  /**
   * Declared BEFORE any parameterised `me/:id` route would be: Nest matches in
   * declaration order, so a literal segment must not be shadowed by `:id`.
   */
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Get('me/eligible-items')
  @ApiOperation({
    summary: 'Delivered items not yet reviewed (CUSTOMER)',
    description:
      'Server-side eligibility for the review form: only the caller\'s own DELIVERED order ' +
      'lines with no existing review. `POST /reviews` re-checks the same rules, so a stale ' +
      'list can only produce a clean error, never a duplicate review.',
  })
  eligibleItems(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.reviewsService.listEligibleItems(user.id, query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List all reviews (status filter, ADMIN)' })
  findAll(@Query() query: ReviewQueryDto) {
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
