import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CategoryQueryDto } from '../../src/categories/dto/category.dto.js';
import { CertificateQueryDto } from '../../src/certificates/dto/certificate.dto.js';
import { ComplaintQueryDto } from '../../src/complaints/dto/complaint.dto.js';
import { FarmQueryDto } from '../../src/farms/dto/farm.dto.js';
import {
  CommissionRuleQueryDto,
  PayoutQueryDto,
  SettlementQueryDto,
} from '../../src/finance/dto/finance.dto.js';
import {
  InventoryMovementQueryDto,
  InventoryQueryDto,
} from '../../src/inventory/dto/inventory.dto.js';
import { WarehouseDocumentQueryDto } from '../../src/inventory/dto/warehouse-document.dto.js';
import { LotQueryDto } from '../../src/lots/dto/lot.dto.js';
import { MAX_WARD_LIMIT, WardQueryDto } from '../../src/locations/dto/location.dto.js';
import { OrderQueryDto } from '../../src/orders/dto/order-status.dto.js';
import { PartnerQueryDto } from '../../src/partners/dto/partner.dto.js';
import { PaymentQueryDto } from '../../src/payments/dto/payment.dto.js';
import { ProductQueryDto } from '../../src/products/dto/product.dto.js';
import { PromotionQueryDto } from '../../src/promotions/dto/promotion.dto.js';
import { QcQueryDto } from '../../src/quality-control/dto/qc.dto.js';
import { ReturnQueryDto } from '../../src/returns/dto/return.dto.js';
import { ReviewQueryDto } from '../../src/reviews/dto/review.dto.js';
import { SeasonQueryDto } from '../../src/seasons/dto/season.dto.js';
import { ShipmentQueryDto } from '../../src/shipments/dto/shipment.dto.js';
import { UserQueryDto } from '../../src/users/dto/user.dto.js';

/**
 * Query DTO contract for the list endpoints.
 *
 * Every list DTO extends PaginationQueryDto and narrows `status` to a real
 * Prisma enum, so the global ValidationPipe rejects unknown values with a 400
 * before the service can hand them to Prisma (which used to answer with a
 * PrismaClientValidationError mapped to a 500).
 */

type DtoCtor = new () => object;

interface EnumCase {
  name: string;
  dto: DtoCtor;
  valid: Record<string, unknown>;
  invalid: Record<string, unknown>;
}

const enumCases: EnumCase[] = [
  { name: 'ProductQueryDto', dto: ProductQueryDto, valid: { status: 'ACTIVE' }, invalid: { status: 'NOPE' } },
  { name: 'CategoryQueryDto', dto: CategoryQueryDto, valid: { status: 'INACTIVE' }, invalid: { status: 'NOPE' } },
  { name: 'LotQueryDto', dto: LotQueryDto, valid: { status: 'SELLABLE' }, invalid: { status: 'NOPE' } },
  { name: 'FarmQueryDto', dto: FarmQueryDto, valid: { status: 'ACTIVE' }, invalid: { status: 'NOPE' } },
  { name: 'PartnerQueryDto', dto: PartnerQueryDto, valid: { status: 'ACTIVE' }, invalid: { status: 'NOPE' } },
  { name: 'OrderQueryDto', dto: OrderQueryDto, valid: { status: 'DELIVERED' }, invalid: { status: 'NOPE' } },
  {
    name: 'CertificateQueryDto',
    dto: CertificateQueryDto,
    valid: { status: 'VERIFIED' },
    invalid: { status: 'NOPE' },
  },
  { name: 'ReviewQueryDto', dto: ReviewQueryDto, valid: { status: 'APPROVED' }, invalid: { status: 'NOPE' } },
  { name: 'PaymentQueryDto', dto: PaymentQueryDto, valid: { status: 'PAID' }, invalid: { status: 'NOPE' } },
  { name: 'ShipmentQueryDto', dto: ShipmentQueryDto, valid: { status: 'IN_TRANSIT' }, invalid: { status: 'NOPE' } },
  { name: 'ReturnQueryDto', dto: ReturnQueryDto, valid: { status: 'REQUESTED' }, invalid: { status: 'NOPE' } },
  { name: 'ComplaintQueryDto', dto: ComplaintQueryDto, valid: { status: 'OPEN' }, invalid: { status: 'NOPE' } },
  { name: 'SeasonQueryDto', dto: SeasonQueryDto, valid: { status: 'GROWING' }, invalid: { status: 'NOPE' } },
  {
    name: 'SettlementQueryDto',
    dto: SettlementQueryDto,
    valid: { status: 'DRAFT' },
    invalid: { status: 'NOPE' },
  },
  { name: 'PayoutQueryDto', dto: PayoutQueryDto, valid: { status: 'PENDING' }, invalid: { status: 'NOPE' } },
  {
    name: 'CommissionRuleQueryDto',
    dto: CommissionRuleQueryDto,
    valid: { status: 'ACTIVE' },
    invalid: { status: 'NOPE' },
  },
  {
    name: 'PromotionQueryDto',
    dto: PromotionQueryDto,
    valid: { status: 'ACTIVE' },
    invalid: { status: 'NOPE' },
  },
  {
    name: 'UserQueryDto',
    dto: UserQueryDto,
    valid: { status: 'ACTIVE', role: 'CUSTOMER' },
    invalid: { role: 'NOPE' },
  },
  {
    name: 'WarehouseDocumentQueryDto',
    dto: WarehouseDocumentQueryDto,
    valid: { status: 'DRAFT', type: 'INBOUND' },
    invalid: { type: 'NOPE' },
  },
  { name: 'QcQueryDto', dto: QcQueryDto, valid: { productLotId: '3' }, invalid: { productLotId: 'abc' } },
];

function validate(dto: DtoCtor, payload: Record<string, unknown>) {
  const instance = plainToInstance(dto, payload) as Record<string, unknown>;
  return { instance, errors: validateSync(instance) };
}

/**
 * Mirrors the global ValidationPipe in `main.ts`, which is what actually turns
 * a stray query param into a 400 in the running app.
 */
function validateAsPipe(dto: DtoCtor, payload: Record<string, unknown>) {
  const instance = plainToInstance(dto, payload) as Record<string, unknown>;
  return {
    instance,
    errors: validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe('List query DTOs', () => {
  describe.each(enumCases)('$name', ({ dto, valid, invalid }) => {
    it('accepts a valid enum value', () => {
      const { errors } = validate(dto, valid);
      expect(errors).toHaveLength(0);
    });

    it('rejects an unknown enum value with a validation error (→ HTTP 400)', () => {
      const { errors } = validate(dto, invalid);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts an empty query (all filters optional)', () => {
      const { errors } = validate(dto, {});
      expect(errors).toHaveLength(0);
    });
  });

  describe('pagination contract', () => {
    it('defaults page=1 and limit=20', () => {
      const { instance } = validate(ProductQueryDto, {});
      expect(instance.page).toBe(1);
      expect(instance.limit).toBe(20);
    });

    it('coerces string page/limit to numbers', () => {
      const { instance } = validate(ProductQueryDto, { page: '3', limit: '50' });
      expect(instance.page).toBe(3);
      expect(instance.limit).toBe(50);
    });

    it('rejects limit above the 100 cap', () => {
      const { errors } = validate(ProductQueryDto, { limit: '200' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a non-numeric page', () => {
      const { errors } = validate(ProductQueryDto, { page: 'abc' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('numeric id filters', () => {
    it('coerces categoryId/partnerId strings to numbers', () => {
      const { instance, errors } = validate(ProductQueryDto, { categoryId: '7', partnerId: '9' });
      expect(errors).toHaveLength(0);
      expect(instance.categoryId).toBe(7);
      expect(instance.partnerId).toBe(9);
    });

    it('coerces partnerId for farms', () => {
      const { instance, errors } = validate(FarmQueryDto, { partnerId: '4' });
      expect(errors).toHaveLength(0);
      expect(instance.partnerId).toBe(4);
    });

    it('coerces inventory warehouseId/productVariantId', () => {
      const { instance, errors } = validate(InventoryQueryDto, {
        warehouseId: '2',
        productVariantId: '5',
      });
      expect(errors).toHaveLength(0);
      expect(instance.warehouseId).toBe(2);
      expect(instance.productVariantId).toBe(5);
    });

    it('coerces inventory movement productLotId', () => {
      const { instance, errors } = validate(InventoryMovementQueryDto, { productLotId: '11' });
      expect(errors).toHaveLength(0);
      expect(instance.productLotId).toBe(11);
    });

    it('rejects a negative productLotId', () => {
      const { errors } = validate(QcQueryDto, { productLotId: '-1' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('coerces farmId for seasons and certificates', () => {
      const season = validate(SeasonQueryDto, { farmId: '3' });
      const cert = validate(CertificateQueryDto, { farmId: '3' });
      expect(season.errors).toHaveLength(0);
      expect(season.instance.farmId).toBe(3);
      expect(cert.errors).toHaveLength(0);
      expect(cert.instance.farmId).toBe(3);
    });
  });

  describe('shared search filter', () => {
    it('accepts a search string on every DTO that inherits it', () => {
      const { instance, errors } = validate(CategoryQueryDto, { search: 'cà chua' });
      expect(errors).toHaveLength(0);
      expect(instance.search).toBe('cà chua');
    });
  });

  /**
   * The commune catalogue has its OWN page cap.
   *
   * `MAX_PAGE_LIMIT` is 100, but Hưng Yên has 104 communes and the address
   * picker deliberately loads all of them in one request. Reusing the generic
   * cap here would silently truncate the list, leaving the last few communes
   * unselectable in every client.
   */
  describe('WardQueryDto', () => {
    it('defaults to the whole catalogue in one page', () => {
      const { instance, errors } = validate(WardQueryDto, {});
      expect(errors).toHaveLength(0);
      expect(instance.limit).toBe(200);
      expect(instance.page).toBe(1);
    });

    it('accepts the limit both clients send (200)', () => {
      const { instance, errors } = validate(WardQueryDto, { limit: '200' });
      expect(errors).toHaveLength(0);
      expect(instance.limit).toBe(200);
    });

    it('accepts a limit above the generic 100-row page cap', () => {
      const { errors } = validate(WardQueryDto, { limit: '500' });
      expect(errors).toHaveLength(0);
    });

    it('rejects a limit above the ward cap', () => {
      const { errors } = validate(WardQueryDto, { limit: String(MAX_WARD_LIMIT + 1) });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('has a cap strictly larger than the whole Hưng Yên catalogue', () => {
      // The catalogue is 104 rows. If the cap ever dropped to or below that,
      // the picker would start dropping communes.
      expect(MAX_WARD_LIMIT).toBeGreaterThan(104);
    });

    it('accepts an unaccented search and rejects an over-long one', () => {
      expect(validate(WardQueryDto, { search: 'pho hien' }).errors).toHaveLength(0);
      expect(validate(WardQueryDto, { search: 'x'.repeat(101) }).errors.length).toBeGreaterThan(0);
    });

    it('rejects an unknown query param (no silent no-op)', () => {
      const { errors } = validateAsPipe(WardQueryDto, { status: 'ACTIVE' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  /**
   * `/qc`, `/inventory` and `/inventory/movements` have no status column of
   * their own (the lot carries it) and their services do not search, so the
   * inherited `status`/`search` params are omitted instead of being advertised
   * as silent no-ops. With `forbidNonWhitelisted` a caller sending them gets a
   * 400 rather than a misleading 200.
   */
  describe('endpoints without status/search drop the inherited params', () => {
    const noStatus = [
      { name: 'QcQueryDto', dto: QcQueryDto },
      { name: 'InventoryQueryDto', dto: InventoryQueryDto },
      { name: 'InventoryMovementQueryDto', dto: InventoryMovementQueryDto },
    ];

    it.each(noStatus)('$name rejects an unknown `status`', ({ dto }) => {
      const { errors } = validateAsPipe(dto, { status: 'BOGUS' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it.each(noStatus)('$name rejects an unknown `search`', ({ dto }) => {
      const { errors } = validateAsPipe(dto, { search: 'anything' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it.each(noStatus)('$name still accepts page/limit', ({ dto }) => {
      const { instance, errors } = validate(dto, { page: '2', limit: '5' });
      expect(errors).toHaveLength(0);
      expect(instance.page).toBe(2);
      expect(instance.limit).toBe(5);
    });
  });
});
