# AgriMarket V2 — Final Concurrency & Business-Integrity Audit

Scope: race conditions in checkout / reservation, flash-sale quota, voucher limits,
concurrent order-code creation, cancel-vs-checkout, preview-vs-total consistency.
Everything was reproduced against a **real MySQL 8.4.11** (`TEST_DATABASE_URL`),
fixed with transactions + atomic conditional updates, and re-verified directly in
the database. The only client change is a small `expectedGrandTotal` echo in the
customer web checkout (to surface the price-change 409); no new features, no
dev-DB reset, no commit/push.

Environment: MySQL 8.4.11 (default `REPEATABLE READ`, strict `only_full_group_by`),
Prisma 7.10.0 with `@prisma/adapter-mariadb`, Prisma interactive-transaction
timeout 5000 ms / maxWait 2000 ms.

---

## 1. Reproducible bugs (proven before the fix)

| # | Bug | Reproduction | Pre-fix result |
|---|-----|--------------|----------------|
| B1 | **Flash-sale oversell** — `sold_quantity` check + increment was a read-then-write | 2 concurrent claims, `quota=1` | `accepted=2`, `sold_quantity=2` on a quota of 1 — **10/10 rounds** |
| B2 | **Flash per-customer limit bypassed** — counted the customer's purchases with `already + quantity > limit` | 2 concurrent orders, same customer, `perCustomerLimit=1` | both accepted — **10/10 rounds**; the same formula also wrongly rejected a legitimate purchase that landed exactly on the limit |
| B3 | **Voucher over-redemption** — `used_count` incremented after a read-only check | 2 concurrent checkouts, `usageLimit=1` | `used_count=2`, both accepted — **10/10 rounds** |
| B4 | **Reserved lost update** — `newReserved = reserved + qty` from a value read earlier | 2 concurrent reservations on one balance | one reservation lost — **10/10 rounds** |
| B5 | **Double cancel double-release** — status read outside the transaction, then unconditional update | 2 concurrent cancels of one order | both succeeded, `reserved` dropped twice, **2 RELEASE movements** — **10/10 rounds** |
| B6 | **Warehouse document double-complete** — status checked outside the transaction | 2 concurrent completes of one INBOUND doc | `on_hand` applied twice — **10/10 rounds** |
| B7 | **Duplicate order codes + deadlock/timeout storm** — `MAX(code)+1` computed by every concurrent checkout | 12 concurrent checkouts | 1–2/8 committed; P2002/1062 duplicates, P2034 (1213) deadlocks, P2028 timeouts |
| B8 | **Nested-connection pool exhaustion (root cause of B7's timeouts)** — `CommissionService.resolveRatePercent` and `AuditService.record` accepted a `tx` but read/wrote through the **outer** Prisma client | 12 concurrent checkouts | **0/12 succeeded, 5060 ms, all P2028** — each checkout held 1 connection and demanded a 2nd |

Not reproducible (verified safe): **cancel-vs-deliver** — 0/10 violations (the
`assertTransition` state machine already refused the illegal transition).

---

## 2. Fixes (SQL / transaction strategy)

### 2.1 Atomic conditional updates — the check and the write are one statement
- **Reserve** (`InventoryService.reserveStock`):
  `UPDATE inventory_balances SET reserved = reserved + ? WHERE id = ? AND on_hand - reserved - blocked >= ?`.
  MySQL re-evaluates the predicate under the row's exclusive lock, so two
  checkouts can never both pass. Reserve happens **before** inserting the
  `inventory_allocations` row (avoids the shared→exclusive FK lock upgrade that
  caused the 1213 deadlocks).
- **Release** (`releaseStock`): `reserved = GREATEST(reserved - ?, 0)` — computed
  on the current column value, so a concurrent reservation is never dropped.
- **On-hand** (`changeOnHand`): `on_hand = on_hand + ? WHERE on_hand + ? >= 0`.
- **Flash quota** (`PromotionsService.consumeFlashSaleQuota`):
  `UPDATE flash_sale_items SET sold_quantity = sold_quantity + ? WHERE id = ? AND sold_quantity + ? <= quota`.
- **Voucher usage** (`consumeVoucher`):
  `UPDATE vouchers SET used_count = used_count + 1 WHERE id = ? AND (usage_limit IS NULL OR used_count + 1 <= usage_limit)`.
  A 0-row result rolls back the caller's transaction, so a rejected checkout
  leaves `used_count` untouched.

### 2.2 Per-customer limits counted *after* the lock, under READ COMMITTED
The checkout transaction runs with `{ isolationLevel: 'ReadCommitted' }`. The
conditional UPDATE serialises racing checkouts on the quota/voucher row; the
`COUNT`/`aggregate` that follows then observes every redemption committed before
the lock was granted. Under the default REPEATABLE READ the transaction keeps
its original snapshot and would count 0 forever (this is exactly what let one
customer buy twice). Verified against the mariadb adapter: READ COMMITTED sees a
concurrent commit — YES; REPEATABLE READ / default — NO.

### 2.3 Order codes from an atomic counter (`code_sequences`)
`nextOrderCode` claims a daily counter with one statement:
`INSERT INTO code_sequences (name, value, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value = GREATEST(value, ?) + 1`.
Prisma's `upsert` compiles to SELECT-then-INSERT (5/20 concurrent claimers
collided), so raw SQL is required. The claim is the transaction's **first write**
(counter lock before balance locks → one global lock order). `floor` = highest
visible sequence is folded in with `GREATEST` as a safety net; the P2002 retry
stays as the last guard. The counter lives **inside** the checkout transaction so
a rolled-back checkout does not burn a number and the claim commits atomically
with the order.

### 2.4 State machine as compare-and-set
`applyStatusChange` claims the row with
`UPDATE orders SET status = ? WHERE id = ? AND status = ?`; a 0-row result → 409.
This makes double-cancel and cancel-vs-deliver safe: the loser's predicate no
longer matches. `WarehouseDocumentsService.complete` does the same for
`DRAFT → COMPLETED` before touching stock.

### 2.5 Transaction-scoped writes (root-cause fix)
`CommissionService.resolveRatePercent(..., tx?)` and `AuditService.record(input, tx?)`
now use the caller's `tx`. All in-transaction call sites pass it. Measured after
the fix: 12 concurrent checkouts **12/12 in 269 ms** (was 0/12 in 5060 ms).

### 2.6 Hardening added after the first audit pass
- **Flash per-customer scoping.** `consumeFlashSaleQuota` now aggregates only the
  purchases that belong to **that** flash sale: it reads the sale window
  (`flashSale.startsAt/endsAt`) and counts `order_items` with
  `unit_price_snapshot = item.flashPrice` **and** `order.created_at` inside the
  window. A normal-price purchase of the same variant no longer consumes the
  flash limit.
- **SHIPPING cancel quarantines stock.** `releaseOrderReservations(tx, orderId, quarantine)`
  is called with `quarantine = true` when `previousStatus === 'SHIPPING'`; the
  units move `reserved → blocked` (`InventoryService.quarantineStock`, atomic
  `reserved = GREATEST(reserved - ?, 0), blocked = blocked + ?`) and an
  `inventory_movements` row of type `QUARANTINE` is written. `available =
  on_hand - reserved - blocked` is unchanged, so goods that already left the
  warehouse are never offered for resale. Cancels from PENDING still release.
- **Preview/confirm price-change guard.** `checkout.dto` gains an optional
  `expectedGrandTotal`; when present, `createOrder` recomputes the total inside
  the transaction and throws `409 Conflict` if it differs, rolling back the
  voucher claim and reservation. The value is part of the idempotency hash. The
  customer web client echoes the previewed total and re-fetches the preview on
  409.

### 2.7 Migrations
- `20261008000000_code_sequences` creates `code_sequences` and seeds it from
  existing order codes. Fixed a `only_full_group_by` failure (error 1055) by
  grouping on the full `CONCAT(...)` expression.
- `20261009000000_inventory_quarantine_movement` extends the
  `inventory_movements.type` enum with `QUARANTINE` (used when a SHIPPING order is
  cancelled — the reserved units move to `blocked`, never back to sellable).

Both are **additive** (one new table + seed, one enum extension) — no reset, no
data deletion. Applied to **TEST and DEV** with `prisma migrate deploy`; both now
report *"Database schema is up to date!"* (4 migrations).

---

## 3. Concurrency verification — rounds and PASS counts

The concurrency scenarios were originally explored in throwaway `scratch-*.mts`
harnesses (since removed). They have been **promoted into the official suite** —
`test/concurrency.e2e-spec.ts` (fixtures in `test/helpers/concurrency-fixtures.ts`) —
so the guarantees are now enforced by `npm run test:e2e`, not by a manual script.
The suite drives the **real** service methods against real MySQL and asserts
directly in the DB (order rows, allocation rows, `on_hand`, `reserved`,
`blocked`, voucher redemptions, flash `sold_quantity`, payments). Rounds default
to **5** and are raised with `CONCURRENCY_ROUNDS`; every row it creates is tagged
with a `cc…` run prefix and removed in `afterAll`, so the demo seed and DEV are
never touched. It is skipped when `TEST_DATABASE_URL` is unset.

### 3.1 `test/concurrency.e2e-spec.ts` — 15 scenarios

| # | Scenario | Result |
|---|---|---|
| 1 | 10 buyers / 1 unit (exactly 1 wins, `reserved==allocs==1`) | **PASS** |
| 2 | 10 buyers / 5 units (exactly 5 win, no oversell) | **PASS** |
| 3 | flash quota=1, 2 concurrent (exactly 1 sold) | **PASS** |
| 4 | flash `perCustomerLimit=1`, 2 concurrent (only 1 accepted) | **PASS** |
| 5 | flash `perCustomerLimit=2` sequential (2 ok, 3rd rejected) | **PASS** |
| 6 | voucher `usageLimit=1`, 2 concurrent (1 accepted, `usedCount=1`) | **PASS** |
| 7 | voucher claim rolls back when checkout fails | **PASS** |
| 8 | double cancel (1 accepted, released once, others intact) | **PASS** |
| 9 | cancel vs deliver (exactly one wins, state consistent) | **PASS** |
| 10 | cancel SHIPPING order → stock quarantined (`reserved→blocked`), never re-sold | **PASS** |
| 11 | double complete INBOUND doc (`on_hand` applied once) | **PASS** |
| 12 | 12 concurrent checkouts → 12 distinct order codes | **PASS** |
| 13 | preview totals == checkout totals | **PASS** |
| 14 | 3 concurrent retries, same idempotency key → 1 order, 1 reservation | **PASS** |
| 15 | stale `expectedGrandTotal` → 409, no order, no reservation | **PASS** |

**Total failures: 0.** (15 tests, 3 files, 187 assertions-run green in the full
`npm run test:e2e` run; scenario rows 10 and 15 are the two hardening cases added
after the initial audit.)

### 3.3 Oversell / over-quota proof (direct DB)
- Flash `quota=1`, 2 concurrent → `sold_quantity=1`, exactly 1 order.
- Flash `perCustomerLimit=1`, 2 concurrent → 1 order, 1 unit.
- Voucher `usageLimit=1`, 2 concurrent → `used_count=1`, 1 redemption row.
- 10 buyers / 1 unit → `reserved=1`, `allocSum=1`, `on_hand=1`; 1 order.
- 12 concurrent checkouts → 12 orders with 12 distinct codes; 0 duplicates.
- Double complete INBOUND → `on_hand` incremented once.

---

## 4. Regression suite

| Check | Command | Result |
|---|---|---|
| API unit | `npm run test` | **178 passed / 178** (14 files), 0 failed |
| API E2E | `npm run test:e2e` | **187 passed / 187** (3 files), **skipped = 0** |
| API lint | `oxlint --type-aware src/ test/ prisma/` | exit 0 |
| API typecheck | `tsc --noEmit -p tsconfig.json` | `src/` + `test/` = **0 errors** |
| Admin lint | `npm run lint --workspace @agrimarket/admin-web` | clean |
| Admin typecheck | `npm run typecheck --workspace @agrimarket/admin-web` | clean |
| Admin build | `npm run build --workspace @agrimarket/admin-web` | success |
| Customer lint | `npm run lint --workspace @agrimarket/customer-web` | clean |
| Customer typecheck | `npm run typecheck --workspace @agrimarket/customer-web` | clean |
| Customer build | `npm run build --workspace @agrimarket/customer-web` | success |

> All throwaway `scratch-*.mts` / `probe-*.mts` audit artifacts were removed once
> their scenarios were promoted into `test/concurrency.e2e-spec.ts`; the tree now
> has **0** of them, so `tsc` reports 0 errors across `src/` and `test/`.

### Tests updated (legitimately, not to force a pass)
- `test/helpers/prisma-mock.ts`: default `$executeRaw → 1`, `$queryRaw → [{value:1}]`,
  `$transaction(fn, opts)`; defaults re-applied by `resetMockPrisma`.
- `promotions.spec.ts`: rewrote flash tests to the corrected semantics and added a
  **regression guard** that a purchase landing exactly on the limit is accepted
  (the old assertion encoded the double-counting bug and asserted
  `flashSaleItem.update({ soldQuantity: 8 })`, which no longer exists).
- `inventory.spec.ts`: reserve/release now assert the atomic conditional UPDATE
  and the 0-row "claim lost" path.
- `checkout-hardening.spec.ts`: cancel asserts the compare-and-set + a 409 on the
  lost race.
- **New** `audit.spec.ts`: audit writes through `tx`, never the outer client.
- **New** `commission.spec.ts` case: rate lookup goes through `tx`.
- **New** `code-generation.spec.ts` cases: `claimSequence` is one statement, reads
  bigint, throws when the row cannot be read back.
- **New** `test/concurrency.e2e-spec.ts` + `test/helpers/concurrency-fixtures.ts`:
  the 15 promoted concurrency scenarios, run through the real services against
  `TEST_DATABASE_URL`.

---

## 5. Git status (no commit, no push)

Branch `main`; existing commits `4b14267`, `5aa5199`, `a125d6e` unchanged;
`main` is level with `origin/main` (no commit/push made in this work).

- Modified (tracked): 89 files, incl. the audit-fix sources
  `orders.service.ts`, `promotions.service.ts`, `inventory.service.ts`,
  `warehouse-documents.service.ts`, `audit.service.ts`, `commission.service.ts`,
  `payments.service.ts`, `quality-control.service.ts`, `shipments.service.ts`,
  `common/utils/code.util.ts`, `prisma/schema.prisma`, and the updated specs.
- Deleted (tracked): 1 (`apps/admin-web/src/hooks/useClientList.ts`, pre-existing V2 change).
- Untracked (not committed): 17 entries, incl. the audit deliverables
  `src/common/utils/code-sequence.ts`, `src/orders/shipping-policy.ts`,
  `test/business-rules/{audit,checkout-hardening,code-generation,query-dto}.spec.ts`,
  `test/concurrency.e2e-spec.ts`, `test/helpers/{concurrency-fixtures,e2e-fixtures,test-app}.ts`,
  `test/mutation-acceptance.e2e-spec.ts`, the **three** new migration dirs,
  `docs/CONCURRENCY-AUDIT.md`, `apps/customer-web/`, and `backups/`.
  The 44 throwaway `scratch-*.mts` / `probe-*.mts` artifacts were **removed**.

---

## 6. Remaining risks

1. **~~DEV database migration pending.~~ RESOLVED.** `20261008000000_code_sequences`
   and `20261009000000_inventory_quarantine_movement` were applied to **DEV** with
   `prisma migrate deploy` (additive, no reset). Both DEV and TEST now report
   *"Database schema is up to date!"* (4 migrations). DEV was backed up first
   (`backups/agrimarket_v2-dev-20261009-004520.sql`) and verified afterwards:
   7 orders, 7 `code_sequences` rows, 19 inventory movements, 0 idempotency keys
   — unchanged.
2. **Global counter serialisation.** All checkouts on a given day share one
   `code_sequences` row, so order-code claims are serialised globally. Fine at
   current volume; a future throughput ceiling if checkout rate grows sharply.
3. **~~Flash per-customer over-count of non-flash purchases.~~ FIXED.** The
   per-customer limit now counts only purchases **belonging to that flash sale**:
   the aggregate is scoped to `unit_price_snapshot = item.flashPrice` **and**
   `order.created_at` inside `[startsAt, endsAt]`. A normal-price purchase of the
   same variant no longer counts against the flash limit.
4. **`ReadCommitted` dependency.** The per-customer enforcement relies on the
   checkout transaction running at READ COMMITTED. If a future change drops that
   option, the count-after-lock would silently stop seeing concurrent commits.
5. **Pool sizing.** The nested-connection bug is fixed, but the adapter pool must
   still be ≥ the intended checkout concurrency (measured ≥16 concurrent sleeping
   transactions fit). Documented, not enforced.
6. **Price-change guard is opt-in.** `expectedGrandTotal` is optional, so a client
   that does not echo the previewed total keeps the old behaviour. The web client
   always sends it; other/legacy clients should adopt it to get the 409 guard.

---

## 7. Verdict

**FINAL CONCURRENCY PASS on the verified invariants.** Every listed race was
reproduced on real MySQL, fixed with transactions + atomic conditional updates
that re-check sufficiency, and re-verified by the **official** concurrency suite
(`test/concurrency.e2e-spec.ts`, 15 scenarios, 0 failures) with direct DB
assertions. Oversell and over-quota are proven impossible on the tested paths.
E2E skip = 0; all unit (178) / E2E (187) / lint / typecheck / build checks are
green, and API + Admin Web + Customer Web were smoke-tested live against DEV. The
previously open items (DEV migration, flash per-customer scope) are now
**resolved**; the remaining items are operational/decision notes, not unresolved
correctness defects on the audited paths — and no unverified case is claimed as
100%.
