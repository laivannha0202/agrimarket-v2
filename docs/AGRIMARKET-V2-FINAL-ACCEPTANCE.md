# AGRIMARKET V2 — FULL BUSINESS ACCEPTANCE REPORT (LOCAL DEMO)

**Date:** 2026-10-10. **Scope:** `apps/api` + `apps/admin-web` + `apps/customer-web`
(read-only interop). No commit / no push. Mobile untouched.

**Verdict: `AGRIMARKET V2 — FULL BUSINESS ACCEPTANCE PASS / READY FOR LOCAL DEMO`**
(NOT production-ready — §H lists the missing production conditions.)

---

## A. Git & environment

- Repo `E:/dev/.../Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc`,
  branch `main`, HEAD `4b14267`. **177 changed entries, all uncommitted; nothing
  committed, pushed, branched, reset or cleaned.**
- DBs: DEV `agrimarket_v2`, TEST `agrimarket_v2_test` (separate). 6 migrations,
  both `up to date`. No `migrate reset`, no reseed of DEV.
- Backups (gitignored `/backups/`): TEST pre-seed-proof dump; DEV pre-backfill dump.
- Concurrent-session incident: a second agent session wrote to this tree
  07:13–07:20 (lot-detail includes, Timeline fix, export backend + deps). Per
  user decision I paused edits until 5+ min silence, mapped its footprint
  read-only, then resumed and verified every inherited change with real tests
  instead of trusting it. It has been silent 07:20 → 08:20+.

## B. Function matrix (Module → Function → API → DB → UI → Test → Result)

Legend: PASS (present + proven), FIXED (repaired + proven), PARTIAL (proven at
one layer only — see notes).

| Module | Function | API | DB | UI | Test | Result |
|---|---|---|---|---|---|---|
| Auth | Admin login, role guard | `/auth/login`, `/auth/me` | users | `/login` | browser login → dashboard | PASS |
| Dashboard | 8 KPIs, 7/30d revenue chart, status chart, recent orders, work queue | `/reports/summary`, `/reports/daily` | aggregates | `/dashboard` | e2e revenue suite + browser | PASS |
| Dashboard | Zero-revenue empty state, honest title | — | — | `DashboardCharts` | browser | FIXED |
| Orders | List/filter, detail, status machine, payment record, shipment, refund | `/orders/*`, `/payments/*`, `/shipments/*` | orders/partner/payments | `/orders`, `/orders/[id]` | e2e mutation + concurrency | PASS |
| Returns/Complaints | Request, approve/reject, resolve, QC-return flow | `/returns/*`, `/complaints/*` | return_requests/complaints | `/returns-complaints` | e2e mutation + export detail | PASS |
| Products | CRUD, Ngừng/Khôi phục, farm↔partner check, auto-slug | `/products/*` | products | `/products/*` | unit + e2e + browser | PASS |
| Variants | **Sửa tên/giá, Ngừng/Khôi phục**; SKU+units immutable; snapshot preserved; checkout hard block | **`PATCH /products/variants/:id`** | product_variants | `/products/[id]` variant table | unit 3/3 + e2e 6/6 + browser modal | FIXED |
| Categories | CRUD, auto-slug, stable slug | `/categories/*` | categories | `/categories` | unit + browser | PASS |
| Partners/Farms | CRUD, farm locked to partner, comma-decimal coordinates | `/partners/*`, `/farms/*` | partners/farms | `/partners*`, `/farms*` | unit + browser | FIXED (decimals) |
| Seasons/Harvests | CRUD, lot-allocation invariant (Σ lots ≤ harvest) | `/seasons/*`, `/harvests/*`, `POST /lots` | seasons/harvests/lots | via lots QC flow | unit + e2e | PASS |
| QC | Inspect PASS/FAIL/quarantine, **FAIL requires reason**, inspector FK | `POST /qc` | qc_inspections | `/quality-control` | unit 7/7 + e2e + browser | FIXED (FAIL note) |
| Lots/Trace | Detail + QC/inspector + warehouse/variant/available + ordered timeline + recall | `/lots/*` | lots/traces | `/lots`, `/lots/[id]` | browser 4/4 markers + e2e | FIXED |
| Certificates | Register, verify/reject, **expired≠valid distinction** | `/certificates/*` | certificates | `/certificates` | browser tag check | FIXED |
| Inventory | Balances + movements, FEFO, reserve/release/quarantine atomic | `/inventory/*` | balances/movements | `/inventory` | concurrency 15/15 + e2e | PASS |
| Warehouse docs | Draft→complete (CAS, once), **business vs record dates**, named lines | `/warehouse-documents/*` | warehouse_documents | `/warehouse-documents*` | e2e + browser | FIXED |
| Vouchers/Discounts/Flash | CRUD + status, quota & per-customer atomicity, price-source separation | `/vouchers/*`, `/product-discounts/*`, `/flash-sales/*` | promotions | `/vouchers`, `/product-discounts`, `/flash-sales` | concurrency + unit + browser labels | PASS |
| Customers/Users | List, lock/unlock (last-admin guard contextual) | `/customers/*`, `/users/*` | users | `/customers*` | browser | FIXED (note) |
| Reviews | List with reviewer, Duyệt/Cập nhật by state | `/reviews/*` | reviews | `/reviews` | e2e + browser | FIXED |
| Commission/Settlement/Payout | Rules, settlement build, confirm, payout, **CONFIRMED≠PAID** | `/commission-rules/*`, `/settlements/*`, `/payouts/*` | settlements/lines/payouts | `/commission`, `/settlements*` | e2e + export e2e | PASS |
| Reports | Summary+daily aggregates, full-set (no 100-cap), VN tz | `/reports/summary`, `/reports/daily` | aggregates | `/reports`, `/dashboard` | e2e revenue + unit | PASS |
| Reports export | **Real .xlsx/.pdf download, order-grain tables, period filename** | **`GET /reports/export`** | same aggregates + detailRows | `/reports` Xuất báo cáo | unit 5/5 + e2e 7/7 + browser dl | FIXED |
| Settlement export | **Real .xlsx/.pdf statement, payout truth** | **`GET /settlements/:id/export`** | settlement+lines+payouts | `/settlements/[id]` Xuất bảng | e2e + browser dl | FIXED |
| Customer web | List/detail render, price, public trace by code | public products/trace | same | `:3002` | browser read-only 3/3 | PARTIAL (no DEV writes by design) |
| QR trace | `GET /trace/:code` → lot history | `/trace/*` | trace_events | `/truy-xuat/[code]` | live 200 + browser | PASS |

Admin mutations clicked in a browser on DEV were limited to open/validate/cancel
(no DEV writes per safety rule); every mutation is proven at API level on TEST.

## C. Bugs found → root cause → fix → proof

| # | Symptom | Root cause | Fix (files) | Proof | Result |
|---|---|---|---|---|---|
| B-1 | 13/19 lots: warehouse-in (21/09) BEFORE harvest | `seed.ts` stamped every `WAREHOUSE_IN` with fixed `addDays(-17)` under one doc | `seed.ts` per-harvest-day docs, inbound=harvest+24h (`warehouse-chronology.ts` + unit guard) | TEST reseed: 13→0 violations; DEV backfill (approved, backed up): 10 docs, 0 violations, balances/orders untouched; lot 43 live | FIXED |
| B-2 | Lot detail Kho/Quy cách/Khả dụng = `—` | `LotsService.findOne` omitted warehouse/variant includes + `available` | `lots.service.ts` includes + derived `available` (inherited, verified) | live lot 43 + browser 4/4 | FIXED |
| B-3 | Lot QC inspector = `—` (list showed name) | missing `inspectorUser` include | same (inherited, verified) | live + browser | FIXED |
| B-4 | `[antd: Timeline] items.children deprecated` | antd v6 API | `content:` (inherited, verified) | browser crawl 0 antd warnings | FIXED |
| C-1 | No variant edit/stop; stopped variants still orderable | no endpoint, no checkout check | `PATCH /products/variants/:id` (SKU/units immutable), `resolveLines` block, `inStock` gate, admin UI | unit 3/3 + e2e 6/6 (snapshot kept, 400+no-reserve, 403) + browser | FIXED |
| D-1 | Doc lines showed raw `#39`/`#35` | lines included without lot/variant | includes + UI names/sku | browser doc 4 | FIXED |
| D-2 | Reviews customer = `—`; APPROVED showed `Duyệt` | missing customer include; static label | include + state-aware label/title | browser | FIXED |
| D-3 | Last-admin note on every customer | unconditional render | conditional on ADMIN role | browser | FIXED |
| D-4 | Expired GlobalGAP still just `Đã xác minh` | status-only display | `Hết hiệu lực` tag when VERIFIED+expired | browser tag present | FIXED |
| D-5 | Empty revenue chart with 0–1 axis | no empty state | `Chưa có doanh thu trong kỳ` + title rename | browser | FIXED |
| D-6 | No report export at all | missing feature | `GET /reports/export` + `GET /settlements/:id/export` (xlsx via ExcelJS, pdf via PDFKit+DejaVu), order/return/complaint detail tables (one-row-per-order grain), period filenames, admin download buttons | unit 5/5 + e2e 7/7 + browser downloads + file parses | FIXED |
| E-1 | Downloaded files saved as `bao-cao.xlsx` | CORS hid `Content-Disposition` | `exposedHeaders` in `main.ts` | browser: real period filenames | FIXED |
| E-2 | PDF order codes wrapped mid-code (portrait 10-col overflow) | fixed portrait layout | landscape when >6 cols + 100pt first-col floor + 8pt body | per-font ToUnicode decode: whole codes | FIXED |
| Q-1 | FAIL QC without reason accepted | no basis requirement | 400 on blank-note FAIL (service) + conditional UI rule | unit + e2e (2 callers updated w/ notes) + browser validation | FIXED |
| F-1 | `20,9821` coordinates untypeable/silently dropped | `type=number` + `Number()` | `inputMode=decimal` + comma normalisation in `num()` | admin unit 3/3 + browser comma fill | FIXED |
| T-1 | Throwaway `_exportread.mts` broke typecheck | exceljs Buffer typing | `xlsx.read(Readable)` | typecheck 0 errors | FIXED |

## D. Data-correctness proofs (all executed, not asserted)

- Trace chronology: TEST reseed 0 violations/19 lots; DEV backfill 0 violations,
  timelines ordered, doc refs resolve, DLB balance 600/4/0 unchanged, 7 orders /
  7 payments intact. Lot 43 live: harvest→QC→warehouse-in with correct doc ref.
- QC decides sellability: PASS→SELLABLE, FAIL→REJECTED, packaging-FAIL→
  QUARANTINED; FAIL needs reason; recall blocks inspection (unit+e2e).
- Stock invariants: no negative, atomic reserve/release/quarantine, FEFO eligible
  only (SELLABLE + unexpired + latest QC PASS), double-complete/cancel safe
  (concurrency 15/15 on real MySQL).
- Money: GMV 150.000 / net 0 / commission 6.500 (7-day DEV) reproduced identically
  in API, dashboard, xlsx and pdf; 30-day GMV 1.099.000 in xlsx matches screenshot;
  SET-0001 payable 247.000 = 260.000−13.000 in export; order-table Σ reconciles
  (no partner multiplication); injection text stored as strings, never formulas.
- Auth: admin-only exports/orders/finance 401/403 proven; variant PATCH 403 for
  customers; last-admin lock kept (backend + contextual UI note).

## E. Test counts (final source)

| Suite | Command | Result |
|---|---|---|
| API unit | `pnpm test` | **250/250** (22 files) |
| API e2e (TEST MySQL) | `pnpm test:e2e` | **244/244** (8 files, incl. 15 concurrency scenarios, skip=0) |
| Admin unit | `pnpm --filter admin-web test` | **15/15** (4 files) |
| API typecheck / lint / build | typecheck, lint, build | 0 errors / warnings-only (2 pre-existing) / ok |
| Admin typecheck / lint / build | same | 0 / 0 / ok (all routes) |
| Customer typecheck / lint / build | same | 0 / 0 / ok |
| Browser (Chromium, Playwright) | accept.js | **18/18** (login, 14 routes, 0 antd warnings, 3 real downloads) |
| Browser targeted | accept2.js + probes | voucher %/đ, farm comma, cert tag, dashboard title/state, QC FAIL validation, variant modal |
| Customer-web interop (read-only) | customer.js | 3/3 (list, detail+price, public trace of real lot) |
| Export files | parse UI downloads | xlsx PK-parseable, KPI=API; pdf %PDF- + per-font ToUnicode VN decode |
| `git diff --check` | — | clean (only pre-existing CRLF noise) |

## F. Data preservation

- DEV never reset/reseeded; no order/customer/image deleted; no history edited
  except the **approved, backed-up** B-1 doc split (original doc CANCELLED, kept).
- TEST reseeded once (isolated by design, backed up first); e2e fixtures
  self-clean (leftovers assertion in suite).
- No E2E writes on DEV (browser mutations limited to open/validate/cancel).
- No secrets printed or committed (passwords masked; dumps in gitignored `/backups/`).
- No commit / push / branch.

## G. Remaining issues

- **P0/P1: none confirmed.** (Concurrent-session risk retired: silent 07:20→08:20+,
  footprint verified, no overlapping edits made.)
- **P2 (accepted, documented):**
  1. Settlement export reads live rows (no immutable snapshot for locked periods).
     Locked-period exports should use a snapshot model — schema work, deferred.
  2. KPI band values in xlsx are preformatted strings (tables are numeric).
  3. 2 pre-existing lint warnings in `concurrency.e2e-spec.ts:392` (not introduced here).
  4. Customer purchase flow proven at API level on TEST, not clicked on DEV (by
     safety rule) — interop shown read-only + via shared backend.
- **P3:** filename sanitiser strips VN diacritics (ASCII-safe by design);
  footer/page-break polish; chart tooltips unchanged.

## H. Verdict

`AGRIMARKET V2 — FULL BUSINESS ACCEPTANCE PASS / READY FOR LOCAL DEMO`

Core flows are proven correct and interlinked (Admin→API→DB→Customer reads agree;
money/stock/traceability reconcile with evidence above). **NOT production-ready:**
payment is sandbox/manual, images are local disk, no HTTPS/domain/backup-restore
drill/monitoring/load-test/secret-ops — all still required before real business.
