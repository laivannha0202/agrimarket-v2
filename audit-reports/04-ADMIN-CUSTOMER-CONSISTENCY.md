# 04 — ADMIN ↔ CUSTOMER CONSISTENCY

> Repo `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` · branch `main` · commit
> `90c28de` · 2026-10-18 · read-only. Sources: direct API review plus dedicated reconnaissance of
> `apps/admin-web`, `apps/customer-web`, and `apps/mobile`. Every claim below cites a file.

## 1. Method

Three client apps were audited against the single API contract (`/api/v1`, 30 controllers):

- **Admin web** (30 pages + login/root): route inventory, endpoint map, DTO compatibility
  spot-checks, mock/hardcode scan, unused API wrappers.
- **Customer web** (27 routes): route inventory, endpoint map, mock/hardcode scan, buy-now and
  trust-badge verification, `qa/` artifacts review.
- **Mobile** (Expo): screen inventory, buy-now isolation, badge gating, mock scan, README claims.

Consistency question set: (a) do the three clients agree on enums/statuses/flows? (b) do admin
capabilities cover the customer-facing lifecycle? (c) is any number/label fabricated in any
client? (d) do the docs describe the shipped system?

## 2. Consistency matrix (verified)

| Concern | Admin | Customer web | Mobile | API truth | Verdict |
|---|---|---|---|---|---|
| Order statuses/labels | `lib/status/index.ts` maps + NEXT_STATUS | own map | own map | single enum, CAS machine | Consistent **values**; duplicated maps (ARC-01) |
| COD collection | dialog → `PATCH /payments/:id/status` with courier reference | copy: "COD khi nhận hàng"; success screen shows payment status | COD only | CAS + DELIVERED gate + reference required (`payments.service.ts:103-144`) | **Consistent** |
| Buy Now | n/a (admin has no buy flow) | param-based, `source: BUY_NOW` | param-based, same shared code | cart consumption no-op for BUY_NOW | **Consistent** (Phase E-A verified) |
| Trust badges | not shown (admin shows raw data) | allow-list only ("Thông tin nguồn gốc", "Chứng nhận trang trại") | same shared allow-list | certificates endpoint returns only VERIFIED+ACTIVE+valid+document | **Consistent** (Phase E-B verified) |
| Certificate wording | certificates page verify/reject + "Hồ sơ đã đối chiếu" badge | same wording (`FarmCertificates.tsx:72`) | same | — | **Consistent** |
| Traceability | QR label generation requires sellable+valid+public-https base; lot detail shows movements | trace lookup by code; detail shows lot journey + public events | same API | `trace/:code` exposes only `isPublic` events | **Consistent** |
| Returns flow | tabs + transition dialog + refund id | create from eligible items; tracker; refund block when returned | same endpoints | API has **no state machine/CAS** (BL-03) | Values consistent; server flow weak |
| Complaints flow | transition dialog | create/detail; "đang xử lý" until resolution | same | API has no state machine/CAS (BL-04); any owned order (BL-13) | Values consistent; server flow weak |
| Shipment statuses | shown read-only inside order detail | not exposed as a page; order detail shows shipment rows | status line from order detail | API + enum + CAS exist; **no admin UI action** (ACE-02) | Values consistent; operational gap |
| Payment methods | displays PaymentMethod incl. dead enum values | COD only | COD only | no gateway (BL-14) | Consistent in behaviour; dead enum surface |
| Vouchers | full CRUD + status | read-only catalogue (no claim) | same | claim happens at checkout | **Consistent by design** |
| Inventory ops | balances page with **quick inbound/adjust** + warehouse documents page | stock shown via availability | same | quick endpoints non-atomic (BL-07) | Gap is server-side |
| Money display | `formatMoney` VND; reports from API aggregates | preview totals from server; "Đang tính giá…" until preview | same | server-side math | **Consistent** |
| Notifications | none | toasts only | none | none | Absent everywhere (ACE-07) |
| Auth guard | client-side `AuthGuard` (documented UX-only) | client-side `RequireCustomer` | token in storage | global default-deny on API | **Consistent** (server is the boundary) |

## 3. Mock / hardcoded production data scan — result: **none found**

- **Admin web**: grep for `TODO|FIXME|stub|mock|hardcode|coming soon|fake` returns only the real
  `PaymentMethod` enum member `MOCK_ONLINE` (schema value, unused in flows). All KPIs/charts come
  from `/reports/*` aggregates.
- **Customer web**: no mocks; app-backed everywhere. Hero copy is brand-only; farm imagery is
  explicitly tagged "Hình minh hoạ" because `Farm` has no image field
  (`FarmListView.tsx:131`); cart lines show "Đang tính giá…" rather than invented prices.
- **Mobile**: no mocks in shipped screens (mobile reconnaissance); same honest-labelling approach.
- Hardcoded *lists* exist but are legitimate mirrors of server enums (status orders, transition
  maps) — see ARC-01. Lookup caps (`limit: 100`) are documented in hooks and only affect large
  catalogues (ARC-01/ACE-04 adjacency).

## 4. Findings

### ACE-01 — Admin cannot create harvests; lots depend on seeded harvests (P2, GAP)
- **Evidence**: `admin-web/src/lib/api/resources.ts:104` defines `createHarvest` but nothing calls
  it; `lots/page.tsx:174-186` requires selecting an existing `harvestId`; API `POST /harvests`
  exists. Consequence: on a fresh production DB without seed, no lot can be created through the
  UI at all — the traceability chain cannot be started from the backoffice.
- **Fix**: add a harvest create/edit UI on the farm detail page (season-scoped). **Confidence**: high.

### ACE-02 — No shipment operations UI (P2, GAP)
- **Evidence**: admin wrappers `shipments/createShipment/updateShipmentStatus`
  (`resources.ts:191-193`) unused; shipments render read-only in `orders/[id]/page.tsx:253-275`;
  API has full CAS-guarded shipment state machine (`shipments.service.ts`). Customer-facing order
  tracking therefore cannot be advanced per-shipment from the UI; operators drive order status
  only.
- **Fix**: shipment panel on order detail (create, advance status, failure reason). **Confidence**: high.

### ACE-03 — Season edit and farming-event trace UI missing (P3, GAP)
- **Evidence**: `resources.ts:100-107` (`season`, `updateSeason`, `farmingEvents`,
  `createFarmingEvent`) unused; seasons are create-only from the farm page; the trace timeline
  feature (farming events) is API-complete but has no authoring UI, and `FARMING_EVENT_TYPE`
  labels in `lib/status/index.ts:159-167` are unused.
- **Fix**: season edit + farming event composer on the farm/season pages. **Confidence**: high.

### ACE-04 — UI state maps duplicated across three clients (P3, DRIFT RISK)
- **Evidence**: admin `orders/[id]/page.tsx:26-49`, `returns-complaints/page.tsx:28-39,201`;
  customer-web `lib/status-format` helpers; mobile own maps; none sourced from
  `packages/shared-domain`. Server re-validates (DTO enums + CAS), so the risk is UX-only, but a
  new enum value leaks raw names (`admin-web lib/status/index.ts:23-28`).
- **Fix**: single source in `packages/shared-domain` (see ARC-01). **Confidence**: high.

### ACE-05 — Customer-web `qa/NOTES.md` describes fixes that are not in the tree (P3, DOC DRIFT)
- **Evidence**: `qa/NOTES.md:51-74` presents a clear-cart confirm modal and a checkout
  empty-state heading as done; current tree has **no** confirmation modal
  (`CartView.tsx:286-297` clears immediately) and the checkout empty state has no "Thanh toán"
  heading (`CheckoutView.tsx:445-464`). The same file says "nothing committed" while HEAD is a
  committed final-fix commit (tree clean).
- **Impact**: QA log readers may believe features exist that don't.
- **Fix**: correct the notes; move claimed-but-missing UX to the backlog. **Confidence**: high.

### ACE-06 — Mobile README drift (P3, DOC DRIFT)
- **Evidence**: mobile README claims register/change-password are absent; both exist in the API and
  the web/mobile flows (mobile reconnaissance). README also predates several screens.
- **Fix**: refresh README. **Confidence**: high.

### ACE-07 — No notification system anywhere (P3, GAP)
- **Evidence**: no notification model/endpoint (API), no inbox in customer web (toasts only,
  `providers.tsx:61`), none in mobile; order status changes are invisible unless the customer
  opens the app.
- **Impact**: for COD produce delivery, "out for delivery" nudges matter; manual calling is the
  fallback. Roadmap item (PRD-04). **Confidence**: high.

### ACE-08 — Voucher model is admin-created/customer-consumed with no "my vouchers" (P3, DESIGN NOTE)
- Consumes are created at checkout only; the catalogue page is informational. Consistent, but
  customers cannot "save" a voucher; if marketing wants claim-to-wallet, the API needs it.
  **Confidence**: high.

## 5. Cross-checks that passed (no findings)

- **Endpoint existence**: every wrapper called by admin/customer/mobile maps to a real API route;
  DTO payloads spot-checked for products, lots, inventory, QC, warehouse documents, promotions,
  customers, settlements, returns/complaints, reports — all match (`dto` files vs client call
  sites).
- **Client-side vs server-side rule ownership**: numeric/format validation exists client-side but
  the server DTO `Min(...)`/enums are the boundary (admin subagent table); no client-only
  enforcement found.
- **Guard posture**: both web apps use client-side guards explicitly documented as UX-only
  (`session.ts:5-7`, `AuthGuard.tsx:8-11`); API is the real boundary (verified default-deny).
- **COD semantics in copy vs code**: customer copy promises collection at delivery; code refuses
  PAID before DELIVERED — consistent.
- **Trace QR honesty**: QR labels encode a bare trace code when `NEXT_PUBLIC_TRACE_BASE_URL` is
  unset (default local `.env.local`), and the generator rejects localhost/LAN/HTTP for *URL*
  payloads (`admin-web lib/qr-label.ts:29-72`) — honest, documented.

## 6. Admin ↔ Customer lifecycle walk-through (spot-verified transitions)

1. **Onboarding**: admin creates partner → farm → season → harvest (**harvest UI missing,
   ACE-01**) → lot (admin) → QC inspect (admin; PASS→SELLABLE) → warehouse document INBOUND →
   stock available. Customer sees product only when ACTIVE + sellable stock exists.
2. **Purchase**: customer previews (server) → checkout COD (`source` CART/BUY_NOW) → order
   `PENDING_CONFIRMATION`; admin confirms → PREPARING → READY_TO_SHIP → SHIPPING (admin or
   shipment flow) → DELIVERED (consumes stock) → admin confirms COD collection with reference;
   customer sees refund row only if refund exists.
3. **After-sales**: customer files return/complaint from eligible delivered items (server-checked
   eligibility); admin transitions them (**server has no state machine — BL-03/04**) and can
   refund via payments (**race-prone — BL-01**); return acceptance moves no stock (**BL-12**).
4. **Trace**: lot QR → public trace page shows public events + verified certificates.

The lifecycle is coherent across clients; the marked weak points are all server-side (reports
03/05) or missing admin UI (ACE-01/02/03).
