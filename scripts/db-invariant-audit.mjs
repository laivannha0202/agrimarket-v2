#!/usr/bin/env node
/**
 * C-19 database invariant audit.
 *
 * Read-only SQL over one isolated schema. Every failing check exits non-zero;
 * trace completeness is reported as information because a missing event is a
 * data-quality finding, not something this audit may backfill.
 *
 *   node scripts/db-invariant-audit.mjs --url <isolated-url> [--out <json>]
 */
import {
  assertRunDatabase,
  databaseLabel,
  isMain,
  loadProjectEnv,
  nowIso,
  queryRows,
  redactUrl,
  writeJson,
} from './lib/verify-common.mjs';

/** Each check must return one row with a numeric `c` column. */
const CHECKS = [
  // -- Inventory -----------------------------------------------------------
  {
    name: 'inventory_negative',
    domain: 'inventory',
    description: 'on_hand / reserved / blocked are non-negative and available is not negative',
    sql: `SELECT COUNT(*) AS c FROM inventory_balances
           WHERE on_hand < 0 OR reserved < 0 OR blocked < 0
              OR on_hand - reserved - blocked < 0`,
  },
  {
    name: 'inventory_reserved_over_on_hand',
    domain: 'inventory',
    description: 'reserved stock never exceeds physical on-hand stock',
    sql: `SELECT COUNT(*) AS c FROM inventory_balances WHERE reserved > on_hand + 0.0005`,
  },
  {
    name: 'allocation_lot_mismatch',
    domain: 'inventory',
    description: 'an allocation points at the same lot as its inventory balance',
    sql: `SELECT COUNT(*) AS c
            FROM inventory_allocations a
            JOIN inventory_balances b ON b.id = a.inventory_balance_id
           WHERE a.product_lot_id <> b.product_lot_id OR a.quantity <= 0`,
  },
  {
    name: 'allocation_exceeds_order_line',
    domain: 'inventory',
    description: 'allocated quantity never exceeds the ordered quantity',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT oi.id, oi.quantity, COALESCE(SUM(a.quantity), 0) AS allocated
              FROM order_items oi
              LEFT JOIN inventory_allocations a ON a.order_item_id = oi.id
             GROUP BY oi.id, oi.quantity
            HAVING allocated > oi.quantity + 0.0005
          ) x`,
  },
  {
    name: 'active_allocation_over_reserved',
    domain: 'inventory',
    description: 'allocations for non-terminal orders never exceed reserved stock',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT b.id, b.reserved,
                   COALESCE(SUM(CASE WHEN o.status NOT IN ('DELIVERED','CANCELLED')
                                     THEN a.quantity ELSE 0 END), 0) AS active
              FROM inventory_balances b
              LEFT JOIN inventory_allocations a ON a.inventory_balance_id = b.id
              LEFT JOIN order_items oi ON oi.id = a.order_item_id
              LEFT JOIN partner_orders po ON po.id = oi.partner_order_id
              LEFT JOIN orders o ON o.id = po.order_id
             GROUP BY b.id, b.reserved
            HAVING active > b.reserved + 0.0005
          ) x`,
  },
  {
    name: 'movement_delta_mismatch',
    domain: 'inventory',
    description: 'stock movements satisfy after_quantity = before_quantity + quantity_delta',
    sql: `SELECT COUNT(*) AS c FROM inventory_movements
           WHERE type IN ('INBOUND','OUTBOUND','ADJUSTMENT','RETURN','SCRAP')
             AND ABS(after_quantity - (before_quantity + quantity_delta)) > 0.0005`,
  },
  {
    name: 'movement_negative_quantity',
    domain: 'inventory',
    description: 'a movement never records a negative physical quantity',
    sql: `SELECT COUNT(*) AS c FROM inventory_movements
           WHERE before_quantity < 0 OR after_quantity < 0`,
  },
  {
    name: 'balance_vs_movement_ledger',
    domain: 'inventory',
    description: 'on-hand equals the sum of physical stock movement deltas',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT b.id, b.on_hand,
                   COALESCE(SUM(CASE WHEN m.type IN ('INBOUND','OUTBOUND','ADJUSTMENT','RETURN','SCRAP')
                                     THEN m.quantity_delta ELSE 0 END), 0) AS ledger
              FROM inventory_balances b
              LEFT JOIN inventory_movements m
                ON m.warehouse_id = b.warehouse_id
               AND m.product_lot_id = b.product_lot_id
               AND m.product_variant_id = b.product_variant_id
             GROUP BY b.id, b.on_hand
            HAVING ABS(b.on_hand - ledger) > 0.0005
          ) x`,
  },
  {
    name: 'lot_remaining_range',
    domain: 'inventory',
    description: 'lot remaining_quantity is between zero and the harvested quantity',
    sql: `SELECT COUNT(*) AS c FROM product_lots
           WHERE remaining_quantity < 0 OR remaining_quantity > quantity + 0.0005`,
  },
  {
    name: 'lot_nonpositive_quantity',
    domain: 'inventory',
    description: 'every product lot records a positive quantity',
    sql: `SELECT COUNT(*) AS c FROM product_lots WHERE quantity <= 0`,
  },
  {
    name: 'quarantine_blocked_mismatch',
    domain: 'inventory',
    description: 'blocked stock equals the sum of open quarantine cases',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT b.id, b.blocked,
                   COALESCE(SUM(CASE WHEN qc.status IN ('PENDING','PASSED','FAILED')
                                     THEN qc.quantity ELSE 0 END), 0) AS quarantined
              FROM inventory_balances b
              LEFT JOIN quarantine_cases qc
                ON qc.warehouse_id = b.warehouse_id
               AND qc.product_lot_id = b.product_lot_id
               AND qc.product_variant_id = b.product_variant_id
             GROUP BY b.id, b.blocked
            HAVING ABS(b.blocked - quarantined) > 0.0005
          ) x`,
  },
  {
    name: 'quarantine_nonpositive_quantity',
    domain: 'quarantine',
    description: 'every quarantine case records a positive quantity',
    sql: `SELECT COUNT(*) AS c FROM quarantine_cases WHERE quantity <= 0`,
  },
  {
    name: 'warehouse_return_without_quarantine',
    domain: 'quarantine',
    description: 'a completed RETURN document opens a quarantine case',
    sql: `SELECT COUNT(*) AS c FROM warehouse_documents d
           WHERE d.type = 'RETURN' AND d.status = 'COMPLETED'
             AND NOT EXISTS (
               SELECT 1 FROM quarantine_cases qc
                WHERE qc.source_type = 'WAREHOUSE_RETURN' AND qc.source_id = d.id)`,
  },

  // -- C-14 farming / harvest ---------------------------------------------
  {
    name: 'harvest_over_allocated',
    domain: 'c14',
    description: 'harvest quantity is never smaller than the lots created from it',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT h.id, h.quantity, COALESCE(SUM(pl.quantity), 0) AS allocated
              FROM harvests h
              LEFT JOIN product_lots pl ON pl.harvest_id = h.id
             GROUP BY h.id, h.quantity
            HAVING allocated > h.quantity + 0.0005
          ) x`,
  },
  {
    name: 'harvest_before_planting',
    domain: 'c14',
    description: 'a harvest date is not earlier than its season planting date',
    sql: `SELECT COUNT(*) AS c
            FROM harvests h
            JOIN seasons s ON s.id = h.season_id
           WHERE s.planting_date IS NOT NULL AND h.harvest_date < s.planting_date`,
  },
  {
    name: 'farming_event_in_future',
    domain: 'c14',
    description: 'a farming event is not recorded in the future',
    sql: `SELECT COUNT(*) AS c FROM farming_events
           WHERE occurred_at > UTC_TIMESTAMP(3) + INTERVAL 5 MINUTE`,
  },
  {
    name: 'season_expected_date_order',
    domain: 'c14',
    description: 'expected harvest date is not earlier than planting date',
    sql: `SELECT COUNT(*) AS c FROM seasons
           WHERE planting_date IS NOT NULL AND expected_harvest_date IS NOT NULL
             AND expected_harvest_date < planting_date`,
  },

  // -- Orders / payments ---------------------------------------------------
  {
    name: 'order_total_formula',
    domain: 'orders',
    description: 'grand_total = subtotal - discount_total + shipping_fee',
    sql: `SELECT COUNT(*) AS c FROM orders
           WHERE ABS(grand_total - (subtotal - discount_total + shipping_fee)) > 0.01`,
  },
  {
    name: 'order_item_subtotal_formula',
    domain: 'orders',
    description: 'order item subtotal equals unit price snapshot × quantity',
    sql: `SELECT COUNT(*) AS c FROM order_items
           WHERE ABS(subtotal - unit_price_snapshot * quantity) > 0.01`,
  },
  {
    name: 'partner_order_total_mismatch',
    domain: 'orders',
    description:
      'partner-order subtotals add up to the order subtotal, and partner discounts plus the platform-funded voucher add up to the order discount',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT o.id, o.subtotal, o.discount_total,
                   SUM(po.subtotal) AS partner_subtotal,
                   SUM(po.discount_total) AS partner_discount,
                   COALESCE(v.voucher_discount, 0) AS voucher_discount
              FROM orders o
              JOIN partner_orders po ON po.order_id = o.id
              LEFT JOIN (
                    SELECT order_id, SUM(discount_amount) AS voucher_discount
                      FROM voucher_redemptions
                     GROUP BY order_id
                   ) v ON v.order_id = o.id
             GROUP BY o.id, o.subtotal, o.discount_total, v.voucher_discount
            HAVING ABS(partner_subtotal - o.subtotal) > 0.01
                OR ABS(partner_discount + voucher_discount - o.discount_total) > 0.01
          ) x`,
  },
  {
    name: 'partner_order_payable_formula',
    domain: 'orders',
    description: 'partner payable = subtotal - discount - commission',
    sql: `SELECT COUNT(*) AS c FROM partner_orders
           WHERE ABS(payable_amount - (subtotal - discount_total - commission_amount)) > 0.01`,
  },
  {
    name: 'payment_total_over_order',
    domain: 'orders',
    description: 'non-failed payments never exceed the order grand total',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT o.id, o.grand_total,
                   COALESCE(SUM(CASE WHEN p.status <> 'FAILED' THEN p.amount ELSE 0 END), 0) AS paid
              FROM orders o
              JOIN payments p ON p.order_id = o.id
             GROUP BY o.id, o.grand_total
            HAVING paid > o.grand_total + 0.01
          ) x`,
  },
  {
    name: 'paid_payment_missing_paid_at',
    domain: 'payments',
    description: 'a PAID payment records paid_at',
    sql: `SELECT COUNT(*) AS c FROM payments WHERE status = 'PAID' AND paid_at IS NULL`,
  },
  {
    name: 'payment_status_refund_mismatch',
    domain: 'payments',
    description:
      'the payment status matches its completed refunds (PAID = none, PARTIALLY_REFUNDED = some but not all, REFUNDED = all)',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT p.id, p.amount, p.status,
                   COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN r.amount ELSE 0 END), 0) AS refunded
              FROM payments p
              LEFT JOIN refunds r ON r.payment_id = p.id
             WHERE p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
             GROUP BY p.id, p.amount, p.status
            HAVING (p.status = 'REFUNDED' AND ABS(refunded - p.amount) > 0.01)
                OR (p.status = 'PARTIALLY_REFUNDED'
                    AND (refunded <= 0.01 OR refunded + 0.01 >= p.amount))
                OR (p.status = 'PAID' AND refunded > 0.01)
          ) x`,
  },
  {
    name: 'refund_without_collected_payment',
    domain: 'payments',
    description: 'a COMPLETED refund belongs to a payment that was actually collected',
    sql: `SELECT COUNT(*) AS c
            FROM refunds r
            JOIN payments p ON p.id = r.payment_id
           WHERE r.status = 'COMPLETED'
             AND (p.paid_at IS NULL OR p.status = 'FAILED')`,
  },

  // -- Returns / refunds ---------------------------------------------------
  {
    name: 'refund_over_payment',
    domain: 'refunds',
    description: 'completed refunds never exceed the payment amount',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT p.id, p.amount,
                   COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN r.amount ELSE 0 END), 0) AS refunded
              FROM payments p
              LEFT JOIN refunds r ON r.payment_id = p.id
             GROUP BY p.id, p.amount
            HAVING refunded > p.amount + 0.01
          ) x`,
  },
  {
    name: 'refund_nonpositive',
    domain: 'refunds',
    description: 'every refund records a positive amount',
    sql: `SELECT COUNT(*) AS c FROM refunds WHERE amount <= 0`,
  },
  {
    name: 'completed_refund_missing_evidence',
    domain: 'refunds',
    description: 'a COMPLETED refund has a reference and completed_at',
    sql: `SELECT COUNT(*) AS c FROM refunds
           WHERE status = 'COMPLETED'
             AND (reference IS NULL OR reference = '' OR completed_at IS NULL)`,
  },
  {
    name: 'bad_refunded_returns',
    domain: 'returns',
    description: 'a REFUNDED return is linked to a COMPLETED refund',
    sql: `SELECT COUNT(*) AS c
            FROM return_requests rr
            LEFT JOIN refunds r ON r.id = rr.refund_id
           WHERE rr.status = 'REFUNDED'
             AND (rr.refund_id IS NULL OR r.id IS NULL OR r.status <> 'COMPLETED')`,
  },
  {
    name: 'refunded_return_without_quarantine',
    domain: 'returns',
    description: 'a REFUNDED return has a resolved quarantine case',
    sql: `SELECT COUNT(*) AS c FROM return_requests rr
           WHERE rr.status = 'REFUNDED'
             AND NOT EXISTS (
               SELECT 1 FROM quarantine_cases qc
                WHERE qc.return_request_id = rr.id
                  AND qc.status IN ('RELEASED','SCRAPPED'))`,
  },
  {
    name: 'refunded_return_missing_received_at',
    domain: 'returns',
    description: 'a REFUNDED return records when the goods were received',
    sql: `SELECT COUNT(*) AS c FROM return_requests
           WHERE status = 'REFUNDED' AND received_at IS NULL`,
  },
  {
    name: 'return_quantity_over_item',
    domain: 'returns',
    description: 'return quantity never exceeds the purchased quantity',
    sql: `SELECT COUNT(*) AS c
            FROM return_requests rr
            JOIN order_items oi ON oi.id = rr.order_item_id
           WHERE rr.quantity > oi.quantity + 0.0005`,
  },
  {
    name: 'duplicate_refund_links',
    domain: 'returns',
    description: 'one refund is linked to at most one return request',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT refund_id FROM return_requests
             WHERE refund_id IS NOT NULL
             GROUP BY refund_id HAVING COUNT(*) > 1
          ) x`,
  },

  // -- Shipments -----------------------------------------------------------
  {
    name: 'shipment_order_mismatch',
    domain: 'shipments',
    description: 'shipment and partner-order/order statuses agree',
    sql: `SELECT COUNT(*) AS c
            FROM shipments s
            JOIN partner_orders po ON po.id = s.partner_order_id
            JOIN orders o ON o.id = po.order_id
           WHERE (s.status = 'DELIVERED' AND po.status <> 'DELIVERED')
              OR (s.status = 'RETURNED' AND po.status <> 'CANCELLED')
              OR (s.status IN ('CANCELLED') AND po.status <> 'CANCELLED')
              OR (s.status IN ('PENDING','READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_FAILED')
                  AND o.status = 'CANCELLED')`,
  },
  {
    name: 'delivered_shipment_missing_timestamp',
    domain: 'shipments',
    description: 'a DELIVERED shipment records delivered_at',
    sql: `SELECT COUNT(*) AS c FROM shipments WHERE status = 'DELIVERED' AND delivered_at IS NULL`,
  },
  {
    name: 'delivered_shipment_order_not_delivered',
    domain: 'shipments',
    description: 'a DELIVERED shipment belongs to a DELIVERED order',
    sql: `SELECT COUNT(*) AS c
            FROM shipments s
            JOIN partner_orders po ON po.id = s.partner_order_id
            JOIN orders o ON o.id = po.order_id
           WHERE s.status = 'DELIVERED' AND o.status <> 'DELIVERED'`,
  },

  // -- C-08 settlements / payouts / recoveries ----------------------------
  {
    name: 'settlement_formula',
    domain: 'c08',
    description: 'payable = gross - refund - commission + adjustment',
    sql: `SELECT COUNT(*) AS c FROM settlements
           WHERE ABS(payable_amount -
                     (gross_amount - refund_amount - commission_amount + adjustment_amount)) > 0.01`,
  },
  {
    name: 'settlement_line_totals',
    domain: 'c08',
    description: 'settlement lines add up to their header amounts',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT s.id, s.gross_amount, s.refund_amount, s.commission_amount,
                   s.adjustment_amount, s.payable_amount,
                   COALESCE(SUM(l.gross_amount), 0) AS line_gross,
                   COALESCE(SUM(l.refund_amount), 0) AS line_refund,
                   COALESCE(SUM(l.commission_amount), 0) AS line_commission,
                   COALESCE(SUM(l.payable_amount), 0) AS line_payable
              FROM settlements s
              LEFT JOIN settlement_lines l ON l.settlement_id = s.id
             GROUP BY s.id, s.gross_amount, s.refund_amount, s.commission_amount,
                      s.adjustment_amount, s.payable_amount
            HAVING ABS(line_gross - s.gross_amount) > 0.01
                OR ABS(line_refund - s.refund_amount) > 0.01
                OR ABS(line_commission - s.commission_amount) > 0.01
                OR ABS(line_payable - (s.payable_amount - s.adjustment_amount)) > 0.01
          ) x`,
  },
  {
    name: 'settlement_line_formula',
    domain: 'c08',
    description: 'line payable = gross - refund - commission',
    sql: `SELECT COUNT(*) AS c FROM settlement_lines
           WHERE ABS(payable_amount - (gross_amount - refund_amount - commission_amount)) > 0.01`,
  },
  {
    name: 'settlement_confirmed_missing_timestamp',
    domain: 'c08',
    description: 'CONFIRMED/PAID settlements record confirmed_at',
    sql: `SELECT COUNT(*) AS c FROM settlements
           WHERE status IN ('CONFIRMED','PAID') AND confirmed_at IS NULL`,
  },
  {
    name: 'payout_over_settlement',
    domain: 'c08',
    description: 'pending + paid payouts never exceed the settlement payable',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT s.id, s.payable_amount,
                   COALESCE(SUM(CASE WHEN p.status IN ('PENDING','PAID') THEN p.amount ELSE 0 END), 0) AS paid
              FROM settlements s
              LEFT JOIN payouts p ON p.settlement_id = s.id
             GROUP BY s.id, s.payable_amount
            HAVING paid > s.payable_amount + 0.01
          ) x`,
  },
  {
    name: 'payout_partner_mismatch',
    domain: 'c08',
    description: 'a payout belongs to the same partner as its settlement',
    sql: `SELECT COUNT(*) AS c
            FROM payouts p
            JOIN settlements s ON s.id = p.settlement_id
           WHERE p.partner_id <> s.partner_id`,
  },
  {
    name: 'payout_paid_missing_timestamp',
    domain: 'c08',
    description: 'a PAID payout records paid_at',
    sql: `SELECT COUNT(*) AS c FROM payouts WHERE status = 'PAID' AND paid_at IS NULL`,
  },
  {
    name: 'payout_nonpositive',
    domain: 'c08',
    description: 'every payout records a positive amount',
    sql: `SELECT COUNT(*) AS c FROM payouts WHERE amount <= 0`,
  },
  {
    name: 'settlement_paid_without_payout',
    domain: 'c08',
    description: 'a PAID settlement has at least one PAID payout',
    sql: `SELECT COUNT(*) AS c FROM settlements s
           WHERE s.status = 'PAID'
             AND NOT EXISTS (
               SELECT 1 FROM payouts p
                WHERE p.settlement_id = s.id AND p.status = 'PAID')`,
  },
  {
    name: 'adjustment_review_fields',
    domain: 'c08',
    description: 'REVIEWED adjustments record resolution, reviewer and time',
    sql: `SELECT COUNT(*) AS c FROM settlement_adjustments
           WHERE status = 'REVIEWED'
             AND (resolution IS NULL OR reviewed_by_user_id IS NULL OR reviewed_at IS NULL)`,
  },
  {
    name: 'open_adjustment_has_resolution',
    domain: 'c08',
    description: 'OPEN adjustments have no resolution',
    sql: `SELECT COUNT(*) AS c FROM settlement_adjustments
           WHERE status = 'OPEN' AND resolution IS NOT NULL`,
  },
  {
    name: 'adjustment_nonpositive',
    domain: 'c08',
    description: 'every settlement adjustment records a positive amount',
    sql: `SELECT COUNT(*) AS c FROM settlement_adjustments WHERE amount <= 0`,
  },
  {
    name: 'open_adjustment_blocks_new_payout',
    domain: 'c08',
    description: 'no pending payout was created after an OPEN adjustment for the same partner',
    sql: `SELECT COUNT(*) AS c
            FROM payouts p
            JOIN settlement_adjustments a ON a.partner_id = p.partner_id
           WHERE p.status = 'PENDING'
             AND a.status = 'OPEN'
             AND p.created_at > a.created_at`,
  },
  {
    name: 'recovery_adjustment_mismatch',
    domain: 'c08',
    description: 'a recovery matches its DEDUCT_NEXT adjustment (partner + amount)',
    sql: `SELECT COUNT(*) AS c
            FROM settlement_recoveries r
            JOIN settlement_adjustments a ON a.id = r.adjustment_id
           WHERE r.partner_id <> a.partner_id
              OR ABS(r.amount - a.amount) > 0.01
              OR a.resolution <> 'DEDUCT_NEXT'`,
  },
  {
    name: 'recovery_status_fields',
    domain: 'c08',
    description: 'recovery timestamps and actors agree with the status',
    sql: `SELECT COUNT(*) AS c FROM settlement_recoveries
           WHERE (status = 'PENDING_APPROVAL'
                  AND (approved_at IS NOT NULL OR rejected_at IS NOT NULL OR recorded_at IS NOT NULL))
              OR (status = 'APPROVED'
                  AND (approved_at IS NULL OR approved_by_user_id IS NULL
                       OR rejected_at IS NOT NULL OR recorded_at IS NOT NULL))
              OR (status = 'RECORDED'
                  AND (approved_at IS NULL OR recorded_at IS NULL OR recorded_by_user_id IS NULL
                       OR recovery_reference IS NULL OR recovery_reference = ''))
              OR (status = 'REJECTED'
                  AND (rejected_at IS NULL OR rejected_by_user_id IS NULL OR recorded_at IS NOT NULL))`,
  },
  {
    name: 'unresolved_recovery_blocks_new_payout',
    domain: 'c08',
    description: 'no pending payout was created after an unresolved recovery for the same partner',
    sql: `SELECT COUNT(*) AS c
            FROM payouts p
            JOIN settlement_recoveries r ON r.partner_id = p.partner_id
           WHERE p.status = 'PENDING'
             AND r.status IN ('PENDING_APPROVAL','APPROVED')
             AND p.created_at > r.created_at`,
  },
  {
    name: 'settled_order_under_collected',
    domain: 'c08',
    description:
      'a settled order was fully collected: payments with paid_at cover the order grand total',
    sql: `SELECT COUNT(*) AS c FROM (
            SELECT o.id, o.grand_total,
                   COALESCE(SUM(CASE WHEN p.paid_at IS NOT NULL AND p.status <> 'FAILED'
                                     THEN p.amount ELSE 0 END), 0) AS collected
              FROM orders o
              JOIN partner_orders po ON po.order_id = o.id
              JOIN settlement_lines sl ON sl.partner_order_id = po.id
              LEFT JOIN payments p ON p.order_id = o.id
             GROUP BY o.id, o.grand_total
            HAVING collected + 0.01 < o.grand_total
          ) x`,
  },
  {
    name: 'settlement_line_refund_over_gross',
    domain: 'c08',
    description:
      'a settlement line never deducts more refund than the goods it covers are worth',
    sql: `SELECT COUNT(*) AS c FROM settlement_lines
           WHERE refund_amount > gross_amount + 0.01`,
  },
];

export async function runInvariantAudit(url, options = {}) {
  const parsed = assertRunDatabase(url, '--url');
  const checks = [];
  const failures = [];

  for (const definition of CHECKS) {
    try {
      const rows = await queryRows(parsed, definition.sql, [], parsed.database);
      const count = Number(rows[0]?.c ?? -1);
      const status = count === 0 ? 'PASS' : 'FAIL';
      checks.push({
        name: definition.name,
        domain: definition.domain,
        description: definition.description,
        count,
        status,
      });
      if (count !== 0) {
        failures.push(
          `${definition.name} (${definition.domain}): ${count} violating row(s) — ${definition.description}`,
        );
      }
    } catch (error) {
      checks.push({
        name: definition.name,
        domain: definition.domain,
        description: definition.description,
        count: null,
        status: 'ERROR',
        error: error.message,
      });
      failures.push(`${definition.name}: audit query failed — ${error.message}`);
    }
  }

  // Trace completeness is informational: C-14 requires gaps to be *reported*,
  // never silently backfilled by a verification job.
  let traceCoverage = null;
  try {
    const rows = await queryRows(
      parsed,
      `SELECT
          COUNT(*) AS sellable,
          SUM(CASE WHEN has_harvest = 0 OR has_qc = 0 OR has_warehouse_in = 0 THEN 1 ELSE 0 END) AS incomplete,
          SUM(CASE WHEN has_harvest = 0 THEN 1 ELSE 0 END) AS missing_harvest,
          SUM(CASE WHEN has_qc = 0 THEN 1 ELSE 0 END) AS missing_qc,
          SUM(CASE WHEN has_warehouse_in = 0 THEN 1 ELSE 0 END) AS missing_warehouse_in
        FROM (
          SELECT pl.id,
                 MAX(te.type = 'HARVEST') AS has_harvest,
                 MAX(te.type = 'QC') AS has_qc,
                 MAX(te.type = 'WAREHOUSE_IN') AS has_warehouse_in
            FROM product_lots pl
            LEFT JOIN trace_events te ON te.product_lot_id = pl.id
           WHERE pl.status = 'SELLABLE'
           GROUP BY pl.id
        ) x`,
      [],
      parsed.database,
    );
    const row = rows[0] ?? {};
    traceCoverage = {
      sellableLots: Number(row.sellable ?? 0),
      incompleteLots: Number(row.incomplete ?? 0),
      missingHarvestEvent: Number(row.missing_harvest ?? 0),
      missingQcEvent: Number(row.missing_qc ?? 0),
      missingWarehouseInEvent: Number(row.missing_warehouse_in ?? 0),
      note: 'Informational only. The admin trace audit reports gaps; this job never writes trace events.',
    };
  } catch (error) {
    traceCoverage = { error: error.message };
  }

  return {
    generatedAt: nowIso(),
    database: databaseLabel(parsed),
    url: redactUrl(url),
    checks,
    traceCoverage,
    failures,
    result: failures.length === 0 ? 'PASS' : 'FAIL',
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/db-invariant-audit.mjs --url <isolated-mysql-url> [--out <json>]

Read-only invariant audit. Exits 1 on any violation. The URL must be a
disposable *_test/_restore/_drill schema and must not be DATABASE_URL.`);
    process.exit(0);
  }
  loadProjectEnv();
  const index = args.indexOf('--url');
  const url = index >= 0 ? args[index + 1] : process.env.VERIFY_DATABASE_URL;
  if (!url) throw new Error('--url (or VERIFY_DATABASE_URL) is required.');
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : null;

  const result = await runInvariantAudit(url);
  if (out) writeJson(out, result);

  console.log(`Database invariant audit: ${result.result}`);
  const failed = result.checks.filter((check) => check.status !== 'PASS');
  if (failed.length === 0) {
    console.log(`  PASS  ${result.checks.length} checks, 0 violations`);
  } else {
    for (const check of failed) {
      console.log(
        `  ${check.status}  ${check.name} — ${check.count ?? check.error ?? '?'} (${check.domain})`,
      );
    }
  }
  if (result.traceCoverage && !result.traceCoverage.error) {
    console.log(
      `  INFO  trace coverage: ${result.traceCoverage.sellableLots} sellable lot(s), ` +
        `${result.traceCoverage.incompleteLots} incomplete (reported, not backfilled)`,
    );
  }
  if (result.failures.length > 0) process.exit(1);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`Database invariant audit failed: ${redactUrl(error.message)}`);
    process.exit(1);
  });
}
