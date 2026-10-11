# AGRIMARKET V2 — AUTH UX / REGISTRATION VALIDATION / MOBILE ACCOUNT UI FIX

**Repo:** `E:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc`
**Branch:** `main` · **HEAD:** `4b14267` (không đổi) · **Ngày:** 2026-10-10
**Phạm vi:** `apps/mobile` (Expo Go + Expo Router) + `apps/customer-web` (Next.js) + `apps/api` (NestJS).
Chỉ sửa luồng tài khoản khách & hiển thị; **không** làm lại app, **không** thêm chức năng ngoài phạm vi,
**không** build APK/EAS, giữ Expo Go.

> **Trạng thái nghiệm thu trên điện thoại thật (Expo Go): NOT TESTED.**
> Không có điều khiển thiết bị. Mọi kết luận về *hiển thị/cảm ứng trên máy thật* trong tài liệu này
> đều ở mức **chưa xác minh**. Đã xác minh: typecheck, lint, unit test, **e2e trên DB thật**, và
> **Metro bundle thành công toàn bộ app (1004 modules)**. Xem §H.

---

## 0. Tóm tắt kết quả

| # | Hạng mục | Trạng thái | Bằng chứng |
|---|----------|-----------|-----------|
| 1 | Lỗi đăng ký: họ tên 1 ký tự bị gửi lên & báo lỗi chung | **FIXED** | §A — mobile chặn cục bộ, e2e 400 đúng message |
| 2 | Thống nhất validation Backend ↔ Web ↔ Mobile | **DONE** | §B — `validation.ts` + `phone.ts` mirror DTO |
| 3 | Map lỗi Backend (mảng/400/409) về từng trường | **DONE** | §C — 409 "Email đã đăng ký" → ô Email |
| 4 | Chuẩn hóaa UI đăng ký (bỏ card/intro, lỗi theo ô, focus/Next, ẩn/hiện MK) | **DONE** | §D |
| 5 | Luồng đăng ký → đăng nhập → tài khoản (điền sẵn email, redirect Account) | **DONE** | §E — e2e register→login→me |
| 6 | Màn Tài khoản chưa đăng nhập (bỏ khoảng trắng, bỏ nút thứ 3, gọn) | **DONE** | §F |
| 7 | Màn Tài khoản sau đăng nhập (đủ mục backend thật, không menu chết) | **VERIFIED** | §G |
| 8 | Test mobile + API + e2e | **PASS** | §H — mobile 108, API unit 333, e2e 295 |
| 9 | Không ảnh hưởng checkout / địa chỉ 104 xã-phường | **VERIFIED** | §H — address-auth e2e PASS |

**Kết luận:** lỗi gốc đã sửa tại đúng nơi (client), validation đã thống nhất 3 phía, luồng
đăng ký→đăng nhập chạy thật trên DB. **Không** commit/push, **không** reset/reseed DEV, **không** build
APK/EAS, **không** đổi quy tắc Backend để "cho qua" dữ liệu sai.

---

## A. Lỗi gốc (root cause)

**Triệu chứng đúng như báo cáo:** nhập họ tên 1 ký tự, các trường còn lại hợp lệ → Mobile **gửi request**,
Backend trả `400` và Mobile chỉ hiển thị *"Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại."*

**Nguyên nhân gốc — 2 lỗi riêng biệt:**

1. **Client kiểm tra quá lỏng.** `apps/mobile/app/register.tsx` (cũ) chỉ kiểm tra
   `if (!fullName.trim() …)` — tức **chỉ cần khác rỗng**. Trong khi backend `RegisterDto`
   (`apps/api/src/auth/dto/account.dto.ts`) có `@MinLength(2)` trên `fullName`. Nên họ tên 1 ký tự
   **qua** được kiểm tra phía Mobile và bị gửi lên server.

2. **Không map lỗi backend về đúng trường.** Backend trả `message: ["Vui lòng nhập họ và tên"]`
   (mảng). `extractMessage` trong `apps/mobile/src/lib/api-client.ts` chỉ nhận diện message **đã biết**
   trong `messages.ts`; chuỗi validation của DTO không có trong bảng dịch nên rơi về
   `fallbackMessage(400)` = câu chung *"Dữ liệu chưa hợp lệ…"*. Vì vậy dù backend đã chỉ đúng field,
   UI vẫn hiện lỗi chung.

**Cách sửa (đúng nguyên nhân, không sửa Backend để "cho qua"):**
- Thêm `apps/mobile/src/lib/validation.ts` **mirror đúng** các ràng buộc của `RegisterDto` +
  `phone.util.ts`, validate **cục bộ trước khi gửi**, hiển thị lỗi **ngay dưới từng ô**.
- Thêm `mapRegisterFieldErrors()` để khi backend vẫn trả về (do race 409, hoặc luật chỉ có ở server)
  thì message được **map về đúng trường**; chỉ khi **không** map được trường nào mới hiện lỗi cấp form.

---

## B. Thống nhất quy tắc validation (Backend ↔ Web ↔ Mobile)

Backend là nguồn duy nhất (`account.dto.ts`). Hai client giờ **mirror** đúng bộ quy tắc đó:

| Trường | Quy tắc Backend (nguồn) | Mobile `validation.ts` | Web `RegisterForm.tsx` |
|--------|------------------------|------------------------|------------------------|
| Họ tên | `@MinLength(2)` sau `trim`, `@MaxLength(120)` | `validateFullName` (trim, 2..120) | `z.string().trim().min(2)` |
| Email | `@IsEmail` + `@MaxLength(180)` | `validateEmail` (regex + max 180) | `z.string().email()` |
| Số điện thoại | `normalizeVietnamesePhone` (VN mobile) | `validatePhone` (port `phone.util.ts`) | `isValidVietnamesePhone` (port `phone.ts`) |
| Mật khẩu | `@MinLength(10)` `@MaxLength(72)` `@Matches` (chữ+số) | `validatePassword` | `PASSWORD_POLICY` (đã có sẵn) |
| Xác nhận MK | — (chỉ client) | `validateConfirmPassword` | `.refine(...)` |

- `apps/mobile/src/lib/validation.ts` — **mới**, là bản port thuần của luật backend (không phụ thuộc React Native nên unit-test được).
- `apps/customer-web/src/lib/phone.ts` — **mới**, port `normalizeVietnamesePhone`/`isValidVietnamesePhone` để Web dừng chấp nhận SĐT sai định dạng (trước đây Web chỉ kiểm tra độ dài 8–20).
- Thông điệp lỗi hiển thị **đúng như yêu cầu**:
  - Họ và tên: *"Vui lòng nhập họ tên từ 2 ký tự."*
  - Email: *"Email chưa hợp lệ."*
  - Số điện thoại: *"Số điện thoại chưa hợp lệ."*
  - Mật khẩu: *"Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số."*
  - Xác nhận: *"Mật khẩu nhập lại không khớp."*

---

## C. Map lỗi Backend về đúng trường (400 mảng / 409 / mạng / server)

`mapRegisterFieldErrors(message)` trong `validation.ts` nhận `body.message` (kiểu `string | string[]`
— đúng shape `AllExceptionsFilter` + `ValidationPipe` trả về) và:

- **Message nghiệp vụ tiếng Việt đã biết** → map nguyên văn về đúng trường:
  `"Vui lòng nhập họ và tên"` → fullName; `"Email chưa hợp lệ"`/`"Email này đã được đăng ký"` → email;
  `"Số điện thoại chưa hợp lệ"` → phone; `"Mật khẩu …"` → password.
- **Message mặc định tiếng Anh của class-validator** (có tiền tố tên property: `email must …`,
  `password must …`) → map theo property, **nhưng không hiển thị chữ Anh** — thay bằng câu Việt của ô.
- **Không map được** (ví dụ `role: "ADMIN"` bị `forbidNonWhitelisted` chặn → `"property role should not exist"`,
  hoặc lỗi 500) → **không** gán vào ô nào; trả về `formError` để hiện **một** banner cấp form.

Nhờ vậy:
- **Không** hiện lỗi chung khi đã xác định được trường sai (nếu map được field → `formError = null`).
- **Không** lọt thông tin nội bộ (Prisma/SQL/JWT/stack) ra UI: chỉ message nghiệp vụ đã biết được hiển thị;
  `api-client.ts` vẫn giữ lớp `sanitize` chặn `prisma|sql|stack|…` như cũ.
- **Lỗi mạng** (`isNetworkError`, `status === 0`): hiện 1 thông báo kết nối, **giữ nguyên toàn bộ dữ liệu đã nhập**
  (state không bị xóa), không gán lỗi vào ô.

---

## D. Chuẩn hóaa UI màn Đăng ký (`apps/mobile/app/register.tsx`)

Viết lại theo mục tiêu "giống app TMĐT thật, gọn":

- **Bỏ** đoạn giới thiệu dài ở đầu; **bỏ** card viền (nền trắng toàn màn `colors.surface`).
- Header điều hướng vẫn là **"Đăng ký tài khoản"** (khai báo sẵn ở `app/_layout.tsx`); trong form có tiêu đề
  **"Tạo tài khoản"** + 1 dòng phụ ngắn.
- 5 trường: Họ và tên · Email · Số điện thoại · Mật khẩu · Nhập lại mật khẩu.
- Nút chính **"Đăng ký"** (có loading, chặn nhấn nhiều lần qua `busy`).
- Liên kết **"Đã có tài khoản? Đăng nhập"**.
- **Lỗi hiển thị ngay dưới từng ô** (icon + chữ đỏ), viền ô đỏ khi sai; gõ lại thì xó lỗi của ô đó.
- **Tự focus vào ô đầu tiên bị sai** sau khi bấm Đăng ký (`firstInvalidField` + `useRef` từng `TextInput`).
- **Next chuyển trường** hợp lý (`returnKeyType="next"` + `onSubmitEditing` → focus ô kế); ô cuối `returnKeyType="go"` → submit.
- **Nút hiện/ẩn mật khẩu** hoạt động (đặt ở cả 2 ô mật khẩu); placeholder **không** dùng dãy `••••` giống mật khẩu thật.
- **Keyboard avoiding** + **scroll** khi bàn phím mở (`KeyboardAvoidingView` + `ScrollView`,
  `keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`).
- Không log password/token; mật khẩu mặc định bị ẩn (`secureTextEntry`).

---

## E. Luồng Đăng ký → Đăng nhập → Tài khoản

- Sau `POST /auth/register` **thành công (201)** → màn *"Đã tạo tài khoản"* với nút **"Đăng nhập ngay"**.
  Backend **không** phát hành phiên ở bước đăng ký (theo thiết kế), nên **không** tự coi là đã đăng nhập.
- "Đăng nhập ngay" → `router.replace({ pathname: "/login", params: { email, redirect: "/(tabs)/account" } })`:
  - Màn đăng nhập **điền sẵn email** (`login.tsx` đọc `?email=`).
  - Sau `POST /auth/login` (200) → lưu phiên bằng **SecureStore** (`providers.tsx` → `setSession`), rồi
    `router.replace(redirect)` → **về tab Tài khoản**; `GET /auth/me` xác minh và hiển thị đúng thông tin khách.
- **Trường hợp response đăng ký bị mất** rồi gửi lại gặp email trùng: backend trả **409**
  `"Email này đã được đăng ký"` → `mapRegisterFieldErrors` map về **ô Email**, **không** mất dữ liệu đã nhập,
  **không** báo thành công giả.
- Đăng xuất/đăng nhập tài khoản khác: `login`/`logout` đều `client.clear()` (xoá cache react-query) →
  **không lẫn** dữ liệu giữa 2 khách (đã có unit/e2e phủ §H).
- Không hiện "Chưa đăng nhập" khi token hợp lệ: `account.tsx` chỉ rơi về guest **sau khi** `hydrated === true`
  (đang tải thì hiện `LoadingView`).

---

## F. Màn Tài khoản chưa đăng nhập (`apps/mobile/app/(tabs)/account.tsx`)

Trước: căn giữa theo chiều dọc, nhiều khoảng trắng trên/dưới, đoạn giải thích dài, 3 nút (có nút "Xem sản phẩm").
Sau: bố cục **gọn, nội dung ở vùng trên** (`ScrollView` + `guestContent`, không kéo giãn để căn giữa):

```
[icon tài khoản nhỏ]
Chào mừng đến AgriMarket
Đăng nhập để quản lý đơn hàng và địa chỉ giao hàng.
[ Đăng nhập ]            ← primary
[ Đăng ký tài khoản ]    ← ghost
```

- **Bỏ** nút "Xem sản phẩm" thứ 3 (đã có tab Sản phẩm).
- **Bỏ** thông điệp dài về truy xuất nguồn gốc/đặt hàng.
- Giữ **bottom tabs**; **không** thêm banner/gradient/hình AI/icon trang trí.

---

## G. Màn Tài khoản sau đăng nhập — đối chiếu yêu cầu

Hiển thị & điều hướng đã kiểm tra trong `account.tsx`:

| Yêu cầu | Mục trong app | Trạng thái |
|---------|---------------|-----------|
| Họ tên | avatar + `user.fullName` | ✅ |
| Email | `user.email` | ✅ |
| Số điện thoại | `user.phone` | ✅ |
| Thông tin cá nhân | card "Thông tin cá nhân" (Sửa thông tin → `PATCH /customers/me`) | ✅ backend thật |
| Sổ địa chỉ | "Địa chỉ giao hàng" → `/addresses` | ✅ backend thật |
| Đơn hàng | "Đơn hàng của tôi" → `/orders` | ✅ backend thật |
| Đổi mật khẩu | "Đổi mật khẩu" → `/change-password` | ✅ backend thật |
| Quên mật khẩu | ở màn `/login` ("Quên mật khẩu?") | ✅ backend thật |
| Đăng xuất | nút Đăng xuất (đỏ) → `logout()` | ✅ |

- **Không** có menu Admin; các mục phụ (Trả hàng, Đánh giá, Mã giảm giá, Khiếu nại, Trang trại) đều có
  endpoint thật (`resources.ts`) — **không** có menu chết. Mục "Sản phẩm yêu thích"/"Điểm thưởng" **không**
  hiển thị (không có backend), phần chú thích cuối đã nói rõ lý do.
- **Không** hiển thị mật khẩu ở bất kỳ đâu.

---


## H. Kiểm thử đã chạy & kết quả API thật

Lệnh & kết quả (chạy thật, không giả lập):

| Hạng mục | Lệnh | Kết quả |
|----------|------|---------|
| Mobile typecheck | `apps/mobile: pnpm typecheck` | **PASS** (exit 0) |
| Mobile lint | `apps/mobile: pnpm lint` | **PASS** (0 error/warning) |
| Mobile unit test | `apps/mobile: pnpm test` | **108 PASS** (12 file; +26 test mới cho `validation.ts`) |
| API typecheck | `apps/api: pnpm typecheck` | **PASS** |
| API lint | `apps/api: pnpm lint` | **PASS** (exit 0; chỉ còn warning có từ trước ở file khác) |
| API unit test | `apps/api: pnpm test` | **333 PASS** (27 file — không đổi so với baseline) |
| API e2e (DB thật) | `apps/api: pnpm test:e2e` | **295 PASS** (10 file) |
| Customer Web typecheck | `apps/customer-web: pnpm typecheck` | **PASS** |
| Customer Web lint | `apps/customer-web: pnpm lint` | **PASS** (exit 0) |
| Metro bundle | `apps/mobile: npx expo export --platform web` | **PASS** (1004 modules, exit 0) |

### H1. Ma trận kiểm thử (theo yêu cầu §6)

| Kịch bản | Ở đâu | Kết quả |
|----------|-------|---------|
| Họ tên 1 ký tự bị chặn + đúng lỗi | mobile unit `validation.test.ts` + e2e `register-login-validation` | ✅ chặn cục bộ; e2e 400 `"Vui lòng nhập họ và tên"` |
| Họ tên hợp lệ đăng ký thành công | e2e B.2 | ✅ 201, ACTIVE CUSTOMER + profile, không phát hành token |
| Email sai | mobile unit + e2e B.1 | ✅ |
| Email trùng | e2e B.2 (409) | ✅ `"Email này đã được đăng ký"`, chỉ 1 tài khoản |
| Số điện thoại sai | mobile unit + e2e B.1 | ✅ `"Số điện thoại chưa hợp lệ"` |
| Mật khẩu ngắn | mobile unit + e2e B.1 | ✅ |
| Thiếu chữ/số | mobile unit + e2e B.1 | ✅ |
| Mật khẩu xác nhận không khớp | mobile unit | ✅ |
| Gửi đăng ký 2 lần nhanh | e2e B.6 (Promise.all) | ✅ đúng 1×201 + 1×409, đúng 1 tài khoản |
| Đăng ký khi mạng lỗi | mobile `register.tsx` (nhánh `isNetworkError`) | ✅ giữ dữ liệu, 1 thông báo (logic; xem §H2) |
| Đăng ký role ADMIN bị từ chối | e2e B.1 | ✅ 400, không tạo tài khoản |
| Đăng ký thành công rồi đăng nhập | e2e B.3 | ✅ 201 → login 200 → `/auth/me` 200 |
| Đăng nhập sai mật khẩu | e2e B.3 | ✅ 401, không lộ token/hash |
| Đăng nhập đúng mật khẩu | e2e B.3 + B.4 | ✅ |
| Lưu phiên / đóng-mở app | mobile `session.test.ts` (SecureStore + fallback web) | ✅ |
| Web & Mobile dùng chung tài khoản | e2e B.4 (`/auth/me` dùng chung) | ✅ |
| Không lẫn cache 2 khách | e2e B.5 + `providers` (`client.clear()`) | ✅ |
| Không rò rỉ mật khẩu trong log | e2e B.7 (không lưu plaintext) + code không log | ✅ |

**DB:** e2e chỉ ghi vào `TEST_DATABASE_URL` (`agrimarket_v2_test`), mọi row tạo ra đều được dọn ở
`afterAll` (kèm `purgeStaleFixtures` phòng run bị ngắt). **Không** reseed/reset DB DEV.

### H2. Chưa kiểm thử trên điện thoại thật (NOT TESTED)

- Cảm giác thao tác thực tế trên Expo Go (bàn phím ẩn/hiện, focus có nhảy đúng ô, vùng chạm, khoảng cách).
- Mạng lỗi thật (tắt Wi-Fi / sai địa chỉ LAN) — logic đã có và có unit cho phần message, nhưng **chưa** chạy
  trên thiết bị.
- Ảnh chụp 3 màn (đăng ký / tài khoản guest / tài khoản đã đăng nhập) trước-sau trên máy thật.

---

## I. Danh sách file đã sửa/tạo

**Tạo mới:**
- `apps/mobile/src/lib/validation.ts` — validation mirror backend + map lỗi về trường.
- `apps/mobile/src/lib/__tests__/validation.test.ts` — 26 unit test.
- `apps/customer-web/src/lib/phone.ts` — port luật SĐT VN.
- `apps/api/test/register-login-validation.e2e-spec.ts` — 14 e2e (DB thật).
- `docs/AGRIMARKET-V2-AUTH-UI-FIX.md` — báo cáo này.

**Sửa:**
- `apps/mobile/app/register.tsx` — validate cục bộ theo ô, focus/Next, UI gọn, map lỗi backend, redirect Account.
- `apps/mobile/app/(tabs)/account.tsx` — bố cục guest gọn (bỏ nút "Xem sản phẩm", bỏ đoạn dài).
- `apps/customer-web/src/components/auth/RegisterForm.tsx` — SĐT theo luật VN + map 409/400 về ô Email.

**Không đổi (đã đọc để đối chiếu hợp đồng):**
- `apps/api/src/auth/dto/account.dto.ts`, `auth.service.ts`, `auth.controller.ts`, `common/filters/all-exceptions.filter.ts`,
  `common/utils/phone.util.ts`, `apps/mobile/src/lib/api-client.ts`, `messages.ts`, `providers.tsx`, `login.tsx` (đã hỗ trợ sẵn `redirect`).

---

## J. Cam kết an toàn source

- **Không** tạo lại Mobile; **không** reset/reseed DEV; **không** xó file chưa commit.
- **Không** viết lại Auth Module rộng; **không** đổi UI framework; **không** build APK/AAB; **không** EAS; **không** buộc USB/ADB.
- **Không** tự commit/push.
- **Bảo toàn** chức năng địa chỉ 104 xã/phường Hưng Yên: e2e `address-auth.e2e-spec.ts` vẫn **PASS** trong
  `pnpm test:e2e` (295/295), checkout & địa chỉ **không** bị ảnh hưởng.
- **Không** thay đổi quy tắc Backend để cho phép dữ liệu sai — mọi sửa đều làm client khớp backend.

