# AgriMarket V2 — Customer Web — Final Acceptance

Scope: bring the Customer Web (`apps/customer-web`, Next.js 16 + Mantine 9) to a
demo-ready state, verify UI/UX, responsiveness and business acceptance against the
real API, and produce this report — **without** breaking API/Admin/Mobile and
**without** committing anything.

> Status is declared at the end. Nothing below claims a check that was not run.
> Every figure is the live result of the command or page named beside it.

---

## 1. Baseline

### Git

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD (before & after) | `c7220eee11fd42668c4bc28df2636d19577bc0db` |
| Commit / push | **none** — handed back as found, plus this pass's edits |
| Working tree | pre-existing WIP in `apps/customer-web` was preserved in full |

The tree was already dirty before this pass (uncommitted `apps/customer-web` work
from earlier sessions). Nothing was stashed, reset, cleaned or deleted. The pass
added its own edits on top of that WIP and left everything uncommitted.

### Databases

| Env | DB name | Use in this pass |
|---|---|---|
| DEV | `agrimarket_v2` | served the running API; read-only from the browser |
| TEST | `agrimarket_v2_test` | the only target of write/e2e tests |

Every `apps/api/test/*.e2e-spec.ts` re-points `process.env.DATABASE_URL` at
`TEST_DATABASE_URL` before the Nest module is compiled and is skipped entirely
when the variable is unset. That guard was read, not assumed. No write test ran
against DEV.

### Servers

| App | Port | How checked |
|---|---|---|
| API (`apps/api`, global prefix `/api/v1`) | 3000 | `GET /api/v1/products?limit=1` → 200 |
| Customer Web (`apps/customer-web`, `npm run dev`) | 3002 | `GET /` → 200 |

### Logged-in session

Browser session as seed customer `mai.pham@agrimarket.vn` (id 16, "Phạm Thị Mai");
localStorage keys `agri.customer.token` / `agri.customer.user`. Used for the
authed after-sales pages below.

---

## 2. Quality gates (all rerun after every change)

| Gate | Command | Result |
|---|---|---|
| Web typecheck | `npm run typecheck --workspace @agrimarket/customer-web` | exit 0, no output |
| Web lint | `npm run lint --workspace @agrimarket/customer-web` | exit 0, no output |
| Web build | `npm run build --workspace @agrimarket/customer-web` | Next.js 16.4.0 (Turbopack), **29 routes**, compiled clean, TypeScript clean |
| Web voucher parity | `cd apps/mobile && node_modules\.bin\tsx.cmd ..\customer-web\qa\vouchers-parity.ts` | **PASS — 0 differences across 22 checks** |
| API unit | `npm run test --workspace @agrimarket/api` | **28 files / 369 tests passed, exit 0** |
| API e2e (business acceptance) | `npm run test:e2e --workspace @agrimarket/api` | **11 files / 325 tests passed, exit 0** (69s, TEST DB) |
| API typecheck | `npm run typecheck --workspace @agrimarket/api` | exit 0 |
| API lint | `npm run lint --workspace @agrimarket/api` | exit 0 |
| Mobile typecheck | `npm run typecheck --workspace @agrimarket/mobile` | exit 0 |
| Mobile tests | `npm run test --workspace @agrimarket/mobile` | **18 files / 174 tests passed, exit 0** |

The API e2e suite is the business-acceptance layer: checkout hardening,
FEFO/inventory, delivery + return, refund, settlement, commission,
promotions/vouchers, concurrency (stock release on cancel, voucher quota, flash
quota), evidence after-sales, reports, locations, auth. All ran against TEST DB
only, seeded `e2e*` fixtures, and asserted zero leftovers.

### Voucher parity — why a differential test

`apps/customer-web/src/lib/vouchers.ts` is a documented port of Mobile's
`src/lib/vouchers.ts`. Rather than re-derive expectations, the parity script
(`apps/customer-web/qa/vouchers-parity.ts`, read-only, not part of the repo's
suite) runs 16 eligibility fixtures + 2 catalogue orderings + 4 label formats
through **both** implementations and asserts byte-identical output. 22/22 match —
the two clients evaluate vouchers the same way, in the backend's own order, and
neither computes money client-side (the amount always comes from
`POST /orders/checkout-preview`).

---

## 3. Routes & UI/UX verification (live, real API data)

A route sweep at the end of the pass, after all edits:

| Result | Count |
|---|---|
| HTTP 200, no error state | **17 / 17 routes** (`/`, `/san-pham`, `/trang-trai`, `/ma-giam-gia`, `/gio-hang`, `/thanh-toan`, `/don-hang`, `/tra-hang`, `/khieu-nai`, `/danh-gia`, `/quen-mat-khau`, `/dang-nhap`, `/dang-ky`, `/tai-khoan`, `/tai-khoan/dia-chi`, `/tai-khoan/doi-mat-khau`, `/truy-xuat`) |

Detailed pages checked with the logged-in session and real data:

* **Home** — flash-sale cards show real product name + image (the join fix
  confirmed working), 1:1 images (233×233), de-dup holds. "Sản phẩm đang giảm
  giá" correctly shows only the `PRODUCT_DISCOUNT` item; the two flash-sale items
  are excluded. The earlier "Sống lượng"/"tall card" reading was a screenshot
  artifact — the live partner text is "Sông Hồng" (`shortPartnerName`).
* **Traceability** — `TRC-000019-BAPCA` renders full lot / vụ mùa / farm /
  inspection, and honestly states "chưa có chứng nhận nào còn hiệu lực" when the
  certs are out of date. A bad code → clean not-found, no crash.
* **Address picker** — 104 xã/phường (2025 catalogue), province fixed Tỉnh Hưng
  Yên, codes 33/12019; a legacy address is badged "Địa chỉ cũ".
* **Cart** — add → grouped by partner → totals → clear; "Xóa toàn bộ" now asks
  for confirmation (fix 1).
* **Checkout** — real voucher `HUNGYEN50K` with conditions; COD-only honest copy
  ("Thanh toán trực tuyến (VNPay) chưa được mở… chỉ hỗ trợ COD"); totals
  22.000 + 20.000 = 42.000; the summary hides the discount row when
  `discountTotal === 0` and shows the applied code in the row label.
* **Order detail `/don-hang/26`** — the "-0 ₫" discount row is gone
  (fix 4); the math still balances (24.000 + 20.000 = 44.000).
* **Order list `/don-hang`** — all 8 status tabs hit the API with server-side
  filtering; per-tab `meta.total` and empty states are consistent (Tất cả 10 =
  Đã hủy 10 + Đang giao 1 under the same page limit).
* **Returns `/tra-hang`** — filters to `DELIVERED` orders only; honest empty
  state ("Chưa có đơn hàng nào đã giao") with guidance.
* **Complaints `/khieu-nai`** — lists own orders. "Gửi khiếu nại" is offered on
  cancelled orders too; checked
  `apps/api/src/complaints/complaints.service.ts#create` — the backend validates
  ownership and `orderItemId` membership but has **no status gate**, so any own
  order is complainable. Web matches the API and Mobile (`complaints-new.tsx`);
  not a defect.
* **Reviews `/danh-gia`** — `DELIVERED`-only copy, two tabs (Chờ đánh giá / Đã
  đánh giá), honest empty state.
* **Voucher catalogue `/ma-giam-gia`** — `HUNGYEN50K` shows "DÙNG ĐƯỢC" with its
  real rules (min order / max / quota / validity / per-customer). No invented
  "claim" action — the API exposes no such endpoint.
* **Forgot password `/quen-mat-khau`** — with SMTP unconfigured, submitting a
  real email returns the API's `delivery.delivered=false` and the form shows
  "Chưa cấu hình gửi email / email chưa được gửi thật…" instead of claiming an
  email was sent. Anti-enumeration is preserved (identical wording either way).

---

## 4. Responsiveness

| Check | Result |
|---|---|
| Core routes (home, catalog, detail, category, farms, cart, checkout) at 320 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 | **no horizontal overflow** |
| Account + after-sales routes at 320 | overflow fixed (fix 3), re-verified clean at 320 / 360 / 390 |
| Changed pages (`/trang-trai`, `/thanh-toan`) at 320 after fixes 5–6 | overflow = 0, heading present |


---

## 5. Changes made this pass (all uncommitted, inside the preserved WIP)

| # | File(s) | What was wrong | Fix |
|---|---|---|---|
| 1 | `cart/CartView.tsx` | "Xóa toàn bộ" cleared the whole cart instantly, no confirm, no error handling | confirm modal (matches the existing single-item pattern) + `onError` notification |
| 2 | `theme.ts` | Mantine `PasswordInput` shipped the English aria-label "Toggle password visibility" | theme default `visibilityToggleButtonProps` → "Hiện hoặc ẩn mật khẩu" (covers all password forms) |
| 3 | `account/{ProfileView,AddressListView,ChangePasswordForm}.tsx` | content column `minWidth: 300` overflowed at 320px | `miw={{ base: 0, md: 300 }}` |
| 4 | `order/OrderDetail.tsx` | "Giảm giá" row printed even when `discountTotal === 0` → "-0 ₫" | hidden unless there is a real discount (Mobile hides it too) |
| 5 | `app/trang-trai/page.tsx` → `+components/farm/FarmListView.tsx` | route was a `"use client"` page, so it could not export `metadata` and inherited the homepage `<title>` | split into server `page.tsx` (own title/description) + client view, matching every other route |
| 6 | `checkout/CheckoutView.tsx` | empty-cart state had no heading (a11y/landmark) | renders the "Thanh toán" `<h2>` above the empty state, consistent with the loaded state |
| 7 | `app/icon.svg` (new) | no favicon anywhere (no `public/` dir at all) → 404 | added `app/icon.svg` (Next.js App Router convention); `/icon.svg` now 200 |

New supporting files (uncommitted): `components/promotion/{VoucherListView,VoucherCard}.tsx`,
`app/ma-giam-gia/page.tsx`, `lib/vouchers.ts` (voucher catalogue, Web port of the
Mobile feature — `GET /vouchers` is read-only, no "claim" invented),
`components/farm/FarmListView.tsx`, `qa/vouchers-parity.ts`, `qa/NOTES.md`.

Nothing in `apps/api`, `apps/admin-web` or `apps/mobile` was changed by this
pass.

---

## 6. Findings / open items (not defects in the customer web)

* **Data audit flags (investigate, no DB writes without grounds):** "Rau muống
  hạt" name/photo mismatch; "Chuối tiêu hồng 1000 g/nải" unit; the flash-sale
  "cuối tuần Hưng Yên" window spans ~60 days (real data — the display is correct,
  it is the campaign definition that is unusual); farm addresses still carry
  old-district names (needs a legal-mapping confirmation); VietGAP cert status on
  some lots. These are **data** questions, not UI bugs; the UI reports them
  honestly (e.g. the trace page says the certs are no longer valid).
* **SMTP** is not configured in this environment. The forgot-password flow is
  therefore honest about it (see §3) — that is the correct behaviour for a demo.
  Wire a real SMTP in `apps/api/.env` before any production cut.

---

## 7. How to reproduce

```bash
# servers
npm run dev --workspace @agrimarket/api          # :3000
npm run dev --workspace @agrimarket/customer-web # :3002

# gates
npm run typecheck --workspace @agrimarket/customer-web
npm run lint --workspace @agrimarket/customer-web
npm run build --workspace @agrimarket/customer-web
cd apps/mobile && node_modules\.bin\tsx.cmd ..\customer-web\qa\vouchers-parity.ts

# business acceptance (TEST DB only)
npm run test --workspace @agrimarket/api
npm run test:e2e --workspace @agrimarket/api
```

---

## Status

**ACCEPTED — Customer Web is demo-ready.** All quality gates pass, all 17 routes
return 200 with no error states, the UI is honest about every edge case it can hit
(out-of-date certs, empty after-sales, no SMTP, COD-only, zero discounts), the
voucher logic matches Mobile exactly, business acceptance is green on the TEST
database, and the pre-existing uncommitted work in `apps/customer-web` is intact
with this pass's changes layered on top, uncommitted.
