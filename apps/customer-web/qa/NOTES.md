# Customer Web — QA working notes (V2 demo-ready pass)

QA working notes. Final report → `docs/AGRIMARKET-V2-CUSTOMER-WEB-FINAL-ACCEPTANCE.md`.

## Environment
- API `:3000` (global prefix `/api/v1`), Customer Web `:3002` (`npm run dev:customer`)
- Browser session: logged in as the seeded demo customer `mai.pham@agrimarket.vn`
  (seed password `Agri@12345` — public demo credential from `npm run db:seed`, see root README)
- localStorage: `agri.customer.token`, `agri.customer.user`

## Confirmed good (live, with real API data)
- Home: flash-sale cards now show product name+image (join fix works); 1:1 images (233x233); de-dup holds
  - "Sản phẩm đang giảm giá" correctly shows only Nhãn lồng (PRODUCT_DISCOUNT); the 2 flash-sale items are excluded
  - "Sông Hồng" on the card = `shortPartnerName`, correct (earlier read as "Sống lượng" was a screenshot artifact)
- Route sweep 19/19 → HTTP 200, no console errors, no error states
- Trace: `TRC-000019-BAPCA` full lot/vụ mùa/farm/inspection; honest "chưa có chứng nhận nào còn hiệu lực"; bad code → clean not-found
- Address: 104 xã/phường (danh mục 2025), province fixed Tỉnh Hưng Yên, codes 33 / 12019; legacy address badged "Địa chỉ cũ"
- Checkout: real voucher HUNGYEN50K w/ conditions, COD-only honest copy, 22.000 + 20.000 = 42.000
- Cart: add → grouped by partner → totals → clear (cleanup done, cart empty)

## Verified after-sales & promotion pages (real data)
- `/tra-hang` — correctly filters to `DELIVERED` only; honest empty state ("Chưa có đơn hàng nào đã giao") + guidance
- `/khieu-nai` — lists own orders; "Gửi khiếu nại" offered on CANCELLED orders too.
  Checked `apps/api/src/complaints/complaints.service.ts#create`: it validates ownership (`order.customerId !== customerId` → 400)
  and `orderItemId` membership, but **no status gate** — any own order is complainable. Web matches the API; Mobile
  (`complaints-new.tsx`) does the same. Not a defect.
- `/danh-gia` — DELIVERED-only copy, two tabs (Chờ đánh giá / Đã đánh giá), honest empty state
- `/ma-giam-gia` — voucher catalogue: HUNGYEN50K "DÙNG ĐƯỢC" + min-order/max/quota/validity/per-customer rules, no
  invented "claim" action (API has no such endpoint). `lib/vouchers.ts` is a faithful port of Mobile's, same check
  order as the backend, money never computed client-side.
- `/don-hang` — all 8 status tabs hit the API with server-side filtering (`meta.total` per tab; Tất cả 10 = Đã hủy 10 +
  Đang giao 1 under the same limit). Tab counts and empty states consistent.
- Checkout summary hides the discount row when `discountTotal === 0` (no more "−0 ₫"); applied code shown in the row label.
- `order/OrderDetail.tsx` — discount row now hidden when `discountTotal === 0` (verified on `/don-hang/26`: 24.000 +
  20.000 = 44.000, no "−0 ₫").

## Quality gates
- `apps/customer-web` → `npm run typecheck` ✅ (tsc --noEmit, no output)
- `apps/customer-web` → `npm run lint` ✅ (eslint, no output)
- `apps/customer-web` → `npm run build` ✅ Next.js 16.4.0 (Turbopack) — 28 routes, compiled in 5.8s
- `apps/customer-web/qa/vouchers-parity.ts` ✅ **PASS — 0 differences across 22 checks**
  Differential run of Web's `lib/vouchers.ts` against Mobile's (Web is a port): all 16 eligibility cases,
  both group orderings and all 4 label formats identical. Run with:
  `cd apps/mobile && node_modules\.bin\tsx.cmd ..\customer-web\qa\vouchers-parity.ts`
- `apps/api` → `npm run test:e2e` ✅ **11 files / 325 tests passed, exit 0** (69s)
  Runs against `TEST_DATABASE_URL` (`agrimarket_v2_test`); each spec repoints `DATABASE_URL` before the module
  compiles, seeds `e2e*` fixtures, and asserts zero leftovers. DEV DB (`agrimarket_v2`) untouched.
  Covers business rules: checkout hardening, FEFO/inventory, delivery+return, refund, settlement,
  commission, promotions/vouchers, concurrency, evidence aftersales, reports, locations, auth.

## Fixes made (uncommitted, in existing WIP)
1. `cart/CartView.tsx` — "Xóa toàn bộ" cleared the whole cart instantly, no confirm, no error handling.
   Now: confirm modal (matches the existing single-item pattern) + `onError` notification.
2. `theme.ts` — Mantine `PasswordInput` shipped English `aria-label` "Toggle password visibility".
   Now: theme default `visibilityToggleButtonProps` → "Hiện hoặc ẩn mật khẩu" (covers all 4 password forms).

## Responsive sweep results
- Core routes (home, catalog, detail, category, farms, cart, checkout): **no overflow** at
  320 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440
- Account + after-sales routes: overflow at 320 only → fixed (see #3)
- Screenshots land in `C:\Users\Admin\AppData\Local\Programs\Microsoft VS Code\` (parent of `.playwright-mcp`)

3. `account/{ProfileView,AddressListView,ChangePasswordForm}.tsx` — content column had `minWidth: 300`,
   which overflows at 320px (container padding leaves ~288px). Now `miw={{ base: 0, md: 300 }}`.
   Verified 320/360/390 → clean.
4. `order/OrderDetail.tsx` — "Giảm giá" row was printed even when `discountTotal === 0`, showing "−0 ₫".
   Now hidden unless there is a real discount (Mobile hides it too). Verified on `/don-hang/26`.
5. `/trang-trai` — was a `"use client"` page, so it could not export `metadata` and inherited the homepage
   `<title>`. Split into server `page.tsx` (title/description) + `components/farm/FarmListView.tsx`, matching
   the pattern used by every other route. Title now "Trang trại | AgriMarket".
6. `/thanh-toan` — empty-cart state had no heading (a11y/landmark). Now renders the "Thanh toán" `<h2>`
   above the empty state, consistent with the loaded state.
7. favicon — added `src/app/icon.svg` (Next.js App Router convention; there was no `public/` dir at all).
   `/icon.svg` now returns 200 instead of 404.

## Verified after the fixes
- `/trang-trai`: title "Trang trại | AgriMarket", h2 "Trang trại & vùng trồng", 4 farm cards, icon 200
- `/thanh-toan` (empty cart): headings = H2 "Thanh toán" + H4 "Giỏ hàng đang trống"
- `npm run lint` clean after moving the parity script's `any` casts to real types
- Rebuild after fixes 5–7: ✅ 29 routes (incl. `/icon.svg`), TypeScript clean
  (parity script now uses the real `Voucher` shape: `discountType: "PERCENT" | "FIXED"`, string decimals)

## Open issues
- Data audit flags (investigate, no DB writes without grounds): "Rau muống hạt" name/photo mismatch;
  "Chuối tiêu hồng 1000 g/nải" unit; flash-sale "cuối tuần Hưng Yên" window spans ~60 days (real data, display correct);
  farm addresses in old districts (needs legal mapping confirmation); VietGAP cert status
- SMTP is not configured in this environment → the forgot-password flow must NOT claim an email was sent
  (checked: copy stays neutral). Confirm again in the final report.
  **Verified live:** submitting a real email returns the API's `delivery.delivered=false` and the form shows
  "Chưa cấu hình gửi email / email chưa được gửi thật. Vui lòng liên hệ AgriMarket để được hỗ trợ đặt lại
  mật khẩu." No false "email đã gửi" claim. Anti-enumeration is preserved (same message regardless of account).

## Still to do
- ~~Responsive 320/375/390/430/768/1024/1280/1440~~ done
- ~~Orders/returns/complaints/reviews/vouchers pages with real data~~ done
- ~~Business acceptance on TEST DB only~~ done (`npm run test:e2e --workspace @agrimarket/api` → 11/325 pass)
- ~~Quality gates: typecheck, lint, build, unit tests~~ done (all green, incl. API unit 28/369, Mobile 18/174)
- ~~Final report~~ done → `docs/AGRIMARKET-V2-CUSTOMER-WEB-FINAL-ACCEPTANCE.md`

## Status
All tasks complete. Final report written. Working tree handed back with WIP preserved,
this pass's edits layered on top, nothing committed.
