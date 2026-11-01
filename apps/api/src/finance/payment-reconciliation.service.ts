import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination } from '../common/dto/pagination-query.dto.js';
import type { PaymentStatus } from '../../generated/prisma/enums.js';

/**
 * Read-only reconciliation between money collected and money owed.
 *
 * The settlement engine already refuses to settle an order whose collection
 * evidence is incomplete, but a guard only stops NEW bad rows. This report is
 * the other half: it looks at what is already in the database and names every
 * order whose payment records disagree with the order they belong to, so an
 * operator can fix the cause (record the missing collection, complete the
 * pending refund) instead of guessing why a settlement excluded an order.
 *
 * It NEVER writes. A reconciliation job that "repairs" money rows would erase
 * the evidence of the very discrepancy it was asked to report, and the audit
 * trail would no longer explain the balance.
 *
 * Three independent facts are compared per order:
 *   obligation = orders.grand_total
 *   collected  = SUM(payments.amount) for payments with paid_at set and a
 *                non-FAILED status (a failed attempt moved no money)
 *   refunded   = SUM(refunds.amount) for COMPLETED refunds only (PENDING and
 *                APPROVED are decisions, not money)
 */
export type ReconciliationIssue =
  | 'UNDER_COLLECTED'
  | 'OVER_COLLECTED'
  | 'SETTLED_WITHOUT_FULL_COLLECTION'
  | 'REFUND_WITHOUT_COLLECTION'
  | 'REFUND_STATUS_MISMATCH';

/**
 * How much of the collected money was returned. Reported on every row so a
 * fully refunded order is never confused with an under-collected one — they
 * look similar in a totals column but mean opposite things (money came back vs
 * money never arrived).
 */
export type RefundState = 'NONE' | 'PARTIAL' | 'FULL';

export interface ReconciliationFinding {
  orderId: number;
  code: string;
  status: string;
  createdAt: string;
  obligation: number;
  collected: number;
  refunded: number;
  outstanding: number;
  paymentStatuses: PaymentStatus[];
  refundState: RefundState;
  settled: boolean;
  issues: ReconciliationIssue[];
}

export interface ReconciliationQuery {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** Upper bound on rows read in one report; the response says when it clipped. */
export const MAX_RECONCILIATION_SCAN = 2000;

const MONEY_EPSILON = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class PaymentReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: ReconciliationQuery = {}) {
    const { page, limit } = buildPagination(query.page, query.limit);
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);
    const inRange = Object.keys(createdAt).length > 0 ? { createdAt } : {};

    /**
     * Only orders that carry money (or a settlement line) are relevant. An
     * order with neither is a fresh cart, not a discrepancy.
     */
    const orders = await this.prisma.order.findMany({
      where: {
        ...inRange,
        OR: [
          { payments: { some: {} } },
          { partnerOrders: { some: { settlementLines: { some: {} } } } },
        ],
      },
      select: {
        id: true,
        code: true,
        status: true,
        grandTotal: true,
        createdAt: true,
        payments: {
          select: {
            amount: true,
            status: true,
            paidAt: true,
            refunds: { select: { amount: true, status: true } },
          },
        },
        partnerOrders: { select: { settlementLines: { select: { id: true } } } },
      },
      orderBy: { id: 'desc' },
      take: MAX_RECONCILIATION_SCAN + 1,
    });

    const truncated = orders.length > MAX_RECONCILIATION_SCAN;
    const scanned = truncated ? orders.slice(0, MAX_RECONCILIATION_SCAN) : orders;

    const findings: ReconciliationFinding[] = [];
    const byIssue: Record<ReconciliationIssue, number> = {
      UNDER_COLLECTED: 0,
      OVER_COLLECTED: 0,
      SETTLED_WITHOUT_FULL_COLLECTION: 0,
      REFUND_WITHOUT_COLLECTION: 0,
      REFUND_STATUS_MISMATCH: 0,
    };
    let totalObligation = 0;
    let totalCollected = 0;
    let totalRefunded = 0;

    for (const order of scanned) {
      const obligation = round2(Number(order.grandTotal));
      const collected = round2(
        order.payments
          .filter((payment) => payment.paidAt !== null && payment.status !== 'FAILED')
          .reduce((sum, payment) => sum + Number(payment.amount), 0),
      );
      const refunded = round2(
        order.payments.reduce(
          (sum, payment) =>
            sum +
            payment.refunds
              .filter((refund) => refund.status === 'COMPLETED')
              .reduce((refundSum, refund) => refundSum + Number(refund.amount), 0),
          0,
        ),
      );
      const settled = order.partnerOrders.some((po) => po.settlementLines.length > 0);
      const paymentStatuses = order.payments.map((payment) => payment.status);
      const issues: ReconciliationIssue[] = [];

      if (collected > 0 && collected + MONEY_EPSILON < obligation) {
        issues.push('UNDER_COLLECTED');
      }
      if (collected > obligation + MONEY_EPSILON) {
        issues.push('OVER_COLLECTED');
      }
      if (settled && collected + MONEY_EPSILON < obligation) {
        issues.push('SETTLED_WITHOUT_FULL_COLLECTION');
      }
      if (refunded > 0 && collected <= 0) {
        issues.push('REFUND_WITHOUT_COLLECTION');
      }
      if (paymentStatuses.some((status) => status !== 'FAILED' && status !== 'PENDING')) {
        if (paymentStatuses.includes('REFUNDED') && Math.abs(refunded - collected) > MONEY_EPSILON) {
          issues.push('REFUND_STATUS_MISMATCH');
        } else if (
          paymentStatuses.includes('PARTIALLY_REFUNDED') &&
          (refunded <= MONEY_EPSILON || refunded + MONEY_EPSILON >= collected)
        ) {
          issues.push('REFUND_STATUS_MISMATCH');
        } else if (paymentStatuses.includes('PAID') && refunded > MONEY_EPSILON) {
          issues.push('REFUND_STATUS_MISMATCH');
        }
      }

      totalObligation = round2(totalObligation + obligation);
      totalCollected = round2(totalCollected + collected);
      totalRefunded = round2(totalRefunded + refunded);

      const refundState: RefundState =
        refunded <= MONEY_EPSILON ? 'NONE' : refunded + MONEY_EPSILON >= collected ? 'FULL' : 'PARTIAL';

      if (issues.length === 0) continue;
      for (const issue of issues) byIssue[issue] += 1;
      findings.push({
        orderId: order.id,
        code: order.code,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        obligation,
        collected,
        refunded,
        outstanding: round2(obligation - collected),
        paymentStatuses,
        refundState,
        settled,
        issues,
      });
    }

    const start = (page - 1) * limit;
    return {
      generatedAt: new Date().toISOString(),
      range: {
        from: query.from ?? null,
        to: query.to ?? null,
      },
      scanned: scanned.length,
      truncated,
      scanLimit: MAX_RECONCILIATION_SCAN,
      summary: {
        ordersWithFindings: findings.length,
        byIssue,
        totals: {
          obligation: totalObligation,
          collected: totalCollected,
          refunded: totalRefunded,
          outstanding: round2(totalObligation - totalCollected),
        },
      },
      findings: findings.slice(start, start + limit),
      meta: {
        page,
        limit,
        total: findings.length,
        totalPages: limit > 0 ? Math.ceil(findings.length / limit) : 0,
      },
      note:
        'Read-only. Nothing here rewrites payments, refunds or settlements; a ' +
        'discrepancy is corrected through the normal collection/refund flow so ' +
        'the audit trail explains the new balance.',
    };
  }
}
