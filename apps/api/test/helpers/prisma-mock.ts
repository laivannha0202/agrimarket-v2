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
  'customerProfile',
  'address',
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

  // $transaction(callback) runs the callback with the same mock.
  mock.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(mock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  mock.$connect = vi.fn(async () => undefined);
  mock.$disconnect = vi.fn(async () => undefined);
  mock.$queryRaw = vi.fn();
  mock.$executeRaw = vi.fn();

  return mock as unknown as MockPrisma;
}

/** Helper to reset every mock function between tests. */
export function resetMockPrisma(prisma: MockPrisma): void {
  for (const model of MODELS) {
    const delegate = prisma[model] as unknown as Record<string, MockFn>;
    for (const method of DELEGATE_METHODS) {
      delegate[method].mockReset();
    }
  }
  prisma.$transaction.mockReset();
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
}
