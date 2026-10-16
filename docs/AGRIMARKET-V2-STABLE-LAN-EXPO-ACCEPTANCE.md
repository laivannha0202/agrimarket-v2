# AgriMarket V2 — Stable LAN + Expo Go Acceptance (2026-10-13)

`CODE/LAN VERIFIED — REAL DEVICE PENDING` (không có điện thoại thật trong môi trường này).

## 1. Root cause

1. **IP LAN stale:** `apps/mobile/.env` từng giữ `http://192.168.100.155:3000/api/v1`
   (xác minh 2026-10-10). Máy đổi Wi-Fi/DHCP, IP thật hiện tại là **`10.218.208.43/24`**
   (adapter Wi-Fi Intel Wireless-AC 9260, gateway `10.218.208.144`, profile **Private**).
   Địa chỉ cũ timeout → `ApiError(status=0)` → UI báo đúng "Không kết nối được máy chủ".
2. **API DEV từng chưa chạy** lúc bắt đầu phiên trước (port 3000 trống, còn sót TEST `:3100`).
   Hiện tại DEV `:3000` khỏe (PID 6192, `dist/src/main`, MySQL up).
3. **Không có autodiscovery:** mọi lần đổi mạng đều phải sửa IP tay trong `.env`
   + CORS tay. Source client (`config.ts`, `api-client.ts`, `promotions.ts`) đã đúng,
   không cần sửa.

## 2. Cơ chế IP LAN trước / sau

| | Trước | Sau |
|---|---|---|
| Tìm IP | `ipconfig` tay, sửa `.env` tay | `scripts/lan/lib.mjs:discoverLan()` — gateway + route metric + outbound UDP, loại loopback/APIPA/VPN-WSL-Docker-Hyper-V-Bluetooth, không cache, không hardcode |
| Override | không có | `--lan-ip=` hoặc `AGRIMARKET_LAN_IP=` (validate: phải là IPv4 local, cấm loopback/APIPA) |
| Nhiều interface | đoán bừa | lỗi `AMBIGUOUS_LAN` + yêu cầu override, không đoán |
| Expo URL | ghi tay, dễ quên restart | `npm run demo:mobile` sync đúng 1 biến vào `apps/mobile/.env` (giữ nguyên mọi dòng khác) + inject vào process Expo (bundle chắc chắn mới) + cảnh báo Metro cũ |
| API | `npm run dev:api` tay, không kiểm tra | readiness probe (MySQL TCP, port owner, `/health`, `/categories`, `/products`, `/wards`, `/docs`, LAN health); reuse khi khỏe; start khi port trống; từ chối kill foreign process |
| CORS LAN | sửa tay | `demo:all` báo giá trị cần thêm (không tự sửa); Expo Go native không cần CORS |

## 3. File đã sửa

- `package.json` — thêm 4 scripts: `demo:mobile`, `demo:all`, `lan:diagnose`, `lan:test`
  (tái dùng `dev:api`/`dev:admin`/`dev:customer`/`expo start --lan`, không thay scripts cũ).
- `README.md` — mục 10.2: một lệnh demo, phân biệt Metro URL vs Backend URL,
  firewall Private, override nhiều card mạng, restart khi đổi mạng.
- `apps/mobile/.env` (git-ignored) — `EXPO_PUBLIC_API_BASE_URL=http://10.218.208.43:3000/api/v1`.
- `apps/api/.env` (git-ignored) — `CORS_ORIGIN` đã gồm `http://10.218.208.43:8081/8082`
  (từ phiên trước, giữ nguyên).
- Không sửa: toàn bộ `src` (mobile/api/admin/customer), `main.ts`, bind address,
  DB, firewall rules, tests cũ.

## 4. Scripts bổ sung / tái sử dụng

| Script | Vai trò |
|---|---|
| `scripts/lan/lib.mjs` (mới, ~550 dòng, zero-dep) | `discoverLan`, `checkApiReadiness`, `syncEnvVar`, `validateApiBaseUrl`, `getWindowsPortOwner`, `checkTcpOpen` |
| `scripts/lan/demo-mobile.mjs` (mới) | `npm run demo:mobile`: IP → readiness → env → Expo LAN |
| `scripts/lan/demo-all.mjs` (mới) | `npm run demo:all`: API + Admin 3001 + Customer 3002 + Expo |
| `scripts/lan/diagnose.mjs` (mới) | `npm run lan:diagnose`: chẩn đoán read-only |
| `scripts/lan/lib.test.mjs` (mới, 12 tests) | `npm run lan:test`: IP validation, URL builder, env surgery, propagation contract |
| Tái dùng | `npm run dev:api`, `dev:admin`, `dev:customer`, `expo start --lan`, `test:integration` (read-only) |

## 5. Cách chạy một lệnh

```bash
npm run demo:mobile
# Wi-Fi khác / IP không chắc:
npm run demo:mobile --lan-ip=10.0.0.5
# Chẩn đoán không khởi động:
npm run lan:diagnose
# Cả 4 app:
npm run demo:all
```

Đổi Wi-Fi/hotspot → Ctrl+C → chạy lại lệnh. Bundle không tự nhận IP mới.

## 6. Cấu hình API / Web / Mobile

- **API:** `PORT=3000`, `app.listen(port)` bind mọi interface (`0.0.0.0:3000` + `[::]:3000`),
  prefix `api/v1`, CORS exact origins (localhost 3001/3002/8081/8082 + LAN 8081/8082),
  `credentials:false`, không `origin:true`/`*`.
- **Admin/Customer Web:** giữ `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1`
  khi chạy trên chính PC (đúng, không sửa). Mở từ thiết bị LAN khác mới cần đổi base
  + CORS tương ứng; không mở rộng vô cớ khi mục tiêu chỉ là Expo Go.
- **Mobile:** single source of truth `EXPO_PUBLIC_API_BASE_URL` (`config.ts:16`),
  không fallback hardcode, localhost-guard, `ApiConfigNotice` khi thiếu.
  Tuyệt đối không `localhost`/`127.0.0.1` trên điện thoại thật; không lặp `/api/v1`;
  không nhầm 3000 (API) với 8081 (Metro).
- **Metro:** `expo start --lan`, QR trỏ Metro trên LAN (`http://10.218.208.43:8081`).

## 7. Kết quả endpoint HTTP (LAN `10.218.208.43`, chạy thật 2026-10-13)

| Endpoint | Kết quả |
|---|---|
| `GET /api/v1/health` (localhost + LAN) | 200 `{"status":"ok","service":"agrimarket-api","database":"up"}` |
| `GET /api/v1/categories?limit=1` | 200 (`Rau ăn lá` id 11, total 5) |
| `GET /api/v1/products?page=1&limit=1` | 200 (`Rau muống hạt` id 42, total 14) |
| `GET /api/v1/locations/provinces/33/wards?limit=1` | 200 |
| `GET /api/v1/products/42` | 200, 1 ảnh `http://localhost:3000/uploads/...webp` |
| `GET /docs` | 200 |
| CORS `Origin: http://10.218.208.43:8081` | 200 + `ACAO: http://10.218.208.43:8081` |
| Old IP `192.168.100.155:3000` | timeout (xác nhận stale) |
| Missing product `/products/99999999` | **404** (HTTP class — không báo thành Wi-Fi) |
| `GET /products?page=9999` | 200 envelope rỗng (empty state đúng) |
| Stale override `--lan-ip=192.168.100.155` | từ chối: "not assigned to this machine" |
| Override loopback/bad | từ chối rõ ràng |

## 8. Kết quả Expo Metro (chạy thật, đã dọn)

- `expo start --lan` boot: `GET /status` → `packager-status:running` cả
  `127.0.0.1:8081` và `10.218.208.43:8081` → PASS.
- `EXPO_PUBLIC_API_BASE_URL` inject vào process Expo (log `env: export`) → PASS.
- Metro probe do script tạo đã dừng (chỉ kill đúng wrapper của mình, port 8081 hiện free)
  để người dùng chạy foreground lấy QR.

## 9. Kết quả ảnh sản phẩm (chạy thật)

- DB lưu 100% absolute `http://localhost:3000/uploads/products/*.webp` (14 products,
  không sửa DB).
- `resolveImageUrl` (mobile `promotions.ts:67`) rewrite localhost→LAN origin: PASS
  (unit 174/174 giữ nguyên + kiểm tra tay `REWRITTEN → 200 image/webp`).
- `HEAD/GET http://10.218.208.43:3000/uploads/products/3f2db25c-….webp` → **200 `image/webp`**.
- Không tạo ảnh giả, không hardcode host, không đổi response contract.

## 10. Test cases và exit code (chạy thật)

| Lệnh | Exit | Kết quả |
|---|---|---|
| `npm run lan:test` (`node --test scripts/lan/lib.test.mjs`) | 0 | 12/12 PASS (IPv4, virtual-name, URL build/validate, env surgery, propagation) |
| `npm run typecheck --workspace @agrimarket/mobile` | 0 | PASS |
| `npm run lint --workspace @agrimarket/mobile` | 0 | PASS 0 error 0 warning |
| `npm run test --workspace @agrimarket/mobile` | 0 | 174/174 (18 files) PASS |
| `npm run typecheck --workspace @agrimarket/api` | 0 | PASS |
| `npm run test --workspace @agrimarket/api` | 0 | 407/407 (31 files) PASS |
| `EXPO_PUBLIC_API_BASE_URL=http://10.218.208.43:3000/api/v1 test:integration` | 0 | 7/7 read-only PASS (trace `TRC-000019-BAPCA`; write SKIP, không ghi DEV) |
| `npm run typecheck --workspace @agrimarket/admin-web` | 0 | PASS (không đổi config) |
| `npm run typecheck --workspace @agrimarket/customer-web` | 0 | PASS (không đổi config) |
| `node scripts/lan/diagnose.mjs` | 0 | `DIAGNOSE: OK` (8/8 checks PASS) |
| Scenario matrix (10 cases, §10 task) | — | 10/10 PASS: wifi, expo-reload, backend-down, port-owner, mysql-phân-biệt, multi-adapter, vpn-loại-trừ, http≠wifi, empty-state, ảnh-lan |
| Metro boot probe | — | PASS (`packager-status:running` LAN + localhost, đã dọn) |

## 11. Kết quả trên điện thoại thật

**NOT TESTED** — không có thiết bị trong môi trường này. Handoff (~5 phút,
điện thoại + PC cùng Wi-Fi `10.218.208.x`):

1. `npm run demo:mobile` (giữ terminal, lấy QR).
2. Expo Go (Android, cùng Wi-Fi, tắt 5G) → quét QR → Reload.
3. Kiểm tra: Danh mục → Sản phẩm nổi bật → ảnh → chi tiết → Farms → Trace `TRC-000019-BAPCA`.

## 12. Tình huống mạng chưa thử (ghi rõ, không PASS giả)

- Chuyển Wi-Fi/hotspot thật (chỉ mô phỏng logic discovery + override; lần chạy mới tự chọn lại IP theo thiết kế, chưa đổi mạng vật lý).
- AP isolation / client isolation (thiết kế có cảnh báo, chưa có mạng cách ly để thử).
- Hotspot phát từ chính PC (cảnh báo gateway-less đã có, chưa thử thật).
- VPN bật đồng thời khi demo (loại trừ `vgate0` đã xác minh trên máy có VPN, chưa thử bật/tắt VPN giữa chừng).
- Mở Admin/Customer Web từ thiết bị LAN khác (chỉ kiểm tra localhost + CORS header, chưa mở browser từ máy khác).
- Quét QR Expo Go thật (§11).

## 13. Giới hạn khi dùng 4G/5G ngoài LAN

Backend chỉ bind local (`10.218.208.43:3000` là RFC-1918/campus-NAT, không public).
Điện thoại ở 4G/5G **không** tới được. Không hứa hoạt động ngoài LAN.
Muốn truy cập từ xa mới cần VPS/domain/tunnel/port-forwarding — ngoài phạm vi demo LAN,
không triển khai trong nhiệm vụ này.

## 14. Git status (cuối phiên, không commit/push)

- Branch `main`, HEAD `792cb3e` (không đổi).
- Diff Admin/Warehouse từ đợt trước **còn nguyên**: 13 files modified + 5 untracked
  (warehouse guard/service/controller, admin pages, tests, docs) — không reset/stash/clean.
- Mới trong phiên này: `package.json` (+4 scripts), `README.md` (§10.2),
  `scripts/lan/` (5 files), `docs/AGRIMARKET-V2-STABLE-LAN-EXPO-ACCEPTANCE.md` (file này).
- 2 file `.env` đã sửa đều git-ignored (`apps/mobile/.env`, `apps/api/.env`) —
  không hiện trong `git status`, không lộ IP/secret vào Git.
- `apps/api/s.name` (0 bytes, untracked, có từ trước) — không động vào.

## 15. DEV database safety

- Không `db:seed`, không reset, không sửa `DATABASE_URL`, không động lô/tồn kho/đơn/chứng nhận.
- `test:integration` chạy read-only (7 GET + preview/auth/write SKIP, không ghi).
- `npm run test --workspace @agrimarket/api` (407 tests): có 2 WARN `Password recovery mail could not be delivered`
  + `Evidence sweep failed: db down` — là log của unit test dùng DB mock/không có DB, không phải DEV bị ghi.
- Không in credential (mọi đọc `.env` đều redact `SECRET|PASSWORD|DATABASE_URL|SMTP|JWT`).

## 16. Vấn đề còn lại

1. **Cần điện thoại thật** để đóng verdict cuối (§11 handoff).
2. `apps/api/.env` thiếu các biến mẫu `PUBLIC_API_BASE_URL/UPLOADS_DIR/CUSTOMER_WEB_URL/MAIL_*`
   so với `.env.example` — API đang dùng default (request-derived base URL, uploads default,
   mail auto-test). Không bổ sung trong phiên này vì đang chạy ổn định; nên đồng bộ khi rảnh
   (chỉ thêm dòng thiếu, không đổi giá trị đang chạy).
3. TEST API `:3100` còn sót từ đợt write-flow (PID 13356, DB test, healthy) — không kill
   vì ngoài phạm vi; `demo:*` chỉ quản lý process do chính nó tạo.
4. `apps/api/s.name` (0 bytes untracked) tồn tại từ trước — không rõ nguồn, cần chủ repo xác nhận/xóa.

## Verdict

**CODE/LAN VERIFIED — REAL DEVICE PENDING.**

Mục tiêu "đổi Wi-Fi → chạy lại một lệnh, không sửa IP tay" đã đạt ở tầng code/LAN:
discovery không cache, readiness phân biệt network vs HTTP, Expo env đồng bộ cả file +
process, regression xanh. Chưa xác minh bằng thiết bị thật nên không ghi PASS toàn bộ.
