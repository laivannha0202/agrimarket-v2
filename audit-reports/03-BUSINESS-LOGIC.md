# 03 — BUSINESS-LOGIC & MONEY AUDIT

> Repo `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` · branch `main` ·
> commit `90c28de` · 2026-10-18 · read-only. Cross-refs: CON-xx (report 05), PRD-xx (report 07).

## Summary

The checkout→order→shipment→payment core is strong (see §Verified rules). The weaknesses are
concentrated in **after-sales money paths** (refunds, partner settlements, payouts) and in
**admin stock quick-endpoints**, where read-then-write patterns replace the CAS/atomic patterns the
core uses. Six findings are P1/P2; none is P0.

| ID | Sev | Class | Finding |
|---|---|---|---|
| BL-01 | **P1** | VERIFIED BUG | Refund endpoint: TOCTOU → concurrent refunds can exceed the paid amount; payment status can regress |
| BL-02 | **P1** | VERIFIED BUG | Return-request quantity check is race-prone (no lock) → over-claim beyond delivered quantity |
| BL-03 | P2 | BUSINESS LOGIC ISSUE | `returns.updateStatus` has no state machine and no CAS (any→any) |
| BL-04 | P2 | BUSINESS LOGIC ISSUE | `complaints.update` has no state machine and no CAS (any→any) |
| BL-05 | P2 | BUSINESS LOGIC ISSUE | Settlement `refundAmount` is hardcoded 0 — documented netting formula never applied |
| BL-06 | P2 | VERIFIED BUG | `payouts.create` checks the paid-sum outside the insert → concurrent payouts can exceed payable |
| BL-07 | P2 | VERIFIED BUG | `POST /inventory/inbound` and `/adjust` are read-then-absolute-write (lost updates; no idempotency) |
| BL-08 | P3 | VERIFIED BUG | Voucher redemption & `used_count` are not restored when an order is cancelled |
| BL-09 | P3 | VERIFIED BUG | Cart `addItem`: lost update on concurrent adds; no ACTIVE check; no quantity ceiling |
| BL-10 | P3 | BUSINESS LOGIC ISSUE | Reviews auto-APPROVED at creation → moderation queue is decorative |
| BL-11 | P3 | IMPROVEMENT | No logout/revocation endpoint; 7-day tokens (see SEC-05) |
| BL-12 | P2 | BUSINESS LOGIC ISSUE | Return acceptance moves no stock; quarantine/restock depends on manual warehouse documents |
| BL-13 | P3 | BUSINESS LOGIC ISSUE | Complaints can be filed on CANCELLED orders (no status gate) |
| BL-14 | P2 | CAPABILITY GAP | COD-only: no online payment initiation or gateway webhook despite VNPAY/MOCK_ONLINE enums |
| BL-15 | P3 | VERIFIED BUG | QC `inspect` has no lot-level guard → concurrent PASS/FAIL both apply, last write wins |
| BL-16 | P3 | VERIFIED BUG | `addAddress(isDefault)` is not transactional → two concurrent creates can both end default |
| BL-17 | P3 | OPERATIONAL | Demo seed (`prisma/seed.ts`) ships credentials + demo orders; must never run against production |

---

## BL-01 — Refund TOCTOU / double refund (P1, VERIFIED BUG)

- **Module**: `apps/api/src/payments/payments.service.ts:165-220` · **Admin-only** (`POST /payments/refunds`)
- **Cause**: the "already refunded" aggregate runs *outside* the transaction (lines 174-187) and
  the insert (190-198) + payment update (200-206) run *unconditionally inside* it. Two concurrent
  requests both read `already = 0` and both insert; the payment's `status` is rewritten from a
  stale total, and can even **regress** from `REFUNDED` back to `PARTIALLY_REFUNDED`.
- **Evidence**: no conditional UPDATE on `payments.status` in `refund()` (contrast with
  `updateStatus()` CAS at `:135-143`); no concurrency test exists for refunds (report 06).
- **Repro**: two simultaneous `POST /api/v1/payments/refunds {paymentId, amount = paid/2 …}` on one
  PAID payment. Expected: one succeeds and the second is refused (or serialized to the exact
  remaining amount). Actual (by code): both insert COMPLETED refunds; sum can exceed the paid
  amount; payment row ends in a stale-derived status.
- **Impact**: real money over-refund; settlement reports then disagree with payment rows.
- **Fix**: do everything inside one transaction: `SELECT … FOR UPDATE` on the payment row (or a
  CAS guard `updateMany where status in (PAID, PARTIALLY_REFUNDED)`), re-aggregate refunds under
  the lock, insert, compute status from the *locked* values. Add an e2e scenario (two concurrent
  refunds → exactly one wins / exact remaining amount).
- **Confidence**: high.

## BL-02 — Return-request over-claim race (P1, VERIFIED BUG)

- **Module**: `apps/api/src/returns/returns.service.ts:63-117` · **Customer + Admin read**
- **Cause**: the returnable check reads active return requests and re-computes the remainder
  (lines 89-94) inside a transaction, but **without any row lock** and with no unique constraint
  enforcing the sum. Under REPEATABLE READ, two concurrent requests on the same order item both
  see the pre-insert snapshot and both insert — each passing its own check. The code comment
  (lines 77-87) claims "two simultaneous requests cannot both see the old sum" — that claim is
  **false** without `FOR UPDATE` (or an equivalent serialisation).
- **Repro**: two concurrent `POST /returns` for the same `orderItemId` with `quantity = full`.
  Expected: total claimed ≤ delivered quantity. Actual (by code): both accepted → claimed 2×.
- **Impact**: customers are promised more refund/replacement quantity than they ever received
  (money leak and support debt); the eligibility list self-corrects only for *future* requests.
- **Fix**: `SELECT id FROM order_items WHERE id = ? FOR UPDATE` (or lock the return rows via a
  deterministic advisory approach / maintenance of a `claimed_quantity` column with a conditional
  UPDATE guard). Add e2e: two concurrent returns → one rejected.
- **Confidence**: high.

## BL-03 / BL-04 — No state machines on return and complaint status updates (P2, BUSINESS LOGIC ISSUE)

- **Evidence**: `returns.service.ts:272-290` — the only guard is "REFUNDED requires refundId";
  the write is a plain `update()`; any status can move to any status (REJECTED→COMPLETED,
  REFUNDED→REQUESTED, …) and concurrent updates are last-write-wins with two audit rows whose
  `beforeJson` disagrees with reality. `complaints.service.ts:153-158` — same pattern.
- **Expected**: the documented flows (requested → approved/rejected → received → refunded;
  open → processing → resolved/rejected) with CAS (`UPDATE … WHERE status = <read>`), the same
  pattern used for orders/payments/warehouse docs.
- **Impact**: operators can revive closed requests; reports/UI disagree with audit trail;
  no defence against double-submits.
- **Fix**: add transition maps + `updateMany` CAS; 409 on conflict; unit tests per illegal
  transition. **Confidence**: high.

## BL-05 — Settlement refunds always 0 (P2, BUSINESS LOGIC ISSUE)

- **Evidence**: `settlements.service.ts` header states the payable formula
  `gross − refund − commission + adjustment` (line 22), but `refundTotal` is initialised to 0
  and never accumulated (lines 74-89), and the header is written with `refundAmount: 0` (line 85)
  / `refundAmount: round2(refundTotal)` = 0 (line 109). No query reads `refund` rows here.
- **Impact**: a partner settlement created *after* a customer refund still pays the partner the
  full `gross − commission`; the `refund_amount` column is always 0, so every settlement report
  understates refunds and overstates payables. If the intended policy is "AgriMarket absorbs
  refunds", the column/formula should be removed and documented; the current state is
  contradictory.
- **Fix (policy decision needed)**: if partners bear refunds, join refunds per partner order
  (only COMPLETED refunds, capped at line amount) and subtract; else drop the column/formula and
  document. Tests: settlement with a refunded line. **Confidence**: high.

## BL-06 — Payout over-payment race (P2, VERIFIED BUG)

- **Evidence**: `settlements.service.ts:202-254` — `alreadyPaid` aggregate (211-215) and the
  `paidSoFar + amount > payable` check (221-225) run before `createWithRetry` inserts the payout
  (227-254); the retry only handles code collisions, not the sum. Two concurrent payout creations
  both pass → payouts exceed the settlement payable amount.
- **Fix**: re-check the sum inside a transaction holding a row lock on the settlement
  (`SELECT … FOR UPDATE`) or add a materialised `paidAmount` column with a conditional UPDATE.
  **Confidence**: high.

## BL-07 — Admin inbound/adjust are read-then-write (P2, VERIFIED BUG)

- **Evidence**: `inventory.service.ts:154-182` (`inbound`: `before = balance.onHand`,
  `after = before + qty`, absolute `update`) and `:184-235` (`adjust`: validates against the
  stale `reserved`/`blocked` read, then absolute `update`). `getOrCreateBalance` (`:620-637`) does
  a plain `findUnique` — **no lock**. The atomic helpers exist (`changeOnHand` `:456-471`,
  conditional UPDATE) and are used by warehouse documents — but not by these two endpoints.
- **Repro**: (a) double-click/retry the same inbound → duplicate stock (no idempotency key);
  (b) two concurrent inbounds → one increment is lost; (c) adjust racing a checkout reservation →
  validation compares against values that no longer hold.
- **Impact**: silent stock corruption via the admin *quick* endpoint that operators actually use
  (`admin-web inventory/page.tsx:51-53`). Stock errors propagate to oversell/undersell decisions.
- **Fix**: route both through `changeOnHand` (+ locked read for the reserved/blocked rule) and add
  an `Idempotency-Key` (or require warehouse documents). Concurrency e2e for both. **Confidence**: high.

## BL-08 — Voucher state is not restored on cancel (P3, VERIFIED BUG)

- **Evidence**: checkout writes `voucherRedemption` and atomically claims the voucher
  (`orders.service.ts:628` and promotions upsert); the cancel path
  (`orders.service.ts:1069-1081,1118-1172`) releases/quarantines **stock only** — grep over
  `orders.service.ts` shows no redemption deletion and no `usedCount` decrement. (Flash-sale quota
  restitution is explicitly documented as intentional — not restituted; the voucher case has no
  such justification.)
- **Impact**: vouchers burned by cancelled orders stay consumed; a customer who cancels cannot
  reuse a one-per-customer voucher; counters drift from reality and reports understate available
  promotions.
- **Fix**: on cancel (only while goods are still in the warehouse, i.e. the RELEASE path, not the
  SHIPPING quarantine path — or per business policy), delete the redemption and decrement
  `usedCount` in the same transaction; unit/e2e tests for cancel-then-reuse. **Confidence**: high
  for the code state; product policy to confirm.

## BL-09 — Cart add: lost update, no ACTIVE check, no ceiling (P3, VERIFIED BUG)

- **Evidence**: `carts.service.ts:22-45` — `findUnique` → `update(quantity = existing + dto)` is
  a read-then-write (concurrent adds lose one increment); the variant read (`:24-27`) does not
  check `status`/product status, so locked products can be added; no per-item maximum qty exists
  (only the checkout preview caps at available stock).
- **Impact**: minor UX/consistency; checkout still re-validates, so no oversell.
- **Fix**: `upsert` with atomic increment (`quantity: { increment: qty }`), validate
  `variant.status === ACTIVE` and product ACTIVE, clamp at a documented max. **Confidence**: high.

## BL-10 — Reviews auto-approved at creation (P3, BUSINESS LOGIC ISSUE)

- **Evidence**: `reviews.service.ts:120` writes `status: ReviewStatus.APPROVED` while the schema
  and admin UI carry PENDING/HIDDEN/REJECTED and the admin page exposes approve/hide/reject
  (`admin-web reviews/page.tsx:40-45`); public listing filters APPROVED only (`:130`).
- **Impact**: the moderation workflow advertised in the admin UI never triggers; all reviews are
  public immediately. Documented in code as demo behaviour, but it contradicts the admin UI's
  semantics.
- **Fix**: create as PENDING (or keep auto-approve but remove the admin moderation claim), add a
  policy switch; tests for both. **Confidence**: high.

## BL-11 — No logout endpoint (P3, IMPROVEMENT)

- **Evidence**: `auth.controller.ts` exposes login/register/forgot/reset/change-password/me; no
  `POST /auth/logout`. Clients clear localStorage (mobile subagent reports the same). Sessions end
  only by expiry or password change (`passwordVersion`).
- **Impact**: tokens cannot be revoked server-side; a stolen 7-day token outlives "logout".
- **Fix**: optional token denylist or shorter expiry + refresh; at minimum document the model.
  **Confidence**: high.

## BL-12 — Returns move no stock (P2, BUSINESS LOGIC ISSUE)

- **Evidence**: `returns.service.ts` has no `InventoryService` dependency (constructor
  `:57-61`); status transitions never touch balances. The only automatic stock-adjacent effect of
  a failed delivery is a public trace event on shipment `RETURNED`
  (`shipments.service.ts:208-224`). Returned goods re-enter stock only manually via a
  `RETURN`-type warehouse document (`warehouse-documents.service.ts:403-426`).
- **Impact**: the "quarantine on goods-left-warehouse cancel" design (order/service comments)
  promises "the units then wait for the return / re-inspection flow" — but that flow is manual and
  easy to forget. Blocked stock can sit forever; or an operator restocks without QC.
- **Fix**: make return acceptance create a DRAFT warehouse document (RETURN) automatically; QC
  PASS → SELLABLE, FAIL → REJECTED; add an ops report for aged blocked stock. **Confidence**: high.

## BL-13 — Complaints allowed on any owned order (P3, BUSINESS LOGIC ISSUE)

- **Evidence**: `complaints.service.ts:16-41` verifies ownership and line membership, but no order
  status gate — a CANCELLED order can be complained about (customer-web QA file also flags this).
- **Fix**: restrict to DELIVERED (or DELIVERED+COMPLETED) orders, or document the policy.
  **Confidence**: high.

## BL-14 — No online payments (P2, CAPABILITY GAP)

- **Evidence**: `PaymentMethod` enum includes `VNPAY`/`MOCK_ONLINE` in API + both web clients, but
  there is no payment-initiation endpoint, no gateway integration, no webhook; checkout is COD-only
  (`customer-web CheckoutView.tsx:19-21,837-843`; `packages/shared-domain/src/checkout.ts:326`).
  Admin can only confirm collection manually with a reference (`payments.service.ts:103-121`).
- **Impact**: fine for a pilot; a real produce marketplace will need prepaid options (transfer,
  VNPAY/MoMo/ZaloPay). Until then, `MOCK_ONLINE` in the type surface is dead weight that suggests
  a capability that does not exist.
- **Fix**: either implement one gateway end-to-end (initiation URL + signed webhook with
  idempotent PAID confirmation reusing the existing CAS) or delete the unused enum values from
  the clients to avoid confusion. Roadmap item; see PRD-01.

## BL-15 — QC inspect race (P3, VERIFIED BUG)

- **Evidence**: `quality-control.service.ts:25-99` — lot read (with RECALLED check) at `:26-30`
  *outside* the transaction; inside the tx, a plain `qcInspection.create` + unconditional
  `productLot.update(status)` at `:69-72` — no guard on current lot status. Two concurrent
  inspections (PASS + FAIL, or a double-click) both succeed; the lot ends in whichever status
  commits last, with two contradictory public trace events and audits.
- **Fix**: CAS on the lot (`updateMany where status in (PENDING_QC, SELLABLE…)`) or lock the lot
  row; reject re-inspection unless documented. **Confidence**: high.

## BL-16 — Default-address race (P3, VERIFIED BUG)

- **Evidence**: `users.service.ts:124-146` (addAddress) performs `updateMany(isDefault=false)` and
  the `create` **outside one transaction**; `setDefault` (`:280-294`) and `updateAddress`
  (`:160-168`) are transactional and safe. Two concurrent addAddress(isDefault=true) can both
  reset then both create → two defaults. `listAddresses` orders by `isDefault desc, id desc`
  (`:333`) so the symptom is a flapping default.
- **Fix**: wrap in `$transaction`; optionally a partial unique index is not available in MariaDB —
  settle with ordering. **Confidence**: high.

## BL-17 — Demo seed with credentials (P3, OPERATIONAL)

- **Evidence**: `apps/api/prisma/seed.ts` wipes and re-seeds demo users ("admin@agrimarket.vn",
  "lan.nguyen@agrimarket.vn" — passwords printed by the seed and documented in docs), demo orders,
  vouchers, flash sales, certificates. The acceptance docs depend on this seed.
- **Impact**: running `db:seed` against production creates admin accounts with publicly known
  passwords and fake business data.
- **Fix**: gate the seed behind `NODE_ENV !== 'production'` (or an explicit `ALLOW_SEED=1`),
  and remove credential printing in non-dev runs. **Confidence**: high.

## Verified-correct business rules (spot-verified with evidence)

| Rule | Evidence |
|---|---|
| Totals computed server-side at checkout; client preview can only *display*; `expectedGrandTotal` mismatch → 409 re-confirm | checkout flow read in earlier pass (`orders.service.ts` preview/checkout); web `lib/checkout.ts:97-113` |
| Idempotency: same key+payload replays; different payload with same key → conflict; source (CART/BUY_NOW) included in hash | `orders.service.ts:1222-1236`, e2e `checkout-hardening`/`mutation-acceptance` |
| COD confirmed only after DELIVERED, with reference, CAS-guarded | `payments.service.ts:103-144` |
| FEFO reservation: reserve→allocation order, no lock upgrade deadlock | `inventory.service.ts:237-304` + comments |
| Delivery consumes stock (on_hand−, reserved−, OUTBOUND, lot remaining decrement), CAS-guarded | `inventory.service.ts:399-444` |
| Cancel from SHIPPING quarantines (reserved→blocked), never re-sells | `orders.service.ts:1069-1081`, `inventory.service.ts:327-349` |
| Voucher claimed atomically per customer; flash quota atomic per customer | `promotions.service.ts` (earlier pass), e2e concurrency spec |
| Commission rules versioned by window; settlement excludes already-claimed orders | `settlements.service.ts:58-71`, `commission.service.ts` |
| Reports: paid/collected bases, cancelled excluded, refund totals surfaced in summary | `reports.service.ts` (earlier pass), export builders |
| Reviews require a DELIVERED line, one per line | `reviews.service.ts:96,210` (eligibility) |
