# AgriMarket V2 — Báo cáo sửa Checkout, Khuyến mãi và Giao diện

**Ngày:** 2026-10-11
**Phạm vi:** 5 vấn đề người dùng phát hiện trên Mobile Expo Go + chuẩn hoá thiết kế
**Ưu tiên đã thực hiện:** Checkout COD hoạt động thật TRƯỚC, sau đó mới tinh chỉnh giao diện

**Trạng thái tổng:** 6/6 vấn đề đã sửa ở tầng nguồn, có bằng chứng chạy thật.
Còn 1 việc chờ kiểm thử trên thiết bị Android thật (xem §8).

---

## 1. Tóm tắt kết quả

| # | Vấn đề người dùng báo | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Chữ tiếng Việt hỏng ở Sổ địa chỉ | Đã sửa tận gốc | Ảnh chụp + test encoding |
| 2 | Checkout không đặt hàng được | Đã sửa, **đặt hàng thật thành công** | ORD-20261011-0007 |
| 3 | Giỏ hàng chưa gọn, lặp tổng tiền | Đã chuẩn hoá | Ảnh chụp + test đồng bộ |
| 4 | Voucher phải gõ tay | Đã chọn mã trong checkout | Ảnh chụp UI |
| 5 | Flash Sale / đồng hồ đếm ngược | Đã sửa, có test hết hạn | 7 test API + đồng hồ chạy |
| 6 | Chuẩn hoá thiết kế | Đã dọn | Ảnh chụp 3 màn |

---

## 2. Vấn đề 1 — Chữ tiếng Việt hỏng (Mojibake)

### Root cause

`apps/mobile/app/addresses.tsx` bị **double-encode UTF-8 → CP1252 → UTF-8**.

File là UTF-8 hợp lệ, nên không có công cụ nào báo lỗi — chỉ là nội dung
**sai ký tự**. Cụ thể: byte của một chuỗi tiếng Việt đúng đã bị giải mã như
Windows-1252 rồi mã hoá lại thành UTF-8:

```
"Mặc định"  ->  "Máº·c Ä‘á»‹nh"
"Sửa"       ->  "Sá»­a"
"Xóa"       ->  "XÃ³a"
"Thêm địa chỉ" -> "ThÃªm Ä‘á»‹a chá»‰"
```

**Không phải lỗi font.** Đây là lý do việc thay font không thể sửa được: chuỗi
trong file đã sai trước khi tới font.

### Phạm vi

Quét toàn repo (API, admin-web, customer-web, mobile, docs, scripts) bằng
detector giải mã ngược: **chỉ duy nhất 1 file bị hỏng** —
`apps/mobile/app/addresses.tsx`, **28 dòng**.

Các file khác từng bị nghi (do console PowerShell hiển thị sai) đã kiểm tra
bằng Node đọc byte trực tiếp: `config.ts`, `session.ts`, `checkout.test.ts`,
`cart.tsx` — **tất cả sạch**.

### Sửa

Khôi phục lossless: CP1252 → byte → UTF-8, giữ nguyên CRLF, không BOM,
không đổi logic. Kiểm chứng 28/28 dòng khôi phục được, 0 dòng lỗi.

### Test ngăn tái xuất hiện

`apps/mobile/src/lib/__tests__/encoding.test.ts` — 6 test:

- Quét **mọi file nguồn** trong app, fail nếu có C1 control char (U+0080–U+009F)
  hoặc chữ ký mojibake (`Ã¡`, `á»`, `â€`, `Ä‘`…).
- Chỉ báo lỗi khi việc giải mã ngược **chứng minh** được chuỗi là tiếng Việt bị
  hỏng → không false-positive với `…`, `–`, `·`.
- Positive control: tự tạo chuỗi hỏng từ mã ký tự, khẳng định detector **có**
  bắt được (detector không bao giờ fire thì vô dụng).
- Đọc `addresses.tsx` từ đĩa, khẳng định có `Mặc định`, `Sửa`, `Xóa`,
  `Thêm địa chỉ` và **không** có dạng hỏng.

### Bằng chứng

Ảnh chụp màn Sổ địa chỉ (đã đăng nhập, dữ liệu thật): hiển thị đúng
**Mặc định**, **Sửa**, **Xóa**, **Thêm địa chỉ**, **Địa chỉ cũ**, **Sổ địa chỉ**.

---

## 3. Vấn đề 2 — Checkout không đặt hàng được ⭐

### Root cause (đã xác định chính xác)

Trong `apps/mobile/app/checkout.tsx` bản cũ:

```ts
const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);   // dòng 58
const needsConfirm = grandTotal !== undefined && confirmedTotal !== grandTotal; // dòng 238
```

`confirmedTotal` khởi tạo `null`, còn `grandTotal` đã có ngay khi preview trả về.
⇒ `needsConfirm` **true ngay lần đầu vào màn**:

- Thanh vàng "Xác nhận tổng…" hiện vĩnh viễn.
- `canSubmit` false ⇒ **nút đặt hàng bị khoá**.

Khách bị bắt xác nhận một tổng tiền **chưa từng thay đổi**. Không có đơn nào
tạo được. Đây thuần tuý là lỗi logic frontend — backend hoàn toàn đúng.

### Sửa

Đổi mô hình từ *"khách đã xác nhận tổng chưa"* sang *"backend có định giá lại
sau khi khách đã xem không"*:

```ts
export function needsTotalConfirm(preview, pendingTotal: number | null): boolean {
  return preview !== undefined && pendingTotal !== null;
}
```

- `pendingTotal` chỉ được set bởi **nhánh 409** (backend thật sự đổi giá).
- Bình thường: **một nút duy nhất** `Đặt hàng · {grandTotal}`, không thanh vàng.
- Sau 409: hiện tổng mới + nút vẫn là nút đó (không có nút xác nhận thứ hai).

### Các yêu cầu khác — đều giữ đúng

| Yêu cầu | Thực hiện |
|---|---|
| `expectedGrandTotal` | Giữ; gửi đúng tổng backend trả về |
| Idempotency key ổn định | 1 key / 1 chữ ký payload; **không** gồm `expectedGrandTotal` (retry sau 409 phải dùng lại key) |
| Không tạo đơn trùng | Test: 3 retry đồng thời → 1 đơn |
| Không coi COD là đã thu tiền | DB: `payments.status=PENDING`, `paid_at=NULL` |
| Lỗi theo nguyên nhân | `classifyCheckoutError` → network / session / total-changed / stock / voucher / address / unknown |
| Không sửa nghiệp vụ tiền ở FE | Không có phép tính tiền nào trong app; mọi số từ `checkout-preview` |

**Lưu ý về phân loại lỗi:** `ApiError.message` đã được dịch sang tiếng Việt trước
khi tới màn hình, nên pattern tiếng Anh sẽ trượt. Hàm `errorText()` đọc **cả**
`message` (đã dịch) **và** `body.message` (nguyên bản) để phân loại đúng.

### Đã kiểm chứng nhánh 409 trên UI thật

Mô phỏng đúng tình huống người dùng mô tả — Admin đổi giá **sau khi** khách đã
xem tổng tiền:

1. Khách vào checkout, thấy nút **"Đặt hàng · 44.000 ₫"** (12.000 × 2 + 20.000).
2. Admin đổi `basePrice` của quân hàng 12.000 → **15.000** (qua `PATCH /products/variants/51`).
3. Khách bấm đặt hàng → backend trả **HTTP 409**.
4. Màn hình **tự làm mới preview** và hiện:

   ```
   Tổng tiền:  Rau muống hạt × 2   30.000 ₫
               Tiền hàng           30.000 ₫
               Phí vận chuyển      20.000 ₫
               Tổng cộng           50.000 ₫

   [ Giá hoặc khuyến mãi vừa thay đổi. Vui lòng xem lại tổng tiền mới và xác nhận lại. ]
   [ Giá vừa được cập nhật thành 50.000 ₫. Bấm đặt hàng để xác nhận. ]
   [ Đặt hàng · 50.000 ₫ ]        <- VẪN CHỈ MỘT NÚT
   ```

5. Khách bấm lại → tạo **đúng một** đơn `ORD-20261011-0015` với tổng **50.000 ₫**
   (không tạo đơn trùng, không dùng lại giá cũ).

**Không có nút xác nhận thứ hai** — chính nút "Đặt hàng" đảm nhiệm việc xác nhận,
và tổng tiền hiển thị luôn là tổng **mới nhất** từ backend.

Kiểm chứng bổ sung: sau khi khách **tự đổi giỏ hàng**, cờ "chờ xác nhận" được xoá
(`carryPendingTotal`), nên không hiện lời nhắc "giá vừa cập nhật" cho thay đổi do
chính khách gây ra — tránh lặp lại đúng lỗi cũ dưới hình thức khác.

> Giá đã được **khôi phục nguyên trạng** về 12.000 ₫ sau kiểm tra
> (`product_variants` id 51 xác nhận `base_price = 12000.00`), và đơn kiểm tra
> `ORD-20261011-0015` đã **CANCELLED**. DEV không bị reset/reseed.


### Luồng thật đã chạy — Mobile → API → MySQL → Admin

Đặt hàng **trực tiếp trên UI** (Playwright điều khiển Expo web, đăng nhập thật):

```
ORD-20261011-0007
  360.000 (tiền hàng) − 50.000 (HUNGYEN50K) + 20.000 (ship) = 330.000 ₫
```

- **Mobile**: màn chi tiết đơn hiện "Đặt hàng thành công", COD "Chờ thanh toán".
- **MySQL** (`agrimarket_v2.orders` id 28): `subtotal 360000`, `discount_total 50000`,
  `shipping_fee 20000`, `grand_total 330000`, `payments: COD/PENDING`, `paid_at NULL`.
- **Voucher**: `voucher_redemptions` có bản ghi 50.000₫; `vouchers.used_count` = 1.
- **Admin Web**: thấy đơn trong danh sách và trang chi tiết (ảnh chụp).

> **Nói rõ về database đã dùng cho từng loại kiểm tra**
>
> - **Kiểm tra qua UI/HTTP** ở trên chạy trên **DEV** (`agrimarket_v2`) — vì đó là
>   database mà API đang chạy ở cổng 3000 phục vụ, và đây là môi trường duy nhất
>   có thể quan sát được toàn bộ chuỗi Mobile → Admin như người dùng yêu cầu.
> - **Toàn bộ test tự động** (API E2E 322 test, `verify-flash-expiry.ts`) chạy trên
>   **TEST độc lập** (`agrimarket_v2_test`), đúng như yêu cầu.
> - Mọi đơn tạo ra trong lúc kiểm tra đều đã **CANCELLED**; riêng đơn
>   `ORD-20261011-0007` **được giữ lại ở trạng thái `PENDING_CONFIRMATION`** để
>   Admin có thể mở xem trực tiếp làm bằng chứng. Có thể huỷ bất cứ lúc nào từ
>   Admin hoặc từ màn chi tiết đơn trên app.
> - DEV **không hề bị reset hay reseed**. Số bản ghi test còn sót lại: 0
>   (`flash_sales` tên `ZZZ%` = 0).


---

## 4. Vấn đề 3 — Chuẩn hoá giỏ hàng

| Yêu cầu | Trước | Sau |
|---|---|---|
| Không lặp tổng tiền | Tổng in 2 lần (khối "Tổng đơn" + thanh dưới) | Tổng in **1 lần** ở thanh dưới; khối trên chỉ nêu tiền hàng/giảm/phí ship |
| Không lặp dòng giảm giá | `discountTotal` và `voucher.discountAmount` cùng số → in 2 dòng | **1 dòng**, ghi rõ mã |
| Không chú thích kỹ thuật | "Tổng tiền do hệ thống tính…" | Đã xoá |
| Không hiện giá sai khi loading | Hiện giá catalogue (có thể khác giá thật) | Hiện "Đang tính giá…" cho tới khi preview trả về |
| Quy cách đúng API | `Túi 1 kg / túi` (thừa dấu) | `Túi 1 kg · túi` |
| Voucher | Link sang trang danh sách, phải tự gõ lại | "Chọn ở bước đặt hàng" → nhảy tới checkout |

### Bằng chứng đồng bộ giỏ ↔ checkout

Kiểm tra thật qua API, 4 mức số lượng liên tiếp:

```
set qty=1 -> cart=1 preview=1 SYNCED
set qty=3 -> cart=3 preview=3 SYNCED
set qty=7 -> cart=7 preview=7 SYNCED
set qty=2 -> cart=2 preview=2 SYNCED
```

### Cùng sản phẩm nhiều quy cách

`Gạo nếp cái hoa vàng` với 2 quy cách — kiểm tra thật:

```
cart:    GNV-2KG x2  |  GNV-5KG x2      (2 dòng riêng)
preview: 90.000 x2 = 180.000  |  215.000 x2 = 430.000
tổng: 610.000 + 20.000 ship = 630.000 ₫
khớp số dòng: YES
```

Không gộp nhầm, không nhân sai giá.

---

## 5. Vấn đề 4 — Trải nghiệm mã giảm giá

### Trước

Màn `/vouchers` chỉ đọc, và hướng dẫn khách **tự sao chép mã rồi gõ lại** ở
checkout. Không biết mã nào dùng được cho đơn hiện tại, không có lý do khi
không dùng được.

### Sau

**Chọn mã ngay trong checkout** (`apps/mobile/app/checkout.tsx`):

- Danh sách chia **"Dùng được"** và **"Chưa dùng được"**.
- Mỗi mã có nút **"Áp dụng"**; mã đã chọn tự về ô tổng tiền.
- Mã chưa đủ điều kiện ghi **rõ lý do**: chưa đủ đơn tối thiểu / hết lượt /
  đã dùng hết số lần / chưa đến kỳ hoặc hết hạn / mã ngừng áp dụng.
- Đổi số lượng hoặc sản phẩm → `preview` tự gọi lại, mã được xác thực lại.

**Không tính tiền ở client.** `splitVouchers` chỉ quyết định *thứ tự và câu chữ*;
số tiền giảm luôn lấy từ `preview.voucher.discountAmount` của backend.

### Kiểm tra HUNGYEN50K trên TEST DB (đúng như yêu cầu)

| Tình huống | Kết quả thật |
|---|---|
| Đơn **không đủ** 300.000đ | HTTP 400 — `"Order subtotal must be at least 300000 to use this voucher"` |
| Đơn **đủ** điều kiện (645.000đ) | HTTP 201 — discount **đúng 50.000**, tổng = subtotal − 50.000 + ship |
| Mã không tồn tại | HTTP 404 |
| Khách đã dùng hết lượt | HTTP 400 — `"You have reached the per-customer limit for this voucher"` |

Trên UI, đơn 72.000đ hiển thị HUNGYEN50K trong mục **"Chưa dùng được"** với lý do
**"Chưa đủ giá trị đơn tối thiểu"**; khi nâng lên 360.000đ, mã chuyển sang
**"Dùng được"** với nút **"Áp dụng"**, bấm vào tổng đổi đúng thành **330.000 ₫**.

**Giữ đúng 3 nghiệp vụ:** Voucher, Product Discount, Flash Sale — không thêm loại nào.

---

## 6. Vấn đề 5 — Flash Sale và đồng hồ đếm ngược

### Vì sao "Flash Sale cuối tuần Hưng Yên" còn 27 ngày

Kiểm tra DB thật (`agrimarket_v2.flash_sales`, id 3):

```
name:        Flash Sale cuối tuần Hưng Yên
starts_at:   2026-09-07 17:00:00
ends_at:     2026-11-06 17:00:00      <- cửa sổ 60 ngày
created_at:  2026-10-07 22:34:43      <- = thời điểm seed
```

**Kết luận: đây là chương trình SEED DEMO, không phải lỗi thời gian.**

- `created_at` trùng thời điểm chạy seed ⇒ do `seed.ts` tạo.
- `seed.ts` đặt `startsAt: addDays(-30)`, `endsAt: addDays(30)` ⇒ cửa sổ 60 ngày.
- **Tên** "cuối tuần" là nhãn demo, không khớp cửa sổ 60 ngày. Dữ liệu thời gian
  **đúng**; chỉ có *tên* gây hiểu nhầm.

Theo yêu cầu: **không sửa thời gian trong DB**. Thay vào đó, đồng hồ hiển thị
trung thực (`Còn 26 ngày · 16:12:05`) để tên gọi không còn gây nhầm.

Phân biệt rõ: chương trình seed (ở trên) vs chương trình Admin tạo (có
`created_at` sau này, cửa sổ do Admin nhập) — Admin tạo/sửa qua `/flash-sales`
với đủ trường `startsAt`, `endsAt`, `status`, `flashPrice`, `quota`,
`perCustomerLimit`.

### Đồng hồ đếm ngược — sửa triệt để

**Trước:** `formatRemaining(sale.endsAt)` gọi 1 lần khi render ⇒ đồng hồ **đứng
im**. Chương trình hết hạn vẫn hiện như đang chạy.

**Sau** (`apps/mobile/src/lib/countdown.ts` + `use-countdown.ts`):

- Giá trị tính lại từ `endsAt` và đồng hồ máy, **mỗi giây**.
- Dùng `useSyncExternalStore` ⇒ không drift, không set state trong effect.
- Lắng nghe `AppState` ⇒ khi app trở lại foreground, tính lại ngay
  (Android có thể throttle timer khi ở nền).
- Hết hạn ⇒ card **tự ẩn** và **tự gọi lại API** khuyến mãi ⇒ giá Flash Sale hết
  hạn không còn hiển thị.
- Hiển thị `Còn 26 ngày · 16:12:05` — nhãn nêu quy mô, đồng hồ nêu phần còn lại
  (trước đây in "26 ngày · 26 ngày 16:40:33", đọc như lỗi).
- Múi giờ: mọi mốc là ISO từ API, so sánh bằng epoch ms ⇒ đúng mọi múi giờ.

### Đối chiếu dữ liệu Flash Sale (đúng như yêu cầu)

Đã đối chiếu **Admin Flash Sale ↔ GET /flash-sales ↔ startsAt ↔ endsAt ↔ status
↔ flashPrice ↔ quota ↔ soldQuantity ↔ perCustomerLimit ↔ effectivePrice trên
catalog ↔ giá checkout-preview**. Kết quả chạy thật:

```
sale "Flash Sale cuối tuần Hưng Yên" trong cửa sổ — endsAt 2026-11-06T17:00Z (26.7 ngày)
  CCB-1KG: flashPrice 50.000 < base 60.000 | sold 2/100 | per-customer 2
  CRP-1KG: flashPrice 24.000 < base 28.000 | sold 0/200 | per-customer 3
catalog effectivePrice = 50.000 (FLASH_SALE) = flashPrice  ✔
checkout-preview        = 50.000 (FLASH_SALE) = flashPrice  ✔
catalog effectivePrice = 24.000 (FLASH_SALE) = flashPrice  ✔
checkout-preview        = 24.000 (FLASH_SALE) = flashPrice  ✔
```

**Một giá, ba nơi khớp nhau.** Giới hạn mỗi khách cũng được thực thi thật:
khách đã mua đủ 2 suất CCB-1KG nhận HTTP 400 `"Per-customer flash sale limit
reached"`, trong khi khách khác vẫn mua được.

### Test hết hạn (TEST DB, có positive control)

`apps/api/prisma/verify-flash-expiry.ts` — tạo chương trình thật trên
`agrimarket_v2_test`, gọi thẳng `PromotionsService.resolvePrice`, dọn sạch sau:

```
[PASS] baseline prices at base with no promotion — 32000 (NONE)
[PASS] an expired window is NOT priced (base price is used) — 32000 vs flash 16000
[PASS] the expired programme is not attached to the price — flashSaleItemId=null
[PASS] a live window IS priced (positive control) — 16000 (FLASH_SALE)   <- chứng minh test không "pass rỗng"
[PASS] the live price points at the running programme, not the expired one
[PASS] a deactivated programme stops pricing even inside its window — 32000 (NONE)
[PASS] a window that closed a second ago is no longer priced — 32000 (NONE)
[PASS] a window that has not opened yet is not priced — 32000 (NONE)
[PASS] verification programmes removed — 0 left
```

Thêm **5 test API** (`apps/api/test/business-rules/promotions.spec.ts`) khẳng định
truy vấn giá gửi đúng điều kiện cửa sổ (`startsAt <= now <= endsAt` + `status=ACTIVE`),
và một chương trình đã tắt không thể tiêu thụ quota.

---

## 7. Vấn đề 6 — Chuẩn hoá thiết kế

| Yêu cầu | Thực hiện |
|---|---|
| Đơn giản, dễ đọc | Bỏ khối "Tổng đơn" trùng; bỏ chú thích kỹ thuật |
| Không card lồng nhiều lớp | Giữ 1 cấp card; gộp phần ghi chú + thanh toán vào 1 card |
| Không chữ giải thích nghiệp vụ | Xoá "Tổng tiền do hệ thống tính…", "Địa chỉ lưu trước cập nhật…" giữ lại vì hữu ích cho khách |
| Không 2 nút cùng hành động | **1 nút** "Đặt hàng · {tổng}"; bỏ thanh "Xác nhận tổng" trùng |
| Không nút chết | Quét 4 màn chính: không có placeholder/TODO/"sắp ra mắt" |
| Không banner/thông tin giả | Xoá mọi nội dung trang trí; số liệu đều từ API |
| Voucher, Giỏ, Checkout thống nhất | Cùng màu, cùng `formatMoney`, cùng nguồn số liệu; giỏ và checkout cùng hiện 92.000 ₫ |
| Safe area & thanh nút cố định | `BottomBar` tự cộng inset đáy; checkout thêm `bottomPad` nên nút không che nội dung |
| Không thay UI framework | Giữ nguyên Expo Router + React Native + UI kit hiện có |

### Sửa thêm: bố cục Admin xem đơn bị vỡ

Trong lúc kiểm tra luồng **Admin xem đơn**, phát hiện lỗi thật:

- `InfoDescriptions` gọi `column={2}` nhưng một hàng có tổng span = 3
  (`Người nhận` span 1 + `Địa chỉ giao` span 2).
- antd **âm thầm cắt** span của ô vượt và log warning; lưới bị ép ⇒ **mọi nhãn và
  giá trị xuống dòng từng ký tự một** ("M ã đ ơ n" chạy dọc trang).
- Dữ liệu vẫn đúng, nhưng admin đọc như trang hỏng.

**Sửa:** `InfoDescriptions` tự chuẩn hoá span — **đóng hàng sớm** khi ô kế tiếp
không vừa (chèn ô trống cho phần còn lại) thay vì để antd cắt. Mọi hàng luôn
đúng bằng số cột, và trang có thể thêm/bớt trường mà không tự phá bố cục.

Thêm **9 test** (`apps/admin-web/test/info-descriptions.spec.tsx`) dùng cơ chế
`takeAntdWarnings()` sẵn có của repo: warning của antd làm **fail** test, nên lỗi
này không thể tái xuất.

---

## 8. Kiểm thử đã chạy thật

Toàn bộ chạy trên **`agrimarket_v2_test`** cho E2E; không reset/reseed DEV.

| Hạng mục | Kết quả |
|---|---|
| Typecheck (4 workspace) | ✅ sạch |
| Lint (4 workspace) | ✅ sạch |
| Mobile unit | ✅ **148/148** (16 file) |
| API unit | ✅ **361/361** (28 file) |
| Admin-web unit | ✅ **24/24** (5 file) |
| API E2E (TEST DB) | ✅ **322/322** (11 file) |
| Customer-web build | ✅ Compiled successfully, 19/19 trang |
| Screen sweep (21 route) | ✅ tất cả route sạch |
| **Tổng** | **533 unit + 322 E2E** |

### Các hạng mục người dùng yêu cầu — đều có bằng chứng

| Yêu cầu | Bằng chứng |
|---|---|
| Cart quantity sync | 4 mức số lượng, cart = preview ở mọi bước |
| COD checkout | Đơn thật ORD-20261011-0007/0009/0011 tạo được, tự huỷ sau kiểm tra |
| `expectedGrandTotal` | Tổng sai lệch 1đ → **HTTP 409** |
| HTTP 409 | `"The order total changed from 43999 to 44000"`; **và trên UI thật**: đổi giá 12.000→15.000 → nút thành "Đặt hàng · 50.000 ₫" kèm nhắc xác nhận, bấm lại tạo đúng **1** đơn |
| Idempotency | Retry cùng key → cùng order id; 3 retry đồng thời → 1 đơn |
| Voucher đủ/không đủ | 400 dưới mức / 201 đúng 50.000 / 404 mã sai / 400 hết lượt khách |
| Flash Sale đang chạy/hết hạn | 7 test API + 9 check TEST DB |
| Đồng hồ đếm ngược | Quan sát trực tiếp: `16:12:12` → `16:12:05` |
| Encoding UTF-8 | 6 test, 0 file hỏng toàn repo |
| Mobile → API → Admin | Đơn UI → MySQL → Admin list + detail |
| Customer Web không hồi quy | Build sạch 19/19 trang |

### Script kiểm tra (chạy lại được)

- `scripts/verify-checkout-cod.mjs` — **38/38 check** luồng COD + voucher + flash sale.
- `apps/api/prisma/verify-flash-expiry.ts` — **9/9 check** hết hạn, tự dọn dẹp.
- `apps/mobile/scripts/checkout-conflict-probe.mjs` — chứng minh key **tái dùng
  được** sau 409 (retry thành công, không kẹt vĩnh viễn).

---

## 9. File đã sửa / thêm

### Sửa

| File | Nội dung |
|---|---|
| `apps/mobile/app/addresses.tsx` | Khôi phục UTF-8 (28 dòng) |
| `apps/mobile/app/checkout.tsx` | Bỏ gate xác nhận sai; chọn voucher; 1 nút; lỗi theo nguyên nhân |
| `apps/mobile/app/(tabs)/cart.tsx` | Bỏ tổng trùng; không hiện giá khi đang tải; quy cách; link voucher |
| `apps/mobile/app/(tabs)/index.tsx` | Đồng hồ đếm ngược thật + tự refetch khi hết hạn |
| `apps/mobile/app/vouchers.tsx` | Danh mục chia dùng được / chưa dùng được kèm lý do |
| `apps/mobile/src/lib/checkout.ts` | `needsTotalConfirm` mới; `carryPendingTotal`; `classifyCheckoutError`; `translatedMessage` |
| `apps/api/test/business-rules/promotions.spec.ts` | +5 test cửa sổ Flash Sale |
| `apps/admin-web/src/components/common/InfoDescriptions.tsx` | Chuẩn hoá span, chống vỡ lưới |
| `apps/admin-web/src/components/common/EvidenceGallery.tsx` | Bỏ setState trong effect (lint) |
| `apps/customer-web/src/components/common/EvidenceGallery.tsx` | Bỏ setState trong effect (lint) |

### Thêm

| File | Nội dung |
|---|---|
| `apps/mobile/src/lib/countdown.ts` | Số học đếm ngược (thuần, test được) |
| `apps/mobile/src/lib/use-countdown.ts` | Hook đếm ngược + `AppState` |
| `apps/mobile/src/lib/vouchers.ts` | Phân loại voucher + lý do |
| `apps/mobile/src/lib/__tests__/encoding.test.ts` | Chống mojibake tái xuất |
| `apps/mobile/src/lib/__tests__/countdown.test.ts` | Test đếm ngược |
| `apps/mobile/src/lib/__tests__/vouchers.test.ts` | Test voucher |
| `apps/mobile/src/lib/__tests__/checkout-live.test.ts` | Mobile → API thật (tự skip nếu API tắt) |
| `apps/admin-web/test/info-descriptions.spec.tsx` | Chống vỡ lưới Descriptions |
| `apps/api/prisma/verify-flash-expiry.ts` | Kiểm chứng hết hạn trên TEST DB |
| `scripts/verify-checkout-cod.mjs` | Kiểm chứng COD end-to-end |

---

## 10. Trạng thái API / Admin

| Hạng mục | Trạng thái |
|---|---|
| `POST /orders/checkout-preview` | ✅ Trả tổng chuẩn, đánh dấu `available`, áp voucher |
| `POST /orders/checkout` | ✅ Tạo đơn COD; 409 khi tổng cũ; idempotent |
| `GET /flash-sales` | ✅ Đủ `startsAt`, `endsAt`, `status`, `flashPrice`, `quota`, `soldQuantity`, `perCustomerLimit` |
| `GET /products` (`effectivePrice`) | ✅ Khớp `flashPrice` và giá checkout |
| `GET /vouchers` | ✅ Đủ `minOrderAmount`, `maxDiscount`, `usageLimit`, `perCustomerLimit`, `usedCount`, `startsAt`, `endsAt` |
| Admin Voucher / Product Discount / Flash Sale | ✅ Đủ trường; **đúng 3 nghiệp vụ**, không thêm loại |
| Admin xem đơn | ✅ Danh sách + chi tiết hiển thị đúng; đã sửa lỗi vỡ lưới |
| Admin xem đơn đối tác | ✅ `partnerOrders`, hoa hồng, phải trả hiển thị đúng |

**Không có thay đổi nào ở tầng nghiệp vụ tiền** — toàn bộ quy tắc giá, voucher,
flash sale giữ nguyên; chỉ sửa frontend và bổ sung test.

---

## 11. Còn chờ kiểm thử trên thiết bị Android

Các mục sau **chưa** kiểm chứng được vì cần máy Android thật qua Expo Go.
Phần logic đã có unit test và đã chạy trên Expo web; đây là các hành vi đặc thù
thiết bị:

1. **Chu kỳ nền/foreground thật.** Đã viết listener `AppState` và test logic tính
   lại từ `endsAt`, nhưng chưa đo trên máy khi Android throttle timer lúc ở nền.
   *Cần:* mở app → để nền 5 phút → quay lại, kiểm tra đồng hồ đúng và không nhảy sai.

2. **Hết hạn khi app đang mở.** Card tự ẩn và gọi lại API. Đã test bằng cách tạo
   chương trình hết hạn trên TEST DB và quan sát API; chưa quan sát trên máy khi
   đồng hồ chạm 0 lúc màn hình đang mở.

3. **Safe area trên máy có tai thỏ / thanh gesture.** `BottomBar` đã cộng inset,
   nhưng cần xác nhận nút "Đặt hàng" không bị thanh gesture che trên máy thật.

4. **Bàn phím khi nhập ghi chú.** Đã đặt `keyboardShouldPersistTaps="handled"`;
   cần xác nhận bàn phím không che ô ghi chú trên màn nhỏ.

5. **Đặt hàng COD thật trên máy.** Luồng đã chạy thành công trên Expo web với
   backend thật (ORD-20261011-0007). Cần bấm trên máy để xác nhận cùng kết quả.

6. **Vuốt ngang dải Flash Sale.** Đã cấu hình `ScrollView horizontal`; cần xác
   nhận thao tác vuốt mượt trên cảm ứng.

---

## 12. Ràng buộc đã tuân thủ

- ✅ Không reset / reseed DEV. Mọi test ghi dữ liệu chỉ chạy trên `agrimarket_v2_test`
  hoặc tạo rồi tự huỷ trên DEV (đơn kiểm tra đều ở trạng thái `CANCELLED`).
- ✅ **Không commit, không push.**
- ✅ Không APK/EAS; giữ Expo Go.
- ✅ Giữ đúng **3 nghiệp vụ** khuyến mãi: Voucher, Product Discount, Flash Sale.
- ✅ **Không sửa thời gian trong DB** để làm đẹp đồng hồ.
- ✅ **Không thay font** — sửa encoding tận gốc.
- ✅ Không thay UI framework.
- ✅ Bảo toàn mọi thay đổi chưa commit có sẵn trong repo.
