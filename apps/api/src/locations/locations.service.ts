import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { foldVietnamese } from '../common/utils/vietnamese-text.js';
import type { PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { MAX_WARD_LIMIT, type WardQueryDto } from './dto/location.dto.js';

/**
 * Partial query accepted by `listWards`. The DTO fills `page`/`limit` defaults
 * when the request comes over HTTP; server-side callers may omit them entirely.
 */
export type WardQueryInput = Partial<WardQueryDto>;

/**
 * Read-only access to the verified administrative catalogue.
 *
 * This is the ONLY place in the codebase that reads the `wards` table, so the
 * 104 Hưng Yên units exist exactly once — every client (Customer Web, Mobile,
 * Admin) and every server-side validation goes through here rather than
 * embedding its own copy of the list.
 *
 * The catalogue is static reference data (it only changes when the Government
 * publishes a new resolution), so lookups are cached in memory. The cache is
 * what makes the address picker cheap: opening the form does not hit the
 * database at all after the first call.
 */

/** How long a cached catalogue entry is trusted before it is re-read. */
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface ProvinceView {
  code: string;
  name: string;
  fullName: string;
}

export interface WardView {
  code: string;
  fullName: string;
  name: string;
  type: string;
  provinceCode: string;
  provinceName: string;
  effectiveFrom: string | null;
  status: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Province list. Cached as one array because the storefront only ships
   * inside Hưng Yên: this is not a nationwide selector, and pretending
   * otherwise would imply delivery coverage the business does not have.
   */
  private provincesCache: CacheEntry<ProvinceView[]> | null = null;

  /**
   * Ward list keyed by province, cached whole. Every ward of a province is
   * cached together (there are 104 of them) and filtered in memory, so a search
   * never issues a query.
   */
  private wardsCache = new Map<string, CacheEntry<CachedWard[]>>();

  async listProvinces(): Promise<ProvinceView[]> {
    const cached = this.readCache(this.provincesCache);
    if (cached) return cached;

    const rows = await this.prisma.province.findMany({ orderBy: { code: 'asc' } });
    const value: ProvinceView[] = rows.map((row) => ({
      code: row.code,
      name: row.name,
      fullName: row.fullName,
    }));
    this.provincesCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  /**
   * One province by code, or 404. Used by the ward routes so an unknown
   * province is rejected explicitly instead of returning an empty list that
   * looks like "this province has no communes".
   */
  async getProvince(code: string): Promise<ProvinceView> {
    const provinces = await this.listProvinces();
    const province = provinces.find((p) => p.code === code);
    if (!province) throw new NotFoundException('Province not found');
    return province;
  }

  /**
   * Communes of one province, optionally filtered by `search`.
   *
   * Search is accent- and case-insensitive and matches BOTH the name and the
   * code, so "pho hien", "PHO HIEN" and "11953" all find Phường Phố Hiến. The
   * incoming query is folded with the same function that produced each row's
   * `searchText`, which is what guarantees the two can never disagree.
   */
  async listWards(
    provinceCode: string,
    query: WardQueryInput = {},
  ): Promise<PaginatedResult<WardView>> {
    const province = await this.getProvince(provinceCode);
    const all = await this.wardsOf(province.code, province.name);

    const search = query.search?.trim() ? foldVietnamese(query.search) : '';
    const filtered = search
      ? all.filter(
          (ward) =>
            ward.searchHaystack.includes(search) || ward.code.toLowerCase().includes(search),
        )
      : all;

    const page = Number.isFinite(query.page) && (query.page ?? 0) > 0 ? Math.floor(query.page as number) : 1;
    // Clamped with the WARD cap, not the generic page cap: the catalogue is 104
    // rows and clients ask for all of them in one call.
    const limit =
      Number.isFinite(query.limit) && (query.limit ?? 0) > 0
        ? Math.min(Math.floor(query.limit as number), MAX_WARD_LIMIT)
        : MAX_WARD_LIMIT;
    const skip = (page - 1) * limit;

    return {
      data: filtered.slice(skip, skip + limit).map(stripHaystack),
      meta: {
        page,
        limit,
        total: filtered.length,
        totalPages: limit > 0 ? Math.ceil(filtered.length / limit) : 0,
      },
    };
  }

  /**
   * Resolves one commune code to its official row, or `null` when the code is
   * not part of the verified catalogue.
   *
   * This is the server-side gate for address validation: a client cannot invent
   * a ward code, and a code belonging to another province cannot be smuggled
   * into an address. Callers must treat `null` as a validation failure.
   */
  async findWard(provinceCode: string, wardCode: string): Promise<WardView | null> {
    if (!provinceCode || !wardCode) return null;
    const province = await this.prisma.province.findUnique({ where: { code: provinceCode } });
    if (!province) return null;
    const wards = await this.wardsOf(province.code, province.name);
    const ward = wards.find((w) => w.code === wardCode);
    return ward ? stripHaystack(ward) : null;
  }

  /** Same as `findWard`, but throws a 404 instead of returning `null`. */
  async findWardOrFail(provinceCode: string, wardCode: string): Promise<WardView> {
    const ward = await this.findWard(provinceCode, wardCode);
    if (!ward) throw new NotFoundException('Ward not found');
    return ward;
  }

  /** Total number of active communes in a province — used by tests/diagnostics. */
  async countWards(provinceCode: string): Promise<number> {
    const wards = await this.listWards(provinceCode, { limit: MAX_WARD_LIMIT });
    return wards.meta.total;
  }

  /** Drops the internal haystack before a row leaves the service. */
  private readCache<T>(entry: CacheEntry<T> | null): T | null {
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }

  private async wardsOf(provinceCode: string, provinceName: string): Promise<CachedWard[]> {
    const cached = this.readCache(this.wardsCache.get(provinceCode) ?? null);
    if (cached) return cached;

    const rows = await this.prisma.ward.findMany({
      where: { provinceCode },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    const value: CachedWard[] = rows.map((row) => ({
      code: row.code,
      fullName: row.fullName,
      name: row.name,
      type: row.type,
      provinceCode: row.provinceCode,
      provinceName,
      effectiveFrom: row.effectiveFrom,
      status: row.status,
      searchHaystack: row.searchText,
    }));
    this.wardsCache.set(provinceCode, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}

/** A ward plus the internal search haystack that is never sent to a client. */
interface CachedWard extends WardView {
  searchHaystack: string;
}

function stripHaystack(ward: CachedWard): WardView {
  const { searchHaystack: _searchHaystack, ...rest } = ward;
  return rest;
}
