# AgriMarket V2 — GitHub Final Handoff

**Ngày:** 2026-10-12 · **Branch:** `main` · **Old HEAD:** `c7220ee` · **New HEAD:** `f87bebc` (`release: finalize AgriMarket V2 customer apps and business acceptance`, 71 files, +3824/−327)
**Remote:** `origin` → `https://github.com/laivannha0202/agrimarket-v2.git`
**Phạm vi:** toàn bộ source đang sử dụng (API + Admin + Customer + Mobile + tests + migrations + docs + QA scripts an toàn).
**Nguyên tắc:** DEV `agrimarket_v2` chỉ đọc (SELECT); mọi kiểm thử ghi trên TEST `agrimarket_v2_test` độc lập; không `reset --hard`, không `clean -fd`, không force push, không sửa dữ liệu DEV.

> Lưu ý tên repository: nhiệm vụ gốc ghi `laivannha0202/Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc`,
> nhưng remote thực tế của workspace (và URL trong README) là `laivannha0202/agrimarket-v2`.
> Toàn bộ quy trình dưới đây thực hiện trên remote thực tế này, branch `main`, không tạo branch mới, không push sang repo khác.

---

## A. Git

| Mục | Giá trị |
|---|---|
| Repository (local) | `E:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` |
| Branch | `main` (`git branch --show-current` → `main`) |
| Old HEAD | `c7220ee` — `docs: add complete step-by-step root README + dev:customer script` |
| New HEAD | `c300a9a` (`docs: record final handoff HEAD f87bebc`; release commit `f87bebc`, 71 files, +3824/−327) |
| Remote origin/main | `c300a9a` — `git rev-parse HEAD` == `git rev-parse origin/main` == `git ls-remote origin refs/heads/main` (đã xác minh) |
| Commit | `release: finalize AgriMarket V2 customer apps and business acceptance` |
| Push | `git push origin main` (không force; chỉ PASS khi exit code 0) |
| Git status còn lại | Chỉ còn `?? apps/api/s.name` (file 0-byte lạ, không phải source — giữ tại local, không commit, không xóa khi chưa xác minh) |

Trạng thái trước commit (đã xác minh bằng lệnh thật):

- `git fetch origin` → OK, `HEAD...origin/main` = `0 0` (remote không tiến lên, fast-forward an toàn, không xung đột).
- Modified 40 file + untracked 31 file. Sau phân loại: staged 70 file, loại trừ duy nhất `apps/api/s.name`.

---

## B. Source Coverage

| Module | Source Included | Dependencies | Build | Tests | Status |
|---|---|---|---|---|---|
| API (`apps/api`) | 6 services A1–A4 (`certificates`, `inventory` guarded `releaseStock`/`consumeOrderStock`/FEFO tie-break, `orders` chống double consume, `payments` COD reference + state machine, `promotions` Flash Sale validation, `shipments` CAS) + toàn bộ modules hiện có (auth, carts, categories, farms, harvests, locations, lots, orders, payments, products, promotions, QC, reports, returns, reviews, seasons, shipments, traceability, users, warehouses…) | `package.json` + `pnpm-lock.yaml` đã có trong tree | `nest build` PASS (exit 0) | Unit 386/386 (29 files) + E2E 331/331 (11 files, TEST DB) | PASS |
| Admin Web (`apps/admin-web`) | 4 pages đổi đợt này + `types/api.ts` (certificates validity, farms, flash-sales, orders COD reference) + toàn bộ routes hiện có (dashboard, orders, inventory, lots, QC, returns-complaints, vouchers, flash-sales, settlements, reports…) | `package.json` đã có trong tree | `next build` PASS — 30 routes | Unit 40/40 (7 files); typecheck + eslint PASS | PASS |
| Customer Web (`apps/customer-web`) | Toàn bộ route đang hoạt động (home, danh-mục, sản-phẩm, trang-trại, flash-sale, **ma-giam-gia**, giỏ-hàng, checkout, tài-khoản, đơn-hàng, truy-xuất QR, trả-hàng, khiếu-nại, đánh-giá…) + `lib/vouchers.ts` + `VoucherCard`/`VoucherListView` + `FarmListView` + `icon.svg` (không loại bỏ voucher view) | `package.json` đã có trong tree | `next build` PASS — 29 routes (incl. `/ma-giam-gia`, `/icon.svg`) | Typecheck + eslint PASS; parity `vouchers-parity.ts` PASS 22/22; không có test runner riêng (P2, ghi trung thực — xem §D) | PASS (với P2 đã ghi) |
| Mobile (`apps/mobile`) | `src/lib/types.ts` (`CertificateValidity` + `validity?`) + toàn bộ source hiện có (Expo Router, theme, assets, API client, screens catalog/cart/checkout/QR/orders/addresses/promotions/returns/complaints, 174 tests) + `app.json` Expo Go | `package.json` đã có trong tree | Không build native (đúng yêu cầu: chỉ Expo Go) | Unit 174/174 (18 files); typecheck PASS | PASS |
| Shared packages (`packages/*`) | Thư mục `packages/` trống (không có `package.json` con nào, không bị ignore, không có file nào bị bỏ sót — đã kiểm tra `Get-ChildItem -Force packages` + `git ls-files packages/`) | `pnpm-workspace.yaml` khai báo `apps/*` + `packages/*` | N/A | N/A | PASS (không thiếu) |
| Prisma | `schema.prisma` + 9 migrations (`20260101_init_v2` … `20261013_evidence_images`) + `seed.ts` + `.env.example` placeholder (đã có trong tree từ trước, không thuộc commit này nhưng được xác minh tồn tại) | `prisma` 7.10 trong `apps/api` | `nest build` PASS | E2E chạy trên schema này (331/331) | PASS |
| Documentation | 6 báo cáo nghiệm thu mới + toàn bộ docs hiện có (`API.md`, `BUSINESS-RULES.md`, `DATABASE.md`, `DOMAIN.md`, `CONCURRENCY-AUDIT.md`…) + root `README.md` (hướng dẫn clone → MySQL → `.env` → migrate → seed → chạy 4 app + Expo Go + Swagger + tests + TEST DB) | N/A | N/A | N/A | PASS |
| QA/ops scripts | 10 `apps/api/qa-*.mjs` + `qa-run-e2e.cmd` (đã sửa: bỏ credential hardcoded, đọc `TEST_DATABASE_URL` từ `.env` qua `setup-e2e.ts`) + 7 `apps/customer-web/qa/*` (đã sửa: bỏ absolute path `E:/dev/...`, dùng `QA_OUT`/relative import) | Chạy bằng `node`/`tsx` có sẵn | `vouchers-parity.ts` PASS 22/22 sau sửa | Read-only (SELECT/fetch), không ghi DEV | PASS |

Không thiếu source đang sử dụng: route/import/API usage đã truy vết (voucher views được Header/Footer/AccountNav/Checkout tham chiếu; `FarmListView` được `/trang-trai` tham chiếu; `icon.svg` theo quy ước App Router).

---

## C. Security

- **Secrets scan:** quét toàn bộ staged diff (`git diff --cached`) + toàn bộ file QA untracked + docs mới:
  - Không hardcoded password, JWT secret, SMTP secret, API key, access/refresh token, private key, production credentials trong bất kỳ file nào được commit.
  - 2 phát hiện duy nhất đều an toàn và đã xử lý:
    1. `apps/api/qa-run-e2e.cmd` chứa `TEST_DATABASE_URL=mysql://agrimarket:agrimarket_local@...` (credential local) → **đã xóa**, script giờ đọc từ `apps/api/.env` (gitignored).
    2. `apps/customer-web/qa/NOTES.md` chứa `Agri@12345` → đây là **demo credential công khai** do `pnpm db:seed` sinh ra và đã ghi trong root README → giữ lại nhưng ghi rõ nguồn (`public demo credential from pnpm db:seed`).
- **File bị loại khỏi Git:** `apps/api/s.name` (0 byte, không rõ nguồn gốc — giữ tại local, không commit, không xóa); toàn bộ `.env` thật (`apps/api/.env`, `apps/mobile/.env`), `node_modules`, `.next`, `.expo`, `uploads`, `backups`, `.tmp-verify`, `qa/out` đều đã gitignored (xác minh bằng `git check-ignore`).
- **`.env` được bảo vệ:** chỉ commit `.env.example` với placeholder (`USER:PASSWORD`, `CHANGE_ME`, `YOUR_PC_LAN_IP`); không commit `.env` nào.
- **Không lộ database credentials:** `DATABASE_URL`/`TEST_DATABASE_URL` thật chỉ nằm trong `apps/api/.env` (gitignored), không xuất hiện trong staged diff.
- **Cảnh báo còn lại:** không. Lịch sử commit chưa push không chứa secret mới (chỉ 1 commit mới, đã scan toàn bộ diff).

---

## D. Tests

Tất cả chạy bằng lệnh thật, trên TEST DB độc lập (`agrimarket_v2_test`) cho E2E; DEV `agrimarket_v2` không bị ghi.

| Lệnh (từ repo root hoặc filter) | Exit code | Kết quả |
|---|---|---|
| `pnpm --filter @agrimarket/api exec tsc --noEmit -p tsconfig.json` | 0 | PASS |
| `pnpm --filter @agrimarket/api exec oxlint --type-aware src/ test/ prisma/` | 0 | PASS (5 warning có sẵn, không mới) |
| `pnpm --filter @agrimarket/api exec vitest run` | 0 | **386/386 PASS**, 29 files |
| `pnpm --filter @agrimarket/api exec vitest run --config ./vitest.config.e2e.ts` | 0 | **331/331 PASS**, 11 files (TEST DB, 64s) |
| `pnpm --filter @agrimarket/admin-web exec tsc --noEmit -p tsconfig.json` | 0 | PASS |
| `pnpm --filter @agrimarket/admin-web exec vitest run` | 0 | **40/40 PASS**, 7 files |
| `pnpm --filter @agrimarket/admin-web exec eslint` (file đổi) | 0 | PASS |
| `pnpm --filter @agrimarket/admin-web exec next build` | 0 | PASS — 30 routes |
| `pnpm --filter @agrimarket/customer-web exec tsc --noEmit -p tsconfig.json` | 0 | PASS |
| `pnpm --filter @agrimarket/customer-web exec eslint` (7 file đổi) | 0 | PASS |
| `pnpm --filter @agrimarket/customer-web exec next build` | 0 | PASS — 29 routes |
| `pnpm --filter @agrimarket/mobile exec tsc --noEmit -p tsconfig.json` | 0 | PASS |
| `pnpm --filter @agrimarket/mobile exec vitest run` | 0 | **174/174 PASS**, 18 files |
| `qa/vouchers-parity.ts` (sau sửa relative import) | 0 | **PASS — 0 differences across 22 checks** |
| `pnpm --filter @agrimarket/api exec nest build` | 0 | PASS |
| `pnpm --filter @agrimarket/customer-web exec vitest run` | N/A | **KHÔNG CHẠY** — package không có test runner (không script test). Ghi trung thực, không bịa PASS (P2-U1). |

**Chưa chạy:** test runner Customer Web (không tồn tại); phiên máy thật/browser thật/Expo Go vật lý/SMTP thật (P2-U2).

---

## E. Source Cleanup

| Nhóm | Quyết định | Lý do |
|---|---|---|
| 40 modified file (services A1–A4 + tests + Admin/Customer/Mobile) | **Commit toàn bộ** | Source đang sử dụng, đã qua quality gates |
| 6 docs nghiệm thu mới | **Commit toàn bộ** | Báo cáo có giá trị, được task yêu cầu đưa lên GitHub |
| 17 QA scripts (`apps/api/qa-*.mjs`, `apps/customer-web/qa/*`) | **Commit sau khi sửa an toàn** | Công cụ kiểm thử/vận hành có giá trị lâu dài; đã loại bỏ credential hardcoded + absolute path máy cá nhân; read-only với DEV |
| Voucher views + `FarmListView` + `icon.svg` + `lib/vouchers.ts` | **Commit toàn bộ** | Đang được route/import tham chiếu (Header/Footer/AccountNav/Checkout/`/trang-trai`); loại bỏ sẽ gây thiếu source |
| `certificate-validity.spec.ts` | **Commit** | Unit test cho A3, qua gates |
| `apps/api/s.name` (0 byte) | **Không commit, giữ tại local, không xóa** | Không rõ nguồn gốc, không chứa source; xóa khi chưa xác minh vi phạm quy tắc an toàn |
| `.env`, `node_modules`, `.next`, `.expo`, `uploads`, `backups`, `qa/out`, `.tmp-verify` | **Không commit** (đã gitignored) | Secrets / build output / dữ liệu local |
| Thư mục ứng dụng, migrations, lockfile | **Không xóa gì** | Không mất source |

---

## F. Database

- **Không ghi DEV:** toàn bộ kiểm thử trong nhiệm vụ này chỉ đọc DEV (`SELECT` qua QA scripts) hoặc ghi TEST DB (`agrimarket_v2_test`, guard tên DB trong fixtures + `TEST_DATABASE_URL`). Không reset/reseed/sửa `agrimarket_v2`. Không tạo dữ liệu demo giả để test PASS.
- **Dữ liệu DEV chưa phê duyệt (bảo toàn, không tự sửa):** Flash Sale #3 cần đổi tên; farms địa chỉ cũ; address #16; chứng nhận thiếu chứng từ; certificate #11 hết hạn; reservation lịch sử lot #53; lot #44/#53 quá hạn; OUTBOUND lịch sử không đầy đủ (chi tiết trong `docs/AGRIMARKET-V2-FINAL-SYSTEM-ACCEPTANCE.md` §7).
- **TEST DB sử dụng:** `agrimarket_v2_test` (đã có schema + migrations; E2E 331/331 seed fixtures `e2e*` rồi dọn sạch, assert zero leftovers).
- **Migration khi clone máy khác:** `pnpm db:generate` → `pnpm db:deploy` → `pnpm db:seed` (theo root README Bước 6); MySQL local không tự đồng bộ qua GitHub — README hướng dẫn tạo database + user + `.env` đầy đủ.

---

## G. GitHub Verification

- [x] `git status --short` sau push: chỉ còn `?? apps/api/s.name` (đã phân loại, không phải source quan trọng bị bỏ sót).
- [x] `git log -1 --oneline` = `c300a9a`; `git rev-parse HEAD` == `git rev-parse origin/main` == `git ls-remote origin refs/heads/main` == `c300a9a`.
- [x] Git tree chứa đủ: `apps/api`, `apps/admin-web`, `apps/customer-web`, `apps/mobile`, `prisma/migrations`, tests, README, `docs/` (429 file source + 9 migrations + handoff report, đã kiểm tra `git ls-tree`).
- [x] Clean checkout: đã clone `https://github.com/laivannha0202/agrimarket-v2.git` vào thư mục tạm độc lập — HEAD `c300a9a`, đủ `package.json`, `pnpm-lock.yaml`, `schema.prisma`, `/ma-giam-gia`, `app.json`, handoff report. Đã xóa thư mục tạm sau kiểm tra.
- [ ] Không force push; không branch mới; không ghi đè lịch sử remote (remote không tiến lên trước push — `0 0`).
- [ ] Hạn chế còn lại: P2 (Customer test runner; phiên máy thật/browser thật/Expo Go vật lý/SMTP thật) + dữ liệu DEV lịch sử chờ duyệt — đã nêu rõ, không che.

---

## H. Handoff — Clone & chạy trên máy khác

```bash
# 1. Clone
git clone https://github.com/laivannha0202/agrimarket-v2.git
cd agrimarket-v2

# 2. Công cụ: Node.js >= 20 (khuyến nghị 24.x), pnpm 12, MySQL 8.4 đang chạy
node -v && pnpm -v && mysql --version

# 3. Cài dependencies (một lệnh cho cả 4 app)
pnpm install

# 4. Tạo database (cmd.exe): mysql -u root -p < scripts\sql\create-databases.sql
#    + tạo user agrimarket (xem README Bước 4)

# 5. Cấu hình API: copy apps\api\.env.example apps\api\.env rồi sửa
#    DATABASE_URL / TEST_DATABASE_URL / JWT_SECRET

# 6. Schema + dữ liệu demo
pnpm db:generate
pnpm db:deploy
pnpm db:seed
#    Tài khoản demo: admin@agrimarket.vn / Admin@12345 (Admin Web),
#    lan.nguyen@agrimarket.vn / Agri@12345 (Customer Web, Mobile)

# 7. Chạy API (terminal 1 — bắt buộc trước tiên)
pnpm dev:api
#    API: http://localhost:3000/api/v1 — Swagger: http://localhost:3000/docs

# 8. Chạy Admin Web (terminal 2)
pnpm dev:admin
#    http://localhost:3001 — đăng nhập Admin

# 9. Chạy Customer Web (terminal 3)
pnpm dev:customer
#    http://localhost:3002 — đăng nhập Khách hàng

# 10. Chạy Mobile Expo Go (terminal 4)
#     apps/mobile/.env: EXPO_PUBLIC_API_BASE_URL=http://<PC-LAN-IP>:3000/api/v1
#     (điện thoại + PC cùng Wi-Fi; tuyệt đối không dùng localhost)
pnpm dev:mobile
#    Quét QR bằng app Expo Go

# 11. Kiểm thử
pnpm test          # unit toàn repo (không cần DB)
pnpm test:e2e      # e2e API trên agrimarket_v2_test (không đụng DB dev)
```

- **URL Swagger:** `http://localhost:3000/docs`.
- **Điều kiện môi trường:** MySQL 8.4 (utf8mb4); SMTP/VNPay Sandbox chỉ cần khi demo gửi mail/thanh toán thật (mặc định `MAIL_TRANSPORT=test`, COD-only — xem README mục 8–10).
