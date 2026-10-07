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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service.js';
import { CreateProductDto, CreateVariantDto, UpdateProductDto } from './dto/product.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({ name: 'partnerId', required: false, type: Number })
  @ApiOperation({ summary: 'List products' })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('categoryId') categoryId?: string,
    @Query('partnerId') partnerId?: string,
  ) {
    return this.productsService.findAll({
      ...query,
      categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
      partnerId: partnerId ? parseInt(partnerId, 10) : undefined,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a product with variants and images' })
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
}
