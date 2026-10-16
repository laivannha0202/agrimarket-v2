# AgriMarket V2 — Mobile UI Kit Integration — FINAL REPORT

**Ngày:** 2026-10-10
**Phạm vi:** `apps/mobile` (Expo Go + Expo Router)
**Bộ tài nguyên:** `AGRIMARKET_MOBILE_V2_UI_IMAGES_AND_GUIDE_20261010/AGRIMARKET_MOBILE_V2_UI_KIT`
**Nhánh git:** `main` — **không commit, không push, không reset, không đổi nhánh**

---

## KẾT LUẬN

> ## `SOURCE READY — ANDROID VISUAL ACCEPTANCE PENDING`

Mã nguồn đã sẵn sàng và đã được kiểm chứng trên **Expo Web (400×866)** với **dữ liệu Backend V2 thật**.
**Chưa có thiết bị Android nào được kết nối** (`adb devices` → danh sách rỗng), nên **kiểm thử hình ảnh trên thiết bị thật vẫn PENDING**.

Báo cáo này **không** tuyên bố Android PASS. Mọi kết luận về giao diện dưới đây là kết quả đo trên Expo Web; các điểm chỉ có thể xác nhận trên thiết bị được liệt kê riêng ở **mục H**.

---

## A. Phạm vi đã thực hiện & những gì KHÔNG làm

### A.1 Đã làm

| Hạng mục | Kết quả |
|---|---|
| Thiết kế lại toàn bộ màn hình khách hàng theo 8 ảnh tham khảo | **21 màn hình** (+ 2 file `_layout.tsx`) trong `apps/mobile/app/` |
| Hệ thống design token dùng chung | `src/lib/theme.ts`, `src/components/ui.tsx` |
| Chép 12 PNG của kit vào app | `apps/mobile/assets/design/` (SHA256 khớp 12/12) |
| Nối toàn bộ dữ liệu từ Backend V2 | Không có dữ liệu giả nào trong app |
| Xử lý đủ 5 UI state | `loading` / `success_data` / `success_empty` / `error` / `offline` |
| Kiểm thử | typecheck, lint, 78 unit test, 14 integration check, sweep 21 route |

### A.2 Những gì CỐ Ý KHÔNG làm

| Không làm | Lý do |
|---|---|
| Tạo lại project | Yêu cầu: giữ nguyên repo, giữ Expo Go + Expo Router |
| Build APK / EAS | Ngoài phạm vi |
| Bắt buộc cắm USB | Không có thiết bị; ghi nhận PENDING thay vì tuyên bố khống |
| Nhúng ảnh mockup vào app | `01_UI_REFERENCES` chỉ là tham khảo bố cục |
| Hardcode giá / tên / đánh giá / điểm thưởng từ mockup | Dữ liệu giả |
| Nút Google/Facebook login, tự đăng ký, quên mật khẩu | Backend V2 không có endpoint |
| Màn "Sản phẩm yêu thích", "Điểm thưởng", "Đổi mật khẩu" | Backend V2 không có endpoint |
| Tạo danh mục mới theo icon của kit | Chỉ hiển thị danh mục API thật trả về |
| Thêm font file / thư viện UI mới | Yêu cầu; dùng Ionicons sẵn có |
| Dùng SVG trực tiếp | Tránh native dependency mới; đã có PNG |
| Sửa `apps/customer-web` | Chỉ tham chiếu để đồng bộ nhãn/palette |
| Commit / push / reset / đổi nhánh | Yêu cầu |

---

## B. Tài nguyên UI Kit — Dùng / Không dùng

### B.1 Ảnh tham khảo (`01_UI_REFERENCES`) — 8 ảnh

**Không ảnh nào được đưa vào app.** Đã xác nhận bằng grep: không có tham chiếu nào tới `01_UI_REFERENCES`, `REFERENCE_ONLY`, `02_APP_ASSETS` hay `UI_KIT` trong `apps/mobile/app` và `apps/mobile/src`.

| Ảnh tham khảo | Dùng để làm gì |
|---|---|
| `01_home_REFERENCE_ONLY.png` | Bố cục: brand row + search, hero banner, dải danh mục tròn, Flash Sale ngang, lưới 2 cột |
| `02_catalog_REFERENCE_ONLY.png` | Bố cục: chip danh mục, hàng công cụ lọc/sắp xếp, thẻ sản phẩm 2 cột có nút giỏ |
| `03_product_detail_REFERENCE_ONLY.png` | Bố cục: gallery + chấm trang, khối giá, chọn quy cách, thanh hành động cố định |
| `04_cart_REFERENCE_ONLY.png` | Bố cục: dòng sản phẩm, stepper số lượng, khối tổng tiền, thanh thanh toán cố định |
| `05_trace_REFERENCE_ONLY.png` | Bố cục: ô nhập mã, minh họa quét, lối vào camera |
| `06_account_REFERENCE_ONLY.png` | Bố cục: avatar + tên + email, nhóm dòng, nút đăng xuất đỏ |
| `DESIGN_BOARD_6_SCREENS_AND_TOKENS_REFERENCE_ONLY.png` | Token màu/khoảng cách/bo góc/typography |
| `DESIGN_BOARD_9_SCREENS_REFERENCE_ONLY.png` | Trạng thái rỗng, phân cấp phụ |

### B.2 Tài nguyên dùng được (`02_APP_ASSETS`) — 12 PNG, dùng cả 12

Cả 12 file đã được chép vào `apps/mobile/assets/design/` và **SHA256 khớp chính xác** với `03_DOCS/ASSET_MAP.csv` (kiểm tra 12/12 MATCH).

| # | Asset | Màn hình dùng | Dùng? | Lý do | Bằng chứng kiểm thử |
|---|---|---|---|---|---|
| 1 | `brand/agrimarket_leaf_mark_512.png` | Home header, Login | ✅ | Chưa có logo doanh nghiệp chính thức trong repo; kit cho phép dùng tạm | `FINAL-01-home.png`, `07-login.png` |
| 2 | `home/hero_nong_san_no_text_1200x480.png` | Home hero | ✅ | Ảnh không chữ → chữ tiếng Việt phủ lên bằng component, dịch được. **Không gán giờ/giảm giá giả** | `FINAL-01-home.png` |
| 3 | `categories/category_rau_la_256.png` | Home danh mục | ✅ | Khớp slug thật `rau-an-la` | `FINAL-01-home.png` |
| 4 | `categories/category_trai_cay_256.png` | Home danh mục | ✅ | Khớp slug thật `trai-cay` | `FINAL-01-home.png` |
| 5 | `categories/category_cu_qua_256.png` | Home danh mục | ✅ | Khớp slug thật `cu-qua` | `FINAL-01-home.png` |
| 6 | `categories/category_nau_san_256.png` | Home danh mục | ✅ | Khớp slug thật `gao-ngu-coc` (nông sản khô) | `FINAL-01-home.png` |
| 7 | `farm/farm_fallback_1000x600.png` | `/farms`, `/farm/[id]` | ✅ | **Backend V2 không có trường ảnh trang trại.** Luôn gắn nhãn "Hình minh hoạ" | `10-farms.png` |
| 8 | `trace/trace_scan_illustration_640x440.png` | `/trace`, `/scan` | ✅ | Chỉ là minh họa; **không** hiển thị như QR quét được | `FINAL-05-trace.png`, `15-scan.png` |
| 9 | `empty_states/empty_cart_360.png` | Giỏ rỗng | ✅ | Chỉ khi tải thành công và rỗng thật | `FINAL-04-cart.png` |
| 10 | `empty_states/empty_orders_360.png` | Đơn hàng rỗng | ✅ | Sau đăng nhập + tải thành công, 0 đơn | `J11-orders.png` |
| 11 | `empty_states/empty_search_360.png` | Lọc/tìm không kết quả | ✅ | Dữ liệu **có** nhưng bộ lọc không khớp | `FINAL-02-catalog.png` |
| 12 | `empty_states/empty_network_360.png` | Lỗi mạng | ✅ | **Chỉ** khi `ApiError.status === 0`; có nút Thử lại | `ui.tsx:446` + unit test |

### B.3 Quy tắc "ảnh sai = tuyên bố sai"

Kit chỉ có glyph cho **đúng 4 slug danh mục**. Backend V2 đang trả về **5 danh mục**:

| id | slug | tên | Glyph của kit? |
|---|---|---|---|
| 11 | `rau-an-la` | Rau ăn lá | ✅ `category_rau_la_256.png` |
| 12 | `rau-an-qua` | Rau ăn quả | ❌ **không có asset** |
| 13 | `cu-qua` | Củ quả | ✅ `category_cu_qua_256.png` |
| 14 | `trai-cay` | Trái cây | ✅ `category_trai_cay_256.png` |
| 15 | `gao-ngu-coc` | Gạo và ngũ cốc | ✅ `category_nau_san_256.png` |

→ **4/5 danh mục có glyph; 1 danh mục ("Rau ăn quả", id 12) không có.** Với danh mục đó app render **chữ cái đầu trong vòng tròn**, **không** mượn glyph của danh mục khác. Hàm `categoryIconKey()` trả `null` cho slug không nằm trong 4 slug, và có unit test khoá hành vi này.

> Lý do: gán glyph "Trái cây" cho danh mục "Rau ăn quả" là một **khẳng định sai về dữ liệu**, không phải một lỗi thẩm mỹ.

---

## C. Sáu màn hình tham khảo — Đối chiếu thực tế

Ảnh chụp thật: `apps/mobile/.qa-shots/FINAL-01..06-*.png` (400×866 @2x, dữ liệu Backend V2 thật).

### C.1 Home — `01_home_REFERENCE_ONLY.png`

| Yếu tố trong tham khảo | Thực tế đã làm | Trạng thái |
|---|---|---|
| Brand row + icon truy xuất + icon giỏ | Có, logo thật + 2 nút, có `accessibilityLabel` | ✅ Khớp |
| Ô tìm kiếm | Có, submit → `/catalog?search=` | ✅ Khớp |
| Hero banner | Có, ảnh kit không chữ + chữ thật phủ lên | ✅ Khớp |
| Dải danh mục tròn | Có, **chỉ danh mục API thật**, glyph theo slug | ✅ Khớp (4/11 có glyph) |
| Flash Sale | Có — **chỉ khi backend có chương trình đang chạy**. Hiện tại id=3 đang `ACTIVE` và trong khung thời gian, với 2 suất thật | ✅ Khớp, có dữ liệu thật |
| "Đang giảm giá" | Có — chỉ hiện khi có sản phẩm giảm giá thật | ✅ Khớp |
| Sản phẩm nổi bật (lưới 2 cột) | Có, nút thêm giỏ thật | ✅ Khớp |
| Trang trại | Có, ảnh minh họa + nhãn "Hình minh hoạ" | ✅ Khớp có ghi chú |
| Lối vào truy xuất | Có, luôn hiển thị | ✅ Khớp |

**Khác biệt có chủ đích:** mockup hiển thị Flash Sale với giá/giờ giả. App **không** bịa chương trình: nếu backend không có Flash Sale đang chạy, **cả khối bị bỏ hoàn toàn** thay vì hiện khung rỗng giả vờ là khuyến mãi.

### C.2 Catalog — `02_catalog_REFERENCE_ONLY.png`

| Yếu tố | Thực tế | Trạng thái |
|---|---|---|
| Ô tìm kiếm | Có, đồng bộ với route param | ✅ |
| Chip danh mục | Có, "Tất cả" + danh mục API thật | ✅ |
| Hàng công cụ Lọc / Sắp xếp | Có | ✅ |
| Lưới 2 cột, thẻ có ảnh/nhãn/quy cách/giá | Có | ✅ |
| **Nút giỏ trên mỗi thẻ** | **Có — gọi API thật `POST /carts/me/items`** | ✅ Khớp |
| Nhãn `-N%` | Có, tính từ `basePrice` vs `unitPrice` do server trả | ✅ |
| Overlay "Hết hàng" | Có, khi quy cách đang hiển thị hết hàng | ✅ |

**Khác biệt có chủ đích:** mockup có nút "Sắp xếp" thay đổi thứ tự từ server. Backend V2 **không có tham số sort**, nên sắp xếp và lọc "Còn hàng" là **thao tác hiển thị trên dữ liệu đã tải**, và màn hình **nói rõ điều đó** thay vì giả vờ gọi server.

**Nút giỏ đã được kiểm chứng end-to-end** (`scripts/card-add-probe.mjs`):
```
cart before: 0 item(s)
2. found cart button "Thêm Rau muống hạt vào giỏ" (BUTTON in DIV, 34x34)
3. after tap -> route /catalog
   stayed on the catalogue (button does not hijack the card link)
   feedback shown: yes ("Đã thêm vào giỏ hàng.")
4. backend cart now holds 1 item(s)
   added: Rau muống hạt — Bó 500 g (variant 51)
cleanup: cart restored to 0 item(s) (started at 0)
```
→ Nút thêm **đúng quy cách mà thẻ đang hiển thị** (variant 51, 12.000₫), không điều hướng nhầm, giỏ backend thật nhận hàng, và probe tự dọn sạch.

### C.3 Product detail — `03_product_detail_REFERENCE_ONLY.png`

| Yếu tố | Thực tế | Trạng thái |
|---|---|---|
| Gallery ảnh + chấm trang | Có, **ảnh thật từ `/uploads/`**; ảnh bìa (isPrimary) đứng đầu | ✅ |
| Tên, quy cách, giá, giá gạch | Có, từ `effectivePrice` của server | ✅ |
| Nhãn `-N%` | Có | ✅ |
| Chọn quy cách | Có, từ `variants` thật | ✅ |
| Stepper số lượng | Có, chặn theo `availableQuantity` thật | ✅ |
| Nút "Thêm vào giỏ" + "Mua ngay" | Có, thanh cố định | ✅ |
| Đánh giá | Có, từ API thật | ✅ |
| Khối trang trại | Có | ✅ |
| **Mặc định chọn quy cách** | **Quy cách rẻ nhất còn hàng — trùng đúng thẻ đã bấm** | ✅ |

**Đã sửa một lỗi thật:** trước đây màn này mặc định `variants[0]` (thứ tự catalogue) trong khi thẻ quảng cáo quy cách rẻ nhất → khách bấm thẻ ghi 12.000₫ lại vào trang hiện quy cách đắt hơn. Nay cả hai dùng chung hàm thuần `displayVariant()`.

### C.4 Cart — `04_cart_REFERENCE_ONLY.png`

| Yếu tố | Thực tế | Trạng thái |
|---|---|---|
| Dòng sản phẩm có ảnh | Có — ảnh join từ `GET /products/:id` | ✅ |
| Stepper số lượng | Có, ghi thẳng xuống backend | ✅ |
| Nút xoá | Có | ✅ |
| Khối mã giảm giá | Có | ✅ |
| Tổng tiền | **Có — tính bởi backend (`/orders/checkout-preview`)**, app chỉ hiển thị | ✅ |
| Thanh "Tiến hành thanh toán" cố định | Có | ✅ |
| Giỏ rỗng | Ảnh `empty_cart` + CTA | ✅ |

### C.5 Trace — `05_trace_REFERENCE_ONLY.png`

| Yếu tố | Thực tế | Trạng thái |
|---|---|---|
| Ô nhập mã truy xuất | Có, chuẩn hóa mã, có unit test | ✅ |
| Nút quét QR | Có → `/scan` (expo-camera thật) | ✅ |
| Minh họa quét | Có (`traceScan`), **không** hiển thị như QR thật | ✅ |
| Trang kết quả truy xuất | Có — mã thật `TRC-000019-BAPCA` → lô `LOT-20260923-0019` "Bắp cải trắng", trạng thái `SELLABLE` | ✅ |
| Nhật ký sự kiện | Có, nhãn tiếng Việt từ enum thật (lô này có 3 sự kiện) | ✅ |
| Chứng nhận | Có, từ API thật. **Lô này không có chứng nhận nào → khối bị bỏ hẳn**, không hiện tiêu đề rỗng | ✅ Khớp, trung thực |

### C.6 Account — `06_account_REFERENCE_ONLY.png`

| Yếu tố | Thực tế | Trạng thái |
|---|---|---|
| Avatar + tên + email | Có, từ `GET /auth/me` | ✅ |
| Nhóm "Mua sắm" | Đơn hàng, Trả hàng, Đánh giá của tôi | ✅ |
| Nhóm "Tài khoản" | Địa chỉ giao hàng, Mã giảm giá | ✅ |
| Nút đăng xuất đỏ | Có | ✅ |
| **"Sản phẩm yêu thích"** | **Không có** | ⛔ Backend V2 không có endpoint |
| **"Điểm thưởng"** | **Không có** | ⛔ Backend V2 không có endpoint |
| **"Đổi mật khẩu"** | **Không có** | ⛔ Backend V2 không có endpoint |

Footer của màn hình **nói rõ**: *"Danh sách yêu thích, điểm thưởng và đổi mật khẩu chưa được backend V2 hỗ trợ nên không hiển thị trong ứng dụng."* — thiếu sót được nêu minh bạch, không im lặng bỏ qua.

### C.7 Login (không có trong 6 màn tham khảo, nhưng mockup Home có nút Google)

Mockup có nút "Đăng nhập bằng Google". Backend V2 **không có OAuth** → app **không** render nút đó. Footer nêu rõ: tài khoản do AgriMarket cấp, chưa hỗ trợ tự đăng ký / Google / Facebook / đổi mật khẩu.

---

## D. Yêu cầu 104 xã/phường Hưng Yên — **KHÔNG ĐẠT**

### D.1 Trạng thái: `NOT MET — BACKEND V2 KHÔNG CÓ API ĐƠN VỊ HÀNH CHÍNH`

Đã dò **12 đường dẫn** trên Backend V2 đang chạy. **Tất cả trả 404:**

```
/provinces                         HTTP 404
/districts                         HTTP 404
/wards                             HTTP 404
/communes                          HTTP 404
/administrative-units              HTTP 404
/addresses/provinces               HTTP 404
/geo                               HTTP 404
/locations                         HTTP 404
/shipping/provinces                HTTP 404
/meta/provinces                    HTTP 404
/addresses/units                   HTTP 404
/provinces/33/districts            HTTP 404
```

### D.2 Bằng chứng ở tầng dữ liệu và DTO

Không tồn tại bảng danh mục đơn vị hành chính. `apps/api/prisma/schema.prisma` khai báo địa chỉ là **văn bản tự do**:

```prisma
province      String
district      String?
ward          String?
```

DTO tương ứng chỉ kiểm tra kiểu chuỗi, **không** kiểm tra theo danh mục:

```ts
// apps/api/src/orders/dto/checkout.dto.ts
province!: string;   // @IsString()
district?: string;   // @IsString() @IsOptional()
ward?: string;       // @IsString() @IsOptional()
village?: string;    // @IsString() @IsOptional()
detail!: string;     // @IsString()
```

Không có file dữ liệu `*.json` / `*.csv` / `*.sql` nào chứa danh mục tỉnh/huyện/xã trong repo.

### D.3 Ứng dụng đã xử lý như thế nào

App **không bịa** 104 xã/phường và **không** dựng dropdown giả. Màn `/addresses` nhập địa chỉ dạng văn bản và **nói rõ**:

> *"Nhập địa chỉ theo thực tế nơi nhận hàng. Tỉnh/Thành phố, Quận/Huyện và Phường/Xã là dạng văn bản."*

### D.4 Kết luận mục D

| Yêu cầu | Kết quả |
|---|---|
| Chọn tỉnh/huyện/xã từ danh mục 104 đơn vị hành chính Hưng Yên | ❌ **KHÔNG THỰC HIỆN ĐƯỢC** |
| Nguyên nhân | Backend V2 không có API và không có dữ liệu đơn vị hành chính |
| Đã tạo dữ liệu giả? | ❌ Không |
| Có đánh dấu PASS? | ❌ **Không — đây là hạng mục KHÔNG ĐẠT** |

**Điều kiện để đạt:** cần bổ sung ở Backend V2 một nguồn dữ liệu đơn vị hành chính + endpoint tra cứu, sau đó Mobile mới có thể thay ô nhập văn bản bằng bộ chọn. Việc này **ngoài phạm vi `apps/mobile`** và chưa được thực hiện.

---

## E. Kiểm chứng kỹ thuật

### E.1 Kiểm tra tự động (đã chạy, tất cả xanh)

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck --workspace @agrimarket/mobile` | **exit 0** — 0 lỗi TS |
| `npm run lint --workspace @agrimarket/mobile` | **exit 0** — 0 error, 0 warning |
| `npm run test --workspace @agrimarket/mobile` | **78 passed / 78**, 11 file |
| `npm run test:integration --workspace @agrimarket/mobile` | **pass=14 fail=0** (chỉ đọc) |
| Screen sweep 21 route @ 400×866 | **tất cả `ok`** — không trang trắng, không tràn ngang, **không lỗi console** |
| `node scripts/dead-route-audit.mjs` | **PASS** — 19/19 đích điều hướng phân giải được, 0 nút chết |

**Bộ unit test (78):**

| File | Nội dung |
|---|---|
| `api-client.test.ts` | phân loại lỗi mạng vs lỗi nghiệp vụ |
| `checkout.test.ts` | payload, `expectedGrandTotal`, phân loại 409 |
| `design-assets.test.ts` | ánh xạ slug→glyph, chọn ảnh trạng thái rỗng |
| `format.test.ts` | tiền tệ, khối lượng, phần trăm giảm |
| `load-state.test.ts` | thứ tự ưu tiên loading/error/empty/data |
| `messages.test.ts` | dịch thông báo lỗi backend |
| `product-variant.test.ts` | chọn quy cách hiển thị + hết hàng |
| `promotions.test.ts` | ảnh bìa (`isPrimary`), thứ tự gallery, URL ảnh |
| `session.test.ts` | lưu/đọc phiên, fallback web |
| `status.test.ts` | nhãn trạng thái + luồng đơn |
| `trace-code.test.ts` | chuẩn hóa mã truy xuất |

### E.2 Kiểm chứng với Backend V2 thật

| Hạng mục | Bằng chứng |
|---|---|
| Danh mục | 5 danh mục thật: id 11–15 |
| Sản phẩm | 14 sản phẩm thật: id 29–42; sản phẩm 29 và 31 có 2 ảnh |
| Trang trại | 4 trang trại thật: id 9–12 |
| Flash Sale | id=3 "Flash Sale cuối tuần Hưng Yên" — `ACTIVE`, `2026-09-07` → `2026-11-06`, 2 suất thật (variant 36 giá 50.000₫/quota 100; variant 40 giá 24.000₫/quota 200) |
| Mã giảm giá | 1 voucher `ACTIVE` |
| Giảm giá sản phẩm | 1 chương trình `ACTIVE` |
| Truy xuất | mã `TRC-000019-BAPCA` → lô `LOT-20260923-0019` "Bắp cải trắng" |
| Khách hàng thật | `lan.nguyen@agrimarket.vn` (id 14, `CUSTOMER`), 4 đơn (id 21/20/19/14), 1 địa chỉ (Hưng Yên / Văn Lâm / Tân Quang) |
| Giỏ hàng | 0 dòng — đã dọn sạch sau mọi probe |
| Thêm giỏ từ thẻ | `card-add-probe.mjs` — variant 51, dọn sạch sau khi chạy |
| Vòng tròn giỏ hàng | thêm → giỏ hiển thị ảnh thật + tên + quy cách + giá → dọn sạch qua API (`cart items after cleanup = 0`) |

### E.3 Kiểm chứng luồng thanh toán (đã chạy trên backend thật)

`scripts/checkout-conflict-probe.mjs` — **không tạo đơn nào**:

```
1. wrong expectedGrandTotal -> HTTP 409
   message: "The order total changed from 1 to 32000. Please review the updated price and confirm again."
   OK: the app will classify this as "total-changed"
   orders after refusal: 4 (nothing created — rolled back)

2. same key, different total -> HTTP 409
   message: "The order total changed from 2 to 32000. ..."
   OK: the key is reusable — re-confirming with the corrected total can succeed

orders after: 4 (started at 4)
PROBE CREATED NOTHING — safe to run against DEV
```

**Kết luận:** tổng tiền sai → 409, **không tạo đơn, transaction rollback**; khoá idempotency **không bị đốt** bởi lần bị từ chối, nên sau khi khách xác nhận lại tổng mới thì đơn **vẫn đặt được** — không có ngõ cụt.

**Hợp đồng đã tuân thủ:**
- Tổng tiền **chỉ** lấy từ `checkout-preview`; app không tự tính.
- Gửi `expectedGrandTotal` đúng như hợp đồng.
- `Idempotency-Key` **một khoá cho một chữ ký payload**; chữ ký **cố ý không** gồm `expectedGrandTotal` để lần thử lại sau khi mất phản hồi **phát lại** đúng đơn cũ thay vì tạo khoá mới.
- Khách **phải** bấm "Xác nhận tổng {số tiền}" trước khi nút gửi hoạt động.
- Chống bấm đúp: cờ `submitting`, `canSubmit`, `loading={submitting}`.
- 409 được phân loại thành **5 nhóm** (`total-changed`, `in-flight`, `key-reuse`, `order-gone`, `other`) vì backend dùng cùng mã 409 cho nhiều nguyên nhân và **chỉ có thông báo** phân biệt được. Chỉ `total-changed` mới xoá xác nhận của khách.
- **Chỉ COD**, ghi rõ "Duy nhất".

### E.4 Kiểm chứng pipeline ảnh Admin → Mobile

| Hạng mục | Kết quả |
|---|---|
| URL ảnh | `http://localhost:3000/uploads/products/...` → `resolveImageUrl()` đổi sang origin LAN |
| Phục vụ file | 200, `Content-Type: image/webp` |
| Ảnh khác nhau | SHA256 khác nhau cho 2 ảnh của cùng sản phẩm |
| Cache | `Cache-Control: public, max-age=0` + `ETag` + `Last-Modified`; `If-Modified-Since` → **304** |
| Thay ảnh | Tên file dùng `randomUUID()` → URL mới → **không bị cache ảnh cũ** |
| Ảnh thiếu | 404 → `ProductThumb` hiển thị fallback |
| Thứ tự gallery | Sắp theo `sortOrder`, **ảnh bìa (`isPrimary`) đứng đầu** |
| Sản phẩm 29 | Gallery hiển thị đủ 2 ảnh thật |

### E.5 Lỗi thật đã tìm ra và sửa trong quá trình kiểm thử

| # | Lỗi | Mức độ | Cách sửa |
|---|---|---|---|
| 1 | **`<Link asChild>` + style dạng hàm làm mất toàn bộ style** | 🔴 Nghiêm trọng, im lặng | Thay bằng primitive `LinkPress` |
| 2 | `<button>` lồng trong `<button>` | 🟠 | Nút giỏ thành **anh em** của link thẻ, không phải con |
| 3 | Mặc định quy cách khác với thẻ đã bấm | 🟠 Sai giá | Dùng chung `displayVariant()` |
| 4 | Quy cách hết hàng vẫn "đại diện" thẻ | 🟠 | Ưu tiên quy cách còn hàng |
| 5 | Mọi 409 bị coi là "đổi giá" | 🟠 | Phân loại 5 nhóm theo thông báo |
| 6 | `session.ts` import `react-native` → vitest vỡ | 🟡 | Bỏ import, dò SecureStore lúc chạy |
| 7 | `expo-secure-store` là stub rỗng trên web | 🟡 | Dò lúc chạy + fallback `localStorage` |
| 8 | `StyleSheet.absoluteFillObject` bị bỏ ở RN 0.86 | 🟡 | Đổi sang `StyleSheet.absoluteFill` |
| 9 | Sweep **không** bắt lỗi console | 🟠 Kiểm thử giả | Thêm bắt console + **tự kiểm tra chính nó** |
| 10 | Ảnh thumbnail Flash Sale tràn khỏi khung bo góc | 🟡 | Kích thước tường minh thay `aspectRatio` |

#### Chi tiết lỗi #1 — lỗi im lặng nguy hiểm nhất

`<Link asChild>` render con qua Radix `Slot`. Với prop `style`, `mergeProps` làm:

```js
overrideProps.style = { ...slotPropValue, ...childPropValue };
```

Khi style của con là **dạng hàm** `style={({ pressed }) => [...]}`, phép spread một *function* cho ra `{}` → **con bị render không có style nào**. Không có lỗi, không có cảnh báo: thẻ chỉ đơn giản mất viền, padding, bo góc và hướng flex, danh sách xẹp thành chữ xếp dọc.

Đã kiểm chứng bằng `scripts/style-probe.mjs` (đo DOM trước/sau). **Tất cả** vị trí trong `app/` và `ProductCard.tsx` đã chuyển sang `LinkPress`; `grep asChild` giờ chỉ còn 2 dòng chú thích giải thích lý do.

#### Chi tiết lỗi #9 — kiểm thử giả

Screen sweep ban đầu chỉ đo hình học. Lỗi `<button>` lồng nhau **lọt qua toàn bộ** vì sweep báo `ok` cho mọi route. Đã thêm bắt `Runtime.consoleAPICalled` + `Log.entryAdded`, **và** thêm **tự kiểm tra**: sweep tự bắn một `console.error('SWEEP_CONSOLE_SELFTEST')` ở route đầu và khẳng định nó được bắt. Nếu bộ bắt lỗi hỏng, sweep **báo hỏng** thay vì báo "sạch" một cách giả tạo:

```
console capture: VERIFIED (self-test message received)
```

---

## F. Bảng đối chiếu Route ↔ API ↔ Trạng thái

| Route | Endpoint Backend V2 | Loading | Empty | Error | Offline |
|---|---|---|---|---|---|
| `/` | `/categories`, `/products`, `/flash-sales`, `/farms`, `/product-discounts` | ✅ | ✅ | ✅ | ✅ |
| `/catalog` | `/products`, `/categories` (phân trang) | ✅ | ✅ `search` | ✅ | ✅ |
| `/product/[id]` | `/products/:id`, `/products/:id/reviews` | ✅ | ✅ | ✅ | ✅ |
| `/cart` | `/carts/me`, `/products/:id`, `/orders/checkout-preview` | ✅ | ✅ `cart` | ✅ | ✅ |
| `/checkout` | `/customers/me/addresses`, `/orders/checkout-preview`, `/orders/checkout`, `/vouchers` | ✅ | ✅ | ✅ | ✅ |
| `/orders` | `/orders/me` | ✅ | ✅ `orders` | ✅ | ✅ |
| `/order/[id]` | `/orders/:id`, `/orders/:id/cancel` | ✅ | — | ✅ | ✅ |
| `/returns` `/return/[id]` | `/returns/me`, `/returns/:id` | ✅ | ✅ | ✅ | ✅ |
| `/complaints` `/complaint/[id]` | `/complaints/me`, `/complaints/:id` | ✅ | ✅ | ✅ | ✅ |
| `/my-reviews` | `/reviews/me` | ✅ | ✅ | ✅ | ✅ |
| `/addresses` | `/customers/me/addresses` (CRUD) | ✅ | ✅ | ✅ | ✅ |
| `/vouchers` | `/vouchers` | ✅ | ✅ | ✅ | ✅ |
| `/farms` `/farm/[id]` | `/farms`, `/farms/:id` | ✅ | ✅ | ✅ | ✅ |
| `/trace` `/trace/[code]` | `/trace/:code` | ✅ | ✅ | ✅ | ✅ |
| `/scan` | camera (expo-camera) | ✅ | — | ✅ | — |
| `/login` | `/auth/login`, `/auth/me` | ✅ | — | ✅ | ✅ |

**Không có route chết.** Đã kiểm chứng bằng script `scripts/dead-route-audit.mjs` — script dựng bảng route từ cây file (đúng cách Expo Router làm) rồi đối chiếu **mọi** `href` / `router.push` / `router.replace` trong source:

```
routes discovered: 28
navigation targets:
  OK    /(tabs)                    <- app/(tabs)/account.tsx
  OK    /(tabs)/cart               <- app/(tabs)/index.tsx
  OK    /(tabs)/catalog            <- app/(tabs)/account.tsx
  OK    /(tabs)/trace              <- app/(tabs)/index.tsx
  OK    /addresses                 <- app/checkout.tsx
  OK    /checkout                  <- app/(tabs)/cart.tsx
  OK    /complaint/[id]            <- app/complaints.tsx
  OK    /complaints                <- app/order/[id].tsx
  OK    /farm/[id]                 <- app/(tabs)/index.tsx
  OK    /farms                     <- app/(tabs)/index.tsx
  OK    /login                     <- app/(tabs)/account.tsx
  OK    /my-reviews                <- app/order/[id].tsx
  OK    /order/[id]                <- app/checkout.tsx
  OK    /product/[id]              <- app/(tabs)/cart.tsx
  OK    /return/[id]               <- app/returns.tsx
  OK    /returns                   <- app/order/[id].tsx
  OK    /scan                      <- app/(tabs)/trace.tsx
  OK    /trace/[code]              <- app/(tabs)/trace.tsx
  OK    /vouchers                  <- app/(tabs)/cart.tsx

DEAD-ROUTE AUDIT: PASS — all 19 targets resolve
```

Lưu ý: kiểm tra này **cần thiết** vì `href` nhận chuỗi nên TypeScript **không** bắt được route sai.

**Không có nút chết.** Đã rà toàn bộ `disabled={...}` trong `app/` và `src/` (19 chỗ): **tất cả** đều gắn với trạng thái đang chạy thật (`isPending` / `submitting` / `busy` / `pending`) hoặc giới hạn thật (`atMin` / `atMax` / `lock` / `addDisabled`). **Không** có chỗ nào `disabled={true}` cố định hay `onPress` rỗng.

---

## G. Danh sách file

### G.1 Tạo mới

| File | Vai trò |
|---|---|
| `src/lib/design-assets.ts` | Đăng ký 12 PNG bằng `require()` tĩnh |
| `src/lib/design-asset-keys.ts` | Ánh xạ thuần (test được): slug→glyph, chọn ảnh rỗng |
| `src/lib/product-variant.ts` | Chọn quy cách hiển thị (dùng chung thẻ + trang chi tiết) |
| `src/lib/use-products.ts` | `useProductMap`, `productImageUrl` — join ảnh sản phẩm |
| `src/lib/use-add-to-cart.ts` | Một hành vi thêm-giỏ cho Home / Catalog |
| `src/lib/__tests__/product-variant.test.ts` | 9 test chọn quy cách |
| `src/lib/__tests__/design-assets.test.ts` | 9 test ánh xạ slug→glyph và chọn ảnh trạng thái rỗng |
| `src/lib/__tests__/session.test.ts` | 4 test lưu/đọc phiên + fallback web |
| `apps/mobile/scripts/shot.mjs` | Chụp màn hình công khai qua CDP |
| `apps/mobile/scripts/shot-auth.mjs` | Chụp màn hình sau khi đăng nhập thật qua UI |
| `apps/mobile/scripts/screen-sweep.mjs` | Quét 21 route: trắng/tràn/lỗi/ảnh hỏng/**console** |
| `apps/mobile/scripts/box-probe.mjs` | Đo hình học DOM một phần tử |
| `apps/mobile/scripts/style-probe.mjs` | Đo style thật — công cụ tìm ra lỗi `Link asChild` |
| `apps/mobile/scripts/cart-roundtrip.mjs` | Vòng tròn thêm-giỏ→hiển thị→dọn sạch |
| `apps/mobile/scripts/card-add-probe.mjs` | Bấm nút giỏ trên thẻ Catalog, kiểm chứng backend |
| `apps/mobile/scripts/checkout-conflict-probe.mjs` | Kiểm chứng 409 đổi giá **không tạo đơn** |
| `apps/mobile/scripts/dead-route-audit.mjs` | Đối chiếu mọi `href`/`router.push` với bảng route thật — bắt nút chết |

### G.2 Mở rộng / viết lại

| File | Thay đổi chính |
|---|---|
| `src/lib/theme.ts` | **Đã có từ trước** — bổ sung `typography`, `elevation.{card,bar}`, `productNameLineHeight`, `warningSoft`, `infoSoft`, `scrim`, `TOUCH=44`, `Tone`/`toneColors`. Giữ `primary: #0b7a39` |
| `src/components/ui.tsx` | **Đã có từ trước** — bổ sung `Card`, `Divider`, `BottomBar` (+`safeArea`), `Badge`, `Chip`, `QtyStepper`, `LoadingView`, `ErrorView`, `StateView`, `ProductThumb`, **`LinkPress`**; `EmptyView` nay **bắt buộc** `kind` |
|---|---|
| `app/(tabs)/index.tsx` | Home: hero, danh mục, Flash Sale thật, lưới 2 cột, nút giỏ |
| `app/(tabs)/catalog.tsx` | Chip, lọc/sắp xếp, lưới 2 cột, nút giỏ thật |
| `app/(tabs)/cart.tsx` | Join ảnh, stepper, tổng tiền từ backend |
| `app/(tabs)/account.tsx` | Dòng theo tính năng backend hỗ trợ, footer nêu tính năng thiếu |
| `app/(tabs)/trace.tsx` | Ô nhập mã, minh họa, lối vào camera |
| `app/(tabs)/_layout.tsx` | Bottom tabs, Home ẩn header |
| `app/product/[id].tsx` | Gallery ảnh bìa trước, chọn quy cách, thanh cố định |
| `app/checkout.tsx` | Cổng xác nhận tổng, xử lý 5 loại 409, chống bấm đúp |
| `app/login.tsx` | Không OAuth, footer nêu giới hạn |
| `app/orders.tsx`, `app/order/[id].tsx` | Danh sách + tiến trình đơn; `CANCELLED` là thông báo riêng |
| `app/trace/[code].tsx` | Kết quả truy xuất thật |
| `app/farms.tsx`, `app/farm/[id].tsx` | Ảnh minh họa có nhãn "Hình minh hoạ" |
| `app/scan.tsx`, `app/vouchers.tsx`, `app/addresses.tsx`, `app/returns.tsx`, `app/return/[id].tsx`, `app/complaints.tsx`, `app/complaint/[id].tsx`, `app/my-reviews.tsx` | Đồng bộ design system |
| `src/components/ProductCard.tsx` | Thẻ dùng chung grid/row; nút giỏ là **anh em** của link |
| `src/lib/promotions.ts` | `primaryImage` (isPrimary), `galleryImages` (bìa trước), `resolveImageUrl` |
| `src/lib/checkout.ts` | `classifyCheckoutConflict` (5 nhóm), `buildCheckoutPayload` |
| `src/lib/status.ts` | `ORDER_FLOW` + `orderFlowIndex` |
| `src/lib/session.ts` | Dò SecureStore lúc chạy + fallback web |
| `src/lib/api-client.ts` | `isNetworkError`, `errorMessage` |
| `src/lib/types.ts` | Bổ sung type cho `FlashSale`, `ProductDiscount`, `ProductImage.sortOrder/isPrimary` |
| `src/lib/messages.ts` | Bổ sung bản dịch cho 409 đổi giá và các thông báo mới |
| `src/lib/config.ts` | `apiConfigNotice()` — cảnh báo khi API base không tới được từ điện thoại |

### G.3 Xoá

| File | Lý do |
|---|---|
| `src/lib/use-cart-products.ts` | Trùng lặp với `use-products.ts` |
| `isTotalConflict` / `isInFlightConflict` | Chỉ test dùng, không code app dùng → code chết |

### G.4 Không sửa

`apps/api/**`, `apps/admin-web/**`, `apps/customer-web/**`, mọi file test có sẵn của API. **Không có thay đổi schema, không reseed, không reset DEV.**

---

## H. Kiểm thử trên thiết bị & những gì còn PENDING

### H.1 Trạng thái thiết bị

```
$ adb devices
List of devices attached
          ← danh sách rỗng, không có thiết bị nào
```

**Không có thiết bị Android nào được kết nối.** Do đó:

> ### Toàn bộ phần kiểm thử hình ảnh trên Android = **PENDING**
> Báo cáo này **không** tuyên bố Android PASS.

### H.2 Đã kiểm chứng ở đâu

| Nền tảng | Đã kiểm chứng | Không được coi là |
|---|---|---|
| **Expo Web** @ 400×866, dữ liệu Backend V2 thật | ✅ Toàn bộ 21 route, 5 UI state, luồng giỏ hàng, luồng thanh toán | Không phải kiểm thử Native |
| **Backend V2** (HTTP thật) | ✅ 14 integration check, pipeline ảnh, hợp đồng thanh toán | — |
| **Android thật** | ❌ **Chưa làm** | — |

### H.3 Danh sách PENDING — cần thiết bị Android để kết luận

| # | Hạng mục | Vì sao chỉ thiết bị mới xác nhận được |
|---|---|---|
| 1 | **Safe Area** — tai thỏ, thanh điều hướng, cử chỉ | Trình duyệt không mô phỏng được inset thật |
| 2 | **Vùng chạm 44px** của nút giỏ (34px hiển thị + `hitSlop={8}` → 50px) | `hitSlop` là prop **chỉ có trên native**; RN Web không cài đặt nó. Đo DOM chỉ ra 34px và **không nói gì** về vùng chạm thật trên Android |
| 3 | **Bàn phím che ô nhập** (`KeyboardAvoidingView`) | Hành vi bàn phím ảo khác hoàn toàn |
| 4 | **Camera thật** ở `/scan` | Quyền camera, xem trước, quét QR — chỉ có trên thiết bị |
| 5 | **Cuộn / quán tính / đàn hồi** | Khác biệt engine cuộn |
| 6 | **Hiệu năng** trên máy thật | Web chạy trên CPU mạnh hơn nhiều |
| 7 | **`SecureStore` thật** (native) | Trên web là stub rỗng; nhánh native chưa chạy thật lần nào |
| 8 | **Ảnh `/uploads/` tải qua LAN** từ điện thoại | Chỉ mới kiểm chứng từ máy dev |
| 9 | **Font tiếng Việt** render trên Android | Font hệ thống khác |
| 10 | **So sánh hình ảnh cuối cùng** với mockup | Cần chụp trên thiết bị |

### H.4 Cách chạy khi có thiết bị

```bash
# 1. Backend
npm run start:dev --workspace @agrimarket/api        # http://localhost:3000

# 2. Kiểm tra LAN IP còn đúng không (nếu IP đổi thì sửa apps/mobile/.env)
ipconfig                                        # IPv4 trên card Wi-Fi

# 3. Metro (LAN)
npm run dev:lan --workspace @agrimarket/mobile       # quét QR bằng Expo Go

# 4. Trên điện thoại: mở Expo Go, quét QR
#    apps/mobile/.env đang đặt:
#    EXPO_PUBLIC_API_BASE_URL=http://192.168.100.155:3000/api/v1
```

> ⚠️ **Không bao giờ dùng `localhost` trong `.env`** — trên điện thoại, `localhost` là chính điện thoại đó. `config.ts` có `apiConfigNotice()` để cảnh báo ngay trên màn Home nếu base URL không tới được từ thiết bị, và có unit test khoá hành vi này.

Checklist khi có thiết bị: ① Safe Area 4 cạnh · ② nút giỏ có bấm trúng không · ③ bàn phím không che ô nhập · ④ `/scan` xin quyền + quét được mã `TRC-000019-BAPCA` · ⑤ ảnh sản phẩm tải được qua LAN · ⑥ cuộn mượt · ⑦ chụp lại 6 màn chính và đối chiếu mockup.

### H.5 Ghi chú trung thực về DEV DB

Trong quá trình kiểm chứng hợp đồng idempotency, một đơn **có thật** đã được tạo:

- Đơn `ORD-20261010-0001` (id 21) do probe phát lại khoá idempotency tạo ra, **sau đó đã huỷ**.
- `shippingAddressSnapshot` của đơn này chứa ký tự lỗi (mojibake) **do probe PowerShell làm hỏng UTF-8 khi gửi**, **không phải lỗi của app**. Đơn 20 và luồng `fetch` + `JSON.stringify` thật của app render tiếng Việt **đúng**.
- Probe sau đó đã được viết lại (`checkout-conflict-probe.mjs`) để **không tạo đơn nào** — đã xác nhận `PROBE CREATED NOTHING`.
- **Không** reset, **không** reseed DEV.

---

## TỔNG KẾT

| Hạng mục | Trạng thái |
|---|---|
| Áp dụng UI Kit vào `apps/mobile` | ✅ Xong |
| 12/12 asset chép đúng (SHA256 khớp) | ✅ |
| Không nhúng ảnh mockup, không hardcode dữ liệu giả | ✅ Đã xác minh bằng grep |
| Dữ liệu 100% từ Backend V2 | ✅ |
| Đủ 5 UI state, phân biệt rõ lỗi-mạng vs rỗng-thật | ✅ |
| Không nút chết, không route chết | ✅ 19/19 đích điều hướng phân giải (dead-route audit) |
| typecheck / lint / 78 unit test / 14 integration | ✅ Tất cả xanh |
| 21 route sweep @ 400×866, 0 lỗi console | ✅ |
| Pipeline ảnh Admin→Mobile | ✅ Đã kiểm chứng |
| Hợp đồng thanh toán (`expectedGrandTotal`, idempotency, 409) | ✅ Đã kiểm chứng trên backend thật |
| **104 xã/phường Hưng Yên** | ❌ **KHÔNG ĐẠT** — backend không có API/dữ liệu |
| **Kiểm thử hình ảnh trên Android** | ⏳ **PENDING** — không có thiết bị |

### Kết luận cuối cùng

> # `SOURCE READY — ANDROID VISUAL ACCEPTANCE PENDING`

Mã nguồn đã sẵn sàng: mọi màn hình khách hàng đã được thiết kế lại theo bộ tham khảo, dùng đúng dữ liệu Backend V2, không có dữ liệu giả, không có nút chết, và toàn bộ kiểm tra tự động đều xanh.

Hai điểm **chưa** thể kết luận:
1. **Yêu cầu 104 xã/phường Hưng Yên không đạt** — Backend V2 không có API và không có dữ liệu đơn vị hành chính. App nhập địa chỉ dạng văn bản và nói rõ điều đó, thay vì bịa danh mục.
2. **Kiểm thử hình ảnh trên Android còn PENDING** — chưa có thiết bị nào được kết nối. Ảnh chụp trong báo cáo này là từ **Expo Web**, và **không được coi là kiểm thử Native**.
