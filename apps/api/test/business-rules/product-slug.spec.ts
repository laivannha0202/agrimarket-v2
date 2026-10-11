import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../../src/common/utils/slug.util.js';

/**
 * Slug generation for the product form: the admin suggests the slug from the
 * name, the backend guarantees uniqueness. Never hand-written, never guessed.
 */
describe('slugify', () => {
  it('transliterates Vietnamese names', () => {
    expect(slugify('Cà chua bi đỏ')).toBe('ca-chua-bi-do');
    expect(slugify('Gạo nếp cái hoa vàng')).toBe('gao-nep-cai-hoa-vang');
    expect(slugify('Ớt chuông đỏ')).toBe('ot-chuong-do');
    expect(slugify('Xà lách lô tô')).toBe('xa-lach-lo-to');
  });

  it('collapses separators and trims dashes', () => {
    expect(slugify('  Rau   muống / hạt!! ')).toBe('rau-muong-hat');
  });

  it('falls back for empty input', () => {
    expect(slugify('')).toBe('san-pham');
    expect(slugify('---')).toBe('san-pham');
  });

  it('keeps the backend slug pattern', () => {
    for (const name of ['Cải ngọt Hưng Yên', 'Dưa leo baby 500G', 'Nhãn lồng (Hưng Yên)']) {
      expect(slugify(name)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when free', async () => {
    const slug = await uniqueSlug('Cà chua bi đỏ', async () => false);
    expect(slug).toBe('ca-chua-bi-do');
  });

  it('appends a counter while taken', async () => {
    const taken = new Set(['ca-chua-bi-do', 'ca-chua-bi-do-2']);
    const slug = await uniqueSlug('Cà chua bi đỏ', async (s) => taken.has(s));
    expect(slug).toBe('ca-chua-bi-do-3');
  });
});
