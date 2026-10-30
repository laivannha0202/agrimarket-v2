# 06 — TEST QUALITY

> **Audit metadata**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Branch: `main` · Commit: `90c28de8f773af2b266b96979f9508155e9523fe`
> - Audit date: 2026-10-18 (Asia/Ho_Chi_Minh) · Type: independent, read-only audit
> - Evidence: full test/typecheck/lint/build runs executed against the isolated
>   `agrimarket_v2_test` DB on the audit date, plus static review of every suite. No code or
>   config modified.
> - Cross-references: CON-01/CON-02 (report 05 §5), BL-01/02/06/07/15/16 (report 03), SEC-04
>   (report 02), ACE-05/06 (report 04).
> - Severity scale: P0 blocker · P1 critical · P2 major · P3 minor/improvement.

---

## 1. Inventory & run results

Fresh runs on 2026-10-18 (all commands executed from the repo root):

| Suite | Files | Tests | Result |
|---|---|---|---|
| API unit (`vitest run`) | 34 | 435 | **PASS** (8.6 s) |
| API e2e (`vitest run --config vitest.config.e2e.ts`) | 12 | 349 | **348 pass / 1 fail** → CON-01 (report 05) |
| admin-web unit | 7 | 40 | **PASS** |
| customer-web unit | 3 | 37 | **PASS** |
| mobile unit | 19 | 178 | **PASS** |
| shared-domain unit | 5 | 65 | **PASS** |
| design-tokens | 0 | 0 | no tests |
| `npm run typecheck` | 6 workspaces | — | **PASS** |
| `npm run lint` | 6 workspaces | — | **PASS**, 3 warnings (below) |
| `npm run build` | api / admin-web / customer-web / packages | — | **PASS** (Expo export not re-run) |

Extra runtime evidence gathered during the audit: a dedicated 30-round race probe
(`%TEMP%\opencode`, outside the repo) used to reproduce the cancel-vs-deliver behaviour
(report 05 §5).

Lint warnings (all in API e2e tests, `require-array-sort-compare` — cosmetic):
`test/concurrency.e2e-spec.ts:394` (two), `test/warehouse-admin.e2e-spec.ts:271`.

The rest of this report assesses quality beyond pass/fail counts.

## 2. Strengths (verified)

- **Destructive-test interlock is real and tested.** `test/setup-e2e.ts:22` calls
  `assertIsolatedTestDatabase` *before any connection is opened*; it throws (never skips) when
  `TEST_DATABASE_URL` aliases `DATABASE_URL`, and names only host/schema — never credentials
  (`helpers/db-safety.ts:55-69`). The interlock itself has unit tests (`db-safety.spec.ts`).
- **Self-cleaning fixtures with run-tagged markers.** HTTP e2e rows carry the `e2e…` prefix;
  concurrency rows carry `cc<runId>-`. `afterAll` deletes what the run created and then asserts
  **zero leftovers** (`concurrency.e2e-spec.ts:72-81`); stale-run healers replay the same cleanup
  in `beforeAll`. (The healer's own gap is CON-02, report 05.)
- **The suite pins the Phase E fixes specifically**: Buy Now isolation
  (`business-rules/checkout-cart-source.spec.ts`), the trust-badge allow-list with forbidden
  strings asserted (`packages/shared-domain/src/__tests__/quality.test.ts`, customer-web
  `quality.test.ts`), COD collection CAS (`payment-collection.spec.ts`).
- **Real-behaviour e2e assertions**: real MariaDB, raw-SQL concurrency races with both
  `Promise.allSettled` outcomes inspected, magic-byte image upload tests with real bytes, XLSX/PDF
  export parsing (`reports-export.e2e-spec.ts`), CORS contract tests, per-role authorization
  sweeps, address/auth lifecycle tests including token invalidation and ward gating.
- **Unit tests are fast and dependency-free** (8.6 s for 435 API tests); the whole unit set
  (68 files / 755 tests) runs in under two minutes including client workspaces.
- **Honest, repeated negative tests**: refresh/deleted rows, 404-not-403 for foreign resources,
  invalid status filters → 400, stale totals → 409 — the suite checks refusals, not just happy
  paths.

## 3. Findings

### TQ-01 — No concurrency tests for any of the unprotected money/stock paths (P2, COVERAGE GAP)

- **Evidence**: the concurrency suite covers 27 scenarios (checkout reservation, flash quota,
  vouchers, cancel/deliver, quarantine, warehouse-document complete, code sequences,
  idempotency, preview/confirm) but has **zero** scenarios for: refunds (`BL-01`, P1), return
  requests (`BL-02`, P1), payouts (`BL-06`, P2), admin inbound/adjust (`BL-07`, P2), QC results
  (`BL-15`), default address (`BL-16`), cart adds (`BL-09`). Cardinally: every race this audit
  *verified by code reading* is also **untested by execution**.
- **Impact**: the four P1/P2 races were invisible to CI; nothing would have failed when they were
  introduced, and nothing will prevent a regression after they are fixed. The suite's green
  verdict currently overstates the money/stock integrity of the system.
- **Fix**: add the scenarios listed in report 05 §7 — two concurrent refunds on one payment, two
  concurrent returns on one item, two concurrent payouts on one settlement, two concurrent
  inbounds on one balance — each asserting the exact invariant (money not over-refunded, claimed
  quantity ≤ delivered, payout sum ≤ payable, stock increments not lost).
- **Confidence**: high.

### TQ-02 — Client apps have thin coverage exactly where they consume the API contract (P2, COVERAGE GAP)

- **Evidence**: customer-web has 3 test files, all pure library functions
  (`src/lib/__tests__/checkout.test.ts`, `quality.test.ts`, `status-format.test.ts`) — **no
  component or route tests** for cart, checkout, Buy Now, returns. Mobile has 19 files, all under
  `src/lib/__tests__` — no screen tests. Admin-web's 7 files cover selected components
  (product-edit, lot-qr, flash-sale, category-edit …) but there is **no test for auth-failure
  handling** — which is precisely the gap that produced SEC-04 (`api.download` misses the global
  401 handler): a download that 401s never redirects to login, and no test noticed.
- **Impact**: wiring mistakes between UI and API (auth expiry, error mapping, status maps) are
  invisible; regressions reach the browser/app store without any failing test.
- **Fix**: minimum viable additions — customer-web: a Buy Now flow test and a cart→checkout
  component test with a mocked fetch layer; a shared `apiClient` test asserting 401 → login
  redirect/event (admin-web, customer-web); mobile: one screen-level render test per critical
  screen using the existing lib mocks.
- **Confidence**: high (file inventory verified).

### TQ-03 — Race-test branches depend on wall-clock scheduling; timeout/rounds foot-gun (P3, TEST-INTEGRITY)

- **Evidence**: (a) CON-01 — the concurrency suite's cancel-vs-deliver test asserts the outcome
  of a real race per round; on a loaded machine a once-in-a-run scheduling change flips the
  branch and makes the suite red (observed: full run 348/349; isolation probe 30/30 deliver).
  There is no mechanism to exercise both branches deterministically. (b) `CONCURRENCY_ROUNDS` is
  unbounded: `CONCURRENCY_ROUNDS=300` exceeds the suite's fixed 30 s timeout
  (`vitest.config.e2e.ts:9`), killing the process mid-round — the exact event that produced the
  leftover-data incident described in CON-02.
- **Impact**: false red (or accidentally green) verdicts; test DB residue requires manual repair;
  audit/CI confidence in the whole suite suffers.
- **Fix**: make branch coverage deterministic where possible (inject a delay or force the losing
  side for one dedicated round), assert post-state invariants in *both* branches symmetrically
  (see CON-01 fix), and clamp/document `CONCURRENCY_ROUNDS` (e.g. cap at ~100, or raise
  `testTimeout` proportionally when the env var is set).
- **Confidence**: high.

### TQ-04 — No coverage measurement or thresholds anywhere (P3, IMPROVEMENT)

- **Evidence**: `apps/api/vitest.config.ts` (and the client configs) configure no `coverage`
  block; no threshold is enforced by any script; no codecov/reporter integration exists. Coverage
  of `src/` by the 435 unit tests + e2e suites is therefore unknown (module-level gaps are
  enumerated in TQ-01/TQ-02 only because of this audit).
- **Impact**: the team cannot see regressions in tested-surface, cannot gate new money/stock code
  on coverage.
- **Fix**: enable `@vitest/coverage-v8` with per-directory thresholds (start with
  `src/inventory`, `src/payments`, `src/orders`, `src/finance` = statements 70%+) and run it in
  the (currently absent) CI.
- **Confidence**: high (configs read).

### TQ-05 — Oversized e2e files dilute failure signal (P3, MAINTAINABILITY)

- **Evidence**: `mutation-acceptance.e2e-spec.ts` is 2,725 lines with dozens of nested
  `describe` blocks spanning products, orders, payments, returns, complaints, settlements and
  more; `concurrency.e2e-spec.ts` is 1,200 lines. A failure names the file, not the domain.
- **Impact**: triage cost; merge conflicts in team development; harder to run one domain's e2e
  locally.
- **Fix**: split by module (products-pricing, orders-checkout, aftersales, finance) — mechanical,
  no test-logic change; keep the shared fixtures.
- **Confidence**: high (line counts measured).

## 4. Notes & frictions (not findings)

- **No CI configuration exists** (no `.github/workflows`, no other pipeline file). Tests run only
  when a developer invokes them; the "final fix round … safe E2E" acceptance in the audited
  commit was a manual run, which is how a timing-dependent green slipped through. Tracked as PRD
  finding in report 07.
- The client workspaces print an ESM-config warning on every test run ("ESM syntax in a file
  loaded as CommonJS (vitest.config.ts:1:1)") — cosmetic; rename configs to `.mts` or set
  `"type": "module"`.
- API unit run logs `[EvidenceSweepService] Evidence sweep failed: db down` — this is a fixture
  simulating failure; expected, not a defect.
- `test:e2e` requires `TEST_DATABASE_URL` and silently skips suites when absent
  (`describe.skipIf`), by design; the skip is visible in the runner output.
- README's test section (lines 366-396) accurately documents the commands, the dedicated test DB
  requirement, and the interlock.

## 5. Recommendation summary (ordered)

1. (P1 blockers) Add concurrency tests **together with** the BL-01/BL-02 fixes — a race fix
   without its test will silently regress.
2. (P2) Fix CON-01's assertions so the suite is deterministic; then keep it green in a CI that
   runs `typecheck → lint → unit → e2e`.
3. (P2) Add the client auth-failure and Buy Now/checkout component tests (TQ-02) — small effort,
   closes the SEC-04-class of wiring gaps.
4. (P3) Coverage config with thresholds; split the 2,725-line acceptance file.
