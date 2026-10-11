import { describe, expect, it, vi } from 'vitest';
import { LocationsService } from '../../src/locations/locations.service.js';
import { MAX_WARD_LIMIT } from '../../src/locations/dto/location.dto.js';
import { createMockPrisma } from '../helpers/prisma-mock.js';

/**
 * Unit coverage for the commune catalogue service.
 *
 * The e2e suite already proves the HTTP contract against a real database. What
 * is asserted HERE is the behaviour a database cannot show: that the catalogue
 * is read once and then served from cache, and that the search really folds
 * accents rather than relying on the database collation.
 *
 * The search assertions matter because the stored `searchText` and the incoming
 * query are produced by the SAME folding function. If the service ever stopped
 * folding the query, the two sides would silently stop matching and search
 * would break for every accent-less query — the exact case it exists for.
 */

const PROVINCE = { code: '33', name: 'Hưng Yên', fullName: 'Tỉnh Hưng Yên' };

/** Real catalogue rows, with the haystack the importer would have stored. */
const WARDS = [
  {
    code: '11953',
    provinceCode: '33',
    type: 'phuong',
    name: 'Phố Hiến',
    fullName: 'Phường Phố Hiến',
    searchText: 'phuong pho hien',
    effectiveFrom: '2025-07-01',
    status: 'ACTIVE',
  },
  {
    code: '03210',
    provinceCode: '33',
    type: 'xa',
    name: 'Tân Quang',
    fullName: 'Xã Tân Quang',
    searchText: 'xa tan quang',
    effectiveFrom: '2025-07-01',
    status: 'ACTIVE',
  },
  {
    code: '12345',
    provinceCode: '33',
    type: 'xa',
    name: 'Đồng Than',
    fullName: 'Xã Đồng Than',
    searchText: 'xa dong than',
    effectiveFrom: '2025-07-01',
    status: 'ACTIVE',
  },
];

function setup() {
  const prisma = createMockPrisma();
  prisma.province.findMany.mockResolvedValue([PROVINCE]);
  prisma.province.findUnique.mockResolvedValue(PROVINCE);
  prisma.ward.findMany.mockResolvedValue(WARDS);
  const service = new LocationsService(prisma as never);
  return { prisma, service };
}

describe('LocationsService', () => {
  describe('provinces', () => {
    it('returns the catalogue province', async () => {
      const { service } = setup();
      await expect(service.listProvinces()).resolves.toEqual([
        { code: '33', name: 'Hưng Yên', fullName: 'Tỉnh Hưng Yên' },
      ]);
    });

    it('serves the province list from cache on the second call', async () => {
      const { prisma, service } = setup();
      await service.listProvinces();
      await service.listProvinces();
      expect(prisma.province.findMany).toHaveBeenCalledTimes(1);
    });

    it('404s an unknown province', async () => {
      const { service } = setup();
      await expect(service.getProvince('99')).rejects.toThrow(/Province not found/);
    });
  });

  describe('listWards', () => {
    it('returns every commune with its code as a STRING', async () => {
      const { service } = setup();
      const result = await service.listWards('33');

      expect(result.meta.total).toBe(3);
      for (const ward of result.data) {
        // A 5-digit code with a leading zero must survive as text: `03210`
        // would become 3210 as a number and no longer identify the commune.
        expect(typeof ward.code).toBe('string');
        expect(ward.code).toMatch(/^\d{5}$/);
      }
    });

    it('never leaks the internal search haystack', async () => {
      const { service } = setup();
      const result = await service.listWards('33');
      for (const ward of result.data) {
        expect(ward).not.toHaveProperty('searchHaystack');
        expect(ward).not.toHaveProperty('searchText');
      }
    });

    it('returns all 104-style rows in one default page', async () => {
      // The address picker loads the whole catalogue in a single call. The
      // generic page cap is 100, which would silently truncate it.
      const { prisma, service } = setup();
      const many = Array.from({ length: 104 }, (_, i) => ({
        ...WARDS[0],
        code: String(10000 + i),
        name: `Xã ${i}`,
        fullName: `Xã ${i}`,
        searchText: `xa ${i}`,
      }));
      prisma.ward.findMany.mockResolvedValue(many);

      const result = await service.listWards('33');
      expect(result.data).toHaveLength(104);
      expect(result.meta.total).toBe(104);
    });

    it('returns all 104 rows when a client asks for the limit it uses (200)', async () => {
      // Both frontends send `limit: 200`. Clamping to the generic 100-row page
      // cap here would drop the last four communes from the picker, leaving
      // them impossible to select anywhere in the product.
      const { prisma, service } = setup();
      const many = Array.from({ length: 104 }, (_, i) => ({
        ...WARDS[0],
        code: String(10000 + i),
        name: `Xã ${i}`,
        fullName: `Xã ${i}`,
        searchText: `xa ${i}`,
      }));
      prisma.ward.findMany.mockResolvedValue(many);

      const result = await service.listWards('33', { limit: 200 });
      expect(result.meta.limit).toBe(200);
      expect(result.data).toHaveLength(104);
      expect(result.data.map((w) => w.code)).toContain('10103');
    });

    it('folds accents in the query so an unaccented search matches', async () => {
      const { service } = setup();

      const lower = await service.listWards('33', { search: 'pho hien' });
      expect(lower.data.map((w) => w.code)).toEqual(['11953']);

      const upper = await service.listWards('33', { search: 'PHO HIEN' });
      expect(upper.data.map((w) => w.code)).toEqual(['11953']);
    });

    it('matches the đ/Đ letter, which Unicode does not decompose', async () => {
      const { service } = setup();

      const withLetter = await service.listWards('33', { search: 'dong than' });
      expect(withLetter.data.map((w) => w.code)).toEqual(['12345']);

      const accented = await service.listWards('33', { search: 'Đồng Than' });
      expect(accented.data.map((w) => w.code)).toEqual(['12345']);
    });

    it('finds a commune by its code', async () => {
      const { service } = setup();
      const result = await service.listWards('33', { search: '03210' });
      expect(result.data.map((w) => w.code)).toEqual(['03210']);
    });

    it('returns an empty page rather than the whole list when nothing matches', async () => {
      const { service } = setup();
      const result = await service.listWards('33', { search: 'khong-co-xa-nao' });
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('caches the province catalogue across searches', async () => {
      const { prisma, service } = setup();
      await service.listWards('33', { search: 'pho' });
      await service.listWards('33', { search: 'tan' });
      expect(prisma.ward.findMany).toHaveBeenCalledTimes(1);
    });

    it('clamps a limit above the ward cap', async () => {
      const { prisma, service } = setup();
      const result = await service.listWards('33', { limit: 10_000 });
      expect(result.meta.limit).toBe(MAX_WARD_LIMIT);
      // The cap is applied in memory, so the query is still issued once.
      expect(prisma.ward.findMany).toHaveBeenCalledTimes(1);
    });

    it('404s the communes of an unknown province', async () => {
      const { service } = setup();
      await expect(service.listWards('99')).rejects.toThrow(/Province not found/);
    });
  });

  describe('findWard — the server-side address gate', () => {
    it('resolves a real code to its official name', async () => {
      const { service } = setup();
      const ward = await service.findWard('33', '11953');
      expect(ward?.fullName).toBe('Phường Phố Hiến');
      expect(ward?.provinceName).toBe('Hưng Yên');
    });

    it('returns null for a code that does not exist', async () => {
      const { service } = setup();
      await expect(service.findWard('33', '00000')).resolves.toBeNull();
    });

    it('returns null for an unknown province instead of a stray ward', async () => {
      const { prisma, service } = setup();
      prisma.province.findUnique.mockResolvedValue(null);
      await expect(service.findWard('99', '11953')).resolves.toBeNull();
    });

    it('returns null when either code is missing', async () => {
      const { service } = setup();
      await expect(service.findWard('', '11953')).resolves.toBeNull();
      await expect(service.findWard('33', '')).resolves.toBeNull();
    });

    it('does not accept a code from another province', async () => {
      const { prisma, service } = setup();
      // Province 99 exists, but the ward belongs to 33. The lookup is scoped by
      // province, so the foreign code must not resolve.
      prisma.province.findUnique.mockResolvedValue({
        code: '99',
        name: 'Tỉnh Khác',
        fullName: 'Tỉnh Khác',
      });
      prisma.ward.findMany.mockResolvedValue([]);
      await expect(service.findWard('99', '11953')).resolves.toBeNull();
    });

    it('throws a 404 from findWardOrFail', async () => {
      const { service } = setup();
      await expect(service.findWardOrFail('33', '00000')).rejects.toThrow(/Ward not found/);
    });
  });

  describe('countWards', () => {
    it('counts the whole catalogue, not just the first page', async () => {
      const { prisma, service } = setup();
      const many = Array.from({ length: 104 }, (_, i) => ({
        ...WARDS[0],
        code: String(10000 + i),
        searchText: `xa ${i}`,
      }));
      prisma.ward.findMany.mockResolvedValue(many);

      await expect(service.countWards('33')).resolves.toBe(104);
    });
  });

  describe('cache expiry', () => {
    it('re-reads the catalogue once the cache entry expires', async () => {
      vi.useFakeTimers();
      try {
        const { prisma, service } = setup();
        await service.listProvinces();
        // The TTL is 10 minutes; step just past it.
        vi.advanceTimersByTime(10 * 60 * 1000 + 1);
        await service.listProvinces();
        expect(prisma.province.findMany).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
