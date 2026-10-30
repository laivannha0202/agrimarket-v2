# 15 — P0-A SECURITY & PRICING VERIFICATION

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch làm việc:** `fix/p0-a-security-pricing`  
**Phạm vi:** P0-A1 JWT secret fail-closed, P0-A2 rò rỉ dữ liệu Partner qua API công khai, P0-A3 khuyến mãi PERCENT vượt 100%.  
**Ngày thực hiện:** 23/10/2026  
**Kết quả tổng quát:** cả ba nhóm P0-A đạt **VERIFIED FIXED** trong phạm vi đã nêu. Không tuyên bố production-ready.  
**Bằng chứng:** toàn bộ log và exit code nằm trong `.tmp-verify/p0-a/`.

> Đây là báo cáo xác minh trên môi trường local, với test database cô lập. Không có migration, không sửa dữ liệu lịch sử, không commit/push/merge/deploy.

---

## 1. Trạng thái Git

- HEAD: `5b35b974bae65f308cfdce3ab23a6aec959f2916`
- Branch hiện tại: `fix/p0-a-security-pricing`, được tạo từ commit nền nêu trên.
- Working tree có **15 file tracked bị sửa** và **7 file mới** (validator, test setup và các spec P0-A).
- Không chạy `reset`, `clean`, `checkout` phá huỷ hoặc ghi đè lên công việc có sẵn.
- Các file untracked có từ trước được giữ nguyên: `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md`, `audit-reports/`.
- Không commit, không push, không merge, không deploy trong đợt này.
- Không có thay đổi schema Prisma hoặc migration.

Tóm tắt trạng thái sau khi hoàn tất:

```text
 M apps/api/.env.example
 M apps/api/src/auth/auth.module.ts
 M apps/api/src/auth/jwt.strategy.ts
 M apps/api/src/config/configuration.ts
 M apps/api/src/lots/lots.service.ts
 M apps/api/src/partners/dto/partner.dto.ts
 M apps/api/src/partners/partners.controller.ts
 M apps/api/src/partners/partners.service.ts
 M apps/api/src/promotions/dto/promotion.dto.ts
 M apps/api/src/promotions/promotions.service.ts
 M apps/api/src/seasons/seasons.service.ts
 M apps/api/src/traceability/traceability.service.ts
 M apps/api/test/helpers/e2e-fixtures.ts
 M apps/api/test/setup-e2e.ts
 M apps/api/vitest.config.ts
?? apps/api/src/promotions/validators/
?? apps/api/test/business-rules/jwt-config.spec.ts
?? apps/api/test/business-rules/partners-public.spec.ts
?? apps/api/test/business-rules/promotion-discount-validation.spec.ts
?? apps/api/test/p0-a-security-pricing.e2e-spec.ts
?? apps/api/test/setup-unit.ts
?? apps/api/test/test-env.ts
```

---

## 2. Các P0 được xác minh

### P0-A1 — JWT secret fallback `CHANGE_ME`

**Bằng chứng tại HEAD trước khi sửa:**

- `apps/api/src/config/configuration.ts:24`: `jwtSecret: process.env.JWT_SECRET ?? 'CHANGE_ME'`
- `apps/api/src/auth/auth.module.ts:23`: `secret: config.get<string>('jwtSecret') ?? 'CHANGE_ME'`
- `apps/api/src/auth/jwt.strategy.ts:32`: `secretOrKey: config.get<string>('jwtSecret') ?? 'CHANGE_ME'`
- `apps/api/.env.example:11`: `JWT_SECRET="CHANGE_ME"`

**Rủi ro:** nếu thiếu `JWT_SECRET`, API vẫn khởi động và ký/xác thực token bằng một giá trị công khai. Kẻ tấn công biết giá trị này có thể tự tạo token hợp lệ. Ngoài ra, không có kiểm tra độ dài hay độ mạnh của secret.

### P0-A2 — API public `/partners` trả dữ liệu nhạy cảm

**Bằng chứng tại HEAD trước khi sửa:**

- `apps/api/src/partners/partners.controller.ts:24,31`: `@Public()` trên `GET /partners` và `GET /partners/:id`.
- `apps/api/src/partners/partners.service.ts:58`: `findMany` không có `select`, trả toàn bộ bản ghi.
- `apps/api/src/partners/partners.service.ts:65`: `findUnique` không có `select`, trả toàn bộ bản ghi.
- Prisma `Partner` có các cột nhạy cảm: `taxCode` (`tax_code`), `bankAccountName` (`bank_account_name`), `bankAccountNumber` (`bank_account_number`), `bankName` (`bank_name`) — xem `apps/api/prisma/schema.prisma:396-399`.
- Rò rỉ qua route lồng nhau:
  - `apps/api/src/lots/lots.service.ts:206`: `product: { include: { partner: true, category: true } }`
  - `apps/api/src/seasons/seasons.service.ts:55`: `farm: { include: { partner: true } }`
  - `apps/api/src/traceability/traceability.service.ts:21`: `partner: true`

**Rủi ro:** khách vãng lai hoặc khách hàng có thể đọc mã số thuế và thông tin tài khoản ngân hàng của đối tác qua danh sách, chi tiết, tìm kiếm và các route lồng nhau.

### P0-A3 — Khuyến mãi `PERCENT` vượt 100%

**Bằng chứng tại HEAD trước khi sửa:**

- `apps/api/src/promotions/dto/promotion.dto.ts:28-34` và `83-88`: `discountValue` chỉ có `@Type(() => Number)`, `@IsNumber()`, `@Min(0)`; không có giới hạn trên cho `PERCENT`.
- `apps/api/src/promotions/promotions.service.ts:35-51`: `createVoucher` không kiểm tra nghiệp vụ trước khi ghi.
- `apps/api/src/promotions/promotions.service.ts:208-219`: `createProductDiscount` không kiểm tra nghiệp vụ trước khi ghi.
- Công thức giá tại `apps/api/src/promotions/promotions.service.ts:381`, `504`, `585`: `basePrice * (1 - Number(discount.discountValue) / 100)` không clamp, có thể tạo giá âm khi `discountValue > 100`.
- Voucher percent dù được cap bởi subtotal tại `promotions.service.ts:203` vẫn cho phép lưu giá trị > 100, làm dữ liệu khuyến mãi sai lệch và có thể ảnh hưởng các luồng đọc khác.

**Rủi ro:** Admin có thể tạo sản phẩm/voucher giảm giá vô hạn hoặc giá bán âm; checkout có thể ghi nhận tổng tiền âm hoặc sai lệch.

> Ghi chú phạm vi: các endpoint `PATCH` khuyến mãi hiện chỉ cho đổi `status`. Không có endpoint sửa `discountValue` sau khi tạo. Vì vậy yêu cầu “0–100 khi create và update” được đáp ứng bằng: (1) validate khi create ở DTO và service; (2) PATCH chỉ nhận `status`, mọi payload chứa `discountValue` bị từ chối bởi `forbidNonWhitelisted`.

---

## 3. File và dòng code trước khi sửa

| Nhóm | File | Dòng/vị trí trước sửa |
|---|---|---|
| JWT | `apps/api/src/config/configuration.ts` | 24 — fallback `CHANGE_ME` |
| JWT | `apps/api/src/auth/auth.module.ts` | 23 — fallback `CHANGE_ME` |
| JWT | `apps/api/src/auth/jwt.strategy.ts` | 32 — fallback `CHANGE_ME` |
| JWT | `apps/api/.env.example` | 11 — `JWT_SECRET="CHANGE_ME"` |
| Partner | `apps/api/src/partners/partners.controller.ts` | 24, 31 — `@Public()` |
| Partner | `apps/api/src/partners/partners.service.ts` | 58, 65 — `findMany`/`findUnique` không `select` |
| Partner lồng nhau | `apps/api/src/lots/lots.service.ts` | 206 — `partner: true` |
| Partner lồng nhau | `apps/api/src/seasons/seasons.service.ts` | 55 — `partner: true` |
| Partner lồng nhau | `apps/api/src/traceability/traceability.service.ts` | 21 — `partner: true` |
| Promotion | `apps/api/src/promotions/dto/promotion.dto.ts` | 28-34, 83-88 — chỉ `@Min(0)` |
| Promotion | `apps/api/src/promotions/promotions.service.ts` | 35-51, 208-219 — create không validate; 381, 504, 585 — công thức percent không clamp |

---

## 4. Bằng chứng lỗi trước sửa

Đây là bằng chứng tĩnh tại HEAD, không phải kết quả khai thác trên database thật. Không chạy request khai thác vào database development/production.

### 4.1. JWT

```text
HEAD:apps/api/.env.example:11:JWT_SECRET="CHANGE_ME"
HEAD:apps/api/src/auth/auth.module.ts:23:        secret: config.get<string>('jwtSecret') ?? 'CHANGE_ME',
HEAD:apps/api/src/auth/jwt.strategy.ts:32:      secretOrKey: config.get<string>('jwtSecret') ?? 'CHANGE_ME',
HEAD:apps/api/src/config/configuration.ts:24:  jwtSecret: process.env.JWT_SECRET ?? 'CHANGE_ME',
```

Có thể thấy cả ba đường cấu hình đều có fallback công khai. Chỉ cần thiếu biến môi trường, ứng dụng vẫn khởi động với `CHANGE_ME`.

### 4.2. Partner

- Hai route `GET /partners` và `GET /partners/:id` được đánh dấu `@Public()`.
- Service dùng `findMany`/`findUnique` không có `select`, nên Prisma trả toàn bộ cột của bảng `partners`.
- Các route lồng nhau dùng `partner: true`, nên cũng trả toàn bộ cột.
- Schema xác nhận bốn cột nhạy cảm tồn tại trên model `Partner`.

### 4.3. Promotion

- DTO chỉ chặn giá trị âm, không chặn `PERCENT > 100`.
- Service không kiểm tra lại `discountType`/`discountValue` trước khi ghi.
- Ba đường tính giá (`resolvePrice`, `resolvePriceForCustomer`, `resolvePrices`) dùng cùng công thức percent không clamp.
- Đường voucher có cap theo subtotal nhưng vẫn lưu và trả giá trị percent > 100.

---

## 5. Phương án sửa

### 5.1. P0-A1 — JWT fail-closed

1. Thêm `resolveJwtSecret(raw)` trong `apps/api/src/config/configuration.ts`:
   - trim giá trị;
   - từ chối thiếu, rỗng hoặc chỉ có khoảng trắng;
   - từ chối placeholder/weak default sau khi chuẩn hoá dấu phân cách (`change-me`, `CHANGE_ME`, `changeme`, `your-secret`, `replace-with...`, `not-for-production`, `example`, ...);
   - từ chối secret ngắn hơn **32 ký tự** trong **mọi** môi trường, không chỉ production;
   - từ chối giá trị có ít hơn 8 ký tự khác nhau (chặn các trường hợp low-entropy rõ ràng như một ký tự lặp lại);
   - không đưa giá trị secret vào thông báo lỗi.
2. `configuration.ts` dùng `jwtSecret: resolveJwtSecret(process.env.JWT_SECRET)`; không còn fallback.
3. `auth.module.ts` và `jwt.strategy.ts` dùng `config.getOrThrow<string>('jwtSecret')`, bảo đảm cả ký và xác thực token dùng cùng một secret đã validate, và fail-closed nếu key biến mất trong tương lai.
4. `.env.example` đổi sang placeholder rõ ràng `replace-with-a-strong-random-secret`; giá trị này bị validator từ chối nếu dùng nguyên văn.
5. Thêm `apps/api/test/test-env.ts` và `apps/api/test/setup-unit.ts`:
   - luôn thay `JWT_SECRET` kế thừa bằng `TEST_JWT_SECRET` nếu có, nếu không dùng fallback **chỉ dành cho test** đã commit;
   - đặt `NODE_ENV=test`;
   - không bao giờ dùng secret development/production trong test.
6. `vitest.config.ts` nạp `setup-unit.ts`; `setup-e2e.ts` dùng chung logic môi trường và kiểm tra cô lập DB.

### 5.2. P0-A2 — Public Partner projection

1. `PartnersController` giữ `@Public()` nhưng thêm `OptionalJwtAuthGuard` và truyền `@CurrentUser()` vào service. Token ADMIN hợp lệ được nhận diện; token thiếu/sai không làm hỏng route công khai.
2. Thêm `PUBLIC_PARTNER_SELECT` trong `PartnersService`, chỉ chọn:
   `id`, `code`, `name`, `representativeName`, `phone`, `email`, `address`, `status`, `createdAt`, `updatedAt`.
3. `findAll` và `findOne`:
   - nếu viewer là `ADMIN`: đọc bản ghi đầy đủ;
   - ngược lại: dùng `select: PUBLIC_PARTNER_SELECT` ở tầng Prisma, để cột nhạy cảm không được nạp khỏi database.
4. Thêm `PartnerPublicResponseDto` mô tả contract công khai.
5. `update` đọc full pre-image bằng `findUnique` không `select` trước khi ghi audit, tránh làm mất `taxCode`/bank fields trong `beforeJson`.
6. Sửa ba route lồng nhau (`lots`, `seasons`, `traceability`) sang `select` chỉ gồm `id`, `code`, `name`, `representativeName`.

### 5.3. P0-A3 — PERCENT 0–100 và giá không âm

1. Thêm validator `IsValidDiscountValue` tại `apps/api/src/promotions/validators/is-valid-discount-value.validator.ts`:
   - `discountType` phải là `FIXED` hoặc `PERCENT`;
   - `discountValue` phải là number hữu hạn, không phải chuỗi/null/NaN/Infinity;
   - không âm;
   - `PERCENT` không vượt 100.
2. Dùng validator này cho `CreateVoucherDto.discountValue` và `CreateProductDiscountDto.discountValue`; bỏ `@Type(() => Number)` trên trường này để không tự động ép chuỗi thành số.
3. Service `createVoucher` và `createProductDiscount` gọi `validateDiscountValue` trước khi ghi, không tin DTO.
4. Giữ `PATCH` ở dạng status-only. Global `ValidationPipe` có `whitelist: true` và `forbidNonWhitelisted: true`, nên payload chứa `discountValue` bị trả 400.
5. Tập trung hoá phép tính giá:
   - `applyProductDiscount()` dùng chung cho catalog đơn lẻ, catalog batch và checkout;
   - `clampPercent()` đưa percent legacy về [0, 100];
   - `toNonNegativeNumber()`/`toFiniteNumber()` xử lý dữ liệu cũ;
   - giá cuối cùng luôn hữu hạn và không âm với dữ liệu giá gốc hợp lệ.
6. Voucher percent được cap bởi `clampPercent`, `maxDiscount` và subtotal; không tạo discount âm.
7. Flash Sale vẫn dùng `flashPrice`, không dùng percent; FIXED vẫn giữ nghĩa “số tiền cố định” và được cap bởi giá gốc.
8. Không migrate hoặc sửa các bản ghi legacy. Các bản ghi PERCENT > 100 được xử lý phòng thủ tại thời điểm đọc/checkout.

**Ghi chú thiết kế:** một phương án `@ValidateIf` từng được cân nhắc nhưng bị loại bỏ vì `class-validator` bỏ qua **tất cả** validator khác trên cùng property khi điều kiện sai. Điều đó sẽ để lọt `FIXED -5`, `FIXED "abc"`, `FIXED null`. Validator tuỳ biến luôn chạy và kiểm tra đầy đủ mọi ràng buộc.

---

## 6. Danh sách file thay đổi

### 6.1. Source và cấu hình

- `apps/api/.env.example`
- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/auth/jwt.strategy.ts`
- `apps/api/src/config/configuration.ts`
- `apps/api/src/lots/lots.service.ts`
- `apps/api/src/partners/dto/partner.dto.ts`
- `apps/api/src/partners/partners.controller.ts`
- `apps/api/src/partners/partners.service.ts`
- `apps/api/src/promotions/dto/promotion.dto.ts`
- `apps/api/src/promotions/promotions.service.ts`
- `apps/api/src/promotions/validators/is-valid-discount-value.validator.ts` (mới)
- `apps/api/src/seasons/seasons.service.ts`
- `apps/api/src/traceability/traceability.service.ts`
- `apps/api/vitest.config.ts`

### 6.2. Test và test environment

- `apps/api/test/test-env.ts` (mới)
- `apps/api/test/setup-unit.ts` (mới)
- `apps/api/test/setup-e2e.ts`
- `apps/api/test/helpers/e2e-fixtures.ts`
- `apps/api/test/business-rules/jwt-config.spec.ts` (mới)
- `apps/api/test/business-rules/promotion-discount-validation.spec.ts` (mới)
- `apps/api/test/business-rules/partners-public.spec.ts` (mới)
- `apps/api/test/p0-a-security-pricing.e2e-spec.ts` (mới)

Không có thay đổi `schema.prisma`, migration, seed hay dữ liệu lịch sử.

---

## 7. Kết quả kiểm thử sau sửa

Tất cả log nằm trong `.tmp-verify/p0-a/` và đều kết thúc bằng `EXIT_CODE=0`.

### 7.1. Ma trận kiểm thử đầy đủ

| Bộ kiểm tra | Lệnh | Kết quả | Exit code | Log |
|---|---|---|---:|---|
| API typecheck | `npm run typecheck --workspace @agrimarket/api` | PASS | 0 | `typecheck.log` |
| API lint | `npm run lint --workspace @agrimarket/api` | PASS, 3 warning không liên quan | 0 | `lint.log` |
| API unit | `npm run test --workspace @agrimarket/api` | 37 files / 494 tests PASS | 0 | `unit.log` |
| API build | `npm run build --workspace @agrimarket/api` | PASS | 0 | `build.log` |
| API full E2E | `npm run test:e2e --workspace @agrimarket/api` | 17 files / 431 tests PASS | 0 | `e2e.log` |
| Admin Web | `npm run test --workspace @agrimarket/admin-web` | 7 files / 40 tests PASS | 0 | `admin-web.log` |
| Customer Web | `npm run test --workspace @agrimarket/customer-web` | 3 files / 37 tests PASS | 0 | `customer-web.log` |
| Shared domain | `npm run test --workspace @agrimarket/shared-domain` | 5 files / 65 tests PASS | 0 | `shared-domain.log` |

**Lint warning:** 3 warning `require-array-sort-compare` tại `test/concurrency.e2e-spec.ts:394` và `test/warehouse-admin.e2e-spec.ts:271`; không có error và không liên quan P0-A.

### 7.2. Kiểm thử P0-A chuyên biệt

| Bộ kiểm tra | Lệnh | Kết quả | Exit code | Log |
|---|---|---|---:|---|
| P0-A unit | `npx vitest run test/business-rules/jwt-config.spec.ts test/business-rules/promotion-discount-validation.spec.ts test/business-rules/partners-public.spec.ts` | 3 files / 54 tests PASS | 0 | `p0-a-unit.log` |
| P0-A E2E | `npx vitest run --config ./vitest.config.e2e.ts test/p0-a-security-pricing.e2e-spec.ts` | 1 file / 23 tests PASS | 0 | `p0-a-e2e.log` |

Phân bổ 54 test unit P0-A:

- JWT: 16 test — thiếu/rỗng, placeholder, ngắn hơn 32, low-entropy, không lộ secret trong lỗi, factory thật fail-closed, factory dùng secret hợp lệ.
- Promotion: 33 test — DTO, service, các biên 0/50/100, giá trị âm, NaN/Infinity, sai kiểu, legacy 200%, FIXED, voucher cap, status-only update.
- Partner: 5 test — public select, list/detail cho anonymous/customer, full row cho ADMIN, audit pre-image đầy đủ.

Phân bổ 23 test E2E P0-A:

- P0-A1: 6 test — login, token hợp lệ, thiếu token, token bị sửa, token ký bằng secret khác, phân quyền role, route refresh không tồn tại (404).
- P0-A2: 5 test — chi tiết anonymous, list/search của customer, list/detail của ADMIN, audit pre-image, các route lồng nhau.
- P0-A3: 12 test — từ chối PERCENT 101/1000 khi tạo voucher; từ chối 101/-1/`"abc"`/`null` khi tạo product discount; từ chối FIXED `-5`/`"abc"`/`null`; từ chối đổi `discountValue` qua PATCH; chấp nhận 0%; checkout thật với 50%; voucher 100%; legacy PERCENT 200% được clamp và checkout với tổng không âm.

### 7.3. Điểm kiểm thử quan trọng

- Unit test dùng mock Prisma, kiểm tra cả DTO và service boundary.
- E2E dùng HTTP thật, app Nest thật và `TEST_DATABASE_URL` thật; không mock tầng database.
- Test JWT xác minh token bị ký bằng secret khác bị từ chối, không chỉ decode payload.
- Test Partner kiểm tra cả serialized JSON, không chỉ kiểm tra property trực tiếp, để bắt trường hợp lọt qua object lồng nhau.
- Test legacy 200% chỉ inject vào **test database**, không sửa dữ liệu development/production.

---

## 8. Hồi quy Admin/Customer/Shared

| Bộ test | Kết quả | Ghi chú |
|---|---:|---|
| Admin Web | 7 files / 40 tests PASS | Không thay đổi source frontend |
| Customer Web | 3 files / 37 tests PASS | Không thay đổi source frontend |
| Shared domain | 5 files / 65 tests PASS | Không thay đổi domain dùng chung |

- Admin vẫn nhận đầy đủ `taxCode`, `bankAccountName`, `bankAccountNumber`, `bankName` qua token ADMIN; được xác minh ở E2E list và detail.
- Anonymous/customer chỉ nhận projection công khai; được xác minh ở E2E list, detail, search và nested routes.
- Các test frontend là regression suite hiện có, không phải bằng chứng trực tiếp cho projection API. Bằng chứng trực tiếp nằm ở P0-A E2E.
- Không sửa component/UI hay type frontend trong đợt này; các type còn khai báo trường nhạy cảm nhưng UI hiện không render và API công khai không trả các trường đó.

---

## 9. Ảnh hưởng API contract

### 9.1. JWT

- API từ chối khởi động nếu `JWT_SECRET` thiếu, rỗng, là placeholder, ngắn hơn 32 ký tự hoặc low-entropy rõ ràng.
- Ký và xác thực token dùng cùng một key đã validate qua `getOrThrow`.
- Thông báo lỗi cấu hình không chứa giá trị secret.
- Không có refresh token/refresh endpoint trong codebase. `POST /api/v1/auth/refresh` trả 404; đây là hiện trạng được ghi nhận, không phải regression.

### 9.2. Partner

`GET /partners` và `GET /partners/:id` (anonymous hoặc customer) chỉ trả:

```text
id, code, name, representativeName, phone, email, address, status, createdAt, updatedAt
```

Không trả `taxCode`, `bankAccountName`, `bankAccountNumber`, `bankName` — kể cả trong list, detail, search hay nested object.

Với token ADMIN, hai route này vẫn trả đầy đủ bản ghi như trước. Đây là thay đổi có chủ đích: client công khai nào đang dựa vào bank/tax fields sẽ không còn nhận được các fields đó.

Các route lồng nhau chỉ trả partner với:

```text
id, code, name, representativeName
```

Đã rà soát toàn bộ `partner:`/`partner: true` còn lại trong `apps/api/src`: các route còn lại (products, farms, orders, reviews) dùng `select` an toàn; `finance/settlements.service.ts` còn `partner: true` nhưng chỉ nằm sau route ADMIN-only, không phải public leak.

### 9.3. Promotion

- `POST /vouchers` và `POST /product-discounts` trả 400 cho:
  - PERCENT < 0 hoặc > 100;
  - giá trị âm;
  - NaN/Infinity/chuỗi/null/sai kiểu;
  - `discountType` không phải FIXED/PERCENT.
- `FIXED` không bị giới hạn 100; giá trị FIXED lớn được cap bởi giá/subtotal khi tính.
- `PATCH /vouchers/:id`, `/product-discounts/:id`, `/flash-sales/:id` chỉ đổi `status`. Payload chứa `discountValue` bị 400 do `forbidNonWhitelisted`; đã kiểm chứng trên `product-discounts`, cùng cơ chế DTO/global pipe áp dụng cho voucher và flash-sale.
- Giá sản phẩm sau giảm, discount amount và tổng thanh toán không âm với dữ liệu giá gốc hợp lệ.
- Voucher percent được cap bởi subtotal và `maxDiscount`.
- Flash Sale vẫn dùng `flashPrice`, không bị đổi sang percent.

---

## 10. Trạng thái test database

Đã chạy audit **chỉ đọc** bằng `.tmp-verify/p0-a/db-audit.mts`; không migration, không update/delete dữ liệu.

| Môi trường | Host/schema | Voucher PERCENT | Voucher PERCENT không hợp lệ | Product discount PERCENT | Product discount PERCENT không hợp lệ |
|---|---|---:|---:|---:|---:|
| Development | `127.0.0.1/agrimarket_v2` | 0 | 0 | 1 | 0 |
| Test | `127.0.0.1/agrimarket_v2_test` | 0 | 0 | 1 | 0 |

Log: `.tmp-verify/p0-a/db-audit.log` — `EXIT_CODE=0`.

### 10.1. Cô lập test database

- `apps/api/test/test-env.ts` nạp `.env`/`.env.local`, đặt `NODE_ENV=test`, và luôn thay `JWT_SECRET` bằng secret test chuyên dụng.
- `useIsolatedTestDatabase()` kiểm tra `TEST_DATABASE_URL` **trước khi** ghi đè `DATABASE_URL`; nếu test URL trỏ cùng host + schema với app URL, quá trình chạy dừng ngay.
- Khi có `TEST_DATABASE_URL`, setup trỏ `DATABASE_URL` sang test schema. Khi không có, setup xoá `DATABASE_URL` để các suite destructive skip thay vì vô tình chạy trên development.
- Trong lần chạy này, `TEST_DATABASE_URL` được cấu hình và trỏ tới `agrimarket_v2_test`; full E2E đã chạy trên schema này.
- E2E dọn fixture của riêng nó; audit sau cùng ghi nhận 1 bản ghi PERCENT hợp lệ còn lại trong test DB, không có bản ghi bất hợp lệ. Không có thao tác ghi nào được thực hiện trên development database; audit chỉ chạy `SELECT`.

---

## 11. Các vấn đề còn mở và giới hạn

1. **Legacy clamp, không migrate:** các bản ghi PERCENT > 100 (nếu có ở môi trường khác) được xử lý phòng thủ khi đọc/checkout, không bị sửa. Cần chạy lại audit read-only trên từng môi trường trước khi deploy.
2. **Không có refresh/revocation/rotation:** codebase chỉ phát một access token; không có refresh token hay cơ chế thu hồi. Đây là giới hạn hiện hữu, ngoài phạm vi P0-A.
3. **Entropy guard mang tính phòng thủ:** kiểm tra tối thiểu 8 ký tự khác nhau chỉ chặn các trường hợp yếu rõ ràng; không thay thế một công cụ đo entropy chuyên dụng.
4. **Test secret:** `TEST_JWT_SECRET` không có trong `.env` local; test dùng fallback không dùng cho production. CI nên đặt `TEST_JWT_SECRET` riêng nếu muốn.
5. **Frontend types:** Admin/Customer types vẫn khai báo các trường nhạy cảm; UI hiện không render chúng. Không thay đổi frontend trong phạm vi P0-A.
6. **Finance settlement detail** còn dùng `partner: true` trong `settlements.service.ts`, nhưng route này là ADMIN-only (`FinanceController`), không phải public leak. Không thay đổi vì ngoài phạm vi P0-A2.
7. **Chưa kiểm thử production:** toàn bộ kết quả là local; chưa có load test, penetration test, secret scanning hay kiểm thử trên hạ tầng thật.
8. **Chưa production-ready:** còn các P1/P2 trong Report 14; báo cáo này chỉ xác nhận ba nhóm P0-A.
9. **E2E cần test DB:** nếu `TEST_DATABASE_URL` không được cấu hình, các suite destructive sẽ skip; CI phải bảo đảm biến này tồn tại và trỏ đúng schema cô lập.

---

## 12. Điều kiện nghiệm thu

- [x] Không còn fallback `CHANGE_ME` có thể thực thi trong `apps/api/src` (chỉ còn trong comment và giá trị test cố ý).
- [x] Thiếu/rỗng/placeholder/ngắn hơn 32 ký tự/low-entropy rõ ràng → resolver và configuration factory từ chối.
- [x] Secret hợp lệ → configuration factory chấp nhận; ứng dụng E2E khởi động và đăng nhập được.
- [x] Login, xác thực token, từ chối token sai secret, phân quyền role → PASS.
- [x] Không có refresh endpoint; route refresh trả 404 và được ghi nhận là N/A.
- [x] Public partner list/detail/search không trả `taxCode`/bank fields.
- [x] Nested lots/seasons/traceability không trả bank/tax fields.
- [x] ADMIN vẫn nhận đầy đủ dữ liệu Partner.
- [x] Audit update Partner giữ full pre-image.
- [x] PERCENT 0–100 được validate ở DTO và service; âm, >100, NaN, Infinity, sai kiểu bị từ chối.
- [x] PATCH khuyến mãi chỉ đổi status; gửi `discountValue` qua PATCH bị 400.
- [x] Giá sau giảm và tổng thanh toán không âm; kiểm tra 0%, 50%, 100% và legacy 200%.
- [x] FIXED, Flash Sale và voucher không bị đổi semantics; các test hiện có PASS.
- [x] API typecheck/lint/unit/build/full E2E PASS.
- [x] Admin Web, Customer Web, Shared domain PASS.
- [x] DB audit read-only: không có bản ghi PERCENT bất hợp lệ trong dev/test.
- [x] Không migration, không sửa dữ liệu lịch sử, không commit/push/merge/deploy.
- [ ] Production readiness đầy đủ — **không** nằm trong phạm vi và **không** được tuyên bố.

---

## 13. Kết luận

Ba nhóm P0-A đạt **VERIFIED FIXED** trong phạm vi đã nêu, dựa trên:

- mã nguồn sau sửa với fail-closed JWT, public Partner projection và validate/clamp khuyến mãi;
- 54 test unit P0-A và 23 test E2E P0-A;
- full suite API 494 unit + 431 E2E, cùng 40 Admin Web, 37 Customer Web và 65 Shared domain tests;
- audit database read-only xác nhận không có bản ghi PERCENT bất hợp lệ;
- log và exit code thực tế trong `.tmp-verify/p0-a/`.

**Kết luận:** đủ điều kiện để tạo một commit P0-A riêng cho ba nhóm trên, nhưng **không** tuyên bố production-ready và **không** thực hiện commit/push/merge/deploy trong đợt này. Các vấn đề P1/P2 còn lại tiếp tục được theo dõi theo Report 14.
