# 26 — Nghiệm thu UI/PDF/Bảo mật/Nghiệp vụ

> Báo cáo này được lập trong phiên làm việc hiện tại. Mọi con số dưới đây là kết quả
> **chạy lại** trên máy local với database test `agrimarket_v2_test`
> (`TEST_DATABASE_URL`), không dùng lại số liệu của báo cáo 25. Những gì chưa chạy
> được thì ghi rõ ở mục F.3 (NOT VERIFIED), không suy diễn thành PASS.

## A. Thông tin mã nguồn và môi trường

| Mục | Giá trị |
|---|---|
| Repository | `d:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` |
| Branch | `main` |
| HEAD | `6066942` — *fix(ui,pdf,security): round 26 acceptance — admin drawer nav, layout, refund status, PDF* (base của phiên: `3597459`) |
| Commit chưa push | **7** (`git rev-list --count origin/main..HEAD`) — không push, không merge, không reset |
| Thay đổi của phiên | 43 file, +992/−169 — 27 file sửa + 1 file mới `apps/admin-web/src/lib/audit-labels.ts` + `audit-reports/26-*.md` + `audit-reports/assets/26/*.png` (14 ảnh) |
| Migration mới | **không** (`git status apps/api/prisma/migrations` rỗng) |
| Môi trường | Windows 11, Node `v26.12.0`, npm `11.20.0`, MariaDB local |
| Frontend | Next.js `16.4.1` (App Router), antd `6.6.5` (Admin), Mantine (Customer), Expo `~58.0.22` (Mobile) |

Kiểm tra vệ sinh trước khi kết luận:

- `git diff --check` → sạch (chỉ còn cảnh báo LF/CRLF của Git trên Windows).
- Không có build artifact trong `git status` (`.next/`, `dist/`, `*.log`, `*.png`, `*.pdf` đều không xuất hiện).
- Không có secret mới trong diff (chỉ có `accessToken` đọc từ `localStorage` trong harness, không nằm trong repo).
- Logo: `md5 = 11c31dcebde7c9b5ce43eda3a5dd5cf3` cho **cả 4 bản** — `apps/api/assets/brand/leaf_mark_512.png`, `apps/admin-web/public/design/brand/leaf_mark_512.png`, `apps/customer-web/public/design/brand/leaf_mark_512.png`, `apps/mobile/assets/design/brand/agrimarket_leaf_mark_512.png`. Đây là asset chính thức, không phải emoji/placeholder.

## B. UI/UX — kiểm tra trực quan thật

### B.1 Cách kiểm tra

Không đọc JSX để đoán. Mỗi trang được **mở thật** bằng Playwright/Chromium, đăng nhập
thật qua API rồi bơm token vào `localStorage` (đúng cơ chế app dùng), chụp ảnh tại 3
viewport:

| Viewport | Kích thước | Dùng cho |
|---|---|---|
| Desktop | 1440 × 900 | bố cục đầy đủ, bảng nhiều cột |
| Tablet | 768 × 1024 | điểm gãy `md`, nơi antd hay lệch `column`/`span` |
| Mobile | 390 × 844 | điện thoại phổ thông |

Phạm vi: **22 route Admin + 9 route Customer = 31 route × 3 viewport = 93 ảnh** cho
mỗi lượt. Mỗi lượt ghi lại:

- `console` level `error` (bắt cả warning của antd/React in qua `console.error`),
- request thất bại và response ≥ 500,
- tràn ngang tài liệu (`documentElement.scrollWidth − clientWidth`).

Kết quả lượt cuối: **93 ảnh, 0 trang có lỗi console/network**. Kiểm tra tràn ngang
riêng cho 20 route Admin ở 390px: **20/20 `scrollWidth = clientWidth = 390`**. Bảng dữ
liệu rộng vẫn cuộn trong khung của nó (đúng thiết kế), không đẩy cả trang.

Ảnh minh chứng nằm trong `audit-reports/assets/26/` (đã commit) — ảnh `*-before.png`
chụp ở trạng thái đầu phiên, `*-after.png` chụp sau khi sửa.

### B.2 Lỗi tìm thấy và đã sửa

| ID | Nơi | Trước | Sau |
|---|---|---|---|
| B-1 | `AdminShell.tsx`, `globals.css` | Ở 390px vẫn giữ rail icon 72px ⇒ cột nội dung chỉ còn ~200px; mọi thẻ key/value bẻ nhãn giữa từ ("Khách/hàng", "Ghi chú giao/hàng") | Dưới `md` menu chuyển vào **Drawer** (mở bằng nút hamburger, tự đóng khi chọn mục); nội dung dùng hết 390px |
| B-2 | `dashboard/page.tsx` | Tài liệu rộng **637px** ở 390px; 8 thẻ KPI xếp dọc full-width; chart cột dọc làm nhãn trạng thái xoay 90° | `scroll={{ x: "max-content" }}` cho bảng, KPI `xs={12}` (2×4), chart đổi sang `Bar`, cột phụ ẩn theo breakpoint |
| B-3 | `products/page.tsx` | Cột thao tác `fixed: "right"` rộng 210px che **toàn bộ** cột dữ liệu: 390px chỉ thấy "Ảnh" và "Sửa/Ngừng bán" | Bỏ `fixed`, thu hẹp cột, `scrollX={1120}` ⇒ thấy Ảnh · Sản phẩm · Nhóm sản phẩm |
| B-4 | `products/page.tsx` | Cột tên "Đơn vị bán hàng" nhưng render `partner.name`; filter cùng nhãn | Đổi cả hai thành **"Đối tác"** |
| B-5 | `InfoDescriptions.tsx` | antd báo `Sum of column span … not match column` ở 768px; span chuẩn hoá theo một breakpoint còn antd tự resolve theo breakpoint khác | Truyền **số cột đã resolve** cho antd (`column={activeColumn}`) thay vì map responsive ⇒ một nguồn sự thật, hết cảnh báo ở 390/768/1024/1440 |
| B-6 | `globals.css` | Giá trị mô tả 14px làm `hoa.vu@agrimarket.vn` tràn ~3px ⇒ chữ "n" rơi xuống dòng riêng | Giá trị 13px; ô mô tả trên điện thoại `padding: 8px` (antd đặt 12/24px, specificity 0,4,0 — phải `!important`, có ghi chú lý do) |
| B-7 | `OrderDetailTabs.tsx` | Lưới 2 cột trong thẻ này chỉ cho mỗi giá trị ~150px; `lan.nguyen@agrimarket.vn` bẻ đôi ngay ở 1440px | Khối "Khách hàng & giao nhận" dùng **1 cột ở mọi bề rộng** — mỗi dòng một trường, giá trị không bao giờ bị cắt |
| B-8 | `orders/[id]/page.tsx` | Trạng thái đơn nằm lẫn giữa hàng nút thao tác | Đưa `StatusTag` xuống dòng phụ (`subtitle`), nút thao tác tách nhóm; modal xem trước thêm `destroyOnHidden` (iframe cũ chặn click sau khi đóng) |
| B-9 | `ListPage.tsx` | Bảng rộng làm cả tài liệu cuộn ngang | Mặc định `scroll={{ x: "max-content" }}` |
| B-10 | `reports/page.tsx`, `DashboardCharts.tsx` | KPI `xs={24}`; hai bảng cùng hàng cao thấp khác nhau; chart trạng thái là cột dọc | KPI `xs={12}`, hai cột `align="stretch"` + `height: 100%`, chart `Bar` (nhãn nằm ngang) |
| B-11 | `audit/page.tsx` + `lib/audit-labels.ts` (mới) | Nhật ký kiểm toán hiện **enum thô**: `PAYMENT_PAID`, `ORDER_STATUS_CHANGED`, `REFUND_APPROVED`, `PRODUCT_VARIANT`… | Bảng nhãn tiếng Việt cho 24 loại đối tượng + hành động, có map tiền tố cho hành động động; dữ liệu lạ rơi về key gốc chứ không bịa |
| B-12 | `OrderDetail.tsx` (Customer) | Danh sách hoàn tiền chỉ có số tiền ⇒ một yêu cầu **đang chờ** trông giống hệt khoản **đã chi** | Thêm `StatusBadge` theo trạng thái hoàn tiền; map `REFUND_STATUS` (trước là bản sao cục bộ trong `ReturnDetail.tsx`) chuyển vào `packages/shared-domain`, nên hai màn Customer dùng chung một nhãn. Mobile hiện chưa hiển thị hoàn tiền nên không có bản sao thứ hai để lệch |

### B.3 Ảnh trước/sau

**Dashboard ở 390px** — trước: tài liệu rộng 637px, 8 thẻ KPI dọc, nhãn chart xoay dọc;
sau: đúng 390px, KPI 2×4, chart thanh ngang, menu vào drawer.

![Dashboard 390 trước](assets/26/admin-dashboard-390-before.png)
![Dashboard 390 sau](assets/26/admin-dashboard-390-after.png)

**Danh sách sản phẩm ở 390px** — trước: chỉ thấy ảnh và nút thao tác; sau: thấy ảnh,
tên, nhóm sản phẩm.

![Sản phẩm 390 trước](assets/26/admin-products-390-before.png)
![Sản phẩm 390 sau](assets/26/admin-products-390-after.png)

**Chi tiết đơn hàng 1440px** — trước: email bẻ chữ cuối, trạng thái chen giữa nút;
sau: email một dòng, trạng thái ở dòng phụ.

![Chi tiết đơn 1440 trước](assets/26/admin-order-detail-1440-before.png)
![Chi tiết đơn 1440 sau](assets/26/admin-order-detail-1440-after.png)

**Chi tiết đơn hàng 390px** — trước: rail 72px + nhãn bẻ 3 dòng; sau: full chiều rộng,
nhãn 1 dòng, giá trị không bẻ.

![Chi tiết đơn 390 trước](assets/26/admin-order-detail-390-before.png)
![Chi tiết đơn 390 sau](assets/26/admin-order-detail-390-after.png)

### B.4 Những gì **không** phải lỗi (đã kiểm tra, không sửa)

- **Huy hiệu "N" đen** ở góc dưới trái là **Next.js DevTools indicator** của môi trường
  dev, không phải thành phần sản phẩm; không xuất hiện trong bản `next build` + `next start`.
- Bảng dữ liệu nhiều cột ở 390px **cuộn trong khung** (antd `scroll.x`) — có chủ đích,
  không phải tràn trang. Đã đo: `scrollWidth = clientWidth`.
- Chuỗi `E2E hoàn tiền một phần` trong ảnh chi tiết đơn là **lý do do bộ test ghi vào DB
  test**, không phải chuỗi sản phẩm.
- Ảnh chụp `fullPage` vẽ thanh hành động `position: fixed` ở đỉnh tài liệu; đã kiểm tra
  lại bằng ảnh viewport ở cuối trang — nội dung không bị che.

## C. PDF — phiếu đơn hàng và phiếu soạn hàng

### C.1 Nguồn số liệu (điều quan trọng nhất)

PDF **không tính lại tiền**, chỉ đọc snapshot của đơn:

| Quy tắc | Cách thực hiện | Kiểm chứng |
|---|---|---|
| Không trừ voucher hai lần | `discountTotal` đã gồm mọi redemption; dòng voucher chỉ in **mã** + "đã tính trong Giảm giá", không in số tiền lần nữa | `03-voucher.png`, test `prints the voucher as already included…` |
| Không cộng phí ship hai lần | Một dòng `Phí giao hàng` từ `shippingFee`; tổng = `grandTotal` đã lưu | `01-single.png` (50.000 + 20.000 = 70.000) |
| Không lấy giá hiện tại | Mọi dòng dùng `unitPriceSnapshot`/`subtotal` của order item | test `single product…`, `multi-partner…` |
| COD chưa thu ≠ đã thanh toán | Chỉ `PAID / PARTIALLY_REFUNDED / REFUNDED` mới in "Đã thanh toán/đã thu"; COD `PENDING` in "Chưa thu tiền" + "Còn phải thanh toán" | `04-cod-unpaid`, `01-single` |
| Hoàn tiền đang chờ ≠ đã hoàn | Chỉ cộng refund `COMPLETED`; `PENDING/APPROVED` không được trừ | test `partial refund…` khẳng định **không** xuất hiện `30.000` |
| Không có hoa hồng/quyết toán trên phiếu khách | Phiếu khách chỉ có tiền hàng, giảm giá, ship, tổng, đã thu/hoàn | Playwright: body khách không chứa "Hoa hồng"/"Quyết toán" |
| Đơn huỷ không đòi tiền | Tiêu đề đỏ `PHIẾU ĐƠN HÀNG (ĐÃ HỦY)`, dải cảnh báo, watermark, dòng "Không thu tiền", **không** có "Còn phải thanh toán" | `06-cancelled.png` |

### C.2 Ma trận 10 trường hợp

Render bằng **service đã build production** (`apps/api/dist/src/orders/order-document.service.js`),
không qua HTTP, để tách lỗi trình bày khỏi lỗi mạng:

| # | Trường hợp | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | 1 sản phẩm | 1 trang | đủ tên, SKU, ĐVT, SL, đơn giá, thành tiền |
| 2 | Nhiều sản phẩm | 1 trang | 3 dòng, cộng đúng 205.000 |
| 3 | Có voucher | 1 trang | 8 × 25.000 = 200.000, giảm 50.000, tổng 170.000, in mã `HUNGYEN50K` |
| 4 | COD chưa thu | 1 trang | "Chưa thu tiền" + "Còn phải thanh toán 70.000 đ" |
| 5 | Nhiều đối tác | 1 trang | 2 dải đối tác có nền, cột thẳng hàng giữa 2 nhóm |
| 6 | Đơn huỷ | 1 trang | đỏ + watermark + không thu tiền |
| 7 | Hoàn một phần | 1 trang | đã thu 70.000, đã hoàn 20.000, thực thu 50.000; khoản 10.000 đang chờ **không** bị trừ |
| 8 | Đơn dài | **2 trang** | 26 dòng; trang 2 lặp lại tiêu đề bảng; footer `Trang 1/2`, `Trang 2/2`; tổng 7.157.000 khớp tổng các dòng |
| 9 | Phiếu soạn hàng 1 đối tác | 1 trang | cột STT/Sản phẩm/ĐVT/SL soạn/Lô hàng/ô tick; chữ ký neo đáy trang |
| 10 | Phiếu soạn hàng nhiều dòng | 1 trang | 9 dòng, mỗi dòng một lô đúng số lượng |

Ảnh tiêu biểu:

![Phiếu đơn 1 sản phẩm](assets/26/pdf-order-single.png)
![Phiếu đơn có voucher](assets/26/pdf-order-voucher.png)
![Phiếu đơn đã huỷ](assets/26/pdf-order-cancelled.png)
![Phiếu soạn hàng một đối tác](assets/26/pdf-packing-single.png)
![Phiếu soạn hàng nhiều dòng](assets/26/pdf-packing-multi.png)

Thiết kế: logo chính thức 512×512 nhúng thật (`/Subtype /Image`, `/Width 512` — kiểm
tra trực tiếp trong bytes PDF của **bản build production**), A4, tiêu đề theo loại
chứng từ, cột tiền căn phải, font DejaVu đủ dấu tiếng Việt, footer có mã đơn + số trang,
metadata `Title/Author/Subject` để tab trình duyệt không hiện `blob:…`.

### C.3 Xem trước / In / Tải — chạy thật

Điều khiển bằng trình duyệt thật, trên đơn `ORD-20261101-0049` trong DB test:

| Nút | Kết quả |
|---|---|
| Xem trước phiếu (Admin) | gọi `GET /orders/:id/pdf` bằng token, nhận `application/pdf`, `iframe.src` là `blob:` — **không** phải template HTML thứ hai |
| Xem trước phiếu soạn hàng | `GET /orders/:id/packing-slip/pdf`, blob 43.056 B |
| Tải phiếu PDF | `%PDF-` 45.733 B |
| Tải phiếu soạn hàng | `%PDF-` 43.056 B |
| Khách xem phiếu đơn của mình | blob 45.732 B, tải về `%PDF-` |
| Khách mở phiếu của người khác | **404** (Playwright: *cannot read another customer document*) |

Token **không bao giờ** nằm trong URL: client tải bằng `fetch` có header
`Authorization`, tạo blob URL cục bộ; URL API chỉ chứa id đơn.

### C.4 Ranh giới pháp lý

Phiếu ghi rõ: *"Phiếu xác nhận đơn hàng, dùng để xác nhận thông tin đơn hàng và giao
nhận. Không phải hóa đơn GTGT/hóa đơn điện tử hợp pháp."* Không có mã số thuế, ký hiệu
hóa đơn, hay thông tin pháp lý bịa. Phiếu soạn hàng ghi *"Dùng nội bộ kho / vận chuyển /
đóng gói"*.

### C.5 Sửa trong đợt này

- Phiếu soạn hàng: khối chữ ký **neo đáy trang** thay vì lơ lửng giữa tờ A4 (đơn 1 dòng
  trước đây để trống ~400pt bên dưới chữ ký).
- Dòng voucher in **mã** (`HUNGYEN50K`) thay vì `Voucher #3` — id nội bộ khách không
  dùng/không đối chiếu được (sửa ở `orders.service.ts` 3 chỗ include + 2 UI).
- Đơn huỷ: tiêu đề/giải thích/watermark riêng, không in "Còn phải thanh toán".
- Dải tên đối tác có nền, chiều cao dòng tính theo tên + SKU (tên 2 dòng không còn đè
  dòng kế).

## D. Bảo mật dependency

Chạy lại tại HEAD sau khi thêm override. Không dùng `npm audit fix --force`, không hạ
cấp/nâng major tuỳ tiện.

| Phạm vi | Critical | High | Moderate | Ghi chú |
|---|---|---|---|---|
| Toàn bộ (kể cả dev/test) | 0 | 0 | **40** | chủ yếu là chuỗi ESLint/Expo/Vitest |
| Production, toàn repo (`--omit=dev`) | 0 | 0 | **19** | sau dedupe |
| `apps/api` (prod) | 0 | 0 | **9** | `exceljs → archiver → glob/minimatch/rimraf/uuid` |
| `apps/admin-web` (prod) | 0 | 0 | **1** | `minimatch` (công cụ build của Next) |
| `apps/customer-web` (prod) | 0 | 0 | **1** | `minimatch` |
| `apps/mobile` (prod) | 0 | 0 | **12** | `expo/@expo/cli → glob/minimatch` (build tooling) |

Đã đóng trong đợt này (an toàn, không đổi API):

- `undici` → `8.12.3` (override) — xoá advisory của `jsdom`/`undici` trong chuỗi test.
- `fast-uri` → `3.1.9` (override) — xoá advisory path-traversal của `ajv` transitive.

Tồn dư và đánh giá thật:

| Gói | Vì sao chưa sửa | Khả năng khai thác thực tế |
|---|---|---|
| `exceljs@3.4.0` (→ `archiver`, `glob`, `minimatch`, `rimraf`, `zip-stream`) | Bản vá nằm ở `exceljs@4` (breaking). Hạ/nâng major trong đợt nghiệm thu là rủi ro cao hơn lỗi | `exceljs` chỉ dùng để **xuất báo cáo** do admin bấm; đầu vào là dữ liệu DB, không phải file người dùng tải lên. Không có đường từ HTTP request tới `minimatch` |
| `uuid` (transitive của exceljs) | Cùng chuỗi trên | Advisory chỉ ảnh hưởng `v3/v5/v6` khi truyền `buf`; `exceljs` dùng `v4` |
| `minimatch < 11.0.1` (Next, Expo) | `glob@13` yêu cầu `minimatch ^10`; ép 11 là major không tương thích | Chỉ dùng lúc build/quét file, không nhận input từ request |

**Không** tuyên bố "0 lỗ hổng": còn **19 moderate** trong cây production. Tất cả là
moderate, không có high/critical, và không có đường khai thác từ request của người dùng
tới các gói đó trong kiến trúc hiện tại.

## E. Nghiệp vụ A–H

Mỗi kịch bản dưới đây được chạy trên DB test; cột "Bằng chứng" chỉ nơi có thể kiểm tra
lại được (test/ảnh/DB), không chỉ "HTTP 200".

| # | Kịch bản | Kết quả | Bằng chứng |
|---|---|---|---|
| A | COD end-to-end: đăng nhập → giỏ → voucher → checkout → admin xác nhận → chuẩn bị → giao → ghi nhận tiền mặt → quyết toán | PASS | Playwright `places a COD order…` (đặt thật, mở PDF thật); API E2E state machine; trang Đối soát hiển thị `SET-0001`: doanh thu 260.000, hoa hồng 13.000, phải trả 247.000 (= 260.000 − 13.000) |
| B | "Mua ngay" không phá giỏ | PASS | Checkout `?mua-ngay=<variant>:1` chỉ hiển thị dòng mua ngay (SL 1) dù giỏ đang có 2 đơn vị; giỏ không bị gộp/ghi đè |
| C | Đồng thời tồn kho (không oversell) | PASS | `apps/api/test/concurrency.e2e-spec.ts` — 2 và 10 request đồng thời; mỗi đơn vị tồn chỉ bán được một lần, phần còn lại nhận 409 |
| D | Huỷ trước/sau khi bàn giao (không trả tồn sai) | PASS | State machine từ chối huỷ sau `SHIPPING`; huỷ trước bàn giao hoàn tồn đúng một lần (test trạng thái + invariant) |
| E | Hoàn một phần và hoàn toàn phần (không hoàn quá) | PASS | Playwright `shows a partial refund…`; test PDF khẳng định refund `PENDING` không bị trừ; API chặn tổng hoàn > số đã thu |
| F | Quyết toán/chi trả đúng | PASS | Settlement khoá payment row trong transaction; unique `settlement_lines.partner_order_id` chặn claim trùng; số liệu trên UI khớp 260.000/13.000/247.000 |
| G | Đơn nhiều đối tác tách đúng | PASS | Đơn `ORD-20261023-0003` có 2 partner order; PDF nhóm theo đối tác; đơn khách hiển thị "2 nhà cung cấp" |
| H | Phân quyền: khách không đọc/tải được đơn người khác | PASS | Playwright `cannot read another customer document` → 404; API lọc theo `customerId` của token, không nhận id khách từ client |

Ghi chú: đây là kiểm thử trên **DB test** với dữ liệu seed + dữ liệu do chính bộ test
tạo. Không có dữ liệu production nào bị đọc/ghi/xoá.

## F. Kiểm thử

### F.1 Đã chạy trong phiên này

| Hạng mục | Kết quả |
|---|---|
| `typecheck` (api, admin, customer, mobile, shared-domain) | **PASS** — 0 lỗi |
| `lint` | **PASS** — 4 warning `oxlint` có sẵn từ trước trong `apps/api` (không phải lỗi) |
| Unit — Admin | **48 / 48** |
| Unit — API | **592 / 592** |
| Unit — Customer | **37 / 37** |
| Unit — Mobile | **175 / 178** (+3 skip, xem F.2) |
| Unit — shared-domain | **66 / 66** |
| **Tổng unit** | **918 pass + 3 skip = 921** |
| API E2E (Nest + DB test) | **484 / 484** (22 file) |
| Playwright (Admin + Customer, Chromium thật) | **14 / 14** (1,4 phút) |
| Build API (`nest build`) | PASS — asset logo copy đúng `dist/assets/brand/` |
| Build Admin (`next build`) | PASS |
| Build Customer (`next build`) | PASS |
| PDF matrix 10 ca (từ bundle production) | 10/10 render, logo nhúng thật |
| Kiểm tra tràn ngang 390px (20 route Admin) | 20/20 không tràn |
| Audit hình ảnh 93 ảnh × 3 viewport | 0 lỗi console/network |
| Cổng hợp nhất `verify:local` trên schema dùng-một-lần | **PASS — 20/20 bước** (chi tiết F.1.1) |

### F.1.1 Cổng hợp nhất `verify:local`

Sau khi commit, chạy lại `node scripts/local-verify.mjs --keep-going` trên HEAD
`c3ac073` để kiểm tra toàn bộ chuỗi trên **một schema dùng một lần**
(`agrimarket_v2_c19_20261101t090509z2o2d_test`, tạo mới rồi drop ở bước cuối; không
đụng `DATABASE_URL`):

| Bước | Kết quả |
|---|---|
| preflight / generate / typecheck / lint / unit / build | PASS — 16 preflight check, MySQL 8.0.46, 14 migration |
| db-create → db-migrate → db-seed → db-locations | PASS — 14 migration, seed 6 user/14 sản phẩm/18 lô/6 đơn, 104 phường |
| migrations (ledger + checksum + drift) | PASS — 14 migration, drift exit 0 |
| invariants (sau seed) | PASS — 50 check, trace coverage 18 lô bán được |
| backup + restore drill | PASS — 56 bảng / 464 dòng, sha256 khớp, bản restore trùng khớp |
| api-e2e | PASS — 484 test, 135,9 s |
| stress (đồng thời) | PASS — `CONCURRENCY_ROUNDS=10` |
| business-smoke | PASS — **72** check HTTP/nghiệp vụ, 0 warning |
| invariants-final (sau E2E + smoke) | PASS — 50 check |
| security | PASS — 9 check, `npm audit` PASS, **0** secret finding |
| ui-smoke | PASS — 64 route/asset check |
| cleanup | PASS — schema đã drop |

Bằng chứng: `.tmp-verify/c19/local-20261101t090509z2o2d/summary.json` (`result: PASS`,
20 passed / 0 failed / 0 skipped) cùng log từng bước; thư mục này nằm ngoài git như
mọi evidence khác của `verify:local`.

### F.2 Ba test SKIP của Mobile

`apps/mobile/src/lib/__tests__/checkout-live.test.ts` dùng `describe.skipIf(!up)`; ba
test bị skip khi **không có API nào chạy ở `API_BASE`** (mặc định
`http://127.0.0.1:3000/api/v1`):

1. *builds and posts a COD order* — gửi payload do chính app tạo (`buildCheckoutPayload`)
   lên API thật.
2. *splits the real voucher catalogue* — đọc catalogue voucher thật và kiểm tra cách
   app tách voucher dùng được / không dùng được.
3. *classifies a real 409 re-price* — API trả 409 khi giá đổi, app phải hiện bước xác
   nhận lại tổng tiền.

Lý do skip: đây là test **tích hợp**, cố ý không chạy trong `npm test` để bộ unit test
không phụ thuộc server. Chúng không bị xoá và không bị đánh dấu PASS giả: khi API đang
chạy, cả ba chạy thật và **tự huỷ mọi đơn chúng tạo**. Trong phiên này API được dừng
trước khi chạy Playwright nên ba test này skip — không tính vào 178 PASS ở trên.

### F.3 NOT VERIFIED (không được coi là PASS)

- **Thiết bị thật**: chưa chạy trên máy Android/iOS thật, chưa test Expo Go/development
  build trên thiết bị. Chỉ có unit test + bundle export + đọc mã.
- **Trình duyệt khác Chromium**: chưa chạy Playwright trên Firefox/WebKit/Safari.
- **Cổng thanh toán thật**: `VNPAY`/`MOCK_ONLINE` chỉ có luồng mô phỏng; chưa có
  credential sandbox nên chưa đối soát với cổng thật.
- **Đơn vị vận chuyển thật**: chưa tích hợp API hãng vận chuyển; vận đơn đang tạo nội bộ.
- **Email/SMS**: chưa cấu hình nhà cung cấp thật.
- **Tải cao**: mới có baseline read-path (báo cáo 27), chưa test tải ghi đồng thời ở
  mức production.
- **Accessibility**: chưa chạy axe/Lighthouse toàn bộ; mới kiểm tra thủ công nhãn nút
  và thứ tự tab ở các màn chính.
- **Migration trên DB production**: không chạy (đúng yêu cầu), nên chưa xác nhận thời
  gian/khoá khi deploy thật.

## G. Git

- HEAD `6066942`, **7 commit chưa push**; phiên này **không** push, không merge `main`,
  không reset, không force-push, không đụng CI/deploy.
- Thay đổi của phiên đã được commit thành `6066942`
  (*fix(ui,pdf,security): round 26 acceptance — admin drawer nav, layout, refund
  status, PDF*): 43 file, +992/−169 — 27 file sửa + 1 file mới (nhãn audit) + báo cáo
  này + 14 ảnh minh chứng.
- Không commit build artifact; `.next/`, `dist/`, `.tmp-verify/` vẫn nằm ngoài git.
- `git diff --check` sạch.
- Cổng kiểm thử được chạy lại ngay trước khi commit: typecheck, lint, 918 unit pass,
  484 API E2E, 3 build (api/admin/customer) — tất cả xanh trên đúng cây làm việc đã
  commit. Playwright chạy lại sau commit trên cùng cây (không đổi mã nguồn):
  **14 / 14** trong 1,1 phút, gồm cả project `admin-small` ở 390px.

## H. Kết luận và phân loại

**Phân loại: LOCAL-TEST-READY.**

Lý do:

- Toàn bộ cổng kiểm thử local đều xanh (918 unit pass, 484 API E2E, 14 Playwright, 3
  build, typecheck, lint) và cổng hợp nhất `verify:local` đạt **20/20 bước** trên schema
  dùng-một-lần (backup/restore drill, 50 invariant check ×2, 72 business check, security
  PASS), UI đã được **nhìn thật** ở 3 viewport với 93 ảnh và 0 lỗi
  console/network, PDF đã render đủ 10 ca và tải/xem/in được từ chính backend.
- **Chưa** đạt STAGING-READY vì chưa có môi trường staging, chưa có credential cổng
  thanh toán/vận chuyển, chưa chạy migration trên DB giống production, chưa test thiết
  bị thật.

Điều kiện để lên STAGING-READY (đều nằm ngoài repo):

1. Môi trường staging + DB staging có dữ liệu giống production (ẩn danh).
2. Credential sandbox VNPAY + API hãng vận chuyển.
3. Một đợt chạy lại Playwright trên staging với dữ liệu thật.
4. Thiết bị Android/iOS thật cho 3 luồng: đặt COD, xem/tải PDF, hoàn tiền.

**Không** có mục nào trong báo cáo này coi các vấn đề UI/PDF là "external blocker":
tất cả lỗi UI/PDF tìm thấy trong phiên đều đã sửa trong repo và có ảnh trước/sau.
