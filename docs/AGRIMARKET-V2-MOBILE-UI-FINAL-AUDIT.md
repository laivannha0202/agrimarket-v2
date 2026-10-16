# AGRIMARKET V2 — MOBILE UI FINAL AUDIT

**Repo:** `E:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc`
**Branch:** `main` · **HEAD:** `4b14267` · **Ngày:** 2026-10-10
**Thư mục:** `apps/mobile` (Expo Go + Expo Router, untracked — không commit, không push, không reset/reseed)

> **Trạng thái nghiệm thu Android thật: PENDING — chưa có thiết bị.**
> `adb devices` trả về **0 thiết bị**. Mọi kết luận về *hiển thị trên máy thật*
> trong tài liệu này đều ở mức **chưa xác minh**. Xem §H.

---

## A. Nguyên nhân gốc (đã xác minh bằng bằng chứng, không suy đoán)

### A1. [P0] Điện thoại "không tải được" sản phẩm — crash phía client, KHÔNG phải server không tới được

**Triệu chứng:** mở app trên Expo Go → danh sách sản phẩm trắng/không render, dù
`curl` từ máy tính vào API trả 200 bình thường.

**Nguyên nhân:** `src/lib/promotions.ts` hàm `resolveImageUrl()` cũ dùng
`new URL(url)` rồi **gán** `parsed.protocol = ...` / `parsed.host = ...`.
React Native **không** ship URL polyfill đầy đủ — nó dùng bản rút gọn
(`Libraries/Blob/URL.js`, cài qua `setUpXHR`) trong đó `protocol` / `host` / `href`
là **getter-only**. Gán vào đó ném:

```
TypeError: Cannot set property protocol of [object Object] which has only a getter
```

Lỗi này bắn ra **trong lúc render mỗi product card** (mọi sản phẩm đều có ảnh),
nên cả danh sách sập — không có card nào, không có ảnh nào. Đây chính là
"không load được" mà người dùng thấy.

**Vì sao ảnh cần rewrite:** URL ảnh **được lưu trong DB** là
`http://localhost:3000/uploads/products/*.webp`. Trên điện thoại, `localhost`
là **chính điện thoại đó**, không phải máy dev → ảnh không bao giờ tải được kể cả
khi API đã đúng.

**Cách sửa:** `resolveImageUrl()` chuyển sang **thao tác chuỗi bằng regex**
(không dùng `URL` setter):

```ts
if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?=\/|$)/i.test(trimmed)) {
  if (!origin) return trimmed;
  return trimmed.replace(/^https?:\/\/[^/]+/i, origin);
}
```

Lookahead `(?=\/|$)` **ghim ranh giới host** để `localhost.evil.com` không bị
rewrite nhầm (có test riêng). Đường dẫn tương đối ghép vào API origin; URL tuyệt
đối khác giữ nguyên.

**Bằng chứng (phiên này):**
- URL lưu thật: `http://localhost:3000/uploads/products/3f2db25c-69b8-4e66-a347-df1f18f86151.webp`
- `HEAD` vào bản đã rewrite → **200**, `Content-Type: image/webp`
- 14/14 sản phẩm ACTIVE đều có `images.length > 0` và `farmId != null`

### A2. [P0] Icon tab hiện **tam giác** "⏷" và nhãn bị cắt

**Nguyên nhân:** `app/(tabs)/_layout.tsx` **không khai báo `tabBarIcon`** cho
screen nào. Không có icon, expo-router's `BottomTabBar` rơi vào `MissingIcon`,
và component đó render đúng **một ký tự Text `"\u23F7"`** — chính là hình tam
giác. `@expo/vector-icons` **chưa được cài** nên không thể khai báo icon.

**Cách sửa:**
- Cài `@expo/vector-icons@15.1.1` + `expo-font@57.0.4` (đúng bản Expo SDK 57 bundled).
- Mỗi tab có `tabBarIcon` tường minh (Ionicons): `home`/`grid`/`qr-code`/`cart`/`person`.
- Nhãn render qua component `TabLabel` riêng (có chiều cao đảm bảo);
  `tabBarShowLabel` **giữ `true`** — đặt `false` khiến `BottomTabItem` return `null`
  *trước khi* label của mình được gọi.
- **Không hard-code `height`** cho tab bar: expo-router chỉ cộng inset đáy
  (gesture bar / nút điều hướng Android) khi mình **không** ép `height`. Thay vào đó
  dùng `paddingTop`/`paddingBottom`.
- Thêm `tabBarHideOnKeyboard: true`.

**Bằng chứng:** bundle Android có `Ionicons.ttf`, `home-outline` ×5, `grid-outline` ×3,
`cart-outline` ×8, `person-outline` ×6, `qr-code-outline` ×7.
**Số lần xuất hiện `U+23F7` trong bundle = 0.**

### A3. [P0] Chip "Tất cả" kéo dài **thành cột dọc khổng lồ**

**Nguyên nhân:** RN cho `ScrollView` ngang `flexGrow: 1` mặc định. Đặt nó trong
parent `flex: 1` ⇒ chip đầu tiên bị kéo cao hết màn hình. Đây là lỗi **RN style**,
không phải lỗi dữ liệu.

**Cách sửa:** `chipScroller: { flexGrow: 0 }` — áp dụng ở `catalog.tsx` **và**
`orders.tsx` (cùng pattern chip ngang).

### A4. Trạng thái màn hình chồng nhau (ERROR **và** EMPTY cùng lúc) + khoảng trắng hàng trăm px

**Nguyên nhân:** mỗi màn hình tự suy ra trạng thái từ 3 boolean độc lập
(`isPending`, `isError`, `data.length === 0`) bằng các `if` rời. Khi lỗi, `data`
là `undefined` ⇒ `length === 0` cũng đúng ⇒ hiện **cả** khối lỗi đỏ **và** khối
rỗng xám, đồng thời `EmptyView` cũ có `flex: 1` tạo khoảng trắng cao cả màn hình.

**Cách sửa:**
- Máy trạng thái **duy nhất** `src/lib/load-state.ts`:
  `resolveLoadState({isPending,isError,isEmpty})` với thứ tự ưu tiên
  **loading > error > empty > ready**; `isReady()` là điều kiện duy nhất để render nội dung.
- `StateView` trong `src/components/ui.tsx` render **đúng một** khối.
- `EmptyView`/`ErrorView` mặc định **cao theo nội dung**; `fill` phải **opt-in**
  (chỉ dùng khi là con trực tiếp của container full-height, **không** đặt trong `ScrollView`).
- `LoadingView` là inline, không bao giờ kéo giãn parent.

**Bằng chứng:** rà soát 23 route — mọi màn hình dùng **early-return** hoặc
**chuỗi ternary độc quyền**, không còn `if (isError)` + `if (empty)` rời nhau.
`load-state.test.ts` có test khẳng định *"never reports empty while an error is present"*.

### A5. Màn hình yêu cầu đăng nhập chỉ có **một nút trống**, không giải thích

**Cách sửa:** **11** màn hình chặn đăng nhập nay có **icon + tiêu đề + mô tả + CTA**
(đã kiểm bằng script: mỗi file đều có cặp class `emptyIcon`/`emptyTitle`/`emptyCta`,
riêng `account` dùng `Ionicons person-outline` + `guestTitle` + `guestCta`):
`orders`, `returns`, `complaints`, `my-reviews`, `addresses`, `order/[id]`,
`return/[id]`, `complaint/[id]`, `checkout`, `(tabs)/cart`, `(tabs)/account`.
Nút đăng nhập mang `redirect` quay lại đúng màn hình trước đó.

### A6. Banner mất mạng / thông báo cấu hình API bị **chìm dưới status bar** (Android edge-to-edge)

**Cách sửa:** `OfflineBanner` và `ApiConfigNotice` cộng `insets.top` vào
**`paddingTop`** (không phải `margin`) để nền màu vẫn phủ kín dải status bar.
Thêm `android.edgeToEdgeEnabled: true` + `android.softwareKeyboardLayoutMode: "resize"`
trong `app.json` (đã validate bằng `npx expo config --type public`).

### A7. Không có banner/quảng cáo thật ⇒ **không render banner**

`/banners` trả **404**. Theo nguyên tắc "chỉ dữ liệu thật", Home **không có**
section banner. Flash sale chỉ render khi có chương trình **đang chạy thật**
(`isFlashSaleActive` kiểm tra `status === "ACTIVE"` **và** cửa sổ thời gian).

### A8. Danh mục phường/xã 104 Hưng Yên — **không tồn tại** ⇒ giữ nhập tay

Đã kiểm tra: `/wards`, `/provinces`, `/addresses/provinces`, `/locations`,
`/customers/me/addresses/wards` → **404 toàn bộ**. Backend lưu `province`/`ward`
dưới dạng **chuỗi tự do**. Không có dataset 104 phường/xã ở bất kỳ đâu trong repo.
⇒ Màn hình địa chỉ giữ **TextInput nhập tay**; **không hardcode** danh sách thay thế.

---

## A9. Xác minh nguyên nhân gốc từ **mã nguồn thư viện** (bằng chứng gốc, không phải suy luận)

Ba kết luận ở A1–A3 được đối chiếu trực tiếp với mã nguồn đã build của
`expo-router@57.0.25` (thư viện **vendored** `@react-navigation/bottom-tabs`
trong `build/react-navigation/`):

**(1) `MissingIcon` render đúng ký tự tam giác** —
`build/react-navigation/elements/MissingIcon.js:8`:

```js
function MissingIcon({ color, size, style }) {
  return jsx(Text_1.Text, { style: [...], children: "\u23F7" });
}
```

Và `BottomTabBar.js:289` là nơi rơi vào fallback đó:

```js
icon: options.tabBarIcon ?? (({ color, size }) => jsx(elements_1.MissingIcon, ...))
```

⇒ **Chứng minh nhân–quả:** không khai báo `tabBarIcon` ⇒ `options.tabBarIcon` là
`undefined` ⇒ `??` chọn `MissingIcon` ⇒ Text `"\u23F7"` ⇒ **tam giác**. Khớp chính xác
triệu chứng người dùng báo.

**(2) `tabBarShowLabel: false` chặn label của mình** — `BottomTabItem.js:49-50`:

```js
const renderLabel = ({ focused }) => {
  if (showLabel === false) { ... }   // thoát sớm, KHÔNG gọi label tuỳ biến
```

⇒ Giữ `tabBarShowLabel: true` là **bắt buộc** để `tabBarLabel` dạng hàm của mình chạy.

**(3) Bỏ `height` là điều kiện để inset đáy được cộng** — `BottomTabBar.js:100-111`:

```js
const customHeight = flattenedStyle && 'height' in flattenedStyle ? flattenedStyle.height : undefined;
if (typeof customHeight === 'number') { return customHeight; }   // <-- chặn inset
const inset = insets[tabBarPosition === 'top' ? 'top' : 'bottom'];
return TABBAR_HEIGHT_UIKIT + inset;   // 49 + inset
```

và `BottomTabBar.js:251-252`:

```js
height: tabBarHeight,
paddingBottom: tabBarPosition === 'bottom' ? insets.bottom : 0,
```

⇒ Nếu `tabBarStyle` có `height` **số**, inset đáy **không** được cộng và nhãn bị
thanh điều hướng che. Fix hiện tại (`paddingTop` + `paddingBottom` theo `Platform`,
**không** đặt `height`) là đúng theo mã nguồn.

**(4) Bằng chứng firewall (vì sao "LAN không tới được" là giả thuyết sai).**
Wi-Fi đang ở profile **Public**. Có 6 rule **Block** inbound cho `node.exe`, nhưng
tất cả trỏ tới **binary khác**: `...\pi agent\resources\node\node.exe` và
`...\temp\node24\...\node.exe`. Cả hai tiến trình của ta (API pid 35168, Metro pid 24620)
chạy `C:\Program Files\nodejs\node.exe`, và binary này có rule **Allow**
inbound TCP/UDP cho **Private, Public**.

⇒ Firewall **không** chặn API/Metro của ta. Kết luận ở A1 (lỗi phía client, không
phải server không tới được) được xác nhận thêm một lần nữa.


---

## B. Vi phạm "không tính toán phía mobile" đã bị loại bỏ

`src/lib/promotions.ts` từng có hàm chết `variantDisplayPrice()` **tự tính lại**
thứ tự ưu tiên flash-sale / giảm giá / giá gốc ở client — vi phạm quy tắc
*server là nguồn chân lý duy nhất*. Hàm này **không được màn hình nào gọi**.

**Đã xóa**, kèm test hồi quy khẳng định:
- `variantDisplayPrice` **không còn tồn tại** (đọc file, assert không match),
- `cheapestVariantPrice` **chỉ chọn** giá trị `effectivePrice` server trả về, không nhân/chia/cộng.

**Bằng chứng:** bundle Android có **0** lần xuất hiện `variantDisplayPrice`.
Không có chỗ nào mobile tự tính giá/tồn/kho/khuyến mãi; tổng tiền lấy từ
`POST /orders/checkout-preview` (`grandTotal`), đơn hàng gửi kèm
`expectedGrandTotal` + `Idempotency-Key` (1 key / 1 chữ ký payload), và
**409 ⇒ refetch preview + bắt xác nhận lại**.

---

## C. Ma trận màn hình (23 route)

| Route | Dữ liệu thật | Trạng thái độc quyền | Ghi chú |
|---|---|---|---|
| `(tabs)/_layout` | — | — | 5 tab, Ionicons, safe-area, `tabBarHideOnKeyboard` |
| `(tabs)/index` (Home) | categories, products, flash-sales, farms, product-discounts | `StateView` ×3 | header, search→Catalog, trace entry **luôn hiện**, flash sale chỉ khi thật |
| `(tabs)/catalog` | products (infinite), categories | ternary độc quyền | `FlatList` + `numColumns`, `onEndReached` (dồn trang), pull-to-refresh, chip `flexGrow: 0` |
| `(tabs)/cart` | carts/me, checkout-preview | early-return | `fill` chỉ ở error toàn màn hình |
| `(tabs)/account` | auth/me | — | 9 link điều hướng, đều resolve thật (`/orders`, `/returns`, `/my-reviews`, `/addresses`, `/vouchers`, `/complaints`, `/farms`) |
| `(tabs)/trace` | — | — | nhập mã + nút quét QR + giải thích 3 bước |
| `product/[id]` | products/:id, reviews, carts | early-return | chặn mua quy cách INACTIVE/hết hàng, link trang trại thật |
| `checkout` | addresses, checkout-preview, orders | early-return | phân biệt "Mua ngay không hợp lệ" vs "giỏ trống" |
| `orders` / `order/[id]` | orders/me, orders/me/:id | early-return | hủy đơn, timeline trạng thái |
| `addresses` | customers/me/addresses | early-return | nhập tay (không có API wards) |
| `farms` / `farm/[id]` | farms, certificates | ternary độc quyền | chứng nhận còn hiệu lực |
| `trace/[code]` | trace/:code | early-return | hero ảnh, timeline, QC grid, `qualityControl` null-guarded |
| `scan` | camera | — | quyền camera → CTA; QR sai ⇒ báo lỗi + quét lại, **không** điều hướng |
| `returns` / `return/[id]` | returns/me | early-return | `RETURN_FLOW` cho timeline |
| `complaints` / `complaint/[id]` | complaints/me | early-return | |
| `my-reviews` | reviews/me | early-return | |
| `vouchers` | vouchers | early-return | |
| `login` | auth/login | — | `redirect` chỉ cho path nội bộ |

**Không còn:** `onPress={() => {}}` chết, `TODO`/`FIXME`/`XXX`, host ảnh stock
(unsplash/picsum/placeholder/cloudinary/pexels/…), tên sản phẩm mẫu hardcode.

---

## D. Bằng chứng kiểm thử (chạy lại **toàn bộ** trong phiên này)

| Hạng mục | Lệnh | Kết quả | Exit |
|---|---|---|---|
| Typecheck | `npm run typecheck --workspace @agrimarket/mobile` | `tsc --noEmit` không lỗi | **0** |
| Lint | `npm run lint --workspace @agrimarket/mobile` | `eslint .` không lỗi, **0 warning** | **0** |
| Unit | `npm run test --workspace @agrimarket/mobile` | **46 passed / 8 files** (889 ms) | **0** |
| Integration (LAN) | `EXPO_PUBLIC_API_BASE_URL=http://192.168.100.155:3000/api/v1` + `AGRIMARKET_TEST_EMAIL/PASSWORD` → `test:integration` | **pass=14 fail=0** | **0** |
| Bundle Android | `GET /.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false` | **200**, `7,760,500` bytes | — |

**46 unit test theo file:** `api-client` 1 · `checkout` 5 · `format` 6 ·
`load-state` 7 · `messages` 4 · `promotions` 12 · `status` 3 · `trace-code` 8.

**14 integration check (đã xác thực, read-only):**
`/categories` · `/products` (5 items) · `/products/:id` · `/farms` ·
`/trace/:code` · `/vouchers` · `/flash-sales` · `POST /auth/login` (CUSTOMER) ·
`/auth/me` · `/carts/me` · `/customers/me/addresses` · `/orders/me` ·
`POST /orders/checkout-preview` (`grandTotal=32000`) · `/products?status=BOGUS` → 400.
Write check **SKIP** (`AGRIMARKET_RUN_WRITE_TESTS != 1`) — **không tạo/sửa/xóa dữ liệu nào**.

### D1. Dữ liệu backend thật (LAN `http://192.168.100.155:3000/api/v1`)

- `/products?limit=20&status=ACTIVE` → **14** sản phẩm, **14/14** có ảnh, **14/14** có `farmId`
- `effectivePrice.source`: `FLASH_SALE` ×2, `PRODUCT_DISCOUNT` ×1, `NONE` ×14 ⇒ **3** quy cách đang giảm thật
- `/categories` → **5** · `/farms` → **4**
- `/flash-sales` → **1** chương trình `ACTIVE` ("Flash Sale cuối tuần Hưng Yên", 2026-09-07 → 2026-11-06, **2** item)
- `/trace/TRC-000019-BAPCA` → lô `LOT-20260923-0019`, hạng "Loại 1", QC `PASS`
  (appearance/freshness/packaging/damage đều `true`), **3** traceEvent, **0** farmingEvent, **0** chứng nhận
- Ảnh: `HEAD http://192.168.100.155:3000/uploads/products/3f2db25c-….webp` → **200** `image/webp`

### D2. Marker trong bundle Android (chống hồi quy)

`Ionicons.ttf` ×2 · `resolveLoadState` ×8 · `home-outline` ×5 · `grid-outline` ×3 ·
`qr-code-outline` ×7 · `cart-outline` ×8 · `person-outline` ×6 ·
`TRC-000019-BAPCA` ×3 · **`U+23F7` ×0** · **`variantDisplayPrice` ×0**

### D3. Kiểm tra hợp đồng dữ liệu (chống crash kiểu A1 tái diễn)

Vì A1 là crash khi render do đọc field, tôi kiểm tra **mọi field lồng nhau** mà
`ProductCard` / `product/[id]` / Home / Catalog đọc, trên **toàn bộ** dữ liệu thật:

- `products[]`: `id`, `name`, `images`, `variants`, `farmId`, `partner.name` → **0 field thiếu**
- `variants[]`: `effectivePrice.unitPrice`, `.basePrice`, `.source`, `inStock`,
  `status`, `saleUnit`, `weight`, `weightUnit`, `name` → **0 field thiếu**
- `flash-sales[].items[].productVariant` → có thật (`Túi 1 kg`, flashPrice 50000 / 24000)
- `categories[]` → 5, đủ `id` + `name`
- `farms[]` → 4, đủ `id` + `name` + `address`

Ngoài ra đã rà toàn bộ `app/` + `src/`:
- **0** chỗ dùng `new URL(...)` / `URLSearchParams` / `.searchParams` (đúng lớp lỗi A1)
- **0** chỗ truy cập `data[0]` / `data!.` / `data.data.map(...)` không guard
- 2 chỗ `JSON.parse` đều nằm trong `try/catch` (`api-client.ts:103`, `session.ts:38`)

### D4. Firewall (điều kiện biên để điện thoại tới được máy tính)

Wi-Fi = profile **Public**; 6 rule **Block** inbound `node.exe` **chỉ** áp cho
`...\pi agent\resources\node\node.exe` và `...\temp\node24\...\node.exe`.
API (pid 35168) và Metro (pid 24620) chạy `C:\Program Files\nodejs\node.exe`
— binary này có rule **Allow** inbound TCP/UDP cho **Private, Public**.
Kiểm tra thực tế qua đúng IP LAN mà điện thoại sẽ dùng:

| Kiểm tra | Kết quả |
|---|---|
| `http://192.168.100.155:8081/status` | `packager-status:running` |
| `http://192.168.100.155:8081/_expo/manifest` | **200** |
| `http://192.168.100.155:3000/api/v1/categories` | **200** |

⇒ Cả Metro lẫn API đều **đã sẵn sàng trên LAN**, đúng như điện thoại cần.

### D5. Sửa cấu hình lint cho `scripts/**` (phát hiện trong phiên này)

`npm run lint` đột ngột fail `no-undef: 'Buffer' is not defined` ở `scripts/shot.mjs`.
**Nguyên nhân:** `eslint-config-expo/flat` chỉ khai báo **globals.browser**
(`flat/default.js`), **không** khai báo globals của Node. Mọi script `.mjs` dùng
built-in Node (`Buffer`, `process`, …) đều bị báo `no-undef` — đây là **lỗ hổng
cấu hình**, không phải lỗi code.

**Cách sửa (chỉ thêm, không nới lỏng rule nào):** thêm một block `files: ["scripts/**/*.{js,mjs,cjs,ts}"]`
khai báo đúng các global Node cần dùng. Không tắt rule, không `eslint-disable`,
không đổi rule nào cho `app/` hay `src/`.

⇒ `npm run lint` trở lại **exit 0, 0 error, 0 warning** trên toàn bộ `apps/mobile`.

---

## E. Rủi ro đã biết / giới hạn

1. **`localhost` trong URL ảnh đã lưu.** App tự rewrite khi đọc. Ảnh **mới upload**
   vẫn sẽ lưu `localhost` nếu API không đặt `PUBLIC_API_BASE_URL` = IP LAN.
   → Đây là **cấu hình phía API**, không sửa trong phiên này (ngoài phạm vi cho phép).
2. **IP LAN `192.168.100.155` là động.** Đổi Wi-Fi/IP ⇒ phải sửa `apps/mobile/.env`
   (1 dòng) và restart Expo. App **không** có fallback hardcode (cố ý: IP cũ trỏ sai
   còn tệ hơn thông báo "chưa cấu hình").
3. **`--tunnel` chỉ tunnel dev server**, không tunnel API — `.env` vẫn phải là URL LAN.
4. **Không có API danh mục hành chính** ⇒ địa chỉ nhập tay, không validate được
   tính hợp lệ của tỉnh/phường.
5. **Lô `TRC-000019-BAPCA` có 0 farmingEvent và 0 chứng nhận** ⇒ màn hình trace
   hiển thị đúng nhánh rỗng cho 2 mục đó (đúng thiết kế, không phải lỗi).

---

## F. Phạm vi thay đổi (không đụng ngoài `apps/mobile`)

Phiên này **chỉ sửa file trong `apps/mobile`**. Không sửa Backend/Admin/Customer Web,
không đổi business logic (FEFO, voucher, flash sale, idempotency, COD, cancel/return, trace lot).

**File sửa trong phiên này:**
- Toàn bộ 23 route + `src/**` (mô tả ở §A–§C).
- `eslint.config.mjs` — thêm block globals cho `scripts/**` (§D5). **Chỉ thêm**,
  không tắt/không nới lỏng rule nào.

**Ghi nhận trung thực — có tiến trình khác đang ghi vào repo này song song.**
Trong lúc phiên này chạy, các file sau **xuất hiện mà không phải do tôi tạo**
(timestamp 12:21–12:24, sau khi phiên bắt đầu): `scripts/cors-browser-check.mjs`,
`scripts/layout-probe.mjs`, `scripts/shot.mjs`, `scripts/tabbar-probe.mjs`,
`scripts/tabbar-deep-probe.mjs`; đồng thời một Metro server do người khác chạy
(`expo start --lan --clear --port 8081`, pid 24620) cũng xuất hiện.
Tôi **không** tạo, không sửa nội dung các probe đó, và **không** xóa chúng.
Chính `scripts/shot.mjs` là file làm `npm run lint` fail (dẫn tới §D5).

`git status` ngoài `apps/mobile` là **di sản phiên trước**, timestamp **08:16–08:18**
(trước phiên này), **giữ nguyên không xóa**:
`apps/admin-web/**` (M, gồm 1 file đã xóa sẵn từ trước:
`apps/admin-web/src/hooks/useClientList.ts` — **không phải do phiên này**),
`apps/api/**` (M/??), `.gitignore` (M),
`package.json` (M — 1 dòng `dev:mobile`), `pnpm-lock.yaml` (M).
`pnpm-lock.yaml` có thêm importer `apps/mobile` (do cài `@expo/vector-icons`/`expo-font`)
**cùng với** thay đổi test-deps của admin-web vốn đã có từ trước.

`apps/mobile` **untracked** (`git ls-files apps/mobile` = 0 file). Không commit, không push.

---

## G. Kết luận theo mức độ tin cậy

| Hạng mục | Trạng thái |
|---|---|
| API thật trả dữ liệu đúng | ✅ **VERIFIED** (curl + integration) |
| Ảnh thật tải được qua IP LAN | ✅ **VERIFIED** (HEAD 200 image/webp) |
| `resolveImageUrl` rewrite đúng, không throw | ✅ **VERIFIED** (unit + bundle + dữ liệu thật) |
| Trạng thái độc quyền, không ERROR+EMPTY | ✅ **VERIFIED** (7 unit test + rà soát 23 route) |
| Không tính giá/tồn phía mobile | ✅ **VERIFIED** (test hồi quy + bundle = 0) |
| Hợp đồng dữ liệu không thiếu field | ✅ **VERIFIED** (0 field thiếu trên toàn bộ dữ liệu thật) |
| Nguyên nhân gốc tam giác / nhãn cắt | ✅ **VERIFIED từ mã nguồn thư viện** (A9) |
| Firewall cho phép LAN tới 8081 + 3000 | ✅ **VERIFIED** (rule + kiểm tra qua IP LAN) |
| Icon tab thật, không còn glyph tam giác | ✅ **VERIFIED ở mức bundle** (`U+23F7` = 0, có `Ionicons.ttf`) |
| Chip không còn kéo dài dọc | ✅ **VERIFIED ở mức source** (`flexGrow: 0`) |
| Typecheck / lint / unit / integration | ✅ **VERIFIED** (exit 0 / 0 / 46 / 14) |
| **Hiển thị & thao tác trên máy Android thật** | ❌ **CHƯA XÁC MINH — PENDING** |

**Các PASS ở §D KHÔNG được coi là bằng chứng hoàn thành UI trên máy thật.**
Chúng chứng minh logic, kiểu dữ liệu, hợp đồng API, nội dung bundle và nguyên nhân
gốc — **không** chứng minh bố cục, khoảng trắng, safe area, bàn phím hay icon
hiển thị đúng trên màn hình điện thoại. Chỉ ảnh chụp từ thiết bị thật mới trả lời được.

---

## H. Cần gì để đóng mục "Android thật" — PENDING

`adb devices` = **0 thiết bị**; phiên này **không** có cách nào xác minh trên máy thật.

**Dev server đang chạy:** port **8081**, chế độ **LAN** (`expo start --lan --clear --port 8081`),
đã kiểm tra qua **đúng IP LAN** mà điện thoại sẽ dùng:
`http://192.168.100.155:8081/status` → `packager-status:running`,
`/_expo/manifest` → **200**.
**API:** `http://192.168.100.155:3000/api/v1/categories` → **200**.

> Lưu ý vận hành: đừng chạy `expo start` với `CI=1` — `getenv` của Expo CLI ném
> `GetEnv.NoBoolean: 1 is not a boolean` và tiến trình thoát ngay. Nếu cần chạy nền,
> dùng `cmd /c start` tách rời, không set `CI`.

**Đề nghị người dùng làm:**

1. Điện thoại Android + máy tính **cùng một Wi-Fi**.
2. Mở **Expo Go** → quét QR trong terminal đang chạy `npm run dev:mobile`.
   Nếu QR không hiện, mở Expo Go → *Enter URL manually* →
   `exp://192.168.100.155:8081`
3. Chụp màn hình gửi lại **5 màn hình**:
   - **Home** (`(tabs)/index`) — kiểm tra icon tab, search, chip danh mục, thẻ sản phẩm có **ảnh thật**
   - **Catalog** (`(tabs)/catalog`) — kiểm tra chip "Tất cả" **không** kéo dài dọc, lưới 2 cột
   - **Product Detail** (`product/[id]`) — kiểm tra ảnh, giá, nút thêm vào giỏ
   - **Cart** (`(tabs)/cart`) — kiểm tra tổng tiền từ backend
   - **Trace** (`trace/[code]` với `TRC-000019-BAPCA`) — kiểm tra hồ sơ lô thật

**Nếu có lỗi hiển thị, gửi kèm:** màn hình nào, đang ở trạng thái nào
(đang tải / có dữ liệu / rỗng / lỗi / mất mạng), và ảnh chụp. Tôi sẽ sửa và
chạy lại toàn bộ §D sau mỗi lần sửa.

**Tôi sẽ không tuyên bố "Android PASS" cho tới khi có ảnh chụp thật từ thiết bị.**
