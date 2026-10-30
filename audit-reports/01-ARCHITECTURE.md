# 01 — ARCHITECTURE, SCOPE & PRIOR-FIX VERIFICATION

> **Audit metadata**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Branch: `main` · Commit: `90c28de8f773af2b266b96979f9508155e9523fe` ("feat(v2): final fix round — Buy Now isolation, provenance badges, COD CAS, safe E2E")
> - Audit date: 2026-10-18 (Asia/Ho_Chi_Minh) · Type: independent, read-only source + runtime audit
> - Auditor: AI agent (DeepSeek V4.1 Flash Free, OpenCode harness). Method: static source review; repo's own test suites run against the isolated test DB `agrimarket_v2_test`; two temp probe scripts run from `%TEMP%\opencode` (outside the repo). No repository code/config was modified; this `audit-reports/` directory is the only addition.
> - Severity scale: **P0** blocker · **P1** critical · **P2** major · **P3** minor/improvement.
> - Finding classes: VERIFIED BUG · BUSINESS LOGIC ISSUE · SECURITY RISK · POTENTIAL RISK · IMPROVEMENT · NOT VERIFIED.
> - Secrets policy: no credential, DB password, or JWT secret values appear in this report set.

---

## 1. What the system is

AgriMarket V2 is a multi-tenant agricultural marketplace for Hưng Yên province (Vietnam) with
farm-to-fork traceability. It is an npm-workspaces monorepo:

| Workspace | Stack | Role |
|---|---|---|
| `apps/api` | NestJS 12 (ESM) + Prisma 7 + MariaDB, JWT auth, Swagger | Single REST backend (`/api/v1`, 30 controllers) |
| `apps/admin-web` | Next.js 16 (App Router, client components), React 19, antd 6, TanStack Query 5 — port 3001 | Backoffice: products, inventory, orders, finance, promotions, QC, traceability, users |
| `apps/customer-web` | Next.js 16, React 19, Mantine 9 — port 3002 | Storefront: catalog, cart, checkout (COD), orders, returns/complaints/reviews, address book, trace |
| `apps/mobile` | Expo / React Native | Customer mobile app (same domain, LAN-connected during dev) |
| `packages/shared-domain` | TypeScript library | Shared checkout/quality/status logic (Buy Now parsing, payload builder, trust-badge allow-list) |
| `packages/design-tokens` | Tokens | Shared design tokens |

Data model: 46 domain models / **52 physical tables** (verified via read-only `information_schema`
probe against both dev `agrimarket_v2` and test `agrimarket_v2_test` databases, which are strictly
separated), **9 applied migrations**, extensive in-schema documentation comments.

## 2. Architectural strengths (verified)

- **Layered boundaries**: DTOs with `class-validator`, global `ValidationPipe` (`whitelist`,
  `forbidNonWhitelisted`), global exception filter that hides Prisma/SQL internals, audit service
  recording business mutations, Swagger docs (`apps/api/src/main.ts:32-40,62-72`).
- **Default-deny security model**: global `JwtAuthGuard` + `RolesGuard` (`app.module.ts:72-75`),
  explicit `@Public()` on the few anonymous endpoints, `@Roles('ADMIN')` on every admin mutation
  (verified per-controller, see report 02 §Authorisation matrix).
- **Compare-and-set (CAS) state machines** on the critical money/stock paths: order status
  (`orders.service.ts:1024-1096`), shipment status and partner-order derivation
  (`shipments.service.ts:135-241`), payment confirmation (`payments.service.ts:127-158`),
  warehouse-document complete/cancel (`warehouse-documents.service.ts:229-318,366-482`).
- **Atomic stock arithmetic**: single-statement conditional UPDATEs for reserve / release /
  quarantine / consume / on-hand change (`inventory.service.ts:289-471`), atomic daily code
  sequences (`common/utils/code-sequence.ts`), FEFO allocation with deterministic ordering.
- **Checkout hardening**: idempotency key persisted with payload hash (source-aware), READ
  COMMITTED transaction for revalidation, `expectedGrandTotal` 409 re-confirmation, voucher
  redemption claimed atomically at checkout.
- **Trust-honest UI**: provenance badges are data-gated in `packages/shared-domain/src/quality.ts`
  (only "Thông tin nguồn gốc" and "Chứng nhận trang trại", certificate requires a currently valid
  VERIFIED certificate). No fabricated claims found in any client (see report 04).
- **Evidence/upload pipeline**: magic-byte + sharp re-encode validation shared by product images
  and evidence photos (`product-images.service.ts:70-131`); evidence served privately with
  per-owner policy; orphan sweep with TTL (`evidence-sweep.service.ts`).
- **Honest operational reporting**: reports use paid/collected timestamp bases, cancelled orders
  excluded, export builders emit real XLSX/PDF; mail transport truthfully reports `test` mode and
  the forgot-password UI never claims an email was sent when SMTP is absent.

## 3. Architecture-level findings

### ARC-01 — Client-side state machines duplicated per app (P3, IMPROVEMENT)
Admin-web hardcodes order/return/complaint transition maps and status orders
(`apps/admin-web/src/app/(admin)/orders/[id]/page.tsx:26-49`,
`returns-complaints/page.tsx:28-39,201`, `reports/page.tsx:22-33`,
`hooks/useDashboardData.ts:47-58`); customer-web and mobile keep their own status/label maps.
`packages/shared-domain` does not export these maps. The server re-validates every transition, so
drift breaks UX only — but a new backend enum value will silently leak its raw name to the UI
(`apps/admin-web/src/lib/status/index.ts:23-28`). **Fix**: move transition maps and labels into
`packages/shared-domain` and consume from all three clients; add a unit test per map against the
API enum. **Confidence**: high.

### ARC-02 — Admin UI cannot operate several implemented backend features (P3, IMPROVEMENT)
API wrappers exist but no page uses them (verified by the admin-web reconnaissance):
`createHarvest` (`resources.ts:104`), `shipments/createShipment/updateShipmentStatus`
(`:191-193`), `updateSeason` (`:102`), `farmingEvents/createFarmingEvent` (`:105-107`),
`warehouse` detail (`:125`), `payments` list (`:188`). Operational consequence: new lots can only
reference *seeded* harvests; shipment tracking cannot be operated from the UI; the farming-event
trace timeline cannot be authored. See ACE-01/02/03 in report 04 for impact and roadmap items.
**Confidence**: high (admin-web subagent audit + wrapper usage grep).

### ARC-03 — Report/export layering is clean; no formula-injection risk (P3, NOTE)
Excel export writes a real workbook through ExcelJS and keeps numbers numeric
(`common/export/excel.builder.ts:22-51`); string cells are written as shared strings, so a
user-controlled value beginning with `=` is not evaluated as a formula by Excel. No finding; noted
to close the question explicitly. **Confidence**: high.

## 4. Prior-fix verification (Phase E claims)

The final commit `90c28de` claims three fixes. All three were re-verified against the *current*
source, the shared package, and the shipped clients:

### E-A. "Mua ngay" (Buy Now) must not overwrite the cart — **VERIFIED FIXED**
- Web: buy-now builds only `?mua-ngay=<variantId>:<qty>` and never mutates the cart
  (`apps/customer-web/src/components/product/ProductDetail.tsx:209-234`); checkout disables the
  cart query when the param is present (`CheckoutView.tsx:144-156,174-179`); payload carries
  `source: "BUY_NOW"` from the shared builder where `source` is a required parameter
  (`packages/shared-domain/src/checkout.ts:301-348`); cart cache is not invalidated on buy-now
  success (`CheckoutView.tsx:352-358`).
- API: `CheckoutSource` enum and cart-consumption no-op for `BUY_NOW`
  (`apps/api/src/orders/orders.service.ts:671,686-688,1202-1236`, `dto/checkout.dto.ts:97-116`);
  source participates in the idempotency hash.
- Mobile: same param-based flow; cart query disabled; `source: BUY_NOW` sent (mobile subagent:
  verified; `packages/shared-domain` is shared).
- Regression tests: `apps/api/test/business-rules/checkout-cart-source.spec.ts` (420 lines) +
  customer-web `src/lib/__tests__/checkout.test.ts:24-93`.

### E-B. No "An toàn"/certification claims without data — **VERIFIED FIXED**
- Structural guard: `packages/shared-domain/src/quality.ts:5-34,59-86` — the badge input type has
  no field from which an "an toàn" claim could be produced; only two labels exist ("Thông tin
  nguồn gốc" when `farmId` set; "Chứng nhận trang trại" only with `validCertificateCount > 0`).
- Web renders the strip only from that allow-list, hiding on error/loading
  (`ProductDetail.tsx:653-701`); certificate wording everywhere is "Hồ sơ đã đối chiếu"
  (`FarmCertificates.tsx:72`, `TraceDetail.tsx:283-287`). Mobile verified removed (mobile subagent).
- Regression tests: `quality.test.ts` pins the forbidden strings (`An toàn`, `Truy xuất`,
  `Đã kiểm định`).

### E-C. COD confirmation concurrency/CAS — **VERIFIED FIXED**
- `payments.service.ts:127-144`: confirming PAID is a conditional `updateMany ... WHERE id AND
  status = <read status>`; loser gets 409; requires the order to be DELIVERED for COD, rejects
  CANCELLED orders, requires a `transactionReference` (lines 103-121).
- Tests: unit `test/business-rules/payment-collection.spec.ts`; admin dialog sends the reference
  (`orders/[id]/page.tsx:70-91,155-166`).
- Residual (separate path): the **refund** endpoint has no such CAS — see BL-01 in report 03.

## 5. Verified-in-this-audit runtime facts

| Check | Result |
|---|---|
| `npm run typecheck` (6 workspaces) | PASS |
| `npm run lint` | PASS (3 warnings, all in `test/**` e2e files) |
| `npm run test` (API unit, vitest) | PASS — 34 files / 435 tests |
| `npm run build` (root) | PASS (api `tsc`, admin-web & customer-web Next builds, packages) |
| `npm run test:e2e` (API, on `agrimarket_v2_test`) | **348 pass / 1 fail** — see CON-01 in report 05 |
| Concurrency spec alone, 20 rounds | PASS (deliver won every round) |
| Dedicated race probe (30 races, both invocation orders) | Deliver won 30/30; cancel won 0 — quantifies the flake |
| DB isolation interlock (`test/helpers/db-safety.ts`) | Present and effective (refuses same DB as app) |

## 6. Report set

| File | Contents |
|---|---|
| `01-ARCHITECTURE.md` | This file: scope, architecture, strengths, ARC findings, Phase E verification |
| `02-SECURITY.md` | Auth/Z, secrets, CORS, uploads, SEC findings |
| `03-BUSINESS-LOGIC.md` | Money/stock/process rules vs implementation (BL findings) |
| `04-ADMIN-CUSTOMER-CONSISTENCY.md` | Admin ↔ customer ↔ mobile consistency (ACE findings) |
| `05-CONCURRENCY-DATA-INTEGRITY.md` | Race inventory, atomic patterns, the failing e2e (CON findings) |
| `06-TEST-QUALITY.md` | Test evidence, coverage gaps, infra findings (TQ findings) |
| `07-PRODUCTION-READINESS.md` | Deployment/config risks, capability gaps (PRD findings) |
| `08-FIX-ROADMAP.md` | Prioritised fix plan with per-finding tasks and tests |
