# 07 — PRODUCTION READINESS

> **Audit metadata**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Branch: `main` · Commit: `90c28de8f773af2b266b96979f9508155e9523fe`
> - Audit date: 2026-10-18 (Asia/Ho_Chi_Minh) · Type: independent, read-only audit
> - Cross-references: SEC-01/02/03/05/06 (report 02), BL-01…BL-17 (report 03), ACE-01/02/03/07
>   (report 04), CON-01 (report 05), TQ-01…05 (report 06).
> - Severity scale: P0 blocker · P1 critical · P2 major · P3 minor/improvement.

---

## 1. Verdict summary

| Question | Answer |
|---|---|
| Usable as a **demo / teaching lab** today? | **YES** — with the README's own security checklist applied. |
| Usable as a **small pilot** with real COD orders? | **CONDITIONAL** — only after the P1 money/stock fixes (BL-01/02), JWT secret set (SEC-01), demo credentials rotated (BL-17), SMTP configured, backups established, and a CI that actually runs the suites. |
| Ready for **commercial production**? | **NO.** Blocking gaps: two P1 race bugs on money/stock, COD-only payments, no notifications of any kind, no CI/CD, single-instance deployment assumptions, no observability, no backup/restore procedure, several admin operational gaps that require seed data or direct DB/API work. |

This matches the repository's own framing: the README calls AgriMarket V2 a "Dự án học
tập/demo" (study/demo project, `README.md:534`) and lists mandatory pre-deployment items
(`README.md:519-528`). The audit confirms those items are real, and adds the findings below.

Capability scorecard (verified):

| Dimension | State | Grade |
|---|---|---|
| Authentication & authorization | Default-deny guards, RBAC verified on all 30 controllers, no P0/P1 holes | **Good** |
| Money integrity | COD collection hardened; **refunds and payouts broken under concurrency (P1/P2)** | **Not ready** |
| Stock integrity | Core reservation/quarantine atomic; **quick inbound/adjust corrupt stock (P2); returns move no stock (BL-12)** | **Partial** |
| Payments | **COD only; no gateway (BL-14)** | **Gap for scale** |
| Notifications | **None anywhere (ACE-07)** — no email/SMS/push on order events | **Gap** |
| Traceability | Chain implemented end-to-end; **harvest creation and farming events not operable in admin UI (ACE-01/03)** | **Partial** |
| Test & release automation | Rich suites, **no CI; suite currently has a timing-dependent failure (CON-01)** | **Not ready** |
| Deployment & scaling | Manual, single-instance assumptions (local uploads, in-memory state) | **Not ready** |
| Observability | Health probe + audit log; **no metrics/alerting/log pipeline** | **Partial** |
| Data lifecycle | Migrations + honest seed; **no scheduled backups, no restore runbook** | **Not ready** |

## 2. Deployment & configuration posture (verified)

- **Manual, local-oriented deployment.** `apps/api/package.json` provides
  `start:prod: node dist/src/main.js`; there is **no Dockerfile, docker-compose, reverse-proxy
  config, process manager or CI file anywhere in the repo** (glob search). The README explicitly
  says "no Docker needed" for the dev flow and never documents a server deployment.
- **Config via environment with safe defaults where they matter and unsafe defaults where they
  hurt:** CORS fails closed when `CORS_ORIGIN` is unset (`main.ts:14-24`, verified in report 02),
  but the JWT secret **fails open to the public constant `CHANGE_ME`** when unset
  (`configuration.ts:24`, consumed by `jwt.strategy.ts:32` / `auth.module.ts:23`) — SEC-01 (P2,
  go-live gate #1).
- **Swagger UI is served in every environment** at `/docs`, including production (SEC-02), and no
  security headers/CSP are set (SEC-02/05).
- **Mail transport is honest but unconfigured by default**: without `MAIL_TRANSPORT=smtp` +
  `SMTP_*`, the service uses the in-memory `test` transport (`mail.service.ts:10-19,55-56`) and
  the password-recovery endpoint reports that delivery is not active. Correct behaviour — but
  means **password reset is non-functional until SMTP is configured** (go-live gate).
- **Seed is dev-only and destructive**: `npm run db:seed` wipes and recreates `agrimarket_v2`
  with publicly documented credentials (`README.md:170,176-177,305-318`); the README warns
  "demo accounts, must be changed in production". Risk is procedural, not code — BL-17.
- **Health probe exists and is public** (`GET /api/v1/health`, DB connectivity check —
  `health.controller.ts:11-16`), suitable for load-balancer checks.

## 3. Single-instance / infrastructure assumptions (verified)

The current architecture assumes **one API process with local disk**; none of this is documented
as a deployment constraint:

| Mechanism | Where | Consequence if scaled out |
|---|---|---|
| Product images + evidence files stored on local disk, served by the same process (`UPLOADS_DIR`, default `./uploads`; `product-images.service.ts:39-51`; `main.ts:29`) | API | Instances see only their own uploads; images 404 behind a load balancer; no S3/shared volume path |
| Auth throttler in memory (60 req/min) (`auth.module.ts:18`) | API | Limits multiply per instance; not shared |
| Locations cache in memory (`locations.service.ts`) | API | Harmless (refreshes per process) |
| Evidence orphan sweep via `setInterval` per process | `evidence-sweep.service.ts:50` | Every instance sweeps; harmless only because the sweep is idempotent |
| No background job queue / outbox | API | All work is synchronous in-request; mail failures are logged, never retried (acceptable for COD-only pilot, not for scale) |

→ **PRD-02.** Either document "single-node deployment only" explicitly, or move uploads to shared
storage and externalise the throttler before horizontal scaling.

## 4. Operational readiness (verified)

- **What exists**: health endpoint; global exception filter that never leaks Prisma/SQL internals
  (`all-exceptions.filter.ts`); audit trail for business mutations; structured-ish Nest logs; the
  test DB safety interlock (report 06); `prisma migrate deploy` for schema; git reflects a clean
  tree (no stray changes).
- **What is missing**:
  - **No CI/CD** — no `.github/workflows` or any pipeline. The audited commit's "safe E2E"
    acceptance was a manual run; the suite currently fails 348/349 (CON-01) yet CI cannot notice.
    → **PRD-01 (P2)**.
  - **No backup/restore procedure** — the only artifacts are ad-hoc `backups/*.sql` dumps on a dev
    machine (gitignored, SEC-06); no schedule, no off-site copy, no documented restore drill.
    → **PRD-03 (P2)**.
  - **No observability** — no metrics, APM, log aggregation, or alerting; a failing money path
    (e.g. refunds, payments) is discoverable only by user complaint or DB forensics.
    → **PRD-06 (P3)**.
  - No HTTPS/TLS termination guidance (typically the reverse proxy's job — but not documented).

## 5. Feature completeness for real produce selling (verified)

What is genuinely usable end-to-end today: partner/farm/product/lot catalogue with QC and
traceability codes; storefront (web + mobile) with cart, Buy Now, COD checkout, order tracking,
returns/complaints with photo evidence, reviews, address book; admin operations for products,
inventory (warehouse documents), orders, promotions, vouchers, flash sales, QC, traceability,
users, reports/exports; multi-partner settlements and payouts.

Gaps that matter for actually selling produce (all verified above or in prior reports):

| # | Gap | Findings | Impact on a real shop |
|---|---|---|---|
| 1 | **COD is the only payment method** | BL-14 (P2) | Cart abandonment for customers who cannot pay online; cash-handling risk; the enum contains dead methods (MOCK_ONLINE etc.) that no flow uses |
| 2 | **No notifications anywhere** — customers learn status only by opening the app | ACE-07 (P3) | Order confirm/delivery/refund cannot reach the customer; support burden; contradicts traceability promise |
| 3 | **Traceability cannot be authored from the backoffice** — no harvest creation UI; lots depend on seed data; farming events not creatable | ACE-01 (P2), ACE-03 (P3) | The core differentiator cannot be operated on a fresh production DB |
| 4 | **No shipment operations UI** | ACE-02 (P2) | Delivery milestones must be forced through order status alone; carrier workflows manual/absent |
| 5 | **Returns move no stock** — quarantined/returned goods never re-enter inventory via a document flow | BL-12 (P2) | Stock on hand drifts from the warehouse shelf with every return |
| 6 | **Weak aftersales state machines** — returns/complaints accept any transition, last-write-wins | BL-03/04 (P2) | Operators can revive closed cases; audit trail disagrees with reality |
| 7 | **Settlement refunds hardcoded to 0** | BL-05 (P2) | Partner payouts and reports ignore refunds entirely |
| 8 | **No logout endpoint** (mobile has no logout at all) | BL-11 (P3) | Shared-device hygiene |
| 9 | No favourites/points/notification centre in customer apps | ACE-07/08 adjacency | Retention features expected in a marketplace |
| 10 | Voucher model is admin-push only (no customer claim) | ACE-08 (P3) | Marketing flexibility limited; acceptable design choice if documented |

Sequentially, the **money/stock P1s (BL-01 refund double-spend, BL-02 return over-claim) are the
only items that make the system dangerous with real customers**; the rest degrade experience or
leak work efficiency.

## 6. Security posture for production (summary; details in report 02)

- **Strong (verified)**: default-deny global guards; every admin mutation role-checked; ownership
  scoping on all customer resources; DTO validation with whitelist + forbidNonWhitelisted; uploads
  re-encoded from magic bytes with generated names; CORS fail-closed; exception bodies sanitised;
  no secrets committed; test-DB interlock.
- **Weak / go-live items**: JWT `CHANGE_ME` fallback (SEC-01, P2); Swagger + missing security
  headers (SEC-02, P3); throttling only on auth endpoints (SEC-03, P3); 7-day tokens in
  localStorage without CSP (SEC-05, P3, accepted trade-off); local artifacts on disk containing
  dumps (SEC-06, P3).
- No P0/P1 security finding was found (report 02, §"No P0/P1 security findings").

## 7. Production-readiness findings (PRD)

### PRD-01 — No CI/CD pipeline; release quality depends on manual runs (P2)

- **Evidence**: no workflow/pipeline files in the repository; test commands are manual
  (`README.md:373-396`); the audited commit message claims a "final fix round … safe E2E" while
  the suite fails 348/349 under load (CON-01) and no automated gate exists to catch that.
- **Impact**: regressions merge silently; the P1 races (BL-01/02) shipped with zero automatic
  signal; every release is a leap of faith.
- **Fix**: add a CI pipeline that runs `typecheck → lint → unit → build → e2e` (with a dedicated
  MySQL service container as the test DB); make the e2e run required for merges. Fix CON-01 first
  so the gate is deterministic.
- **Confidence**: high.

### PRD-02 — Single-instance deployment assumptions are undocumented (P2)

- **Evidence**: §3 table — local-disk uploads, in-memory throttler/cache/sweep, synchronous mail.
- **Impact**: the first horizontal scale-out (or container platform with ephemeral disk) silently
  breaks image serving and rate limits, and no document tells the operator this.
- **Fix**: document the single-node constraint in the README/deployment notes, or move uploads to
  shared storage (S3-compatible or mounted volume) before scaling. **Confidence**: high.

### PRD-03 — No scheduled backups or restore procedure (P2)

- **Evidence**: only gitignored local `backups/*.sql` dumps exist on one machine (SEC-06);
  nothing schedules or verifies them.
- **Impact**: a disk failure or bad migration ends the business; no RPO/RTO exists.
- **Fix**: scheduled `mariadb-dump` (or snapshot) to off-site storage + a documented quarterly
  restore drill; include the uploads directory in the backup. **Confidence**: high.

### PRD-04 — Password reset non-functional without SMTP (P2, operational)

- **Evidence**: `mail.service.ts` selects the capture-only `test` transport unless
  `MAIL_TRANSPORT=smtp` or `SMTP_HOST` is set; the reset endpoint honestly reports non-delivery.
- **Impact**: users who forget passwords cannot recover in a default deployment; support must
  reset manually.
- **Fix**: configure SMTP in every real environment (go-live checklist item #6). **Confidence**: high.

### PRD-05 — Observability gap: no metrics, alerting, or log pipeline (P3)

- **Evidence**: no metrics endpoint/library beyond the health probe; logs go to stdout only.
- **Impact**: money/stock incidents (e.g. the BL-01 class) are invisible until they hurt customers.
- **Fix**: ship logs to a collector; add minimal metrics (order/refund/payout counters, error rate)
  and alert on payment/refund anomalies. **Confidence**: high (absence verified by search).

### PRD-06 — Seed runs destructively against a configured database (P3, procedural)

- **Evidence**: `db:seed` wipes and recreates the target DB; documented as dev-only
  (`README.md:170`), but nothing in the script stops `NODE_ENV=production` usage; demo credentials
  are public (BL-17).
- **Impact**: one mistaken command on a production DB destroys data and installs known passwords.
- **Fix**: add a guard to the seed script (refuse when `NODE_ENV=production` unless
  `ALLOW_DESTRUCTIVE_SEED=1`); keep the README warning. **Confidence**: high (behaviour documented
  in README; guard absence verified).

## 8. Go-live gates (recommended, ordered)

1. **Fix BL-01 and BL-02 (P1)** with their concurrency tests (TQ-01) — no real customer orders
   before this.
2. **Fix SEC-01** (require a strong `JWT_SECRET`, fail closed on missing/short values) and set it;
   rotate all demo credentials or remove them from the seed.
3. **Fix CON-01** and stand up **CI** (PRD-01) so the suite is a trustworthy gate.
4. Configure **SMTP** (PRD-04) and verify the reset flow end-to-end.
5. Establish **backups + restore drill** (PRD-03) and document single-node deployment (PRD-02).
6. Decide the payment policy: keep COD-only as an explicit business decision (document it), or
   integrate an online gateway (BL-14).
7. Plan the operational gaps that touch daily work: harvest creation UI (ACE-01), shipment ops
   (ACE-02), returns stock movement (BL-12), notifications (ACE-07) — in that order.
8. Then fix the P2 remainder (BL-03/04/05/06/07) in one hardening sprint.

**Unverified by this audit** (no claim made): HTTPS/TLS behaviour behind a real proxy, load/
soak behaviour, a real restore test, mobile store builds (Expo export not re-run), and any
environment-specific hosting configuration — none exist in the repository to review.
