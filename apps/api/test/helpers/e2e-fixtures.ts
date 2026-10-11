import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Isolated fixtures for the HTTP e2e suites.
 *
 * Everything created here is tagged with a per-run prefix (`runId`) so the
 * suites never depend on — and never collide with — the demo seed, and so
 * `cleanup()` can remove exactly what was created. The suites only ever run
 * against TEST_DATABASE_URL.
 *
 * Every marker (email, code, slug, sku, trace code) starts with `e2e` and
 * carries the run id, which also lets `purgeStaleFixtures` clean up after a run
 * that was killed before its `afterAll` hooks could execute.
 */

export const E2E_ADMIN_PASSWORD = 'E2eAdmin@12345';
export const E2E_CUSTOMER_PASSWORD = 'E2eCustomer@12345';

/** Prefix shared by every row these suites create. */
export const E2E_PREFIX = 'e2e';

export interface E2eFixtures {
  runId: string;
  adminId: number;
  adminEmail: string;
  customerId: number;
  customerEmail: string;
  partnerAId: number;
  partnerBId: number;
  categoryAId: number;
  categoryBId: number;
  farmAId: number;
  farmBId: number;
  productAId: number;
  productBId: number;
  variantAId: number;
  variantBId: number;
  seasonAId: number;
  seasonBId: number;
  harvestAId: number;
  harvestBId: number;
  lotAId: number;
  lotBId: number;
  lotAStatus: string;
  lotBStatus: string;
  warehouseId: number;
  balanceAId: number;
  balanceBId: number;
  docDraftId: number;
  docCompletedId: number;
  orderId: number;
  orderItemId: number;
  /** A second, unreviewed order item — the review flow needs a fresh one. */
  orderItemBId: number;
  partnerOrderId: number;
  paymentId: number;
  settlementId: number;
  payoutId: number;
  complaintId: number;
  returnId: number;
  reviewId: number;
  certificateId: number;
  /** Unique-ish tokens used to assert that `search` really narrows results. */
  searchToken: string;
}

export function createFixturePrisma(testUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaMariaDb(testUrl) });
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Seeds a complete, self-contained slice of the domain: two partners with
 * different statuses, two categories, two farms, products/variants, a season +
 * harvest + two lots in different QC states, a warehouse with balances, a
 * DRAFT and a COMPLETED warehouse document, a delivered order with an item, a
 * payment, a settlement + payout, and one complaint / return / review /
 * certificate.
 */
export async function seedFixtures(
  prisma: PrismaClient,
  runId: string,
): Promise<E2eFixtures> {
  const t = (suffix: string) => `${runId}-${suffix}`;
  const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);
  const customerHash = await bcrypt.hash(E2E_CUSTOMER_PASSWORD, 10);

  // The admin e-mail is run-scoped too, so a crashed previous run can never
  // collide on the `users_email_key` unique constraint.
  const adminEmail = `${runId}-admin@agrimarket.vn`;

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      fullName: `E2E Admin ${runId}`,
      phone: '0900000000',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  const customer = await prisma.user.create({
    data: {
      email: t('customer@agrimarket.vn'),
      passwordHash: customerHash,
      fullName: `E2E Khách ${runId}`,
      phone: '0911111111',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      customerProfile: { create: {} },
    },
  });

  // Two partners: A active, B inactive — lets a single filter prove narrowing.
  const partnerA = await prisma.partner.create({
    data: {
      code: t('PARTNER-A'),
      name: `HTX Rau sạch ${runId}`,
      representativeName: 'Nguyễn Văn A',
      phone: '0987654321',
      email: t('a@partner.vn'),
      address: 'Hưng Yên',
      status: 'ACTIVE',
    },
  });
  const partnerB = await prisma.partner.create({
    data: {
      code: t('PARTNER-B'),
      name: `HTX Trái cây ${runId}`,
      representativeName: 'Trần Thị B',
      phone: '0987654322',
      email: t('b@partner.vn'),
      address: 'Hải Dương',
      status: 'INACTIVE',
    },
  });

  const categoryA = await prisma.category.create({
    data: { name: `Rau ăn lá ${runId}`, slug: t('rau-an-la'), status: 'ACTIVE' },
  });
  const categoryB = await prisma.category.create({
    data: { name: `Trái cây ${runId}`, slug: t('trai-cay'), status: 'INACTIVE' },
  });

  const farmA = await prisma.farm.create({
    data: {
      code: t('FARM-A'),
      partnerId: partnerA.id,
      name: `Trang trại Minh Châu ${runId}`,
      address: 'Thôn Đa Hòa, Hưng Yên',
      status: 'ACTIVE',
    },
  });
  const farmB = await prisma.farm.create({
    data: {
      code: t('FARM-B'),
      partnerId: partnerB.id,
      name: `Trang trại Vĩnh Bảo ${runId}`,
      address: 'Vĩnh Bảo, Hải Dương',
      status: 'INACTIVE',
    },
  });

  const productA = await prisma.product.create({
    data: {
      partnerId: partnerA.id,
      categoryId: categoryA.id,
      farmId: farmA.id,
      name: `Cải bó xôi ${runId}`,
      slug: t('cai-bo-xoi'),
      status: 'ACTIVE',
    },
  });
  const productB = await prisma.product.create({
    data: {
      partnerId: partnerB.id,
      categoryId: categoryB.id,
      farmId: farmB.id,
      name: `Cam sành ${runId}`,
      slug: t('cam-sanh'),
      status: 'INACTIVE',
    },
  });

  const variantA = await prisma.productVariant.create({
    data: {
      productId: productA.id,
      sku: t('SKU-CAI'),
      name: 'Túi 500g',
      saleUnit: 'túi',
      basePrice: 25000,
      status: 'ACTIVE',
    },
  });
  const variantB = await prisma.productVariant.create({
    data: {
      productId: productB.id,
      sku: t('SKU-CAM'),
      name: 'Túi 1kg',
      saleUnit: 'túi',
      basePrice: 45000,
      status: 'ACTIVE',
    },
  });

  const seasonA = await prisma.season.create({
    data: { farmId: farmA.id, cropName: `Cải bó xôi vụ đông ${runId}`, status: 'GROWING' },
  });
  const seasonB = await prisma.season.create({
    data: { farmId: farmB.id, cropName: `Cam sành vụ ${runId}`, status: 'COMPLETED' },
  });

  const harvestA = await prisma.harvest.create({
    data: {
      seasonId: seasonA.id,
      harvestDate: startOfToday(),
      quantity: 1000,
      unit: 'kg',
      grade: 'A',
    },
  });
  const harvestB = await prisma.harvest.create({
    data: {
      seasonId: seasonB.id,
      harvestDate: startOfToday(),
      quantity: 2000,
      unit: 'kg',
      grade: 'A',
    },
  });

  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

  // Lot A is sellable (QC PASS) and has stock; lot B is rejected.
  const lotA = await prisma.productLot.create({
    data: {
      code: t('LOT-A'),
      productId: productA.id,
      harvestId: harvestA.id,
      quantity: 500,
      unit: 'kg',
      remainingQuantity: 500,
      grade: 'A',
      expiresAt: future,
      status: 'SELLABLE',
      traceCode: t('TRC-A'),
    },
  });
  const lotB = await prisma.productLot.create({
    data: {
      code: t('LOT-B'),
      productId: productB.id,
      harvestId: harvestB.id,
      quantity: 800,
      unit: 'kg',
      remainingQuantity: 800,
      grade: 'A',
      expiresAt: future,
      status: 'REJECTED',
      traceCode: t('TRC-B'),
    },
  });

  await prisma.qcInspection.create({
    data: {
      productLotId: lotA.id,
      inspectorUserId: admin.id,
      result: 'PASS',
      appearancePassed: true,
      freshnessPassed: true,
      packagingPassed: true,
      damagePassed: true,
      inspectedAt: new Date(),
    },
  });
  await prisma.qcInspection.create({
    data: {
      productLotId: lotB.id,
      inspectorUserId: admin.id,
      result: 'FAIL',
      appearancePassed: false,
      freshnessPassed: false,
      damagePassed: false,
      inspectedAt: new Date(),
    },
  });

  const warehouse = await prisma.warehouse.create({
    data: {
      code: t('WH'),
      name: `Kho trung tâm ${runId}`,
      address: 'Hưng Yên',
      status: 'ACTIVE',
    },
  });

  const balanceA = await prisma.inventoryBalance.create({
    data: {
      warehouseId: warehouse.id,
      productLotId: lotA.id,
      productVariantId: variantA.id,
      onHand: 200,
      reserved: 0,
      blocked: 0,
      unit: 'kg',
    },
  });
  const balanceB = await prisma.inventoryBalance.create({
    data: {
      warehouseId: warehouse.id,
      productLotId: lotB.id,
      productVariantId: variantB.id,
      onHand: 150,
      reserved: 0,
      blocked: 0,
      unit: 'kg',
    },
  });

  await prisma.inventoryMovement.create({
    data: {
      warehouseId: warehouse.id,
      productLotId: lotA.id,
      productVariantId: variantA.id,
      type: 'INBOUND',
      quantityDelta: 200,
      beforeQuantity: 0,
      afterQuantity: 200,
      createdByUserId: admin.id,
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      warehouseId: warehouse.id,
      productLotId: lotB.id,
      productVariantId: variantB.id,
      type: 'INBOUND',
      quantityDelta: 150,
      beforeQuantity: 0,
      afterQuantity: 150,
      createdByUserId: admin.id,
    },
  });

  const docDraft = await prisma.warehouseDocument.create({
    data: {
      code: t('WHD-DRAFT'),
      warehouseId: warehouse.id,
      type: 'INBOUND',
      status: 'DRAFT',
      createdByUserId: admin.id,
      lines: {
        create: [
          {
            productLotId: lotA.id,
            productVariantId: variantA.id,
            quantity: 10,
            unit: 'kg',
          },
        ],
      },
    },
  });
  const docCompleted = await prisma.warehouseDocument.create({
    data: {
      code: t('WHD-DONE'),
      warehouseId: warehouse.id,
      type: 'OUTBOUND',
      status: 'COMPLETED',
      createdByUserId: admin.id,
      completedAt: new Date(),
      lines: {
        create: [
          {
            productLotId: lotA.id,
            productVariantId: variantA.id,
            quantity: 5,
            unit: 'kg',
          },
        ],
      },
    },
  });

  // A delivered order with one item, used by order/payment/settlement flows.
  const order = await prisma.order.create({
    data: {
      code: t('ORD'),
      customerId: customer.id,
      shippingAddressSnapshot: {
        recipientName: 'E2E Khách',
        phone: '0911111111',
        province: 'Hưng Yên',
        detail: 'Số 1, đường E2E',
      },
      subtotal: 100000,
      discountTotal: 0,
      shippingFee: 0,
      grandTotal: 100000,
      status: 'DELIVERED',
    },
  });

  const partnerOrder = await prisma.partnerOrder.create({
    data: {
      code: t('PORD'),
      orderId: order.id,
      partnerId: partnerA.id,
      subtotal: 100000,
      discountTotal: 0,
      commissionAmount: 5000,
      payableAmount: 95000,
      status: 'DELIVERED',
    },
  });

  const orderItem = await prisma.orderItem.create({
    data: {
      partnerOrderId: partnerOrder.id,
      productVariantId: variantA.id,
      productNameSnapshot: `Cải bó xôi ${runId}`,
      skuSnapshot: t('SKU-CAI'),
      unitPriceSnapshot: 25000,
      quantity: 4,
      subtotal: 100000,
      discountAmount: 0,
    },
  });

  // A second item on the same partner order. The review flow is one-per-item
  // (`reviews.order_item_id` is unique), so it needs its own item — on the
  // same product, which is the one the review assertions target.
  const orderItemB = await prisma.orderItem.create({
    data: {
      partnerOrderId: partnerOrder.id,
      productVariantId: variantA.id,
      productNameSnapshot: `Cải bó xôi ${runId} (lô 2)`,
      skuSnapshot: t('SKU-CAI'),
      unitPriceSnapshot: 25000,
      quantity: 1,
      subtotal: 25000,
      discountAmount: 0,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: 'COD',
      amount: 100000,
      status: 'PAID',
      paidAt: new Date(),
    },
  });

  const settlement = await prisma.settlement.create({
    data: {
      code: t('SET'),
      partnerId: partnerA.id,
      periodStart: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      periodEnd: new Date(),
      grossAmount: 100000,
      refundAmount: 0,
      commissionAmount: 5000,
      adjustmentAmount: 0,
      payableAmount: 95000,
      status: 'DRAFT',
      lines: {
        create: [
          {
            partnerOrderId: partnerOrder.id,
            grossAmount: 100000,
            refundAmount: 0,
            commissionAmount: 5000,
            payableAmount: 95000,
          },
        ],
      },
    },
  });

  const payout = await prisma.payout.create({
    data: {
      code: t('PAY'),
      settlementId: settlement.id,
      partnerId: partnerA.id,
      amount: 95000,
      status: 'PENDING',
      requestedAt: new Date(),
    },
  });

  const complaint = await prisma.complaint.create({
    data: {
      customerId: customer.id,
      orderId: order.id,
      orderItemId: orderItem.id,
      type: 'PRODUCT_QUALITY',
      content: `Khiếu nại e2e ${runId}`,
      status: 'OPEN',
    },
  });

  const returnRequest = await prisma.returnRequest.create({
    data: {
      orderId: order.id,
      orderItemId: orderItem.id,
      customerId: customer.id,
      quantity: 1,
      reason: `Yêu cầu đổi trả e2e ${runId}`,
      status: 'REQUESTED',
    },
  });

  const review = await prisma.review.create({
    data: {
      customerId: customer.id,
      orderItemId: orderItem.id,
      productId: productA.id,
      rating: 5,
      content: `Đánh giá e2e ${runId}`,
      status: 'APPROVED',
    },
  });

  const certificate = await prisma.certificate.create({
    data: {
      farmId: farmA.id,
      type: 'VietGAP',
      certificateCode: t('VG-2026'),
      issuer: 'Trung tâm Kiểm định Hưng Yên',
      issuedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      expiresAt: future,
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
      status: 'ACTIVE',
    },
  });

  return {
    runId,
    adminId: admin.id,
    adminEmail: admin.email,
    customerId: customer.id,
    customerEmail: customer.email,
    partnerAId: partnerA.id,
    partnerBId: partnerB.id,
    categoryAId: categoryA.id,
    categoryBId: categoryB.id,
    farmAId: farmA.id,
    farmBId: farmB.id,
    productAId: productA.id,
    productBId: productB.id,
    variantAId: variantA.id,
    variantBId: variantB.id,
    seasonAId: seasonA.id,
    seasonBId: seasonB.id,
    harvestAId: harvestA.id,
    harvestBId: harvestB.id,
    lotAId: lotA.id,
    lotBId: lotB.id,
    lotAStatus: lotA.status,
    lotBStatus: lotB.status,
    warehouseId: warehouse.id,
    balanceAId: balanceA.id,
    balanceBId: balanceB.id,
    docDraftId: docDraft.id,
    docCompletedId: docCompleted.id,
    orderId: order.id,
    orderItemId: orderItem.id,
    orderItemBId: orderItemB.id,
    partnerOrderId: partnerOrder.id,
    paymentId: payment.id,
    settlementId: settlement.id,
    payoutId: payout.id,
    complaintId: complaint.id,
    returnId: returnRequest.id,
    reviewId: review.id,
    certificateId: certificate.id,
    searchToken: runId,
  };
}

/**
 * Deletes every row the given run created, children first.
 *
 * The walk starts from the run's users and its marker prefixes (`runId-…` on
 * codes/slugs/skus) and then follows the relations, so it also removes rows the
 * API created without a marker — auto-generated codes such as `PARTNER-0007`
 * or `LOT-20260101-0001` — without ever touching demo-seed data.
 */
async function purgeRun(prisma: PrismaClient, runId: string, userIds: number[]): Promise<void> {
  const hasUsers = userIds.length > 0;
  // When the users are already gone, every user-scoped filter must match
  // nothing rather than everything.
  const scopedUserIds = hasUsers ? userIds : [];

  // --- resolve the run's object graph -------------------------------------
  const audit = hasUsers
    ? await prisma.auditLog.findMany({
        where: { actorUserId: { in: scopedUserIds } },
        select: { entityType: true, entityId: true },
      })
    : [];
  const auditedIds = (entityType: string): number[] =>
    audit
      .filter((a) => a.entityType === entityType && /^\d+$/.test(a.entityId))
      .map((a) => Number(a.entityId));

  const orderIds = (
    await prisma.order.findMany({
      where: hasUsers
        ? { OR: [{ customerId: { in: scopedUserIds } }, { code: { startsWith: runId } }] }
        : { code: { startsWith: runId } },
      select: { id: true },
    })
  ).map((o) => o.id);

  const partnerOrders = await prisma.partnerOrder.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, partnerId: true },
  });
  const partnerOrderIds = partnerOrders.map((p) => p.id);

  const partnerIdSet = new Set<number>(auditedIds('Partner'));
  for (const p of await prisma.partner.findMany({
    where: { code: { startsWith: runId } },
    select: { id: true },
  })) {
    partnerIdSet.add(p.id);
  }
  for (const p of partnerOrders) partnerIdSet.add(p.partnerId);

  const farmIdSet = new Set<number>(auditedIds('Farm'));
  for (const f of await prisma.farm.findMany({
    where: { OR: [{ code: { startsWith: runId } }, { partnerId: { in: [...partnerIdSet] } }] },
    select: { id: true, partnerId: true },
  })) {
    farmIdSet.add(f.id);
    partnerIdSet.add(f.partnerId);
  }

  const productIdSet = new Set<number>(auditedIds('Product'));
  for (const p of await prisma.product.findMany({
    where: {
      OR: [{ slug: { startsWith: runId } }, { partnerId: { in: [...partnerIdSet] } }],
    },
    select: { id: true, partnerId: true },
  })) {
    productIdSet.add(p.id);
    partnerIdSet.add(p.partnerId);
  }

  const variantIdSet = new Set<number>(auditedIds('ProductVariant'));
  for (const v of await prisma.productVariant.findMany({
    where: { OR: [{ sku: { startsWith: runId } }, { productId: { in: [...productIdSet] } }] },
    select: { id: true },
  })) {
    variantIdSet.add(v.id);
  }

  const lotIdSet = new Set<number>(auditedIds('ProductLot'));
  for (const l of await prisma.productLot.findMany({
    where: { OR: [{ code: { startsWith: runId } }, { productId: { in: [...productIdSet] } }] },
    select: { id: true },
  })) {
    lotIdSet.add(l.id);
  }

  const seasonIdSet = new Set<number>(auditedIds('Season'));
  for (const s of await prisma.season.findMany({
    where: { farmId: { in: [...farmIdSet] } },
    select: { id: true },
  })) {
    seasonIdSet.add(s.id);
  }
  const harvestIds = (
    await prisma.harvest.findMany({
      where: { seasonId: { in: [...seasonIdSet] } },
      select: { id: true },
    })
  ).map((h) => h.id);

  const warehouseIdSet = new Set<number>();
  for (const w of await prisma.warehouse.findMany({
    where: { code: { startsWith: runId } },
    select: { id: true },
  })) {
    warehouseIdSet.add(w.id);
  }
  const documentIds = (
    await prisma.warehouseDocument.findMany({
      where: {
        OR: [
          { createdByUserId: { in: scopedUserIds } },
          { warehouseId: { in: [...warehouseIdSet] } },
        ],
      },
      select: { id: true },
    })
  ).map((d) => d.id);

  const orderItemIds = (
    await prisma.orderItem.findMany({
      where: { partnerOrderId: { in: partnerOrderIds } },
      select: { id: true },
    })
  ).map((i) => i.id);

  const settlementIds = (
    await prisma.settlement.findMany({
      where: { partnerId: { in: [...partnerIdSet] } },
      select: { id: true },
    })
  ).map((s) => s.id);

  const shipmentIds = (
    await prisma.shipment.findMany({
      where: { partnerOrderId: { in: partnerOrderIds } },
      select: { id: true },
    })
  ).map((s) => s.id);

  const paymentIds = (
    await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    })
  ).map((p) => p.id);

  // --- delete, children first --------------------------------------------
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: scopedUserIds } } });
  // Recovery links belong to the run's users and must go before the users do
  // (`PasswordResetToken.userId` is a foreign key with RESTRICT semantics), so
  // the run leaves nothing behind even when it created tokens.
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: scopedUserIds } } });
  // Idempotency keys reference both the customer (RESTRICT) and the order.
  await prisma.checkoutIdempotencyKey.deleteMany({
    where: {
      OR: [{ customerId: { in: scopedUserIds } }, { orderId: { in: orderIds } }],
    },
  });
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  await prisma.fulfillment.deleteMany({ where: { partnerOrderId: { in: partnerOrderIds } } });
  await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.complaint.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.review.deleteMany({
    where: {
      OR: [
        { customerId: { in: scopedUserIds } },
        { orderItemId: { in: orderItemIds } },
        { productId: { in: [...productIdSet] } },
      ],
    },
  });
  await prisma.voucherRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.inventoryAllocation.deleteMany({
    where: {
      OR: [{ orderItemId: { in: orderItemIds } }, { productLotId: { in: [...lotIdSet] } }],
    },
  });
  await prisma.settlementLine.deleteMany({
    where: {
      OR: [
        { partnerOrderId: { in: partnerOrderIds } },
        { settlementId: { in: settlementIds } },
      ],
    },
  });
  await prisma.payout.deleteMany({
    where: {
      OR: [
        { settlementId: { in: settlementIds } },
        { partnerId: { in: [...partnerIdSet] } },
        { code: { startsWith: runId } },
      ],
    },
  });
  await prisma.settlement.deleteMany({
    where: { OR: [{ id: { in: settlementIds } }, { partnerId: { in: [...partnerIdSet] } }] },
  });
  await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.orderItem.deleteMany({ where: { id: { in: orderItemIds } } });
  await prisma.partnerOrder.deleteMany({ where: { id: { in: partnerOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.warehouseDocumentLine.deleteMany({
    where: {
      OR: [{ documentId: { in: documentIds } }, { productLotId: { in: [...lotIdSet] } }],
    },
  });
  await prisma.warehouseDocument.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.inventoryMovement.deleteMany({
    where: {
      OR: [
        { productLotId: { in: [...lotIdSet] } },
        { warehouseId: { in: [...warehouseIdSet] } },
        { productVariantId: { in: [...variantIdSet] } },
        { createdByUserId: { in: scopedUserIds } },
      ],
    },
  });
  await prisma.inventoryBalance.deleteMany({
    where: {
      OR: [
        { productLotId: { in: [...lotIdSet] } },
        { warehouseId: { in: [...warehouseIdSet] } },
        { productVariantId: { in: [...variantIdSet] } },
      ],
    },
  });
  await prisma.warehouse.deleteMany({ where: { id: { in: [...warehouseIdSet] } } });
  await prisma.qcInspection.deleteMany({
    where: {
      OR: [{ productLotId: { in: [...lotIdSet] } }, { inspectorUserId: { in: scopedUserIds } }],
    },
  });
  await prisma.traceEvent.deleteMany({ where: { productLotId: { in: [...lotIdSet] } } });
  await prisma.productLot.deleteMany({ where: { id: { in: [...lotIdSet] } } });
  await prisma.farmingEvent.deleteMany({ where: { seasonId: { in: [...seasonIdSet] } } });
  await prisma.harvest.deleteMany({
    where: { OR: [{ id: { in: harvestIds } }, { seasonId: { in: [...seasonIdSet] } }] },
  });
  await prisma.season.deleteMany({ where: { id: { in: [...seasonIdSet] } } });
  await prisma.certificate.deleteMany({
    where: {
      OR: [{ farmId: { in: [...farmIdSet] } }, { certificateCode: { startsWith: runId } }],
    },
  });
  await prisma.productImage.deleteMany({ where: { productId: { in: [...productIdSet] } } });
  await prisma.productDiscount.deleteMany({
    where: { productVariantId: { in: [...variantIdSet] } },
  });
  await prisma.flashSaleItem.deleteMany({ where: { productVariantId: { in: [...variantIdSet] } } });
  await prisma.cartItem.deleteMany({
    where: {
      OR: [
        { cart: { customerId: { in: scopedUserIds } } },
        { productVariantId: { in: [...variantIdSet] } },
      ],
    },
  });
  await prisma.cart.deleteMany({ where: { customerId: { in: scopedUserIds } } });
  await prisma.productVariant.deleteMany({ where: { id: { in: [...variantIdSet] } } });
  await prisma.product.deleteMany({ where: { id: { in: [...productIdSet] } } });
  await prisma.farm.deleteMany({ where: { id: { in: [...farmIdSet] } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: runId } } });
  await prisma.commissionRule.deleteMany({ where: { partnerId: { in: [...partnerIdSet] } } });
  await prisma.partner.deleteMany({ where: { id: { in: [...partnerIdSet] } } });
  await prisma.address.deleteMany({ where: { customer: { userId: { in: scopedUserIds } } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: scopedUserIds } } });
  /**
   * Evidence photos uploaded by this run's users.
   *
   * `evidence_images.uploaded_by_id` is `ON DELETE RESTRICT`, and an upload that
   * was never bound to a complaint/review/return is not reachable through any
   * cascade — it would keep pointing at a user this function is about to delete,
   * and the delete would fail. Removing the rows here (which also removes any
   * bound ones, already cascaded or not) keeps the purge total.
   */
  await prisma.evidenceImage.deleteMany({ where: { uploadedById: { in: scopedUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: scopedUserIds } } });
}

/**
 * Removes every fixture row created by `seedFixtures`. Safe to call twice, and
 * safe to call after a partially failed run.
 */
export async function cleanupFixtures(prisma: PrismaClient, f: E2eFixtures): Promise<void> {
  await purgeRun(prisma, f.runId, [f.adminId, f.customerId]);
}

/**
 * Heals the test database after a run that was killed (Ctrl-C, crash, timeout)
 * before its `afterAll` hooks could clean up.
 *
 * Stale runs are recognised in two ways, because a crash can happen at any
 * point of the cleanup:
 *   1. the run's users are still there — their e-mails start with `e2e`;
 *   2. only marker rows are left (`<runId>-WH`, `<runId>-PARTNER-A`, …).
 *
 * Demo-seed rows never carry an `e2e` prefix, so they are never touched.
 */
export async function purgeStaleFixtures(prisma: PrismaClient): Promise<void> {
  const runIds = new Set<string>();

  const staleUsers = await prisma.user.findMany({
    where: { email: { startsWith: E2E_PREFIX } },
    select: { id: true, email: true },
  });
  for (const user of staleUsers) {
    // Every fixture e-mail is `<runId>-admin@…` / `<runId>-customer@…`.
    runIds.add(user.email.split('@')[0].replace(/-(admin|customer)$/, ''));
  }

  // Orphaned markers from a run whose users were already removed. Each marker
  // is `<runId>-<suffix>`, so the run id is everything before the first dash.
  const markerSources: Array<[string, string, unknown]> = [
    ['partner', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['farm', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['category', 'slug', { slug: { startsWith: E2E_PREFIX } }],
    ['product', 'slug', { slug: { startsWith: E2E_PREFIX } }],
    ['productVariant', 'sku', { sku: { startsWith: E2E_PREFIX } }],
    ['productLot', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['warehouse', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['warehouseDocument', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['order', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['settlement', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['payout', 'code', { code: { startsWith: E2E_PREFIX } }],
    ['certificate', 'certificateCode', { certificateCode: { startsWith: E2E_PREFIX } }],
  ];
  for (const [model, field, where] of markerSources) {
    const rows = await (
      prisma as unknown as Record<
        string,
        { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }
      >
    )[model].findMany({ where, select: { [field]: true } });
    for (const row of rows) {
      const raw = row[field];
      const marker = typeof raw === 'string' ? raw : '';
      if (marker.startsWith(E2E_PREFIX)) {
        // The run id is the token before the first `-`, e.g. `e2eabc123-WH`.
        const runId = marker.split('-')[0];
        if (runId.length > E2E_PREFIX.length) runIds.add(runId);
      }
    }
  }

  for (const runId of runIds) {
    const userIds = staleUsers.filter((u) => u.email.startsWith(runId)).map((u) => u.id);
    await purgeRun(prisma, runId, userIds);
  }
}

export function makeRunId(prefix = E2E_PREFIX): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
    .toString(36)
    .padStart(3, '0')}`;
}
