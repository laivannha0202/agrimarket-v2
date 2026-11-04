import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildPagination } from '../common/dto/pagination-query.dto.js';
import {
  MONEY_EPSILON,
  collectedAmount,
  hasFullCollection,
  round2,
} from '../common/utils/payment-collection.js';
import type { Prisma } from '../../generated/prisma/client.js';
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
 * Four independent facts are compared per order:
 *   originalValue = orders.grand_total (the agreed value, always preserved)
 *   obligation    = originalValue, or 0 once the order is CANCELLED
 *   collected     = SUM(payments.amount) for payments with paid_at set and a
 *                   non-FAILED status (a failed attempt moved no money)
 *   refunded      = SUM(refunds.amount) for COMPLETED refunds only (PENDING and
 *                   APPROVED are decisions, not money)
 *
 * A cancelled order is not rewritten to zero: the original value stays on the
 * row, the effective obligation is zero, and any money still retained after
 * refunds is reported as `refundDue` (money that must go back). For a cancelled
 * order the collection classification uses the net retained amount, so a fully
 * refunded cancellation is clean instead of looking "over-collected" forever.
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
  /** Order value as agreed at checkout; never rewritten by a cancellation. */
  originalValue: number;
  /** Effective debt: 0 for a cancelled order, otherwise `originalValue`. */
  obligation: number;
  collected: number;
  refunded: number;
  /** Still to collect against the effective obligation. */
  outstanding: number;
  /** Money retained beyond the effective obligation; must be refunded. */
  refundDue: number;
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

/**
 * Rows read per keyset page. The report walks the whole period in bounded
 * batches instead of loading every order at once; the number is a memory
 * bound, not a cap on what the report covers.
 */
export const RECONCILIATION_BATCH_SIZE = 500;

const RECONCILIATION_ORDER_SELECT = {
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
} satisfies Prisma.OrderSelect;

type ReconciliationOrder = Prisma.OrderGetPayload<{
  select: typeof RECONCILIATION_ORDER_SELECT;
}>;

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
    let totalOriginalValue = 0;
    let totalObligation = 0;
    let totalCollected = 0;
    let totalRefunded = 0;
    let totalOutstanding = 0;
    let totalRefundDue = 0;
    let scanned = 0;
    let ordersWithFindings = 0;

    /**
     * `includeMatched` only widens what the caller may LIST. Every number in
     * `summary` stays a statement about the whole date window, not about the
     * current filter, so "đơn có chênh lệch" never shrinks because a tab is
     * open.
     */
    const search = query.search?.trim().toLowerCase();
    const start = (page - 1) * limit;
    const listed: ReconciliationFinding[] = [];
    let listedTotal = 0;
    const matchesList = (row: ReconciliationFinding): boolean => {
      if (!query.includeMatched && row.issues.length === 0) return false;
      if (query.status && row.status !== query.status) return false;
      if (query.issue && !row.issues.includes(query.issue)) return false;
      if (query.collection && row.collection !== query.collection) return false;
      if (query.refundState && row.refundState !== query.refundState) return false;
      if (search && !row.code.toLowerCase().includes(search)) return false;
      return true;
    };

    /**
     * Walk the whole period in keyset batches (id DESC). Each query is bounded
     * by `RECONCILIATION_BATCH_SIZE`, but there is no cap on the number of
     * batches: a report must never silently stop at the first N orders. Only
     * the requested page is retained while the summary counters cover every
     * order, so memory stays bounded even when the period is large.
     */
    let cursorId: number | undefined;
    for (;;) {
      const batch = await this.prisma.order.findMany({
        where: {
          ...inRange,
          ...(cursorId === undefined ? {} : { id: { lt: cursorId } }),
          OR: [
            { payments: { some: {} } },
            { partnerOrders: { some: { settlementLines: { some: {} } } } },
          ],
        },
        select: RECONCILIATION_ORDER_SELECT,
        orderBy: { id: 'desc' },
        take: RECONCILIATION_BATCH_SIZE,
      });
      if (batch.length === 0) break;
      cursorId = batch[batch.length - 1].id;

      for (const order of batch) {
        const row = this.classify(order);
        scanned += 1;
        if (row.issues.length > 0) ordersWithFindings += 1;
        byCollection[row.collection] += 1;
        for (const issue of row.issues) byIssue[issue] += 1;
        totalOriginalValue = round2(totalOriginalValue + row.originalValue);
        totalObligation = round2(totalObligation + row.obligation);
        totalCollected = round2(totalCollected + row.collected);
        totalRefunded = round2(totalRefunded + row.refunded);
        // Sum the per-order figures instead of netting over-collection against
        // under-collection: 30k overpaid on one order does not reduce the 100k
        // still owed on another. The two KPIs must be actionable independently.
        totalOutstanding = round2(totalOutstanding + row.outstanding);
        totalRefundDue = round2(totalRefundDue + row.refundDue);

        if (matchesList(row)) {
          if (listedTotal >= start && listed.length < limit) listed.push(row);
          listedTotal += 1;
        }
      }

      if (batch.length < RECONCILIATION_BATCH_SIZE) break;
    }

    return {
      generatedAt: new Date().toISOString(),
      range: {
        from: query.from ?? null,
        to: query.to ?? null,
      },
      scanned,
      summary: {
        ordersWithFindings,
        byIssue,
        byCollection,
        totals: {
          originalValue: totalOriginalValue,
          obligation: totalObligation,
          collected: totalCollected,
          refunded: totalRefunded,
          outstanding: totalOutstanding,
          refundDue: totalRefundDue,
        },
      },
      findings: listed,
      meta: {
        page,
        limit,
        total: listedTotal,
        totalPages: limit > 0 ? Math.ceil(listedTotal / limit) : 0,
      },
      note:
        'Read-only. Nothing here rewrites payments, refunds or settlements; a ' +
        'discrepancy is corrected through the normal collection/refund flow so ' +
        'the audit trail explains the new balance.',
    };
  }

  /**
   * Compare the money facts of one order and name every discrepancy.
   *
   * Kept as a pure per-row step so the report can classify a stream of batches
   * without ever holding the whole period in memory.
   */
  private classify(order: ReconciliationOrder): ReconciliationFinding {
    const originalValue = round2(Number(order.grandTotal));
    const cancelled = order.status === 'CANCELLED';
    // A cancelled order owes nothing. The original value is kept for the audit
    // trail; it is not silently rewritten to 0 in the order row.
    const obligation = cancelled ? 0 : originalValue;
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
    /**
     * A cancelled order keeps the gross `collected` figure for the audit trail,
     * but the classification looks at the money still retained after refunds:
     * a cancellation that was paid and fully refunded is clean, not
     * "over-collected" forever.
     */
    const effectiveCollected = cancelled
      ? round2(Math.max(0, collected - refunded))
      : collected;
    const collection = collectionState(effectiveCollected, obligation);
    const issues: ReconciliationIssue[] = [];

    if (collection === 'PARTIAL') issues.push('UNDER_COLLECTED');
    if (collection === 'OVER') issues.push('OVER_COLLECTED');
    if (settled && !hasFullCollection(effectiveCollected, obligation)) {
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
     * order would look clean while the money it claims is invisible — the exact
     * row an accountant must fix before the books can balance.
     */
    if (
      order.payments.some(
        (payment) =>
          payment.paidAt === null && payment.status !== 'PENDING' && payment.status !== 'FAILED',
      )
    ) {
      issues.push('MISSING_COLLECTION_EVIDENCE');
    }

    const outstanding = round2(Math.max(0, obligation - collected));
    const refundDue = round2(Math.max(0, collected - refunded - obligation));
    const refundState: RefundState =
      refunded <= MONEY_EPSILON
        ? 'NONE'
        : refunded + MONEY_EPSILON >= collected
          ? 'FULL'
          : 'PARTIAL';

    return {
      orderId: order.id,
      code: order.code,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      originalValue,
      obligation,
      collected,
      refunded,
      outstanding,
      refundDue,
      collection,
      paymentStatuses,
      refundState,
      settled,
      settlements,
      issues,
    };
  }
}
