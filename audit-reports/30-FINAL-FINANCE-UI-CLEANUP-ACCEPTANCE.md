# Báo cáo 29 — Hoàn thiện UI đối chiếu tài chính, nghiệm thu thẩm mỹ và dọn môi trường

**Ngày:** 01/11/2026
**Phạm vi:** toàn monorepo (`apps/*`, `packages/*`, `scripts/`, `e2e/`, `docs/`, `audit-reports/`)
**Nguyên tắc:** không bắt đầu lại, không reset, không ghi đè mã nguồn, không push/merge/deploy, không dùng CI.
**Kết luận ngắn:** giao diện đối chiếu tài chính đã chạy thật và được nghiệm thu bằng ảnh; gate local PASS
20/20; hai thư mục dependency thừa đã xử lý (một xoá hết, một còn 11 MB bị ACL chặn); staging/UAT,
thiết bị thật, gateway thật và phê duyệt kế toán vẫn là blocker bên ngoài.

---

## A. Trạng thái đã xác minh lại trước khi làm

| Mục | Báo cáo cũ | Thực tế kiểm tra lại |
|---|---|---|
| Branch / HEAD | `main`, 4 commit local | Đúng: `main` @ `04b0af4`, 4 commit local, chưa push |
| Working tree | sạch | Đúng: `git status --porcelain` rỗng |
| `git diff --check` | PASS | Đúng (chỉ còn cảnh báo CRLF/LF của Git) |
| Playwright | 14/14 | Đúng (trước khi thêm test mới) |
| `verify:local` | 20/20 | Đúng (chạy lại cuối vòng: 20/20) |
| `detail-tabs/` | 7 file | Đúng (`apps/admin-web/src/components/orders/detail-tabs/`) |
| `GET finance/reconciliation` | có | Đúng — hợp đồng đọc trực tiếp từ service, không đoán |
| 16 ảnh QA trùng byte | đã xoá | Không kiểm lại (ngoài phạm vi vòng này) |
| 2 thư mục dependency thừa | có | **Sai một phần**: có **4** thư mục cùng loại, không phải 2 (xem §E) |
| UI đối chiếu tài chính | chưa có | Đúng — đã xây trong vòng này |
| Nghiệm thu staging/thiết bị/tải | chưa có | Đúng — vẫn chưa (xem §K) |

Hai điểm sai lệch so với báo cáo cũ đã được ghi nhận thay vì lặp lại: số thư mục dependency thừa
là 4 (không phải 2), và báo cáo cũ chưa nêu giới hạn "PDF chỉ hiển thị được ở chế độ headed".

---

## B. P1 — Giao diện Admin đối chiếu tài chính

### B1. Hợp đồng API được đọc trước khi viết UI

`GET /finance/reconciliation` (ADMIN) trả về:

```
generatedAt, range{from,to}, scanned, truncated, scanLimit,
summary{ ordersWithFindings, byIssue{}, byCollection{}, totals{obligation,collected,refunded,outstanding} },
findings[{ orderId, code, status, createdAt, obligation, collected, refunded, outstanding,
            collection, paymentStatuses[], refundState, settled, settlements[{id,code,status}],
            issues[] }],
meta{page,limit,total,totalPages}, note
```

Bốn chỗ **không đủ** để làm đúng yêu cầu, nên API được mở rộng theo hướng **chỉ đọc, tương thích ngược**
(mặc định không đổi):

| Thiếu gì | Vì sao không giải được ở frontend | Bổ sung |
|---|---|---|
| Lọc theo trạng thái / mã đơn | Lọc client trên một trang phân trang sẽ làm sai `total` và bỏ sót đơn ở trang khác | `status`, `search` (mã đơn) áp dụng **trước** khi cắt trang |
| Nhóm "đã thu đủ" / "chưa ghi nhận thu" | Báo cáo chỉ trả đơn **có** chênh lệch; đơn sạch không xuất hiện | `collection=NONE/PARTIAL/FULL/OVER` (server phân loại) + `includeMatched=true` |
| "Payment thiếu bằng chứng" | Payment `PAID` thiếu `paid_at` bị loại khỏi `collected` nên đơn trông "sạch" — tiền vô hình | Issue mới `MISSING_COLLECTION_EVIDENCE` |
| Liên kết tới kỳ quyết toán | Chỉ có cờ `settled: boolean`, không có id | `settlements[{id,code,status}]` |

`summary` **luôn** mô tả toàn kỳ đã quét, không mô tả bộ lọc đang mở — nếu không, mở một tab sẽ làm
kỳ kế toán trông "sạch" hơn thực tế. Điều này được ghi trong Swagger, `docs/API.md` và test.

### B2. Màn hình `/reconciliation`

| Yêu cầu | Cách đáp ứng |
|---|---|
| Danh sách đơn có vấn đề | Bảng mặc định chỉ hiện `findings` (đơn có ít nhất 1 issue) |
| Đơn đã thu đủ | Chip "Mức thu: Đã thu đủ" → `collection=FULL&includeMatched=true`; cột "Mức thu" hiện nhãn do server phân loại |
| Đơn chưa thu đủ | Issue `UNDER_COLLECTED` + chip "Thu thiếu"; cột "Còn thiếu" in đỏ khi > 0 |
| Đơn thu vượt | Issue `OVER_COLLECTED` + chip "Thu vượt"; "Còn thiếu" âm |
| Đơn chưa ghi nhận thu COD | Chip "Chưa ghi nhận thu" → `collection=NONE&includeMatched=true` |
| Payment thiếu bằng chứng | Issue `MISSING_COLLECTION_EVIDENCE` + panel mở rộng hiện trạng thái payment |
| Hoàn tiền & tác động | Cột "Đã hoàn" + cột "Hoàn tiền" (`NONE/PARTIAL/FULL`) + bộ lọc "Hoàn tiền" |
| Trạng thái quyết toán | Cột "Quyết toán": link tới `/settlements/:id` + nhãn trạng thái, hoặc "Chưa quyết toán" |
| Lọc trạng thái & thời gian | Select "Trạng thái đơn" + `RangePicker` (from/to theo ngày tạo) |
| Tìm mã đơn | Ô tìm kiếm, debounce 300 ms |
| Xem chi tiết nguyên nhân | Mở rộng dòng: giải thích từng issue, số liệu, trạng thái payment, link |
| Liên kết đơn / payment / settlement | Mã đơn → `/orders/:id`; panel → `/orders/:id?tab=payment`; settlement → `/settlements/:id` |
| Phân trang / loading / empty / error / retry | Dùng `ListPage` chung (loading bảng, `ErrorState` + nút "Thử lại", empty text riêng) |
| Menu quản trị | Nhóm "Tài chính" → "Đối chiếu dòng tiền" (icon `AuditOutlined`) |

**Nguyên tắc tài chính được giữ:**

- Không có phép cộng tiền nào ở frontend. `collection`, `obligation`, `collected`, `refunded`,
  `outstanding` đều là số API trả về; UI chỉ định dạng.
- Không có nút sửa/tạo/xoá khoản tiền. Trang chỉ có link sang luồng thu/hoàn tiền chuẩn.
- Không đánh dấu đơn "hợp lệ": KPI thứ ba ghi **"Không phát hiện chênh lệch"** kèm chú thích
  *"Không đồng nghĩa đã thu đủ tiền"*; nhãn "Đã thu đủ" chỉ xuất hiện khi server phân loại `FULL`
  (`collected ≥ obligation` theo đúng epsilon của settlement).
- Chỉ ADMIN: `@Roles('ADMIN')` ở controller; E2E xác nhận CUSTOMER → 403, ẩn danh → 401.
- Customer Web / Mobile không có route, không có type, không có link nào tới báo cáo này.

### B3. Liên kết sâu `?tab=payment`

Trang chi tiết đơn trước đây giữ tab trong `useState`, nên link từ màn hình đối chiếu không mở được
tab thanh toán. Đã đổi sang **URL là nguồn sự thật**: `useSearchParams` + `router.replace(..., {scroll:false})`,
bọc `Suspense` để `next build` vẫn prerender được. Tab lạ rơi về "Tổng quan".

---

## C. Lỗi UI/PDF tìm thấy và đã sửa

| # | Lỗi | Bằng chứng | Sửa |
|---|---|---|---|
| C1 | Cột "Vấn đề" nằm cuối bảng → ở 1440px và 390px phải cuộn ngang mới thấy lý do đơn có mặt | `admin-reconciliation-1440x900.png` (bản đầu) | Đưa "Vấn đề" lên cột 2; bỏ cột "Trạng thái đơn" và "Liên kết" (đã có trong panel mở rộng); `scrollX` 1560 → 1360 |
| C2 | Link `?tab=payment` mở tab "Tổng quan" | Playwright đỏ `aria-selected=false` | URL-driven tab (§B3) |
| C3 | `Space direction="vertical"` bị antd v6 deprecate (cảnh báo lọt vào console) | Test component bắt cảnh báo antd | Đổi sang `orientation="vertical"` |
| C4 | `tsconfig` của Admin còn `exclude: node_modules_npm_tmp` sau khi thư mục bị xoá | Rà soát cấu trúc | Bỏ entry thừa |
| C5 | Ảnh chụp PDF trong chế độ headless là khung trắng (Chromium không render PDF viewer khi headless) | `admin-order-pdf-preview` bản headless | Chụp lại bằng `--headed`; ghi rõ điều kiện trong spec + báo cáo |

Không phát hiện lỗi layout ở: Admin chi tiết đơn (3 viewport), Customer chi tiết đơn (3 viewport),
Voucher, Hoàn tiền, PDF đơn hàng, PDF phiếu soạn hàng.

**Những gì đã quan sát thật trên ảnh (không chỉ chụp):**

- PDF đơn hàng: logo lá xanh + "AgriMarket / Nông sản sạch, nguồn gốc rõ ràng"; tiếng Việt đủ dấu
  ("PHIẾU XÁC NHẬN ĐƠN HÀNG", "Nguyễn Thị Lan", "Hưng Yên"); dòng tiền "Tạm tính 12.000 đ",
  "Phí giao hàng 20.000 đ", "TỔNG THANH TOÁN 32.000 đ", "Chưa thu tiền", "Còn phải thanh toán 32.000 đ".
- PDF phiếu soạn hàng: cùng logo, **không có giá** (đúng thiết kế nội bộ), có SKU + mã lô + ô tick.
- Bảng đối chiếu: 3 dòng thật (`Thu thiếu 180.000 đ`, `Thu vượt -50.000 đ`, `Thiếu bằng chứng thu tiền`),
  KPI 11 đơn quét / 3 chênh lệch / 8 không chênh lệch / còn phải thu 681.000 đ.
- Mobile 390px: không có cuộn ngang cấp trang ở mọi màn hình đã chụp (assert trong test, không chỉ nhìn).

---

## D. Ảnh nghiệm thu

Thư mục `audit-reports/assets/29/` — 17 ảnh, tên kèm viewport:

| Màn hình | 1440×900 | 768×1024 | 390×844 |
|---|---|---|---|
| Admin đối chiếu dòng tiền | ✓ | ✓ | ✓ |
| Admin chi tiết đơn | ✓ | ✓ | ✓ |
| Customer chi tiết đơn | ✓ | ✓ | ✓ |
| Admin voucher | ✓ | ✓ | ✓ |
| Admin hoàn tiền | ✓ | ✓ | ✓ |
| PDF đơn hàng (headed) | ✓ | — | — |
| PDF phiếu soạn hàng (headed) | ✓ | — | — |

Lệnh tạo lại:

```bash
npx playwright test --project=visual-acceptance            # ảnh HTML
npx playwright test --project=visual-acceptance -g "chi tiết đơn và PDF" --headed   # ảnh PDF
```

---

## E. Dọn thư mục dependency thừa

### E1. Kiểm tra trước khi xoá

| Điều kiện | Kết quả |
|---|---|
| Đúng root repo | `git rev-parse --show-toplevel` = `D:/dev/.../Xay-dung-...` |
| Tồn tại | `node_modules_pnpm_broken/` (1,4 GB), `apps/admin-web/node_modules_npm_tmp/` (590 MB) |
| Không phải symlink/junction | `lstat().isSymbolicLink() === false`; `dir === true` |
| Git không track | `git ls-files | grep -c` = 0; cả hai nằm trong `.gitignore` |
| Không bị tham chiếu | Chỉ 1 chỗ: `tsconfig` exclude (đã bỏ). Không script/build nào trỏ vào |
| Không có dữ liệu người dùng | `node_modules_pnpm_broken` chỉ có `.pnpm`, `.modules.yaml`; `node_modules_npm_tmp` là cây package npm thuần |
| `node_modules` đang dùng vẫn tốt | Typecheck/lint/test/build/Playwright/verify:local đều PASS sau khi xoá |
| Không có tiến trình dùng | Không có server nào chạy trên 3000–3002/3100; xoá không lỗi "in use" |

### E2. Kết quả

| Thư mục | Trước | Sau | Ghi chú |
|---|---|---|---|
| `apps/admin-web/node_modules_npm_tmp` | 590 MB | **đã xoá** | 10 giây |
| `node_modules_pnpm_broken` (root) | 1,4 GB | **11 MB** | Xoá được 1,39 GB; **5.372 file còn lại bị ACL từ chối** |

**Dung lượng giải phóng: ≈ 1,98 GB** (`df`: 53 GB → 52 GB used, 425 → 426 GB avail).

**Vì sao còn 11 MB:** các file còn lại trả `Access is denied` cho cả `rm`, `Remove-Item` và `icacls`
(chỉ đọc metadata được, attributes = `Archive`). `takeown` trả
*"The current logged on user does not have ownership privileges"* — cần phiên **Administrator**.
Theo đúng nguyên tắc "không ép xoá", không nâng quyền, không đổi chủ sở hữu. Cách xử lý khi có quyền:

```powershell
# PowerShell với quyền Administrator
takeown /F node_modules_pnpm_broken /R /D Y
icacls node_modules_pnpm_broken /grant "%USERNAME%":F /T
Remove-Item node_modules_pnpm_broken -Recurse -Force
```

**Hai thư mục cùng loại ngoài phạm vi được phép xoá (không đụng tới):**

- `apps/api/node_modules_pnpm_broken` — 93 KB
- `apps/admin-web/node_modules_pnpm_broken` — 399 MB

Đề xuất xoá cùng lúc với 11 MB còn lại ở phiên có quyền; tổng thêm ≈ 399 MB.

### E3. Kiểm tra sau khi dọn

- `require.resolve` cho `next`, `antd`, `react`, `@tanstack/react-query`, `@prisma/client`, `vitest`,
  `@playwright/test`, `mysql2`, `pdfkit`: **OK**.
- `npm ls --depth=0` **không dùng được**: npm 11 ném `Cannot read properties of null (reading 'edgesOut')`.
  Đây là lỗi của npm với cây có package "extraneous" (tồn tại từ lần cài pnpm trước, không do lần xoá này:
  các package đó là thư mục thật, không phải symlink vào thư mục đã xoá). Bằng chứng thay thế:
  typecheck 5 workspace, lint, 967 unit test, 3 build, 493 E2E, 27 Playwright, `verify:local` 20/20 đều PASS.
- `git status`: không có thay đổi bất thường (chỉ các file của vòng này).

---

## F. Kiểm thử tải

`verify:load` **giữ độc lập**, không nằm trong `verify:local` (đúng quyết định vòng 27).

Rà soát harness `scripts/load-test.mjs`:

- Mọi request là `GET` (chỉ `POST /auth/login` để lấy token) → không ghi dữ liệu nghiệp vụ.
- `--url` bắt buộc schema `*_test` / `*_restore` / `*_drill`, từ chối `DATABASE_URL`.
- `--base-url` ngoài loopback bắt buộc `--allow-external`.
- Concurrency mặc định 20, `MAX_SOCKETS=128`, timeout request 10 s, ngưỡng p99 ≤ 2000 ms, lỗi ≤ 1 %.
- Có warmup (5 s) không tính vào thống kê.

Chạy baseline trên `agrimarket_v2_test` (API build từ `apps/api/dist`, một tiến trình):

| Concurrency | Thời gian | Request | RPS | p50 | p95 | p99 | max | Lỗi |
|---|---|---|---|---|---|---|---|---|
| 10 | 8 s | 2.797 | 349,0 | 28,9 | 34,8 | 39,6 | 51,3 | 0 |
| 20 | 30 s | 10.887 | 362,5 | 56,1 | 63,9 | 68,2 | 76,1 | 0 |
| 40 | 30 s | 10.395 | 345,7 | 118,3 | 129,7 | 136,9 | 151,3 | 0 |

So với vòng 27 (cùng máy, cùng mix, cùng tham số):

| Concurrency | RPS 27 → 29 | p99 27 → 29 |
|---|---|---|
| 10 | 235,4 → 349,0 | 68,5 → 39,6 ms |
| 20 | 261,7 → 362,5 | 106,0 → 68,2 ms |
| 40 | 251,4 → 345,7 | 201,2 → 136,9 ms |

**Không có regression**; kết quả tốt hơn ~1,4× về throughput và ~30–50 % về p99. Khác biệt có thể do
máy ít tải nền hơn, nên chỉ dùng để so sánh tương đối giữa hai lần chạy local — **không phải** kết luận
về production. Không chạy tải lên staging/production.

---

## G. Kiểm thử đã chạy (sau khi code hoàn thiện)

| Hạng mục | Kết quả |
|---|---|
| Typecheck 5 workspace | PASS |
| Lint 5 workspace | PASS |
| Unit/component | **967 PASS**, 3 SKIP (Mobile, có lý do trong test) — API 629, Admin 55, Customer 37, Mobile 175, Shared 71 |
| API E2E (HTTP thật, schema test) | **493 PASS / 23 file** (tăng 9 ca đối chiếu) |
| Playwright | **27 PASS** — admin 1440, admin 390, customer, visual 4 |
| Build API + Admin + Customer | PASS |
| Mobile export (android/ios/web) | PASS — `entry-*.hbc` 3,6 MB mỗi nền tảng + 36 web chunk |
| Finance concurrency + stock concurrency | PASS (`stress`, 10 vòng) |
| Database invariants | PASS 54 check × 2 lần (trước/sau E2E) |
| PDF tests | PASS (byte-level: logo 512×512, DejaVu subset, tiếng Việt) + ảnh headed |
| Security scan | PASS 9 check, 0 secret, `npm audit` PASS |
| `verify:local` | **PASS 20/20**, schema `agrimarket_v2_c19_20261101t155310zl87d_test` đã drop |
| `verify:load` | PASS (riêng, xem §F) |

Chi tiết gate: `.tmp-verify/verify-local-round29.log` + `.tmp-verify/c19/local-20261101t155310zl87d/`.
Playwright: `.tmp-verify/playwright-round29.log`. Tải: `.tmp-verify/load-round29-c{10,20,40}.json`.

---

## H. Mức độ an toàn tài chính

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Báo cáo có ghi dữ liệu không? | Không | Unit "is read-only"; E2E so sánh payment/refund trước–sau khi gọi API: giống hệt |
| Frontend có tự tính tiền? | Không | Mọi số lấy từ response; test component so khớp đúng số API |
| Có nút điều chỉnh tiền? | Không | Test khẳng định không có button sửa/tạo trên trang |
| Có đánh dấu đơn "hợp lệ" khi thiếu tiền? | Không | `FULL` chỉ khi `collected ≥ obligation` (server); KPI "không phát hiện chênh lệch" có chú thích phủ định |
| Quy tắc "đã thu đủ" có bị nhân bản? | Không | Trích ra `apps/api/src/common/utils/payment-collection.ts`, dùng chung với settlement |
| Phân quyền | ADMIN | E2E: ẩn danh 401, CUSTOMER 403, ADMIN 200 |
| Sửa số liệu lịch sử | Không có đường nào | Không có endpoint ghi trong báo cáo; UI chỉ link sang luồng chuẩn |

Thay đổi nghiệp vụ duy nhất là **thêm một issue báo cáo** (`MISSING_COLLECTION_EVIDENCE`) — không đổi
quy tắc tiền, không backfill, không chặn thêm luồng nào.

---

## I. Cấu trúc sau refactor 28

| Kiểm tra | Kết quả |
|---|---|
| Import hỏng | Không — typecheck + 3 build PASS |
| Circular dependency mới | Không — chiều phụ thuộc một chiều (`dto → service` chỉ để lấy enum/const của báo cáo; service không import dto) |
| Quy tắc nghiệp vụ trùng | Đã gộp 1: định nghĩa "đã thu" của settlement và báo cáo giờ dùng chung helper |
| File đã xoá còn bị tham chiếu | Có 1 (`tsconfig` exclude `node_modules_npm_tmp`) → đã bỏ |
| File generated bị commit | Không (`git ls-files` không có `dist/`, `generated/`, `.next/`) |
| Secret | 0 (security scan) |
| Migration | Đủ 14, checksum khớp, không sửa migration cũ |
| Bằng chứng audit cũ | Không đụng (`audit-reports/01..28`, `assets/26`) |
| Public API/route | Không xoá; thêm route Admin `/reconciliation` và 4 filter optional |
| File rỗng/module thừa | Không tạo; chỉ thêm 1 helper 40 dòng, 1 trang, 1 doc, 4 file test |

---

## J. Mobile

| Hạng mục | Kết quả |
|---|---|
| SDK | Expo `~58.0.22`, React Native 0.88.1, React 19.3.0 |
| Typecheck / lint | PASS |
| Unit test | 175 PASS, 3 SKIP |
| Bundle | Android `.hbc` 3,6 MB, iOS `.hbc` 3,6 MB, Web 36 chunk — PASS |
| Navigation / Voucher / Refund / COD | Có test đơn vị (`vouchers`, `checkout`, `aftersales-validation`, `status`); **chưa chạy trên máy thật** |
| PDF open/share | `OrderPdfCard` dùng `expo-sharing`; **chưa chạy trên máy thật** |
| API error handling | `api-client.test.ts` PASS |
| Permission | Không thêm quyền mới; SecureStore dùng cho token |
| Android/iOS compatibility | Chỉ chứng minh ở mức bundle + typecheck |

**NOT VERIFIED — REAL DEVICE.** Không có thiết bị/emulator trong phiên này; không tạo bằng chứng giả.

---

## K. Blocker bên ngoài (không thể đóng trong repo)

| # | Blocker | Điều kiện để đóng |
|---|---|---|
| K1 | Staging/UAT chưa chạy | Có môi trường staging + người nghiệm thu; chạy `docs/STAGING-UAT-PLAN.md` §2–§7 |
| K2 | **Phê duyệt kế toán** cho quy tắc chặn quyết toán thiếu bằng chứng | Kế toán trưởng ký §8.1–§8.6 của UAT plan (bắt buộc trước go-live) |
| K3 | Gateway VNPay/MoMo/ZaloPay chưa tích hợp | Hợp đồng merchant + credential sandbox + callback/IPN có xác thực chữ ký + đối soát + UAT tài chính |
| K4 | Thiết bị Mobile thật | Điện thoại Android/iOS + Expo Go/dev build |
| K5 | Tải production | Staging nhiều instance + đo ở concurrency 20/50/100 |
| K6 | 11 MB `node_modules_pnpm_broken` còn lại | Phiên Administrator (takeown/icacls) |
| K7 | 399 MB + 93 KB pnpm-broken ngoài phạm vi | Chủ dự án cho phép xoá thêm |

Không có blocker nào trong K1–K7 được ghi thành PASS.

---

## L. Git

| Mục | Trước | Sau |
|---|---|---|
| Branch | `main` | `main` (không tạo nhánh mới) |
| HEAD | `04b0af4` | `04b0af4` + 5 commit (xem bảng dưới) |
| Commit local | 4 (giữ nguyên) | 4 cũ + 5 commit của vòng này |
| Working tree | sạch | sạch sau commit |
| `git diff --check` | PASS | PASS |
| Push/merge/deploy | không | không |

Commit vòng 29 (local, chưa push):

| SHA | Nội dung |
|---|---|
| `39723ec` | `feat(api)`: `payment-collection.ts` dùng chung, `MISSING_COLLECTION_EVIDENCE`, filter `status`/`issue`/`collection`/`refundState`/`search`/`includeMatched`, `byCollection`, tham chiếu settlement |
| `808bc04` | `feat(admin)`: trang `/reconciliation`, deep link tab đơn hàng qua URL, nhãn tiếng Việt trong `lib/status` |
| `663a02a` | `test(e2e)`: E2E HTTP đối chiếu (read-only), Playwright trên API thật, 17 ảnh nghiệm thu + kiểm tra byte PDF |
| `d929d25` | `docs(29)`: báo cáo này, `STAGING-UAT-PLAN.md`, cập nhật `API.md`/`BUSINESS-RULES.md`, ảnh nghiệm thu |
| commit cuối | `docs(29)`: chỉ điền SHA vào mục L này, không đổi mã nguồn — SHA xem `git log --oneline -1` |

`git status --porcelain` sau commit: rỗng. Bốn commit cũ (`b983dd5`, `d934568`, `d12da0c`, `04b0af4`)
giữ nguyên, không rebase, không sửa lịch sử đã có.

---

## M. Kết luận

**LOCAL-TEST-READY** — có căn cứ:

- Gate `verify:local` 20/20 PASS trên schema dùng-rồi-xoá; 967 unit + 493 E2E API + 27 Playwright.
- Giao diện đối chiếu tài chính chạy thật với API thật, được nghiệm thu bằng 17 ảnh ở 3 viewport và
  được kiểm tra phân quyền ADMIN/CUSTOMER.
- Không có regression hiệu năng so với baseline vòng 27.
- Môi trường local đã dọn ~1,98 GB.

**Chưa** STAGING-READY / PRODUCTION-READY:

- Chưa có môi trường staging, chưa có người nghiệm thu, chưa có phê duyệt của kế toán cho quy tắc chặn
  quyết toán (K1, K2).
- Chưa chạy trên thiết bị Mobile thật (K4); chưa đo tải trên hạ tầng thật (K5).
- Thanh toán online vẫn **không khả dụng** đúng thiết kế — không phải bug đã sửa (K3).
