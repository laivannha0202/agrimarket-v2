# 14 — FULL FEATURE INVENTORY & GAP ANALYSIS

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Thời điểm audit:** 23/10/2026  
**Phạm vi:** toàn bộ Admin Web, Customer Web, Mobile, API, Prisma schema và các luồng nghiệp vụ chính  
**Tính chất:** READ-ONLY. Không sửa code, không tạo dữ liệu nghiệp vụ, không chạy migration, không commit/push/deploy.

---

## 0. Kết luận điều hành

### 0.1. Phán quyết

**Nền tảng CHƯA hoàn thiện chức năng và CHƯA đủ an toàn để bán hàng thật tại HEAD hiện tại.**

Đánh giá: **NO-GO cho bán hàng thật**. Chỉ phù hợp demo/UAT nội bộ với dữ liệu giả lập, không xử lý tiền thật, không nhận đơn thật.

Lý do quyết định không phải vì thiếu số lượng màn hình. Hệ thống đã có bề mặt chức năng rộng: 30 trang Admin, 27 trang Customer Web, 30 màn hình Mobile, 30 controller/151 route. Vấn đề nằm ở **tính toàn vẹn của chuỗi nghiệp vụ**:

1. **Bảo mật xác thực fail-open:** API vẫn khởi động với JWT secret mặc định `CHANGE_ME` nếu thiếu biến môi trường.
2. **Vòng đời giao hàng không nhất quán với vòng đời đơn hàng:** có thể tạo shipment cho đơn đã hủy; shipment `DELIVERED` cố gắng chuyển đơn đã hủy thành `DELIVERED` rồi thất bại khi tiêu thụ tồn kho; shipment `RETURNED` chỉ ghi trace event, không xử lý đơn/tồn kho.
3. **Hoàn hàng/hoàn tiền không khép kín:** backend không có state machine cho return, nhận `refundId` tùy ý, không có UI tạo refund, không có luồng nhập lại hàng – QC – mở khóa tồn kho.
4. **Tồn kho bị khóa vĩnh viễn:** `blocked` chỉ được tăng, không có bất kỳ đoạn code nào giảm `blocked`; hủy đơn ở trạng thái `SHIPPING` sẽ treo hàng vĩnh viễn. Phiếu kho `RETURN` lại cộng thẳng vào `on_hand` bán được, bỏ qua QC.
5. **Sai lệch dòng tiền:** settlement không trừ refund (`refundAmount` hardcode `0`), và có thể tạo settlement cho đơn `DELIVERED` dù COD chưa được thu.
6. **Truy xuất nguồn gốc chưa hoàn chỉnh:** chỉ 4/8 loại trace event từng được ghi; không có UI tạo harvest/farming event; Admin chỉ tạo được mùa vụ nhưng không cập nhật/đóng mùa vụ, không tạo vụ thu hoạch.
7. **Rò rỉ dữ liệu công khai:** `GET /partners` và `GET /partners/:id` công khai trả về toàn bộ bản ghi Partner, gồm `taxCode`, `bankAccountName`, `bankAccountNumber`, `bankName`.
8. **Giá trị đơn có thể âm:** giảm giá `PERCENT` không bị chặn trên ở API; Admin UI chặn 100% nhưng API trực tiếp thì không, dẫn tới `unitPrice` âm.
9. **Thông báo, thanh toán online, audit viewer, RBAC, CI/CD, backup drill, Playwright UI E2E đều chưa có.**

### 0.2. Những gì đã chạy được ở mức kỹ thuật

Các luồng sau có API, UI và test ở mức tốt, có thể dùng cho UAT:

- Duyệt catalog, tìm kiếm sản phẩm, xem trang trại/đối tác, xem chứng nhận, QC, lô hàng.
- Giỏ hàng, checkout COD, áp voucher/giảm giá, tính phí giao hàng phía server, idempotency checkout.
- Admin xem đơn, đổi trạng thái đơn, thu COD thủ công qua `PATCH /payments/:id/status`.
- Nhập kho, điều chỉnh kho, bán hàng FEFO, reserve/release nguyên tử, chống oversell.
- QC, tạo lô, QR, chứng nhận, trace cơ bản.
- Báo cáo doanh thu/đơn hàng, export Excel/PDF.
- Payout/refund/adjust có idempotency; settlement/payout có kiểm soát chống vượt payable.
- Auth cơ bản: đăng ký, đăng nhập, quên/đổi mật khẩu, địa chỉ, phân quyền ADMIN/CUSTOMER.

### 0.3. Ý nghĩa của “hoàn thiện” trong báo cáo này

Một tính năng chỉ được coi là **HOÀN THIỆN** khi thỏa đồng thời:

1. Có UI/route thực tế ở client tương ứng.
2. Có API gọi tới service, không phải dữ liệu giả.
3. Có ghi/đọc DB đúng schema.
4. Có kiểm chứng tự động hoặc bằng chứng chạy thật.
5. Không mâu thuẫn với state machine/tồn kho/dòng tiền ở module khác.

Chỉ có UI hoặc chỉ có API **không** được tính là hoàn thiện.

---

## 1. Baseline, phạm vi và bằng chứng

### 1.1. Commit được nghiệm thu

| Hạng mục | Giá trị |
|---|---|
| Branch | `fix/bl-01-02-settlement-con-01` |
| HEAD | `5b35b974bae65f308cfdce3ab23a6aec959f2916` |
| Trạng thái tracked tree | Sạch |
| Untracked | `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md`, `audit-reports/` |
| Tài liệu tiền đề | Reports 09, 10, 11, 12, 13 đã đọc và đối chiếu với HEAD |

### 1.2. Quy mô hệ thống

| Thành phần | Số lượng | Ghi chú |
|---|---:|---|
| Admin pages | 30 | `apps/admin-web/src/app/(admin)/**/page.tsx` |
| Customer Web pages | 27 | `apps/customer-web/src/app/**/page.tsx` |
| Mobile route screens | 30 | `apps/mobile/app/**/*.tsx`, không tính `_layout.tsx` |
| API controllers | 30 | `apps/api/src/**/*.controller.ts` |
| Route decorators | 151 | `@Get/@Post/@Patch/@Put/@Delete` |
| Prisma models | 52 | `apps/api/prisma/schema.prisma` |
| Prisma enums | 26 | cùng file |
| Migrations | 11 | `apps/api/prisma/migrations/` |

11 migrations hiện có:

1. `20260101000000_init_v2`
2. `20260215000000_checkout_idempotency`
3. `20261008000000_code_sequences`
4. `20261009000000_inventory_quarantine_movement`
5. `20261010000000_order_item_flash_sale_item`
6. `20261011000000_product_image_metadata`
7. `20261012000000_hung_yen_wards_and_auth`
8. `20261012000001_password_changed_at`
9. `20261013000000_evidence_images`
10. `20261019000000_settlement_line_unique_partner_order`
11. `20261022000000_app_idempotency_keys`

### 1.3. Kiểm thử đã chạy

Các bộ test an toàn được chạy lại trong vòng audit này:

| Bộ test | Kết quả | Trạng thái |
|---|---|---|
| API unit | 34 files / 440 tests | PASS |
| Admin Web | 7 files / 40 tests | PASS |
| Customer Web | 3 files / 37 tests | PASS |
| Mobile | 18 files pass + 1 skip / 175 pass + 3 skip | PASS |
| Shared domain | 5 files / 65 tests | PASS |

Bằng chứng nghiệm thu tại đúng commit (Report 13, không chạy lại trong vòng này):

| Bộ test | Kết quả | Trạng thái |
|---|---|---|
| API full E2E | 16 files / 408 tests | PASS |
| Stress/concurrency | 3 files / 52 tests | PASS |
| Playwright UI E2E | Không có | — |

**Giới hạn bằng chứng:**

- Không có bộ E2E UI Playwright; test frontend chủ yếu là unit/component.
- Full E2E và stress không được chạy lại trong vòng audit này; số liệu lấy từ Report 13 tại cùng commit.
- Không có môi trường staging/production thật, SMTP thật, payment gateway thật, backup/restore drill.
- Các lỗi state machine/return/refund được xác định bằng đọc code path và đối chiếu schema; không phải tất cả đều được reproduce bằng test mới (vì audit read-only, không thêm test).
- Test PASS **không chứng minh** tính đúng của luồng chưa được test. Nhiều test hiện chỉ khẳng định hành vi hẹp (ví dụ shipment `RETURNED` chỉ ghi trace).

### 1.4. Quy ước trạng thái

| Nhãn | Nghĩa |
|---|---|
| **HOÀN THIỆN** | UI + API + DB + test/evidence đầy đủ, không có mâu thuẫn đã biết trong phạm vi hiện tại |
| **HOÀN THIỆN MỘT PHẦN** | Luồng chính chạy được nhưng thiếu một lớp, thiếu edge case quan trọng, hoặc thiếu UI vận hành |
| **CÓ NHƯNG LỖI** | Đã có code/UI nhưng vi phạm invariant nghiệp vụ, có thể gây sai tồn kho/tiền/trạng thái |
| **CHƯA CÓ** | Không có code/DB/API/UI |
| **CHƯA XÁC MINH** | Có code nhưng chưa đủ bằng chứng chạy thật hoặc chưa kiểm tra hết nhánh |

### 1.5. Quy ước mức độ

| Mức | Nghĩa |
|---|---|
| **P0** | Chặn bán hàng thật; lỗi bảo mật nghiêm trọng hoặc phá vỡ tính toàn vẹn không thể vận hành an toàn |
| **P1** | Chặn release nghiêm trọng: sai tiền/tồn kho, thiếu luồng vận hành cốt lõi, rò rỉ dữ liệu |
| **P2** | Ảnh hưởng vận hành/UX/dữ liệu, có workaround hoặc chỉ xảy ra ở biên |
| **P3** | Hoàn thiện, tài liệu, nhất quán, thông báo lỗi |

---

## 2. Inventory Admin Web — 30 trang

Admin shell hiện có các nhóm nav tại `apps/admin-web/src/components/layout/AdminShell.tsx:44-112`. Các trang dưới đây là toàn bộ page thực tế.

| # | Route | Chức năng chính | Lớp dữ liệu / API | Trạng thái | Bằng chứng / khoảng trống |
|---:|---|---|---|---|---|
| 1 | `/dashboard` | KPI tổng quan, doanh thu theo ngày, đơn gần đây, cảnh báo tồn thấp | `GET /reports/summary`, `/reports/daily`, `/orders`, `/inventory` | HOÀN THIỆN | `useDashboardData.ts`; báo cáo dùng COUNT/SUM toàn tập, không cắt 100 dòng |
| 2 | `/orders` | Danh sách/lọc/tìm đơn, phân trang | `GET /orders` | HOÀN THIỆN MỘT PHẦN | List ổn; không có cột/trạng thái vận chuyển, không tạo shipment |
| 3 | `/orders/[id]` | Chi tiết đơn, đổi trạng thái, xem payment/shipment/refund, thu COD | `PATCH /orders/:id/status`, `PATCH /payments/:id/status` | CÓ NHƯNG LỖI | COD thu thủ công đúng; nhưng state đơn và shipment mâu thuẫn, không tạo refund/shipment |
| 4 | `/returns-complaints` | Duyệt return/complaint, xem evidence, đổi trạng thái | `GET/PATCH /returns`, `/complaints` | CÓ NHƯNG LỖI | Transition chỉ chặn ở UI; return nhận refundId tùy ý, không có UI tạo refund |
| 5 | `/products` | Danh sách/lọc sản phẩm, trạng thái | `GET/PATCH /products` | HOÀN THIỆN MỘT PHẦN | API public vẫn trả sản phẩm INACTIVE khi gọi trực tiếp |
| 6 | `/products/new` | Tạo sản phẩm, variants, ảnh | `POST /products`, `/products/:id/variants`, `/products/:id/images` | HOÀN THIỆN MỘT PHẦN | Thiếu ràng buộc một số field ở DB/API; ảnh lưu local |
| 7 | `/products/[id]` | Sửa sản phẩm, variant, ảnh, trạng thái | `PATCH /products/:id`, variant/image APIs | HOÀN THIỆN MỘT PHẦN | Không xóa variant; ảnh local; public inactive |
| 8 | `/categories` | Danh sách, tạo, sửa danh mục | `GET/POST/PATCH /categories` | HOÀN THIỆN | UI + API + slug test |
| 9 | `/partners` | Danh sách, tạo, sửa đối tác | `GET/POST/PATCH /partners` | HOÀN THIỆN MỘT PHẦN | Chức năng Admin đủ; API public làm lộ bank/tax |
| 10 | `/partners/[id]` | Chi tiết đối tác, farms, sản phẩm | `GET /partners/:id`, `/farms` | HOÀN THIỆN MỘT PHẦN | Cùng vấn đề public partner; không có portal đối tác |
| 11 | `/farms` | Danh sách, tạo, sửa trang trại | `GET/POST/PATCH /farms` | HOÀN THIỆN MỘT PHẦN | Không quản lý vùng trồng/bản đồ |
| 12 | `/farms/[id]` | Chi tiết farm, danh sách mùa vụ, tạo mùa vụ | `GET/POST /seasons`, `GET /harvests` | HOÀN THIỆN MỘT PHẦN | Chỉ tạo season; không sửa/đóng season, không tạo harvest/farming event |
| 13 | `/quality-control` | Tạo phiếu QC, kết quả PASS/FAIL | `GET/POST /qc` | HOÀN THIỆN | QC event ghi trace; test lot-qc |
| 14 | `/lots` | Danh sách lô, tạo lô từ harvest, QR | `GET/POST /lots` | HOÀN THIỆN MỘT PHẦN | Form bắt buộc `harvestId`; không có UI tạo harvest |
| 15 | `/lots/[id]` | Chi tiết lô, tồn, QC, recall, QR | `GET/PATCH /lots/:id`, `/qc` | HOÀN THIỆN MỘT PHẦN | Trace chain thiếu event vận chuyển/giao hàng |
| 16 | `/certificates` | Tạo, xác minh, xem chứng nhận | `GET/POST/PATCH /certificates` | HOÀN THIỆN | Có kiểm tra hiệu lực |
| 17 | `/warehouses` | CRUD kho, vô hiệu hóa kho | `GET/POST/PATCH /warehouses` | HOÀN THIỆN | Có guard tồn kho khi deactivate |
| 18 | `/inventory` | Tồn theo kho/lô/variant, movement, nhập kho, điều chỉnh | `GET/POST /inventory/*` | HOÀN THIỆN MỘT PHẦN | `blocked` không có luồng giải phóng; adjustment chỉ đổi `on_hand` |
| 19 | `/warehouse-documents` | Danh sách, tạo phiếu INBOUND/OUTBOUND/RETURN, complete | `GET/POST /warehouse-documents` | CÓ NHƯNG LỖI | Phiếu RETURN cộng trực tiếp `on_hand`, bỏ qua QC/quarantine |
| 20 | `/warehouse-documents/[id]` | Chi tiết phiếu, dòng hàng, trạng thái | `GET /warehouse-documents/:id` | CÓ NHƯNG LỖI | Không có bước kiểm định lại hàng hoàn |
| 21 | `/vouchers` | Tạo voucher, bật/tắt, giới hạn | `GET/POST/PATCH /vouchers` | HOÀN THIỆN MỘT PHẦN | Không có phát hành/claim theo khách; khách chỉ thấy voucher ACTIVE |
| 22 | `/product-discounts` | Giảm giá theo variant, PERCENT/AMOUNT | `GET/POST/PATCH /product-discounts` | CÓ NHƯNG LỖI | UI chặn >100%, API không; có thể tạo giá âm |
| 23 | `/flash-sales` | Flash sale, item, thời gian, giới hạn | `GET/POST/PATCH /flash-sales` | HOÀN THIỆN | Có test cạnh tranh/flash-sale item |
| 24 | `/customers` | Danh sách/tạo user, khóa/mở khóa | `GET/POST/PATCH /customers` | HOÀN THIỆN MỘT PHẦN | Chỉ role ADMIN/CUSTOMER; tạo được ADMIN; không RBAC chi tiết |
| 25 | `/customers/[id]` | Chi tiết user, trạng thái, đơn/địa chỉ | `GET /customers/:id` | HOÀN THIỆN MỘT PHẦN | Không sửa hồ sơ/role; không audit trên UI |
| 26 | `/reviews` | Danh sách/duyệt review | `GET/PATCH /reviews` | HOÀN THIỆN | Moderation cơ bản |
| 27 | `/commission` | Quy tắc hoa hồng, trạng thái | `GET/POST/PATCH /commission-rules` | HOÀN THIỆN | Có test commission |
| 28 | `/settlements` | Tạo settlement, xem kỳ, tạo payout, đánh dấu PAID | `GET/POST /settlements`, `/payouts` | CÓ NHƯNG LỖI | `refundAmount` luôn 0; có thể settle khi COD chưa thu |
| 29 | `/settlements/[id]` | Chi tiết settlement, dòng đối tác, payout | `GET /settlements/:id`, `/payouts` | CÓ NHƯNG LỖI | Hiển thị refund 0; không có adjustment/refund correction |
| 30 | `/reports` | Báo cáo summary/daily, export Excel/PDF | `GET /reports/summary`, `/reports/daily`, `/reports/export` | HOÀN THIỆN | Đã có test report daily/export; chưa đối soát kế toán độc lập |

### 2.1. Chức năng Admin **không có trang**

Các năng lực backend sau **không có màn hình Admin**:

- Quản lý shipment: tạo shipment, cập nhật trạng thái, xem tracking, xử lý giao thất bại/hoàn hàng.
- Quản lý payment/refund tập trung: danh sách payment, tạo refund, xem refund, đối soát COD.
- Tạo/sửa vụ thu hoạch (`POST/PATCH /harvests`).
- Tạo farming event (`POST /farming-events`).
- Sửa/đóng mùa vụ (`PATCH /seasons/:id`).
- Audit log viewer (`audit_logs` chỉ ghi, không có API đọc).
- Notification center.
- Quản lý nhân viên/phân quyền chi tiết.
- Quản lý claim/usage voucher theo khách.

---

## 3. Inventory Customer Web — 27 trang

| # | Route | Chức năng chính | API | Trạng thái | Ghi chú |
|---:|---|---|---|---|---|
| 1 | `/` | Trang chủ, hero, danh mục, flash sale, sản phẩm, farm | public catalog APIs | HOÀN THIỆN | Dữ liệu thật từ API |
| 2 | `/san-pham` | Danh sách/tìm/lọc sản phẩm, phân trang | `GET /products` | HOÀN THIỆN | Client luôn gửi `status=ACTIVE` |
| 3 | `/san-pham/[id]` | Chi tiết sản phẩm, variant, tồn, review, thêm giỏ | `GET /products/:id`, `/reviews` | HOÀN THIỆN MỘT PHẦN | `GET /products/:id` không lọc ACTIVE; sản phẩm ẩn vẫn xem được nếu biết ID |
| 4 | `/danh-muc/[slug]` | Danh mục sản phẩm | `GET /categories`, `/products` | HOÀN THIỆN | — |
| 5 | `/trang-trai` | Danh sách trang trại | `GET /farms` | HOÀN THIỆN | — |
| 6 | `/trang-trai/[id]` | Chi tiết farm, sản phẩm, chứng nhận | `GET /farms/:id` | HOÀN THIỆN | — |
| 7 | `/doi-tac/[id]` | Chi tiết đối tác | `GET /partners/:id` | HOÀN THIỆN MỘT PHẦN | UI không in bank, nhưng API công khai trả bank/tax |
| 8 | `/truy-xuat` | Nhập mã truy xuất | `GET /trace/:code` | HOÀN THIỆN | Có normalize mã |
| 9 | `/truy-xuat/[code]` | Timeline truy xuất | `GET /trace/:code` | HOÀN THIỆN MỘT PHẦN | Chỉ 4/8 loại event được ghi; thiếu packing/out/shipping/delivered |
| 10 | `/gio-hang` | Giỏ hàng, sửa số lượng, xóa | `/carts/me` | HOÀN THIỆN | — |
| 11 | `/thanh-toan` | Checkout, địa chỉ, voucher, preview, đặt COD | `/orders/checkout-preview`, `/orders/checkout` | HOÀN THIỆN MỘT PHẦN | Chỉ COD; API cho phép method khác nhưng không có gateway |
| 12 | `/dat-hang-thanh-cong/[id]` | Xác nhận đơn | `GET /orders/:id` | CÓ NHƯNG LỖI | Câu “trạng thái sẽ cập nhật sau khi giao thành công” sai: COD không tự PAID |
| 13 | `/dang-nhap` | Đăng nhập | `POST /auth/login` | HOÀN THIỆN | Chưa có server-side logout/revocation |
| 14 | `/dang-ky` | Đăng ký | `POST /auth/register` | HOÀN THIỆN | Không xác thực email |
| 15 | `/quen-mat-khau` | Yêu cầu reset | `POST /auth/forgot-password` | HOÀN THIỆN MỘT PHẦN | Nếu thiếu SMTP, mail bị capture ở memory; mặc định không gửi thật |
| 16 | `/dat-lai-mat-khau` | Đặt lại mật khẩu | `POST /auth/reset-password` | HOÀN THIỆN MỘT PHẦN | Phụ thuộc mail transport |
| 17 | `/tai-khoan` | Hồ sơ, đăng xuất local | `/customers/me`, `/auth/me` | HOÀN THIỆN | Không revoke token server-side |
| 18 | `/tai-khoan/dia-chi` | CRUD địa chỉ, ward picker | `/customers/me/addresses` | HOÀN THIỆN | Có test location/address auth |
| 19 | `/tai-khoan/doi-mat-khau` | Đổi mật khẩu | `PATCH /auth/change-password` | HOÀN THIỆN | Token cũ bị vô hiệu qua password version |
| 20 | `/don-hang` | Danh sách đơn, “Xem thêm” | `GET /orders/me` | HOÀN THIỆN | Phân trang thật |
| 21 | `/don-hang/[id]` | Chi tiết đơn, hủy, return/complaint/review | order/returns/complaints/reviews APIs | CÓ NHƯNG LỖI | Cho hủy khi `SHIPPING`; câu COD sau giao sai; shipment vẫn active |
| 22 | `/tra-hang` | Danh sách + tạo yêu cầu trả hàng | `/returns/me`, `/returns` | HOÀN THIỆN MỘT PHẦN | Chỉ tải trang 1, limit 100; picker eligible 30 |
| 23 | `/tra-hang/[id]` | Chi tiết return, evidence | `GET /returns/me/:id` | HOÀN THIỆN MỘT PHẦN | Không có tracking hoàn tiền thật |
| 24 | `/khieu-nai` | Danh sách + tạo khiếu nại | `/complaints/me`, `/complaints` | HOÀN THIỆN MỘT PHẦN | Chỉ trang 1/100; order picker 30 |
| 25 | `/khieu-nai/[id]` | Chi tiết khiếu nại | `GET /complaints/me/:id` | HOÀN THIỆN MỘT PHẦN | Backend không state machine |
| 26 | `/danh-gia` | Danh sách review của tôi + tạo review | `/reviews/me`, `/reviews` | HOÀN THIỆN MỘT PHẦN | Chỉ trang 1/100; eligible 30 |
| 27 | `/ma-giam-gia` | Danh sách voucher ACTIVE | `GET /vouchers` | HOÀN THIỆN MỘT PHẦN | Không có claim/phát hành cá nhân; dùng mã công khai |

### 3.1. Chức năng Customer Web **chưa có**

- Thanh toán online (VNPAY/MoMo/card) và callback/webhook.
- Trung tâm thông báo/email trạng thái đơn.
- Tracking shipment theo carrier (chỉ hiển thị dữ liệu shipment nếu có).
- Xác thực email, đăng nhập social, quên mật khẩu gửi mail thật mặc định.
- Hoàn tiền online; chỉ có return request.
- Yêu thích/điểm thưởng (không có backend; UI cũng không hiển thị).
- Hủy token toàn thiết bị/server-side logout.

---

## 4. Inventory Mobile — 30 màn hình

| # | Route | Chức năng chính | API | Trạng thái | Ghi chú |
|---:|---|---|---|---|---|
| 1 | `(tabs)/index` | Home, flash sale, sản phẩm mới | public catalog | HOÀN THIỆN | Trang chủ lấy API thật |
| 2 | `(tabs)/catalog` | Catalog, search, filter, infinite scroll | `GET /products` | HOÀN THIỆN | Có “Xem thêm” |
| 3 | `(tabs)/cart` | Giỏ hàng | `/carts/me` | HOÀN THIỆN | — |
| 4 | `(tabs)/trace` | Nhập/scan mã truy xuất | `/trace/:code` | HOÀN THIỆN | — |
| 5 | `(tabs)/account` | Tài khoản, điều hướng, đăng xuất local | `/auth/me` | HOÀN THIỆN | Không revoke token server-side |
| 6 | `login` | Đăng nhập | `POST /auth/login` | HOÀN THIỆN | — |
| 7 | `register` | Đăng ký | `POST /auth/register` | HOÀN THIỆN | Không xác thực email |
| 8 | `forgot-password` | Quên mật khẩu | `POST /auth/forgot-password` | HOÀN THIỆN MỘT PHẦN | Phụ thuộc SMTP |
| 9 | `reset-password` | Reset mật khẩu | `POST /auth/reset-password` | HOÀN THIỆN MỘT PHẦN | Phụ thuộc SMTP |
| 10 | `product/[id]` | Chi tiết sản phẩm, variant, review, giỏ | product/review APIs | HOÀN THIỆN MỘT PHẦN | Sản phẩm INACTIVE vẫn truy cập được qua API |
| 11 | `farms` | Danh sách farm | `GET /farms` | HOÀN THIỆN | — |
| 12 | `farm/[id]` | Chi tiết farm | `GET /farms/:id` | HOÀN THIỆN | — |
| 13 | `scan` | Quét QR | expo-camera | HOÀN THIỆN | Có test parse trace code |
| 14 | `trace/[code]` | Chi tiết trace | `GET /trace/:code` | HOÀN THIỆN MỘT PHẦN | Timeline thiếu event |
| 15 | `checkout` | Checkout COD, voucher, địa chỉ | checkout APIs | HOÀN THIỆN MỘT PHẦN | Chỉ COD |
| 16 | `orders` | Danh sách đơn | `GET /orders/me` | HOÀN THIỆN MỘT PHẦN | Chỉ 20 đơn, hiển thị “20/total” |
| 17 | `order/[id]` | Chi tiết đơn, hủy, aftersales | order/returns/complaints/reviews | CÓ NHƯNG LỖI | Cho hủy `SHIPPING`; COD copy sai |
| 18 | `returns` | Danh sách return | `GET /returns/me` | HOÀN THIỆN MỘT PHẦN | Chỉ trang 1/20 |
| 19 | `returns-new` | Tạo return | `POST /returns` | HOÀN THIỆN MỘT PHẦN | Pickers giới hạn |
| 20 | `return/[id]` | Chi tiết return | `GET /returns/me/:id` | HOÀN THIỆN MỘT PHẦN | Không tracking refund |
| 21 | `complaints` | Danh sách khiếu nại | `/complaints/me` | HOÀN THIỆN MỘT PHẦN | Chỉ trang 1/20 |
| 22 | `complaints-new` | Tạo khiếu nại | `POST /complaints` | HOÀN THIỆN MỘT PHẦN | Chọn order/items giới hạn |
| 23 | `complaint/[id]` | Chi tiết khiếu nại | `/complaints/me/:id` | HOÀN THIỆN MỘT PHẦN | Backend không state machine |
| 24 | `my-reviews` | Danh sách review | `/reviews/me` | HOÀN THIỆN MỘT PHẦN | Chỉ trang 1/20 |
| 25 | `my-reviews-new` | Tạo review | `POST /reviews` | HOÀN THIỆN MỘT PHẦN | Eligible items giới hạn |
| 26 | `vouchers` | Danh sách voucher | `GET /vouchers` | HOÀN THIỆN MỘT PHẦN | Không claim |
| 27 | `addresses` | Danh sách địa chỉ | `/customers/me/addresses` | HOÀN THIỆN | — |
| 28 | `address-edit` | Tạo/sửa địa chỉ | address APIs | HOÀN THIỆN | Ward picker |
| 29 | `profile-edit` | Sửa hồ sơ | `PATCH /customers/me` | HOÀN THIỆN | — |
| 30 | `change-password` | Đổi mật khẩu | `PATCH /auth/change-password` | HOÀN THIỆN | — |

### 4.1. Chức năng Mobile **chưa có**

- Push notification/FCM, deep link trạng thái đơn.
- Thanh toán online.
- Tracking shipment/carrier.
- Trung tâm thông báo.
- Tải toàn bộ lịch sử return/complaint/review/order (chỉ trang đầu).
- Favorites/points (backend không có).
- Server-side logout/revocation.

---

## 5. Inventory backend, API và DB

### 5.1. Controller/API surface (30 controller, 151 route)

| Module | Route chính | Public/Auth | Trạng thái | Ghi chú |
|---|---|---|---|---|
| Auth | `POST /auth/login`, `/register`, `/forgot-password`, `/reset-password`; `GET /auth/me`; `PATCH /auth/change-password` | Public + JWT | HOÀN THIỆN MỘT PHẦN | Không logout/revoke; JWT secret fail-open |
| Carts | `GET/POST/PATCH/DELETE /carts/me` | Customer | HOÀN THIỆN | Server-side cart |
| Categories | `GET /categories`, `GET /categories/:id`; Admin CRUD | Public + Admin | HOÀN THIỆN | — |
| Certificates | `GET /certificates`, `/farm/:farmId/valid`, `/:id`; create/verify | Public + Admin | HOÀN THIỆN | — |
| Complaints | Customer create/list/detail; Admin list/detail/update | Auth | HOÀN THIỆN MỘT PHẦN | Backend update không state machine |
| Evidence | Upload/read evidence | Auth/optional | HOÀN THIỆN | Lưu local, giới hạn ảnh |
| Farms | Public list/detail; Admin CRUD | Public + Admin | HOÀN THIỆN MỘT PHẦN | Không portal nông trại |
| Finance | Settlements/payouts/commission | Admin | CÓ NHƯNG LỖI | Refund 0, settle trước COD |
| Harvests | Public list/detail; Admin create/update | Public + Admin | HOÀN THIỆN MỘT PHẦN | Không có UI tạo/sửa |
| Health | `GET /health` | Public | HOÀN THIỆN | Check DB; không metrics |
| Inventory | balances/movements/inbound/adjust/reserve/release | Admin/internal | HOÀN THIỆN MỘT PHẦN | `blocked` không release; adjust idempotent |
| Warehouse docs | CRUD draft/complete/cancel | Admin | CÓ NHƯNG LỖI | RETURN cộng sellable |
| Locations | provinces/wards | Public | HOÀN THIỆN | Dữ liệu Hưng Yên |
| Lots | Public list/detail; Admin create/update/recall/QR | Public + Admin | HOÀN THIỆN MỘT PHẦN | Phụ thuộc harvest |
| Orders | checkout/preview, customer orders/cancel, Admin list/detail/update status | Auth | CÓ NHƯNG LỖI | COD/state/shipment mâu thuẫn |
| Partners | Public list/detail; Admin CRUD | Public + Admin | CÓ NHƯNG LỖI | Lộ bank/tax công khai |
| Payments | list/create/update status/refund | Admin | HOÀN THIỆN MỘT PHẦN | Refund completed ngay, không gateway |
| Product images | upload/update/delete/reorder/primary | Admin | HOÀN THIỆN | Local disk |
| Products | Public list/detail; Admin CRUD, variant | Public + Admin | HOÀN THIỆN MỘT PHẦN | Public detail không lọc status |
| Promotions | vouchers, discounts, flash sales | Public + Admin | CÓ NHƯNG LỖI | PERCENT không chặn >100 |
| Quality control | Admin list/create/detail | Admin | HOÀN THIỆN | Ghi trace QC |
| Reports | summary/daily/export | Admin | HOÀN THIỆN | Có test |
| Returns | Customer create/list/detail; Admin list/detail/update | Auth | CÓ NHƯNG LỖI | Không state machine/stock/refund integrity |
| Reviews | Public product reviews; customer own/create; Admin moderate | Mixed | HOÀN THIỆN MỘT PHẦN | Pagination client hạn chế |
| Farming events | Public by season; Admin create | Public + Admin | HOÀN THIỆN MỘT PHẦN | Không UI |
| Seasons | Public list/detail; Admin create/update | Public + Admin | HOÀN THIỆN MỘT PHẦN | UI chỉ create |
| Shipments | list/detail/create/update status | Admin | CÓ NHƯNG LỖI | Không UI; invariant sai |
| Traceability | `GET /trace/:code` | Public | HOÀN THIỆN MỘT PHẦN | Thiếu event chain |
| Users | customers CRUD/me/addresses | Auth/Admin | HOÀN THIỆN MỘT PHẦN | Chỉ 2 role |
| Warehouses | Public list? Admin CRUD/deactivate | Public + Admin | HOÀN THIỆN | Guard deactivation |

### 5.2. Nhóm model Prisma (52 model)

- **Identity/auth:** `User`, `Customer`, `Address`, `PasswordResetToken`, `AuditLog`.
- **Catalog:** `Category`, `Product`, `ProductVariant`, `ProductImage`, `ProductLot`, `Harvest`, `Season`, `Farm`, `Partner`, `Certificate`, `QcInspection`.
- **Trace:** `TraceEvent`.
- **Sales:** `Cart`, `CartItem`, `Order`, `PartnerOrder`, `OrderItem`, `Fulfillment`, `Shipment`, `ShipmentEvent`.
- **Inventory:** `Warehouse`, `InventoryBalance`, `InventoryAllocation`, `InventoryMovement`, `WarehouseDocument`, `WarehouseDocumentLine`.
- **Money:** `Payment`, `Refund`, `Settlement`, `SettlementLine`, `Payout`, `CommissionRule`.
- **Promotion:** `Voucher`, `VoucherRedemption`, `ProductDiscount`, `FlashSale`, `FlashSaleItem`.
- **After-sales:** `ReturnRequest`, `Complaint`, `Review`, `Evidence`.
- **Ops:** `AppIdempotencyKey`, `CodeSequence`.

### 5.3. DB/migration

- 11 migration trong repo; test DB đã áp đủ 11 theo Report 13.
- Dev DB hiện chỉ có 9 migration (thiếu `app_idempotency_keys` và unique settlement line), nên local dev sẽ lỗi ở adjust/payout/refund cho tới khi áp migration.
- Có dấu hiệu checksum drift giữa môi trường; cần backup + migration rehearsal trước khi release.
- Không có production bootstrap path; `prisma/seed.ts` xóa toàn bộ bảng (`deleteMany`) và tạo dữ liệu demo, không có guard `NODE_ENV`/xác nhận.

---

## 6. Ma trận tính năng hợp nhất

Chú thích cột: **A** = Admin, **W** = Customer Web, **M** = Mobile, **API/DB** = backend. Ký hiệu: **HT** Hoàn thiện, **HTMP** Hoàn thiện một phần, **CNL** Có nhưng lỗi, **CCH** Chưa có, **CXV** Chưa xác minh.

| ID | Năng lực | A | W | M | API/DB | Test/evidence | Kết luận |
|---|---|---|---|---|---|---|---|
| F-01 | Đăng nhập/đăng ký/JWT | HTMP | HTMP | HTMP | Có | auth-account, password-version | HTMP — secret fail-open, không revoke |
| F-02 | Quên/đổi mật khẩu | HTMP | HTMP | HTMP | Có | auth tests | HTMP — SMTP mặc định capture |
| F-03 | Hồ sơ khách hàng | HT | HT | HT | Có | address-auth | HT |
| F-04 | Địa chỉ giao hàng/ward | HT | HT | HT | Có | locations/address tests | HT |
| F-05 | Quản lý user/RBAC | HTMP | — | — | Có | users tests | HTMP — chỉ ADMIN/CUSTOMER, không staff |
| F-06 | Đối tác/farm | HTMP | HT | HT | Có | farms tests | HTMP — public partner lộ dữ liệu |
| F-07 | Mùa vụ | HTMP | — | — | Có | harvest/season tests | HTMP — UI chỉ tạo, không sửa/đóng |
| F-08 | Vụ thu hoạch | CCH | — | — | Có | harvest tests | HTMP — API có, UI không |
| F-09 | Farming event | CCH | — | — | Có | `mutation-acceptance.e2e-spec.ts:232-245` | HTMP — API + E2E, UI không |
| F-10 | Danh mục sản phẩm | HT | HT | HT | Có | category/product tests | HT |
| F-11 | Sản phẩm/variant/ảnh | HTMP | HTMP | HTMP | Có | product tests | HTMP — inactive public, ảnh local |
| F-12 | Giảm giá sản phẩm | CNL | HT | HT | Có | promotions tests | CNL — PERCENT >100 → giá âm |
| F-13 | Voucher | HTMP | HTMP | HTMP | Có | promotion tests | HTMP — không claim/target |
| F-14 | Flash sale | HT | HT | HT | Có | concurrency/flash sale tests | HT |
| F-15 | Giỏ hàng | — | HT | HT | Có | cart tests | HT |
| F-16 | Checkout COD/idempotency | — | HTMP | HTMP | Có | checkout/idempotency E2E | HTMP — chỉ COD, method khác không có flow |
| F-17 | Thanh toán online/gateway | CCH | CCH | CCH | CCH | — | CCH |
| F-18 | Vòng đời đơn hàng | HTMP | HTMP | HTMP | Có | order tests | CNL — cancel `SHIPPING` mâu thuẫn shipment |
| F-19 | Thu COD | HT | — | — | Có | payment-collection | HTMP — copy client sai |
| F-20 | Shipment | CCH | CCH | CCH | Có | delivery-return | CNL — không UI, invariant sai |
| F-21 | Return request | HTMP | HTMP | HTMP | Có | delivery-return/aftersales | CNL — không state machine/stock |
| F-22 | Refund | CCH | CCH | CCH | Có | refund tests | CNL — không UI, refundId tùy ý, completed ngay |
| F-23 | Complaint | HTMP | HTMP | HTMP | Có | aftersales | HTMP — backend không transition |
| F-24 | Review | HT | HTMP | HTMP | Có | review tests | HTMP — client chỉ trang 1/giới hạn |
| F-25 | QC | HT | — | — | Có | lot-qc | HT |
| F-26 | Chứng nhận | HT | HT | HT | Có | certificate tests | HT |
| F-27 | Lô/QR/recall | HTMP | HT | HT | Có | lot-qc/harvest | HTMP — thiếu harvest UI |
| F-28 | Truy xuất nguồn gốc | HTMP | HTMP | HTMP | Có | trace tests | HTMP — thiếu 4 event, thiếu authoring |
| F-29 | Kho | HT | — | — | Có | warehouse tests | HT |
| F-30 | Tồn kho/FEFO | HTMP | — | — | Có | inventory/FEFO/stress | HTMP — blocked không release |
| F-31 | Phiếu kho | CNL | — | — | Có | warehouse chronology | CNL — RETURN vào sellable |
| F-32 | Hoa hồng | HT | — | — | Có | commission | HT |
| F-33 | Settlement | CNL | — | — | Có | settlement | CNL — refund 0, COD chưa thu |
| F-34 | Payout | HTMP | — | — | Có | settlement/idempotency | HTMP — phụ thuộc settlement sai |
| F-35 | Báo cáo/export | HT | — | — | Có | reports tests | HT |
| F-36 | Thông báo | CCH | CCH | CCH | CCH | — | CCH |
| F-37 | Audit log | CCH | CCH | CCH | Ghi only | audit unit | CCH read/UI |
| F-38 | Health/observability | CCH | — | — | Có health | health route | HTMP — không metrics/alert |
| F-39 | Upload/evidence | HT | HT | HT | Có | product-images/evidence | HTMP — local disk, single node |
| F-40 | Tìm kiếm/phân trang | HT | HTMP | HTMP | Có | query-dto | HTMP — nhiều list client cắt trang |
| F-41 | CI/CD/backup/restore | CCH | — | — | CCH | không có file CI | CCH |
| F-42 | Migration/bootstrap | HTMP | — | — | Có | Report 13 | HTMP — dev lệch 9/11, seed phá DB |
| F-43 | Định dạng tiếng Việt/VND | HT | HT | HT | Có | format tests | HT — VND, tiếng Việt |
| F-44 | Phân quyền chi tiết/portal đối tác | CCH | CCH | CCH | CCH | — | CCH |

**Đọc ma trận:** không có tính năng nào ngoài các luồng catalog/QC/báo cáo đạt “hoàn thiện” trọn vẹn. Nhóm thương mại cốt lõi (đơn – giao – hoàn – tiền – settlement) đều ở mức một phần hoặc lỗi.

---

## 7. Phát hiện nghiêm trọng — bằng chứng và tác động

### 7.1. Danh sách phát hiện

#### C-01 — JWT secret fail-open (P0, bảo mật)

**Bằng chứng:**

- `apps/api/src/config/configuration.ts:24`: `jwtSecret: process.env.JWT_SECRET ?? 'CHANGE_ME'`.
- `apps/api/src/auth/auth.module.ts:23`: cùng fallback trong `JwtModule.registerAsync`.
- `apps/api/src/auth/jwt.strategy.ts:32`: strategy dùng cùng secret, không kiểm tra độ mạnh/khác rỗng.
- Không có validation startup nào từ chối `JWT_SECRET` thiếu, rỗng, hoặc `CHANGE_ME`.

**Tác động:** nếu deploy thiếu env, server vẫn chạy và chấp nhận token ký bằng secret công khai `CHANGE_ME`. Kẻ tấn công có thể thử forge token cho `sub` của một ADMIN (ID là số tăng dần, dễ đoán) và strategy sẽ lấy role từ DB. Đây là lỗi bảo mật P0, không phụ thuộc UI.

**Kết luận:** phải fail-closed khi thiếu secret; sau khi sửa phải rotate secret và thu hồi toàn bộ token cũ.

---

#### C-02 — Shipment tạo cho đơn đã hủy; DELIVERED trên đơn hủy bị kẹt (P0, đơn/tồn kho)

**Bằng chứng:**

- `apps/api/src/shipments/shipments.service.ts:32-58`: `create()` chỉ kiểm tra `partnerOrder` tồn tại, không kiểm tra `OrderStatus`/`PartnerOrderStatus`, không chặn `CANCELLED`/`DELIVERED`.
- `apps/api/src/shipments/shipments.service.ts:165-195`: khi shipment `DELIVERED`, code đổi partner order sang `DELIVERED` bất kể trạng thái trước đó, rồi đổi order sang `DELIVERED` nếu tất cả partner order đã delivered; sau đó gọi `consumeOrderStock`.
- Nếu order đã `CANCELLED` từ `SHIPPING`, reservation đã bị chuyển thành `blocked`; `consumeOrderStock` không tìm đủ reserved/on-hand và ném lỗi. Toàn bộ transaction rollback, shipment không đạt được `DELIVERED`, event không được ghi và shipment bị kẹt ở trạng thái cũ.
- `apps/api/src/shipments/dto/shipment.dto.ts:24-37`: DTO chỉ nhận enum status, không ràng buộc theo order.

**Tác động:** dữ liệu vận chuyển và đơn hàng phân kỳ; không thể hoàn tất giao hàng cho một đơn đã hủy; nếu đơn chưa hủy nhưng shipment được tạo sai, trạng thái vận chuyển không phản ánh nghiệp vụ. Không có test nào trong `apps/api/test` tạo shipment cho order `CANCELLED` hoặc kiểm tra nhánh này.

---

#### C-03 — Shipment `RETURNED` chỉ ghi trace, không xử lý nghiệp vụ (P0, hoàn hàng)

**Bằng chứng:**

- `apps/api/src/shipments/shipments.service.ts:208-224`: nhánh `RETURNED` chỉ lấy allocation và tạo `TraceEvent` với mô tả “chờ kiểm định lại”; **không** cập nhật order/partner order, không tạo return request, không chuyển `reserved` sang `blocked`, không tạo phiếu nhập, không tạo refund.
- Comment tại `:209` nói “Returned goods must go through quarantine”, nhưng code không làm việc đó.
- `apps/api/src/shipments/shipments.service.ts:197-206`: `DELIVERY_FAILED` chỉ đưa partner order về `SHIPPING`; không giải phóng/khóa tồn kho, không có hàng đợi xử lý.

**Tác động:** giao thất bại/hoàn hàng để lại đơn ở `SHIPPING`, reservation bị giữ, hàng không vào kho, không có điểm bắt đầu cho QC lại. Trace báo “RETURNED” nhưng kho và tiền không thay đổi — sai lệch nghiêm trọng giữa trace và thực tế.

**Test hiện tại:** `apps/api/test/business-rules/delivery-return.spec.ts:179-215` chỉ khẳng định có trace `RETURNED` và **không cộng stock vào sellable**; không kiểm tra quarantine, trạng thái order, return request hay refund. Đây là test bảo vệ hành vi hẹp, không chứng minh luồng hoàn hàng đầy đủ.

---

#### C-04 — `blocked` chỉ tăng, không bao giờ được giải phóng (P0, tồn kho)

**Bằng chứng:**

- `apps/api/src/inventory/inventory.service.ts:462-483`: `quarantineStock()` thực hiện `reserved = reserved - qty`, `blocked = blocked + qty`.
- Tìm toàn bộ `apps/api/src` cho thấy không có `UPDATE` nào giảm `blocked`, không có method `releaseBlocked`/`unblock`/`passQc`. `blocked` chỉ được đọc và cộng.
- `apps/api/src/orders/orders.service.ts:1132-1143` và `:1175-1179`: hủy đơn từ `SHIPPING` chuyển reservation sang `blocked` và comment nói chờ “return/re-inspection flow”.
- `apps/api/src/inventory/inventory.service.ts:450-451` cũng khẳng định “blocked units wait for the return/inspection flow”.

**Tác động:** hủy đơn khi đang giao khiến số lượng hàng bị khóa vĩnh viễn. Không có cách đưa hàng đã QC lại vào bán, không có cách ghi nhận hàng hỏng/tiêu hủy. Tồn kho hiển thị `available` giảm vĩnh viễn dù hàng có thể đã về kho.

---

#### C-05 — Return không có state machine, nhận `refundId` tùy ý (P0/P1, hoàn tiền)

**Bằng chứng:**

- `apps/api/src/returns/dto/return.dto.ts:42-52`: `UpdateReturnRequestDto` chỉ `@IsEnum(ReturnRequestStatus)` và `refundId?: number`.
- `apps/api/src/returns/returns.service.ts:295-312`: `updateStatus()` không kiểm tra transition hợp lệ, không kiểm tra return thuộc order/payment nào, không kiểm tra refund tồn tại, không kiểm tra refund thuộc đúng payment, không kiểm tra status refund, không kiểm tra số tiền refund khớp quantity/price.
- `returnRequest.refundId` chỉ là FK tùy chọn; có thể trỏ sang refund của đơn khác.
- `apps/api/src/returns/returns.service.ts:50-53` comment nói hàng hoàn phải quarantine và QC lại, nhưng `updateStatus` không có inventory/warehouse/trace side effect.

**Tác động:** Admin/API có thể đánh dấu `REFUNDED` mà không có tiền hoàn thực; hoặc gắn return với refund sai. Return không tạo phiếu nhập, không khóa hàng, không QC lại. Đây là lỗi toàn vẹn tiền và kho, không chỉ UX.

---

#### C-06 — Không có UI tạo refund; refund được ghi COMPLETED ngay (P0/P1)

**Bằng chứng:**

- `apps/admin-web/src/lib/api/resources.ts:192-194` chỉ có `payments`, `updatePaymentStatus`; không có `refunds`, `createRefund`, `listRefunds`.
- `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx:185-193` yêu cầu nhập **ID hoàn tiền bằng tay** khi chuyển return sang `REFUNDED`; không có màn hình tạo refund, không có dropdown refund hợp lệ.
- `apps/api/src/payments/payments.service.ts:264-271`: refund được tạo với `status: RefundStatus.COMPLETED`, `completedAt` ngay lập tức; không có gateway, không có bước PENDING/PROCESSING, không có mã giao dịch ngân hàng.
- `apps/api/src/payments/payments.service.ts:39-49`: `POST /payments` tạo payment `PENDING` cho bất kỳ method nào, kể cả VNPAY/MOCK_ONLINE, nhưng không có khởi tạo thanh toán/callback.

**Tác động:** không thể vận hành hoàn tiền thực tế từ Admin. Nếu dùng API, hệ thống ghi nhận đã hoàn tiền ngay cả khi chưa chuyển tiền; báo cáo và settlement sẽ lệch. Với COD, đây là ghi nhận thủ công không có bằng chứng; với online payment sẽ là sai sự thật.

---

#### C-07 — Phiếu kho `RETURN` cộng thẳng vào hàng bán được (P0, QC)

**Bằng chứng:**

- `apps/api/src/inventory/warehouse-documents.service.ts:403-426`: `INBOUND` và `RETURN` đều gọi `changeOnHand(+qty)`; `RETURN` chỉ khác movement type.
- Không có bước `blocked`/QC trước khi cộng `on_hand`; không có kiểm tra lot đang bị quarantine.
- Admin UI cho chọn `RETURN` tại `apps/admin-web/src/app/(admin)/warehouse-documents/page.tsx:171-172`; mapping loại phiếu tại `apps/admin-web/src/lib/status/index.ts:222-226`.

**Tác động:** hàng hoàn có thể được nhập lại và bán ngay, bỏ qua kiểm định chất lượng. Nếu đơn trước đó đã bị hủy ở `SHIPPING` và `blocked` vẫn còn, phiếu RETURN làm `on_hand` tăng thêm trong khi `blocked` không giảm: vừa thổi phồng tồn kho vật lý, vừa giữ hàng khóa vĩnh viễn.

---

#### C-08 — Settlement không trừ refund và không yêu cầu COD đã thu (P0/P1, dòng tiền)

**Bằng chứng:**

- `apps/api/src/finance/settlements.service.ts:86-93`: chỉ lấy `partnerOrder.status = DELIVERED`, trong kỳ, chưa có settlement line; không kiểm tra payment `PAID`.
- `apps/api/src/finance/settlements.service.ts:95-114`: `let refundTotal = 0;` và mỗi line gán `refundAmount: 0`; payable = gross − refund 0 − commission + adjustment.
- Cùng file `:31` định nghĩa công thức đúng có refund, nhưng dữ liệu refund chưa bao giờ được nạp.
- `apps/api/src/finance/settlements.service.ts:133` lưu `refundAmount: round2(refundTotal)` = 0.

**Tác động:** đối tác được settle trên doanh thu gộp dù khách đã được refund; nền tảng có thể lỗ phần refund. Ngoài ra, với COD, đơn `DELIVERED` nhưng payment còn `PENDING` vẫn được settle — nền tảng trả tiền đối tác trước khi thu được tiền khách. Đây phải là quyết định nghiệp vụ rõ ràng (settle theo delivery hay theo cash collected) và phải được enforce, không thể để ngầm.

---

#### C-09 — Giảm giá `PERCENT` không có upper bound (P1, giá âm)

**Bằng chứng:**

- `apps/api/src/promotions/dto/promotion.dto.ts:74-102`: `discountValue` chỉ có `@Min(0)`, không `@Max(100)`.
- `apps/api/src/promotions/promotions.service.ts:379-382`: `basePrice * (1 - value / 100)`, không clamp.
- Admin UI chặn tại `apps/admin-web/src/app/(admin)/product-discounts/page.tsx:233-242` (`max=100`), nhưng API trực tiếp không bị chặn.
- Test `promotions.spec.ts` không kiểm tra `PERCENT > 100`.

**Tác động:** tạo discount 200% qua API sinh `unitPrice` âm, có thể làm tổng đơn âm hoặc lỗi tính tiền. UI không bảo vệ được API; đây là lỗi validation backend.

---

#### C-10 — API công khai trả dữ liệu ngân hàng/thuế của Partner (P1, dữ liệu cá nhân)

**Bằng chứng:**

- `apps/api/src/partners/partners.controller.ts:24-36`: `GET /partners` và `GET /partners/:id` đều `@Public()`.
- `apps/api/src/partners/partners.service.ts:36-68`: trả full `Partner` row, không select/chê field.
- `apps/api/prisma/schema.prisma:396-399`: `taxCode`, `bankAccountName`, `bankAccountNumber`, `bankName`.
- Trace public có filter an toàn, nhưng `/partners` lại không; đây là hai chính sách dữ liệu không nhất quán.

**Tác động:** bất kỳ ai cũng đọc được số tài khoản ngân hàng, tên chủ tài khoản, mã số thuế của đối tác. Đây là rò rỉ dữ liệu nhạy cảm, cần P1 ngay cả khi chưa bán thật.

---

#### C-11 — Sản phẩm INACTIVE vẫn truy cập công khai bằng ID (P1/P2)

**Bằng chứng:**

- `apps/api/src/products/products.service.ts:102-115`: public list chỉ thêm filter `status` nếu query có `status`.
- `apps/api/src/products/products.service.ts:142-155`: `findOne` không kiểm tra `status`.
- Customer Web/Mobile luôn gửi `status=ACTIVE` cho list (`apps/customer-web/src/lib/api/resources.ts:118-128`, `apps/mobile/src/lib/resources.ts:134-142`), nhưng `GET /products/:id` không có filter.
- `GET /products/:id` là public.

**Tác động:** sản phẩm đã ngừng bán vẫn xem được qua URL/ID, có thể lộ giá, mô tả, variant, hình ảnh; nếu client nào cho phép thêm vào giỏ từ dữ liệu đó, checkout backend sẽ từ chối nhưng trải nghiệm sai. Không phải lỗi bảo mật nghiêm trọng như partner, nhưng là nhất quán catalog.

---

#### C-12 — Copy COD sai ở hai client và Swagger (P1, niềm tin/đối soát)

**Bằng chứng:**

- `apps/api/src/orders/orders.controller.ts:112`: summary “DELIVERED settles COD”.
- `apps/api/src/orders/orders.service.ts:1125-1128`: code **deliberately NOT** mark COD PAID; chỉ `PATCH /payments/:id/status` mới set `paidAt`.
- Customer Web `apps/customer-web/src/components/order/OrderDetail.tsx:371-375`: “Trạng thái sẽ chuyển sang đã thanh toán sau khi giao thành công”.
- Customer Web `apps/customer-web/src/components/checkout/CheckoutSuccess.tsx:126-128`: cùng nội dung.
- Admin order detail `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx:305-318` mô tả đúng và có nút thu COD.

**Tác động:** khách hàng tin rằng giao xong là tự động PAID; thực tế payment vẫn `PENDING` cho tới khi Admin bấm thu. Điều này gây tranh chấp, làm dashboard doanh thu không khớp kỳ vọng và che giấu việc COD chưa được đối soát. Swagger sai làm tích hợp bên ngoài hiểu nhầm.

---

#### C-13 — Hủy đơn `SHIPPING` trong khi shipment vẫn hoạt động (P0/P1, state chéo)

**Bằng chứng:**

- `apps/api/src/orders/orders.service.ts:1257-1265`: `ALLOWED_TRANSITIONS.SHIPPING = [DELIVERED, CANCELLED]`.
- `packages/shared-domain/src/statuses.ts:208-215`: `CANCELLABLE_ORDER_STATUSES` chứa `"SHIPPING"`.
- Customer Web `OrderDetail.tsx:447` dùng danh sách này; Mobile `order/[id].tsx:113` cũng vậy.
- Shipment transitions `apps/api/src/shipments/shipments.service.ts:13-21` không có nhánh cancel; `create/updateStatus` không kiểm tra order status.
- Test Mobile `status.test.ts:20-21` còn khẳng định `CANCELLABLE_ORDER_STATUSES` chứa `SHIPPING`.

**Tác động:** khách hủy khi đang giao → order `CANCELLED`, stock bị quarantine; shipment vẫn `PENDING/IN_TRANSIT` và có thể được cập nhật `DELIVERED` (dẫn C-02/C-04). Không có quy tắc ai thắng: đơn hay shipment. Đây là mâu thuẫn state machine liên module, phải chốt policy và enforce một nơi.

---

#### C-14 — Trace chain không đầy đủ và không có công cụ authoring (P1, truy xuất)

**Bằng chứng:**

- `apps/api/prisma/schema.prisma:70-79`: enum có 8 loại `HARVEST, QC, PACKING, WAREHOUSE_IN, WAREHOUSE_OUT, SHIPPING, DELIVERED, RETURNED`.
- Tìm toàn bộ `apps/api/src`, chỉ có 4 chỗ ghi trace:
  - `lots.service.ts:142` — `HARVEST`
  - `quality-control.service.ts:77` — `QC`
  - `warehouse-documents.service.ts:459` — `WAREHOUSE_IN`
  - `shipments.service.ts:217` — `RETURNED`
- Không có `PACKING`, `WAREHOUSE_OUT`, `SHIPPING`, `DELIVERED`; outbound document không ghi `WAREHOUSE_OUT`.
- Admin chỉ có form tạo season trong farm detail (`apps/admin-web/src/app/(admin)/farms/[id]/page.tsx:67-73,247-252`), không có UI tạo harvest/farming event; form tạo lot bắt buộc chọn harvest có sẵn (`apps/admin-web/src/app/(admin)/lots/page.tsx:29,174-186`).
- `apps/admin-web/src/lib/api/resources.ts:103-107` có wrapper harvest/farming event nhưng không có page dùng `createHarvest`/`createFarmingEvent`.

**Tác động:** QR trace có thể có nguồn gốc mùa vụ/QC/nhập kho nhưng thiếu đóng gói, xuất kho, vận chuyển, giao hàng. Đây là giá trị cốt lõi của sản phẩm nhưng chưa khép kín. Ngoài ra, vận hành thực tế không thể tạo harvest/farming event nếu chỉ dùng Admin UI.

---

#### C-15 — Return/complaint transition chỉ được bảo vệ ở UI (P1, API)

**Bằng chứng:**

- Admin return: `RETURN_TRANSITIONS` tại `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx:27-53`, chỉ dùng để render select; API `returns.service.ts:295-312` nhận mọi `ReturnRequestStatus`.
- Complaint: `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx:200-217` có `COMPLAINT_TRANSITIONS`, nhưng `apps/api/src/complaints/complaints.service.ts:153-165` nhận mọi `ComplaintStatus`.
- Không có kiểm tra transition trong DTO/service.

**Tác động:** API trực tiếp có thể nhảy trạng thái (ví dụ `REJECTED` → `REFUNDED`, `RESOLVED` → `OPEN`), làm audit và báo cáo sai. Đây là ví dụ rõ của “guard chỉ nằm ở UI”.

---

#### C-16 — Client cắt danh sách ở trang đầu (P2, dữ liệu)

**Bằng chứng:**

- Customer Web returns: `apps/customer-web/src/components/order/ReturnListView.tsx:66` `FETCH_LIMIT = 100`, `:69` `ELIGIBLE_LIMIT = 30`; list query `:360-367` chỉ `page:1`, không load-more.
- Complaints: `ComplaintListView.tsx:59,66,119-120,359-366` — list 100, order picker 30, page 1.
- Reviews: `ReviewListView.tsx:57,60,172,351-356` — list 100, eligible 30, page 1.
- Mobile returns/complaints/reviews: `apps/mobile/app/returns.tsx`, `complaints.tsx`, `my-reviews.tsx` dùng `page:1, limit:20`; orders `orders.tsx:33` limit 20 và hiển thị `list.length/total` tại `:171-172`.
- Customer Web orders có phân trang đúng tại `OrderListView.tsx:119-131,195`, nên vấn đề chỉ ở các list nêu trên.

**Tác động:** khách có >100 return/complaint/review (web) hoặc >20 (mobile) không thể xem lịch sử cũ; picker không cho chọn order/item cũ. Không phải lỗi giao dịch trực tiếp nhưng là thiếu hoàn thiện chức năng.

---

#### C-17 — Không có job hết hạn reservation (P1/P2, tồn kho)

**Bằng chứng:**

- Checkout reserve stock và order `PENDING_CONFIRMATION`; không tìm thấy scheduler/job `reservation expiry` trong `apps/api/src`.
- Không có `expiresAt`/TTL trên `InventoryAllocation`; không có `@nestjs/schedule`, cron, hay worker purge reservation.
- Order chỉ được giải phóng khi Admin/khách hủy hoặc khi delivered.

**Tác động:** đơn COD treo `PENDING_CONFIRMATION` giữ stock vô thời hạn. Trong bán nông sản tươi, điều này làm “cháy” tồn kho ảo. Cần policy timeout và job release (hoặc ít nhất cảnh báo/auto-cancel) trước khi vận hành thật.

---

#### C-18 — Mail mặc định là capture, không gửi thật (P1/P2, vận hành)

**Bằng chứng:**

- `apps/api/src/mail/mail.service.ts:1-23`: nếu không có SMTP, transport fallback là `test`; message được capture trong memory, không gửi ra ngoài.
- `mail.service.ts:17-21` nói rõ `test` không phải delivery và API báo `deliveryMode`; đây là hành vi trung thực, không phải “fake sent”.
- Tuy nhiên `AuthService` chỉ log warning khi mail không gửi được (test unit thấy `Password recovery mail could not be delivered`), không chặn khởi động/không cảnh báo vận hành.

**Tác động:** nếu quên cấu hình SMTP, khách bấm quên mật khẩu sẽ không nhận được mail; link chỉ nằm trong memory và mất khi restart. Đây là lỗi cấu hình có thể chấp nhận ở dev nhưng không chấp nhận ở production.

---

#### C-19 — Thiếu nền tảng phát hành/vận hành (P0/P1, release)

**Bằng chứng:**

- Không có `.github/`, `.gitlab-ci.yml`, `Dockerfile`, `docker-compose.yml` tại root.
- `backups/` có 7 file dump `.sql` (dev/test) nhưng không có log restore drill, không có script restore, không có RPO/RTO.
- Không có metrics/tracing/alerting; chỉ `GET /api/v1/health` kiểm tra DB (`apps/api/src/health/health.controller.ts`).
- Không có global rate limit; chỉ auth route có `ThrottlerModule`/`AuthThrottlerGuard` (`apps/api/src/auth/auth.module.ts:18`, `auth.controller.ts:35-75`).
- Không có audit log viewer: `AuditLog` chỉ được ghi trong `apps/api/src/common/audit/audit.service.ts:34`; không có controller/route đọc.
- Không có notification model/push/FCM/WebSocket; tìm toàn repo không thấy backend notification.
- Chỉ role `ADMIN`/`CUSTOMER` (`schema.prisma:18-21`), không có staff role, partner portal, granular permission.

**Tác động:** không thể vận hành an toàn nếu không có CI, backup/restore đã diễn tập, giám sát lỗi, audit access và phân quyền. Đây là các “release gates”, không phải tính năng trang trí.

---

### 7.2. Bảng ưu tiên phát hiện

| Mã | Mức | Vấn đề | Ảnh hưởng trực tiếp |
|---|---|---|---|
| C-01 | P0 | JWT fail-open | Bảo mật toàn hệ thống |
| C-02 | P0 | Shipment/order state divergence | Không thể giao/hủy nhất quán |
| C-03 | P0 | RETURNED không xử lý kho/đơn | Hoàn hàng treo |
| C-04 | P0 | `blocked` không release | Tồn kho chết vĩnh viễn |
| C-05 | P0 | Return/refund không state machine/ownership | Sai tiền, sai liên kết |
| C-06 | P0 | Không có UI refund; refund completed ngay | Không thể hoàn tiền thật |
| C-07 | P0 | Phiếu RETURN vào sellable | Bán hàng chưa QC |
| C-08 | P0/P1 | Settlement refund=0, COD chưa thu | Sai dòng tiền đối tác |
| C-09 | P1 | PERCENT >100 | Giá âm |
| C-10 | P1 | Partner public bank/tax | Rò rỉ dữ liệu |
| C-11 | P1/P2 | Product inactive public | Catalog sai |
| C-12 | P1 | Copy COD sai | Tranh chấp/đối soát sai |
| C-13 | P0/P1 | Cancel SHIPPING x shipment | State chéo |
| C-14 | P1 | Trace thiếu event/authoring | Mất giá trị truy xuất |
| C-15 | P1 | State chỉ UI | API bypass |
| C-16 | P2 | Pagination cắt | Thiếu lịch sử |
| C-17 | P1/P2 | Không expire reservation | Tồn kho ảo |
| C-18 | P1/P2 | Mail capture | Reset mật khẩu không tới |
| C-19 | P0/P1 | Thiếu CI/backup/observability/RBAC | Không vận hành an toàn |

---

## 8. Luồng nghiệp vụ bị đứt (end-to-end)

### 8.1. Luồng COD “happy path” — chạy được một phần

1. Khách thêm giỏ → `POST /carts/me/items`.
2. `POST /orders/checkout-preview` tính giá server.
3. `POST /orders/checkout` với COD + idempotency key → order `PENDING_CONFIRMATION`, payment `PENDING`, stock reserved.
4. Admin đổi `CONFIRMED → PREPARING → READY_TO_SHIP → SHIPPING → DELIVERED`.
5. `consumeOrderStock` trừ `on_hand` và `reserved`.
6. Admin bấm thu COD `PATCH /payments/:id/status` → `PAID`, `paidAt`.

**Kết luận:** đây là xương sống có thể dùng cho pilot COD nếu P0-01 và các lỗi state được đóng. Nhưng nó **không** bao gồm giao hàng qua shipment, hoàn hàng, refund, settlement đúng.

### 8.2. Luồng hủy khi đang giao — đứt

1. Order `SHIPPING`, shipment `IN_TRANSIT`.
2. Khách bấm hủy (UI cho phép).
3. `orders.service` chuyển `CANCELLED`, `quarantineStock` chuyển reserved → blocked.
4. Shipment vẫn `IN_TRANSIT`, không bị cancel.
5. Admin cập nhật shipment `DELIVERED`.
6. Shipment cố set order `DELIVERED`, `consumeOrderStock` fail vì reservation đã thành blocked.
7. Transaction rollback; shipment kẹt; hàng blocked vĩnh viễn.

**Kỳ vọng đúng:** một trong hai policy:
- Không cho khách hủy khi đã `SHIPPING`; hoặc
- Hủy order phải cancel shipment, tạo return-to-warehouse flow, và shipment không thể `DELIVERED`.

### 8.3. Luồng giao thất bại/hoàn hàng — đứt

1. Shipment `DELIVERY_FAILED` → partner order về `SHIPPING`; reservation vẫn giữ.
2. Shipment `RETURNED` → chỉ ghi trace event.
3. Không có order status kết thúc, không có stock movement, không có return request/refund.
4. Hàng về kho không được ghi nhận; reservation có thể treo đến khi hủy đơn, lúc đó thành blocked không release.

### 8.4. Luồng khách trả hàng/hoàn tiền — đứt ở Admin

1. Khách tạo return từ order `DELIVERED`, chọn item/quantity, evidence.
2. Admin duyệt return.
3. Admin muốn chuyển `REFUNDED`: UI bắt nhập “Mã hoàn tiền” số.
4. Không có màn hình tạo refund → Admin phải gọi API thủ công (nếu biết), hoặc bịa ID.
5. API refund (nếu gọi) tạo `COMPLETED` ngay; return update không kiểm tra refund thuộc payment nào.
6. Không có kho/quarantine/QC.

**Kỳ vọng đúng:** return state machine + refund entity link 1-1 với return + payment ownership + idempotency + kho nhập quarantine + QC + release/scrap + thông báo khách.

### 8.5. Luồng settlement/đối soát — sai số

1. Partner order `DELIVERED`.
2. Settlement lấy mọi partner order delivered, chưa settlement.
3. `refundAmount = 0` dù có refund.
4. Payable = gross − commission; payout trả đối tác.
5. Nếu COD chưa thu, nền tảng vẫn có thể trả tiền.
6. Báo cáo doanh thu (theo payment) và settlement (theo order) không khớp nhau.

### 8.6. Luồng truy xuất — thiếu mắt xích

1. Tạo farm → season (Admin).
2. Không có UI tạo harvest → API nếu gọi tay.
3. Tạo lot từ harvest → QC → inbound (trace có 4 event).
4. Outbound/packing/shipping/delivered không ghi trace.
5. Khách quét QR thấy timeline không đầy đủ, không có hành trình sau kho.

### 8.7. Luồng khởi tạo môi trường mới — không production-ready

1. Repo không có seed an toàn; `prisma/seed.ts` `deleteMany` toàn bộ và tạo demo.
2. Dev DB thiếu 2 migration; thao tác adjust/payout/refund sẽ lỗi.
3. Không có Docker/CI/backup restore; deployment phụ thuộc thao tác tay.
4. Không có tài khoản bootstrap production ngoài seed demo.

**Kết luận:** không thể dựng một môi trường bán thật lặp lại được chỉ từ repo.

### 8.8. Luồng thanh toán online — không tồn tại

- Enum có VNPAY/MOCK_ONLINE, DTO checkout nhận method.
- Customer Web/Mobile chỉ hiển thị COD.
- Không có API tạo payment URL, callback, webhook, verify signature, đối soát.
- Payment online nếu tạo qua API sẽ `PENDING` vĩnh viễn hoặc Admin phải mark PAID thủ công — không phải thanh toán thật.

### 8.9. Luồng khuyến mại — có thể tạo giá âm

- Admin UI chặn 100%, API không.
- Checkout dùng `unitPrice` âm; tổng đơn có thể âm hoặc sai.
- Flash sale có test riêng nhưng không bù được lỗ hổng product-discount.

---

## 9. UI-only, backend-only và chức năng thực sự thiếu

### 9.1. Có màn hình giả / feature chỉ có UI không?

**Không phát hiện màn hình giả hoàn toàn.** Các trang Admin/Customer/Mobile đều gọi API thật; không thấy mock data trong production components. Tuy nhiên có **guard chỉ tồn tại ở UI**, nghĩa là UI đúng nhưng API có thể bypass:

| Guard | UI | Backend |
|---|---|---|
| Return transition | `returns-complaints/page.tsx:27-53` | Không có; nhận mọi status |
| Complaint transition | `returns-complaints/page.tsx:200-217` | Không có; nhận mọi status |
| PERCENT ≤ 100 | `product-discounts/page.tsx:233-242` | Không có `@Max(100)` |
| Danh sách order/item eligible | Client limit 30 | API có phân trang nhưng client không tải thêm |
| COD “đã thu” | Admin phải bấm nút | API đúng; nhưng copy client nói tự động |
| Shipment status | Không có UI | API cho phép; invariant backend sai |

### 9.2. Backend-only (API có, UI không dùng)

- `POST /shipments`, `PATCH /shipments/:id/status`: chỉ hiển thị read-only trong order detail; không có trang vận chuyển.
- `POST /harvests`, `PATCH /harvests/:id`: không có UI tạo/sửa harvest.
- `POST /farming-events`: không có UI.
- `PATCH /seasons/:id`: không có UI sửa/đóng season.
- `POST /payments`, `GET /payments`, `POST /refunds`, `GET /refunds`: không có màn hình payment/refund center; chỉ order detail dùng `PATCH /payments/:id/status`.
- `GET /audit_logs`: **không tồn tại**; audit chỉ ghi.
- `POST /inventory/reserve`, `/release`: nội bộ/không UI.
- `GET /partners` public trả dữ liệu nhạy cảm; UI chỉ dùng một phần.
- Các endpoint public `GET /warehouses`, `/lots`, `/harvests`, `/certificates`, `/qc`, `/seasons`, `/farming-events/season/:id`, `/farms` có thể rộng hơn nhu cầu public; cần rà soát từng field.

### 9.3. Chức năng thực sự thiếu (không có code/DB)

| Nhóm | Thiếu |
|---|---|
| Thanh toán | Gateway, payment URL, callback/webhook, signature, reconciliation, refund gateway |
| Thông báo | Notification model, email transactional đầy đủ, SMS, push/FCM, in-app center, WebSocket |
| Vận chuyển | Carrier integration, label, tracking sync, delivery failure workflow, shipment UI |
| Hoàn hàng | Admin refund UI, return state machine, quarantine/QC release, return receipt |
| Truy xuất | Harvest/farming authoring UI, packing/outbound/shipping/delivered trace, public trace field review |
| Quản trị | Audit viewer, staff roles/RBAC, partner portal, approval/dual control |
| Vận hành | CI/CD, Docker/compose, metrics/tracing/alerting, backup restore drill, global rate limit, WAF/security headers |
| Khách hàng | Favorites, points/loyalty, email verification, server-side logout/revocation |
| Tồn kho | Reservation expiry job, blocked release/stocktake lifecycle |
| Báo cáo | Đối soát kế toán/COD, settlement refund correction, export audit trail |

**Phân biệt “thiếu trong MVP” và “không cần”:**

- Online payment và loyalty có thể ngoài MVP nếu chấp nhận COD-only; nhưng phải ghi rõ trong cam kết sản phẩm và không quảng cáo như đã có.
- Notification/email đơn hàng gần như bắt buộc cho bán thật; ít nhất transactional email khi đặt/duyệt/giao/hoàn.
- RBAC/partner portal có thể P2 nếu chỉ một seller vận hành, nhưng không thể gọi là “nền tảng đa đối tác” nếu không có.

---

## 10. Backlog ưu tiên P0 → P3

### 10.1. P0 — Không được xử lý đơn thật nếu chưa đóng

| ID | Việc phải làm | Tiêu chí nghiệm thu | Phụ thuộc |
|---|---|---|---|
| **P0-01** | JWT fail-closed | API từ chối khởi động nếu `JWT_SECRET` thiếu/rỗng/`CHANGE_ME`/quá ngắn; không còn fallback ở 3 file; test startup; rotate secret và invalidate token cũ | Không |
| **P0-02** | Khóa state order ↔ shipment | `POST /shipments` chỉ cho order/partner order ở trạng thái được phép; không tạo cho `CANCELLED`/`DELIVERED`; shipment `DELIVERED` không thể hoàn tất nếu order đã hủy; cancel order phải cancel/đóng shipment đang mở; `DELIVERY_FAILED`/`RETURNED` có kết cục rõ; test race cancel vs delivered | P0-03 stock model |
| **P0-03** | Return/refund end-to-end | State machine backend; refund phải thuộc đúng payment; tạo refund idempotent; Admin tạo refund từ return; return `REFUNDED` chỉ khi refund `COMPLETED`; không nhận refundId tùy ý; test API + UI | P0-02, P0-04 |
| **P0-04** | Chu trình quarantine → QC → release/scrap | Có thao tác giảm `blocked`; hàng hoàn vào `blocked`, không vào sellable; QC quyết định release/scrap; phiếu RETURN không cộng trực tiếp `on_hand`; test double-count và release | P0-03, migration nếu cần |
| **P0-05** | Settlement và COD | Settlement trừ refund thực tế; policy rõ ràng: chỉ settle khi COD `PAID` hoặc có ngoại lệ được duyệt; payout không vượt payable; test refund + COD pending; không settle trước thu tiền nếu chính sách yêu cầu | P0-03, P0-06 |
| **P0-06** | Cổng phát hành | CI bắt buộc; migration parity; backup + restore drill có log; secret management; không deploy bằng seed demo; rollback plan | Không |

### 10.2. P1 — Chặn release thương mại

| ID | Việc phải làm | Tiêu chí nghiệm thu |
|---|---|---|
| **P1-01** | Cap `PERCENT` | API `@Max(100)` (hoặc validate theo type), service clamp/reject; test >100 qua HTTP; giá không bao giờ âm |
| **P1-02** | Giảm dữ liệu public Partner | `GET /partners` chỉ trả field công khai; không bank/tax; test public response schema; có test field-level |
| **P1-03** | Product inactive | `GET /products/:id` chỉ trả ACTIVE cho public; test direct ID; Admin vẫn xem được |
| **P1-04** | Trace chain + authoring | UI harvest/farming event; trace `PACKING`, `WAREHOUSE_OUT`, `SHIPPING`, `DELIVERED`; test trace full chain; public trace chỉ field an toàn |
| **P1-05** | Sửa copy COD | Bỏ/đổi câu “tự động PAID sau giao”; Swagger summary đúng; test UI copy; Admin COD collection là bắt buộc |
| **P1-06** | Thông báo giao dịch tối thiểu | Email xác nhận đặt hàng/duyệt/giao/hoàn; retry/queue; không chặn checkout nếu mail lỗi; SMTP production fail-fast hoặc cảnh báo |
| **P1-07** | Reservation expiry | Job timeout cho order `PENDING_CONFIRMATION`/`CONFIRMED` chưa xử lý; release stock an toàn; test concurrent checkout/cancel |
| **P1-08** | Trung tâm vận hành đơn | Màn hình shipment + payment/refund + COD reconciliation; thao tác có audit; không cần gọi API tay |
| **P1-09** | Logout/revocation server-side | Endpoint revoke token/session version; logout web/mobile gọi server; test token cũ bị từ chối |

### 10.3. P2 — Hoàn thiện vận hành và nhất quán

| ID | Việc phải làm | Tiêu chí nghiệm thu |
|---|---|---|
| **P2-01** | State machine complaint backend | Chỉ cho transition hợp lệ; lưu resolution; test bypass |
| **P2-02** | Phân trang client | Return/complaint/review/order mobile + web có load-more; test >100/>20 bản ghi |
| **P2-03** | Audit viewer | API đọc audit có filter/role; UI chỉ ADMIN; test không lộ dữ liệu |
| **P2-04** | RBAC/staff/partner portal | Role chi tiết, phân quyền theo hành động; partner portal tối thiểu; test cách ly dữ liệu |
| **P2-05** | Bảo vệ API | Global rate limit, security headers, CORS chặt, Swagger tắt/giới hạn ở production |
| **P2-06** | Seed/bootstrap an toàn | Seed có guard môi trường; script bootstrap production không xóa DB; test dry-run |
| **P2-07** | Observability | Metrics, structured log, trace ID, alert DB/queue/lỗi; dashboard vận hành |
| **P2-08** | Carrier integration | Đồng bộ trạng thái với đơn vị vận chuyển; webhook; retry; test sandbox |
| **P2-09** | Notification center/push | In-app + push mobile; opt-in; deep link; test delivery token |
| **P2-10** | Kiểm soát kép | Duyệt refund/payout trên ngưỡng; audit; test phân quyền |

### 10.4. P3 — Hoàn thiện trải nghiệm/tài liệu

| ID | Việc phải làm | Tiêu chí nghiệm thu |
|---|---|---|
| **P3-01** | Sửa Swagger mô tả COD và endpoint | Tài liệu khớp code; test contract |
| **P3-02** | Thông báo lỗi thân thiện | Không lộ stack/SQL; message tiếng Việt; test 4xx/5xx |
| **P3-03** | Nhất quán nhãn trạng thái | Web/mobile/admin dùng shared-domain; test label |
| **P3-04** | Favorites/points (nếu muốn) | Chỉ làm khi có backend; không tạo UI giả |
| **P3-05** | Hướng dẫn vận hành | Runbook COD, return, refund, settlement, backup/restore |
| **P3-06** | Dọn cảnh báo test | Không còn `Not implemented` che lỗi; test ổn định |

---

## 11. Roadmap đề xuất, phụ thuộc và acceptance

Thứ tự dưới đây nhằm đưa hệ thống từ demo sang bán COD có kiểm soát. Không nên làm UI hào nhoáng trước khi P0 xong.

### Phase 0 — An toàn phát hành (bắt buộc trước mọi thứ)

**Phạm vi:** P0-01, P0-06; một phần P1-02/P1-03 nếu release public ngay.  
**Phụ thuộc:** không.  
**Acceptance:**

- API không khởi động với secret yếu; test config fail-closed.
- CI chạy unit + build + test DB; migration parity dev/test/staging.
- Backup full + restore thử trên DB trống, ghi log thời gian; RPO/RTO được chấp nhận.
- Không còn seed demo có thể chạy nhầm vào production.

### Phase 1 — Toàn vẹn đơn – kho – tiền

**Phạm vi:** P0-02, P0-03, P0-04, P0-05; P1-01.  
**Phụ thuộc:** Phase 0 (CI/migration).  
**Acceptance:**

- Có test chứng minh: không tạo shipment cho đơn hủy; không delivered đơn hủy; cancel `SHIPPING` đóng shipment và không treo stock.
- Return/refund: không thể `REFUNDED` nếu refund không tồn tại/sai payment/chưa completed; refund tạo idempotent; Admin UI tạo được refund.
- `blocked` tăng và giảm được; RETURN không cộng sellable trước QC; test double-count.
- Settlement trừ refund; policy COD được enforce; payout không vượt payable.
- PERCENT >100 bị chặn ở API.

### Phase 2 — Vận hành after-sales, vận chuyển và truy xuất

**Phạm vi:** P1-04, P1-05, P1-06, P1-07, P1-08; P0 UI còn lại.  
**Phụ thuộc:** Phase 1 state machine.  
**Acceptance:**

- Admin tạo shipment, cập nhật trạng thái, xử lý failed/returned; order detail hiển thị timeline thật.
- Admin tạo refund/payment reconciliation; COD report đối soát được.
- Trace có đủ packing/out/shipping/delivered; UI tạo harvest/farming event; QR hiển thị chuỗi.
- Email giao dịch hoạt động với SMTP thật; test sandbox.
- Timeout reservation có test.

### Phase 3 — Nhất quán và quản trị

**Phạm vi:** P2-01..P2-07, P2-10.  
**Phụ thuộc:** Phase 2 (audit/role/data).  
**Acceptance:**

- API từ chối transition bất hợp lệ của complaint/return (không chỉ UI).
- Tất cả list có phân trang đầy đủ; test dữ liệu >100/>20.
- Audit viewer hoạt động, role chỉ đọc phù hợp.
- RBAC/staff/partner portal có test cách ly.
- Metrics/alert chạy trên staging.

### Phase 4 — Mở rộng thương mại

**Phạm vi:** P2-08, P2-09, P3, online payment nếu quyết định.  
**Phụ thuộc:** Phase 1–3.  
**Acceptance:**

- Payment gateway sandbox có callback/webhook/refund/reconciliation; không mark PAID thủ công cho online.
- Push/in-app notification có opt-in/retry.
- Carrier sync có webhook sandbox.
- Không còn tính năng “UI giả” hoặc tài liệu sai.

---

## 12. Cổng bắt buộc trước khi bán hàng thật

Đây là checklist “go-live gate”. Mỗi mục cần **bằng chứng**, không chỉ lời khẳng định.

| Gate | Nội dung | Bằng chứng tối thiểu |
|---|---|---|
| **G1** | JWT secret fail-closed, secret mạnh, rotate | Test startup fail; config production đã set; token cũ invalid |
| **G2** | CI bắt buộc, test xanh trên commit release | Pipeline log; unit/E2E; không skip test |
| **G3** | Migration parity và backup/restore | `prisma migrate status`; danh sách migration; restore log; RPO/RTO |
| **G4** | Shipment/order invariant | Test matrix cancel/ship/deliver/fail/return; không còn stuck |
| **G5** | Return/refund ownership + state | Test refund sai payment/return; Admin UI tạo refund; idempotency |
| **G6** | Quarantine/QC lifecycle | Test blocked tăng/giảm; RETURN không sellable; release/scrap |
| **G7** | Settlement/COD/refund | Test COD pending không settle (nếu policy); refund trừ đúng; payout cap |
| **G8** | Pricing | Test PERCENT >100, amount > price, voucher âm; tổng đơn >=0 |
| **G9** | Trace chain | Test đủ 8 event; authoring harvest/farming; public field review |
| **G10** | Dữ liệu public | Test partner không bank/tax; product inactive; response schema |
| **G11** | Playwright UI E2E critical | Checkout COD → admin duyệt → giao → thu COD → return → refund trên UI |
| **G12** | Thông báo/SMTP | Email thật tới hộp thư test; retry/alert khi lỗi |
| **G13** | Vận hành | Metrics/alert; audit viewer; RBAC; on-call/runbook |
| **G14** | UAT với dữ liệu giống thật | Kịch bản COD/return/refund/settlement; không dùng seed demo; sign-off |
| **G15** | Quyết định nghiệp vụ | COD-only? settle khi delivered hay paid? return window? refund method? được ghi thành văn bản |

**Không được coi là đạt nếu:**

- Chỉ có unit test PASS nhưng không có E2E UI.
- Chỉ có API nhưng không có UI vận hành.
- Chỉ có backup file nhưng chưa restore thử.
- Chỉ có seed demo nhưng chưa có bootstrap production.
- Chỉ có tài liệu mô tả nhưng code không enforce.

---

## 13. Bản đồ test → tính năng và phần chưa được kiểm chứng

### 13.1. Bản đồ test hiện có

| Nhóm | Test tiêu biểu | Đã chứng minh | Chưa chứng minh |
|---|---|---|---|
| Auth | `auth-account.spec.ts`, `password-version.spec.ts`, `mail.spec.ts` | login/register/reset/change password; token version | secret fail-closed; revoke/logout; SMTP thật |
| Catalog | `category-product-slug`, `product-variant`, `product-images`, `product-slug` | slug, variant, ảnh | inactive public detail; field-level public |
| Partner/Farm | `locations`, `harvest`, `certificate-validity` | CRUD/farm/cert | public partner leak; authoring UI |
| QC/Lot | `lot-qc`, `harvest`, `fefo` | QC, lot, FEFO | trace full chain |
| Cart/Checkout | `checkout-hardening`, `checkout-cart-source`, `checkout-lock-order`, `idempotency` | price server, idempotency, lock order | online payment; COD copy |
| Orders | `order`, `mutation-acceptance`, `concurrency` | state, reserve/consume, cancel | shipment cross-state; cancel in transit |
| Payment/Refund | `payment-collection`, `refund`, `concurrency-money` | COD collect, refund cap | refund UI/ownership; completed semantics |
| Shipment/Return | `delivery-return`, `evidence-aftersales` | transition/replay, trace RETURNED | quarantine/stock/order resolution |
| Inventory | `inventory`, `warehouse-chronology`, `warehouse-deactivation`, `fefo` | atomic adjust/reserve/release, docs | blocked release; RETURN sellable; stocktake |
| Finance | `commission`, `settlement` | payable, payout cap | refund deduction; COD pending |
| Reports | `reports-daily`, `reports-export`, `audit` | KPI/export, audit write | audit read; accounting reconciliation |
| Frontend | admin 7/40, customer 3/37, mobile 18/175, shared 5/65 | render/logic units | full UI E2E, real browser flows |

### 13.2. Test gaps bắt buộc phải bổ sung

1. Shipment create trên order `CANCELLED`, `DELIVERED`, `PENDING`.
2. Shipment `DELIVERED` sau khi order `CANCELLED` (race + tuần tự).
3. Shipment `RETURNED` phải tạo stock movement/quarantine và kết thúc order.
4. Cancel order `SHIPPING` phải cancel shipment hoặc chặn; test cả hai policy.
5. Return update status: mọi cặp transition; refundId sai payment; refund chưa completed.
6. Refund tạo từ UI/API idempotent; refund vượt paid; refund completed -> payment status.
7. Warehouse RETURN: `on_hand` không tăng trước QC; `blocked` giảm sau release; double-count.
8. Product discount `PERCENT=101/200/-1`; tổng đơn không âm.
9. `GET /partners` public không có bank/tax; `GET /products/:id` inactive.
10. Trace đủ 8 event; UI authoring harvest/farming.
11. Pagination: >100 web, >20 mobile; load-more.
12. SMTP missing phải fail-fast/cảnh báo rõ; không mất reset link.
13. Playwright UI E2E cho COD, cancel, return/refund, admin COD.
14. Backup restore thực tế; migration từ DB trống.

### 13.3. Những kết luận **chưa xác minh**

- Chưa chạy full E2E/stress lại trong vòng audit này; số liệu Report 13 là nguồn.
- Chưa kiểm tra bằng trình duyệt thật/Playwright.
- Chưa kiểm tra SMTP thật, payment gateway thật, backup restore thật.
- Chưa kiểm tra dữ liệu production vì không có môi trường.
- Chưa đo hiệu năng dưới tải thật; chỉ có stress test Report 13.
- Chưa kiểm tra toàn bộ field public của mọi endpoint; mới xác định các endpoint rộng và partner/product.

---

## 14. Kết luận cuối cùng

### 14.1. Trả lời trực tiếp

**Nền tảng đã hoàn thiện chức năng chưa?**  
Chưa. Đây là bản có bề mặt chức năng rộng và nền tảng kỹ thuật tốt ở catalog/checkout COD/tồn kho/QC/báo cáo, nhưng chuỗi thương mại cốt lõi chưa khép kín.

**Có thể bán hàng thật ngay không?**  
Không. **NO-GO** tại commit hiện tại.

**Còn gì để hoàn thiện?**  
Tối thiểu: P0-01 → P0-06 và các P1 liên quan trực tiếp (giá, dữ liệu public, trace, COD copy, notification/expiry). Chi tiết ở mục 10–12.

**Có thể dùng cho demo/UAT không?**  
Có, với dữ liệu demo, COD, một kho, không tiền thật, có người vận hành biết giới hạn. Không được tuyên bố “hoàn thiện” hay “sẵn sàng bán thật”.

### 14.2. Điều kiện chuyển sang “GO có kiểm soát” cho COD-only

Một pilot COD-only chỉ nên mở khi:

1. P0-01, P0-02, P0-03, P0-04, P0-05, P0-06 đóng.
2. P1-01, P1-02, P1-03, P1-05 đóng.
3. Có E2E UI cho COD + cancel + return/refund.
4. Có backup/restore, CI, migration parity.
5. Có quyết định nghiệp vụ bằng văn bản: COD-only, return window, refund method, settlement timing.
6. Có UAT sign-off với dữ liệu giống thật.

Khi đó mới có thể gọi là “bán hàng thật có kiểm soát”, không phải “nền tảng hoàn thiện mọi tính năng”.

### 14.3. Tuyên bố không thay đổi mã

Trong vòng audit này:

- Không sửa source code, schema, migration, seed.
- Không tạo dữ liệu nghiệp vụ mới.
- Không commit, push, merge, deploy.
- Không chạy migration trên dev/prod.
- Chỉ chạy test an toàn và đọc mã.
- Artifact mới: `audit-reports/14-FULL-FEATURE-INVENTORY-AND-GAP-ANALYSIS.md`.

### 14.4. Phụ lục — lệnh kiểm tra và nguồn

**Đếm bề mặt:**

```text
controllers=30 routes=151 models=52 enums=26 migrations=11
admin=30 customer=27 mobile=30
```

**Git tại thời điểm audit:**

```text
HEAD 5b35b974bae65f308cfdce3ab23a6aec959f2916
branch fix/bl-01-02-settlement-con-01
tracked tree clean
untracked: AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md, audit-reports/
```

**Test đã chạy lại:**

```text
API unit:       34 files / 440 tests PASS
Admin Web:       7 files /  40 tests PASS
Customer Web:    3 files /  37 tests PASS
Mobile:         18 pass + 1 skip / 175 pass + 3 skip
Shared domain:   5 files /  65 tests PASS
```

**Test acceptance tại commit (Report 13, không chạy lại):**

```text
API full E2E:   16 files / 408 tests PASS
Stress:          3 files /  52 tests PASS
Playwright UI:   không có
```

**Nguồn chính:**

- `audit-reports/09-FIX-ROUND-1-VERIFICATION.md`
- `audit-reports/10-FIX-ROUND-2-VERIFICATION.md`
- `audit-reports/11-ROUND-3-ACCEPTANCE-AND-RISK-REVIEW.md`
- `audit-reports/12-ROUND-4-IDEMPOTENCY-CHECKOUT-VERIFICATION.md`
- `audit-reports/13-ROUND-1-4-COMMIT-ACCEPTANCE.md`
- Source paths được trích trong từng mục.

---

**HẾT BÁO CÁO 14**


