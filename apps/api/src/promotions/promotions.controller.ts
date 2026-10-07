import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service.js';
import {
  CreateFlashSaleDto,
  CreateProductDiscountDto,
  CreateVoucherDto,
} from './dto/promotion.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('promotions')
@Controller()
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  // Vouchers
  @Public()
  @Get('vouchers')
  @ApiOperation({ summary: 'List vouchers' })
  listVouchers(@Query() query: PaginationQueryDto) {
    return this.promotionsService.listVouchers(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('vouchers')
  @ApiOperation({ summary: 'Create a voucher (ADMIN)' })
  createVoucher(@Body() dto: CreateVoucherDto) {
    return this.promotionsService.createVoucher(dto);
  }

  // Product discounts
  @Public()
  @Get('product-discounts')
  @ApiOperation({ summary: 'List product discounts' })
  listProductDiscounts(@Query() query: PaginationQueryDto) {
    return this.promotionsService.listProductDiscounts(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('product-discounts')
  @ApiOperation({ summary: 'Create a product discount (ADMIN)' })
  createProductDiscount(@Body() dto: CreateProductDiscountDto) {
    return this.promotionsService.createProductDiscount(dto);
  }

  // Flash sales
  @Public()
  @Get('flash-sales')
  @ApiOperation({ summary: 'List flash sales' })
  listFlashSales(@Query() query: PaginationQueryDto) {
    return this.promotionsService.listFlashSales(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('flash-sales')
  @ApiOperation({ summary: 'Create a flash sale (ADMIN)' })
  createFlashSale(@Body() dto: CreateFlashSaleDto) {
    return this.promotionsService.createFlashSale(dto);
  }
}
