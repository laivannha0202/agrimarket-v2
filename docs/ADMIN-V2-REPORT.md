# AgriMarket V2 — Admin hoàn thiện CRUD, biểu đồ Dashboard & dọn ghi chú thừa

Báo cáo cuối cùng. Ngày: 2026-10-09. Phạm vi: `apps/api` + `apps/admin-web` (Mobile không đụng; `apps/customer-web` chỉ chạy kiểm tra hồi quy).

---

## 1. Ma trận theo từng trang (Route → Data → Actions → Permissions → Điều kiện nghiệp vụ → API → Test)

Trạng thái: **PASS** = đã có sẵn và kiểm chứng; **FIXED** = đã sửa/bổ sung trong đợt này; **BLOCKED** = không làm được (lý do).

| # | Route | Data (nguồn) | Actions | Quyền | Điều kiện nghiệp vụ | API | Test |
|---|-------|--------------|---------|-------|---------------------|-----|------|
| 1 | `/login` | `POST /auth/login`, `GET /auth/me` | Đăng nhập; chặn non-ADMIN | công khai → ADMIN | `isAdmin` kiểm tra cả 2 phía | `auth` | FIXED (bỏ intro chung) |
| 2 | `/dashboard` | `GET /reports/summary` + `GET /reports/daily` + `GET /orders?limit=8` | Xem KPI, đổi 7/30 ngày, xem đơn gần đây, đi tới hàng đợi việc | ADMIN | Chỉ số tính trên toàn bộ dữ liệu (không cắt 100); doanh thu = tiền thực thu `netCollected`; đơn = số đơn; có công nợ/hoàn tiền/hoa hồng | `reports`, `orders` | FIXED + PASS |
| 3 | `/orders` | `GET /orders` | Lọc trạng thái/thanh toán; mở chi tiết | ADMIN | Danh sách chỉ đọc, mọi chuyển trạng thái ở trang chi tiết | `orders` | PASS |
| 4 | `/orders/[id]` | `GET /orders/:id` | Chuyển trạng thái theo đúng máy trạng thái (Xác nhận/Hủy/Chuẩn bị/Chờ giao/Giao/Đã giao), ghi nhận thanh toán, tạo vận đơn, hoàn tiền | ADMIN | `NEXT_STATUS` phản chiếu backend; không nhảy cóc; đơn hủy/hoàn giữ lịch sử | `orders`, `payments`, `shipments`, `returns` | PASS |
| 5 | `/returns-complaints` | `GET /returns`, `GET /complaints` | Duyệt/Từ chối trả hàng; xử lý khiếu nại | ADMIN | Trạng thái trả hàng/khiếu nại theo luồng; giữ lịch sử | `returns`, `complaints` | FIXED (bỏ subtitle chung) |
| 6 | `/products` | `GET /products`, options `categories/partners` | **Thêm**, **Sửa**, **Ngừng bán**, **Khôi phục**, menu 3 chấm "Xem chi tiết" | ADMIN | Sản phẩm có đơn/truy xuất → chỉ Ngừng bán (không xóa cứng); có cột "Thao tác" rõ ràng, ghim phải | `products` | FIXED |
| 7 | `/products/new` | options | Tạo sản phẩm (ảnh/tên/ĐVBH/nhóm/trang trại/mô tả/quy cách/trạng thái) | ADMIN | Trang trại lọc theo ĐVBH đã chọn; slug tự sinh; không nhập slug tay | `products`, `product-images` | FIXED |
| 8 | `/products/[id]` | `GET /products/:id`, `GET /farms` | Sửa; quản lý ảnh (thêm/đổi/xóa); thêm quy cách bán; Ngừng/Khôi phục | ADMIN | Hiển thị tên trang trại thật; slug read-only khi sửa; ràng buộc farm↔partner; **form Sửa điền đủ dữ liệu (fix `forceRender`), Lưu không xóa trường khác** | `products`, `product-images` | FIXED + Browser PASS |
| 9 | `/categories` | `GET /categories` | Thêm/Sửa; (danh mục đang dùng → không xóa) | ADMIN | Slug tự sinh từ tên; ẩn trường "Slug"; không có endpoint xóa (theo thiết kế); **form Sửa hiện đúng tên bản ghi (reset trước set)** | `categories` | FIXED + Browser PASS |
| 10 | `/partners` | `GET /partners` | Thêm/Sửa | ADMIN | — | `partners` | FIXED |
| 11 | `/partners/[id]` | `GET /partners/:id` | Xem; xác minh | ADMIN | — | `partners` | FIXED (bỏ ghi chú) |
| 12 | `/farms` | `GET /farms`, options `partners` | Thêm/Sửa | ADMIN | Khi sửa, khóa đổi đối tác (`partnerLocked`) để không phá quan hệ | `farms` | FIXED |
| 13 | `/farms/[id]` | `GET /farms/:id` | Xem; xác minh; thêm vụ mùa | ADMIN | — | `farms`, `seasons` | FIXED (bỏ ghi chú) |
| 14 | `/quality-control` | `GET /quality-control` | Kiểm định lô (Đạt/Không đạt, đóng gói đạt) | ADMIN | PASS → SELLABLE; FAIL → REJECTED; giữ lịch sử QC | `quality-control` | FIXED (bỏ subtitle) |
| 15 | `/lots` | `GET /lots`, options | Thêm lô | ADMIN | — | `lots` | FIXED (bỏ subtitle) |
| 16 | `/lots/[id]` | `GET /lots/:id` | Xem; Thu hồi lô | ADMIN | Thu hồi giữ lịch sử; hiển thị QC/đóng gói | `lots` | PASS |
| 17 | `/certificates` | `GET /certificates`, options `farms` | Thêm; Xác minh/Từ chối | ADMIN | Xác minh có lý do khi Từ chối; giữ lịch sử | `certificates` | FIXED (bỏ subtitle) |
| 18 | `/inventory` | `GET /inventory`, `GET /inventory/movements` | Nhập kho; Điều chỉnh tồn | ADMIN | Chỉ điều chỉnh/ghi nhận qua phiếu; giữ lịch sử biến động | `inventory` | FIXED (bỏ subtitle) |
| 19 | `/warehouse-documents` | `GET /warehouse-documents` | Tạo phiếu (Nhập/Xuất/Điều chỉnh) | ADMIN | Phiếu nháp mới sửa được | `warehouse-documents` | FIXED (bỏ subtitle) |
| 20 | `/warehouse-documents/[id]` | `GET /warehouse-documents/:id` | Hoàn tất phiếu (áp tồn) | ADMIN | Hoàn tất là bất khả nghịch → cảnh báo rõ (giữ lại) | `warehouse-documents` | PASS |
| 21 | `/vouchers` | `GET /vouchers` | Thêm; Ngừng/Kích hoạt | ADMIN | `PATCH /vouchers/:id` chỉ đổi `status`; điều khoản đã ghi nhận được đóng băng | `vouchers` | FIXED |
| 22 | `/product-discounts` | `GET /product-discounts` | Thêm; Ngừng/Kích hoạt | ADMIN | `PATCH` chỉ đổi `status`; bảo toàn lịch sử | `product-discounts` | FIXED |
| 23 | `/flash-sales` | `GET /flash-sales` | Thêm (chọn sản phẩm); Ngừng/Kích hoạt | ADMIN | `PATCH` chỉ đổi `status`; sửa DTO `items` (đã sửa lỗi whitelist) | `flash-sales` | FIXED |
| 24 | `/commission` | `GET /commission-rules` | Thêm; Ngừng/Kích hoạt | ADMIN | `PATCH /commission-rules/:id` chỉ đổi `status`; tỷ lệ/thời gian đóng băng | `commission-rules` | FIXED |
| 25 | `/customers` | `GET /users` | Thêm người dùng; Khóa/Mở | ADMIN | Không khóa admin cuối cùng (cảnh báo giữ lại) | `users` | FIXED (bỏ subtitle) |
| 26 | `/customers/[id]` | `GET /users/:id` | Khóa/Mở | ADMIN | Cảnh báo quy tắc admin cuối cùng (giữ lại) | `users` | PASS |
| 27 | `/reviews` | `GET /reviews` | Duyệt/Công khai/Ẩn | ADMIN | Trạng thái duyệt | `reviews` | FIXED (bỏ subtitle) |
| 28 | `/settlements` | `GET /settlements` | Tạo đối soát; Chi trả | ADMIN | Đối soát/chi trả giữ lịch sử | `settlements` | FIXED (bỏ subtitle + ghi chú công thức) |
| 29 | `/settlements/[id]` | `GET /settlements/:id` | Xác nhận đối soát | ADMIN | Xác nhận là chốt sổ → giữ lịch sử | `settlements` | FIXED (bỏ ghi chú) |
| 30 | `/reports` | `GET /reports/summary` (+ daily) | Chọn khoảng ngày; làm mới | ADMIN | Tổng hợp trên toàn bộ dữ liệu; VN timezone | `reports` | FIXED (bỏ intro chung) |

Ghi chú BLOCKED: không có mục nào bị chặn. Không thêm nút nào không có API chống lưng.

---

## 2. Files đã thay đổi (đợt này)

### Backend (`apps/api`)
- `src/reports/` (**mới**): `reports.controller.ts`, `reports.service.ts`, `daily.util.ts`, `dto/reports.dto.ts` — thêm `GET /reports/daily` (gom ngày theo giờ VN `+7h`, zero-fill, `days=7|30` hoặc `from`/`to`; DTO chỉ nhận `days ∈ {7,30}`), bổ sung trường trong `GET /reports/summary`.
- `src/promotions/promotions.controller.ts` + `promotions.service.ts` + `dto/promotion.dto.ts`: `PATCH /vouchers/:id`, `PATCH /product-discounts/:id`, `PATCH /flash-sales/:id` (chỉ `status`); thêm `UpdateVoucherStatusDto` / `UpdateProductDiscountStatusDto` / `UpdateFlashSaleStatusDto`.
- `src/finance/finance.controller.ts` + `commission.service.ts` + `dto/finance.dto.ts`: `PATCH /commission-rules/:id` (`UpdateCommissionRuleStatusDto`).
- `src/categories/categories.service.ts` + `dto/category.dto.ts`: slug tự sinh (`slug` optional) qua `uniqueSlug`, 409 khi trùng; `update` giữ slug ổn định trừ khi gửi rõ.
- `src/products/products.service.ts`: `assertFarmBelongsToPartner` cho create/update (400 "Trang trại không thuộc đơn vị bán hàng đã chọn." / "Trang trại không tồn tại.").
- Sửa lỗi tồn tại: `CreateFlashSaleDto.items` thiếu decorator class-validator → bị whitelist cắt → 400 (nút "Thêm flash sale" của admin vốn hỏng). Đã thêm `@IsArray() @ValidateNested({each:true}) @Type(() => CreateFlashSaleItemDto)`.

### Admin (`apps/admin-web`)
- `src/components/dashboard/DashboardCharts.tsx` (**mới**): `RevenueByDayChart` + `OrdersByStatusChart` dùng `@ant-design/plots` `Column`; một màu trung tính, không hiệu ứng.
- `src/app/(admin)/dashboard/page.tsx`: 8 KPI; toggle 7/30 ngày (`Segmented`); biểu đồ đếm đơn theo trạng thái (thay bảng trùng lặp); đơn gần đây; hàng đợi việc; cảnh báo lô cận hạn. Biểu đồ nạp qua `next/dynamic` `{ ssr: false }`.
- `src/hooks/useDashboardData.ts`: gom `summary` + `daily` + `recent`, state `days`, `actionQueue`, `statusBreakdown`.
- `src/hooks/useOptions.ts`: thêm `useFarmsForPartner(partnerId)` (lọc trang trại theo đối tác).
- `src/components/product/ProductFormFields.tsx`: bỏ nhập slug tay (chỉ đọc khi sửa); "Quy cách bán" dạng card có nhãn đầy đủ; dropdown trang trại lọc theo ĐVBH đã chọn.
- `src/app/(admin)/products/page.tsx`: cột "Thao tác" ghim phải (Sửa + Ngừng bán/Khôi phục + menu 3 chấm "Xem chi tiết"); bỏ subtitle chung; `scrollX=1240`.
- `src/app/(admin)/products/new/page.tsx` + `products/[id]/page.tsx`: bỏ xử lý slug tay; hiển thị tên trang trại thật; bỏ ghi chú "Lưu ý".
- `src/app/(admin)/categories/page.tsx`: bỏ trường + cột "Slug"; slug tự sinh; đổi placeholder tìm kiếm.
- `src/app/(admin)/vouchers|product-discounts|flash-sales|commission/page.tsx`: thêm nút Ngừng/Kích hoạt có xác nhận; cột "Thao tác" cuối bảng, tăng `scrollX`.
- `src/app/(admin)/partners/page.tsx` + `farms/page.tsx`: thêm nút Sửa mở `FormModal` (farm khóa đối tác khi sửa).
- Bỏ phụ đề/ghi chú chung: categories, vouchers, product-discounts, flash-sales, commission, warehouse-documents, lots, certificates, returns-complaints, quality-control, inventory, settlements, reviews, orders, customers, reports, login; và ở `settlements/[id]`, `partners/[id]`, `farms/[id]`.
- `src/lib/api/resources.ts`, `src/types/api.ts`, `src/lib/query/keys.ts`: thêm wrapper/type/key cho reports + các `PATCH` trạng thái.

### Tests (`apps/api/test`)
- **Mới**: `business-rules/reports-daily.spec.ts`, `business-rules/category-product-slug.spec.ts`, `business-rules/promotion-status.spec.ts`, `promotion-status.e2e-spec.ts`.
- **Cập nhật**: `mutation-acceptance.e2e-spec.ts` (chuỗi daily + >100 đơn), `product-images.e2e-spec.ts`.

---

## 3. Thao tác đã sửa / nút mới

| Trang | Trước | Sau |
|-------|-------|-----|
| Sản phẩm (list) | Không có cột thao tác rõ | Cột "Thao tác": **Sửa**, **Ngừng bán/Khôi phục**, menu "Xem chi tiết" |
| Danh mục | Nhập "Slug" tay | Slug tự sinh; ẩn trường |
| Form sản phẩm | Nhập slug tay; trang trại không lọc | Bỏ slug tay; trang trại lọc theo ĐVBH |
| Voucher / Giảm giá SP / Flash Sale / Hoa hồng | Chỉ tạo, không đổi trạng thái | **Ngừng** / **Kích hoạt** (có xác nhận ngắn) |
| Đối tác / Trang trại (list) | Chỉ tạo | **Sửa** (mở modal) |
| Flash Sale | Nút "Thêm flash sale" hỏng (400) | Đã sửa DTO backend → hoạt động |

---

## 4. KPI & biểu đồ Dashboard

- **8 KPI** (đều lấy từ `GET /reports/summary`, tính trên toàn bộ dữ liệu, không cắt 100):
  1. Tổng giá trị đơn (`totalOrderValue`, loại đơn hủy)
  2. Doanh thu thực thu (`netCollected` = đã thu − đã hoàn)
  3. Hoa hồng ghi nhận (`commissionRecorded`)
  4. Tiền hoàn (`refundTotal`)
  5. Đơn chờ xác nhận (`pendingConfirmation`)
  6. Đơn đang giao (`shipping`)
  7. Khiếu nại đang mở (`open`)
  8. Dòng tồn kho sắp hết (`inventory.lowStockLines`)
- **Biểu đồ doanh thu theo ngày**: `GET /reports/daily`, toggle **7/30 ngày**, zero-fill ngày trống, đơn vị VND, gom theo ngày VN; giá trị = `netCollected` (tiền thực thu).
- **Biểu đồ số đơn theo trạng thái**: `Column` (nhãn tiếng Việt) thay cho bảng trạng thái trùng lặp.
- **Đơn gần đây** + **Hàng đợi việc** + **Cảnh báo lô cận hạn**.

Phân biệt rõ: tổng giá trị đơn ≠ doanh thu thực thu ≠ hoa hồng ≠ hoàn tiền ≠ đơn mới ≠ phí giao; có xét COD/online/đã hủy/đã hoàn/đối soát; VN timezone; đơn vị VND.

---

## 5. Ghi chú đã gỡ (giữ lại cảnh báo nghiệp vụ)

Đã gỡ: phụ đề lặp, mô tả trang chung chung, giải thích thuật ngữ, hướng dẫn dài, `placeholder` trùng nhãn, câu mở đầu kiểu AI, ghi chú công thức ở đối soát, ghi chú ở chi tiết đối tác/trang trại/đối soát.

Giữ lại (theo yêu cầu): tên trường, đơn vị, lỗi validate, trạng thái/thời gian, xác nhận thao tác nguy hiểm, cảnh báo tồn/QC/hạn dùng/thanh toán, thông tin truy xuất; cảnh báo "admin cuối cùng" (khách hàng) và "hoàn tất phiếu kho là bất khả nghịch".

---

## 6. Kết quả kiểm thử (PASS/FAIL)

| Hạng mục | Lệnh | Kết quả |
|----------|------|---------|
| API typecheck | `npm run typecheck --workspace @agrimarket/api` | **PASS** (exit 0) |
| API lint | `npm run lint --workspace @agrimarket/api` | **PASS** (exit 0; chỉ còn 2 warning có sẵn ở `test/concurrency.e2e-spec.ts`) |
| API unit test | `npm run test --workspace @agrimarket/api` | **PASS** — **238/238** (19 files; +9 ở đợt chốt) |
| API e2e (TEST DB) | `npm run test:e2e --workspace @agrimarket/api` | **PASS** — **231/231** (6 files; +11 ở đợt chốt) |
| API build | `npm run build --workspace @agrimarket/api` | **PASS** (exit 0) |
| Admin typecheck | `npm run typecheck --workspace @agrimarket/admin-web` | **PASS** (exit 0) |
| Admin lint | `npm run lint --workspace @agrimarket/admin-web` | **PASS** (exit 0) |
| Admin build | `npm run build --workspace @agrimarket/admin-web` | **PASS** — "Compiled successfully" |
| Customer-web typecheck/lint/build (hồi quy) | tương ứng | **PASS** (exit 0) |
| Smoke API (DEV) | login admin; `/reports/daily?days=7` → 7 điểm zero-fill; `days=30` → 30 điểm; `days=14` → 400; `/reports/summary` OK; 4 `PATCH` trạng thái trả 400 (tồn tại, không 404); slug danh mục tự sinh | **PASS** |

---

## 6b. Đợt chốt 3 điểm nghiệm thu (2026-10-09)

Ba điểm dưới đây đã sửa ở backend + admin, kèm E2E MySQL TEST. Mỗi E2E đã
được kiểm chứng **đối chứng ngược** (revert fix → test đỏ), nên không phải test
hình thức.

| # | Vấn đề | Sửa | Bằng chứng |
|---|--------|-----|-----------|
| 1 | Doanh thu ròng trừ hoàn tiền 2 lần khi Payment → `REFUNDED` | `grossCollected` gồm cả `REFUNDED` (tiền **đã** thu); hoàn tiền chỉ trừ 1 lần ở nhánh refund | `reports-revenue.e2e-spec.ts` §1: PAID 100k + PARTIALLY_REFUNDED 200k (hoàn 50k) + REFUNDED 300k (hoàn 300k) → gross 600k, refund 350k, net **250k** (không phải −50k). Revert → FAIL (−50k) |
| 2 | Dòng tiền theo `createdAt` thay vì thời điểm thực phát sinh | `Payment.paidAt` + `Refund.completedAt`; `summary()` và `daily()` **dùng chung** `resolveReportWindow` | §2: COD tạo 10/04 thu 15/04 → thu đúng ngày 15/04; hoàn 20/04 nhưng `completedAt` 25/04 → hạch toán ngày 25/04; biên VN UTC+7 (20:00Z → ngày kế); KPI 7/30 ngày == tổng biểu đồ. Revert → FAIL (5 test) |
| 3 | Nhãn "Sản phẩm sắp hết" nhưng đếm **dòng** `inventory_balances` | Đổi tên `inventory.lowStockLines` + trả `lowStockThreshold`; ngưỡng = dòng có `available > 0` và `≤ 20` (0 = đã hết, trạng thái khác) | §3: 2 dòng cùng 1 variant → đếm 2 (không phải 1); dòng 21 không tính; dòng 0 không tính; biên 20 tính. Revert ngưỡng cũ → FAIL (+3 thay vì +2) |

Khoảng áp dụng KPI: nút 7/30 ngày gọi **cùng** `days` cho cả `summary` và
`daily`; UI hiển thị rõ "Số liệu … trong kỳ: dd/mm – dd/mm (N ngày)". Mặc định
= 30 ngày VN gần nhất, **không** phải toàn bộ lịch sử; trả kèm `from`/`to` thực tế.

Smoke DEV (chỉ đọc, không ghi): `days=7` và `days=30` → `summary.from == daily.from`,
gross/refund/net KPI **bằng đúng** tổng biểu đồ; `days=14` → 400 trên cả hai endpoint.

---

## 6c. Đợt sửa lỗi runtime antd v6 + form Sửa (2026-10-10)

Bốn lỗi runtime thật trên trình duyệt (antd 6.6.5) đã được sửa **tại gốc**, không
ẩn cảnh báo, kèm **kiểm chứng bằng trình duyệt thật (Playwright/Chromium)** và
**test frontend tự động (vitest + Testing Library)**.

### Lỗi đã tái hiện → nguyên nhân gốc → cách sửa

| # | Cảnh báo / lỗi (chuỗi chính xác) | Nguyên nhân gốc | Sửa |
|---|----------------------------------|-----------------|-----|
| 1 | `[antd: Alert] message is deprecated. Please use title instead.` | antd v6 đổi prop `Alert.message` → `title` | Đổi sang `title=` tại `login/page.tsx`, `components/common/States.tsx`, `dashboard/page.tsx` |
| 2 | `[antd: Modal] maskClosable is deprecated. Please use mask.closable instead.` | antd v6 gộp `maskClosable` vào `mask` | Đổi sang `mask={{ closable: false }}` tại `customers/page.tsx`, `certificates/page.tsx`, `reviews/page.tsx`, `FormModal.tsx` |
| 3 | `Instance created by \`useForm\` is not connected to any Form element.` | Modal **mount lười**: `setFieldsValue` chạy trước khi có `<Form>` nào kết nối → antd xóa store khi field đăng ký | Thêm `forceRender` cho `FormModal` và các `<Modal>` thô ở `certificates`/`reviews` |
| 4 | Form "Sửa sản phẩm" **trống trơn** dù sản phẩm đã tải | Cùng nguyên nhân #3: giá trị set trước khi Form mount bị xóa; field không có `initialValues` để fallback | `forceRender` (như trên) — dữ liệu điền đúng tên/slug/mô tả/nhóm/trang trại/trạng thái |

Bổ sung API antd v6 đã kiểm tra từ mã nguồn package: `Divider orientation="left"` →
`titlePlacement="start"`; `InputNumber addonAfter` bị deprecate (đã bỏ, đơn vị nằm
trong nhãn); DOM Select đổi sang `.ant-select-content`.

### Sửa theo màn hình
- `/products/[id]` (Sửa): `forceRender` cho modal sửa; slug **chỉ đọc** khi sửa; nút
  **Sửa** chỉ hiện sau khi sản phẩm đã tải xong; nút Lưu gửi **đủ** trường hợp lệ nên
  PATCH không bao giờ xóa mô tả/nhóm/trạng thái/trang trại.
- `/categories` (Sửa): `resetFields()` trước `setFieldsValue` → form luôn hiện đúng
  tên bản ghi (không lộ placeholder/dữ liệu bản ghi trước); slug ổn định không gửi khi sửa.
- `/flash-sales` (Thêm): nhãn rõ ràng **"Giá flash (đ)"**, **"Số lượng ưu đãi"**,
  **"Giới hạn mỗi khách"** (khớp DTO `flashPrice`/`quota`/`perCustomerLimit`); validate
  số nguyên ≥ 1, giá ≥ 0, giới hạn mỗi khách ≤ số lượng ưu đãi; mặc định = 1.
- `/vouchers` (Thêm): nhóm trường bằng `Divider` (Thông tin / Giá trị giảm / Giới hạn
  / Thời gian); phân biệt **%** vs **đ** theo `discountType` (nhãn + validate ≤ 100%);
  `maxDiscount` chỉ gửi cho voucher phần trăm.
- `/product-discounts`: phân biệt **%** vs **đ**.
- `/dashboard`: biểu đồ "Đơn hàng theo trạng thái" xoay/ngắt nhãn trục X, trục Y có
  tiêu đề "Số đơn" + định dạng số.
- Dọn ghi chú trùng: bỏ tiêu đề "Hình ảnh sản phẩm" lặp (đã có tiêu đề card bao ngoài);
  bỏ `extra` "Áp dụng cho voucher giảm theo phần trăm." (đã thể hiện qua nhãn động).

### Test frontend mới (`apps/admin-web/test/`, vitest + jsdom + Testing Library)
- `product-edit.spec.tsx` (5): không hiện nút Sửa khi đang tải; điền đủ mọi trường; slug
  read-only; đóng/mở lại không mất trạng thái; PATCH gửi đủ trường (không xóa trường khác).
- `category-edit.spec.tsx` (3): hiện đúng tên bản ghi; không lộ bản ghi trước sang bản ghi
  sau; lưu tên mới và **không** gửi slug.
- `flash-sale.spec.tsx` (4): nhãn 3 trường số; chặn submit + báo lỗi khi quota không nguyên;
  chặn giới hạn mỗi khách > quota; mặc định quota/giới hạn = 1.
- `test/setup.ts`: bắt `console.error` khớp mẫu cảnh báo antd → **test đỏ** nếu tái phát
  cảnh báo `[antd:…]` / `not connected to any Form element` / `deprecated`.

### Kiểm chứng trình duyệt thật (Playwright, Chromium 1243, headless)
- Crawl 24 route: **TOTAL ANTD WARNINGS: 0**. (404 ở `/partners/1`, `/farms/1` là do bản
  ghi không tồn tại, không phải cảnh báo.)
- `verify.js`: product Sửa điền đúng `Rau muống hạt / rau-muong-hat / Rau ăn lá /
  FARM-0001 — Trang trại Minh Châu 1 / Đang hoạt động`; đóng→mở lại giữ nguyên; hai sản
  phẩm 42 & 41 hiện dữ liệu **khác nhau**; category form khớp dòng ("Rau ăn lá"); flash
  sale hiện 3 nhãn đúng + `[1,1]` mặc định; voucher chia 4 nhóm; PATCH no-op 200 giữ nguyên
  name/slug/category/farm/description/status; sửa 1 trường + Lưu cập nhật đúng và giữ mọi
  trường còn lại (mô tả DEV đã **hoàn nguyên**, không còn `[test]`).
- `verify-modals.js` (mở/đóng modal thật ở các trang list): `customers` (Thêm người dùng),
  `returns-complaints` (Xử lý), `certificates` (Xác minh), `reviews` (Duyệt) — **0 cảnh báo
  antd / useForm** ở mọi lần mở modal.

### Kết quả kiểm thử đợt này
| Hạng mục | Lệnh | Kết quả |
|----------|------|---------|
| Admin typecheck | `npm run typecheck --workspace @agrimarket/admin-web` | **PASS** (exit 0) |
| Admin lint | `npm run lint --workspace @agrimarket/admin-web` | **PASS** (exit 0) |
| Admin test (mới) | `npm run test --workspace @agrimarket/admin-web` | **PASS** — **12/12** (3 files) |
| Admin build | `npm run build --workspace @agrimarket/admin-web` | **PASS** — "Compiled successfully" |
| API unit | `npm run test --workspace @agrimarket/api` | **PASS** — **238/238** |
| API e2e (MySQL TEST) | `npm run test:e2e --workspace @agrimarket/api` | **PASS** — **231/231** |
| Customer-web typecheck/lint/build | tương ứng | **PASS** (exit 0) |
| Browser (Playwright) | crawl 24 route + verify.js | **PASS** — 0 antd warning |

---

## 7. Lỗi còn lại / giới hạn

1. **Đã có công cụ tự động hoá trình duyệt** (Playwright/Chromium) trong đợt chốt
   này — render biểu đồ thật, cảnh báo console và luồng Sửa/Lưu đã được xác nhận
   **bằng trình duyệt thật** (mục 6c), không còn chỉ suy luận qua build. Lưu ý: chỉ
   Chromium 1243 có sẵn trong cache nên chạy qua `executablePath`; WebKit/Firefox
   chưa kiểm chứng.
2. API lint còn 2 warning **có sẵn** (không thuộc đợt này): `test/concurrency.e2e-spec.ts:392` `require-array-sort-compare`.
3. Không có endpoint xóa cứng sản phẩm/danh mục (theo thiết kế) → thao tác "xóa" được thay bằng "Ngừng bán"/"Ẩn".
4. `docs/ADMIN-V2-REPORT.md` (tài liệu này) là file mới chưa commit; toàn bộ thay đổi đang ở working tree, **không commit/push** theo yêu cầu.

## 8. Ràng buộc đã tuân thủ
- Không reset/reseed DEV; không xóa đơn/dữ liệu thật (chỉ tạo rồi xóa 1 danh mục smoke test).
- Không sửa Mobile; không đổi công nghệ/thư viện UI (dùng Ant Design sẵn có + `@ant-design/plots`).
- Không commit/push GitHub.
