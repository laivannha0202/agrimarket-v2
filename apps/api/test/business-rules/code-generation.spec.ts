import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDatedCode,
  datedCodePrefix,
  formatSequence,
  isUniqueViolationOn,
  nextDatedSequence,
  nextSequence,
  uniqueViolationTarget,
} from '../../src/common/utils/code.util.js';
import { claimSequence } from '../../src/common/utils/code-sequence.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';
import { FLAT_SHIPPING_FEE, calculateShippingFee } from '../../src/orders/shipping-policy.js';

/**
 * Code generation and the shipping-fee policy are the two "small" helpers the
 * order flow depends on, so they are tested directly instead of only through
 * the services that call them.
 */
describe('dated code sequences', () => {
  const day = new Date('2026-04-15T10:00:00Z');

  it('starts at 1 when the day has no codes yet', () => {
    expect(nextDatedSequence([], 'ORD', day)).toBe(1);
  });

  it('continues after the highest existing code of the same day', () => {
    const codes = ['ORD-20260415-0001', 'ORD-20260415-0003', 'ORD-20260415-0002'];
    expect(nextDatedSequence(codes, 'ORD', day)).toBe(4);
  });

  it('does not reuse a number after a deletion (count+1 would)', () => {
    // Rows 1 and 3 exist, row 2 was deleted: a row count of 2 would hand out
    // 0003 again and collide with the existing row.
    const codes = ['ORD-20260415-0001', 'ORD-20260415-0003'];
    expect(nextDatedSequence(codes, 'ORD', day)).toBe(4);
  });

  it('ignores other days, other prefixes and unrelated codes', () => {
    const codes = [
      'ORD-20260414-0009',
      'ORD-20260416-0007',
      'SHP-20260415-0005',
      'SET-0004',
      'not-a-code',
    ];
    expect(nextDatedSequence(codes, 'ORD', day)).toBe(1);
  });

  it('reads suffixed partner-order codes as their own sequence', () => {
    const codes = ['ORD-20260415-0001', 'ORD-20260415-0003-P01', 'ORD-20260415-0003-P02'];
    expect(nextDatedSequence(codes, 'ORD', day)).toBe(4);
  });

  it('builds codes with the documented shape', () => {
    expect(datedCodePrefix('ORD', day)).toBe('ORD-20260415-');
    expect(buildDatedCode('ORD', 7, day)).toBe('ORD-20260415-0007');
    expect(formatSequence(7, 2)).toBe('07');
  });
});

describe('plain code sequences', () => {
  it('continues after the highest existing code', () => {
    expect(nextSequence([], 'SET')).toBe(1);
    expect(nextSequence(['SET-0001', 'SET-0004', 'SET-0002'], 'SET')).toBe(5);
  });

  it('does not reuse a number after a deletion', () => {
    expect(nextSequence(['SET-0001', 'SET-0003'], 'SET')).toBe(4);
  });

  it('ignores other prefixes', () => {
    expect(nextSequence(['PAY-20260415-0009', 'FARM-0004'], 'SET')).toBe(1);
  });
});

describe('atomic code counter', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('claims with one atomic INSERT ... ON DUPLICATE KEY UPDATE', async () => {
    // Prisma's `upsert` compiles to SELECT-then-INSERT, so two concurrent
    // claimers can both miss the row and collide (verified: 5/20 failed). The
    // counter must be a single statement.
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$queryRaw.mockResolvedValue([{ value: 7 }]);

    const value = await claimSequence(prisma as never, 'ORD-20260415-', 6);

    expect(value).toBe(7);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reads the counter back as a number even when the driver returns a bigint', async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$queryRaw.mockResolvedValue([{ value: 42n }]);

    await expect(claimSequence(prisma as never, 'ORD-20260415-')).resolves.toBe(42);
  });

  it('throws when the counter row cannot be read back', async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(claimSequence(prisma as never, 'ORD-20260415-')).rejects.toThrow(
      /could not be claimed/,
    );
  });
});

describe('unique-violation detection', () => {
  it('normalises the P2002 target from a string or an array', () => {
    expect(uniqueViolationTarget({ meta: { target: 'orders_code_key' } })).toBe('orders_code_key');
    expect(uniqueViolationTarget({ meta: { target: ['code'] } })).toBe('code');
    expect(uniqueViolationTarget({ meta: {} })).toBe('');
    expect(uniqueViolationTarget(new Error('nope'))).toBe('');
  });

  it('reads the index name out of a driver-adapter error', () => {
    // Shape produced by @prisma/adapter-mariadb: there is no `meta.target`, the
    // violated index lives on the wrapped driver error. Without this the retry
    // logic silently never fired and concurrent writes failed with a 409.
    const adapterError = {
      code: 'P2002',
      meta: {
        modelName: 'Order',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '1062',
            originalMessage:
              "Duplicate entry 'ORD-20260415-0001' for key 'orders.orders_code_key'",
            kind: 'UniqueConstraintViolation',
            constraint: { index: 'orders_code_key', table: 'orders' },
          },
        },
      },
    };
    expect(uniqueViolationTarget(adapterError)).toBe('orders_code_key');
    expect(isUniqueViolationOn(adapterError, 'code')).toBe(true);
    expect(isUniqueViolationOn(adapterError, 'checkout_idempotency_keys')).toBe(false);
  });

  it('falls back to the raw driver message when no index name is reported', () => {
    const error = {
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: {
            originalMessage: "Duplicate entry 'X' for key 'product_lots.product_lots_trace_code_key'",
          },
        },
      },
    };
    expect(isUniqueViolationOn(error, 'trace_code')).toBe(true);
  });

  it('matches only P2002 errors with a matching target', () => {
    const mysqlError = { code: 'P2002', meta: { target: 'orders_code_key' } };
    expect(isUniqueViolationOn(mysqlError, 'code')).toBe(true);
    expect(isUniqueViolationOn(mysqlError, 'orders_code_key')).toBe(true);
    expect(isUniqueViolationOn(mysqlError, 'sku')).toBe(false);
    expect(isUniqueViolationOn({ code: 'P2003', meta: { target: 'code' } }, 'code')).toBe(false);
    expect(isUniqueViolationOn(null, 'code')).toBe(false);
  });

  it('accepts any of the given needles (code OR trace_code)', () => {
    // Both lot indexes must trigger the retry: a clash on either one is a code
    // collision, and the index names do not contain each other.
    const codeClash = { code: 'P2002', meta: { target: 'product_lots_code_key' } };
    const traceClash = { code: 'P2002', meta: { target: 'product_lots_trace_code_key' } };
    expect(isUniqueViolationOn(codeClash, 'code', 'trace_code')).toBe(true);
    expect(isUniqueViolationOn(traceClash, 'code', 'trace_code')).toBe(true);
    expect(isUniqueViolationOn(codeClash, 'sku')).toBe(false);
  });
});

describe('shipping policy', () => {
  it('charges one flat fee per order with items', () => {
    expect(calculateShippingFee(1)).toBe(FLAT_SHIPPING_FEE);
    expect(calculateShippingFee(500_000)).toBe(FLAT_SHIPPING_FEE);
  });

  it('never charges for an empty order', () => {
    expect(calculateShippingFee(0)).toBe(0);
    expect(calculateShippingFee(-5)).toBe(0);
    expect(calculateShippingFee(Number.NaN)).toBe(0);
  });
});
