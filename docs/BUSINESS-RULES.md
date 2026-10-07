# AgriMarket V2 — Business Rules

This document describes the rules the backend actually enforces. Each rule
points at the module that owns it, and most are covered by unit tests in
`apps/api/test/business-rules/`.

---

## 1. Partner ≠ Farm

A **Partner** is a supplier organisation (cooperative/company). A **Farm** is a
production site and always belongs to exactly one partner (`Farm.partnerId`).
A partner may own many farms; a farm can never exist without a partner.

- Model: `apps/api/prisma/schema.prisma` (`Partner`, `Farm`).
- A product belongs to a partner and may additionally reference the farm it was
  grown on (`Product.partnerId` required, `Product.farmId` optional).

## 2. QC before SELLABLE

A product lot can **never** become sellable by client request.

- New lots are created as `PENDING_QC` (`LotsService.create`).
- The **only** path to `SELLABLE` is a QC inspection with `result = PASS` and
  every criterion passing (appearance, freshness, damage, and packaging when
  provided) — `QualityControlService.inspect`.
- A `PASS` with any failed criterion is rejected with `400`.
- A `FAIL` moves the lot to `REJECTED`, or `QUARANTINED` when only packaging
  failed.
- A recalled lot can no longer be inspected.
- Sellability is defined by `LotsService.isSellable`: `status = SELLABLE` **and**
  not expired.

## 3. FEFO (First-Expiry-First-Out)

Stock is allocated from the lot with the earliest `expires_at` first.

- `InventoryService.allocateFefo` selects eligible balances (SELLABLE,
  non-expired, latest QC = PASS, `available > 0`), sorts by expiry ascending,
  and takes from each until the requested quantity is met.
- It re-checks sellability/expiry/QC in code, not only in the query, so a stale
  read can never allocate a bad lot.
- If the total available is short, it throws with the exact shortfall.
- **Available = onHand − reserved − blocked** (`InventoryService.available`).

## 4. No inventory oversell

- `reserve` refuses to reserve more than `available`.
- `allocateFefo` refuses when sellable stock is insufficient.
- Checkout runs inside a transaction; a shortfall rolls the whole order back.
- `adjust` refuses any change that would push `onHand` below zero or below
  `reserved + blocked`.

## 5. Multi-partner order split

One customer order that spans several partners is split into one
**PartnerOrder** per partner.

- `OrdersService.checkout` groups lines by partner, creates a `PartnerOrder`
  per partner (`ORD-...-P01`, `-P02`, …), and computes each partner's subtotal,
  commission and payable amount independently.
- Shipments, fulfillments and settlements all hang off the partner order, not
  the order.

## 6. COD is not PAID early

- Every payment is created as `PENDING` at checkout, including COD.
- A COD payment becomes `PAID` **only** when the order is delivered — either via
  `OrdersService.updateStatus(DELIVERED)` or when the last partner order's
  shipment is marked `DELIVERED` (`ShipmentsService.updateStatus`).
- Online payments follow the same lifecycle through the payments module.

## 7. Delivery failure → quarantine

Failed deliveries never return goods straight to sellable stock.

- A shipment moves `IN_TRANSIT`/`OUT_FOR_DELIVERY` → `DELIVERY_FAILED` →
  `RETURNING` → `RETURNED`.
- On `RETURNED`, `ShipmentsService` writes a public `RETURNED` trace event
  flagging the goods for re-inspection; they are **not** added back to
  `SELLABLE`.
- The same principle applies to customer returns (rule 8).

## 8. Returns and refunds

- A return request can only be made by the buyer, only for a `DELIVERED` order,
  and never for more than the purchased quantity.
- Flow: `REQUESTED → APPROVED → RETURNING → RECEIVED → QC_PENDING → REFUNDED`
  (or `REJECTED`).
- Marking a return `REFUNDED` requires a linked `Refund`.
- Returned goods must pass QC again before they can be sellable.

## 9. Voucher ≠ ProductDiscount ≠ FlashSale

Three separate concepts with three separate behaviours:

| Concept          | Scope            | Applied               | Funding      |
| ---------------- | ---------------- | --------------------- | ------------ |
| **Voucher**      | Whole order      | Customer enters code  | Platform     |
| **ProductDiscount** | One variant   | Automatic             | Seller       |
| **FlashSale**    | One variant, time-boxed, quota-limited | Automatic | Seller |

- `PromotionsService.resolvePrice` picks the effective unit price: a flash sale
  wins over a product discount, which wins over the base price. Flash price is
  only used when it is actually lower than the base price.
- Vouchers validate: active, within period, `minOrderAmount` met, global usage
  limit, per-customer limit. The discount is capped by `maxDiscount` and by the
  subtotal.
- Flash-sale quota is consumed on order creation
  (`consumeFlashSaleQuota`), enforcing both the global `quota` and the
  `perCustomerLimit`.
- Because the voucher is **platform-funded**, it reduces `grandTotal` but does
  **not** reduce the seller's commission base (rule 10).

## 10. Commission belongs to the Partner

- Commission is computed **per partner order** on the goods value after
  product/flash-sale discounts, excluding shipping and excluding the
  platform-funded voucher.
- `CommissionService.resolveRatePercent` resolves the most specific active rule:
  `partner + category` > `partner` > `category` > platform default. No matching
  rule ⇒ 0%.
- `commission = round2(commissionBase × ratePercent / 100)`;
  `payable = round2(commissionBase − commission)`.
- The rate and amount are snapshotted onto the partner order at checkout.

## 11. Settlement math

```
payableAmount = grossAmount − refundAmount − commissionAmount + adjustmentAmount
```

- `SettlementsService.create` builds the settlement from the partner's delivered
  / in-progress partner orders within `[periodStart, periodEnd]`.
- Each `SettlementLine` records `gross − refund − commission = payable` for one
  partner order.
- A settlement starts `DRAFT` and must be `CONFIRMED` before a payout.
- Payouts can be partial but can never exceed the settlement's `payableAmount`;
  when fully paid the settlement becomes `PAID`.

## 12. Traceability reaches the origin

`TraceabilityService.trace(traceCode)` walks the full chain:

```
ProductLot → Product → Harvest → Season → Farm → Partner
```

and returns, for public consumption only:

- lot code, trace code, grade, quantity, packed/expiry dates, expiry flag;
- product name/description/category/images;
- partner name + representative;
- farm name/address/area/description;
- season crop/variety/planting & expected-harvest dates;
- public farming events;
- harvest date/quantity/grade;
- latest QC result;
- **only valid certificates** (verified, active, within validity);
- public trace events.

No ids, bank details, audit rows or non-public events are exposed.

## 13. Reviews

A review requires that the customer bought the item and that the order is
`DELIVERED`. Each order item can be reviewed at most once. New reviews start
`APPROVED` in this demo and can be `HIDDEN` by an admin.

## 14. Complaints

A complaint must reference one of the customer's own orders. It starts `OPEN`
and moves through `PROCESSING → RESOLVED` (or `REJECTED`), stamping `resolvedAt`
on resolution.

## 15. Order state machine

```
PENDING_CONFIRMATION → CONFIRMED → PREPARING → READY_TO_SHIP → SHIPPING → DELIVERED
        └──────────────┴───────────┴──────────────┴─────────────┴──→ CANCELLED
```

- `DELIVERED` and `CANCELLED` are terminal.
- Illegal jumps are rejected with `400` (`assertTransition`).
- Moving to `DELIVERED` settles COD (rule 6); moving to `CANCELLED` releases all
  inventory reservations for the order.
- Partner-order statuses are kept in sync with the order.

## 16. Shipment state machine

```
PENDING → READY → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
                       └──────→ DELIVERY_FAILED → RETURNING → RETURNED
```

Every transition writes a `ShipmentEvent`. `DELIVERED` propagates to the partner
order and, once all partner orders are delivered, to the parent order (settling
COD). `RETURNED` flags goods for quarantine (rule 7).

## 17. Audit trail

Significant actions (inventory adjustments, lot recalls, QC results, order and
shipment status changes, settlement/payout changes) are written to
`audit_logs` with actor, action, entity, before/after JSON and an optional
reason. `AuditService.record` is the single writer.
