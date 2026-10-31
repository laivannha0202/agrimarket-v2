# 25 — Full System Business/Invoice Final Acceptance

> Báo cáo này thay thế toàn bộ nội dung cũ. Mọi con số PASS/FAIL dưới đây là kết quả
> chạy lại trong phiên này trên máy local, database test `agrimarket_v2_test`
> (`TEST_DATABASE_URL`), không dùng lại số liệu của phiên trước.

## A. Thông tin mã nguồn

- Repository: https://github.com/laivannha0202/agrimarket-v2
- Branch: `main`
- Commit gốc: `3ae8d6c` (chore: push all local changes)
- Commit sau sửa: commit local `feat(finance,pdf,admin,mobile): close settlement
  races, PDF defects and mobile bundle` — **chưa push** (xem mục L; lấy hash bằng
  `git log -1`)
- Migrations mới: **không** — các ràng buộc đã có từ trước
  (`settlement_lines.partner_order_id` UNIQUE, `settlements.code` UNIQUE) được dùng
  làm chốt cuối, không thêm migration.
- Phạm vi thay đổi: 30 file sửa + 19 file mới (`git diff --stat 3ae8d6c`: 49 file,
  5.389 dòng thêm, 539 dòng bớt).

## B. Lỗi P0/P1 đã sửa

### B.1 P0 — Tài chính: settlement có thể trả tiền cho đơn chưa thu, và race với refund

| ID | File | Mô tả | Sửa |
|---|---|---|---|
| P0-S1 | `apps/api/src/finance/settlements.service.ts` | `create()` đọc refund và ghi settlement line trong hai bước không khoá. Refund hoàn tất đúng vào khoảng giữa hai bước thì **không được trừ ở line** (đã đọc refund table trước đó) và **cũng không sinh adjustment** (reconcile chạy trước khi line tồn tại) → đối tác được trả thừa, refund "biến mất". | Toàn bộ `create()` chạy trong **một transaction `ReadCommitted`**: chọn partner order → `SELECT id FROM payments WHERE order_id IN (...) ORDER BY id FOR UPDATE` → **đọc refund sau khi đã khoá** → tính line/tổng → tạo settlement + lines. `completeRefund` khoá cùng payment row, nên hai thao tác tuần tự hoá: refund xong trước ⇒ trừ vào line; settlement xong trước ⇒ refund thấy line và mở adjustment. |
| P0-S2 | `apps/api/src/finance/settlements.service.ts` | Hai `create()` đồng thời có thể cùng đọc một tập order chưa claim (lọc `settlementLines: { none: {} }` chỉ đúng nếu không ai ghi ở giữa). | Unique index `settlement_lines.partner_order_id` + map `P2002` → 409; vòng retry mã `SET-` có giới hạn `CODE_ATTEMPTS`. Test 2 và 10 request đồng thời xác nhận mỗi order chỉ bị claim một lần. |
| P0-S3 | `apps/api/src/finance/settlements.service.ts` | Không có chặn "kỳ không có đơn đủ điều kiện": một create đến sau khi create khác vừa commit sẽ tạo settlement DRAFT rỗng thứ hai. | Trả `400 No delivered, paid partner orders are eligible for this settlement period`, không ghi row nào. |
| P0-S4 | `apps/api/src/orders/orders.service.ts` | `GET /orders/:id` (ADMIN) không trả trail tài chính nội bộ (settlement line, payout, adjustment) nên Admin không đối soát được. | Thêm `adminOrderInclude` + `findOneForAdmin()`: customer, partnerOrders (partner, items + variant + allocations/lots, shipments + events, fulfillments), settlementLines (kèm settlement + payouts), settlementAdjustments, payments + refunds, voucherRedemptions. |

### B.2 P0 — PDF: sai số trang, mất logo, sai định dạng ngày

| ID | File | Mô tả | Sửa |
|---|---|---|---|
| P0-P1 | `apps/api/src/orders/order-document.service.ts` | Footer vẽ ở `y = 811.89`, **dưới `page.maxY()` (801.89)**. PDFKit coi đó là tràn trang và **tự thêm một trang trắng cho mỗi dòng footer**. Đơn 4 trang in ra **16 trang**, từ trang 5 trở đi không có số trang. | `inBottomMargin()` tạm hạ `page.margins.bottom = 0` trong lúc vẽ footer rồi khôi phục. Test đơn 70 dòng xác nhận số trang thật và `Trang 1/n … Trang n/n`. |
| P0-P2 | `apps/api/src/orders/order-document.service.ts` | `logoPath()` resolve `../orders/order-document.service.js` — không tồn tại khi chạy từ source (vitest/tsx) ⇒ PDF rơi về chữ "AgriMarket", không có logo. | Dùng `fileURLToPath(import.meta.url)`: `src/orders` → `api/assets`, `dist/src/orders` → `dist/assets`. Test đọc bytes PDF và bắt buộc có `/Subtype /Image`, `/Width 512`, `/Height 512`. |
| P0-P3 | `apps/api/src/orders/order-document.service.ts` | `toLocaleString('vi-VN')` in `10:00:00 1/10/2026` — ngày không có số 0 đứng đầu, giờ đứng trước ngày. | `vnDateTime()` format tường minh `dd/MM/yyyy HH:mm` theo `Asia/Ho_Chi_Minh`, dùng cho ngày đặt, ngày xuất và footer. |

### B.3 P1 — Admin order detail

| ID | File | Mô tả | Sửa |
|---|---|---|---|
| P1-A1 | `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx` | Trang cũ dồn mọi bảng vào một cột, đơn nhiều đối tác không đọc được, không thấy settlement/payout. | Viết lại: header + 4 thẻ tiền (Tổng thanh toán / Đã thu / Còn phải thu / Đã hoàn tiền) + 5 tab `Tổng quan · Sản phẩm (n đối tác) · Thanh toán · Vận chuyển · Tài chính nội bộ`. Không tính lại giá; chỉ cộng các row payment/refund đã lưu và ghi rõ nhãn. |
| P1-A2 | `apps/admin-web/src/components/orders/OrderDetailTabs.tsx` (mới) | — | `OrderItemsTab` nhóm theo đối tác (STT, sản phẩm + SKU, ĐVT, SL, đơn giá, thành tiền); `OrderPaymentTab` tổng hợp + lịch sử payment + link refund; `OrderShippingTab` vận đơn, timeline sự kiện, fulfillment; `OrderFinanceTab` hoa hồng/phải trả, settlement, payout, adjustment; `SectionEmpty` cho trạng thái rỗng. |
| P1-A3 | `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx` | Không có thao tác ghi nhận thu tiền COD đúng nghiệp vụ. | Modal "Thu tiền COD" bắt buộc `transactionReference`; gọi `PATCH /payments/:id/status` — chỉ hành động này đánh dấu PAID (chuyển đơn sang DELIVERED không thu tiền). |
| P1-A4 | `apps/admin-web/src/components/common/InfoDescriptions.tsx` | `resolveColumn()` lấy **giá trị đầu tiên** của map responsive (`{xs:1,sm:2}` → 1) nên chuẩn hoá span theo 1 cột trong khi antd render 2; trên mobile item `span:2` vượt `column:1` → antd cảnh báo và tự cắt span, layout bị nén. | `useActiveColumn()` dùng `Grid.useBreakpoint()` để lấy đúng số cột đang render; khi còn 1 cột thì hạ `span` về 1. Hết warning `[antd: Descriptions]`. |
| P1-A5 | `apps/admin-web/src/components/layout/AdminShell.tsx`, `globals.css` | Ở viewport 390px trang **scroll ngang 92px**: nhóm Tag "Quản trị viên" + họ tên rộng 317px, cộng nút thu gọn và padding vượt 390px; thêm nữa cột nội dung là flex item `min-width:auto`. | `min-width: 0` cho `.agri-main`/`.agri-content`; ẩn Tag vai trò và họ tên dưới 576px (chỉ còn avatar). Test small khẳng định `scrollWidth - clientWidth ≤ 1` và 4 thẻ tiền xếp 2×2. |
| P1-A6 | `apps/admin-web/src/app/login/page.tsx`, `AdminShell.tsx`, `public/design/brand/leaf_mark_512.png` | Logo là emoji `🌿`, không phải brand mark chính thức. | Dùng `next/image` với `leaf_mark_512.png` (sha256 trùng bản Customer/Mobile/API), thêm `.agri-brand-logo`. |

### B.4 P1 — Seed không chạy lại được (chặn browser E2E)

| ID | File | Mô tả | Sửa |
|---|---|---|---|
| P1-S1 | `apps/api/prisma/seed.ts` | `wipe()` xoá `warehouse` trước `quarantine_cases` ⇒ `P2003` (FK `warehouse_id`) trên bất kỳ DB nào đã có case cách ly; sau đó còn `user` bị chặn bởi `password_reset_tokens`, `app_idempotency_keys`, `checkout_idempotency_keys`, `evidence_images`. Seed được quảng cáo là chạy lại được nhưng thực tế fail sau khi chạy E2E. | Xoá `quarantineCase` đầu tiên; thêm `passwordResetToken`, `appIdempotencyKey`, `checkoutIdempotencyKey`, `evidenceImage` trước các bảng cha. Đã chạy `prisma db seed` lại thành công trên `agrimarket_v2_test`. |

### B.5 P0 — Mobile không bundle được

| ID | File | Mô tả | Sửa |
|---|---|---|---|
| P0-M1 | `apps/mobile/metro.config.js` (mới), `apps/mobile/package.json` | `expo export --platform android` **thất bại hoàn toàn**: `Unable to resolve module @agrimarket/shared-domain/home`. Nguyên nhân: app là workspace nhưng không có Metro config monorepo (`watchFolders`, `nodeModulesPaths`) và không khai báo `@agrimarket/shared-domain`, `@agrimarket/design-tokens` trong dependencies. | Thêm Metro config theo hướng dẫn Expo monorepo + `extraNodeModules` trỏ về `packages/*/src`; khai báo 2 workspace package trong `apps/mobile/package.json`. Bundle Android 3.8 MB build thành công, có chuỗi `agrimarket-order` của card PDF mới. |

### B.6 P2 — Build `dist` và script kiểm chứng

| ID | File | Mô tả | Sửa |
|---|---|---|---|
| P2-D1 | `apps/api/nest-cli.json` | `outDir: "dist/assets"` + `include: "../assets/**/*"` khiến Nest copy thành `dist/assets/assets/brand/leaf_mark_512.png`; `logoPath()` tìm `dist/assets/brand/...` nên **bản build production rơi về chữ thay vì logo** khi tiến trình không chạy với cwd = `apps/api`. | Đổi `outDir` thành `"dist"` → asset nằm đúng `dist/assets/brand/`. Đã render PDF từ chính `dist/src/orders/order-document.service.js`: 45 KB, có `/Subtype /Image`, `/Width 512`, 1 trang. |
| P2-D2 | `scripts/db-invariant-audit.mjs` | Check `partner_order_total_mismatch` bắt buộc `Σ partner_orders.discount_total = orders.discount_total`, nhưng voucher là **platform-funded** (`orders.service.ts`: "Voucher (platform-funded; does not reduce seller commission base)") nên `orders.discount_total` = voucher, còn partner order giữ discount 0. Script báo sai một đơn voucher hợp lệ (ORD-20261031-1245: 312.000 − 50.000). | So sánh `Σ partner_discount + Σ voucher_redemptions.discount_amount = orders.discount_total` (derived table, không nhân dòng). Sau sửa: **50/50 check PASS**, 0 vi phạm. |

## C. Chức năng đã hoàn thiện

1. **PDF phía server** (`OrderDocumentService`) cho phiếu xác nhận đơn và phiếu soạn hàng:
   logo chính thức, font DejaVu (tiếng Việt có dấu), bảng sản phẩm nhóm theo đối tác,
   tổng tiền từ snapshot, voucher chỉ ghi "đã tính trong Giảm giá" (không trừ lần hai),
   đã thu / đã hoàn (chỉ refund `COMPLETED`) / thực thu sau hoàn, footer số trang + giờ xuất.
2. **API**: `GET /orders/:id/pdf` (ADMIN | CUSTOMER, customer chỉ đơn của mình),
   `GET /orders/:id/packing-slip` (ADMIN), trả `application/pdf` + `Content-Disposition`.
3. **Admin**: redesign trang chi tiết đơn, xem trước PDF bằng blob (không phải HTML),
   in, tải; thu tiền COD; chuyển trạng thái theo state machine; loading/error/empty/permission.
4. **Customer Web**: thẻ "Phiếu đơn hàng" — Xem phiếu (modal iframe PDF thật), In, Tải PDF;
   token gửi qua header, không lên URL.
5. **Mobile**: `OrderPdfCard` — tải PDF bằng `expo-file-system` (`File.downloadFileAsync`,
   header Authorization), kiểm tra magic `%PDF-`, mở share sheet bằng `expo-sharing`
   (Android/iOS), nhánh web dùng blob URL; có trạng thái bận/lỗi.
6. **Test hạ tầng**: Playwright 3 project + 2 setup đăng nhập thật, cache token API để
   không vượt rate-limit `/auth/login`.

## D. Settlement/payout — ma trận kiểm thử đồng thời

File: `apps/api/test/concurrency-settlement-payout.e2e-spec.ts` (mới, 15 test, chạy trên
`TEST_DATABASE_URL`, mỗi test lặp `CONCURRENCY_ROUNDS` mặc định 3 vòng).

| Yêu cầu | Test | Kết quả |
|---|---|---|
| 2 settlement đồng thời | `two concurrent creates never claim the same partner order twice` | PASS — 1 settlement, mỗi order đúng 1 line, tổng 60.000 |
| 10 settlement đồng thời | `ten concurrent creates: exactly one statement, every order claimed once` | PASS |
| Không có đơn đủ điều kiện | `rejects a settlement with no delivered, collected order` | PASS — 400, 0 row |
| 2 payout đồng thời | `two concurrent full-size payouts: one row, never above payable` | PASS |
| 10 payout đồng thời | `ten concurrent full-size payouts: one row, the rest refused, sum = payable` | PASS |
| 10 payout một phần | `ten concurrent partial payouts all land and sum exactly to payable` | PASS — 10 row, 10 mã, tổng = payable |
| Payout khi settlement DRAFT | `a payout is refused when the settlement is still DRAFT` | PASS |
| Settlement ‖ refund | `a refund completing while the settlement is created is counted exactly once` | PASS — `deducted + reconciled = 10.000` |
| Refund sau settlement | `a refund completing after the settlement never rewrites it, only opens an adjustment` | PASS — header `updatedAt` không đổi, đúng 1 adjustment OPEN |
| Hoàn một phần trước settlement | `a partial refund before settlement is deducted from the line` | PASS — line refund 10.000, payable 20.000, không adjustment |
| Hoàn toàn phần trước settlement | `a full refund before settlement settles at zero payable` | PASS — payable 0, payment REFUNDED |
| PAID thiếu `paidAt` | `a PAID status without paidAt is not treated as collected money` | PASS |
| Payout ‖ recovery | `a payout racing a recovery record never pays while the recovery is unresolved` | PASS |
| Retry sau timeout | `a client timeout and retry produce exactly one payout` | PASS — 1 row |
| Trùng transaction reference (COD) | `ten concurrent COD confirmations with the same reference book the money once` | PASS — payment PAID 1 lần, 1 audit `PAYMENT_PAID`, 1 payment row, settlement claim đúng 1 lần 30.000 |

Bất biến được kiểm tra bằng truy vấn DB sau mỗi test (không chỉ HTTP status):
số row `settlements` / `settlement_lines` / `payouts` / `payments` / `refunds` / audit,
tổng tiền, trạng thái cuối, `settlement_lines.partner_order_id` không lặp,
`settlements.code` không lặp, header settlement không bị ghi lại sau khi đã chốt.

Bộ cũ `apps/api/test/concurrency-money.e2e-spec.ts` (22 test: refund, return, stock,
payout) vẫn PASS; assertion "loser" của settlement create được nới từ `409` sang
`400 | 409` vì loser chạy sau khi winner commit giờ rơi vào guard "không còn đơn đủ
điều kiện" (400) — đây là hành vi đúng, không phải nới lỏng để che lỗi.

## E. Admin order detail — thiết kế lại

- Cấu trúc: Header (mã đơn, thời gian, trạng thái, hành động) → 4 thẻ tiền → Tabs.
- Tab **Tổng quan**: khách hàng & giao nhận, giá trị đơn, voucher, ghi chú.
- Tab **Sản phẩm**: mỗi đối tác một card, bảng sản phẩm + SKU + ĐVT + SL + đơn giá + thành tiền.
- Tab **Thanh toán**: tổng phải thu / đã thu / còn phải thu / đã hoàn, cảnh báo COD chưa thu,
  lịch sử payment, danh sách refund (link sang `/refunds?paymentId=…`).
- Tab **Vận chuyển**: vận đơn theo đối tác, carrier/tracking/trạng thái/mốc thời gian,
  timeline sự kiện, bảng fulfillment, alert khi giao thất bại.
- Tab **Tài chính nội bộ**: hoa hồng, phải trả, settlement (mã, trạng thái, payable,
  refund, adjustment, ngày chốt), payout, adjustment; empty state khi chưa quyết toán.
- Trạng thái: loading (skeleton của `DetailPage`), error + "Thử lại" (đã test 500),
  empty (đã test đơn chưa có vận đơn/quyết toán), permission (nút chuyển trạng thái
  chỉ bật cho `ADMIN`).
- Không đổi nghiệp vụ: mọi số tiền đọc từ `order.grandTotal/subtotal/discountTotal/
  shippingFee` và các row payment/refund đã lưu.

## F. PDF — kết quả kiểm chứng thật

`apps/api/test/business-rules/order-documents.spec.ts`: **12/12 PASS**, đọc lại bytes PDF
(không kiểm tra code):

| Case | Nội dung kiểm tra |
|---|---|
| Logo | `/Subtype /Image`, `/Width 512`, `/Height 512` |
| 1 sản phẩm | tên, SKU, ĐVT, SL, đơn giá, thành tiền |
| Nhiều sản phẩm / nhiều đối tác | nhóm "Đối tác:", đủ 4 dòng, tổng 450.000 |
| Voucher | `Voucher #9` + "đã tính trong Giảm giá"; `-100.000` xuất hiện **đúng 1 lần**; tổng 120.000 |
| COD chưa thu | "Chưa thu tiền", "Còn phải thanh toán", không in "Đã thanh toán 120.000" |
| Hoàn một phần | đã thu 120.000, hoàn 20.000 (COMPLETED), **không** in 30.000 (PENDING), thực thu 100.000 |
| Hoàn toàn phần | thực thu 0 ₫ |
| Đơn dài 70 dòng | ≥ 2 trang, header bảng lặp lại, `Trang 1/n` … `Trang n/n` (n = số trang thật) |
| Snapshot là object | không có `[object Object]`, in `—` |
| Ngày xuất | `Ngày đặt: 01/10/2026 10:00`, `Ngày xuất: 31/10/2026 17:00`, footer `Xuất lúc 31/10/2026 17:00` (fake timer, timezone VN) |

Preview trên Admin/Customer là **chính bytes PDF** do API trả (blob URL từ fetch có
`Authorization`), không phải một trang HTML dựng riêng — đã kiểm tra `src` bắt đầu bằng
`blob:` và response `content-type: application/pdf` trong Playwright.

## G. Mobile PDF — trạng thái

- Đã làm: `OrderPdfCard` trong `apps/mobile/src/components/OrderPdfCard.tsx`, render ngay
  sau thẻ tổng quan ở `app/order/[id].tsx`.
- Native: `File.downloadFileAsync(url, Paths.cache/agrimarket-order-<id>.pdf, { headers, idempotent: true })`
  → kiểm tra 5 byte đầu `%PDF-` → `Sharing.isAvailableAsync()` → `Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })`.
  Đây là đường "mở" đúng trên Expo Go: Expo Go không có PDF viewer nhúng, share sheet
  mới là nơi Android mở app đọc PDF và iOS "Open in…/Save to Files".
- Web: blob URL + `window.open`/download (không dùng `expo-sharing` trên web).
- Bảo mật: JWT chỉ nằm trong header `Authorization`, không xuất hiện trong URL/log;
  quyền sở hữu do API quyết định (`CUSTOMER` chỉ đọc đơn của mình, đơn người khác 404).
- Phụ thuộc: `expo-sharing@57.0.24`, `expo-file-system@57.0.7` — module thuộc Expo SDK 57,
  do `expo install` chọn phiên bản; **không** thêm native module tự viết.
- **Chưa kiểm chứng**: chưa bấm thử trên máy thật/emulator (không có thiết bị trong môi
  trường này). Đã kiểm chứng: TypeScript PASS, Android bundle PASS, code path có trong bundle.

## H. Browser E2E (Playwright, local)

Cấu hình: `playwright.config.ts`, 3 web server thật (API 3000 dùng `TEST_DATABASE_URL`,
Admin 3001, Customer 3002), Chromium 1248, `workers: 1`.

| Project | Nội dung | Kết quả |
|---|---|---|
| `admin-setup` / `customer-setup` | đăng nhập thật bằng form, lưu storage state | 2/2 PASS |
| `admin-desktop` (1440×900) | 5 tab + không có `[object Object]`; preview order/packing slip (blob iframe, `application/pdf`); tải PDF kiểm tra `%PDF-`; chặn 500 → "Không tải được đơn hàng." + "Thử lại"; chặn 403 PDF → toast, không mở modal; menu chuyển trạng thái; đối chiếu số tiền hiển thị với `grandTotal`/`subtotal` của API | 4/4 PASS |
| `admin-small` (390×844) | heading, 4 thẻ tiền xếp 2×2, không scroll ngang (≤1px), 5 tab hiển thị; preview/tải PDF; error state; state machine | 4/4 PASS |
| `customer` (1366×900) | đặt COD qua `/thanh-toan?mua-ngay=…`, chi tiết đơn, xem/tải PDF, không lộ "Hoa hồng"/"Quyết toán"; đơn người khác 404, không token 401; voucher hiển thị 1 lần và tổng = snapshot; hoàn một phần hiển thị "Hoàn một phần"/"Hoàn tiền"/10.000 ₫ | 4/4 PASS |

**Tổng: 14 passed / 0 failed / 0 skipped** (~1,2 phút).

Ghi chú: lần chạy đầu phát hiện 3 lỗi thật và đã sửa — (1) CORS chỉ cho `localhost`
nên E2E dùng `127.0.0.1` bị chặn đăng nhập; (2) trang admin scroll ngang 92px ở 390px;
(3) API rate-limit login 10/phút khiến harness tự gây 429 (đã cache token + đăng nhập
một lần/role). Không có test nào bị bỏ qua để "cho xanh".

**Chạy lại trên HEAD cuối (`3f12a02`, sau khi nâng SDK 58): 14/14 PASS** (1,4 phút,
Chromium, API + Admin + Customer thật trên schema `agrimarket_v2_test`). Lần chạy đầu
FAIL 11/14 vì một lỗi thật của harness, không phải của sản phẩm: `e2e/support/api.ts`
cache bearer token trong `e2e/.auth/api-tokens.json` **qua các lần chạy**, trong khi
global setup seed lại DB nên id user đổi — token còn hạn nhưng trỏ tới user không còn
tồn tại, mọi call trả `401 "Invalid token"`. Đã sửa: `e2e/global-setup.ts` xoá cache
token ngay sau khi seed (token không thể sống qua một lần re-seed). Không sửa assertion,
không skip test nào; lần chạy lại 14/14 PASS.

## I. Đồng bộ liên hệ thống

| Trường | API (snapshot) | Admin | Customer | Mobile | PDF |
|---|---|---|---|---|---|
| Mã đơn | `order.code` | header | header | header | header |
| Đơn giá / SL / thành tiền | `order_items` snapshot | tab Sản phẩm | chi tiết | chi tiết | bảng sản phẩm |
| Voucher | `discountTotal` (đã gồm voucher) | "đã tính trong Giảm giá" | "đã tính trong Giảm giá" | "đã tính trong Giảm giá" | "đã tính trong Giảm giá", không trừ lần 2 |
| Phí giao hàng | `shippingFee` | tab Tổng quan | chi tiết | chi tiết | bảng tổng |
| Tổng thanh toán | `grandTotal` | thẻ "Tổng thanh toán" + test đối chiếu API | test đối chiếu `grandTotal` | hiển thị snapshot | `TỔNG THANH TOÁN` |
| Trạng thái thanh toán | `payments.status` | badge + tab Thanh toán | PaymentCard | PaymentCard | "Đã thu"/"Chưa thu tiền" |
| Hoàn tiền | `refunds` (chỉ COMPLETED) | tab Thanh toán/Tài chính | "Hoàn một phần" | "Hoàn một phần" | "Đã hoàn tiền"/"Thực thu" |
| Trạng thái đơn / vận đơn | `status`, `shipments` | StatusTag, tab Vận chuyển | timeline | timeline | "Trạng thái:" |

Không màn hình nào tự tính lại tổng từ giá hiện tại của sản phẩm; mọi nơi đọc snapshot
hoặc các row payment/refund đã lưu.

## J. Kết quả kiểm thử thực tế (chạy lại trong phiên này)

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| API typecheck | `npm run typecheck --workspace @agrimarket/api` | **PASS** |
| API unit | `npm test --workspace @agrimarket/api` | **592/592 PASS (44 file)** |
| API E2E | `npx vitest run --config ./vitest.config.e2e.ts` (trong `apps/api`) | **484/484 PASS (22 file)** |
| Đồng thời settlement/payout | `test/concurrency-settlement-payout.e2e-spec.ts` | **15/15 PASS** (nằm trong 484 ở trên) |
| Đồng thời tiền/kho (cũ) | `test/concurrency-money.e2e-spec.ts` | **22/22 PASS** (nằm trong 484 ở trên) |
| Admin typecheck | `npm run typecheck --workspace @agrimarket/admin-web` | **PASS** |
| Admin production build | `npm run build --workspace @agrimarket/admin-web` | **PASS** |
| Customer typecheck | `npm run typecheck --workspace @agrimarket/customer-web` | **PASS** |
| Customer production build | `npm run build --workspace @agrimarket/customer-web` | **PASS** |
| Mobile typecheck | `npm run typecheck --workspace @agrimarket/mobile` | **PASS** |
| Mobile Android bundle | `npx expo export --platform android` | **PASS** — 3.8 MB Hermes, ảnh/asset đầy đủ |
| Browser E2E | `npx playwright test` | **14 passed / 0 failed / 0 skipped** |
| Seed chạy lại | `DATABASE_URL=<test> npx prisma db seed` | **PASS** (sau khi sửa wipe) |
| Bất biến DB | `node scripts/db-invariant-audit.mjs --url <test>` | **PASS — 50/50 check, 0 vi phạm** |
| Business smoke (API build + schema test) | `node scripts/business-smoke.mjs --url <test>` | **PASS — 73/73 check**, exit 0 |
| Security scan | `node scripts/security-scan.mjs` | **FAIL một phần** — xem mục K.6 |
| PDF từ bản build `dist` | render trực tiếp `dist/src/orders/order-document.service.js` | **PASS** — 45 KB, logo 512×512, 1 trang |
| Migration verification | `node scripts/verify-migrations.mjs --url <test>` | **FAIL** trên schema test tái sử dụng; **PASS 14/14** trên schema mới `migrate deploy` — xem K.7 |

### J.1 Gate một lệnh trên HEAD cuối cùng — `npm run verify:local`

Chạy trên HEAD `3f12a02` (sau khi nâng Expo SDK 58), schema dùng một lần
`agrimarket_v2_c19_20261031t203538z01up_test` (drop sau khi chạy), DB ứng dụng
`agrimarket_v2` không bị ghi. **PASS — 20/20 bước, 0 failed, 0 skipped**
(evidence: `.tmp-verify/c19/local-20261031t203538z01up/` gồm `summary.json`,
`manifest.json`, `SHA256SUMS.txt` và log từng bước).

| Bước | Kết quả | Chi tiết |
|---|---|---|
| preflight | PASS | 16 check; MySQL 8.0.46; 14 migration; Playwright có sẵn |
| generate / typecheck / lint | PASS | Prisma client; typecheck 5 workspace; lint toàn bộ |
| unit | PASS | **917 passed / 3 skipped** — admin 48, API 592, customer 37, mobile 175 (+3 skip test gọi API live), shared-domain 65 |
| build | PASS | API + Admin + Customer |
| db-create / migrate / seed / locations | PASS | 14 migration; seed 6 user, 14 sản phẩm, 18 lô, 6 đơn; 1 tỉnh + 104 xã |
| migrations | PASS | 14 migration, checksum khớp, drift exit 0 |
| invariants | PASS | **50/50** check; trace coverage 18 lô |
| backup | PASS | 56 bảng / 464 dòng; dump 22.531 byte, sha256 khớp, bản restore trùng |
| api-e2e | PASS | **484/484** (22 file) |
| stress | PASS | **53/53** với `CONCURRENCY_ROUNDS=10` (settlement/payout + money/stock) |
| business-smoke | PASS | **72/72** HTTP/business check, 0 warning |
| invariants-final | PASS | **50/50** sau khi chạy toàn bộ E2E |
| security | PASS | 9 check + `npm audit`, 0 secret finding |
| ui-smoke | PASS | 64 route/asset check |
| cleanup | PASS | đã drop schema test |

Không có test nào bị sửa assertion để "qua" — hai chỗ thay đổi có chủ đích:
(1) test "empty period" nay kỳ vọng 400 thay vì tạo settlement rỗng (hành vi mới đúng);
(2) test "loser" của settlement create chấp nhận 400 hoặc 409 vì loser có thể chạy sau
khi winner commit.

## K. Phần chưa kiểm chứng / phụ thuộc ngoài

1. **Mobile trên thiết bị thật**: chưa chạy Expo Go trên máy thật/emulator; chưa xác nhận
   trực quan share sheet Android/iOS. Đã có: typecheck, bundle Android, code path trong bundle.
2. **iOS**: cùng API `expo-sharing`, chưa chạy trên iOS.
3. **Đọc PDF bằng mắt**: kiểm chứng bằng bytes + text extraction + số trang; chưa có
   đánh giá thẩm mỹ bởi người dùng.
4. **Môi trường**: toàn bộ test chạy local, DB `agrimarket_v2_test`; chưa chạy staging/UAT,
   chưa có tải thật, chưa có gateway thanh toán (VNPAY/MOCK_ONLINE vẫn bị khoá bởi
   `PAYMENTS_ONLINE_ENABLED=false`).
5. **Playwright**: cần `npx playwright install chromium` trên máy mới; E2E yêu cầu
   `TEST_DATABASE_URL` kết thúc bằng `_test` (global setup từ chối DB khác).
6. **Security scan — advisory có sẵn trong mobile (không do phiên này)**: gate
   `production-dependency-audit:mobile` FAIL với 3 mục high (`decode-uri-component`,
   `query-string`, `expo-router`). Chuỗi: `expo-router@57.0.27` → `query-string@7.1.3`
   → `decode-uri-component@0.2.2` (GHSA-qr28-fpjm-wq7f — DoS khi decode chuỗi
   percent-encoded dị dạng). Phiên bản trong `package-lock.json` **trước và sau** phiên
   này giống nhau, nên đây là rủi ro có sẵn, không phải hồi quy. Bản vá
   `decode-uri-component@0.5.1` là **ESM-only**, không thể override vào `query-string@7`
   (CJS) mà không phá runtime; `expo-router` được vá từ 58.0.13 (SDK 58). Vì vậy không
   sửa trong phiên này — cần nâng Expo SDK 58 ở một thay đổi riêng, có test lại bundle.
   **Đã xử lý ở phiên sau — xem `26-EXPO-SDK-58-SECURITY-UPGRADE.md`** (mobile nay
   0 high/critical, security scan PASS).
   `api`, `admin-web`, `customer-web`: **0 high/critical**; guardrail repo (env file,
   private key, secret pattern, CORS fail-closed) đều PASS.
7. **Migration verification — drift có sẵn trên schema test tái sử dụng**: `verify-migrations`
   trên `agrimarket_v2_test` báo 4 migration có checksum trong `_prisma_migrations` khác SHA-256 của file
   (`20261019000000_settlement_line_unique_partner_order`, `20261022000000_app_idempotency_keys`,
   `20261023000000_p0b_integrity_quarantine_refunds`, `20261024000000_order_reservation_expiry`)
   và schema test có thêm index trên `return_requests(refund_id)` so với lịch sử migration.
   **Không file migration nào bị sửa trong phiên này** (`git status apps/api/prisma/migrations`
   trống; file được commit từ `5b35b97`), nên đây là trạng thái có sẵn của schema test
   (nhiều khả năng do `db push`/sửa migration sau khi apply ở phiên trước).
   Đã chứng minh **lịch sử migration trong repo là đúng**: tạo schema trống
   `agrimarket_v2_drill_verify`, chạy `prisma migrate deploy` (14/14 migration), rồi
   `verify-migrations` → **PASS toàn bộ 14 check** (checksum khớp, không drift, đủ bảng/enum/FK
   C-08 và C-14). Schema drill đã được xoá sau khi kiểm tra. Việc còn lại chỉ là
   `prisma migrate reset` schema test dùng-một-lần (thao tác phá huỷ dữ liệu nên cần
   người dùng xác nhận) nếu muốn schema test hết drift.

## L. Git

- `git status`: 30 file sửa + 19 file mới (xem A); không có file test PDF, ảnh chụp,
  `test-results/`, `e2e/.auth/` (đã thêm vào `.gitignore` — chứa JWT), `node_modules`.
- `git diff --check`: sạch (chỉ còn cảnh báo LF→CRLF của Git trên Windows).
- Asset cần cho PDF: `apps/api/assets/brand/leaf_mark_512.png` (đã thêm) + bản Admin
  `apps/admin-web/public/design/brand/leaf_mark_512.png`; `nest-cli.json` copy asset vào
  `dist/assets` khi build.
- Không có secret mới: `.env.example` chỉ thêm biến cấu hình; mật khẩu trong `e2e/support/api.ts`
  là tài khoản seed công khai, không phải secret thật.
- Đã tạo **commit local**, không push/merge/deploy.
- Trạng thái sau cùng: commit `3f12a02` (nâng SDK 58) và một commit cuối chỉ chứa
  `e2e/global-setup.ts` (xoá cache token sau khi seed) + cập nhật báo cáo 25/26 —
  không có thay đổi mã sản phẩm. Working tree sạch tại `HEAD` (`git status` trống,
  `git diff --check` sạch).

## M. Kết luận GO/NO-GO

**GO cho phạm vi đã kiểm chứng** — với các bằng chứng nêu trên:

- P0 settlement/payout: 15 test đồng thời thật (2 và 10 request, refund/recovery/retry/
  trùng reference/hoàn một phần/hoàn toàn phần) đều PASS, kèm kiểm tra row count, tổng tiền,
  trạng thái cuối và bất biến DB.
- PDF: 12 test đọc bytes thật (logo, đa sản phẩm, đa đối tác, voucher, COD chưa thu,
  hoàn một phần/toàn phần, đơn nhiều trang, ngày xuất, không `[object Object]`).
- Admin order detail: redesign đủ 5 tab, loading/error/empty/permission, responsive
  390px không scroll ngang — kiểm chứng bằng browser thật ở cả 2 viewport.
- Browser E2E: 14/14 PASS trên API + Admin + Customer thật, DB test — chạy lại lần cuối
  trên HEAD sau khi nâng SDK 58 (sau khi sửa cache token của harness, mục H).
- Mobile: PDF card đã tích hợp, typecheck + Android bundle PASS.
- Bất biến DB: 50/50 check PASS trên schema test sau khi chạy toàn bộ E2E
  (không có đơn/refund/settlement/payout/tồn kho nào sai công thức).
- Business smoke trên API đã build: 72/72 check PASS (catalog, trace, settlement reads,
  checkout COD + idempotent replay + cancel, đồng bộ Admin/Customer, OpenAPI mobile).
- Gate một lệnh `npm run verify:local` trên HEAD `3f12a02`: **PASS 20/20** (917 unit,
  484 API E2E, 53 stress, 72 business smoke, 50×2 bất biến, security PASS) — mục J.1.

**NO-GO cho các điểm sau** (không tuyên bố production-ready):

- Chưa kiểm chứng mobile trên thiết bị thật (share sheet, quyền truy cập file).
- Chưa chạy staging/UAT, chưa có kiểm thử tải, chưa tích hợp cổng thanh toán thật.
- Chưa có đánh giá thẩm mỹ PDF/UI bởi người dùng cuối.
- ~~Security gate mobile còn 3 advisory high **có sẵn** trong `expo-router` →
  `query-string` → `decode-uri-component`~~ — **đã đóng**: nâng Expo SDK 58, xem
  báo cáo 26.

Nói cách khác: hệ thống đã **sẵn sàng cho UAT local** với đầy đủ bằng chứng tự động,
nhưng **chưa đủ căn cứ để tuyên bố production GO** khi thiếu kiểm chứng thiết bị thật
và môi trường staging.
