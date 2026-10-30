# 05 — CONCURRENCY & DATA INTEGRITY

> **Audit metadata**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Branch: `main` · Commit: `90c28de8f773af2b266b96979f9508155e9523fe`
> - Audit date: 2026-10-18 (Asia/Ho_Chi_Minh) · Type: independent, read-only source + runtime audit
> - Method: static review of every write path that touches stock or money; inventory of atomic
>   patterns; the repo's own concurrency e2e suite run against the isolated `agrimarket_v2_test`
>   DB (full run: 349 tests, 348 pass, 1 fail); a dedicated race probe (30 rounds, both invocation
>   orders) run from `%TEMP%\opencode` outside the repo. No code/config was modified.
> - Cross-references: BL-01/02/06/07/15/16 (report 03), E-C (report 01 §4), TQ findings (report 06).

---

## 1. Verdict summary

The **core money/stock paths are correctly engineered against races**: checkout reservation, order
state transitions (including cancel-vs-deliver), COD payment confirmation, warehouse-document
completion and FEFO consumption all use compare-and-set row guards or single-statement conditional
SQL — verified both by code reading and by the suite's dedicated concurrency tests.

The **weak points are all the same pattern**: read-then-write where the read and the write are not
protected by a row lock or a conditional update. In order of money impact:

| Rank | Path | Finding | Severity |
|---|---|---|---|
| 1 | Refund creation (`POST /payments/refunds`) | BL-01 TOCTOU → double refund | **P1** |
| 2 | Return requests (`POST /returns`) | BL-02 snapshot race → over-claim | **P1** |
| 3 | Payout creation | BL-06 TOCTOU → over-payment | P2 |
| 4 | Admin quick inbound/adjust | BL-07 lost update / duplicate stock | P2 |
| 5 | QC inspection, default address, cart add | BL-15 / BL-16 / BL-09 | P3 |

Additionally, this report adds two **test-infrastructure findings discovered during the audit**:
CON-01 (the cancel-vs-deliver concurrency test contradicts the shipped quarantine semantics — a
test defect that makes the suite intermittently red) and CON-02 (the stale-run healer cannot
recover every interrupted run, and one FK failure aborts the whole cleanup).

## 2. Atomic-pattern inventory (what "safe" looks like in this codebase)

| Pattern | Mechanism | Used by (verified) |
|---|---|---|
| Conditional single-statement stock move | `UPDATE inventory_balances SET col = col ± ? WHERE id = ? AND <guard>`; `0 rows ⇒ null` | `reserveStock` `inventory.service.ts:258-273` (`available >= qty`), `releaseStock` `:289-304` (`reserved >= qty`), `quarantineStock` `:327-360` (`reserved >= qty`), `consumeStock` `:362-386`, `changeOnHand` `:456-471` |
| Status compare-and-set | `updateMany({ where: { id, status: <read value> }, data: ... }); count === 0 ⇒ 409` | Orders `orders.service.ts:1039-1047`; payments `payments.service.ts:135-143`; shipments; warehouse documents `warehouse-documents.service.ts:229-318,366-482`; flash quota; voucher claim |
| Guard-failure ⇒ transaction rollback | the CAS/guard returns `null`/`0` and the service **throws** inside the tx rather than fabricating a movement | `orders.service.ts:1138-1142,1150-1155`; `inventory.service.ts` callers; pinned by tests (`concurrency.e2e-spec.ts:697,765`) |
| Atomic counter increment | `upsert` + `{ increment: n }`, or single conditional UPDATE | Flash sale quota (`promotions.service.ts`), code sequences (`common/utils/code-sequence.ts`) |
| Idempotent create | persisted idempotency key with payload hash, unique constraint | Checkout `checkoutIdempotencyKey` (source-aware hash, test `:908`) |
| Deterministic serialisation | READ COMMITTED tx + revalidation, `expectedGrandTotal` 409 | Checkout preview/confirm (`:932`), flash re-validation (`:949,1025`) |

## 3. Race-condition inventory (module-by-module, verified)

| # | Concurrent operation pair | Protection present | Verdict |
|---|---|---|---|
| 1 | 10 checkouts, 1 unit | guarded `reserveStock` | **SAFE** — test `concurrency.e2e-spec.ts:95` passes |
| 2 | 10 checkouts, 5 units | guarded `reserveStock` | **SAFE** — test `:115` |
| 3 | Flash quota, 2 checkouts, quota 1 | atomic conditional quota UPDATE | **SAFE** — tests `:131,280` |
| 4 | Flash per-customer limit race | conditional UPDATE on counter | **SAFE** — tests `:162,195` |
| 5 | Voucher `usageLimit` race | atomic claim + rollback on later failure | **SAFE** — tests `:400,432` |
| 6 | Double order cancel | CAS + guarded release (no clamping) | **SAFE** — test `:463` |
| 7 | Cancel vs deliver | CAS on order row; loser gets 409; only one side effect runs | **SAFE product-side** — test is defective (CON-01) |
| 8 | Cancel of SHIPPING (quarantine) vs concurrent stock taker | guarded `quarantineStock`, rollback on mismatch | **SAFE** — tests `:625,697,719,742,765` |
| 9 | Double warehouse-document complete | CAS + `changeOnHand` once | **SAFE** — test `:837` |
| 10 | 12 simultaneous checkouts | atomic code sequence | **SAFE** — test `:864` |
| 11 | 3 checkout retries, same key | idempotency key unique constraint | **SAFE** — test `:908` |
| 12 | COD double confirm (Phase E-C) | CAS `updateMany where id+status` | **SAFE** — `payments.service.ts:127-144`; `payment-collection.spec.ts`; E-C in report 01 |
| 13 | COD confirm while order cancelled | order-status gate + CAS | **SAFE** — `payments.service.ts:114-121` |
| 14 | Delivery wins → stock consumed, COD stays PENDING | `consumeOrderStock` inside same tx | **SAFE** — `orders.service.ts:1056-1067`; test `:604-615` |
| 15 | Two refunds on one payment | none — aggregate outside tx | **BUG BL-01 (P1)** |
| 16 | Two return requests, same item | snapshot read, **no lock** inside tx | **BUG BL-02 (P1)** |
| 17 | Two payouts on one settlement | aggregate before insert, no lock | **BUG BL-06 (P2)** |
| 18 | Inbound / adjust vs inbound (or vs checkout) | read-then-absolute-write | **BUG BL-07 (P2)** |
| 19 | Two QC results on one lot | no lot guard | **BUG BL-15 (P3)** |
| 20 | Two `set default address` calls | read-then-write | **BUG BL-16 (P3)** |
| 21 | Two cart adds, same variant | read-then-write `existing + qty` | **BUG BL-09 (P3)** |
| 22 | Status updates on returns/complaints | plain `update()`, last-write-wins | **BUG BL-03/04 (P2)** |

## 4. Prior-fix verification (Phase E-C recap)

**COD confirmation concurrency — VERIFIED FIXED.** `payments.service.ts:127-144` claims the
payment with `updateMany({ where: { id, status: <status read moments earlier> } })` and throws
`ConflictException` when `count === 0`; `paidAt` is only written on the winning claim. Guards
before the CAS (lines 103-121) require a transaction reference and, for COD, `order.status ===
DELIVERED`; a cancelled order is refused (line 114-116). Evidence: `payment-collection.spec.ts`
(unit), plus the reviewed code. The old read-then-`update()` is gone.

## 5. Findings

### CON-01 — Concurrency test asserts old release semantics; fails whenever cancel wins the race (P2, TEST DEFECT — VERIFIED)

- **Module**: `apps/api/test/concurrency.e2e-spec.ts:535-623` · CI/test-only (no product impact)
- **Cause**: since `ac76670` (predates the audited commit), cancelling an order whose status is
  `SHIPPING` does not release stock back to sellable: the reservation is moved to `blocked`
  (quarantine) and a movement of type `QUARANTINE` is written
  (`orders.service.ts:1069-1081, 1112-1172`; `inventory.service.ts:327-360`). The test's
  else-branch for the cancel-wins outcome still expects the **old** behaviour:
  `expect(released).toBe(1)` counting `type: 'RELEASE'` movements (`test:616-621`).
- **Evidence**:
  1. Full `npm run test:e2e` on 2026-10-18: **348/349 pass, 1 fail** —
     `concurrency.e2e-spec.ts:620 · AssertionError: expected +0 to be 1`. `released` is 0 because
     the movement written on the winning cancel path is `QUARANTINE`, never `RELEASE`.
  2. Dedicated probe (`%TEMP%\opencode\cd-probe.spec.ts`, 30 races, both invocation orders,
     isolated rounds): delivery won 30/30; the losing cancel received `ConflictException`. So in
     isolation the else-branch is normally unreachable — matching the "349/349 PASS" claim in
     commit `90c28de`, which held only because delivery won every round in that run.
  3. When cancel *does* win (observed in the loaded full-suite run, and when cancel is forced),
     the code writes `QUARANTINE` with `blocked = 3, reserved = 0, on_hand = 10` — internally
     consistent, and exactly what the adjacent, **passing** test pins:
     `:625` "cancelling a SHIPPING order quarantines stock instead of re-selling it".
- **Actual vs expected**: actual = flaky red on unlucky timing (the suite's green/red verdict
  depends on which side wins the race on a loaded DB). Expected = deterministic assertions for
  both outcomes.
- **Business impact**: none on the product; the product semantics are correct and protected. The
  risk is engineering: a red suite that "fixes itself" on re-run trains the team to ignore CI, and
  the wrong expectation invites a future "fix" that would weaken the quarantine rule the test was
  supposed to protect. The commit message's "final fix round … safe E2E" and a recorded
  "349/349 PASS" overstated suite determinism.
- **Fix**: in the else-branch (`test:616-621`) assert the quarantine outcome:
  `QUARANTINE` movement count 1, `RELEASE` count 0, `blocked = qty`, `reserved = 0`,
  `on_hand` unchanged. Keep both branches asserting the invariant
  `available = on_hand − reserved − blocked` is unchanged. Optionally add one deterministic round
  that invokes cancel first to force that branch (or inject a delay into the delivery path) so
  both outcomes are always exercised.
- **Tests needed**: the fixed assertion itself re-run with `CONCURRENCY_ROUNDS` raised (e.g. 50)
  and under load.
- **Confidence**: high (code + full-suite failure + probe + adjacent passing test all agree).

### CON-02 — Stale-run healer cannot discover every interrupted run; one FK failure aborts the whole cleanup (P3, TEST-INFRA RISK — VERIFIED)

- **Module**: `apps/api/test/helpers/concurrency-fixtures.ts:296-370`, called from
  `concurrency.e2e-spec.ts:54` · test-only
- **Cause**: `purgeStaleConcurrencyFixtures` discovers run ids from **users, partners and
  warehouses only** (`:305-322`). It then reconstructs each run's other rows indirectly: products
  via variants (SKU prefix), farms via seasons (`cropName` prefix `:347-351`), harvests via lots,
  categories via slug. Any row whose only "parent" was never created — e.g. a run killed between
  `farm.create` (`:142`) and `season.create` (`:165`) inside `base()` — is invisible to discovery,
  even though `Farm.code` carries the same run prefix and could be scanned directly.
- **Evidence / incident (2026-10-18)**: an audit probe killed by the 30 s vitest timeout left a
  partial `cc…` run in the test DB. The healer found the run (partner/user rows exist) but could
  not resolve the orphan farm; `purgeCreated` then deleted in child-first order and hit an FK when
  `partner.deleteMany` (`:287`) ran while the farm still referenced the partner — **there is no
  per-step error handling, so the abort left the rest of the run's rows behind as well**. A
  follow-up audit cleanup script then compounded the mess (case-insensitive `startsWith 'cc'`
  matched the seed SKU `CCB-500G`, deleted 2 seed allocations, then hit an FK from
  `reviews.order_item_id`). The test DB was subsequently **fully reseeded and verified clean**
  (`npm run db:seed --workspace @agrimarket/api`, 0 `cc` leftovers, seed review/order items
  restored).
- **Actual vs expected**: actual = a killed run can become unhealable, and partial cleanup leaves
  more rows than the interruption created. Expected = any row carrying the run prefix is
  discoverable and removal is idempotent per step.
- **Business impact**: none in production; developer-experience / test-integrity risk — a dirty
  test DB confuses "no leftovers" assertions in other suites and invites manual cleanup scripts
  whose prefix matching can damage **seed data** (as observed).
- **Fix**: (a) discover runs also by `farm.code`, `category.slug`, `product.slug`, `productLot.code`,
  `season.cropName` directly; (b) wrap per-run cleanup so one failure is logged and remaining runs
  still process; (c) make prefix matching case-sensitive/anchored where the DB collation is not
  (or use the full `runId-` marker everywhere); (d) document `CONCURRENCY_ROUNDS ≤ ~100` because
  300 rounds exceeds the suite's 30 s `testTimeout` (`vitest.config.e2e.ts:9`) — a known
  foot-gun that produced the incident.
- **Tests needed**: unit test for the healer with a fabricated orphan-farm run (no season) proving
  cleanup completes.
- **Confidence**: high (observed end-to-end, both the crash and the residue).

## 6. Data-integrity positives (verified, no findings)

- **No clamping writes**: `releaseStock` was deliberately de-clamped (`inventory.service.ts:275-299`)
  so underflow cannot fabricate ledger entries; every guard failure rolls the transaction back
  (`orders.service.ts:1131-1157`). Pinned by `concurrency.e2e-spec.ts:697,765`.
- **Audit rows are written in the same transaction as the state change** on the CAS paths
  (e.g. `orders.service.ts:1083-1093`), so the audit trail cannot claim a transition that rolled
  back.
- **Checkout idempotency is source-aware**: the payload hash includes `BUY_NOW` vs cart source, so
  a Buy Now retry can never replay a cart order (verified in report 01 §4, test
  `business-rules/checkout-cart-source.spec.ts`).
- **Movement arithmetic runs on current column values** in the quarantined/release path, so a
  concurrent checkout's reservation on the same balance is not clobbered (comments and raw SQL at
  `inventory.service.ts:263-268,294-299,327-360`).

## 7. Recommendations (priority order)

1. **BL-01 / BL-02 (P1)**: serialise with `SELECT … FOR UPDATE` on the payment / order-item row, or
   equivalent conditional guards; add the two missing concurrency tests (two refunds, two returns).
   These are the only paths in the system where concurrent requests can move money or promise
   goods twice.
2. **CON-01 (P2)**: fix the test branch so the suite is deterministic — this is what keeps the
   green suite trustworthy for the P1 fixes above.
3. **BL-06 / BL-07 (P2)**: lock the settlement row for payouts; route inbound/adjust through
   `changeOnHand` + locked validation.
4. **CON-02 (P3)**: harden the healer; document the rounds/timeout interaction.
5. **BL-15 / BL-16 / BL-09 (P3)**: opportunistic fixes when touching those modules; each is cheap
   (conditional UPDATE / `increment`).
