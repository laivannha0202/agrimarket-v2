import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { PrismaService } from '../database/prisma.service.js';
import type { ProductImage } from '../../generated/prisma/client.js';

/** Max images kept per product (new uploads beyond this are rejected). */
export const MAX_IMAGES_PER_PRODUCT = 6;
/** Max accepted upload size: 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Longest side after optimisation; smaller images are never enlarged. */
const MAX_SIDE_PX = 1600;
const MIN_SIDE_PX = 100;
const MAX_META_SIDE_PX = 6000;

const ALLOWED: Record<string, { ext: 'jpg' | 'png' | 'webp'; mime: string }> = {
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

export interface ProcessedImage {
  buffer: Buffer;
  ext: 'jpg' | 'png' | 'webp';
  mime: string;
  width: number;
  height: number;
}

export function uploadsRoot(): string {
  const configured = (process.env.UPLOADS_DIR ?? '').trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), 'uploads');
}

export function productImagesDir(): string {
  return path.join(uploadsRoot(), 'products');
}

/** Absolute public URL for a stored product-image file. */
export function publicImageUrl(fileName: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/uploads/products/${fileName}`;
}

@Injectable()
export class ProductImagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a raw upload and return an optimised buffer.
   *
   * Checks, in order: byte size, file extension, real magic bytes, decoded
   * dimensions. The output is resized so the longest side is at most 1600 px
   * (never enlarged) at quality 82 — sharp enough for catalog/hero use,
   * far smaller than a phone photo.
   */
  async validateAndProcess(
    buffer: Buffer,
    originalName: string,
  ): Promise<ProcessedImage> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Tệp ảnh trống. Vui lòng chọn tệp khác.');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Ảnh vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.');
    }
    const ext = (originalName.split('.').pop() ?? '').toLowerCase();
    const allowed = ALLOWED[ext];
    if (!allowed) {
      throw new BadRequestException('Chỉ nhận ảnh JPG, PNG hoặc WebP.');
    }

    // Real content check: the magic bytes must agree with the extension, so a
    // renamed script/archive cannot pass as an image.
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || detected.mime !== allowed.mime) {
      throw new BadRequestException(
        'Tệp không phải ảnh hợp lệ. Vui lòng tải lên ảnh JPG, PNG hoặc WebP thật.',
      );
    }

    let meta: Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException('Không đọc được ảnh. Tệp có thể đã hỏng.');
    }
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      throw new BadRequestException('Không đọc được kích thước ảnh.');
    }
    if (width < MIN_SIDE_PX || height < MIN_SIDE_PX) {
      throw new BadRequestException(
        `Ảnh quá nhỏ (${width}x${height}). Kích thước tối thiểu ${MIN_SIDE_PX}x${MIN_SIDE_PX} px.`,
      );
    }
    if (width > MAX_META_SIDE_PX || height > MAX_META_SIDE_PX) {
      throw new BadRequestException(
        `Ảnh quá lớn (${width}x${height}). Kích thước tối đa ${MAX_META_SIDE_PX}x${MAX_META_SIDE_PX} px.`,
      );
    }

    const pipeline = sharp(buffer).rotate().resize({
      width: MAX_SIDE_PX,
      height: MAX_SIDE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const out =
      allowed.ext === 'jpg'
        ? await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
        : allowed.ext === 'webp'
          ? await pipeline.webp({ quality: 82 }).toBuffer()
          : await pipeline.png({ compressionLevel: 9 }).toBuffer();

    return { buffer: out, ext: allowed.ext, mime: allowed.mime, width, height };
  }

  async addImage(
    productId: number,
    file: Express.Multer.File | undefined,
    baseUrl: string,
  ): Promise<ProductImage> {
    await this.requireProduct(productId);
    if (!file) throw new BadRequestException('Chưa chọn tệp ảnh.');
    const existing = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
    if (existing.length >= MAX_IMAGES_PER_PRODUCT) {
      throw new BadRequestException(
        `Mỗi sản phẩm tối đa ${MAX_IMAGES_PER_PRODUCT} ảnh. Hãy xóa ảnh cũ trước khi thêm.`,
      );
    }
    const processed = await this.validateAndProcess(
      file.buffer,
      file.originalname,
    );
    const fileName = `${randomUUID()}.${processed.ext}`;
    await this.storeFile(fileName, processed.buffer);

    const nextOrder =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((i) => i.sortOrder)) + 1;
    return this.prisma.productImage.create({
      data: {
        productId,
        url: publicImageUrl(fileName, baseUrl),
        sortOrder: nextOrder,
        isPrimary: existing.length === 0,
        mimeType: processed.mime,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.buffer.length,
      },
    });
  }

  /** Replace the file behind an image row, keeping its order and primary flag. */
  async replaceImage(
    productId: number,
    imageId: number,
    file: Express.Multer.File | undefined,
    baseUrl: string,
  ): Promise<ProductImage> {
    await this.requireProduct(productId);
    if (!file) throw new BadRequestException('Chưa chọn tệp ảnh.');
    const current = await this.requireImage(productId, imageId);
    const processed = await this.validateAndProcess(
      file.buffer,
      file.originalname,
    );
    const fileName = `${randomUUID()}.${processed.ext}`;
    await this.storeFile(fileName, processed.buffer);
    const updated = await this.prisma.productImage.update({
      where: { id: imageId },
      data: {
        url: publicImageUrl(fileName, baseUrl),
        mimeType: processed.mime,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.buffer.length,
      },
    });
    await this.deleteFileForUrl(current.url);
    return updated;
  }

  /** Mark one image as the product cover; all others lose the flag. */
  async setPrimary(productId: number, imageId: number): Promise<ProductImage> {
    await this.requireProduct(productId);
    await this.requireImage(productId, imageId);
    await this.prisma.$transaction([
      this.prisma.productImage.updateMany({
        where: { productId },
        data: { isPrimary: false },
      }),
      this.prisma.productImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);
    return this.prisma.productImage.findUniqueOrThrow({ where: { id: imageId } });
  }

  /**
   * Reorder images. `orderedIds` must contain exactly the product's image ids
   * so a partial/stale list can never silently drop an image's position.
   */
  async reorder(productId: number, orderedIds: number[]): Promise<ProductImage[]> {
    await this.requireProduct(productId);
    const existing = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
    const current = new Set(existing.map((i) => i.id));
    const wanted = new Set(orderedIds);
    if (
      current.size !== wanted.size ||
      [...current].some((id) => !wanted.has(id))
    ) {
      throw new BadRequestException(
        'Danh sách sắp xếp không khớp với ảnh hiện có. Vui lòng tải lại và thử lại.',
      );
    }
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.productImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Delete an image row and its file. Product images are display-only (orders
   * keep name/price snapshots, never image references), so no in-use image
   * can be orphaned elsewhere. When the cover is deleted, the first remaining
   * image becomes the cover so the product never loses its representative.
   */
  async removeImage(productId: number, imageId: number): Promise<{ deleted: number }> {
    await this.requireProduct(productId);
    const current = await this.requireImage(productId, imageId);
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.deleteFileForUrl(current.url);

    if (current.isPrimary) {
      const next = await this.prisma.productImage.findFirst({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      });
      if (next) {
        await this.prisma.productImage.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }
    return { deleted: imageId };
  }

  private async requireProduct(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    return product;
  }

  private async requireImage(productId: number, imageId: number) {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image || image.productId !== productId) {
      throw new NotFoundException('Không tìm thấy ảnh của sản phẩm này.');
    }
    return image;
  }

  private async storeFile(fileName: string, buffer: Buffer): Promise<void> {
    // Random UUID file name inside our own directory: no path traversal and
    // no collisions with existing files.
    const safe = path.basename(fileName);
    await fs.mkdir(productImagesDir(), { recursive: true });
    await fs.writeFile(path.join(productImagesDir(), safe), buffer);
  }

  private async deleteFileForUrl(url: string): Promise<void> {
    const marker = '/uploads/products/';
    const idx = url.indexOf(marker);
    if (idx < 0) return; // External/seed URL: only the DB row is removed.
    const safe = path.basename(url.slice(idx + marker.length));
    if (!safe || safe === '.' || safe === '..') return;
    try {
      await fs.unlink(path.join(productImagesDir(), safe));
    } catch {
      // The file may already be gone (manual cleanup, previous retry).
    }
  }
}
