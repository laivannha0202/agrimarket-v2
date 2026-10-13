# AgriMarket V2 — Mobile Expo Go API Connection Fix (2026-10-13)

Nhiệm vụ: xử lý triệt để lỗi Mobile Expo Go báo "Không kết nối được máy chủ" ở Danh mục / Sản phẩm nổi bật.
Không dùng dữ liệu giả. Không reseed DEV. Không commit/push. Bảo toàn diff Admin/Warehouse.

## A. Root Cause

**Lỗi gốc kép (đã xác minh bằng lệnh thật):**

1. **IP LAN stale trong `apps/mobile/.env` (nguyên nhân chính gây triệu chứng trên điện thoại).**
   - `.env` cũ: `EXPO_PUBLIC_API_BASE_URL=http://192.168.100.155:3000/api/v1` (xác minh ngày 2026-10-10).
   - `ipconfig` + `Get-NetIPConfiguration` trong phiên này (2026-10-13): adapter Wi-Fi `Intel(R) Wireless-AC 9260`
     đang UP với IPv4 **`10.218.208.43/24`**, gateway `10.218.208.144`, profile mạng **Private**.
   - Địa chỉ cũ `192.168.100.155` không còn tồn tại trên máy: request tới
     `http://192.168.100.155:3000/...` **timeout** (không phải ECONNREFUSED, không phải HTTP error).
   - Trên điện thoại, `fetch` tới host chết này ném `ApiError(status=0)` → UI hiển thị đúng
     "Không kết nối được máy chủ. Vui lòng kiểm tra Wi-Fi và địa chỉ API."
     (`apps/mobile/src/lib/api-client.ts:283`, `ErrorView network=true` trong `src/components/ui.tsx:430`).
   - Điện thoại đổi Wi-Fi / DHCP cấp lại IP là nguyên nhân đổi subnet `192.168.100.x` → `10.218.208.x`.

2. **Backend DEV không chạy trên port 3000 khi bắt đầu phiên (nguyên nhân thứ hai).**
   - `netstat` lúc đầu: **không có LISTENING nào trên `:3000`**.
   - `Invoke-WebRequest http://localhost:3000/docs` → `Unable to connect to the remote server`.
   - Tiến trình còn sót `PID 13356: node dist/src/main` đang LISTEN trên **`0.0.0.0:3100`**
     (cha là `nest start`, ông là `pnpm --filter @agrimarket/api start` từ 06:41).
     Đây là **TEST API `:3100`** còn sót từ đợt write-flow (`docs/AGRIMARKET-V2-MOBILE-ACCEPTANCE.md §C-D`,
     guard trong `apps/mobile/scripts/write-flow.ts:63` từ chối `:3000` vì đó là DEV).
   - TEST `:3100` đọc DB TEST (`agrimarket_v2_test`: 14 products / 5 cats, ảnh `https://cdn.agrimarket.vn/...`,
     residue order `ORD-20261010-0486`), **không phải DEV**. Mobile trỏ `:3000` nên dù TEST sống cũng vô ích.
   - MySQL service `MySQL84` vẫn `Running`, port `3306` LISTEN — loại trừ nguyên nhân DB down.

**Kết luận:** điện thoại trỏ tới IP chết + port chết → `status=0` → đúng thông điệp mạng.
Source API client, error handling, image-rewrite **đã đúng, không cần sửa source**.

### Xác minh cấu hình mobile (source thực tế)

- Single source of truth: `EXPO_PUBLIC_API_BASE_URL` đọc duy nhất trong
  `apps/mobile/src/lib/config.ts:16` (`getApiBaseUrl`), normalize trailing slash, **không hardcode IP**,
  phát hiện localhost (`isLocalhostBaseUrl`), notice khi thiếu/sai (`apiConfigNotice`).
- `apps/mobile/.env.example` giữ placeholder `YOUR_PC_LAN_IP` — đúng quy ước, không lộ IP thật vào Git.
- `apps/mobile/.env` là file git-ignored (`apps/mobile/.gitignore:4:.env`, `git check-ignore -v` xác nhận) —
  sửa local không tạo diff commit.
- Grep `apps/mobile/src`: **không có IP LAN hardcode** trong TypeScript (chỉ có localhost-guard,
  regex image-rewrite, và IP ví dụ trong test `promotions.test.ts` / `api-client.test.ts`).
- Không có `/api/v1/api/v1` lặp, không thiếu `/api/v1` (check `.env` có suffix `/api/v1`, không double).
- `NestJS main.ts:26` prefix `api/v1`, `main.ts:74` đọc `PORT` từ env (mặc định 3000),
  `app.listen(port)` bind mọi interface (`0.0.0.0:3000` + `[::]:3000` trong netstat) — điện thoại LAN tới được.

## B. Backend

| Hạng mục | Kết quả |
|---|---|
| MySQL service `MySQL84` | `Running`, `0.0.0.0:3306` + `[::]:3306` LISTEN |
| API process lúc đầu | Không có LISTEN `:3000`; còn sót TEST `:3100` (PID 13356) |
| Hành động | Khởi DEV bằng script thật `pnpm dev:api` (background process, log `Nest application successfully started`, `AgriMarket API running on http://localhost:3000/api/v1`) |
| Port sau sửa | `0.0.0.0:3000` + `[::]:3000` LISTEN (PID 6192 sau restart nạp CORS mới) |
| Kết nối MySQL | Prisma connected (log `PrismaService Prisma connected`), endpoints trả dữ liệu DEV thật |
| LAN accessibility (IP mới `10.218.208.43`) | Xem bảng Verification §E — toàn bộ 200 |
| Wi-Fi profile | **Private** (tốt — rule `node.exe Allow/Private` có hiệu lực, không bị `Block/Public` chặn) |
| Firewall | `Node.js JavaScript Runtime Allow/Inbound`, `node.exe Allow/Private` (2 rules), `Block/Public` (4 rules) — **không tắt firewall, không tạo rule mới**; vì Wi-Fi đang Private nên không cần thay đổi |
| CORS | Đã cập nhật `apps/api/.env` (git-ignored): thay 2 origin cũ `192.168.100.155:8081/8082` → `10.218.208.43:8081/8082`; restart API để nạp; kiểm tra header `Access-Control-Allow-Origin: http://10.218.208.43:8081` → 200 |

Không sửa `main.ts`, không đổi bind address, không sửa DB, không seed.

## C. Expo Mobile

| Hạng mục | Kết quả |
|---|---|
| URL đã cấu hình (`apps/mobile/.env`, git-ignored) | `EXPO_PUBLIC_API_BASE_URL=http://10.218.208.43:3000/api/v1` (có `/api/v1`, không localhost, không double-path) |
| Expo start mode | `pnpm --filter @agrimarket/mobile dev:lan` (`expo start --lan`); log `env: load .env` + `env: export EXPO_PUBLIC_API_BASE_URL` — biến mới đã nạp |
| Metro bundling | `:8081` LISTEN (`0.0.0.0:8081`), `GET /status` → `packager-status:running`, LAN `http://10.218.208.43:8081/status` → 200 |
| API requests từ máy qua LAN IP | Categories / Products / Wards / Docs / Uploads đều 200 (bảng §E) |
| Expo Go physical device | **NOT TESTED** — không có thiết bị thật trong môi trường AI; Metro đã dọn sau khi boot-check để user chạy foreground lấy QR (tránh chiếm cổng + giấu QR trong tiến trình nền) |
| Lưu ý tunnel | Không dùng tunnel; tunnel chỉ chuyển tiếp Metro, **không chuyển tiếp Backend API localhost:3000** |

Handoff cho người dùng (~5 phút, điện thoại + PC cùng Wi-Fi `10.218.208.x`):
1. PC đang chạy DEV API `:3000` (giữ nguyên terminal background). Mở terminal mới: `pnpm dev:mobile` (hoặc `pnpm --filter @agrimarket/mobile dev:lan`), xem QR Metro.
2. Mở **Expo Go** (Android, cùng Wi-Fi, không bật 5G/dữ liệu di động), quét QR → Reload app.
3. Kiểm tra: Home → Danh mục → Sản phẩm nổi bật → ảnh → Catalog → chi tiết SP → Farms → Trace `TRC-000019-BAPCA`.

## D. Fixes

| File (toàn bộ git-ignored, không tạo diff commit) | Vì sao sửa |
|---|---|
| `apps/mobile/.env`: `192.168.100.155` → `10.218.208.43` (giữ `:3000/api/v1`, cập nhật comment ngày xác minh) | IP LAN đổi sau khi đổi Wi-Fi; địa chỉ cũ timeout. Đây là fix chính cho triệu chứng "Không kết nối được máy chủ". |
| `apps/api/.env`: `CORS_ORIGIN` thay 2 origin `192.168.100.155:8081/8082` → `10.218.208.43:8081/8082`, restart API | Expo Web mở từ LAN mới cần origin khớp; API native (Expo Go) không bị CORS nhưng web cần. Local-only, không commit. |

**Không thay đổi:** toàn bộ `apps/mobile/src` (config, api-client, resources, screens, ui, promotions),
`apps/api/src`, Admin/Warehouse source, tests, docs khác, native project, EAS/APK, router, firewall rules.
Không hardcode IP vào TypeScript. Không commit `.env`. Không seed DEV.

## E. Verification

| Test | Expected | Actual | Kết quả |
|---|---|---|---|
| API localhost `/docs` | 200 | 200 | PASS |
| API localhost `/api/v1/categories?limit=1` | 200 + data DEV | 200, `Rau ăn lá` id 11 | PASS |
| API LAN `http://10.218.208.43:3000/docs` | 200 | 200 | PASS |
| Categories LAN | 200 | 200 | PASS |
| Products LAN `?page=1&limit=1` | 200 | 200 | PASS |
| Wards LAN `/locations/provinces/33/wards?limit=1` | 200 | 200 | PASS |
| Product detail LAN `/products/42` | 200 | 200 `Rau muống hạt`, 1 ảnh | PASS |
| Farms LAN `?limit=1` | 200 | 200 | PASS |
| Flash-sales LAN `?limit=1` | 200 | 200 | PASS |
| Product image LAN `/uploads/products/3f2db25c-….webp` | 200 `image/webp` | 200 `image/webp` | PASS |
| Image rewrite `localhost:3000 → 10.218.208.43:3000` | 200 | 200 (rewrite thủ công tương đương `resolveImageUrl`) | PASS |
| Old IP `http://192.168.100.155:3000/...` | timeout (chết) | timeout | PASS (xác nhận stale) |
| Old port `:3000` trước khi khởi API | connection refused | `Unable to connect` | PASS (xác nhận API down) |
| CORS LAN origin `http://10.218.208.43:8081` | `ACAO` khớp, 200 | `ACAO: http://10.218.208.43:8081`, 200 | PASS |
| Metro `--lan` boot | `packager-status:running` | `running` (localhost + LAN 200) | PASS |
| Mobile Home (Expo Go thật) | Danh mục + SP tải | Chưa thao tác thiết bị | NOT TESTED |
| Retry (ErrorView "Thử lại") | refetch query | Code đúng (`onRetry → refetch`), chưa bấm trên máy thật | NOT TESTED |
| Real phone browser → API LAN | JSON 200 | Chưa thao tác thiết bị | NOT TESTED |
| Expo Go physical device E2E | Danh mục/SP/ảnh tải | Chưa thao tác thiết bị | NOT TESTED |

Phân biệt lỗi (đã xác minh trong source, giữ nguyên):
- `ApiError status=0` (offline/DNS/sai IP/timeout) → illustration mạng + "Không kết nối được máy chủ" — đúng.
- HTTP 4xx/5xx → `ErrorView network=false` ("Đã xảy ra lỗi" + message dịch), 401 clear session — không ghi thành mất Wi-Fi.
- Response rỗng → `EmptyView` ("Chưa có…"), không ghi thành mất mạng.
- `StateView/resolveLoadState`: loading > error > empty > ready — không render kép, không loading treo (timeout 20s + AbortController).

## F. Regression

| Lệnh (thật, từ package.json) | Exit | Kết quả |
|---|---|---|
| `pnpm --filter @agrimarket/mobile typecheck` (`tsc --noEmit`) | 0 | PASS |
| `pnpm --filter @agrimarket/mobile lint` (`eslint .`) | 0 | PASS 0 error 0 warning |
| `pnpm --filter @agrimarket/mobile test` (`vitest run`) | 0 | **174/174 (18 files)** PASS |
| `pnpm --filter @agrimarket/api typecheck` (`tsc --noEmit`) | 0 | PASS |
| `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000/api/v1 pnpm --filter @agrimarket/mobile test:integration` | 0 | **7/7** read-only DEV PASS (categories, products 5 items, detail, farms, trace `TRC-000019-BAPCA`, vouchers, flash-sales; auth/write SKIP, **không ghi DEV**) |

Không xóa/không sửa test để đạt PASS. Không chạy `test:write` (ghi TEST) và không chạy `test:e2e` trong nhiệm vụ này.

## G. Git/Database Safety

- Branch: `main`. **Không reset / stash / clean. Không commit / push** (xác minh `git log --oneline -5` HEAD `792cb3e` không đổi).
- `git status --porcelain=v1`: diff Admin/Warehouse từ đợt `FINAL ADMIN CRUD & WAREHOUSE HARDENING` **còn nguyên**
  (13 files modified + 5 untracked, gồm warehouse guard/service/controller, admin pages, tests, docs) — không ghi đè, không mất.
- 2 file `.env` đã sửa đều **git-ignored** (`apps/mobile/.env` via `apps/mobile/.gitignore:4:.env`,
  `apps/api/.env` local) — `git status` không hiện chúng, không lộ IP/secret vào Git.
- Báo cáo này (`docs/AGRIMARKET-V2-MOBILE-API-CONNECTION-FIX.md`) là file mới duy nhất trong `docs/` —
  theo yêu cầu nhiệm vụ §13.
- DEV `agrimarket_v2`: **không seed, không reset, không đổi mật khẩu MySQL**.
  Lưu ý trung thực: `orders` DEV tăng 39→40 trong phiên (`ORD-20261013-0002`, customer 16, 56000, tạo + hủy lúc
  00:49:48 UTC, audit `ORDER_CREATE` id 74 + `ORDER_CANCEL` id 75). Script `test:integration` đã chạy ở chế độ
  **read-only** (7 checks GET + preview SKIP vì không cấp customer creds, write SKIP vì `AGRIMARKET_RUN_WRITE_TESTS!=1`;
  code `integration.ts:170-178` xác nhận không ghi) nên đơn này **không phải do script của phiên này** —
  khả năng do người dùng/test song song trên máy. DEV products giữ 14, categories 5, images 16 (toàn `localhost`,
  rewrite qua LAN 200 OK).
- Không in secret (JWT/DB password đã redact khi đọc `.env`).
- Không tắt firewall toàn cục, không tạo rule mới, không đổi router/mạng.

## H. Final Verdict

`CODE/NETWORK VERIFIED — PHYSICAL DEVICE PENDING`

Backend DEV chạy ổn định trên LAN mới, toàn bộ endpoint + ảnh + CORS + Metro LAN đã 200 từ chính máy,
cấu hình `.env` đã đồng bộ IP thật, hồi quy PASS. Cần người dùng quét QR Expo Go trên cùng Wi-Fi để xác nhận
Danh mục / Sản phẩm nổi bật tải dữ liệu thật và đóng verdict `MOBILE API CONNECTION — PASS`.
