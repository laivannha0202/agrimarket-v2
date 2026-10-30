# 24 — LOCAL VERIFICATION AND FEATURE COMPLETION

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `ec5e4a860c9087c01b6b17e862bd2539f50e2393`  
**Branch:** `fix/p0-a-security-pricing`  
**Ngày xác minh:** 24/10/2026  
**Run ID:** `20261024t114145ztety`  
**Evidence:** `.tmp-verify/c19/local-20261024t114145ztety/`  
**Kết luận điều hành:** **C-08, C-14 và C-19 — PASS.** C-19 chạy **20/20 bước PASS**, 0 fail, 0 skip; schema dùng một lần đã được drop. Đủ điều kiện để **xem xét commit local**. **PUSH / MERGE / DEPLOY / PRODUCTION — vẫn NO-GO** trong phiên này và chưa có bằng chứng staging/production.

---

## 1. Tóm tắt điều hành

| Hạng mục | Kết quả |
|---|---|
| C-08 — recovery sau quyết toán cần phê duyệt | **Hoàn tất** — `PENDING_APPROVAL`, chặn xác nhận và payout, không tự động trừ tiền, không ghi đè settlement lịch sử |
| C-14 — mùa vụ / nhật ký canh tác / thu hoạch / trace audit | **Hoàn tất** — dữ liệu do người nhập, validate đầy đủ, trace audit báo gap thay vì bịa sự kiện |
| C-19 — local verification gate | **PASS** — 19 bước chọn + cleanup = **20 passed, 0 failed, 0 skipped** |
| Thời gian chạy gate | 11:41:45 → 11:47:25 UTC (khoảng **5 phút 40 giây**) |
| Unit/component tests | **890 passed + 3 skipped** trên 77 file (76 pass + 1 skip) |
| API E2E | **464/464** test, 20 file |
| Stress concurrency | **53/53** test, 2 file, `CONCURRENCY_ROUNDS=10` |
| Business HTTP smoke | **72/72** check, 0 warning |
| UI route/asset smoke | **64/64** check, 37 Admin route + 18 Customer route tĩnh + 4 route động |
| Migrations | **14**, checksum khớp, drift exit 0 |
| DB invariants | **50** check, 18 lô bán được, **0 trace gap** |
| Backup/restore drill | **56 bảng / 464 dòng**, checksum và row count khớp, Prisma read smoke PASS |
| Security | **9** check PASS, 0 secret; API/Admin/Customer 0 high/critical |
| Database dùng một lần | Đã tạo, seed, test rồi **drop** (`databaseDropped: true`) |
| Commit/push/deploy | **Không thực hiện** |
| GitHub CI / Actions / branch protection | **Không chạm tới** |

---

## 2. Ràng buộc của phiên làm việc

Các ràng buộc sau được giữ trong toàn bộ quá trình xác minh:

1. **Không làm việc với GitHub CI:** không push, không chạy Actions, không sửa `.github/workflows/`, không đổi branch protection hay cấu hình repo.
2. **Không test trên DB thật:** mọi test ghi dữ liệu chạy trên schema tên `agrimarket_v2_c19_<token>_test`; `DATABASE_URL` của ứng dụng (`agrimarket_v2`) không bao giờ là target ghi.
3. **Không migrate dev/staging/production:** chỉ `prisma migrate deploy` vào schema dùng một lần.
4. **Không giao dịch tiền thật:** COD, settlement, payout, refund chỉ là dữ liệu demo/test.
5. **Không xoá hoặc skip test để ép PASS.** Ba test Mobile bị skip là skip có chủ đích cho native-only, không phải do gate.
6. **Không commit, push, merge, deploy, reset, clean hoặc xoá dữ liệu người dùng.**
7. **Không bịa dữ liệu C-14:** trace audit chỉ báo link thiếu; không backfill event, ngày, số lượng hay chứng nhận.
8. **Không viết lại settlement lịch sử:** C-08 tạo adjustment/recovery mới, giữ nguyên gross/payable của settlement gốc.

Playwright không được cài trong repo, nên UI chỉ được xác minh ở mức HTTP (route, HTML shell, asset), không phải browser interaction. Đây là **giới hạn đã ghi nhận**, không phải PASS giả.

---

## 3. Trạng thái repository

| Hạng mục | Giá trị |
|---|---|
| HEAD | `ec5e4a860c9087c01b6b17e862bd2539f50e2393` — không đổi |
| Branch | `fix/p0-a-security-pricing` |
| Commit mới | **0** |
| Modified tracked | **37** tại thời điểm chạy gate; **38** sau khi cập nhật runbook |
| Untracked | **34** tại thời điểm chạy gate; **35** sau runbook mới; **36** sau Report 24 |
| Tổng đường dẫn dirty | **71** lúc chạy gate (`37 M + 34 ??`); **74** sau runbook và Report 24 |
| Tracked diff hiện tại | khoảng **+2.406 / −695** (gồm cập nhật runbook) |
| Source thay đổi sau lần chạy cuối | **Không** — chỉ cập nhật/tạo tài liệu sau gate |
| `agrimarket_v2` | Không ghi |
| `agrimarket_v2_test` | Không chạm |
| Schema còn lại sau dọn dẹp | `agrimarket_v2`, `agrimarket_v2_test` |

Lưu ý về con số `dirtyFiles: 49` trong `summary.json`: script đếm bằng
`git status --porcelain` mặc định, nên Git gộp các thư mục untracked thành một
entry. Khi đếm từng file bằng `git status --porcelain -uall`, trạng thái lúc
chạy gate là **71** (37 modified + 34 untracked); sau khi thêm tài liệu, hiện là
**74** (38 modified + 36 untracked). Đây là khác biệt cách đếm, không phải file
lạ. Hai schema test dùng một lần còn sót từ các lần smoke thủ công
(`agrimarket_v2_c19_smoke_test`, `agrimarket_v2_c19_smoke_shadow_test`) đã được
drop sau khi kiểm tra chúng chỉ chứa dữ liệu demo/test; không đụng
`agrimarket_v2` hay `agrimarket_v2_test`.

---

## 4. C-08 — Recovery sau quyết toán cần phê duyệt

### 4.1. Vấn đề

Một refund hoàn tất **sau** khi settlement đã chốt tạo ra một khoản adjustment.
Nếu chọn `DEDUCT_NEXT`, cách làm cũ có thể tự động trừ vào payout kỳ sau. Điều
này vi phạm nguyên tắc:

- settlement lịch sử không được viết lại;
- quyết định trừ tiền theo chính sách phải có phê duyệt;
- payout không được chạy khi còn recovery chưa xử lý.

### 4.2. Thiết kế đã triển khai

Migration thứ 14 — `20261025000000_settlement_recovery_approval` — thêm:

- enum `SettlementRecoveryStatus`: `PENDING_APPROVAL`, `APPROVED`, `RECORDED`, `REJECTED`;
- bảng `settlement_recoveries` với `amount DECIMAL(18,2)`;
- unique `adjustment_id` (một adjustment chỉ có tối đa một recovery);
- FK tới `settlement_adjustments` và `partners`;
- các cột audit: `requested_by_user_id`, `approved_by_user_id`,
  `rejected_by_user_id`, `recorded_by_user_id`, thời điểm, lý do và
  `recovery_reference` (reviewer nằm trên adjustment nguồn).

Luồng trạng thái:

```text
Adjustment OPEN
  └─ review DEDUCT_NEXT
       └─ Recovery PENDING_APPROVAL     (không trừ tiền)
            ├─ approve  → APPROVED      (vẫn chặn payout)
            │    └─ record(reference) → RECORDED  (mở chặn)
            └─ reject(note) → REJECTED            (mở chặn)
```

Các guard chính trong `apps/api/src/finance/settlements.service.ts`:

| Guard | Hành vi |
|---|---|
| Adjustment còn `OPEN` | Chặn `settlements/:id/confirm` bằng 409 |
| Recovery `PENDING_APPROVAL`/`APPROVED` | Chặn confirm của settlement liên quan và chặn payout **theo toàn bộ partner** |
| `approve` | Bắt buộc note; chỉ từ `PENDING_APPROVAL`; ghi audit; **không** di chuyển tiền |
| `record` | Bắt buộc reference (bank/offset); chỉ từ `APPROVED`; mới mở payout |
| `reject` | Bắt buộc note; chỉ từ `PENDING_APPROVAL`; đóng block payout |
| Race | Khóa partner bằng `FOR UPDATE` + compare-and-set trên status |
| Lịch sử | Không UPDATE/DELETE settlement gốc; recovery là bản ghi riêng |

API (đều `ADMIN` + Bearer):

- `POST /api/v1/settlement-adjustments/:id/review`
- `GET /api/v1/settlement-recoveries`
- `POST /api/v1/settlement-recoveries/:id/approve`
- `POST /api/v1/settlement-recoveries/:id/reject`
- `POST /api/v1/settlement-recoveries/:id/record`

Admin UI `apps/admin-web/src/app/(admin)/settlements/page.tsx` hiển thị danh
sách recovery, trạng thái, số tiền, adjustment nguồn và các thao tác
approve/reject/record kèm note/reference.

### 4.3. Bằng chứng chấp nhận

`apps/api/test/c08-c14.e2e-spec.ts` — **7 test C-08**, tất cả PASS trong API E2E:

1. Tạo adjustment `OPEN`.
2. Confirm settlement bị chặn khi adjustment còn `OPEN`.
3. `DEDUCT_NEXT` tạo recovery `PENDING_APPROVAL`, **không** đổi settlement gốc
   (`payableAmount` vẫn 95.000; status vẫn `DRAFT`).
4. Confirm và payout vẫn bị chặn khi chờ duyệt; payout vẫn `PENDING`.
5. Approve xong vẫn chặn payout/confirm cho tới khi record.
6. Record bằng reference thật mở block; confirm và payout thành công; gross
   100.000 / payable 95.000 không bị viết lại; audit có đúng chuỗi
   `REQUEST → APPROVE → RECORD`.
7. Reject cũng đóng block và không tạo payout.

**Lưu ý kiểm soát nội bộ:** hệ thống cưỡng chế **một bước phê duyệt riêng** và
lưu actor của từng bước, nhưng không thể chứng minh hai người khác nhau nếu cùng
một tài khoản Admin thực hiện cả ba thao tác. Muốn maker-checker thực sự, phải
tách tài khoản/identity ở quy trình vận hành; đây là residual risk về con người,
không phải lỗi logic tiền.

---

## 5. C-14 — Mùa vụ, canh tác, thu hoạch và trace audit

### 5.1. Phạm vi

C-14 bổ sung dữ liệu truy xuất **có nguồn gốc con người**:

- `seasons` (mùa vụ) gắn farm, cây trồng, ngày trồng/dự kiến thu;
- `farming_events` (nhật ký canh tác) gắn season;
- `harvests` (vụ thu hoạch) gắn season, số lượng, đơn vị, grade;
- `trace_events` gắn lot (harvest được suy ra gián tiếp qua lot);
- Admin UI seasons/lots và endpoint audit chuỗi trace.

### 5.2. Validation

| Đối tượng | Quy tắc đã kiểm |
|---|---|
| Season | Farm phải `ACTIVE`; ngày bắt đầu/kết thúc hợp lệ; không tạo khoảng ngày vô lý; text rỗng bị từ chối |
| Season đã đóng | Không cho sửa, không cho thêm harvest/farming event |
| Farming event | Nội dung bắt buộc; timestamp không được ở tương lai; cập nhật có audit |
| Harvest | Ngày không tương lai, không trước ngày trồng; quantity > 0; không sửa xuống dưới tổng lượng đã cấp cho lot |
| Lot/trace | Trace audit trả về `checks[]` với `OK`/`MISSING`/`WARNING`; không tự sinh event |

Endpoint audit: `GET /api/v1/traceability/admin/lot/:lotId` (ADMIN). Endpoint
public vẫn là `GET /api/v1/traceability/:traceCode`.

Trace audit kiểm tra: lot + trace code, product/category, partner, harvest,
season, farm, event `HARVEST`, event `QC` (warning nếu thiếu), thứ tự thời gian
và hạn sử dụng. Kết quả seed cuối: **18 lô bán được, 0 gap**.

### 5.3. Bằng chứng chấp nhận

`apps/api/test/c08-c14.e2e-spec.ts` — **6 test C-14**, tất cả PASS:

1. Từ chối season cho farm inactive và khoảng ngày không hợp lệ.
2. Tạo season từ input thật; từ chối edit text rỗng.
3. Đóng season hoàn tất; từ chối edit/harvest/log sau đó.
4. Validate nội dung farming log, timestamp tương lai và audit trail.
5. Validate ngày harvest, số lượng và ceiling theo lot đã cấp.
6. Trace-chain gap được báo cáo, **không** tạo sự kiện giả.

Ngoài ra, `mutation-acceptance.e2e-spec.ts` mục B chạy trọn chuỗi
`partner → farm → season → harvest → lot`; invariant audit xác nhận 18 lot bán
được và 0 gap; Admin UI seasons/lots được build và route-smoke.

---

## 6. C-19 — Local verification gate

### 6.1. Cách chạy

```powershell
$env:DATABASE_URL = '<application URL>'   # chỉ để đối chiếu, không ghi
npm run verify:local
```

Script `scripts/local-verify.mjs`:

1. kiểm tra môi trường, công cụ, MySQL, migration và isolation;
2. tạo schema `agrimarket_v2_c19_<token>_test` mới;
3. chạy `migrate deploy`, seed demo, import 1 tỉnh + 104 xã;
4. chạy toàn bộ gate;
5. ghi evidence, manifest, SHA-256;
6. drop schema, trừ khi `--keep-db` hoặc `--reuse-db`.

Các option: `--only`, `--skip`, `--keep-going`, `--keep-db`, `--reuse-db`,
`--no-checkout`, `--skip-audit`, `--rounds`.

### 6.2. Kết quả từng bước

| # | Bước | Kết quả | Chi tiết |
|---:|---|---|---|
| 1 | `preflight` | PASS | 16 check; MySQL 8.0.46; 14 migration; Playwright unavailable (ghi nhận) |
| 2 | `generate` | PASS | Prisma client generated |
| 3 | `typecheck` | PASS | Toàn bộ workspace, 15.743 ms |
| 4 | `lint` | PASS | Toàn bộ workspace, 26.786 ms |
| 5 | `unit` | PASS | 890 passed + 3 skipped |
| 6 | `build` | PASS | API + Admin + Customer, 36.039 ms |
| 7 | `db-create` | PASS | Schema mới, 0 bảng |
| 8 | `db-migrate` | PASS | 14 migration, 12.851 ms |
| 9 | `db-seed` | PASS | 6 user, 14 product, 18 sellable lot, 6 order |
| 10 | `db-locations` | PASS | 1 tỉnh, 104 xã |
| 11 | `migrations` | PASS | 14 migration, checksum khớp, drift exit 0 |
| 12 | `invariants` | PASS | 50 check, 18 sellable lot, 0 gap |
| 13 | `backup` | PASS | 56 bảng / 464 dòng, dump 22.544 byte, restore khớp |
| 14 | `api-e2e` | PASS | 20 file / 464 test, 105.597 ms |
| 15 | `stress` | PASS | 2 file / 53 test, 10 vòng, 60.770 ms |
| 16 | `business-smoke` | PASS | 72 check, 0 warning |
| 17 | `invariants-final` | PASS | 50 check, 18 lot, 0 gap sau E2E/smoke |
| 18 | `security` | PASS | 9 check, 0 secret, audit PASS |
| 19 | `ui-smoke` | PASS | 64 route/asset check, Playwright unavailable |
| 20 | `cleanup` | PASS | Drop schema `agrimarket_v2_c19_20261024t114145ztety_test` |

`summary.json`: `result: PASS`, `selected: 19`, `passed: 20`, `failed: 0`,
`skipped: 0`, `databaseDropped: true`.

### 6.3. Unit/component tests

| Workspace | File | Test | Ghi chú |
|---|---:|---:|---|
| Admin Web | 8 | 48 | PASS |
| API | 42 | 565 | PASS |
| Customer Web | 3 | 37 | PASS |
| Mobile | 18 pass + 1 skip | 175 pass + 3 skip | 3 test native-only bị skip có chủ đích |
| Shared | 5 | 65 | PASS |
| **Tổng** | **77** | **890 pass + 3 skip** | |

### 6.4. API E2E và stress

- API E2E: **20 file, 464 test, 0 fail**, chạy trên schema cô lập.
- Các suite bao phủ: auth/RBAC, address auth, catalog, promotion/pricing,
  product image, mutation acceptance A–J, checkout lock, idempotency,
  release blockers, reports, warehouse, after-sales evidence, C-08/C-14.
- Address-auth không còn bị skip vì schema đã import đủ 1 tỉnh/104 xã.
- Stress: `concurrency.e2e-spec.ts` + `concurrency-money.e2e-spec.ts`,
  **53 test**, 10 vòng, PASS. Bao gồm order cancel/deliver race, refund/return
  over-claim, settlement, OPEN reconciliation, payout và stock operations.

### 6.5. Business smoke — 72 check

Các nhóm chính:

- login Admin/Customer, RBAC, đọc catalogue, trace public, trace Admin;
- customer addresses/orders/returnable/reviewable;
- cart add → checkout preview → **buy-now preview không mutate cart**;
- COD checkout tạo order `ORD-20261024-0494`, tổng 32.000;
- idempotent replay trả cùng order id `1280`; stock reservation `0 → 1`;
- cart được consume sau checkout; order detail có payment COD;
- Admin thấy đúng order của Customer (Admin–Customer sync);
- cancel order, release reservation, Admin thấy trạng thái `CANCELLED`;
- **45 mobile route** có trong **133 OpenAPI path**.

### 6.6. UI route/asset smoke — 64 check

- API health: database up;
- 37 Admin route (bao gồm login shell, danh sách/chi tiết sản phẩm, partner,
  lot, warehouse document, settlement…);
- 18 Customer route tĩnh;
- 4 route động: trace detail, product detail, farm detail, partner detail;
- 39 asset được tham chiếu, 0 lỗi.

Đây **không phải** browser E2E: không click, không login qua localStorage,
không thao tác bảng hay checkout bằng chuột.

---

## 7. Xác minh chức năng theo khu vực

| Khu vực | Nội dung đã xác minh | Bằng chứng chính | Kết quả |
|---|---|---|---|
| Login / RBAC | Register/login/validation, JWT, role Admin/Customer, từ chối quyền sai, address auth | `register-login-validation`, `p0-a-security-pricing`, `address-auth`, business smoke | PASS |
| Sản phẩm / truy xuất | Product public visibility, variant, trace code, trace audit, QR/lot | `release-blockers` C-11, `mutation-acceptance` I, C-14 E2E, UI smoke | PASS |
| Cart / buy-now / checkout | Add cart, preview, buy-now, promotion, address snapshot, stock reserve, idempotency | business smoke, `mutation-acceptance` F/F2, `p0-a-security-pricing` | PASS |
| Đơn hàng | State machine, order detail, cancel, Admin view, reservation release | business smoke, `mutation-acceptance` F, `release-blockers` C-17 | PASS |
| Shipment | Tạo shipment, cập nhật trạng thái, giao hàng, chặn transition sai | `mutation-acceptance` F, `concurrency` cancel/deliver race | PASS |
| COD | Checkout COD, payment record, đối soát, hủy đơn | business smoke, `mutation-acceptance` F/H, `concurrency-money` | PASS |
| Inventory | Inbound, adjust, reserve, release, FEFO/allocation, warehouse document | `mutation-acceptance` D/E, `warehouse-admin`, invariant audit | PASS |
| Quarantine / QC | QC điều khiển trạng thái lot; RETURN document quarantine tới khi QC release | `mutation-acceptance` C/D, `warehouse-admin` C2, invariants | PASS |
| Return / refund | Return request, claim ceiling, refund cap, evidence, concurrent over-claim | `mutation-acceptance` G, `evidence-aftersales`, `concurrency-money` BL-01/02, C-05/C-06 | PASS |
| Settlement / payout | Tạo settlement, confirm, adjustment, recovery C-08, payout idempotent, OPEN guard | `mutation-acceptance` H, `concurrency-money`, `idempotency*`, C-08 E2E | PASS |
| Harvest / farming | Farm active, season, farming log, harvest ceiling, lot/trace chain | C-14 E2E, `mutation-acceptance` B, invariants, Admin seasons UI | PASS |
| Admin–Customer sync | Cùng order/status nhìn thấy ở hai phía; address snapshot | business smoke `admin-customer-sync`, `admin-sees-cancelled-order` | PASS |
| Mobile API | 45 route mobile có trong 133 OpenAPI path; cùng tài khoản Web/Mobile | business smoke, mobile unit tests, register/login E2E | PASS |

**Giới hạn của bảng trên:** đây là xác minh API/HTTP/component trên dữ liệu
demo, không phải UAT nghiệp vụ với người dùng thật, không phải giao dịch tiền
thật và không phải browser E2E.

---

## 8. Security và dependency

| Hạng mục | Kết quả |
|---|---|
| Security smoke / guardrails | PASS |
| Tracked `.env` | 0 |
| Tracked private key | 0 |
| Secret pattern trong working tree | 517 file quét, **0 finding** |
| API production audit | 0 high/critical |
| Admin production audit | 0 high/critical |
| Customer production audit | 0 high/critical |
| Mobile production audit | 0 high/critical chưa được chấp nhận; **5 advisory high thuộc Expo build tooling được chấp nhận** |
| CORS | Không reflect wildcard; credentials tắt |
| Tổng advisory rows | 15 |

Năm advisory Mobile được chấp nhận có kiểm soát: `expo`, `@expo/cli`,
`@expo/code-signing-certificates`, `node-forge`, `zod`. Lý do: chỉ nằm trong
build tooling/CLI, không có đường vào runtime bundle, và chưa có bản Expo SDK
57/58 đã vá. Đây là **accepted risk**, không phải "0 high" tuyệt đối.

Dependency đã nâng trong phiên:

- NestJS 12.2.0;
- `multer` 2.5.0 (root override);
- `nodemailer` 10.2.1;
- Prisma/client/adapter 7.10.1.

`npm dedupe` đã đổi 23 package và bỏ 19 package khi xử lý override multer.
Typecheck, lint và unit test Mobile vẫn PASS, nhưng **chưa build native Expo**;
rủi ro này được nêu ở mục 10.

---

## 9. Migration, invariant và backup/restore

### 9.1. Migration

- 14 migration, file mới nhất:
  `20261025000000_settlement_recovery_approval`.
- Tất cả checksum khớp file.
- Không có migration lạ đã apply, không có migration fail/rollback.
- Shadow-schema drift: `No difference detected`.
- Assertion C-08: bảng/enum/decimal/unique/FK đúng.
- Assertion C-14: decimal(18,3), index season child, 8 cột NOT NULL.

### 9.2. Invariant

- 50 check, 0 violation.
- 18 lô bán được; **0 trace gap**.
- Audit chỉ đọc; không backfill event.
- Chạy lại sau E2E/smoke vẫn 50 check, 18 lot, 0 gap.

### 9.3. Backup/restore drill

| Hạng mục | Giá trị |
|---|---|
| Source | schema C-19 dùng một lần |
| Dump | `agrimarket_v2_c19_20261024t114145ztety_test-20261024T114405Z.sql.gz` |
| Kích thước | 22.544 byte |
| SHA-256 | `21f0b26bafac9ee43229b2f3c47f132c32af8b2a72b7621553b4534045678e49` |
| Target | `..._test_drill_mvmbzdwub39` (cô lập, drop sau kiểm tra) |
| Bảng / dòng | **56 bảng / 464 dòng** |
| So sánh | Tất cả row count và `CHECKSUM TABLE` khớp |
| Migration ledger | 14 migration |
| Prisma read smoke | users 6, orders 6, payments 6, productLots 19; paid total 628.000; trace `LOT-20261006-0001` / `TRC-000001-CACHU`, 3 event |
| Kết quả | **PASS (drill only)** |

Chi tiết đã ghi vào `docs/BACKUP-RESTORE-RUNBOOK.md`. Drill **không** chứng minh
backup định kỳ, encryption, offsite copy, alerting hay cutover production.

---

## 10. Residual risks và giới hạn

| # | Rủi ro / giới hạn | Mức | Trạng thái / hành động |
|---:|---|---|---|
| 1 | Không có browser E2E (Playwright không cài) | Trung bình | UI chỉ smoke HTTP; login/localStorage/table/checkout click chưa được browser xác minh. Cài Playwright và bổ sung spec khi môi trường cho phép. |
| 2 | 5 advisory high trong Expo build tooling | Trung bình | Accepted có kiểm soát; không có runtime bundle path; theo dõi bản Expo SDK vá. |
| 3 | `npm dedupe` thay đổi dependency graph; chưa build native Expo | Trung bình | Chạy `expo export`/EAS build và test trên thiết bị trước khi phát hành Mobile. |
| 4 | Chưa deploy/rollback staging hoặc production | Cao cho release | Runbook đã có (`docs/DEPLOYMENT-ROLLBACK-RUNBOOK.md`) nhưng chưa diễn tập thật. Cần owner + maintenance window. |
| 5 | Backup chưa mã hoá, chưa schedule/offsite/alerting; RPO 24h, không PITR | Cao về vận hành | Encrypt trước khi rời host; cấu hình job, giám sát, lưu offsite; cân nhắc binlog/PITR nếu cần RPO thấp hơn. |
| 6 | Chưa có UAT nghiệp vụ với người dùng thật | Trung bình | Các luồng đã test API/UI mức kỹ thuật; cần UAT cho quy trình thực tế. |
| 7 | Không test tiền thật / ngân hàng | Chấp nhận | Payout/refund chỉ ghi nhận nội bộ; tích hợp ngân hàng nằm ngoài phạm vi. |
| 8 | Maker-checker C-08 chỉ là bước phê duyệt, không ràng buộc hai danh tính khác nhau | Trung bình | Vận hành phải tách tài khoản Admin; nếu cần, bổ sung kiểm tra `recovery.approvedByUserId != adjustment.reviewedByUserId`. |
| 9 | Chất lượng trace phụ thuộc dữ liệu người nhập C-14 | Trung bình | Audit báo gap; cần quy trình nhập liệu và kiểm tra định kỳ, không backfill. |
| 10 | Chỉ xác minh trên Windows + MySQL 8.0.46 | Thấp | Linux/MySQL phiên bản khác chưa được chạy; kiểm tra lại trên môi trường đích. |
| 11 | SMTP/mail thật, upload storage, grant DB, cấu hình server chưa xác minh | Trung bình | Thuộc trách nhiệm môi trường; smoke trước khi mở traffic. |
| 12 | Demo seed chứa tài khoản/mật khẩu demo | Thấp | Không dùng seed cho production; đổi toàn bộ credential khi phát hành. |

---

## 11. Evidence và cách tái lập

### 11.1. Evidence

```text
.tmp-verify/c19/local-20261024t114145ztety/
├── summary.json                 # PASS, 19 selected / 20 passed / 0 failed
├── README.txt
├── manifest.json                # 41 file, 243.658 byte
├── SHA256SUMS.txt               # 41 entry
├── migrations.json
├── invariants.json
├── invariants-final.json
├── backup-restore.json
├── business-smoke.json
├── security-scan.json
├── ui-smoke.json
├── logs/                        # 01..19
└── backup-restore/              # dump, sidecar, log
```

`SHA256SUMS.txt` có 41 entry; `manifest.json` ghi 41 file / 243.658 byte. Dump
và log nằm trong `.tmp-verify/`, đã gitignore; không chứa credential thật
(URL trong evidence được redact).

### 11.2. Lệnh tái lập

```powershell
cd D:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc
$env:DATABASE_URL = '<application URL>'
npm run verify:local
```

Chạy lại một phần:

```powershell
npm run verify:migrations -- --url <isolated-test-url>
npm run verify:invariants -- --url <isolated-test-url>
npm run verify:backup   -- --url <isolated-test-url>
npm run verify:business -- --url <isolated-test-url>
npm run verify:ui       -- --url <isolated-test-url>
npm run verify:security
```

Không chạy các lệnh trên với URL của `agrimarket_v2`, staging hoặc production.

### 11.3. Môi trường

| Thành phần | Giá trị |
|---|---|
| Node.js | v26.12.0 |
| npm | 11.20.0 |
| Prisma | 7.10.1 |
| Next.js | 16.4.1 |
| MySQL | 8.0.46 |
| Platform | win32 x64 |
| Playwright | Không có (`@playwright/test` và `playwright` đều absent) |
| Build API base | `http://127.0.0.1:3100/api/v1` cho smoke; API/Admin/Customer lần lượt 3100/3101/3102 |

---

## 12. Kết luận và điều kiện tiếp theo

### 12.1. Đã đạt

- **C-08:** recovery không tự động trừ tiền; approval là bắt buộc; payout bị
  chặn theo partner tới khi record/reject; settlement lịch sử không bị viết lại;
  race được xử lý; có audit và Admin UI; 7 test chấp nhận PASS.
- **C-14:** season/farming/harvest/lot/trace có validate, audit và UI; trace gap
  được báo cáo thay vì bịa; 6 test chấp nhận PASS; seed và invariant khớp.
- **C-19:** gate local tự động hoá đầy đủ typecheck, lint, unit, build, E2E,
  stress, Admin/Customer/Mobile/Shared, migration, invariant, security, UI smoke,
  backup/restore, evidence và cleanup; **20/20 PASS**.
- Không có secret trong working tree; dependency runtime API/Admin/Customer
  không còn high/critical.
- Không chạm DB thật, không migrate ngoài schema test, không giao dịch tiền thật,
  không xoá/skip test để PASS, không commit/push/deploy.

### 12.2. Chưa đạt / cần trước khi phát hành

1. Bổ sung browser E2E (Playwright) cho login, RBAC UI, bảng, checkout và trace.
2. Build native Expo và kiểm tra 5 advisory tooling.
3. Diễn tập deploy + rollback trên staging với backup thật đã mã hoá.
4. Thiết lập backup schedule/offsite/alerting; quyết định RPO/RTO và PITR.
5. Chạy UAT nghiệp vụ và xác nhận maker-checker C-08 bằng hai tài khoản Admin.
6. Có phê duyệt của owner trước khi commit/push/deploy.

### 12.3. Trạng thái phát hành

| Môi trường | Kết luận |
|---|---|
| Local verification | **GO** |
| Commit local | **GO** — chờ chỉ thị của người dùng; hiện worktree vẫn dirty có chủ đích |
| Push / merge | **NO-GO trong phiên này** — không thực hiện |
| Staging / UAT | **NO-GO** — chưa triển khai, chưa có browser E2E/UAT |
| Production | **NO-GO** — chưa diễn tập cutover/rollback, backup vận hành chưa xác minh |

Report này chỉ xác nhận những gì đã chạy và đã được ghi bằng chứng. Các mục
"chưa đạt" ở trên không được hiểu là đã PASS.
