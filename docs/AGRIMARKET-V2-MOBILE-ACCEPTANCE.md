# AGRIMARKET V2 — MOBILE ACCEPTANCE (Expo Go only + API thật + TEST DB)

**Ngày:** 2026-10-10 (phiên nghiệm thu mới, tiếp nối `ses_edc7d4cedffeTjzWTjOjrHM4tQ`). **Repo:**
`E:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc`,
branch `main`, HEAD `4b14267`. **Thư mục Mobile:** `apps/mobile` (untracked, giữ nguyên từ phiên trước).
Không commit, không push, không reset/reseed DEV, không APK/EAS, không phát hành.

Phiên trước là baseline; mọi con số dưới đây được **chạy lại trong phiên này**,
không kế thừa PASS cũ. **Phiên này không sửa source** (source đã hoàn thiện từ
phiên trước, kiểm tra lại toàn diện vẫn đạt) — chỉ chạy lại toàn bộ kiểm thử và
cập nhật báo cáo với bằng chứng mới.

## A. Source

- Phiên này: **không sửa, không thêm, không xóa file source nào** — kiểm tra lại
  toàn bộ `apps/mobile` (23 routes, config, QR parser, checkout, auth) vẫn đúng
  yêu cầu nên giữ nguyên. `git status -- apps/mobile` chỉ còn `??` (untracked),
  không có `M` (không ghi đè gì).
- File đã có từ phiên trước, giữ nguyên và đã kiểm chứng lại trong phiên này:
  `apps/mobile/src/lib/trace-code.ts` (QR parser),
  `apps/mobile/src/lib/__tests__/trace-code.test.ts` (6 tests),
  `apps/mobile/src/components/ApiConfigNotice.tsx`, `apps/mobile/.env`
  (local, git-ignored, IP LAN hiện tại).
- Đã xóa từ phiên trước (giữ nguyên): `apps/mobile/eas.json`.
- File sửa (chỉ trong `apps/mobile`, không đụng Backend/Admin/Customer Web):
  - `src/lib/config.ts` — bỏ IP LAN hardcode, không fallback ngầm; thêm
    `isApiConfigured()`/`apiConfigNotice()`; thiếu `.env` thì UI báo rõ.
  - `src/lib/api-client.ts` — `buildUrl()` ném lỗi hướng dẫn cấu hình khi base rỗng.
  - `src/lib/resources.ts` — `getTrace()` không uppercase mù quáng (caller chuẩn hóa).
  - `app/scan.tsx` — dùng parser; QR không hợp lệ → báo lỗi + quét lại, không điều hướng.
  - `app/(tabs)/trace.tsx`, `app/trace/[code].tsx` — validate qua parser, báo mã không hợp lệ.
  - `app/(tabs)/catalog.tsx` — `useInfiniteQuery` (Xem thêm **dồn** trang, không thay thế);
    đồng bộ search/category khi đến từ Home; ghi rõ sort chỉ trong SP đã tải; pull-to-refresh.
  - `app/(tabs)/index.tsx` — ô tìm kiếm + nút Tìm (thay Link bọc TextInput);
    thêm “Xem tất cả” (sản phẩm, trang trại); pull-to-refresh; banner cấu hình API.
  - `app/product/[id].tsx` — chặn mua quy cách INACTIVE + hết hàng; hiện giá gốc gạch ngang
    khi giảm; xóa export chết `OrderStatusForTest`; login giữ `redirect`.
  - `app/checkout.tsx` — phân biệt Mua ngay không hợp lệ vs giỏ trống; login giữ redirect
    (kèm `buyNow`); còn lại giữ nguyên: preview backend, `expectedGrandTotal`,
    1 `Idempotency-Key`/payload, 409 → preview mới + xác nhận lại, chống double-tap.
  - `app/login.tsx` — hỗ trợ `redirect`, chỉ cho path nội bộ (`/`…), mặc định về tabs.
  - `cart/orders/order[id]/addresses/returns/complaints/my-reviews/return[id]/complaint[id]` —
    login mang `redirect` về đúng màn hình trước đó.
  - `app/_layout.tsx` — thêm `<ApiConfigNotice />` dưới `<OfflineBanner />`.
  - `package.json` — xóa script `android` (`expo run:android`, bị cấm).
  - `app.json` — bỏ `versionCode`, `usesCleartextTraffic` (chỉ phục vụ APK build);
    giữ `package`, icon/splash/adaptive-icon (định danh dự án, vô hại với Expo Go).
  - `.env.example`, `README.md` — placeholder `YOUR_PC_LAN_IP`, **xóa toàn bộ mục APK/EAS**;
    chỉ còn hướng dẫn Expo Go; ghi rõ sort catalog và QR parser.
  - Tests: fixture IP đổi sang `192.168.1.10` chung chung; thêm test `isApiConfigured`.
- Backend/Admin/Customer Web: **không sửa file nào** (xác minh `git status`: các `M`
  ở `apps/api`, `apps/admin-web` là di sản từ phiên trước, nguyên vẹn).
- Git cuối phiên: `M package.json` (1 dòng `dev:mobile` từ phiên trước),
  `?? apps/mobile/`, `?? docs/AGRIMARKET-V2-MOBILE-ACCEPTANCE.md` (ghi đè bản cũ).
  Không commit/push.

## B. Ma trận tính năng

`Màn hình | Chức năng | API | Kiểm thử logic | Kiểm thử Android | Kết quả`

| Màn hình | Chức năng | API | Kiểm thử logic | Kiểm thử Android | Kết quả |
|---|---|---|---|---|---|
| Tabs Home | Danh mục, tìm kiếm (nút Tìm), Flash Sale đang hiệu lực, farms, trace CTA, refresh, banner cấu hình | `GET /categories /products /flash-sales /farms` | 14/14 read-only PASS | NOT TESTED (chờ thiết bị, §F) | PARTIAL |
| Catalog | Lọc danh mục, tìm kiếm, sort trang đã tải (ghi rõ phạm vi), dồn trang, refresh | `GET /products` | PASS (logic + `useInfiniteQuery`) | NOT TESTED | PARTIAL |
| Product detail | Quy cách (chặn INACTIVE/hết hàng), giá `effectivePrice` + giá gốc, tồn kho, thêm giỏ, Mua ngay đúng variant/qty, đánh giá | `GET /products/:id`, `/reviews/product/:id`, cart | PASS | NOT TESTED | PARTIAL |
| Trace + Scan | Nhập mã (validate), quét QR (`expo-camera`) → parse URL/bare-code | `GET /trace/:code`, `GET /lots` | 31/31 unit (parser 6) + integration trace `TRC-000019-BAPCA` PASS | NOT TESTED (camera) | PARTIAL |
| Cart | Thêm/sửa/xóa, tổng từ preview backend | `/carts/me*`, `checkout-preview` | **27/27 TEST PASS** | NOT TESTED | PARTIAL |
| Checkout | Địa chỉ, voucher, COD, `expectedGrandTotal`, `Idempotency-Key`/payload, 409 → xác nhận lại, chống double-tap, buyNow sai → lỗi rõ | `checkout-preview`, `checkout` | **27/27 TEST PASS** | NOT TESTED | PARTIAL |
| Orders | Lọc trạng thái, chi tiết, snapshot giá, allocation→trace đúng lô, shipment events | `/orders/me*` | PASS | NOT TESTED | PARTIAL |
| Cancel | Theo đúng máy trạng thái backend (kể cả SHIPPING→CANCELLED); double-cancel/DELIVERED → 400 | `POST /orders/me/:id/cancel` | **27/27 TEST PASS** | NOT TESTED | PARTIAL |
| Addresses | CRUD + mặc định, đúng fields V2, không postcode giả | `/customers/me/addresses*` | **27/27 TEST PASS** | NOT TESTED | PARTIAL |
| Returns | Tạo (DELIVERED), theo dõi, hoàn tiền do backend xác nhận | `POST /returns`, `/returns/me*` | **27/27 TEST PASS** (id 263) | NOT TESTED | PARTIAL |
| Complaints | Tạo theo đơn mình, theo dõi resolution | `/complaints*` | **27/27 TEST PASS** (id 227) | NOT TESTED | PARTIAL |
| Reviews | Tạo khi đủ điều kiện, chỉ hiện duyệt ở trang công khai | `POST /reviews`, `/reviews/me`, `/reviews/product/:id` | PASS (already-reviewed = rule proven) | NOT TESTED | PARTIAL |
| Vouchers | Xem + áp ở checkout (min/limit do backend) | `GET /vouchers` | PASS + voucher lạ → 404 đúng | NOT TESTED | PARTIAL |
| Account | Sửa profile (`PATCH /customers/me`), đăng xuất xóa cache, chặn ADMIN, login redirect | `/auth/me`, `/customers/me` | **27/27 TEST PASS** | NOT TESTED | PARTIAL |
| Đăng ký / đổi MK / quên MK | — | **không có endpoint** | — | — | BLOCKED (backend) |
| Yêu thích / follow farm / điểm | — | **không có endpoint** | — | — | BLOCKED (ngoài scope V2) |
| VNPay sandbox | — | không có gateway flow | — | — | BLOCKED (chỉ COD) |

Không PASS khi chỉ có UI: mọi PASS đều đi kèm assertion trên API.

## C. Kết quả nghiệp vụ (chạy lại)

- Read-only DEV (`:3000`): categories, products (5), product detail, farms,
  trace `TRC-000019-BAPCA`, vouchers, flash-sales, login CUSTOMER
  (`lan.nguyen@agrimarket.vn`), me, cart, addresses, orders, checkout-preview
  (`grandTotal=32000`), unknown-status → 400: **14/14 PASS**, không ghi DEV.
- Write-flow TEST (`:3100`, DB `agrimarket_v2_test`): địa chỉ CRUD + restore,
  profile update/restore, cart add→verify→update, preview `56000`, COD
  `ORD-20261010-0486` khớp preview, replay cùng key+payload → cùng đơn, cùng key
  khác payload → 409, sai tổng → 409, admin thấy đơn, hủy + hủy lặp 400 + hủy
  DELIVERED 400, return 264, complaint 228, review rule, voucher lạ 404, dọn cart,
  orders delta +1: **27/27 PASS** (chạy lại phiên này; TEST API `:3100` dựng từ
  `dist` hiện có, chạy xong dừng và dọn tiến trình).

## D. Kết quả test (số thật, phiên này)

| Test | Lệnh | Kết quả |
|---|---|---|
| Typecheck (mobile) | `npm run typecheck --workspace @agrimarket/mobile` | PASS exit 0 |
| Lint (mobile) | `npm run lint --workspace @agrimarket/mobile` | PASS 0 error 0 warning |
| Unit | `npm run test --workspace @agrimarket/mobile` | **31/31 (7 files)** |
| API integration read-only (DEV) | `... test:integration` (+customer creds) | **14/14** |
| Write-flow (TEST `:3100`) | `... test:write` | **27/27** |
| Metro bundle | `expo export --platform android` (bundle check, KHÔNG phải bằng chứng chạy máy) | PASS |
| Web export | `expo export --platform web` — phát hiện thiếu `react-native-web` khi mở web trên Metro, đã `expo install react-native-web@0.21.4` (tương thích SDK 57, chỉ phục vụ web, không ảnh hưởng Expo Go); sau đó Metro báo lệch `react` 19.2.3 vs `react-dom` 19.3.0 (transitive) nên đã ghim `react-dom@19.2.3` khớp `react`; export lại PASS | PASS |
| `expo install --check` | — | up to date |
| Expo dev server `--lan` | `npm run dev:lan` (Metro `:8081` boot OK, probe 35s rồi dọn cổng để user chạy foreground lấy QR) | BOOT |
| Android runtime / camera / UI cầm-tay | — | NOT TESTED (không thiết bị trong môi trường AI) |

TEST residue (by design, TEST là DB scratch): order CANCELLED `ORD-20261010-0486`,
return 264, complaint 228; cart/profile/addresses đã dọn. DEV: chỉ đọc, không ghi.

## E. Expo Go (thay toàn bộ mục APK cũ — dự án KHÔNG làm APK)

- Chạy duy nhất bằng Expo Managed + Expo Go, không EAS/prebuild/native module mới.
- `apps/mobile/.env` (git-ignored) = nguồn cấu hình duy nhất, IP LAN thực tế
  `192.168.100.155` **xác minh lại bằng `ipconfig` trong phiên này (không đổi)**.
- API `:3000` lắng nghe `::` (mọi interface) và health 200; LAN
  `http://192.168.100.155:3000/api/v1/categories?limit=1` trả 200 từ chính máy.
- **Cảnh báo mạng (P1 handoff, vẫn còn trong phiên này):** Wi-Fi đang ở profile **Public** và Firewall có rule
  `node.exe → Block` trên Public (bên cạnh rule Allow của Node.js). Điện thoại có thể
  không tới được `http://192.168.100.155:3000` và Metro `:8081` cho tới khi Wi-Fi được
  chuyển sang **Private** (Settings → Network → Wi-Fi → Private) hoặc mở rule cho
  2 cổng. Đây là việc 30 giây trên máy người dùng, agent không tự đổi Firewall.

## F. Vấn đề còn lại

- **P0/P1 code: không có** trong phạm vi đã kiểm thử (không tuyên bố cho phần NOT TESTED).
- **P1 handoff:** Firewall Public (mục E) + chưa có thiết bị Android để quét QR Metro —
  toàn bộ cột Android là NOT TESTED.
- **P2:** (1) Icon/splash vẫn là placeholder xanh (thay brand icon trước phát hành công khai).
  (2) TEST còn residue (§D). (3) Catalog sort là client-side trong SP đã tải (đã ghi rõ trên UI;
  backend `GET /products` không có tham số sort — không mở rộng backend vì ngoài scope V2).
  (4) Deep-link `agrimarket://trace/CODE` mới khai scheme, chưa test end-to-end.
- **P3:** polish chữ/UX nhỏ lẻ.
- BLOCKED backend (không gọi là PASS): đăng ký công khai, đổi/quên mật khẩu, wishlist,
  follow farm, điểm thưởng, VNPay sandbox.

## G. Kết luận

`SOURCE READY — EXPO GO DEVICE TEST PENDING`

Mọi kiểm thử tự động (static + API + TEST write-flow + Metro bundle) PASS sau khi sửa;
luồng cầm-tay trên Expo Go Android và camera QR cần người dùng quét QR Metro (§Handoff).

## H. Handoff Expo Go (người dùng làm, ~5 phút)

1. Trên PC: `npm run dev:api` (đang chạy, `:3000` 200 OK). Mở terminal mới:
   `cd apps/mobile && npm run dev:lan` (đã kiểm chứng boot + Metro bind LAN trong
   phiên này; tiến trình probe đã dọn để không chiếm cổng `:8081`), xem QR Metro.
2. Nếu chưa làm: chuyển Wi-Fi sang **Private** (mục E).
3. Mở **Expo Go** (Android, cùng Wi-Fi), quét QR Metro.
4. Kiểm tra nhanh: Home tải danh mục/SP → Catalog tìm/lọc/Xem thêm → chi tiết SP chọn
   quy cách → Đăng nhập (`lan.nguyen@agrimarket.vn` DEV) → Thêm giỏ → Checkout COD →
   Chi tiết đơn → tab Truy xuất → Quét QR lô thật (VD `TRC-000019-BAPCA`).
5. Báo lại ảnh màn hình/lỗi (nếu có) để sửa tiếp.

## I. Sự cố trong session (minh bạch)

- Không có sự cố hạ tầng: DEV `:3000` (nest --watch), Admin `:3001`, Customer Web `:3002`
  giữ nguyên chạy suốt phiên; TEST `:3100` dựng từ `dist` hiện có, chạy xong write-flow
  27/27 rồi dừng và dọn tiến trình; Expo `--lan` kiểm chứng boot 35s (Metro `:8081`
  khởi động không lỗi) rồi dọn cổng để user chạy foreground lấy QR (tránh chiếm cổng
  và giấu QR trong tiến trình nền).
- Lần đầu khởi TEST API trong phiên này quên biến môi trường nên dính `:3000`
  (EADDRINUSE) — đã dừng tiến trình lỗi, khởi lại đúng `PORT=3100` +
  TEST `DATABASE_URL`, health 200 rồi mới chạy write-flow.
- Phiên này **không cần sửa source**: typecheck/lint/unit/integration/write-flow/
  Metro export đều PASS ngay lần chạy đầu trên source hiện có; grep không thấy nút
  chết (`onPress={() => {}}`), TODO, IP LAN hardcode hay cấu hình APK/EAS còn sót.
