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
import { ProductsService } from './products.service.js';
import {
  CreateProductDto,
  CreateVariantDto,
  ProductQueryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List products (search/status/categoryId/partnerId filters)',
    description:
      'Public. Every variant includes the backend-resolved `effectivePrice` ' +
      '(flash sale > product discount > base price) and `availableQuantity` / `inStock`.',
  })
  findAll(@Query() query: ProductQueryDto) {
    return this.productsService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a product with variants, images and effective prices' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a product with optional variants/images (ADMIN)' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product (ADMIN)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Post(':id/variants')
  @ApiOperation({ summary: 'Add a variant to a product (ADMIN)' })
  addVariant(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateVariantDto) {
    return this.productsService.addVariant(id, dto);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('variants/:variantId')
  @ApiOperation({
    summary: 'Update a variant name/price/status (ADMIN)',
    description:
      'Only name, basePrice (for NEW orders — past orders keep their price ' +
      'snapshot) and status may change. The SKU and unit fields are immutable. ' +
      'Setting status to INACTIVE stops the variant on new checkouts.',
  })
  updateVariant(
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateVariantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.updateVariant(variantId, dto, user.id);
  }
}
