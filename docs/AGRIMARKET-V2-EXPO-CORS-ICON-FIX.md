# AGRIMARKET V2 — EXPO / CORS / ICON FIX REPORT

**Repo:** `E:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc`
**Branch:** `main` · **HEAD:** `4b14267` (không đổi) · **Ngày:** 2026-10-10
**Phạm vi:** `apps/mobile` (Expo Go + Expo Router) + `apps/api` (NestJS) — chỉ sửa lỗi runtime, không đổi nghiệp vụ.

> **Trạng thái nghiệm thu Android thật: NOT TESTED / BLOCKED.**
> Không có điều khiển thiết bị (không ADB/USB bắt buộc). Mọi kết luận về *hiển thị trên máy thật*
> trong tài liệu này đều ở mức **chưa xác minh**. Xem §H.

---

## 0. Tóm tắt kết quả

| # | Vấn đề | Trạng thái | Bằng chứng |
|---|--------|-----------|-----------|
| 1 | `Unable to resolve module ./Entypo` (Expo Web) | **FIXED** | §A — cold bundle 200, 0 `UnableToResolveError` |
| 2 | NestJS CORS chặn categories/products/farms | **FIXED** | §B — browser thật ALL PASS, evil origin bị chặn |
| 3 | Trùng server Expo 8081/8082 | **FIXED** | §C — 8081 dùng, 8082 free |
| 4 | API + ảnh sản phẩm | **VERIFIED** | §D — 200 `image/webp`, 32 file thật |
| 5 | Toàn bộ UI mobile | **VERIFIED (web)** | §E — 14 route sạch, 3 màn detail ảnh thật |
| 6 | Test + acceptance | **PASS** | §F — mobile 46, API unit 263, e2e 244, CORS 13 |
| 7 | `expo-doctor` app.json schema | **FIXED** | §G — 20/21 → **21/21** |

**Kết luận:** cả 3 lỗi runtime đã sửa và kiểm chứng lại; 2 lỗi UI thật khác phát hiện thêm bằng
đo đạc cũng đã sửa. **Không** commit, **không** push, **không** reset/reseed DB, **không** cài lại
hàng loạt dependency, **không** đổi phiên bản framework.

---

## A. Lỗi `Unable to resolve module ./Entypo` — nguyên nhân gốc & cách sửa

### A1. Triệu chứng

Expo Web (Metro) không bundle được; màn hình trắng. Log thật trong
`apps/mobile/.expo/dev/logs/start.log`:

```
{"_e":"metro:bundling:failed","message":"Unable to resolve \"./Entypo\" from
 \"node_modules\\.pnpm\\@expo+vector-icons@15.1.1_e_55f90f82...\\node_modules\\@expo\\vector-icons\\build\\Icons.js\""}

{"_e":"metro:bundling:failed","message":"Unable to resolve \"@expo/vector-icons\" from
 \"apps\\mobile\\app\\(tabs)\\_layout.tsx\""}

[UnableToResolveError: Unable to resolve module ./Entypo from ...@expo/vector-icons/build/Icons.js]
```

Tổng cộng **50** lần `metro:bundling:failed` trong log, đỉnh điểm 10:49–10:54.

### A2. Nguyên nhân gốc (đã xác minh, không suy đoán)

Lỗi **không** nằm ở `./Entypo` — mà ở chỗ **bản thân package `@expo/vector-icons` không resolve được**
trong một khoảng thời gian cài đặt chưa hoàn tất:

- `@expo/vector-icons` có mặt trong `.pnpm` với entry mới tạo lúc **10:48:09**, trong khi
  Metro vẫn đang trỏ vào đường dẫn `.pnpm` cũ.
- Tồn tại **nhiều** thư mục hash `expo-router@57.0.25_*` trùng lặp → dấu hiệu một lần
  re-resolution **một phần** của pnpm.
- Vì `@expo/vector-icons` chưa resolve được, `build/Icons.js` (file re-export
  `export { default as Entypo } from './Entypo'`) cũng không resolve được `./Entypo`.
  Thông báo lỗi chỉ hiển thị mắt xích cuối cùng, gây hiểu nhầm là lỗi riêng của Entypo.

**Bằng chứng then chốt — không cần đổi package:** phiên bản đang dùng **đúng chuẩn SDK 57**:

```
expo/bundledNativeModules.json  ->  "@expo/vector-icons": "^15.0.2"
apps/mobile đang cài            ->  @expo/vector-icons@15.1.1   ✅ thoả ^15.0.2
npx expo install --check        ->  "Dependencies are up to date"
```

### A3. Cách sửa

**Không** đổi phiên bản package, **không** tạo `metro.config.js` alias, **không** reinstall hàng loạt.
Chỉ **xoá cache Metro và khởi động lại sạch** để Metro nhìn thấy cây dependency đã ổn định:

```powershell
npx expo start --lan --clear --port 8081
```

**Lý do cách này đúng:** lỗi là trạng thái **tạm thời** của cây dependency, không phải cấu hình sai.
Xoá cache buộc Metro index lại module graph → `@expo/vector-icons` resolve được → `./Entypo` resolve được.

### A4. Kiểm chứng sau khi sửa (cold bundle, cache đã xoá)

| Kiểm tra | Kết quả |
|----------|---------|
| Web bundle `STATUS` | **200** |
| Web bundle `LEN` | **5.583.816** |
| `UnableToResolveError` trong bundle | **0** |
| Tham chiếu module `Entypo` | **16** |
| Tham chiếu module `Ionicons` | **135** |
| Android bundle `STATUS` / `LEN` | **200** / **7.761.287** |
| Android `UnableToResolveError` | **0** |
| Android refs `Entypo` / `Ionicons` | **14** / **133** |

**Chứng minh lỗi chỉ còn tính lịch sử** (parse toàn bộ 911 entry trong log):

```
last bundling:failed : 2026-10-10T03:55:56.101Z  (Unable to resolve "./Entypo")
last Entypo mention  : 2026-10-10T03:55:56.103Z
last bundling:done   : 2026-10-10T07:15:49.092Z
=> bundle thành công cuối cùng xảy ra SAU lần lỗi cuối 199.9 phút, 0 lỗi sau khi sửa.
```

---

## B. CORS NestJS chặn categories / products / farms

### B1. Cấu hình TRƯỚC (lỗi)

`apps/api/src/main.ts`:

```ts
app.enableCors({ origin: corsOrigin.length > 0 ? corsOrigin : true, credentials: true });
```

`apps/api/.env` → `CORS_ORIGIN="http://localhost:3001,http://localhost:3002"`

Hai vấn đề:
1. **Thiếu origin Expo Web** (`8081`, `8082`) → browser chặn mọi request từ Expo Web.
2. **`origin: true` khi `CORS_ORIGIN` rỗng** → **phản chiếu mọi origin** (tương đương `*` về mặt
   bảo mật). Kèm `credentials: true` → cực kỳ nguy hiểm nếu ai đó quên set biến môi trường.

### B2. Cấu hình SAU (đã sửa)

```ts
const DEFAULT_DEV_CORS_ORIGINS = [
  'http://localhost:3001', 'http://localhost:3002',
  'http://localhost:8081', 'http://localhost:8082',
];

app.enableCors({
  origin: corsOrigin.length > 0 ? corsOrigin : DEFAULT_DEV_CORS_ORIGINS, // allow-list, KHÔNG phản chiếu
  credentials: false,                                                     // client dùng bearer token
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'Idempotency-Key'],
  exposedHeaders: ['Content-Disposition', 'Content-Length'],
  maxAge: 600,
});
```

**Các nguyên tắc đã tuân thủ:**
- ❌ Không `origin: '*'`, ❌ không phản chiếu origin → chỉ allow-list tường minh.
- ✅ Fail **closed**: thiếu `CORS_ORIGIN` → chỉ các dev client đã biết, không mở ra Internet.
- ✅ Giữ nguyên JWT/auth; `credentials: false` vì client dùng **bearer token**, không dùng cookie.
- ✅ Hỗ trợ `Authorization`, `Content-Type` và preflight `OPTIONS`.

`CORS_ORIGIN` sau khi sửa (trong `apps/api/.env`, file git-ignored):

```
http://localhost:3001,http://localhost:3002,http://localhost:8081,http://localhost:8082,
http://192.168.100.155:8081,http://192.168.100.155:8082
```

### B3. Kiểm chứng HTTP (chạy thật, không mock)

| # | Request | Kết quả |
|---|---------|---------|
| 1 | GET `/categories` · `Origin: http://localhost:8081` | **200** · `ACAO=http://localhost:8081` · `ACAC` rỗng ✅ |
| 2 | GET `/categories` · `Origin: http://localhost:8082` | **200** · `ACAO=http://localhost:8082` |
| 3 | GET `/categories` · `Origin: http://192.168.100.155:8081` | **200** · `ACAO=http://192.168.100.155:8081` |
| 4 | GET `/categories` · `Origin: https://evil.example.com` | **200** · `ACAO=[]` (**không** phản chiếu) ✅ |
| 5 | OPTIONS preflight `POST /orders` | **204** · `ACAM=GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS` · `ACAH=Accept,Authorization,Content-Type,Idempotency-Key` · `MAXAGE=600` |
| 6 | GET `/categories` `/products?limit=3` `/farms?limit=3` | **200 / 200 / 200**, đều có ACAO |
| 7 | GET `/carts/me` không token | **401** · vẫn có ACAO → auth còn nguyên |
| 8 | GET `/carts/me` token sai | **401** |
| 9 | LAN API `http://192.168.100.155:3000/api/v1/categories` | **200** · `ACAO=http://localhost:8081` |

### B4. Kiểm chứng bằng **browser thật** (CDP, không phải curl)

`apps/mobile/scripts/cors-browser-check.mjs` — chạy Chromium headless, trang thật tại
`http://localhost:8081`, gọi API thật qua `fetch`:

```
page origin      : http://localhost:8081
PASS categories?limit=100&status=ACTIVE     http=200 records=5 err=none
PASS products?limit=5                       http=200 records=5 err=none
PASS farms?limit=5                          http=200 records=4 err=none

BROWSER CORS: ALL PASS
```

### B5. Luồng xác thực đầy đủ qua CORS (không mock)

```
LOGIN {"email":"lan.nguyen@agrimarket.vn"} -> 200 token=true
   /auth/me      -> 200  acao=http://localhost:8081
   /carts/me     -> 200  acao=http://localhost:8081
   /orders/me    -> 200  acao=http://localhost:8081  (4594 bytes dữ liệu thật)
```

### B6. Test hồi quy mới

`apps/api/test/business-rules/cors.spec.ts` — **13 test**, tất cả **PASS**.
Bảo vệ: allow-list, không phản chiếu origin lạ, preflight, headers, `credentials: false`.

---

## C. Chuẩn hoá server Expo 8081 / 8082

**Trước:** hai server do dự án sở hữu cùng chạy (8081 `--lan` và 8082) → trùng lặp, dễ nhầm.

**Cách xử lý:** dừng cả hai → xoá `metro-cache` (2 lần) → khởi động **một** server:

```powershell
npx expo start --lan --clear --port 8081
```

**Sau (kiểm tra bằng `Get-NetTCPConnection`):**

| Cổng | Trạng thái | Ghi chú |
|------|-----------|---------|
| **8081** | **LISTEN** (pid 9752) | Expo Web + Metro duy nhất |
| **8082** | **FREE** | đã dừng, không còn dùng |
| 3000 | LISTEN (pid 33952) | NestJS API |

LAN IP `192.168.100.155` vẫn hợp lệ (đã kiểm tra `ipconfig`).

---

## D. Kiểm chứng API + ảnh sản phẩm

### D1. Endpoint công khai

| Endpoint | Status | ACAO | LEN |
|----------|--------|------|-----|
| `/categories` | 200 | `http://localhost:8081` | 785 |
| `/products?limit=3` | 200 | `http://localhost:8081` | 3113 |
| `/farms?limit=3` | 200 | `http://localhost:8081` | 1314 |

### D2. Ảnh sản phẩm — URL tuyệt đối, file thật

API trả URL **tuyệt đối** trong `images[].url`:

```json
"images": [{
  "id": 100, "productId": 42,
  "url": "http://localhost:3000/uploads/products/3f2db25c-69b8-4e66-a347-df1f18f86151.webp",
  "isPrimary": true, "mimeType": "image/webp", "width": 314, "height": 314, "sizeBytes": 20614
}]
```

| Kiểm tra | Kết quả |
|----------|---------|
| `http://localhost:3000/uploads/products/3f2db25c-....webp` | **200** · `image/webp` · **20.614 bytes** |
| `http://192.168.100.155:3000/uploads/products/3f2db25c-....webp` | **200** · `image/webp` · **20.614 bytes** |
| File thật trong `apps/api/uploads/products` | **32** file |

Ảnh hiển thị thật trên UI (xem §E) — **không** dùng mock/placeholder.

---

## E. Kiểm chứng UI mobile (Expo Web, dữ liệu thật)

### E1. Quét 14 route — tất cả sạch

`apps/mobile/scripts/screen-sweep.mjs` @ 412×915:

```
/              ok | text=1281 imgs=9  | "Trang chủ"
/catalog       ok | text=1007 imgs=14 | "Sản phẩm"
/trace         ok | text= 574 imgs=0  | "Truy xuất"
/cart          ok | text= 138 imgs=0  | "Giỏ hàng"
/account       ok | text= 206 imgs=0  | "Tài khoản"
/login         ok | text= 155 imgs=0  | "Đăng nhập"
/farms         ok | text= 592 imgs=0  | "Trang trại"
/addresses     ok | text=  80 imgs=0  | "Sổ địa chỉ"
/orders        ok | text=  70 imgs=0  | "Đơn hàng"
/vouchers      ok | text= 267 imgs=0  | "Mã giảm giá"
/returns       ok | text=  77 imgs=0  | "Trả hàng"
/complaints    ok | text=  76 imgs=0  | "Khiếu nại"
/my-reviews    ok | text=  85 imgs=0  | "Đánh giá của tôi"
/scan          ok | text= 132 imgs=0  | "Quét mã QR"

SCREEN SWEEP: all routes clean
```

### E2. Màn detail với dữ liệu + ảnh thật

- **`/product/42`** — "Rau muống hạt", ảnh thật (`3f2db25c-....webp`), 12.000 ₫, biến thể
  "Bó 500 g", tồn 260 bó, nút "Thêm vào giỏ" / "Mua ngay". ✅
- **`/farm/12`** — "Vườn cây ăn quả Sông Hồng", FARM-0004, 4 ha, toạ độ, **"Trang trại chưa có
  chứng nhận còn hiệu lực."** → đã xác minh là **đúng dữ liệu thật**: API
  `/certificates/farm/12/valid` trả `[]`.
- **`/farm/10`** — ngược lại, hiển thị chứng nhận thật **VietGAP · VG-HY-2026-027**,
  "Đã xác minh", cấp 05/07/2026 – hết hạn 05/07/2027. ✅ (chứng minh nhánh có dữ liệu hoạt động)
- **`/trace/TRC-000019-BAPCA`** — "Bắp cải trắng", LOT-20260923-0019, 700 kg, nguồn gốc
  (Cánh đồng Phú Cường, HTX Nông nghiệp Phú Cường), kiểm định chất lượng 4/4 đạt, hành trình lô. ✅

### E3. Hai lỗi UI thật phát hiện thêm bằng đo đạc → đã sửa

#### (a) Nhãn tab bar bị cắt chữ

**Đo được (trước):** nhãn tab `scrollHeight=5` / `clientHeight=5` → chữ tiếng Việt có dấu bị cắt,
thiếu icon `⏷` ở 1 số tab.

**Nguyên nhân:** tab bar chỉ cao 49dp mặc định — vừa đủ icon, không đủ cho nhãn.

**Sửa** trong `apps/mobile/app/(tabs)/_layout.tsx`:

```ts
const TAB_BAR_MIN_HEIGHT = 60;   // dòng 30
// ...
tabBarStyle: { minHeight: TAB_BAR_MIN_HEIGHT, ... }   // dòng 133
label: { fontSize: 11, lineHeight: 15, ... }          // dòng 140
```

**Đo lại (sau):** nhãn `scrollHeight=15` / `clientHeight=15` (5 → 15), tab bar `minHeight: 60px`,
số icon thiếu `⏷` = **0**, **18** node icon-font render đủ. Ảnh chụp xác nhận 5 nhãn
"Trang chủ / Sản phẩm / Truy xuất / Giỏ hàng / Tài khoản" hiển thị trọn vẹn.

#### (b) Tiêu đề section dính sát mép phải

**Đo được (trước):** link "Xem tất cả" `gapRight=0`, tiêu đề section `left=0` → chữ dính sát
mép màn hình, không có lề.

**Nguyên nhân:** `SectionHeader` trong `apps/mobile/src/components/ui.tsx` không có lề ngang,
dựa vào padding của screen cha — nhưng các screen dùng nó lại render trực tiếp.

**Sửa:** `marginHorizontal: spacing.md` (dòng 233).

**Đo lại (sau):**

```
"Xem tất cả": top=265 left=335 right=400 gapRight=12 h=17 sh=17 ch=17   (0 → 12)
              top=541 left=335 right=400 gapRight=12
              top=1877 left=335 right=400 gapRight=12
section titles: "Danh mục" left=12 · "Sản phẩm nổi bật" left=12 · "Trang trại" left=12  (0 → 12)
```

---

## F. Kết quả test & acceptance

### F1. Mobile (`apps/mobile`)

| Lệnh | Kết quả |
|------|---------|
| `npx tsc --noEmit` | **EXIT=0** |
| `npx vitest run` | **8 file / 46 test PASS** |
| `npx eslint .` | **EXIT=0** |
| `npx expo install --check` | "Dependencies are up to date" |
| `npx tsx scripts/integration.ts` (API thật, LAN) | **pass=7 fail=0** |
| `npx tsx scripts/integration.ts` (+ tài khoản CUSTOMER) | **pass=14 fail=0** |

Chi tiết integration (pass=14): `GET /categories`, `/products` (5 items), `/products/:id`, `/farms`,
`/trace/:code`, `/vouchers`, `/flash-sales`, `POST /auth/login`, `GET /auth/me`, `/carts/me`,
`/customers/me/addresses`, `/orders/me`, `POST /orders/checkout-preview` (grandTotal=32000),
`GET /products?status=BOGUS -> 400`.

### F2. API (`apps/api`)

| Lệnh | Kết quả |
|------|---------|
| `npx vitest run` (unit) | **23 file / 263 test PASS** |
| `npx vitest run --config ./vitest.config.e2e.ts` | **8 file / 244 test PASS** |
| `npx vitest run test/business-rules/cors.spec.ts` | **13 test PASS** |
| `npx oxlint src/main.ts test/business-rules/cors.spec.ts` | sạch (0 warning) |

> Lưu ý: 2 warning oxlint tồn tại **trước đó** trong file untracked
> `apps/api/test/concurrency.e2e-spec.ts` — không liên quan thay đổi này.

### F3. `expo-doctor`

**Trước:** 20/21 — FAIL `app.json` schema:

```
✖ Check Expo config (app.json/ app.config.js) schema
  should NOT have additional property 'splash'.
  Field: android - should NOT have additional property 'edgeToEdgeEnabled'.
```

**Sau:** **21/21 — No issues detected!** (chi tiết §G)

### F4. Dữ liệu test dùng thật (DB dev, KHÔNG reset/reseed)

- Products: id **41**, **42** (và 40, ...)
- Farms: id **11**, **12** (và 9, 10)
- Lot trace: **`TRC-000019-BAPCA`**
- Chứng nhận: farm 10 → `VG-HY-2026-027`, farm 9 → `VG-HY-2026-014`; farm 11/12 → không có (đúng thật)

---

## G. Sửa `expo-doctor` app.json schema (phát sinh thêm)

### G1. Xác minh trước khi sửa (không đoán)

Truy vấn trực tiếp schema SDK 57 thật (`https://exp.host/--/api/v2/project/configuration/schema/57.0.0`)
và đọc source `@expo/prebuild-config`:

| Field | Kết luận từ bằng chứng |
|-------|----------------------|
| `expo.splash` | **KHÔNG có** trong schema SDK 57; root có `additionalProperties: false` → lỗi cứng |
| `android.edgeToEdgeEnabled` | **KHÔNG có** trong schema; `Android` cũng `additionalProperties: false` → lỗi cứng |
| Asset field hợp lệ trong SDK 57 | **chỉ có `icon`** → `splash.image` **không còn** được resolve làm manifest asset |
| `web.splash` | **Còn hợp lệ** (PWA splash) |

Bằng chứng source `@expo/prebuild-config/.../withEdgeToEdge.js` (dòng 26–27):

```js
if ('edgeToEdgeEnabled' in (config.android ?? {})) {
  WarningAggregator.addWarningAndroid(TAG,
    '`edgeToEdgeEnabled` customization is no longer available - Android 16 makes edge-to-edge mandatory. ' +
    'Remove the `edgeToEdgeEnabled` entry from your app.json/app.config.js.');
}
```

Ngoài ra: `expo-splash-screen` **không** được cài ở đâu trong workspace và **không** file nào import nó;
`@expo/prebuild-config` có **0** xử lý splash. Theo docs SDK 52+, Expo Go hiển thị **app icon**
thay vì splash cấu hình — nên field này vốn đã là **config chết**.

### G2. Cách sửa (tối thiểu, không thêm dependency)

`apps/mobile/app.json`:

- **Xoá** `expo.splash` (legacy, không còn trong schema SDK 57).
- **Xoá** `android.edgeToEdgeEnabled` (đúng khuyến nghị của chính prebuild-config).
- **Chuyển** ý định splash sang `web.splash` (vẫn hợp lệ trong SDK 57):

```json
"web": {
  "splash": {
    "image": "./assets/splash.png",
    "resizeMode": "contain",
    "backgroundColor": "#0b7a39"
  }
}
```

**Vì sao chọn cách tối thiểu:** root `splash` là config **chết** (không có trong schema, không được
resolve thành asset) nên xoá **không đổi hành vi runtime**. Cách này **tránh cài thêm dependency** —
quan trọng vì chính sự cố cài đặt pnpm một phần là nguyên nhân gốc của lỗi Entypo (§A2).

> **Việc còn lại (ghi nhận, không tự ý làm):** muốn cấu hình splash **native** cho các bản build sau
> này cần cài `expo-splash-screen` (~57.0.9) và thêm config plugin. Việc này nằm ngoài phạm vi
> 3 lỗi runtime và cần cài dependency → **chưa thực hiện**.

### G3. Kiểm chứng sau khi sửa

| Kiểm tra | Kết quả |
|----------|---------|
| `npx expo-doctor@latest` | **21/21 checks passed. No issues detected!** |
| `npx expo config --type public --json` | `android.permissions` suy ra đúng (CAMERA, RECORD_AUDIO); `web.splash` có mặt |
| Web cold bundle lại | **200** · LEN **5.583.816** · 0 resolve error |
| Android cold bundle lại | **200** · LEN **7.761.287** · 0 resolve error |

---

## H. Điểm CHƯA xác minh / BLOCKED (khai báo trung thực)

| Hạng mục | Trạng thái | Lý do |
|----------|-----------|-------|
| **Expo Go trên thiết bị Android thật** | **NOT TESTED / BLOCKED** | Không có điều khiển thiết bị (không bắt buộc USB/ADB). Mọi kết luận UI ở đây là trên **Expo Web** (Metro + react-native-web), không phải máy thật. |
| Splash screen native | **NOT TESTED** | `expo-splash-screen` chưa cài (§G2); không thể kiểm chứng không có thiết bị/build. |
| `web.splash` có hiệu lực thật | **NOT TESTED** | `expo export --platform web` ở chế độ `output: single` **không** sinh PWA manifest → chưa quan sát được tác dụng. Đã ghi nhận, không tuyên bố PASS. |
| `pnpm why @expo/vector-icons` | **NOT RUN** | Chỉ dùng `expo install --check` + `expo-doctor` + phân tích cây `.pnpm`. |
| Ghi DB / write flow | **NOT RUN** | Cố ý: không reset/reseed, không tạo dữ liệu. Integration chỉ chạy nhánh read-only (write cần `AGRIMARKET_RUN_WRITE_TESTS=1`). |

---

## I. Phiên bản package (TRƯỚC = SAU — không đổi)

`npx expo install --check` → **"Dependencies are up to date"**. **Không** nâng/hạ bất kỳ package nào.

| Package | Version | Đối chiếu SDK 57 |
|---------|---------|------------------|
| `expo` | 57.0.27 | — |
| `expo-router` | 57.0.25 | bundled `~57.0.25` ✅ |
| **`@expo/vector-icons`** | **15.1.1** | bundled **`^15.0.2`** ✅ |
| `react-native` | 0.86.3 | — |
| `react` / `react-dom` | 19.2.3 | — |
| `react-native-web` | 0.21.4 | — |
| `expo-camera` | 57.0.6 | bundled `~57.0.6` ✅ |
| `expo-secure-store` | 57.0.4 | bundled `~57.0.4` ✅ |
| `expo-status-bar` | 57.0.1 | — |
| `expo-constants` | 57.0.21 | — |
| `expo-font` | 57.0.4 | — |
| `expo-linking` | 57.0.12 | — |
| `react-native-safe-area-context` | 5.7.0 | — |
| `react-native-screens` | 4.26.2 | — |
| `@react-native-community/netinfo` | 12.0.1 | — |
| `expo-splash-screen` | **không cài** | bundled `~57.0.9` (chưa dùng — §G2) |

> **Không** có `metro.config.js` trong dự án → dùng mặc định của Expo (**không** thêm alias).

---

## J. File đã thay đổi

### J1. Sửa cho chính 3 lỗi + phát sinh

| File | Thay đổi |
|------|----------|
| `apps/api/src/main.ts` | CORS: allow-list tường minh + `DEFAULT_DEV_CORS_ORIGINS`, `credentials: false`, methods/allowedHeaders/exposedHeaders/maxAge |
| `apps/api/.env` *(git-ignored)* | `CORS_ORIGIN` thêm `8081`, `8082`, `192.168.100.155:8081`, `192.168.100.155:8082` |
| `apps/api/.env.example` | Tài liệu hoá `CORS_ORIGIN` (exact match, không `*`, fail-closed) |
| `apps/mobile/app.json` | Xoá `splash` + `android.edgeToEdgeEnabled`; thêm `web.splash` (§G) |
| `apps/mobile/app/(tabs)/_layout.tsx` | `TAB_BAR_MIN_HEIGHT = 60`, `minHeight`, nhãn `lineHeight: 15` |
| `apps/mobile/src/components/ui.tsx` | `SectionHeader` thêm `marginHorizontal: spacing.md` |

### J2. File test / script mới

| File | Mục đích |
|------|----------|
| `apps/api/test/business-rules/cors.spec.ts` | **Mới** — 13 test hồi quy CORS |
| `apps/mobile/scripts/cors-browser-check.mjs` | **Mới** — kiểm CORS bằng browser thật (CDP) |
| `apps/mobile/scripts/screen-sweep.mjs` | **Mới** — quét 14 route |
| `apps/mobile/scripts/shot.mjs` | **Mới** — chụp ảnh đúng viewport thiết bị |
| `apps/mobile/scripts/layout-probe.mjs` | **Mới** — đo layout |
| `apps/mobile/scripts/tabbar-probe.mjs` | **Mới** — đo tab bar |
| `apps/mobile/scripts/tabbar-deep-probe.mjs` | **Mới** — đo sâu cây DOM tab bar |
| `apps/mobile/scripts/tabitem-probe.mjs` | **Mới** — đo từng tab item |
| `apps/mobile/scripts/header-probe.mjs` | **Mới** — đo `SectionHeader` |

> Toàn bộ script tạm trong lúc chẩn đoán đã được **xoá** (`.expo-export-check/`,
> `_tmp-schema-check.mjs`, `_tmp-log-timeline.mjs`, `_tmp-cert-check.mjs`, `_tmp-auth-check.mjs`).
> Đã xác nhận `git status` sạch cho các đường dẫn tạm này.

---

## K. Git status & xác nhận không commit / push

```
HEAD: 4b14267 "Khoi tao Admin Web V2"   (KHÔNG đổi — không có commit mới)
Branch: main...origin/main              (KHÔNG push)
```

- ✅ **Không** commit, **không** push, **không** `git reset --hard`, **không** `git clean`.
- ✅ **Không** xoá file untracked nào của người dùng.
- ✅ **Không** ghi đè thay đổi chưa commit của người khác.
- ✅ **Không** reset/reseed database.

**File đã sửa (M) liên quan tác vụ này:**

```
 M apps/api/.env.example
 M apps/api/src/main.ts
```

**File untracked mới liên quan tác vụ này:**

```
?? apps/api/test/business-rules/cors.spec.ts
?? apps/mobile/app.json
?? apps/mobile/scripts/cors-browser-check.mjs
?? apps/mobile/scripts/header-probe.mjs
?? apps/mobile/scripts/layout-probe.mjs
?? apps/mobile/scripts/screen-sweep.mjs
?? apps/mobile/scripts/shot.mjs
?? apps/mobile/scripts/tabbar-deep-probe.mjs
?? apps/mobile/scripts/tabbar-probe.mjs
?? apps/mobile/scripts/tabitem-probe.mjs
```

> **Lưu ý quan trọng:** toàn bộ `apps/mobile/` là **untracked** (`?? apps/mobile/`) — dự án Mobile V2
> chưa từng được commit. Vì vậy `app.json`, `app/(tabs)/_layout.tsx`, `src/components/ui.tsx` nằm
> trong cây untracked đó, **không** xuất hiện dưới dạng ` M`.
> Repo còn nhiều thay đổi ` M` / `??` **có trước** và **không liên quan** tác vụ này
> (admin-web, customer-web, các spec API khác, docs khác).

**Kiểm tra không commit/push:** `git log --oneline -3` vẫn kết thúc ở `4b14267`, nhánh
`main...origin/main` không có "ahead".

---

## L. Trạng thái runtime hiện tại

| Thành phần | Trạng thái |
|-----------|-----------|
| Expo / Metro (8081, `--lan`) | **LISTEN** — pid 9752 |
| Expo 8082 | **FREE** (đã dừng) |
| NestJS API (3000) | **LISTEN** — pid 33952 |
| Web cold bundle | 200 · 5.583.816 B · 0 resolve error |
| Android cold bundle | 200 · 7.761.287 B · 0 resolve error |
| `expo-doctor` | **21/21** |
| `expo install --check` | Dependencies are up to date |

---

## M. Việc còn lại / khuyến nghị

1. **Splash native cho build sau:** cài `expo-splash-screen` (~57.0.9) + thêm config plugin
   nếu cần splash tuỳ chỉnh (hiện Expo Go hiển thị app icon — §G2).
2. **`web.splash`:** cần export với PWA manifest (hoặc `web.output` khác `single`) để kiểm chứng
   thật; hiện **NOT TESTED** (§H).
3. **Nghiệm thu thiết bị thật:** chạy `adb devices` khi có thiết bị; nếu IP LAN đổi, cập nhật
   **một dòng** `EXPO_PUBLIC_API_BASE_URL` trong `apps/mobile/.env` rồi restart Expo.
4. **`assets/splash.png`** trùng hash với `icon.png`/`adaptive-icon.png`
   (`A5E479FA082BB47E…`) — nên thay bằng ảnh splash thật nếu muốn splash khác icon.
