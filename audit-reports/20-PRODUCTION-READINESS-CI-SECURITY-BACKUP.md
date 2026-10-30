# 20 — PRODUCTION READINESS: CI, SECURITY, BACKUP & RESTORE

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Phạm vi:** C-19 (CI/CD, backup/restore, secret management, observability, RBAC), C-01 (JWT fail-closed ở mức vận hành), cảnh báo bảo mật Next.js, quét secret trước bàn giao.  
**Ngày xác minh:** 23/10/2026  
**Bằng chứng:** `.tmp-verify/final-hardening/`  
**Kết quả trong phạm vi:** **PARTIALLY COMPLETE**. CI đã có file hợp lệ nhưng **chưa chạy trên remote**; backup/restore mới là **diễn tập local**; cảnh báo Next.js là **VERIFIED BUG — OPEN**; RPO/RTO là đề xuất, **chưa phải chính sách được phê duyệt**. Không tuyên bố production-ready.

---

## 1. Phạm vi và phân loại

| Hạng mục | Phân loại sau xác minh | Ghi chú |
|---|---|---|
| C-19 — CI/CD, backup/restore, secret management, observability, RBAC | **PARTIALLY COMPLETE** | CI + backup scripts + audit viewer đã có; remote CI, deploy, metrics, RBAC chi tiết vẫn thiếu |
| CI workflow — cú pháp và cấu trúc | **VERIFIED FUNCTIONAL** | Parse YAML thành công; 1 job, 11 bước, không có bước deploy |
| CI workflow — chạy thật trên GitHub Actions | **NOT VERIFIED** | Chưa commit/push, chưa quan sát run nào |
| Quét secret trên working tree | **VERIFIED FUNCTIONAL** | Không phát hiện private key/cloud token/production credential trong phạm vi quét |
| Backup file + SHA-256 sidecar | **VERIFIED FUNCTIONAL** | Dump 23.275 bytes, checksum khớp sidecar |
| Restore drill local | **PARTIALLY COMPLETE** | Restore vào schema cô lập và đọc dữ liệu thành công; sidecar vẫn ghi `restoreVerified: false`; chưa đo RTO |
| RPO 24h / RTO 4h | **BUSINESS DECISION REQUIRED** | Là đề xuất kỹ thuật trong runbook, chưa được phê duyệt |
| Next.js advisory | **VERIFIED BUG — OPEN** | `next@16.4.0` thuộc phiên bản bị ảnh hưởng theo advisory chính thức; bản vá tối thiểu `16.4.1` |
| Khả năng khai thác Next.js trên codebase này | **NOT VERIFIED** | Không thấy `use cache`, Server Actions; image optimizer đang tắt; chưa penetration test |
| Build Admin/Customer | **PARTIALLY COMPLETE** | Lần build đầu bị chặn bởi `SecurityFatalError`; retry thành công nhưng vẫn cảnh báo |
| Audit log viewer | **VERIFIED FUNCTIONAL** | Có API/route ADMIN và E2E `audit-logs`; chưa có retention/immutability policy |
| Credential rotation | **BUSINESS DECISION REQUIRED** | Chưa xoay vòng bất kỳ secret thật nào; không đổi mật khẩu thật trong đợt này |

---

## 2. Phát hiện gốc từ Report 14

### C-19 — Thiếu nền tảng phát hành/vận hành

Tại HEAD trước khi hardening:

- Không có `.github/`, `.gitlab-ci.yml`, `Dockerfile`, `docker-compose.yml`.
- `backups/` có dump nhưng không có log restore, không có script restore, không có RPO/RTO.
- Không có metrics/tracing/alerting; chỉ có `GET /api/v1/health` kiểm tra DB.
- Không có global rate limit; chỉ auth route có throttler.
- `AuditLog` chỉ ghi, không có API đọc/UI.
- Chỉ role `ADMIN`/`CUSTOMER`, không có staff role, partner portal hoặc phân quyền chi tiết.
- Không có notification backend.

### C-01 — JWT secret fail-open

Đã được xử lý ở Report 15: API fail-closed nếu `JWT_SECRET` thiếu/rỗng/placeholder/ngắn. Tuy nhiên **việc xoay vòng secret thật và vô hiệu token cũ** vẫn là việc vận hành chưa thực hiện.

### Next.js — cảnh báo phụ thuộc

`next@16.4.0` được cài ở cả Admin và Customer Web. Next.js phát hành bản vá ngoài chu kỳ ngày 14/10/2026 cho ba lỗ hổng; phiên bản hiện tại nằm trong vùng bị ảnh hưởng.

---

## 3. Nguyên nhân gốc

1. **Release gate chưa từng tồn tại trong repo.** Không có pipeline, không có backup drill, không có secret scan tự động.
2. **Backup chỉ được coi là “có file”, chưa được coi là “đã phục hồi được”.** Thiếu script, thiếu schema cô lập, thiếu log/kiểm chứng.
3. **Không có chính sách secret được mã hoá thành kiểm tra tự động.** JWT từng fail-open; không có guardrail chống commit `.env`/private key.
4. **Không có quy trình nâng cấp dependency bảo mật.** Next.js nằm ở bản bị ảnh hưởng; build nudge phát hiện nhưng chưa có quyết định nâng cấp.
5. **Thiếu observability/RBAC nên không thể vận hành sự cố ở production** dù CI xanh.

---

## 4. Thay đổi code và tài liệu

| File | Thay đổi | Trạng thái Git |
|---|---|---|
| `.github/workflows/ci.yml` | Workflow CI mới: typecheck, lint, unit, build, migrate test DB, E2E; không deploy | Untracked |
| `package.json` | Thêm `security:smoke`, `backup:db`, `restore:db` | Modified |
| `scripts/security-smoke.mjs` | Guardrail: tracked env/key, JWT fallback, CORS, secret pattern | Untracked |
| `scripts/backup-db.mjs` | Dump `mysqldump --single-transaction`, gzip, SHA-256 sidecar | Untracked |
| `scripts/restore-db.mjs` | Restore vào schema cô lập `*_test`/`*_restore`/`*_drill`; chặn production/trùng `DATABASE_URL` | Untracked |
| `docs/BACKUP-RESTORE-RUNBOOK.md` | Quy trình backup/restore, RPO/RTO đề xuất, drill log | Untracked |
| `apps/api/src/config/configuration.ts` | JWT fail-closed, kiểm tra độ dài/entropy/placeholder | Modified |
| `apps/api/src/auth/auth.module.ts`, `jwt.strategy.ts` | Bỏ fallback `CHANGE_ME` | Modified |
| `apps/api/.env.example` | Template không còn secret dùng được ngay | Modified |
| `apps/api/src/common/audit/audit-log.controller.ts` + Admin `/audit` | Audit viewer chỉ ADMIN | Untracked/Modified |
| `audit-reports/16`–`21` | Báo cáo xác minh | Untracked |

Không có migration mới cho CI/backup/security. Migration duy nhất của đợt hardening là `20261023000000_p0b_integrity_quarantine_refunds` (thuộc P0-B/C/D).

---

## 5. Kiểm tra CI

### 5.1. Cấu trúc đã parse

YAML được parse bằng thư viện `yaml`; kết quả lưu tại `verify-ci-structure.json`.

```json
{
  "validYaml": true,
  "name": "CI",
  "triggers": ["push", "pull_request", "workflow_dispatch"],
  "permissions": { "contents": "read" },
  "jobs": ["verify"],
  "jobName": "Typecheck, tests and build",
  "runsOn": "ubuntu-latest",
  "timeoutMinutes": 45,
  "services": ["mysql"],
  "mysqlImage": "mysql:8.4",
  "stepCount": 11,
  "hasDeployStep": false,
  "usesProductionSecretNames": [],
  "jobLevelDatabaseUrl": false,
  "testDatabaseUrlSet": true,
  "testJwtSecretSet": true
}
```

11 bước:

1. Checkout
2. Set up Node.js 24
3. `npm ci`
4. `npm run db:generate`
5. `npm run security:smoke`
6. `npm run typecheck`
7. `npm run lint`
8. `npm run test`
9. `npm run build`
10. `prisma migrate deploy` + `prisma migrate status` vào DB test dùng một lần
11. `npm run test:e2e`

### 5.2. Đánh giá

**Đạt:**

- Chỉ Trigger trên push/PR/workflow_dispatch; `permissions: contents: read`.
- Không có bước deploy, publish, release, SSH, kubectl, helm, terraform.
- Không dùng tên secret production (`PROD`, `LIVE`, `PAYMENT`, `SMTP`).
- MySQL 8.4 là service container tạm, schema `agrimarket_v2_test`.
- Không set `DATABASE_URL` ở cấp job; chỉ set `TEST_DATABASE_URL`, buộc test E2E dùng schema test.
- `TEST_JWT_SECRET` là khoá **chỉ dùng cho test**, không phải secret production.
- Có typecheck, lint, unit, build, migration, E2E; migration chỉ chạy trên DB dùng một lần.
- Timeout 45 phút; concurrency huỷ run cũ.

**Chưa đạt / rủi ro:**

- **Chưa chạy trên GitHub Actions.** Không có bằng chứng run xanh, thời gian, artifact hay log remote. Trạng thái: **NOT VERIFIED**.
- Workflow là file untracked; sẽ không chạy cho tới khi được commit/push.
- Không có branch protection, required checks, CODEOWNERS trong repo.
- Không có artifact upload (test report, coverage, build output).
- Không có dependency audit/SAST/secret scanning của GitHub; `security:smoke` chỉ kiểm 5 file.
- Không có Playwright/UI E2E trong pipeline.
- Không build Docker image, không kiểm tra deploy artifact.
- MySQL dùng mật khẩu root mặc định trong service container; chấp nhận được vì container dùng một lần, nhưng không được tái sử dụng ra ngoài CI.
- `npm run test` chạy unit/component của các workspace; E2E API là bước riêng. Không có E2E mobile trên thiết bị thật.

**Kết luận CI:** file hợp lệ và đúng hướng, nhưng **chưa thể coi là release gate** cho tới khi có run remote xanh và branch protection.

---

## 6. Quét secret trước bàn giao

### 6.1. Guardrail chính thức

```text
> agrimarket@1.0.0 security:smoke
> node scripts/security-smoke.mjs

Security smoke checks passed (5 files inspected).
```

Guardrail kiểm:

- tracked `.env`/`.env.*` (trừ `.env.example`), private key `.pem/.key/.p12/.pfx`, `id_rsa/...`;
- JWT config còn fail-closed và không hardcode secret;
- CORS không `origin: true`/`*`, giữ `credentials: false`;
- pattern private key, AWS access key, GitHub token, Stripe live key, gán secret literal trong source.

### 6.2. Quét mở rộng

Quét 182 file text trong `audit-reports/`, `.tmp-verify/final-hardening/` (log/script/json, bỏ ảnh và dump), `docs/`, `scripts/`, `.github/`, `apps/api/prisma/` và các file `.md` ở root. Không in giá trị khớp.

Kết quả: **12 match / 182 file**, tất cả thuộc một trong các nhóm sau:

| Nhóm | Số match | Đánh giá |
|---|---:|---|
| Tài liệu/report trích `.env.example` hoặc placeholder JWT | 3 | Không phải secret thật |
| Connection URI localhost/test DB (`root` + mật khẩu test) | 6 | Chỉ dùng cho MySQL local/CI dùng một lần |
| Script smoke dùng tài khoản seed/demo | 2 | Không dùng cho production; không được tái sử dụng |
| Tài liệu handoff nhắc credential local đã xoá | 1 | Chỉ là mô tả lịch sử, không chứa giá trị dùng được |

Không phát hiện:

- private key block;
- AWS access key, GitHub token, Stripe live key, Google API key, Slack token;
- connection URI tới host không phải localhost/test;
- mật khẩu production trong report/log/script.

### 6.3. File môi trường local

| File | Trạng thái Git | Số biến có giá trị | Tên biến (không in giá trị) |
|---|---|---:|---|
| `apps/api/.env` | Không tracked (gitignored) | 6 | `CORS_ORIGIN`, `DATABASE_URL`, `JWT_EXPIRES_IN`, `JWT_SECRET`, `PORT`, `TEST_DATABASE_URL` |
| `apps/admin-web/.env.local` | Không tracked | 1 | `NEXT_PUBLIC_API_BASE_URL` |
| `apps/mobile/.env` | Không tracked | 1 | `EXPO_PUBLIC_API_BASE_URL` |

Các file này không nằm trong Git và không được đưa vào báo cáo. Tuy nhiên chúng tồn tại trên máy dev; nếu máy bị chia sẻ/backup sai cách, cần coi là tài sản cần bảo vệ.

### 6.4. Khuyến nghị xoay vòng credential

> Không thay đổi mật khẩu/secret thật trong đợt này. Đây là khuyến nghị bắt buộc trước production.

1. **JWT_SECRET:** tạo secret mới ≥32 ký tự ngẫu nhiên; triển khai đồng thời với chấp nhận token cũ hết hạn hoặc thu hồi toàn bộ token; ghi thời điểm rotate.
2. **Tài khoản DB:** tách user ứng dụng/backup/read-only; xoay mật khẩu; không dùng `root` ngoài CI/local.
3. **SMTP:** dùng app password/credential riêng; không dùng mật khẩu hộp thư cá nhân.
4. **Payment/carrier (khi có):** lưu trong secret manager, không trong `.env` production; có quy trình rotate và audit.
5. **Tài khoản demo/seed:** không dùng lại mật khẩu demo ở bất kỳ môi trường thật; vô hiệu hoá tài khoản seed trên production.
6. **GitHub:** bật secret scanning + push protection; không commit `.env`; cân nhắc required review cho workflow.
7. **Bằng chứng:** lưu biên bản rotate (ngày, người, hệ thống) ngoài repo; không lưu giá trị secret.

---

## 7. Cảnh báo bảo mật Next.js

### 7.1. Hiện trạng phụ thuộc

| Thành phần | Giá trị |
|---|---|
| `apps/admin-web/package.json` | `"next": "16.4.0"`, `"eslint-config-next": "16.4.0"` |
| `apps/customer-web/package.json` | `"next": "16.4.0"`, `"eslint-config-next": "16.4.0"` |
| `package-lock.json` | `next@16.4.0`, integrity `sha512-N2C+9q89Z/oLrsepSRS4jRMtwmUZAoZuAHU0e9T6+sAB5DdhADmrnOW+zjYijlrYFmVfmQhGVGy9eMFoB7UgKg==` |
| `sharp` | `0.35.5` (deduped; API cũng dùng `0.35.5`) |
| Node CI | 24 |

### 7.2. Tái hiện lỗi build

Lệnh:

```text
npm run build --workspace @agrimarket/admin-web
npm run build --workspace @agrimarket/customer-web
```

Lần chạy đầu (log `verify-admin-build-attempt1.log`, `verify-customer-build.log`):

```text
▲ Next.js 16.4.0 (Turbopack)
...
> Build error occurred
Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.

**We strongly recommend you upgrade Next.js.**

This command stopped to show the upgrade recommendation. Retry the same command to continue the original task.
...
Reference: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
    at ignore-listed frames {
  exitCode: 1
}
```

Nguồn phát sinh: `node_modules/next/dist/lib/upgrade/nudge.js` — Next.js chủ động chặn lần build đầu và yêu cầu chạy lại. Đây là **build-time security nudge**, không phải stack trace của một lỗ hổng đang bị khai thác.

Lần chạy lại (log `verify-admin-build-attempt2.log`, `verify-customer-build-retry.log`):

```text
▲ Next.js 16.4.0 (Turbopack)
✓ Compiled successfully in 1954ms
✓ Generating static pages using 11 workers (31/31) in 1168ms
⚠ Your version of Next.js is affected by a known security vulnerability. This command is continuing after the upgrade reminder.
```

Admin build tạo 31 trang; Customer build cũng hoàn tất. Retry thành công **không** có nghĩa là phiên bản đã an toàn.

### 7.3. Advisory chính thức

Nguồn: https://nextjs.org/blog/nextjs-security-update-october-14-2026 (14/10/2026).

Bản vá: `next@16.4.1` (Active LTS) và `next@15.5.28` (Maintenance LTS).

Ba vấn đề:

1. **GHSA-673q-mjm6-r5xr** — RCE không xác thực trong `use cache` trả về nhiều typed array (Critical). Không có workaround; phải nâng cấp.
2. **CVE-2026-96889 / GHSA-2464-fhr4-w9xw** — RCE trong Image Optimization API khi dùng SVG, trên Linux glibc. Workaround: `sharp >= 0.35.5`.
3. **GHSA-p3m5-59mp-jv5r** — DoS qua Server Actions (High). Chỉ ảnh hưởng ứng dụng dùng Server Actions.

### 7.4. Đối chiếu với codebase

| Điều kiện khai thác | Kết quả kiểm tra | Ý nghĩa |
|---|---|---|
| `use cache` / Cache Components | Không tìm thấy trong `apps/admin-web/src`, `apps/customer-web/src`; Admin config ghi rõ Cache Components đang tắt | Không thấy đường khai thác lỗ hổng 1 trong code hiện tại |
| Server Actions (`"use server"`) | Không tìm thấy | Không thấy đường khai thác lỗ hổng 3 |
| `next/image` + Image Optimization | Chỉ một import ở Customer `Header.tsx` cho asset thiết kế; `next.config.ts` đặt `images.unoptimized: true` | Image Optimization API không nằm trong đường chạy sản phẩm |
| `sharp` | `0.35.5` | Thoả workaround của advisory số 2 |
| Chạy trên glibc Linux | Chưa có môi trường production để xác minh | **NOT VERIFIED** |

**Kết luận:** phiên bản dependency **được xác nhận là bị ảnh hưởng** theo advisory, nhưng **khả năng khai thác thực tế trên codebase này chưa được xác minh**. Không được kết luận “an toàn” chỉ vì không thấy `use cache`; cũng không được kết luận “đã bị khai thác”.

### 7.5. Khuyến nghị nâng cấp tối thiểu

- Chỉ nâng `next` và `eslint-config-next` từ `16.4.0` lên `16.4.1` ở **hai** app Admin/Customer.
- Cập nhật `package-lock.json`, chạy `npm ci`, sau đó `typecheck`, `lint`, `test`, `build` cho từng app.
- Giữ nguyên React 19.3, Ant Design, Mantine, Node 24 và các dependency không liên quan.
- Không chạy `next upgrade --agent=security ...`; không nâng major; không nâng toàn bộ dependency.
- Kiểm tra `sharp` vẫn `>= 0.35.5` sau khi cài.
- Tạo commit riêng cho dependency bump, có rollback bằng cách revert `package.json` + lockfile.
- Chưa thực hiện nâng cấp trong đợt này vì yêu cầu không thay đổi production code ngoài phạm vi xác minh.

---

## 8. Backup và restore

### 8.1. Backup

Lệnh (không in credential):

```text
npm run backup:db -- --out .tmp-verify/final-hardening/backup
```

Kết quả:

```text
Backing up 127.0.0.1:3306/agrimarket_v2_test -> ...\backup\agrimarket_v2_test-20261023T065534Z.sql.gz
Backup complete: 23275 bytes, sha256 e0d5b066d5182b2bbf176fdd59e6f621b468508e8d6d7a6b2290d47700146f77
Restore verification is still required: docs/BACKUP-RESTORE-RUNBOOK.md
```

Sidecar:

```json
{
  "database": "agrimarket_v2_test",
  "bytes": 23275,
  "sha256": "e0d5b066d5182b2bbf176fdd59e6f621b468508e8d6d7a6b2290d47700146f77",
  "compressed": true,
  "encryption": "not applied by this script; encrypt before offsite storage",
  "backupMethod": "mysqldump --single-transaction",
  "restoreVerified": false
}
```

### 8.2. Restore drill

- Dry run xác nhận dump tồn tại, checksum khớp sidecar, target `agrimarket_v2_restore`, MySQL client tồn tại.
- Restore thật vào schema cô lập `agrimarket_v2_restore` (không phải `agrimarket_v2`, không phải production).
- Đọc lại dữ liệu sau restore:

```json
{
  "counts": {
    "users": 6,
    "orders": 6,
    "orderItems": 9,
    "payments": 6,
    "refunds": 0,
    "movements": 18,
    "quarantine": 0,
    "returns": 1,
    "shipments": 6
  },
  "paidTotal": "628000",
  "latestOrder": {
    "code": "ORD-20261016-0006",
    "status": "PENDING_CONFIRMATION",
    "grandTotal": "140000",
    "payments": [{ "id": 1066, "status": "PENDING", "amount": "140000" }]
  }
}
```

- Seeded customer `mai.pham@agrimarket.vn` tồn tại; 14 sản phẩm ACTIVE.
- Sau drill, schema restore đã được xoá; chỉ còn `agrimarket_v2` và `agrimarket_v2_test`.

### 8.3. Giới hạn

- Đây là **local drill**, không phải restore production.
- Chưa đo thời gian restore đầy đủ để chứng minh RTO 4 giờ.
- Chưa thử với dữ liệu production-size, chưa thử khi DB đang chịu tải.
- Chưa mã hoá dump trước khi lưu offsite; sidecar ghi rõ `encryption` chưa áp dụng.
- Chưa có offsite copy, chưa có object lock/versioning.
- Sidecar vẫn ghi `restoreVerified: false`; chưa cập nhật thành `true` vì chưa có quy trình ký xác nhận.
- Chưa có lịch backup tự động, retention thực tế, alert khi backup fail.
- RPO 24h/RTO 4h trong runbook là **đề xuất kỹ thuật**, không phải SLA đã ký.

---

## 9. Migration và DB

```text
12 migrations found in prisma/migrations
Database schema is up to date!
```

- Không có migration mới cho CI/security/backup.
- Migration P0 hardening đã áp lên `agrimarket_v2_test`.
- Không chạy migration lên development/production.
- DB invariant audit sau toàn bộ test:

```json
{
  "negative_balances": 0,
  "bad_refunded_returns": 0,
  "refunded_without_quarantine": 0,
  "duplicate_refund_links": 0,
  "shipment_order_mismatch": 0,
  "open_adjustments": 0,
  "warehouse_return_without_quarantine": 0,
  "quarantine_blocked_mismatch": 0,
  "refund_over_payment": 0,
  "payout_over_settlement": 0
}
```

Các số 0 chứng minh invariant **sau test**, không chứng minh dữ liệu lịch sử production sạch.

---

## 10. Kiểm thử và log thô

| Kiểm tra | Lệnh | Kết quả | Log |
|---|---|---|---|
| Security smoke | `npm run security:smoke` | PASS — 5 file | `verify-security-smoke.log` |
| CI structure | parse `.github/workflows/ci.yml` | PASS — 1 job / 11 bước / không deploy | `verify-ci-structure.json` |
| Secret scan mở rộng | `node .tmp-verify/final-hardening/scan-secrets.mjs` | 182 file; 12 match đã triage; 0 production secret | `verify-secret-scan.json` |
| API unit | `npm run test --workspace @agrimarket/api` | **39 files / 531 tests PASS** | `verify-api-unit.log` |
| API E2E | `npm run test:e2e --workspace @agrimarket/api` | **18 files / 439 tests PASS** | `verify-api-e2e.log` |
| Admin unit | `npm run test --workspace @agrimarket/admin-web` | **7 files / 40 tests PASS** | `verify-admin-test.log` |
| Customer unit | `npm run test --workspace @agrimarket/customer-web` | **3 files / 37 tests PASS** | `verify-customer-test.log` |
| Mobile unit | `npm run test --workspace @agrimarket/mobile` | **19 files / 178 tests PASS** (API up) | `verify-mobile-test-with-api.log` |
| Shared domain | `npm run test --workspace @agrimarket/shared-domain` | **5 files / 65 tests PASS** | `verify-shared-domain-test.log` |
| Admin build | `npm run build --workspace @agrimarket/admin-web` | Lần 1 fail `SecurityFatalError`; lần 2 PASS | `verify-admin-build-attempt1.log`, `verify-admin-build-attempt2.log` |
| Customer build | `npm run build --workspace @agrimarket/customer-web` | Lần 1 fail; lần 2 PASS | `verify-customer-build.log`, `verify-customer-build-retry.log` |
| Migration status | `npx prisma migrate status` | 12 migration, up to date | `verify-migration-status.log` |
| Backup | `npm run backup:db` | 23.275 bytes, SHA-256 khớp | `backup-drill.log` |
| Restore | `npm run restore:db` + read smoke | Restore/read PASS; đã cleanup | `restore-drill.log`, `restore-read-smoke.log` |
| DB invariant | script audit read-only | tất cả 0 | `verify-db-invariant-audit.log` |

Không có bộ test tự động riêng cho `backup-db.mjs`/`restore-db.mjs`; bằng chứng là drill thủ công có log.

---

## 11. Trường hợp chưa xác minh

1. **Remote CI:** chưa có run GitHub Actions nào; chưa biết pipeline thực sự xanh hay đỏ.
2. **Branch protection/required checks:** chưa cấu hình/chưa kiểm tra trên GitHub.
3. **GitHub secret scanning/push protection:** chưa bật/chưa xác minh.
4. **Dependency audit tự động:** chưa chạy `npm audit` toàn diện trong CI; advisory Next.js được kiểm thủ công.
5. **SAST/DAST/penetration test:** chưa có.
6. **Playwright UI E2E:** chưa có bộ test; ảnh chụp chỉ là bằng chứng thủ công.
7. **SMTP thật:** chưa gửi mail thật; mail mặc định là capture.
8. **Payment gateway/carrier thật:** chưa tích hợp/chưa test sandbox.
9. **Backup offsite/encryption:** chưa có; chưa test restore từ offsite.
10. **RTO thực đo:** chưa có; 4 giờ là giả định.
11. **Production-size data/load:** chưa test.
12. **Next.js exploitability trên môi trường Linux thật:** chưa xác minh.
13. **Deploy/rollback:** chưa có Docker/artifact/rollback runbook.
14. **Metrics/tracing/alerting:** chưa có.
15. **RBAC/staff/partner portal:** chưa có; chỉ ADMIN/CUSTOMER.
16. **Audit retention/immutability:** chưa có chính sách.

---

## 12. Rủi ro nghiệp vụ

1. **CI xanh trên máy local không thay thế CI remote.** Nếu workflow sai môi trường, lỗi chỉ lộ khi push.
2. **Backup chưa được phục hồi ở production.** Một dump không restore được là backup vô giá trị; RPO/RTO chưa được cam kết.
3. **Secret local vẫn tồn tại trên máy dev.** Nếu máy bị compromise, JWT/DB credential có thể bị lộ; cần rotate trước production.
4. **Next.js lỗi thời.** Dù code hiện tại không thấy đường khai thác, dependency vẫn bị advisory; mọi thay đổi code sau này có thể vô tình bật `use cache`/Server Actions.
5. **Không có observability.** Sự cố DB/queue/lỗi thanh toán sẽ không có alert; MTTR không thể cam kết.
6. **Không có RBAC chi tiết.** Mọi ADMIN có toàn quyền; khó kiểm soát refund/payout/giá.
7. **Không có deploy/rollback.** Chưa thể phát hành lặp lại an toàn.
8. **RPO/RTO chưa được phê duyệt.** Không được dùng con số 24h/4h như cam kết với khách hàng.

---

## 13. Điều kiện nghiệm thu

- [x] CI YAML hợp lệ, không có bước deploy, không có secret production.
- [x] CI dùng MySQL test cô lập, migration chỉ trên DB dùng một lần.
- [x] `security:smoke` PASS; quét mở rộng không thấy production secret.
- [x] Backup có checksum; restore local vào schema cô lập và đọc dữ liệu thành công.
- [x] Migration test DB 12/12, up to date.
- [x] Audit viewer có API/UI chỉ ADMIN.
- [ ] CI chạy thật trên remote xanh — **NOT VERIFIED**.
- [ ] Branch protection/required checks — **NOT VERIFIED**.
- [ ] Backup offsite + mã hoá + restore production — **NOT VERIFIED**.
- [ ] RPO/RTO/retention/encryption owner được phê duyệt — **BUSINESS DECISION REQUIRED**.
- [ ] Xoay vòng JWT/DB/SMTP credential — **BUSINESS DECISION REQUIRED** (chưa thực hiện).
- [ ] Nâng `next@16.4.1` — **VERIFIED BUG — OPEN**, chưa thực hiện.
- [ ] Playwright UI E2E, SMTP thật, payment/carrier sandbox — **NOT VERIFIED**.
- [ ] Metrics/tracing/alerting, RBAC chi tiết, deploy/rollback — **NOT VERIFIED**.

---

## 14. Kết luận

C-19 đạt **PARTIALLY COMPLETE**: repo đã có CI hợp lệ về cấu trúc, guardrail secret, backup/restore script và audit viewer. Tuy nhiên **chưa có bằng chứng CI remote chạy xanh**, backup mới là drill local, chưa có offsite/encryption/RTO thực đo, chưa có observability/RBAC/deploy.

Next.js `16.4.0` là **VERIFIED BUG — OPEN** ở mức dependency: advisory chính thức xác nhận phiên bản bị ảnh hưởng; lỗi `SecurityFatalError` là build gate, không phải bằng chứng khai thác. Khuyến nghị tối thiểu là nâng `next`/`eslint-config-next` lên `16.4.1`, không nâng major/blanket.

**Không tuyên bố production-ready.** Trước khi phát hành thật cần: CI remote xanh + branch protection, backup offsite/restore được ký xác nhận, rotate credential, nâng Next.js bản vá, và phê duyệt RPO/RTO.
