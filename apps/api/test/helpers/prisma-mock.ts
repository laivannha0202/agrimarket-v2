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
  'quarantineCase',
  'evidenceImage',
  'commissionRule',
  'settlement',
  'settlementLine',
  'settlementAdjustment',
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
  applyModelDefaults(mock);

  return mock as unknown as MockPrisma;
}

/**
 * Defaults for reads that the newer cancellation/refund paths perform on every
 * call. Without them an unstubbed `mockResolvedValue` returns `undefined`, and
 * a service that legitimately expects an empty list (`no shipment`,
 * `no completed refund`) crashes on `.some`/`.length` before the test reaches
 * its assertion. Tests that care about the rows still override these.
 */
function applyModelDefaults(mock: Record<string, unknown>): void {
  const delegate = (name: string) => mock[name] as Record<string, MockFn>;
  delegate('shipment').findMany.mockResolvedValue([]);
  // Delivery evidence reads partner orders and their shipments on every
  // DELIVERED transition. An empty list means "no evidence", so a test that
  // wants the transition to succeed must stub the real rows instead of
  // crashing on an unstubbed mock.
  delegate('partnerOrder').findMany.mockResolvedValue([]);
  delegate('shipment').count.mockResolvedValue(0);
  delegate('refund').findMany.mockResolvedValue([]);
  delegate('inventoryAllocation').findMany.mockResolvedValue([]);
  delegate('quarantineCase').findMany.mockResolvedValue([]);
  delegate('quarantineCase').create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
  );
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
  applyModelDefaults(prisma as unknown as Record<string, unknown>);
}

/**
 * Stub the raw statements of the checkout transaction so the Partner lock
 * (`OrdersService.lockSellablePartners`, task 05.4.2.6) answers with `partners`
 * while every other `$queryRaw` keeps the default `[{ value: 1 }]` that
 * `claimSequence` expects.
 *
 * The service reads `status` and `verification_status` straight out of the
 * locking statement (a plain read after a locking read can answer from an older
 * snapshot — see the docblock), so the stub must use the snake_case column name
 * the real driver returns, not the Prisma field name.
 *
 * Ids in `partners` that the statement does not ask for are filtered out, and
 * the result is ordered by id, mirroring `ORDER BY id` in the real SQL: a test
 * that asserts the lock set sees exactly what the database would return.
 */
export function stubPartnerLock(
  prisma: MockPrisma,
  partners: { id: number; status: string; verificationStatus: string }[],
): void {
  const byId = new Map(partners.map((partner) => [partner.id, partner]));
  prisma.$queryRaw.mockImplementation(async (...args: unknown[]) => {
    // Prisma's tagged template arrives as `$queryRaw(strings, ...values)`.
    const strings = args[0] as string[];
    const text = strings.join('?');
    if (!/FROM\s+partners/i.test(text)) return [{ value: 1 }];
    // `Prisma.join([...])` is passed as a single `_Sql` value with its own
    // `values` array, so flatten it back to the ids the statement asked for.
    const requested = args.slice(1).flatMap((value) => {
      const nested = value as { values?: unknown[] } | null;
      if (nested && Array.isArray(nested.values)) return nested.values;
      return [value];
    });
    const ids = requested.map(Number).sort((a, b) => a - b);
    return ids
      .filter((id) => byId.has(id))
      .map((id) => {
        const partner = byId.get(id) as { status: string; verificationStatus: string };
        return { id, status: partner.status, verification_status: partner.verificationStatus };
      });
  });
}
