import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination } from '../common/dto/pagination-query.dto.js';
import {
  MONEY_EPSILON,
  collectedAmount,
  hasFullCollection,
  round2,
} from '../common/utils/payment-collection.js';
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
 *
 * The classification (`collection`) is computed here, never in the browser:
 * the Admin screen displays these numbers, it does not re-add them.
 */
export type ReconciliationIssue =
  | 'UNDER_COLLECTED'
  | 'OVER_COLLECTED'
  | 'SETTLED_WITHOUT_FULL_COLLECTION'
  | 'REFUND_WITHOUT_COLLECTION'
  | 'REFUND_STATUS_MISMATCH'
  | 'MISSING_COLLECTION_EVIDENCE';

/** Runtime list for query validation and Swagger; mirrors the union above. */
export const RECONCILIATION_ISSUES: readonly ReconciliationIssue[] = [
  'UNDER_COLLECTED',
  'OVER_COLLECTED',
  'SETTLED_WITHOUT_FULL_COLLECTION',
  'REFUND_WITHOUT_COLLECTION',
  'REFUND_STATUS_MISMATCH',
  'MISSING_COLLECTION_EVIDENCE',
];

/**
 * How much of the collected money was returned. Reported on every row so a
 * fully refunded order is never confused with an under-collected one — they
 * look similar in a totals column but mean opposite things (money came back vs
 * money never arrived).
 */
export type RefundState = 'NONE' | 'PARTIAL' | 'FULL';

export const RECONCILIATION_REFUND_STATES: readonly RefundState[] = ['NONE', 'PARTIAL', 'FULL'];

/**
 * How much of the order obligation the recorded payments cover.
 *
 * Derived from the two numbers above with the same epsilon the settlement
 * guard uses, so "settleable" and "fully collected" cannot disagree.
 */
export type CollectionState = 'NONE' | 'PARTIAL' | 'FULL' | 'OVER';

export const RECONCILIATION_COLLECTION_STATES: readonly CollectionState[] = [
  'NONE',
  'PARTIAL',
  'FULL',
  'OVER',
];

/** A settlement that already claimed a line of this order. */
export interface ReconciliationSettlementRef {
  id: number;
  code: string;
  status: string;
}

export interface ReconciliationFinding {
  orderId: number;
  code: string;
  status: string;
  createdAt: string;
  obligation: number;
  collected: number;
  refunded: number;
  outstanding: number;
  collection: CollectionState;
  paymentStatuses: PaymentStatus[];
  refundState: RefundState;
  settled: boolean;
  settlements: ReconciliationSettlementRef[];
  issues: ReconciliationIssue[];
}

export interface ReconciliationQuery {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  /** Order status, e.g. `DELIVERED`. */
  status?: string;
  issue?: ReconciliationIssue;
  collection?: CollectionState;
  refundState?: RefundState;
  /** Case-insensitive substring of the order code. */
  search?: string;
  /**
   * Include orders with no finding. Off by default: the report is a worklist of
   * discrepancies, and a clean order is not an action item. The Admin screen
   * turns it on for the "already fully collected" view.
   */
  includeMatched?: boolean;
}

/** Upper bound on rows read in one report; the response says when it clipped. */
export const MAX_RECONCILIATION_SCAN = 2000;

function collectionState(collected: number, obligation: number): CollectionState {
  if (collected <= 0) return 'NONE';
  if (collected > obligation + MONEY_EPSILON) return 'OVER';
  return hasFullCollection(collected, obligation) ? 'FULL' : 'PARTIAL';
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
        partnerOrders: {
          select: {
            settlementLines: {
              select: {
                settlement: { select: { id: true, code: true, status: true } },
              },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: MAX_RECONCILIATION_SCAN + 1,
    });

    const truncated = orders.length > MAX_RECONCILIATION_SCAN;
    const scanned = truncated ? orders.slice(0, MAX_RECONCILIATION_SCAN) : orders;

    /** Every scanned order, with or without a finding. */
    const rows: ReconciliationFinding[] = [];
    const byIssue: Record<ReconciliationIssue, number> = {
      UNDER_COLLECTED: 0,
      OVER_COLLECTED: 0,
      SETTLED_WITHOUT_FULL_COLLECTION: 0,
      REFUND_WITHOUT_COLLECTION: 0,
      REFUND_STATUS_MISMATCH: 0,
      MISSING_COLLECTION_EVIDENCE: 0,
    };
    const byCollection: Record<CollectionState, number> = {
      NONE: 0,
      PARTIAL: 0,
      FULL: 0,
      OVER: 0,
    };
    let totalObligation = 0;
    let totalCollected = 0;
    let totalRefunded = 0;

    for (const order of scanned) {
      const obligation = round2(Number(order.grandTotal));
      const collected = collectedAmount(order.payments);
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
      const settlements = [
        ...new Map(
          order.partnerOrders
            .flatMap((partnerOrder) => partnerOrder.settlementLines)
            .map((line) => [line.settlement.id, line.settlement] as const),
        ).values(),
      ];
      const settled = settlements.length > 0;
      const paymentStatuses = order.payments.map((payment) => payment.status);
      const collection = collectionState(collected, obligation);
      const issues: ReconciliationIssue[] = [];

      if (collection === 'PARTIAL') issues.push('UNDER_COLLECTED');
      if (collection === 'OVER') issues.push('OVER_COLLECTED');
      if (settled && !hasFullCollection(collected, obligation)) {
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
      /**
       * A payment that claims money moved (PAID / *_REFUNDED) but carries no
       * `paid_at` is excluded from `collected` above. Without this issue the
       * order would look clean while the money it claims is invisible — the
       * exact row an accountant must fix before the books can balance.
       */
      if (
        order.payments.some(
          (payment) =>
            payment.paidAt === null && payment.status !== 'PENDING' && payment.status !== 'FAILED',
        )
      ) {
        issues.push('MISSING_COLLECTION_EVIDENCE');
      }

      totalObligation = round2(totalObligation + obligation);
      totalCollected = round2(totalCollected + collected);
      totalRefunded = round2(totalRefunded + refunded);

      const refundState: RefundState =
        refunded <= MONEY_EPSILON ? 'NONE' : refunded + MONEY_EPSILON >= collected ? 'FULL' : 'PARTIAL';

      byCollection[collection] += 1;
      for (const issue of issues) byIssue[issue] += 1;
      rows.push({
        orderId: order.id,
        code: order.code,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        obligation,
        collected,
        refunded,
        outstanding: round2(obligation - collected),
        collection,
        paymentStatuses,
        refundState,
        settled,
        settlements,
        issues,
      });
    }

    const findings = rows.filter((row) => row.issues.length > 0);

    /**
     * `includeMatched` only widens what the caller may LIST. Every number in
     * `summary` stays a statement about the scanned period, not about the
     * current filter, so "đơn có chênh lệch" never shrinks because a tab is
     * open.
     */
    const search = query.search?.trim().toLowerCase();
    const listed = (query.includeMatched ? rows : findings).filter((row) => {
      if (query.status && row.status !== query.status) return false;
      if (query.issue && !row.issues.includes(query.issue)) return false;
      if (query.collection && row.collection !== query.collection) return false;
      if (query.refundState && row.refundState !== query.refundState) return false;
      if (search && !row.code.toLowerCase().includes(search)) return false;
      return true;
    });

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
        byCollection,
        totals: {
          obligation: totalObligation,
          collected: totalCollected,
          refunded: totalRefunded,
          outstanding: round2(totalObligation - totalCollected),
        },
      },
      findings: listed.slice(start, start + limit),
      meta: {
        page,
        limit,
        total: listed.length,
        totalPages: limit > 0 ? Math.ceil(listed.length / limit) : 0,
      },
      note:
        'Read-only. Nothing here rewrites payments, refunds or settlements; a ' +
        'discrepancy is corrected through the normal collection/refund flow so ' +
        'the audit trail explains the new balance.',
    };
  }
}
