import { vi } from 'vitest';

/**
 * Deep mock factory for PrismaService.
 *
 * Each model delegate exposes vitest mock functions. Tests override the
 * behaviour they care about, e.g.:
 *
 *   const prisma = createMockPrisma();
 *   prisma.productLot.findUnique.mockResolvedValue({ ... });
 *
 * `$transaction` runs the callback with the same mock so transactional
 * services behave normally. This keeps business-rule tests focused on logic.
 *
 * The concurrency fixes moved several invariants into the database itself, so
 * the services now use raw statements that the model delegates cannot express:
 *
 *   - `$executeRaw`  — the atomic conditional UPDATEs (`reserved = reserved + ?
 *     WHERE on_hand - reserved - blocked >= ?`, the flash-quota claim, the
 *     voucher usage claim, the `INSERT ... ON DUPLICATE KEY UPDATE` counter).
 *     It returns the number of affected rows, so the default is `1` (the claim
 *     won). A test that wants to exercise the guard rejects it with `0`.
 *   - `$queryRaw`    — the counter read-back. `claimSequence` throws when it
 *     gets no row, so the default is a single `code_sequences` row.
 *
 * These defaults are re-applied by `resetMockPrisma` so a `mockReset()` between
 * tests cannot silently strip them.
 */
type MockFn = ReturnType<typeof vi.fn>;

export interface MockDelegate {
  create: MockFn;
  createMany: MockFn;
  findMany: MockFn;
  findUnique: MockFn;
  findUniqueOrThrow: MockFn;
  findFirst: MockFn;
  findFirstOrThrow: MockFn;
  count: MockFn;
  aggregate: MockFn;
  groupBy: MockFn;
  update: MockFn;
  updateMany: MockFn;
  upsert: MockFn;
  delete: MockFn;
  deleteMany: MockFn;
}

const DELEGATE_METHODS: (keyof MockDelegate)[] = [
  'create',
  'createMany',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
];

const MODELS = [
  'user',
  'passwordResetToken',
  'customerProfile',
  'address',
  'province',
  'ward',
  'partner',
  'farm',
  'season',
  'farmingEvent',
  'harvest',
  'certificate',
  'category',
  'product',
  'productImage',
  'productVariant',
  'productLot',
  'qcInspection',
  'traceEvent',
  'warehouse',
  'inventoryBalance',
  'warehouseDocument',
  'warehouseDocumentLine',
  'inventoryMovement',
  'cart',
  'cartItem',
  'order',
  'checkoutIdempotencyKey',
  'partnerOrder',
  'orderItem',
  'inventoryAllocation',
  'fulfillment',
  'shipment',
  'shipmentEvent',
  'payment',
  'refund',
  'voucher',
  'voucherRedemption',
  'productDiscount',
  'flashSale',
  'flashSaleItem',
  'review',
  'complaint',
  'returnRequest',
  'evidenceImage',
  'commissionRule',
  'settlement',
  'settlementLine',
  'payout',
  'auditLog',
] as const;

export type MockPrisma = {
  [K in (typeof MODELS)[number]]: MockDelegate;
} & {
  $transaction: MockFn;
  $connect: MockFn;
  $disconnect: MockFn;
  $queryRaw: MockFn;
  $executeRaw: MockFn;
};

export function createMockPrisma(): MockPrisma {
  const mock: Record<string, unknown> = {};

  for (const model of MODELS) {
    const delegate: Record<string, MockFn> = {};
    for (const method of DELEGATE_METHODS) {
      delegate[method] = vi.fn();
    }
    mock[model] = delegate;
  }

  mock.$connect = vi.fn(async () => undefined);
  mock.$disconnect = vi.fn(async () => undefined);
  applyTransactionDefault(mock);
  applyRawDefaults(mock);

  return mock as unknown as MockPrisma;
}

/**
 * Defaults for the raw statements the atomic claims use.
 *
 * `$executeRaw` resolves `1` (the conditional UPDATE matched and claimed its
 * row); `$queryRaw` resolves one `code_sequences` row so `claimSequence` can
 * read its value back. Tests override these when they need the "claim lost"
 * path (`mockResolvedValue(0)`) or a specific sequence number.
 */
function applyRawDefaults(mock: Record<string, unknown>): void {
  mock.$queryRaw = vi.fn(async () => [{ value: 1 }]);
  mock.$executeRaw = vi.fn(async () => 1);
}

/** `$transaction(fn)` runs `fn` with the same mock; `$transaction([...])` awaits. */
function applyTransactionDefault(mock: Record<string, unknown>): void {
  mock.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(mock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
}

/** Helper to reset every mock function between tests. */
export function resetMockPrisma(prisma: MockPrisma): void {
  for (const model of MODELS) {
    const delegate = prisma[model] as unknown as Record<string, MockFn>;
    for (const method of DELEGATE_METHODS) {
      delegate[method].mockReset();
    }
  }
  applyTransactionDefault(prisma as unknown as Record<string, unknown>);
  applyRawDefaults(prisma as unknown as Record<string, unknown>);
}
