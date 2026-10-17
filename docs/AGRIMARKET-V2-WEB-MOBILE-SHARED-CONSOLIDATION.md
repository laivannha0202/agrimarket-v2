# AgriMarket V2 — Hợp nhất Domain Web ↔ Mobile + P0 "Mua ngay" (2026-10-17)

Trạng thái: `CODE/TEST VERIFIED` cho Web, Mobile, API và 2 package dùng chung.
Thiết bị thật chưa có trong môi trường này — không ghi PASS thiết bị.

Phạm vi: `packages/shared-domain`, `packages/design-tokens`, P0 "Mua ngay"
(Web), quy tắc COD (API + Admin), trang chủ Web/Mobile, hạ tầng test Web.

> **Vòng sửa cuối (cùng ngày)** nằm ở **[§10](#10-vòng-sửa-cuối--nghiệm-thu-bằng-chứng-thực)**:
> nguồn checkout `CART`/`BUY_NOW` ở backend, nhãn chất lượng có căn cứ, E2E
> backend chạy thật trên DB TEST, build production Admin/Customer/API, export
> Expo Android, và các lỗi phát hiện thêm. Các số liệu ở §7 là của vòng trước;
> số liệu nghiệm thu cuối nằm ở §10.

---

## 1. Vấn đề trước thay đổi (vì sao phải hợp nhất)

Web và Mobile mỗi bên cài lại cùng một logic, dẫn tới trôi lệch thật:

| Hạng mục | Trước | Sau |
| --- | --- | --- |
| "Mua ngay" Web | Thêm sản phẩm B vào giỏ rồi checkout **cả giỏ** (A+B) | `/thanh-toan?mua-ngay=<variantId>:<qty>` checkout **đúng dòng B**, giỏ giữ nguyên A |
| Thông báo lỗi mạng | Mobile: "kiểm tra Wi-Fi"; Web: "kiểm tra kết nối mạng" | Một câu chung trong `shared-domain/checkout` |
| Nhãn "đang giảm giá" (Web) | `effectivePrice.source !== "NONE"` — nhận cả giá không thật giảm (undefined/0%) | `isProductOnSale` — giá phải **thấp hơn thật** trên variant ACTIVE |
| Gạch giá flash (Mobile) | Luôn hiển thị giá gốc gạch ngang dù giá flash = giá gốc | Chỉ gạch khi thật sự giảm |
| Trang chủ (Mobile) | Sản phẩm có thể xuất hiện 2–3 lần; request `/product-discounts` thừa | Chia khu bằng `partitionHomeProducts`, không lặp; bỏ request thừa |
| COD | `PATCH /payments/:id/status` cho phép PAID cho đơn chưa giao / đã hủy | Chỉ PAID khi đơn `DELIVERED` (COD) và không bao giờ PAID khi `CANCELLED` |

---

## 2. `packages/shared-domain` — nguồn sự thật chung

Pure logic, không React/DOM/React Native/network. 5 module + subpath exports:

| Module | Nội dung | Ai dùng |
| --- | --- | --- |
| `types` | Enum + type lõi (OrderStatus, PaymentStatus…) | Web, Mobile |
| `format` | `formatMoney`, `formatDate`, `formatQuantity`, `variantSpecLabel`, `discountPercent`, `isRealDiscount`… | Web, Mobile |
| `statuses` | Nhãn tiếng Việt + tone cho mọi status, flow order/return, danh sách được hủy/trả | Web, Mobile |
| `checkout` | `parseBuyNowParam`/`buyNowParam`, phân loại 409, câu lỗi, `buildCheckoutPayload`, `formatAddressLine` | Web, Mobile |
| `home` | `partitionHomeProducts`, `isProductOnSale`, `discountedVariantPrice`, `isFlashSaleLive`, `flashItemRemaining`, `isFlashItemSoldOut`, `flashSaleRemainingTotal` | Web, Mobile |

Quy ước import:

- **Web** dùng subpath (`@agrimarket/shared-domain/checkout`, …) qua `transpilePackages` của Next.
- **Mobile** dùng root export `@agrimarket/shared-domain` (Metro resolve an toàn nhất); đã chứng minh bằng `expo export` (mục 7).

`packages/design-tokens`: màu/tone/radius/spacing/type-scale dùng chung; Mobile `theme.ts` lấy `Tone` từ đây để tone trạng thái khớp Web.

---

## 3. Hợp đồng "Mua ngay" (P0)

Web: `/thanh-toan?mua-ngay=<variantId>:<quantity>` — Mobile: `buyNow` trên `/checkout`.
Cả hai chạy đúng một bộ luật trong `shared-domain/checkout`:

1. `parseBuyNowParam` chỉ nhận `variantId` nguyên dương + `quantity ≥ 0.001`; sai → `null`.
2. Tham số **hợp lệ**: `CheckoutView` chạy chế độ direct-items —
   - KHÔNG đọc giỏ (`cart` query bị tắt trong chế độ này);
   - preview gửi `items: [B]`;
   - payload gửi `items: [B]` + `expectedGrandTotal` khách đã thấy;
   - giỏ giữ nguyên A; backend chỉ xóa cart item của variant đã mua.
3. Tham số **không hợp lệ**: màn hình lỗi rõ ràng ("Thông tin mua ngay không đọc được…"), KHÔNG âm thầm quay về checkout cả giỏ.
4. Đăng nhập lại vẫn giữ `?mua-ngay=`: `RequireCustomer` chuyển tiếp nguyên query string.
5. Giá/tồn kho: chỉ backend quyết định (`checkout-preview`); Web/Mobile không tự tính.

---

## 4. Xung đột 409 & idempotency (dùng chung)

`classifyCheckoutConflict` tách 5 loại theo đúng ngữ nghĩa backend:

| Message backend | Kết quả | Phản ứng UI |
| --- | --- | --- |
| `… total changed …` | `total-changed` | Refresh preview + bắt xác nhận **một lần** với tổng mới |
| `… still being processed …` | `in-flight` | Nhắc thử lại với **cùng key** — không bắt xác nhận lại |
| `… already used with a different checkout payload …` | `key-reuse` | Báo lỗi, tạo key mới khi payload đổi |
| `… no longer available …` | `order-gone` | Báo lỗi theo cause |
| Khác | `other` | Câu chung theo cause |

Kèm theo: `needsTotalConfirm`, `carryPendingTotal` (bỏ xác nhận khi khách đổi địa chỉ/voucher), key idempotency tái sử dụng theo chữ ký payload — retry mạng không tạo đơn đôi.

---

## 5. COD — thu tiền có bằng chứng

- `PaymentsService.updateStatus` (`apps/api/src/payments/payments.service.ts`):
  - PAID bắt buộc `transactionReference`;
  - đơn `CANCELLED` → **không bao giờ** PAID (dùng FAILED);
  - COD chỉ PAID khi đơn `DELIVERED` (shipper thu tiền tại cửa).
- Admin (`apps/admin-web/src/app/(admin)/orders/[id]/page.tsx`): nút "Ghi nhận thu tiền" chỉ render khi `method === COD` + payment `PENDING` + order `DELIVERED`; ngoài ra hiện "Chờ giao hàng"/"—".
- Test mới: `apps/api/test/business-rules/payment-collection.spec.ts` (5 ca).
- Tài liệu: `docs/BUSINESS-RULES.md` mục 6, `docs/API.md` mục Payments.

---

## 6. Trang chủ Web/Mobile — cùng một cách chọn sản phẩm

- `partitionHomeProducts`: dedup theo ID; flash sale thắng; "đang giảm giá" chỉ lấy giá giảm thật rồi mới tới "nổi bật"; tôn trọng limit từng khu.
- `isProductOnSale` = có variant ACTIVE với `unitPrice < basePrice` thật.
- Flash: `isFlashSaleLive` (ACTIVE + trong khung giờ), "Hết suất" theo `isFlashItemSoldOut`, "… suất còn lại" theo `flashSaleRemainingTotal` (không clamp hai nơi).
- Mobile bỏ hẳn request `/product-discounts` ở trang chủ (dữ liệu đó nằm trong `effectivePrice` của product).
- Mobile thêm **badge số dòng hàng** trên tab "Giỏ hàng": lấy `items.length` từ `GET /carts/me`, chỉ khi đã đăng nhập, cùng query key `["cart"]` nên cập nhật ngay khi thêm/xóa; cap "99+" như Web.

---

## 7. Kiểm chứng (đã chạy)

| Lệnh | Kết quả |
| --- | --- |
| `npm test --workspace @agrimarket/api` | **412 PASS** (32 file; gồm 5 test COD mới) |
| `npm test --workspace @agrimarket/admin-web` | **40 PASS** (7 file) |
| `npm test --workspace @agrimarket/customer-web` | **33 PASS** (2 file — hạ tầng vitest mới: `vitest.config.ts`, alias `@`, test mua-ngay/payload/409/status/format qua chính entry Web) |
| `npm test --workspace @agrimarket/mobile` | **170 PASS, 3 skip** (1 file skip — integration cần API sống) |
| `npm test --workspace @agrimarket/shared-domain` | **55 PASS** (4 file) |
| `npm run typecheck --workspaces --if-present` | **PASS cả 6 workspace** (api, admin-web, customer-web, mobile, shared-domain, design-tokens) |
| `npm run lint --workspaces --if-present` | **PASS** (admin-web/customer-web/mobile sạch; api còn 3 warning `require-array-sort-compare` trong file test e2e — không chặn, exit 0) |
| `npm run build --workspace @agrimarket/customer-web` | PASS — 29 route, `/` prerender tĩnh, `/thanh-toan` dynamic đúng thiết kế |
| `npx expo export --platform android` | Bundle Hermes thành công (3.7MB). Chuỗi chỉ có trong shared-domain xuất hiện trong bundle: `isFlashSaleLive`, `isProductOnSale`, `parseBuyNowParam`, `flashSaleRemainingTotal`, "Không kết nối được máy chủ…", "Sản phẩm này không còn đủ hàng để đặt" → Metro resolve đúng package dùng chung. |

---

## 8. Sửa kèm khi kiểm tra toàn cục

1. **admin-web typecheck từng OOM — đã tìm ra nguyên nhân và sửa.** Trong
   `apps/admin-web` tồn tại thư mục `node_modules_npm_tmp/` (bản sao tạm của
   node_modules: 58.713 file, 17.326 file `.ts/.tsx/.d.ts`) — sót lại từ một lần
   npm bị ngắt. `tsconfig.json` chỉ `exclude: ["node_modules"]` nên TypeScript
   gom cả bản sao này vào chương trình, còn ESLint cũng không ignore (mặc định
   chỉ bỏ qua thư mục đúng tên `node_modules`).
   - Sửa: `exclude: ["node_modules", "node_modules_npm_tmp"]` trong
     `apps/admin-web/tsconfig.json`; thêm `"node_modules_npm_tmp/**"` vào
     `globalIgnores` của `apps/admin-web/eslint.config.mjs`. Không xoá dữ liệu
     của người dùng — chỉ bỏ qua khi kiểm tra.
   - Kết quả: `tsc --noEmit` chạy sạch với heap mặc định (~4GB) và lint toàn
     repo hết treo. Đây là lý do trước đây bị ghi nhận là "OOM pre-existing".
2. **`GET /returns/me/eligible-items` thiếu phân trang DB.** `listEligibleItems`
   (returns.service.ts) khai báo `skip/take` nhưng `findMany` không dùng, trả
   về **toàn bộ** dòng đã giao trong khi `meta` quảng cáo theo trang. Sửa: áp
   `skip/take` đúng như bản song sinh bên reviews và đúng như comment mô tả
   ("page lấy trên các dòng delivered, sau đó mới lọc"). Xoá luôn import chết
   `MAX_EVIDENCE_PER_REQUEST` trong `evidence.controller.ts`.
3. **Cảnh báo còn lại (không chặn):** 3 cảnh báo `require-array-sort-compare`
   trong 2 file test e2e của api — pre-existing, không đổi hành vi test.

## 9. Hạn chế & việc còn lại (cập nhật ở §10)

- Chưa test trên thiết bị thật (Expo Go) trong môi trường này; bundle đã được
  chứng minh bằng `expo export`.
- `git` **có** trên máy nhưng không nằm trong PATH (`C:\Program Files\Git\cmd\git.exe`);
  vòng trước kết luận nhầm là "không có git" nên mọi thay đổi nằm ở working tree.
  Vòng cuối đã commit được — xem §10.9.
- Các thư mục artifact cũ ở gốc repo (`backups/`, `node_modules_pnpm_broken/`,
  `AGRIMARKET_*`) được giữ nguyên, không xử lý trong phạm vi này.

---

## 10. Vòng sửa cuối — nghiệm thu bằng chứng thực tế

Mọi kết quả dưới đây được chạy lại **sau** khi sửa, trên chính máy này, trong
phiên làm việc cuối. Không có mục nào được đánh dấu PASS chỉ vì "vòng trước đã
báo PASS".

### 10.1. P0 — "Mua ngay" không được sửa giỏ hàng (đã sửa tận gốc)

**Lỗi (đã xác minh trong code trước khi sửa).** Sau khi tạo đơn, `OrdersService`
chạy `tx.cartItem.deleteMany({ productVariantId: { in: <các variant đã mua> } })`
bất kể dòng hàng đến từ đâu. Hệ quả: mua ngay B khi giỏ đang có B sẽ **xoá nguyên
dòng B** (cả số lượng), và mua ngay B khi giỏ có A cũng ghi vào giỏ dù khách
không hề thêm B vào giỏ.

**Cách sửa.** Thêm trường `source` vào hợp đồng checkout, phân biệt rõ hai nguồn:

| Nguồn | Ý nghĩa | Backend làm gì với giỏ |
| --- | --- | --- |
| `CART` | Khách thanh toán từ giỏ | Trừ **đúng số lượng đã trả tiền** khỏi dòng giỏ khớp variant; xoá dòng chỉ khi số còn lại ≤ 0 |
| `BUY_NOW` | Khách mua trực tiếp ("Mua ngay") | **Không đọc, không thêm, không trừ, không xoá** bất kỳ dòng giỏ nào |

Quy tắc an toàn (đây là phần quan trọng nhất):

1. Cờ `source` **chỉ có thể ngăn** một thao tác ghi vào giỏ, không bao giờ mở ra
   một thao tác mới. Mọi thao tác ghi vẫn suy ra từ **giỏ do server đọc** và
   **các dòng đơn đã thực trả tiền**.
2. Client cũ **không gửi** `source` mà gửi `items` → mặc định là `BUY_NOW`
   (nhánh không phá hoại). Chỉ khi client **không gửi `items`** (server tự đọc
   giỏ) mới mặc định là `CART`.
3. `source` là một phần của **chữ ký idempotency**: replay cùng key với nguồn
   khác → 409, không âm thầm áp dụng sai luật giỏ.
4. Ghi giỏ nằm **trong cùng transaction** với tạo đơn: checkout thất bại thì giỏ
   không đổi. Checkout một phần (giỏ 3, mua 2) giữ lại 1.
5. Làm tròn số lượng 3 chữ số thập phân (`Decimal(18,3)`) — tránh `0.3-0.1`.

**File:** `apps/api/src/orders/dto/checkout.dto.ts` (enum `CheckoutSource`),
`apps/api/src/orders/orders.service.ts` (`consumeCartLines`, `resolveCheckoutSource`,
hash idempotency), `packages/shared-domain/src/checkout.ts` (`CheckoutSource` +
tham số `source` **bắt buộc** trong `buildCheckoutPayload`), Web
`CheckoutView.tsx`, Mobile `app/checkout.tsx`.

**Kết quả 4 tình huống bắt buộc** (chạy thật, HTTP + DB TEST — §10.4):

| Tình huống | Kỳ vọng | Kết quả |
| --- | --- | --- |
| Case 1: giỏ A, mua ngay B | Đơn chỉ có B; giỏ vẫn A; không thêm B | PASS |
| Case 2: giỏ B×3, mua ngay B×1 | Đơn 1 B; giỏ vẫn 3 B; không trừ/xoá | PASS |
| Case 3: giỏ A×2 + B×3, mua ngay B×1 | Đơn đúng 1 dòng B×1; giỏ nguyên vẹn | PASS |
| Case 4: thanh toán từ giỏ | Chỉ trừ dòng đã trả; giữ phần chưa mua; không xoá khi lỗi | PASS |

### 10.2. P1 — nhãn "An toàn" không có căn cứ (đã bỏ)

**Lỗi.** Product Detail (Web + Mobile) hiển thị `An toàn` + `Truy xuất` chỉ vì
`product.category` (và `product.farmId`) tồn tại — danh mục không chứng minh đã
kiểm định, và "truy xuất" là thuộc tính của **lô**, không phải của sản phẩm.

**Quy tắc mới** — hàm thuần tuý dùng chung `productTrustBadges`
(`packages/shared-domain/src/quality.ts`):

| Dữ liệu backend | Nhãn hiển thị |
| --- | --- |
| Sản phẩm gắn trang trại (`farmId` hợp lệ) | `Thông tin nguồn gốc` (thông tin, không phải chứng nhận) |
| Trang trại có ≥ 1 chứng nhận **hợp lệ hiện tại** | `Chứng nhận trang trại` (nói về **trang trại**, không nói về lô) |
| Chỉ có `category`, hoặc không có gì | **không hiển thị gì** |
| Chứng nhận hết hạn / bị thu hồi / chưa xác minh / thiếu tài liệu | không tính — loại ở server (`GET /certificates/farm/:id/valid`) |
| Request chứng nhận đang tải hoặc lỗi | không hiển thị (không có bằng chứng thì không khẳng định) |

Kiểu đầu vào cố tình **không có** trường `category`, nên không thể tái xuất hiện
kiểu `product.category ? "An toàn" : null`. Không tạo dữ liệu QC/chứng nhận giả;
không đổi FEFO để phục vụ UI. Web và Mobile render **cùng một mảng nhãn** từ cùng
một hàm.

### 10.3. Lỗi phát hiện thêm trong vòng cuối

1. **Chưa có chốt an toàn cho DB test.** `TEST_DATABASE_URL` không được đối
   chiếu với `DATABASE_URL`; chỉ cần trỏ nhầm là `purgeStaleFixtures` +
   `cleanupFixtures` sẽ xoá dữ liệu thật. Đã thêm interlock
   `apps/api/test/helpers/db-safety.ts` (chặn khi **cùng host + cùng tên DB**,
   coi `localhost` = `127.0.0.1`, không in mật khẩu) + 7 test.
2. **Ghi nhận COD có thể trùng khi hai request đồng thời.** `PATCH
   /payments/:id/status` trước đây `update` vô điều kiện: hai lần xác nhận song
   song đều "thành công", ghi đè `paidAt` và ghi 2 dòng audit cho một khoản tiền
   thực thu một lần. Đã chuyển PAID sang **compare-and-set** trên trạng thái đã
   đọc (`updateMany where status = <đã đọc>`) → request thua nhận **409**.
3. **`npm run lan:test` phụ thuộc máy.** Test cuối khẳng định IP Wi-Fi của máy
   cũ (`10.218.208.43`) có trong danh sách interface — chỉ đúng trên máy tác giả.
   Đã viết lại thành bất biến độc lập máy: so trực tiếp `candidatesFromOs()` với
   `os.networkInterfaces()` (bắt được lỗi cache, không phụ thuộc mạng).
4. **`.expo/` chưa bị ignore ở gốc repo** (`expo-doctor` báo). Đã thêm `.expo/`
   vào `.gitignore` gốc (app mobile đã ignore sẵn, đây là chốt thứ hai).

### 10.4. E2E backend trên database TEST (lần đầu chạy đủ)

- Cô lập đã kiểm chứng: `agrimarket_v2` (dev) vs `agrimarket_v2_test` (test) —
  **khác tên DB**, cùng server; đọc trực tiếp `SHOW DATABASES` trước khi chạy.
- `TEST_DATABASE_URL` lấy từ `apps/api/.env`; interlock §10.3.1 đã chạy và cho
  phép (vì khác DB).
- Lệnh: `npm run test:e2e --workspace @agrimarket/api`
- Kết quả: **12 file / 349 test PASS, 0 skip, 0 fail** (69s).
- Riêng nhóm hồi quy P0 (`F2. Buy Now vs cart checkout`) 9/9 PASS ở tầng HTTP thật:
  Case 1–4, khách cũ không gửi `source`, cờ `BUY_NOW` không ghi gì vào giỏ,
  checkout lỗi không mất giỏ, khách thường không tự xác nhận thu tiền (403).
- Bao phủ luồng khác trong bộ e2e: đăng nhập, catalog, checkout + giá backend,
  giữ/trừ tồn kho, admin chuyển trạng thái, huỷ đơn + nhả tồn, voucher, giá đổi
  (409), request đồng thời, idempotency (không double order), COD, return/refund,
  review moderation, phân quyền.

### 10.5. Build production

| Ứng dụng | Lệnh | Kết quả |
| --- | --- | --- |
| Backend API | `npm run build --workspace @agrimarket/api` | PASS (`nest build`) |
| Backend API (runtime) | `node dist/src/main.js` + `GET /api/v1/health` | PASS — `{"status":"ok","database":"up"}`; `GET /products` trả 14 bản ghi, `GET /categories` 5 |
| Admin Web | `npm run build --workspace @agrimarket/admin-web` | **PASS** — 32 route (27 static + 5 dynamic). Đây là lần đầu build production Admin hoàn tất |
| Customer Web | `npm run build --workspace @agrimarket/customer-web` | PASS — 29 route |
| Mobile (Expo) | `npx expo export --platform android` | PASS — Hermes bundle 3.54 MB |

Bằng chứng Metro/Next resolve đúng package dùng chung — chuỗi **chỉ có** trong
`packages/shared-domain` xuất hiện trong bundle Android:
`Thông tin nguồn gốc`, `Chứng nhận trang trại`, `parseBuyNowParam`,
`isFlashSaleLive`; chuỗi `An toàn` **không còn** trong bundle (nhãn cũ đã biến mất
khỏi app phát hành).

### 10.6. Mobile — mức kiểm chứng được và không được

Đã kiểm: `tsc --noEmit` PASS, `eslint` PASS, 175 unit test PASS (3 skip), export
Android PASS, `expo-doctor` (xem dưới), cấu hình LAN đọc từ
`EXPO_PUBLIC_API_BASE_URL` (test `scripts/lan/lib.test.mjs` 12/12 PASS).

**Chưa kiểm:** mở app trên điện thoại thật / Expo Go, QR scanning, luồng
đăng nhập–mua–nhận hàng bằng tay, safe area/keyboard/font scaling trên thiết bị
thật. Đây là hạn chế môi trường (không có thiết bị trong phiên này) — **không**
đánh dấu PASS.

`npx expo-doctor` báo 4 mục, đã phân loại rõ:

| Mục | Đánh giá |
| --- | --- |
| `.expo` not ignored | **Đã sửa** — thêm `.expo/` vào `.gitignore` gốc |
| Multiple lock files (`pnpm-lock.yaml` + `package-lock.json`) | Tồn tại thật. Repo đã chuyển sang npm workspaces (`packageManager: npm@11.20.0`, commit `13181b4`); 2 file pnpm còn lại là di sản. **Không xoá trong vòng này** (quyết định thuộc chủ repo — xem §10.8) |
| Duplicate `react` (19.2.3 trong `apps/mobile/node_modules`, 19.3.0 hoisted cho Next) | Đã kiểm chứng **không phải lỗi runtime**: bundle Android chỉ chứa `19.2.3`, không có `19.3.0`. Mobile khai báo đúng bản Expo SDK 57 yêu cầu |
| `expo`/`expo-router` lệch patch (`57.0.28`↔`~57.0.30`, `57.0.27`↔`~57.0.28`) | Nhắc nâng patch; **không tự ý đổi** SDK/thư viện lớn trong vòng sửa lỗi (§8 của yêu cầu) |

### 10.7. Kiểm chứng Admin + COD

- Giao diện Admin chỉ cho bấm "Ghi nhận thu tiền" khi `method === COD` **và**
  `payment.status === PENDING` **và** `order.status === DELIVERED`; các trường
  hợp khác hiện "Chờ giao hàng"/"—".
- Backend kiểm lại **độc lập** với giao diện: bắt buộc `transactionReference`;
  cấm PAID cho đơn `CANCELLED`; COD chỉ PAID khi đơn `DELIVERED`;
  compare-and-set chống thu trùng (§10.3.2).
- Test: `payment-collection.spec.ts` 9 ca (thiếu mã giao dịch, COD chưa giao,
  đơn huỷ kể cả đơn online, COD sau khi giao, online trả trước, **lặp request**,
  **đồng thời → 409**, không hạ PAID→…, không nâng sai) + 1 ca 403 ở e2e.

### 10.8. Việc còn lại (trung thực)

1. **Thiết bị thật / Expo Go**: chưa mở app trên máy thật (P2 của yêu cầu).
2. **`pnpm-lock.yaml`/`pnpm-workspace.yaml`**: nên xoá để EAS/CI không suy luận
   sai package manager; chưa xoá vì là quyết định chính sách repo.
3. **`expo`/`expo-router` patch**: nên `npx expo install --check` khi có chủ ý.
4. **`apps/mobile/node_modules` còn 7 mục** (`.bin`, `.vite`, `react`,…): bình
   thường với npm workspaces khi có xung đột version; đã loại trừ ảnh hưởng bằng
   bundle.
5. Cảnh báo lint còn lại: 3 warning `require-array-sort-compare` trong 2 file e2e
   (không chặn, exit 0, không đổi hành vi test).

### 10.9. Git (vòng cuối)

- Branch: `main`. Không force-push, không merge, không deploy, **không push**
  (chưa được yêu cầu rõ ràng trong phiên này).
- Commit theo nhóm: xem báo cáo bàn giao kèm theo.

