import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
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
import { OptionalJwtAuthGuard } from '../evidence/optional-jwt-auth.guard.js';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({
    summary: 'List publicly visible products (search/categoryId/partnerId filters)',
    description:
      'Guests and CUSTOMERs only see ACTIVE products whose partner is ACTIVE ' +
      'and VERIFIED; the `status` parameter is ignored for them. Every variant ' +
      'includes the backend-resolved `effectivePrice` (flash sale > product ' +
      'discount > base price) and `availableQuantity` / `inStock`.',
  })
  findAll(
    @Query() query: ProductQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    // The optional guard recognises a valid ADMIN token (the public filter is
    // applied to anonymous/customer callers); a query parameter can never
    // widen the public set.
    return this.productsService.findAll(query, user);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('admin')
  @ApiOperation({
    summary: 'List products including INACTIVE ones (status filter, ADMIN)',
  })
  findAllAdmin(
    @Query() query: ProductQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // ADMIN identity suppresses the public partner gate.
    return this.productsService.findAll(query, user);
  }

  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('admin/:id')
  @ApiOperation({ summary: 'Get any product, including INACTIVE (ADMIN)' })
  findOneAdmin(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.findOne(id, user);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({
    summary: 'Get a publicly visible product with variants, images and effective prices',
    description:
      'A hidden product (INACTIVE, or owned by a PENDING/REJECTED/INACTIVE ' +
      'partner) is indistinguishable from a missing one: 404.',
  })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    // Direct access to a product outside public visibility is a 404, exactly
    // like the list: the backend enforces it, not the storefront.
    return this.productsService.findOne(id, user);
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
