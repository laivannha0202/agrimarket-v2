# AgriMarket V2 — Final Admin UX, CRUD & Dashboard Charts

## Decisions (confirmed with user)
- Charts: install `@ant-design/plots` (official Ant Design charts).
- Create-only domains (voucher / product-discount / flash-sale / commission-rule): add `PATCH` status endpoints.
- Order of execution: backend → admin → tests.

## Task list

### Backend
- [x] reports: add daily series endpoint `GET /reports/daily` (VN timezone, 0-filled days, revenue from real payments/refunds)
- [x] reports: unit tests for bucketing + formulas
- [x] promotions: `PATCH /vouchers/:id`, `/product-discounts/:id`, `/flash-sales/:id` (status/fields)
- [x] finance: `PATCH /commission-rules/:id`
- [x] categories: auto-slug from name (slug optional on create)
- [x] products: validate farm belongs to partner
- [x] fix: CreateFlashSaleDto.items missing validation decorators (whitelist stripped it → 400)

### Admin
- [x] products list: Thao tác column (Xem/Sửa + Ngừng bán/Khôi phục + menu)
- [x] categories: auto-slug, hide "Slug"
- [x] product form: full labels for Quy cách bán, remove manual slug
- [x] dashboard: 6-8 KPIs + revenue chart (7/30) + status chart + recent orders + work queue + expiry alert
- [x] vouchers / product-discounts / flash-sales / commission: status actions
- [x] partners / farms: row edit actions
- [x] remove filler subtitles / notes / placeholders

### Verify
- [x] api: typecheck, lint, test (229), test:e2e (220, TEST db)
- [x] admin: lint, typecheck, build
- [x] customer-web: lint, typecheck, build (regression)
- [x] live smoke test: /reports/daily + /reports/summary + PATCH status endpoints

## Final deliverables
- Per-page matrix + final report: `docs/ADMIN-V2-REPORT.md`
- Note: no browser automation available — chart render / console / responsive checked via build + API smoke test only.
