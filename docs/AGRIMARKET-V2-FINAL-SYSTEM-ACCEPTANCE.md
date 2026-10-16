# AgriMarket V2 — Final System Acceptance & Release Readiness

**Ngày:** 2026-10-12 · **HEAD:** `c7220ee` trên `main` · **Phạm vi:** toàn hệ thống sau A1–A6, không mở rộng chức năng, không redesign.
**Nguyên tắc:** DEV `agrimarket_v2` chỉ SELECT; mọi kiểm thử ghi trên TEST `agrimarket_v2_test` độc lập (guard tên DB trong fixtures); không reset/clean/stash/commit/push.

---

## 1. Ma trận chức năng

| Nhóm | Customer Web | Mobile Expo Go | Admin Web | API |
|---|---|---|---|---|
| Auth (đăng ký/đăng nhập/quên MK/đổi MK) | ✅ form + messages + build | ✅ screens + 174 tests | ✅ login/guard | ✅ e2e + unit (lockout, token version) |
| Địa chỉ Hưng Yên 104 xã/phường | ✅ picker từ catalogue, không tự gõ huyện | ✅ cùng resources | ✅ xem | ✅ `LocationsService` single-source, validation `wardCode` |
| Catalog/search/slug/product detail | ✅ routes + build | ✅ | ✅ CRUD + ảnh | ✅ e2e + slug/product-image tests |
| Farm/storefront + chứng nhận còn hiệu lực | ✅ `FarmCertificates` + trace badge "Hồ sơ đã đối chiếu" | ✅ `/valid` | ✅ list/verify + tag Hết hiệu lực/Thiếu chứng từ | ✅ `validity` lúc đọc, `/valid` loại hết hạn + thiếu file |
| QR trace (lot/QC/cert/events) | ✅ `/truy-xuat/[code]` | ✅ `trace/[code]` + scan | — | ✅ public trace, event private không rò |
| Giỏ hàng | ✅ CartView (dirty tree từ phiên trước, giữ nguyên) | ✅ | — | ✅ e2e cart |
| Flash Sale/voucher/discount | ✅ section + quota còn/hết + per-customer | ✅ strip | ✅ CRUD + guard weekend-7-ngày mới | ✅ quota atomic, voucher atomic, guard A4 + 37 tests |
| Checkout preview → tạo đơn COD | ✅ CheckoutView | ✅ | — | ✅ preview=confirm, idempotency key, stale-total 409 |
| Order lifecycle + shipment/fulfillment | ✅ OrderDetail/tracking | ✅ order detail + trace links | ✅ chuyển trạng thái + shipment + COD dialog reference | ✅ CAS chống double, consume 1 lần, replay idempotent |
| COD thu tiền | — | — | ✅ dialog mã biên lai (fix GĐ1) | ✅ PAID cần reference, state machine, không tự PAID |
| Hủy/hoàn tồn/quarantine/return/complaint/refund | ✅ account views | ✅ | ✅ returns-complaints | ✅ e2e + concurrency (double cancel, cancel-vs-deliver, quarantine) |
| Reports/settlement/payout | — | — | ✅ dashboard/reports/settlement | ✅ settlement + reports tests, đối soát dưới |
| Đánh giá/review | ✅ | ✅ | ✅ duyệt/ẩn | ✅ e2e review |
| Audit | — | — | ✅ gián tiếp qua actions | ✅ `CERTIFICATE_*`, `PAYMENT_*`, order/shipment events |

---

## 2. Kết quả test (lệnh + exit code)

| Lệnh (từ repo root) | Kết quả |
|---|---|
| `npm exec --workspace @agrimarket/api -- tsc --noEmit -p tsconfig.json` | PASS (exit 0) |
| `npm exec --workspace @agrimarket/api -- oxlint --type-aware src/ test/ prisma/` | PASS, 5 warning có sẵn (`returns.service` skip/take, `evidence.controller` import, 2 sort-compare trong test) |
| `npm exec --workspace @agrimarket/api -- vitest run` | **386/386 PASS**, 29 files |
| `npm exec --workspace @agrimarket/api -- vitest run --config ./vitest.config.e2e.ts` | **331/331 PASS**, 11 files (TEST DB) |
| `npm exec --workspace @agrimarket/admin-web -- tsc --noEmit -p tsconfig.json` | PASS |
| `npm exec --workspace @agrimarket/admin-web -- vitest run` | **40/40 PASS**, 7 files |
| `npm exec --workspace @agrimarket/admin-web -- eslint` 3 file đổi đợt này | PASS (no output) |
| `npm exec --workspace @agrimarket/customer-web -- tsc --noEmit -p tsconfig.json` | PASS |
| `npm exec --workspace @agrimarket/customer-web -- eslint` 4 file đổi đợt này | PASS (no output) |
| `npm exec --workspace @agrimarket/customer-web -- next build` | PASS — 30 routes (static + dynamic) liệt kê ở log build |
| `npm exec --workspace @agrimarket/admin-web -- next build` | PASS — 30 routes liệt kê ở log build |
| `npm exec --workspace @agrimarket/mobile -- tsc --noEmit -p tsconfig.json` | PASS |
| `npm exec --workspace @agrimarket/mobile -- vitest run` | **174/174 PASS**, 18 files |
| `npm exec --workspace @agrimarket/customer-web -- vitest run` | **KHÔNG CHẠY** — package không có test runner (không script test, không vitest/jest). Ghi nhận P2, không bịa PASS. |

---

## 3. E2E business flows (TEST DB, 15 luồng)

Chạy thực qua `mutation-acceptance.e2e-spec.ts` (113 tests) + `concurrency.e2e-spec.ts` + 9 e2e files còn lại — tổng 331 PASS:

1. Đăng ký/đăng nhập CUSTOMER — fixtures tạo user qua API, login lấy token, fresh-login đọc lại profile. ✅
2. Địa chỉ 104 xã — tạo/sửa/xóa địa chỉ, `wardCode` verified server-side, mã lạ 400; legacy free-text giữ nguyên. ✅
3. Catalog/search/detail — product/category/slug/image tests + e2e public. ✅
4. Quy cách/giỏ — cart e2e (thêm/sửa/xóa, join product cho flash item). ✅
5. Flash/voucher — quota atomic 2 concurrent quota=1 chỉ 1 sold; per-customer limit; voucher limit/rollback; price-edit giữa preview-confirm rollback toàn bộ. ✅
6. Checkout preview → COD — `preview totals equal checkout totals`, stale-total 409 không tạo đơn, idempotency key 3 retry 1 đơn, 12 concurrent 12 mã khác nhau. ✅
7. Admin confirm→ship→deliver — CAS từng bước, DELIVERED consume 1 lần + 1 OUTBOUND; shipment sau đó chỉ ghi event. ✅
8. FEFO/OUTBOUND/tồn — FEFO expiry asc + tie-break, hết hạn/QC giữ không bán, `remaining` guard trước movement. ✅
9. COD có reference, không trùng — thiếu reference 400, PAID + paidAt, replay idempotent, REFUNDED terminal. ✅
10. Customer/Mobile theo dõi đơn — order detail + trace links (mobile), OrderDetail (web); cùng API. ✅ (logic; không claim test máy thật)
11. QR/lot/QC/cert — trace public đúng lot, event private không rò; cert hết hạn/thiếu file không vào `/valid`/trace. ✅
12. Hủy/hoàn/hậu mãi — double cancel release 1 lần; cancel-vs-deliver 1 bên thắng; cancel SHIPPING quarantine; return/refund/complaint flows. ✅
13. Đối soát Admin — settlement e2e, reports daily/summary/export khớp nguồn (chi tiết §4). ✅
14. Bảo mật 2 tài khoản — customer không chạm admin routes (403 review/me bằng admin token), admin-only release/payments/verify; token version/password-change vô hiệu token cũ. ✅
15. Retry/double/concurrency — replay shipment/payment idempotent; double INBOUND 1 lần; oversell 10 concurrent 1 unit không oversell. ✅

---

## 4. Đối soát tiền và kho

- TEST DB: mọi đối soát nằm trong e2e (grandTotal = items − discount + ship; OUTBOUND = qty consume; `available = onHand − reserved − blocked`; settlement lines khớp). ✅
- DEV (SELECT, `qa-audit-final.mjs`): 36 đơn, **grandTotal mismatch 0/36**; 4 DELIVERED đều đã PAID (cơ chế cũ, lịch sử); movements 74 (INBOUND 18 / RESERVE 30 / RELEASE 26 / OUTBOUND 0 — thiếu OUTBOUND lịch sử đã kết luận A2, không backfill); warehouse docs 11 (10 COMPLETED + 1 CANCELLED); DELIVERED revenue 672.000đ từ 4 đơn; settlement lines 3; reviews 2, users 7.
- Phát hiện mới khi đối soát DEV: **lot#44 và lot#53 SELLABLE nhưng `expiresAt` 2026-10-11 đã qua** (EXPIRED-SELLABLE). Không phải lỗi bán hàng: `LotsService.isSellable` + FEFO đều chặn `expiresAt < now`, nên 2 lô này không thể allocate/consume từ code hiện tại. Đưa vào danh sách phê duyệt (chuyển status EXPIRED/QUARANTINED + kiểm định lại, không tự sửa).

---

## 5. Responsive và UI

- Customer `next build` + Admin `next build` PASS, không lỗi console build, đủ routes chính (không route chết ở mức build).
- Không tràn/không nút chết/không dữ liệu giả: không có kiểm thử browser tự động trong repo cho Customer (P2 đã ghi); Admin có 40 unit tests (formatters, flash-sale, lot-qr, product/category edit); Mobile 174 tests. Không tuyên bố đã test máy thật — Expo Go chỉ ở mức unit/typecheck; cần phiên vật lý trước demo trên điện thoại.
- Chứng nhận hết hạn không hiển thị còn hiệu lực: đã chứng minh bằng unit (biên inclusive) + e2e (`/valid` + trace) trên TEST DB.

---

## 6. P0/P1/P2/P3 còn lại

| ID | Mức | Nội dung |
|---|---|---|
| — | P0/P1 | **Không còn** trong phạm vi A1–A6 sau các guard đã test. |
| U1 | P2 | Customer Web không có test runner (không script test) — khoảng trống hồi quy UI. |
| U2 | P2 | Chưa có phiên kiểm thử vật lý: mobile browser thật + Expo Go trên máy thật + SMTP thật (blocker demo nếu cần gửi mail/OTP). |
| U3 | P2 | `POST /inventory/release` thủ công không gắn allocation (đã ghi từ A1/A2) — dùng quy trình đối soát trước khi bấm. |
| U4 | P3 | Xuất kho tại DELIVERED (quy ước đã chốt); đổi sang SHIPPING cần đánh giá lại hoàn/thất bại. |
| U5 | P3 | DEV lịch sử chờ duyệt (§7). |
| U6 | P3 | Sale-unit ↔ kg quy ước 1:1 đã chốt modelling, không đổi. |

---

## 7. Dữ liệu DEV cần phê duyệt (chỉ SELECT, chưa đụng)

1. fs#3: đổi `name` → `Flash Sale nông sản Hưng Yên` (giữ window/giá/quota/sold); không tắt sớm.
2. Farms #9–#12: cập nhật địa chỉ khi có giấy tờ mới (không đoán thôn→xã); giữ audit chuỗi cũ; snapshot đơn lịch sử không đụng.
3. addr#16 (`Xã Khoái Châu` + free-text `gần ủy ban`): xác nhận chủ tài khoản rồi vô hiệu hóa/xóa + nhắc nhập liệu.
4. Certs: chỉ đính kèm scan thật khi có (#9 đã có); #11 hết window phải tái chứng nhận ngoài đời; #12 xác nhận biên bản VERIFIED-trên-DEV hoặc revert PENDING có audit.
5. Kho: reservation treo đơn DELIVERED cũ (lot#53 `reserved 32` gồm 2 đơn #40) — khuyến nghị giữ + ghi chú, không backfill OUTBOUND.
6. **Mới:** lot#44 + lot#53 SELLABLE quá hạn 2026-10-11 — đề nghị chuyển EXPIRED/QUARANTINED + QC lại, không tự sửa.

---

## 8. Git status & bàn giao

- HEAD `c7220ee` main, staged 0. Modified ~35 file (A1–A6 services + tests + Admin/Customer/Mobile tối thiểu). Untracked: 4 báo cáo nghiệm thu trước + báo cáo này, `certificate-validity.spec.ts`, QA scripts (`apps/api/qa-*.mjs`, `apps/customer-web/qa/*`), `apps/customer-web/.../ma-giam-gia`, `FarmListView`, `VoucherCard/ListView`, `lib/vouchers.ts`, `icon.svg`.
- Không mất source: mọi sửa A1–A6 còn nguyên trong tree (xác minh qua status + typecheck/tests xanh sau cùng).
- Secrets: `apps/api/.env` gitignored (không staged); check-ignore xác nhận. Không phát hiện secret trong diff (không commit nên không quét toàn bộ lịch sử — ghi nhận).
- **Không nên commit:** `apps/api/.env`, `apps/api/s.name` (file 0 byte lạ), QA scripts `qa-*.mjs`/`qa/*.mjs`, `qa/out/*` nếu có, `ma-giam-gia`, `FarmListView`, voucher views (thay đổi ngoài phạm vi A1–A6 từ phiên trước — cần chủ dự án quyết định giữ hay bỏ trước khi đưa lên GitHub).
- **Nên commit (sau duyệt):** 6 service API (inventory/orders/payments/shipments/promotions/certificates) + 5 test API + `certificate-validity.spec.ts` + Admin (4 pages + types) + Customer (FarmCertificates/resources/types/TraceDetail) + Mobile types + 5 báo cáo docs.
- Không reset/clean/stash/commit/push trong nhiệm vụ.

---

## 9. Release readiness verdict

- **SẴN SÀNG DEMO/BẢO VỆ PHẦN NGHIỆP VỤ ĐÃ NGHIỆM THU** với bằng chứng TEST DB đầy đủ (unit 386 + 40 + 174, e2e 331, builds xanh).
- **KHÔNG 100%:** còn P2 (Customer test runner, phiên máy thật/browser thật/SMTP thật) và dữ liệu DEV lịch sử chờ duyệt — phải nêu rõ khi bảo vệ, không che.
- Blocker duy nhất cho demo thật: thiết bị vật lý + SMTP nếu kịch bản demo cần.
