import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma as PrismaTypes } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaymentStatus, RefundStatus } from '../../generated/prisma/enums.js';
import { buildDayKeys, resolveReportWindow, vnDayKey } from './daily.util.js';

/**
 * Backend aggregates for Tổng quan and Báo cáo.
 *
 * WHY this exists: the admin used to derive KPIs from `limit: 100` list
 * responses, so every number silently stopped growing past 100 rows. All
 * figures here come from `COUNT`/`SUM` over the full filtered set.
 *
 * Definitions (kept deliberately narrow so the UI cannot misread them):
 * - `totalOrderValue`: Σ grandTotal of non-cancelled orders created in the
 *   window. This is order value, NOT money received.
 * - Revenue is **cash flow**, dated by when the money actually moved:
 *   - `grossCollected`: Σ amount of payments that were collected
 *     (`paidAt` in the window; status PAID / PARTIALLY_REFUNDED / REFUNDED).
 *     A fully refunded payment is still money that was collected, so it stays
 *     in gross — the refund is netted once on the refund leg.
 *   - `refundTotal`: Σ amount of COMPLETED refunds (`completedAt` in window).
 *   - `netCollected`: grossCollected − refundTotal — the "doanh thu thực nhận".
 *     It can be negative in a period that only contains refunds for money
 *     collected in an earlier period; that is the correct cash view.
 * - `commissionRecorded`: Σ partner-order commission of non-cancelled orders
 *   created in the window (recognised commission, not yet necessarily settled).
 * - Cancelled orders never contribute order value or commission. Money already
 *   collected on an order that is later cancelled is still counted as cash
 *   (and nets to zero once its refund completes) — cancellation is an order
 *   state, not a cash event.
 */
export interface ReportsSummary {
  from: string;
  to: string;
  orders: {
    count: number;
    activeCount: number;
    byStatus: Record<string, number>;
    totalOrderValue: number;
    averageOrderValue: number;
    pendingConfirmation: number;
    shipping: number;
  };
  revenue: {
    grossCollected: number;
    refundTotal: number;
    netCollected: number;
  };
  commissionRecorded: number;
  returns: { byStatus: Record<string, number>; open: number };
  complaints: { byStatus: Record<string, number>; open: number };
  lots: { pendingQc: number; sellableExpiring7d: number; sellableExpired: number };
  inventory: { lowStockLines: number; lowStockThreshold: number };
  certificates: { pending: number };
  topProducts: {
    productId: number;
    productName: string;
    sku: string;
    /** Sale unit of the variant (gói, túi, kg, …) — the quantity column is meaningless without it. */
    unit: string;
    quantity: number;
    revenue: number;
  }[];
}

const DAY_MS = 86_400_000;

/**
 * A stock line (`inventory_balances` row = warehouse × lot × variant) is
 * "running out" when its available quantity (`on_hand − reserved − blocked`) is
 * positive but at or below this. Lines at 0 or below are already out of stock
 * (`hết hàng`), a different state, so they are not counted here.
 *
 * The figure is compared against the row's own unit (kg, túi, gói, …), so a
 * single number is a deliberate heuristic operating signal across mixed units —
 * not a per-unit rule. The threshold is returned to the client so the UI can
 * render the same bound instead of hard-coding it.
 */
export const LOW_STOCK_THRESHOLD = 20;

/** Payment statuses that represent money actually collected. */
const COLLECTED_PAYMENT_STATUSES = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** One Vietnam day of the revenue/orders series. Money is in VND. */
export interface ReportsDailyPoint {
  /** Vietnam calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Orders created that day (every status, cancelled included). */
  orderCount: number;
  /** Σ grandTotal of non-cancelled orders created that day. */
  orderValue: number;
  /** Σ collected payments whose `paidAt` falls that day. */
  grossCollected: number;
  /** Σ COMPLETED refunds whose `completedAt` falls that day. */
  refundTotal: number;
  /** grossCollected − refundTotal. */
  netCollected: number;
}

export interface ReportsDaily {
  from: string;
  to: string;
  days: number;
  points: ReportsDailyPoint[];
}

/**
 * One order row for the export's "Đơn hàng" table.
 *
 * Grain is exactly one row per order: money columns never multiply by the
 * partner-order count, so Σ over the table reconciles with the summary KPIs
 * (`collectedInWindow − refundedInWindow = netCollected`).
 */
export interface ReportOrderRow {
  code: string;
  createdAt: Date;
  status: string;
  partnerCount: number;
  paymentMethod: string | null;
  paymentStatus: string | null;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  grandTotal: number;
  /** Σ collected payments whose `paidAt` falls in the window. */
  collectedInWindow: number;
  /** Σ COMPLETED refunds whose `completedAt` falls in the window. */
  refundedInWindow: number;
}

export interface ReportReturnRow {
  orderCode: string;
  quantity: number;
  status: string;
  reason: string;
  createdAt: Date;
}

export interface ReportComplaintRow {
  orderCode: string;
  type: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(from?: Date, to?: Date, days?: number): Promise<ReportsSummary> {
    const { start, end } = resolveReportWindow(from, to, days);
    if (start > end) {
      throw new BadRequestException('`from` phải trước `to`.');
    }
    const orderWindow = { gte: start, lte: end };

    const orderWhere: PrismaTypes.OrderWhereInput = {
      createdAt: orderWindow,
    };

    const lowStockRows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM \`inventory_balances\`
      WHERE (\`on_hand\` - \`reserved\` - \`blocked\`) > 0
        AND (\`on_hand\` - \`reserved\` - \`blocked\`) <= ${LOW_STOCK_THRESHOLD}`;
    const lowStockLines = Number(lowStockRows[0]?.n ?? 0);

    const [orderGroups, orderValue, payments, refunds, commission, returns, complaints, lots, pendingCerts, topLines] =
      await Promise.all([
        this.prisma.order.groupBy({
          by: ['status'],
          where: orderWhere,
          _count: { status: true },
        }),
        this.prisma.order.aggregate({
          where: { ...orderWhere, status: { not: 'CANCELLED' } },
          _sum: { grandTotal: true },
          _count: true,
        }),
        this.prisma.payment.aggregate({
          where: {
            paidAt: orderWindow,
            status: { in: COLLECTED_PAYMENT_STATUSES },
          },
          _sum: { amount: true },
        }),
        this.prisma.refund.aggregate({
          where: { completedAt: orderWindow, status: RefundStatus.COMPLETED },
          _sum: { amount: true },
        }),
        this.prisma.partnerOrder.aggregate({
          where: {
            order: { ...orderWhere, status: { not: 'CANCELLED' } },
          },
          _sum: { commissionAmount: true },
        }),
        this.prisma.returnRequest.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
        this.prisma.complaint.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
        this.prisma.productLot.findMany({
          where: { status: { in: ['PENDING_QC', 'SELLABLE'] } },
          select: { status: true, expiresAt: true },
        }),
        this.prisma.certificate.count({
          where: { verificationStatus: 'PENDING' },
        }),
        // "Bán chạy" = goods that actually reached the buyer. Only DELIVERED
        // orders count: a PENDING_CONFIRMATION order is a request, not a sale,
        // and counting it (as the old `status != CANCELLED` filter did) inflated
        // the ranking with goods that may never ship.
        this.prisma.orderItem.groupBy({
          by: ['productVariantId'],
          where: {
            partnerOrder: { order: { ...orderWhere, status: 'DELIVERED' } },
          },
          _sum: { quantity: true, subtotal: true },
          orderBy: { _sum: { subtotal: 'desc' } },
          take: 10,
        }),
      ]);

    const byStatus: Record<string, number> = {};
    let orderCount = 0;
    for (const g of orderGroups) {
      byStatus[g.status] = g._count.status;
      orderCount += g._count.status;
    }
    const totalOrderValue = Number(orderValue._sum.grandTotal ?? 0);
    const activeCount = orderCount - (byStatus['CANCELLED'] ?? 0);
    const grossCollected = Number(payments._sum.amount ?? 0);
    const refundTotal = Number(refunds._sum.amount ?? 0);

    const now = end.getTime();
    const sevenDays = 7 * DAY_MS;
    let pendingQc = 0;
    let sellableExpiring7d = 0;
    let sellableExpired = 0;
    for (const lot of lots) {
      if (lot.status === 'PENDING_QC') pendingQc++;
      else {
        const t = new Date(lot.expiresAt).getTime();
        if (t < now) sellableExpired++;
        else if (t - now <= sevenDays) sellableExpiring7d++;
      }
    }

    const returnsBy: Record<string, number> = {};
    for (const g of returns) returnsBy[g.status] = g._count.status;
    const complaintsBy: Record<string, number> = {};
    for (const g of complaints) complaintsBy[g.status] = g._count.status;
    const openReturns = Object.entries(returnsBy)
      .filter(([s]) => s !== 'REFUNDED' && s !== 'REJECTED')
      .reduce((sum, [, n]) => sum + n, 0);
    const openComplaints = (complaintsBy['OPEN'] ?? 0) + (complaintsBy['PROCESSING'] ?? 0);

    const variantIds = topLines.map((l) => l.productVariantId);
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            saleUnit: true,
            product: { select: { id: true, name: true } },
          },
        })
      : [];
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const topProducts = topLines.map((l) => {
      const v = variantById.get(l.productVariantId);
      return {
        productId: v?.product.id ?? 0,
        productName: v?.product.name ?? '—',
        sku: v?.sku ?? '—',
        unit: v?.saleUnit ?? '',
        quantity: Number(l._sum.quantity ?? 0),
        revenue: Number(l._sum.subtotal ?? 0),
      };
    });

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      orders: {
        count: orderCount,
        activeCount,
        byStatus,
        totalOrderValue,
        averageOrderValue: activeCount > 0 ? totalOrderValue / activeCount : 0,
        pendingConfirmation: byStatus['PENDING_CONFIRMATION'] ?? 0,
        shipping: byStatus['SHIPPING'] ?? 0,
      },
      revenue: {
        grossCollected,
        refundTotal,
        netCollected: grossCollected - refundTotal,
      },
      commissionRecorded: Number(commission._sum.commissionAmount ?? 0),
      returns: { byStatus: returnsBy, open: openReturns },
      complaints: { byStatus: complaintsBy, open: openComplaints },
      lots: { pendingQc, sellableExpiring7d, sellableExpired },
      inventory: { lowStockLines, lowStockThreshold: LOW_STOCK_THRESHOLD },
      certificates: { pending: pendingCerts },
      topProducts,
    };
  }

  /**
   * Per-order / per-return / per-complaint rows for the export, over the same
   * window `summary()` uses.
   *
   * The order grain is one row per order (money never multiplied by the
   * partner count); cash columns use the same event-time basis as the KPIs
   * (`paidAt` / `completedAt` inside the window), so the table sums reconcile
   * with `grossCollected` / `refundTotal` / `netCollected`.
   */
  async detailRows(
    from?: Date,
    to?: Date,
    days?: number,
  ): Promise<{ orders: ReportOrderRow[]; returns: ReportReturnRow[]; complaints: ReportComplaintRow[] }> {
    const { start, end } = resolveReportWindow(from, to, days);
    if (start > end) {
      throw new BadRequestException('`from` phải trước `to`.');
    }
    const window = { gte: start, lte: end };

    const [orders, returns, complaints] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: window },
        include: {
          payments: { include: { refunds: true }, orderBy: { id: 'asc' } },
          _count: { select: { partnerOrders: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.returnRequest.findMany({
        where: { createdAt: window },
        include: { order: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.complaint.findMany({
        where: { createdAt: window },
        include: { order: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      orders: orders.map((o) => {
        let collectedInWindow = 0;
        let refundedInWindow = 0;
        for (const p of o.payments) {
          if (
            p.paidAt &&
            p.paidAt >= start &&
            p.paidAt <= end &&
            (COLLECTED_PAYMENT_STATUSES as readonly string[]).includes(p.status)
          ) {
            collectedInWindow += Number(p.amount);
          }
          for (const r of p.refunds) {
            if (r.status === RefundStatus.COMPLETED && r.completedAt && r.completedAt >= start && r.completedAt <= end) {
              refundedInWindow += Number(r.amount);
            }
          }
        }
        const latest = o.payments[o.payments.length - 1];
        return {
          code: o.code,
          createdAt: o.createdAt,
          status: o.status,
          partnerCount: o._count.partnerOrders,
          paymentMethod: latest?.method ?? null,
          paymentStatus: latest?.status ?? null,
          subtotal: Number(o.subtotal),
          discountTotal: Number(o.discountTotal),
          shippingFee: Number(o.shippingFee),
          grandTotal: Number(o.grandTotal),
          collectedInWindow,
          refundedInWindow,
        };
      }),
      returns: returns.map((r) => ({
        orderCode: r.order.code,
        quantity: Number(r.quantity),
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      complaints: complaints.map((c) => ({
        orderCode: c.order.code,
        type: c.type,
        status: c.status,
        createdAt: c.createdAt,
      })),
    };
  }

  /**
   * Daily revenue/orders series for the dashboard chart.
   *
   * Every figure is bucketed by the *Vietnam* calendar day (`+7h`) and the range
   * is zero-filled so the chart has no gaps. Money is dated by when it actually
   * moved: `grossCollected` counts collected payments by `paidAt`,
   * `refundTotal` counts COMPLETED refunds by `completedAt`, and `netCollected`
   * is the difference. Order counts/value stay on `created_at` — they are order
   * metrics, not cash.
   *
   * `resolveReportWindow` gives this method the same bounds as `summary()`, so
   * Σ over the series equals the summary KPI for the same period.
   */
  async daily(from?: Date, to?: Date, days?: number): Promise<ReportsDaily> {
    const { start, end } = resolveReportWindow(from, to, days);
    if (start > end) {
      throw new BadRequestException('`from` phải trước `to`.');
    }

    const [orderRows, paymentRows, refundRows] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; n: bigint; value: string | null }[]>`
        SELECT DATE_FORMAT(DATE_ADD(\`created_at\`, INTERVAL 7 HOUR), '%Y-%m-%d') AS day,
               COUNT(*) AS n,
               COALESCE(SUM(CASE WHEN \`status\` <> 'CANCELLED' THEN \`grand_total\` ELSE 0 END), 0) AS value
          FROM \`orders\`
         WHERE \`created_at\` >= ${start} AND \`created_at\` <= ${end}
         GROUP BY day`,
      this.prisma.$queryRaw<{ day: string; total: string | null }[]>`
        SELECT DATE_FORMAT(DATE_ADD(\`p\`.\`paid_at\`, INTERVAL 7 HOUR), '%Y-%m-%d') AS day,
               COALESCE(SUM(\`p\`.\`amount\`), 0) AS total
          FROM \`payments\` \`p\`
         WHERE \`p\`.\`paid_at\` >= ${start} AND \`p\`.\`paid_at\` <= ${end}
           AND \`p\`.\`status\` IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
         GROUP BY day`,
      this.prisma.$queryRaw<{ day: string; total: string | null }[]>`
        SELECT DATE_FORMAT(DATE_ADD(\`completed_at\`, INTERVAL 7 HOUR), '%Y-%m-%d') AS day,
               COALESCE(SUM(\`amount\`), 0) AS total
          FROM \`refunds\`
         WHERE \`completed_at\` >= ${start} AND \`completed_at\` <= ${end}
           AND \`status\` = 'COMPLETED'
         GROUP BY day`,
    ]);

    const ordersByDay = new Map<string, { n: number; value: number }>();
    for (const row of orderRows) {
      ordersByDay.set(String(row.day), { n: Number(row.n), value: Number(row.value ?? 0) });
    }
    const collectedByDay = new Map<string, number>();
    for (const row of paymentRows) collectedByDay.set(String(row.day), Number(row.total ?? 0));
    const refundByDay = new Map<string, number>();
    for (const row of refundRows) refundByDay.set(String(row.day), Number(row.total ?? 0));

    const keys = buildDayKeys(vnDayKey(start), vnDayKey(end));
    const points: ReportsDailyPoint[] = keys.map((date) => {
      const o = ordersByDay.get(date) ?? { n: 0, value: 0 };
      const grossCollected = collectedByDay.get(date) ?? 0;
      const refundTotal = refundByDay.get(date) ?? 0;
      return {
        date,
        orderCount: o.n,
        orderValue: o.value,
        grossCollected,
        refundTotal,
        netCollected: grossCollected - refundTotal,
      };
    });

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      days: points.length,
      points,
    };
  }
}
