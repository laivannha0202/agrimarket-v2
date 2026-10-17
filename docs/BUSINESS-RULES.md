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

## 4b. Warehouse lifecycle (single central warehouse)

The demo operates one central warehouse (Hưng Yên); the backend keeps the
multi-warehouse model but no fake zone-warehouses are created. Warehouse codes
are system-generated (`WH-NNNN`, next free sequence, unique under concurrency)
and immutable; there is **no** `DELETE /warehouses` endpoint — history is kept
and deactivation is used instead.

- `ACTIVE → INACTIVE` is guarded in a transaction with a `SELECT ... FOR
  UPDATE` row lock: it is refused with `409` while the warehouse holds
  on-hand / reserved / blocked stock, has a `DRAFT` document, or serves an
  open order allocation. The row lock serialises deactivation against
  inbound/reserve paths that lock the same row first.
- New stock business at an `INACTIVE` warehouse is refused with `409`:
  document creation, document completion, manual inbound and manual reserve.
  (Signed adjustments stay allowed to fix a miscount; FEFO allocation and
  sellable previews only read `ACTIVE` warehouses.)
- Reactivation (`INACTIVE → ACTIVE`) is admin-only and audited
  (`WAREHOUSE_REACTIVATE`); all transitions write `AuditLog`.

## 4c. Warehouse document lifecycle

`DRAFT → COMPLETED`, `DRAFT → CANCELLED`; `COMPLETED` and `CANCELLED` are
immutable terminal states (no edit, no reopen, no delete; corrections use a
separate adjustment document).

- `PATCH /warehouse-documents/:id` edits a `DRAFT` note/lines only: no balance
  or movement is written (stock moves at COMPLETE time). Lines are replaced
  wholesale and validated (lot/variant exist, positive quantity, no duplicate
  lot+variant); documents carrying a business `sourceType` cannot be edited by
  hand. The write is a conditional claim (`WHERE status = DRAFT`), so an edit
  racing a complete/cancel either wins first or is refused — never forks.
- `POST /warehouse-documents/:id/cancel` moves `DRAFT → CANCELLED` with no
  stock or movement effect; it is idempotent when already `CANCELLED` and
  refused for `COMPLETED`. Cancel racing complete lets exactly one branch win
  via compare-and-set.
- `POST /warehouse-documents/:id/complete` claims the document with
  compare-and-set *after* locking the warehouse row first (lock order
  warehouse → document everywhere), so concurrent completes, edits and
  cancels cannot deadlock or double-apply stock.
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

## 5b. "Mua ngay" never rewrites the cart; a cart checkout consumes what was paid

- The checkout request declares `source`: `CART` (the lines are cart lines) or
  `BUY_NOW` (a direct "Mua ngay" purchase).
- `BUY_NOW` leaves the cart **byte-for-byte** as it was: buying B neither adds B
  to the cart, nor decrements a B already there, nor deletes it. Browsing the
  catalogue can therefore never empty a cart.
- `CART` consumes **exactly the quantity that was paid for** from the matching
  cart line: `cart 3 B` + order `1 B` leaves `2 B`; only a line that reaches zero
  is deleted. A line the order did not include is never touched.
- The flag is never trusted to *unlock* a deletion. Every cart write is derived
  from the server's own cart state plus the order's own lines, so a forged `CART`
  cannot delete a line the order did not pay for and a forged `BUY_NOW` can only
  leave the cart untouched. An older client that sends explicit `items[]` without
  `source` is treated as `BUY_NOW` (the non-destructive branch); only an omitted
  `items[]`, resolved from the server's own cart, is `CART`.
- The cart mutation runs inside the checkout transaction: a checkout that fails
  (no stock, invalid voucher, price changed) leaves the cart unchanged, and the
  order is created first — the cart is never emptied for an order that does not
  exist.
- `source` is part of the idempotency hash: the same key with a different source
  is a 409 rather than a silent switch of cart rule.

## 6. COD is collected, not assumed

- Every payment is created as `PENDING` at checkout, including COD.
- A COD payment becomes `PAID` **only** when an admin confirms the collection
  through `PATCH /payments/:id/status` — the moment the courier hands the cash
  over. Delivery success is **not** proof of collection: a delivered parcel
  proves the goods arrived, not that money changed hands, so moving an order to
  `DELIVERED` leaves its COD payment `PENDING` until the receipt is confirmed.
- The transition to `PAID` requires a `transactionReference` (courier receipt /
  gateway reference) and checks the ORDER as well as the payment row
  (`PaymentsService.updateStatus`):
  - a payment of a `CANCELLED` order can never be marked `PAID` — the `FAILED`
    transition exists for that case;
  - a COD payment can only be marked `PAID` once the order is `DELIVERED`,
    because the courier collects at the doorstep; confirming cash for a parcel
    still in transit would book money that does not exist.
  - The Admin UI follows the same rule: the "Ghi nhận thu tiền" button is only
    rendered for a `PENDING` COD payment whose order is `DELIVERED`; otherwise
    the row shows "Chờ giao hàng" (or "—").
- Non-COD (online) payments follow the same lifecycle through the payments
  module without the `DELIVERED` requirement: the gateway reference is the
  receipt, not the courier.
- Confirming `PAID` is a **compare-and-set** on the status that was read
  (`updateMany where status = <read status>`). Two operators, a double-tap or a
  retried request running at the same time cannot both succeed: exactly one
  claims the row, and the loser gets a **409** instead of re-stamping `paidAt`
  and writing a second audit row for money that was collected once.
- Re-applying the current status (`PAID` → `PAID`) is an idempotent no-op that
  writes no audit row; a terminal payment (`REFUNDED`) is never moved backwards.

## 6b. Delivery consumes the reservation

When an order reaches `DELIVERED`, its goods physically leave the warehouse, so
`OrdersService.applyStatusChange` / `ShipmentsService.updateStatus` consume the
order's reservations: `on_hand` and `reserved` both drop in one conditional
UPDATE per allocation (`InventoryService.consumeStock`), an `OUTBOUND` movement
is written (`referenceType: "Order"`), and the lot's `remaining_quantity` is
decremented. A delivered order therefore frees no stock back for sale and holds
no phantom reservation; the guard refuses (409) when a balance no longer holds
the reservation instead of fabricating a shipment.

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

- `SettlementsService.create` builds the settlement from the partner's
  **DELIVERED** partner orders within `[periodStart, periodEnd]`. Orders still in
  transit (`READY_TO_SHIP`, `SHIPPING`) are excluded — their money is not payable
  yet — and an order already claimed by any settlement (DRAFT included) is
  excluded too, so the same order can never be paid twice across periods.
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
- Moving to `DELIVERED` consumes the order's stock reservations (rule 6b); it
  does **not** settle COD (rule 6 — collection is confirmed explicitly). Moving
  to `CANCELLED` releases all inventory reservations for the order.
- Partner-order statuses are kept in sync with the order.

## 16. Shipment state machine

```
PENDING → READY → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
                       └──────→ DELIVERY_FAILED → RETURNING → RETURNED
```

Every transition writes a `ShipmentEvent`. `DELIVERED` propagates to the partner
order and, once all partner orders are delivered, to the parent order (consuming
its stock reservations; COD is settled only by an explicit collection
confirmation — rule 6). `RETURNED` flags goods for quarantine (rule 7).

## 17. Audit trail

Significant actions (inventory adjustments, lot recalls, QC results, order and
shipment status changes, settlement/payout changes) are written to
`audit_logs` with actor, action, entity, before/after JSON and an optional
reason. `AuditService.record` is the single writer.

## 18. Delivery address follows the 2025 administrative reorganisation

The 2025 reorganisation merged the province level and **abolished the district
(huyện) level**, so an address is now two levels: **tỉnh → xã/phường**. Hưng Yên
has exactly **104** commune-level units (93 xã + 11 phường).

- **The API is the single source of truth for the catalogue.** Clients fetch it
  from `GET /locations/provinces/:code/wards`; no frontend ships its own copy of
  the 104-unit list, because three copies would drift.
- **Codes are strings.** A commune code is 5 characters (`"11953"`), never a
  number, so a leading zero can never be lost.
- **The server resolves the name.** The client sends `provinceCode` + `wardCode`;
  `wardName` is taken from the catalogue and the client's own spelling is
  discarded. A client cannot store a commune name that does not match its code.
- **Validation is server-side.** An unknown code, or one belonging to a different
  province, is refused with `400`. A `wardCode` without a `provinceCode` is also
  refused — it cannot be checked against the right province otherwise.
- **A bad address is refused before anything is claimed.** Checkout validates and
  snapshots the address *before* the transaction opens, so an invalid commune
  never consumes a voucher, an order code or stock.
- **Legacy addresses are preserved, not migrated by guesswork.** Pre-reorganisation
  addresses keep their free-text `province` / `district` / `ward` exactly as
  saved, and remain usable. Editing one to a catalogue commune drops `district`,
  because that level no longer exists.
- **No invented data.** Thôn / tổ dân phố stays free text (`village`): no verified
  list was delivered, so none was fabricated. Likewise no GPS coordinates and no
  postal codes.

## 19. Customer accounts and password recovery

One account system serves both Customer Web and Mobile; `users` is the single
table, with `role` distinguishing `ADMIN` from `CUSTOMER`.

- **Self-registration cannot escalate privileges.** `POST /auth/register` always
  creates an `ACTIVE` `CUSTOMER`. The DTO has no `role` field and the global
  `ValidationPipe` rejects unknown properties, so `role: "ADMIN"` is a `400`, not
  a silent upgrade. Registration does **not** issue a session — the customer signs
  in through `/login`, one flow for both clients.
- **Changing a password ends the other sessions.** `users.password_changed_at`
  backs a password-version claim in the JWT, so every token issued before the
  change is rejected. The device that made the change receives a fresh token and
  stays signed in.
- **Recovery is a real token flow, and does not reveal accounts.**
  `POST /forgot-password` answers **identically** whether or not the address is
  registered, so it cannot be used to enumerate customers. When a link is issued,
  only the SHA-256 **hash** is stored; the raw token exists only in the e-mail.
  Tokens last 1 hour, are single-use, and a new request supersedes the old one.
  Every failure mode returns one generic error.
- **Mail delivery is reported honestly.** The response carries
  `delivery: { mode, delivered }`. `mode: "test"` means the message was captured
  in memory and **nothing was sent** — a test transport is never presented as a
  delivered e-mail.
