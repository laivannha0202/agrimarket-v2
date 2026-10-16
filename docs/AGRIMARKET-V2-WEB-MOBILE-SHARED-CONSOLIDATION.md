# AgriMarket V2 — Hợp nhất Domain Web ↔ Mobile + P0 "Mua ngay" (2026-10-17)

Trạng thái: `CODE/TEST VERIFIED` cho Web, Mobile, API và 2 package dùng chung.
Thiết bị thật chưa có trong môi trường này — không ghi PASS thiết bị.

Phạm vi: `packages/shared-domain`, `packages/design-tokens`, P0 "Mua ngay"
(Web), quy tắc COD (API + Admin), trang chủ Web/Mobile, hạ tầng test Web.

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

## 9. Hạn chế & việc còn lại

- Chưa test trên thiết bị thật (Expo Go) trong môi trường này; bundle đã được
  chứng minh bằng `expo export`.
- `git` không có trong PATH của môi trường — không thể commit/branch từ đây;
  toàn bộ thay đổi nằm trong working tree.
- Các thư mục artifact cũ ở gốc repo (`backups/`, `node_modules_pnpm_broken/`,
  `AGRIMARKET_*`) được giữ nguyên, không xử lý trong phạm vi này.
