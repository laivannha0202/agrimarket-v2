import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  MAX_IMAGES_PER_PRODUCT,
  ProductImagesService,
} from '../../src/products/product-images.service.js';

/**
 * Image upload validation without touching MySQL: the Prisma client is stubbed
 * and only the file checks (extension, magic bytes, size, dimensions) plus
 * the optimisation output are asserted. The full flow (auth, DB rows, files on
 * disk, static serving) is covered by the e2e suite on the TEST database.
 */
async function testPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 160, b: 90 } },
  })
    .png()
    .toBuffer();
}

function serviceWith(prisma: unknown): ProductImagesService {
  return new ProductImagesService(
    prisma as unknown as ConstructorParameters<typeof ProductImagesService>[0],
  );
}

describe('product image validation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('accepts a real PNG and caps the longest side at 1600 px', async () => {
    const svc = serviceWith({});
    const raw = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .png()
      .toBuffer();
    const out = await svc.validateAndProcess(raw, 'anh.png');
    expect(out.mime).toBe('image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
  });

  it('rejects a renamed script (extension/magic mismatch)', async () => {
    const svc = serviceWith({});
    const fake = Buffer.from('console.log("not an image")');
    await expect(svc.validateAndProcess(fake, 'evil.jpg')).rejects.toThrow(/không phải ảnh/);
  });

  it('rejects disallowed extensions', async () => {
    const svc = serviceWith({});
    const raw = await testPng(300, 300);
    await expect(svc.validateAndProcess(raw, 'anh.gif')).rejects.toThrow(/JPG, PNG/);
    await expect(svc.validateAndProcess(raw, 'anh.svg')).rejects.toThrow(/JPG, PNG/);
  });

  it('rejects oversized uploads', async () => {
    const svc = serviceWith({});
    const big = Buffer.alloc(6 * 1024 * 1024, 0);
    await expect(svc.validateAndProcess(big, 'big.jpg')).rejects.toThrow(/5 MB/);
  });

  it('rejects tiny images', async () => {
    const svc = serviceWith({});
    const raw = await testPng(20, 20);
    await expect(svc.validateAndProcess(raw, 'tiny.png')).rejects.toThrow(/quá nhỏ/);
  });

  it('exposes the per-product image cap', () => {
    expect(MAX_IMAGES_PER_PRODUCT).toBe(6);
  });
});
