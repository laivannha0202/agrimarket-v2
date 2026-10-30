# 08 — FIX ROADMAP

> **Audit metadata**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Branch: `main` · Commit: `90c28de8f773af2b266b96979f9508155e9523fe`
> - Audit date: 2026-10-18 (Asia/Ho_Chi_Minh) · This document does not change any code; it orders
>   the findings of reports 01–07 into a workable sequence.
> - Severity scale: **P0** blocker · **P1** critical · **P2** major · **P3** minor/improvement.
> - Effort: **S** ≤ 0.5 day · **M** 0.5–2 days · **L** > 2 days (single experienced developer).

---

## 1. Priority principle

Only two findings can move real money or promise goods twice: **BL-01** (double refund) and
**BL-02** (return over-claim). Everything else is trust, operations, or capability. The roadmap
therefore starts with those two **and their missing concurrency tests**, then fixes the
suite/CI trust problem (a test that can be red or green by luck cannot guard anything), then the
remaining P2s, then operations, then product capability.

## 2. Phase 0 — Stop the money leak (do before any real customer order)

| # | Finding | Fix | Files | Effort |
|---|---|---|---|---|
| 0.1 | **BL-01** refund TOCTOU / double refund (P1) | Move the aggregate + insert + payment-status derivation into one transaction that locks the payment row (`SELECT … FOR UPDATE`) or CAS-guards `payments.status`; compute the new status from the locked values | `apps/api/src/payments/payments.service.ts:165-220` | S–M |
| 0.2 | **BL-02** return over-claim race (P1) | Lock the order item (or maintain a `claimed_quantity` with a conditional UPDATE guard) inside the existing transaction; keep the existing eligibility message behaviour | `apps/api/src/returns/returns.service.ts:63-117` | S–M |
| 0.3 | Tests for 0.1/0.2 (TQ-01 partial) | Two concurrent refunds → one wins / capped remainder; two concurrent returns → one rejected. Add to `concurrency.e2e-spec.ts` | `apps/api/test/concurrency.e2e-spec.ts` | S |
| 0.4 | **CON-01** stale cancel-vs-deliver assertion (P2 test defect) | Else-branch must assert QUARANTINE semantics (`QUARANTINE` movement, `blocked`, `RELEASE` = 0); keep invariants in both branches; make both branches reachable deterministically | `apps/api/test/concurrency.e2e-spec.ts:616-621` | S |
| 0.5 | **SEC-01** JWT secret fails open to `CHANGE_ME` (P2) | Fail fast at boot when `JWT_SECRET` is missing/`CHANGE_ME`/short in production (`NODE_ENV=production`); keep dev default | `apps/api/src/config/configuration.ts:24`, `auth/jwt.strategy.ts:32`, `auth/auth.module.ts:23` | S |

**DoD**: all four e2e scenarios pass with `CONCURRENCY_ROUNDS=25`; full suite deterministic
(repeat 3×); boot fails when `JWT_SECRET` unset under `NODE_ENV=production`.

## 3. Phase 1 — Make the suite a trustworthy gate (P2)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 1.1 | **PRD-01** no CI/CD | Pipeline: `typecheck → lint → unit → build → e2e` with a MySQL service container as the isolated test DB; e2e required to merge | M |
| 1.2 | **TQ-01** remaining concurrency gaps | Concurrent tests for: two payouts (BL-06), two inbounds (BL-07), two cancellations already covered; QC (BL-15), default address (BL-16), cart add (BL-09) | M |
| 1.3 | **TQ-02** client gaps | customer-web: Buy Now + checkout component test with mocked fetch; shared API-client test asserting 401 → login redirect (this is SEC-04's bug); admin-web: same 401 test | M |
| 1.4 | **TQ-03** scheduling-dependent tests + rounds foot-gun | Clamp/document `CONCURRENCY_ROUNDS` (≤100) or scale `testTimeout` with it; force both race outcomes deterministically where possible | S |
| 1.5 | **TQ-04** coverage thresholds | `@vitest/coverage-v8`, thresholds 70%+ for `orders/payments/inventory/finance` | S |
| 1.6 | **CON-02** healer gap | Discover runs by `farm.code`, `category.slug`, `product.slug`, `lot.code`; per-run try/catch; document rounds/timeout in the helper header | S |
| 1.7 | **TQ-05** oversized spec files | Split `mutation-acceptance.e2e-spec.ts` (2,725 lines) by domain — mechanical | M |

## 4. Phase 2 — Money & stock hardening (P2 product fixes)

| # | Finding | Fix | Files | Effort |
|---|---|---|---|---|
| 2.1 | **BL-06** payout over-payment | Re-check + insert inside a transaction holding `FOR UPDATE` on the settlement (or materialised `paidAmount` with conditional UPDATE) | `finance/settlements.service.ts:202-254` | M |
| 2.2 | **BL-07** inbound/adjust read-then-write | Route both through `changeOnHand` + locked validation; add optional idempotency key; concurrency tests | `inventory/inventory.service.ts:154-235` | M |
| 2.3 | **BL-05** settlement refunds always 0 | Policy decision: join COMPLETED refunds capped per line and subtract, or remove the column/claims; follow the decision in code + report exports | `finance/settlements.service.ts:74-109` | M |
| 2.4 | **BL-12** returns move no stock | On return approval/completion write a warehouse document (or the quarantined units at least return to inspection) so inventory matches the shelf | `returns/`, `warehouse-documents/` | M–L |
| 2.5 | **BL-03/BL-04** no state machines on returns/complaints | Transition maps + `updateMany` CAS + 409 (same pattern as orders/payments); unit tests per illegal transition | `returns/returns.service.ts:272-290`, `complaints/complaints.service.ts:153-158` | M |
| 2.6 | **BL-14** COD only | Business decision: document COD-only as policy, or integrate a gateway; remove/keep dead enum values accordingly | `payments/`, docs | L if gateway |

## 5. Phase 3 — Go-live operations (P2/P3)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 3.1 | **PRD-04** SMTP unset by default | Configure real SMTP in target envs; verify password-reset end-to-end | S |
| 3.2 | **PRD-03** no backups/restore | Scheduled `mariadb-dump` off-site (including `uploads/`) + quarterly restore drill documented | S–M |
| 3.3 | **PRD-02** single-instance assumptions | Document single-node constraint, or move uploads to shared storage + externalise throttler before scaling | S (doc) / M (shared storage) |
| 3.4 | **BL-17 + PRD-06** seed risk | Guard `db:seed` against production (`NODE_ENV`/explicit override); rotate demo credentials in any real environment | S |
| 3.5 | **PRD-05** observability | Log shipping + minimal metrics/alerts on payments/refunds/payouts | M |
| 3.6 | **SEC-02** Swagger + headers | Hide Swagger in production; add basic security headers at the proxy/app | S |
| 3.7 | **SEC-06** local artifacts | Delete/relocate local `backups/*.sql` and junk directories from any shared machine; keep them gitignored | S |
| 3.8 | **SEC-03 / SEC-05** residual | Extend throttling to write endpoints (or all routes) if abuse is expected; keep token-in-localStorage trade-off documented (or migrate to httpOnly cookies with CSP) | M |

## 6. Phase 4 — Capability gaps for selling produce (P2/P3)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 4.1 | **ACE-01** no harvest creation UI (P2) | Harvest create form + season selector in admin; needed before traceability can start on a fresh DB | M |
| 4.2 | **ACE-02** no shipment ops UI (P2) | Shipment tab: create/update status, waybill/tracking fields, date filters | M |
| 4.3 | **ACE-07** no notifications | Minimal viable: email on order status changes + password reset (SMTP from 3.1); later push for mobile | M–L |
| 4.4 | **ACE-03** farming events / season edit | Admin forms for both (trace timeline authoring) | S–M |
| 4.5 | **BL-11** no logout endpoint | `POST /auth/logout` (tokenVersion bump) + client wiring; mobile logout | S |
| 4.6 | **ACE-05/06 + ARC-01/02** docs/duplication | Move status/transition maps to `packages/shared-domain`; fix client docs drift (`qa/NOTES.md`, mobile README) | M |
| 4.7 | **ACE-08, ACE-04** design notes | Voucher claim model decision; lookup caps documentation | S |

## 7. Phase 5 — Residual P3 correctness & polish

| # | Finding | Fix | Effort |
|---|---|---|---|
| 5.1 | **BL-08** voucher state not restored on cancel | Delete redemption + decrement `usedCount` in the RELEASE path (policy per business) | S |
| 5.2 | **BL-09** cart add lost update | `increment`-based upsert + ACTIVE checks + max qty | S |
| 5.3 | **BL-10** reviews auto-approved | Decide moderation policy; if kept, document it | S |
| 5.4 | **BL-13** complaints on any owned order | Restrict to delivered/eligible orders | S |
| 5.5 | **BL-15** QC inspect race | Add lot-status guard / CAS on QC result | S |
| 5.6 | **BL-16** default-address race | Transactional swap or conditional UPDATE | S |
| 5.7 | **SEC-04** admin `api.download` misses 401 | Route through the shared client (test added in 1.3) | S |
| 5.8 | **ARC-03** note | No action (report/export layering verified clean) | — |

## 8. Finding index (all reports)

| ID | Severity | Module | Verdict | Report | Primary location |
|---|---|---|---|---|---|
| BL-01 | **P1** | Payments/refunds | VERIFIED BUG | 03 | `payments.service.ts:165-220` |
| BL-02 | **P1** | Returns | VERIFIED BUG | 03, 05 | `returns.service.ts:63-117` |
| BL-03 | P2 | Returns state machine | BUSINESS LOGIC | 03 | `returns.service.ts:272-290` |
| BL-04 | P2 | Complaints state machine | BUSINESS LOGIC | 03 | `complaints.service.ts:153-158` |
| BL-05 | P2 | Settlements | BUSINESS LOGIC | 03 | `settlements.service.ts:74-109` |
| BL-06 | P2 | Payouts | VERIFIED BUG | 03, 05 | `settlements.service.ts:202-254` |
| BL-07 | P2 | Inventory quick ops | VERIFIED BUG | 03, 05 | `inventory.service.ts:154-235` |
| BL-08 | P3 | Checkout/cancel | VERIFIED BUG | 03 | `orders.service.ts:1069-1081` vs `:628` |
| BL-09 | P3 | Cart | VERIFIED BUG | 03 | `carts.service.ts:22-45` |
| BL-10 | P3 | Reviews | BUSINESS LOGIC | 03 | `reviews.service.ts:120` |
| BL-11 | P3 | Auth | IMPROVEMENT | 03 | no logout route |
| BL-12 | P2 | Returns/inventory | BUSINESS LOGIC | 03, 07 | returns flow, no stock movement |
| BL-13 | P3 | Complaints | BUSINESS LOGIC | 03 | `complaints.service.ts:16-41` |
| BL-14 | P2 | Payments | CAPABILITY GAP | 03, 07 | COD only |
| BL-15 | P3 | Quality control | VERIFIED BUG | 03 | `quality-control.service.ts:25-99` |
| BL-16 | P3 | Users/addresses | VERIFIED BUG | 03 | `users.service.ts:124-146` |
| BL-17 | P3 | Seed/ops | OPERATIONAL | 03, 07 | seed credentials |
| SEC-01 | P2 | Auth/config | SECURITY RISK | 02, 07 | `configuration.ts:24` |
| SEC-02 | P3 | API surface | IMPROVEMENT | 02, 07 | Swagger `/docs`, headers |
| SEC-03 | P3 | Rate limiting | IMPROVEMENT | 02, 07 | `auth.module.ts:18` scope |
| SEC-04 | P3 | Admin client | IMPROVEMENT | 02, 06 | `api.download` misses 401 |
| SEC-05 | P3 | Client tokens | trade-off | 02 | localStorage/7d/no CSP |
| SEC-06 | P3 | Local artifacts | HYGIENE | 02, 07 | `backups/*.sql`, junk dirs |
| ACE-01 | P2 | Admin traceability | GAP | 04, 07 | no harvest UI |
| ACE-02 | P2 | Admin logistics | GAP | 04, 07 | no shipment UI |
| ACE-03 | P3 | Admin traceability | GAP | 04, 07 | season edit / farm events |
| ACE-04 | P3 | Three clients | DRIFT RISK | 04 | duplicated status maps |
| ACE-05 | P3 | customer-web docs | DOC DRIFT | 04 | `qa/NOTES.md` |
| ACE-06 | P3 | mobile docs | DOC DRIFT | 04 | README |
| ACE-07 | P3 | All clients | GAP | 04, 07 | no notifications |
| ACE-08 | P3 | Vouchers | DESIGN NOTE | 04 | no claim model |
| ARC-01 | P3 | Clients | IMPROVEMENT | 01 | duplicated state machines |
| ARC-02 | P3 | Admin UI | IMPROVEMENT | 01 | unused API wrappers |
| ARC-03 | P3 | Reports | NOTE (clean) | 01 | export builders |
| CON-01 | P2 | E2E suite | TEST DEFECT | 05, 06 | `concurrency.e2e-spec.ts:616-621` |
| CON-02 | P3 | Test fixtures | TEST-INFRA RISK | 05, 06 | `concurrency-fixtures.ts:296-370` |
| TQ-01 | P2 | Tests | COVERAGE GAP | 06 | no concurrency tests for P1/P2 paths |
| TQ-02 | P2 | Client tests | COVERAGE GAP | 06 | no auth-failure/checkout UI tests |
| TQ-03 | P3 | Tests | TEST-INTEGRITY | 06 | timing-dependent branches; rounds/timeout |
| TQ-04 | P3 | Tests | IMPROVEMENT | 06 | no coverage thresholds |
| TQ-05 | P3 | Tests | MAINTAINABILITY | 06 | 2,725-line spec file |
| PRD-01 | P2 | Delivery | GAP | 07 | no CI/CD |
| PRD-02 | P2 | Deployment | RISK | 07 | single-instance assumptions |
| PRD-03 | P2 | Ops | GAP | 07 | no backups/restore |
| PRD-04 | P2 | Ops/mail | GAP | 07 | SMTP unset by default |
| PRD-05 | P3 | Observability | GAP | 07 | no metrics/alerting |
| PRD-06 | P3 | Ops/seed | PROCEDURAL | 07 | destructive seed unguarded |

Totals: **2 × P1 · 17 × P2 · 28 × P3 · 0 × P0** (47 catalogued IDs; ARC-03 is a verified-clean note).

## 9. Sequenced checklist (copy into the issue tracker)

1. [ ] BL-01 refund lock + concurrency test
2. [ ] BL-02 return lock + concurrency test
3. [ ] CON-01 test branches fixed; suite deterministic ×3 runs
4. [ ] SEC-01 fail-closed JWT secret
5. [ ] CI pipeline (PRD-01) green on the above
6. [ ] BL-06, BL-07 with tests
7. [ ] BL-05 policy + implementation
8. [ ] BL-12 return stock flow
9. [ ] BL-03/04 state machines + tests
10. [ ] SMTP, backups, seed guard, deployment docs (PRD-03/04/02, BL-17)
11. [ ] Client 401 + Buy Now/checkout tests (TQ-02, SEC-04)
12. [ ] Capability backlog: ACE-01, ACE-02, notifications, BL-11, BL-14 decision
13. [ ] Residual P3 list (Phase 5)
