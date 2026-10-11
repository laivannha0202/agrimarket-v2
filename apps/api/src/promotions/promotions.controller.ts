import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service.js';
import {
  CreateFlashSaleDto,
  CreateProductDiscountDto,
  CreateVoucherDto,
  PromotionQueryDto,
  UpdateFlashSaleStatusDto,
  UpdateProductDiscountStatusDto,
  UpdateVoucherStatusDto,
} from './dto/promotion.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('promotions')
@Controller()
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  // Vouchers
  @Public()
  @Get('vouchers')
  @ApiOperation({ summary: 'List vouchers (status filter)' })
  listVouchers(@Query() query: PromotionQueryDto) {
    return this.promotionsService.listVouchers(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('vouchers')
  @ApiOperation({ summary: 'Create a voucher (ADMIN)' })
  createVoucher(@Body() dto: CreateVoucherDto) {
    return this.promotionsService.createVoucher(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('vouchers/:id')
  @ApiOperation({ summary: 'Activate / deactivate a voucher (ADMIN)' })
  updateVoucher(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVoucherStatusDto,
  ) {
    return this.promotionsService.updateVoucherStatus(id, dto.status);
  }

  // Product discounts
  @Public()
  @Get('product-discounts')
  @ApiOperation({ summary: 'List product discounts (status filter)' })
  listProductDiscounts(@Query() query: PromotionQueryDto) {
    return this.promotionsService.listProductDiscounts(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('product-discounts')
  @ApiOperation({ summary: 'Create a product discount (ADMIN)' })
  createProductDiscount(@Body() dto: CreateProductDiscountDto) {
    return this.promotionsService.createProductDiscount(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('product-discounts/:id')
  @ApiOperation({ summary: 'Activate / deactivate a product discount (ADMIN)' })
  updateProductDiscount(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDiscountStatusDto,
  ) {
    return this.promotionsService.updateProductDiscountStatus(id, dto.status);
  }

  // Flash sales
  @Public()
  @Get('flash-sales')
  @ApiOperation({ summary: 'List flash sales (status filter)' })
  listFlashSales(@Query() query: PromotionQueryDto) {
    return this.promotionsService.listFlashSales(query);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post('flash-sales')
  @ApiOperation({ summary: 'Create a flash sale (ADMIN)' })
  createFlashSale(@Body() dto: CreateFlashSaleDto) {
    return this.promotionsService.createFlashSale(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('flash-sales/:id')
  @ApiOperation({ summary: 'Activate / deactivate a flash sale (ADMIN)' })
  updateFlashSale(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFlashSaleStatusDto,
  ) {
    return this.promotionsService.updateFlashSaleStatus(id, dto.status);
  }
}
