import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import {
  MAX_IMAGE_BYTES,
  ProductImagesService,
} from './product-images.service.js';
import { ReorderImagesDto } from './dto/product.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';

function baseUrlOf(req: Request): string {
  const configured = (process.env.PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return `${proto}://${req.get('host')}`;
}

function uploadField(field: 'file') {
  return FileInterceptor(field, {
    storage: memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES + 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return cb(null, true);
      cb(
        new BadRequestException('Chỉ nhận ảnh JPG, PNG hoặc WebP.') as unknown as Error,
        false,
      );
    },
  });
}

const multipartBody = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

@ApiTags('product-images')
@Controller('products/:id/images')
@Roles('ADMIN')
@ApiBearerAuth()
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post()
  @ApiOperation({ summary: 'Upload an image for a product (ADMIN, multipart)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipartBody)
  @UseInterceptors(uploadField('file'))
  upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.images.addImage(id, file, baseUrlOf(req));
  }

  @Post(':imageId/replace')
  @ApiOperation({ summary: 'Replace an image file, keeping order and cover flag (ADMIN)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipartBody)
  @UseInterceptors(uploadField('file'))
  replace(
    @Param('id', ParseIntPipe) id: number,
    @Param('imageId', ParseIntPipe) imageId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.images.replaceImage(id, imageId, file, baseUrlOf(req));
  }

  @Patch(':imageId/primary')
  @ApiOperation({ summary: 'Set an image as the product cover (ADMIN)' })
  setPrimary(
    @Param('id', ParseIntPipe) id: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ) {
    return this.images.setPrimary(id, imageId);
  }

  @Patch('order')
  @ApiOperation({ summary: 'Reorder product images (ADMIN)' })
  reorder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.images.reorder(id, dto.orderedIds);
  }

  @Delete(':imageId')
  @ApiOperation({ summary: 'Delete a product image and its file (ADMIN)' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ) {
    return this.images.removeImage(id, imageId);
  }
}
