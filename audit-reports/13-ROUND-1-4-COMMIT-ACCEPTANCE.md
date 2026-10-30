# 13 - ROUND 1–4: COMMIT ACCEPTANCE

## Tóm tắt chứng minh: đã tạo **một commit local** cho 36 file app/schema/migration/test sau khi tái kiểm tra toàn bộ ma trận; không push, không merge, không deploy, không áp migration ngoài test DB

> **Thông tin audit**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Branch: `fix/bl-01-02-settlement-con-01`
> - Commit cha: `90c28de8f773af2b266b96979f9508155e9523fe`
> - **Commit nghiệm thu: `5b35b974bae65f308cfdce3ab23a6aec959f2916`**
> - Thời điểm commit: author `2026-10-23 04:57:17 +0700`, committer `2026-10-23 05:00:31 +0700` (Asia/Ho_Chi_Minh)
> - Phạm vi: Round 1–4 — BL-01, BL-02, BL-06, BL-07, checkout lock-order, idempotency DB-backed cho adjust/payout/refund, migration settlement unique + idempotency ledger
> - DB ghi dữ liệu/test: **chỉ** `agrimarket_v2_test` qua `TEST_DATABASE_URL`; dev `agrimarket_v2` chỉ đọc metadata, **không ghi**
> - Bằng chứng: `.tmp-verify/commit-acceptance/` (gitignored) + backup ngoài repo
> - Nguyên tắc: chỉ kết luận từ test chạy thật; không sửa assertion để PASS; không che giấu lỗi; không tuyên bố production-ready

---

## 1. Kết luận nghiệm thu

| Gate | Kết quả |
|---|---|
| Đúng branch, đúng commit cha | PASS — `fix/bl-01-02-settlement-con-01`, parent `90c28de` |
| Working tree trước commit được đối soát đầy đủ | PASS — 25 file tracked modified + 11 file app/test mới; 12 báo cáo + 1 tài liệu chủ dự án ngoài phạm vi |
| Backup ngoài repo | PASS — 49/49 file đối chiếu SHA-256 khớp; patch tracked `git apply --check --cached` exit 0 |
| `git diff --check` trước commit | PASS — exit 0 |
| Không có secret/DB dump/log/PII trong phạm vi commit | PASS — quét thủ công + theo mẫu; chỉ có mật khẩu fixture tổng hợp |
| API typecheck / lint / build | PASS — exit 0; lint còn 3 warning có sẵn từ HEAD |
| API unit | PASS — 34 file / **440 test** |
| API full E2E | PASS — 16 file / **408 test**, 90,58 giây |
| Stress đồng thời 30 vòng | PASS — 3 file / **52 test**, 183,29 giây |
| Admin-web typecheck + test | PASS — typecheck exit 0; 7 file / **40 test** |
| Customer-web typecheck + test | PASS — typecheck exit 0; 3 file / **37 test** |
| Migration trên test DB | PASS — 11 migration; unique index settlement; bảng + unique index + FK idempotency; 0 fixture sót |
| Migration trên dev DB | ĐÚNG PHẠM VI — 9 migration, không có 2 migration mới; không ghi |
| Commit được tạo | PASS — `5b35b97`, 36 file, `+4180 / −209` |
| Sau commit: staged rỗng, tracked tree sạch | PASS — chỉ còn 14 file tài liệu untracked |
| Push / merge / deploy / migration ngoài test DB | **KHÔNG thực hiện** |
| Kết luận go-live | **NO-GO** — giữ nguyên các blocker JWT fail-closed, CI, backup/restore |

**Kết luận:** commit local `5b35b97` **đủ điều kiện nghiệm thu phạm vi Round 1–4** để tiếp tục hoàn thiện trên feature branch. Đây **không phải** kết luận production-ready và **không** phải khuyến nghị merge vào `main`/production ở thời điểm này.

---

## 2. Trạng thái Git trước và sau commit

### 2.1 Trước commit

| Hạng mục | Giá trị |
|---|---|
| HEAD | `90c28de8f773af2b266b96979f9508155e9523fe` |
| Branch | `fix/bl-01-02-settlement-con-01` |
| Tracked modified | 25 file |
| App/test untracked | 11 file |
| Tài liệu untracked | `audit-reports/01…12`, `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` |
| Staged | 36 file, `+4180 / −209` |
| `git diff --check` | exit 0 |
| `git diff --cached --check` | exit 0 |

### 2.2 Sau commit

| Hạng mục | Giá trị |
|---|---|
| HEAD | `5b35b974bae65f308cfdce3ab23a6aec959f2916` |
| Parent | `90c28de8f773af2b266b96979f9508155e9523fe` |
| Commit subject | `feat(api): idempotent money/stock mutations, checkout lock order and settlement guards` |
| Staged diff | rỗng |
| Tracked working tree | sạch (`git diff HEAD` rỗng) |
| Untracked còn lại | 14 file tài liệu: 13 báo cáo audit + 1 tài liệu chủ dự án |
| `git diff-tree --check HEAD` | sạch |
| Push | **không** |
| Merge/rebase/tag | **không** |

`git status --porcelain` sau commit chỉ còn:

```text
?? AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md
?? audit-reports/
```

Không có file ứng dụng nào bị bỏ sót hoặc bị sửa sau khi commit.

---

## 3. Danh tính commit

```text
commit 5b35b974bae65f308cfdce3ab23a6aec959f2916
parent 90c28de8f773af2b266b96979f9508155e9523fe
author laivannha0202 <nguoikhongten02022005@gmail.com>
date   Fri Oct 23 04:57:17 2026 +0700

    feat(api): idempotent money/stock mutations, checkout lock order and settlement guards

    Add DB-backed Idempotency-Key claim/replay/TTL for refunds, payouts
    and inventory adjustments. Enforce warehouse-first shared lock order
    at checkout to prevent deadlocks. Cap refunds by paid amount and
    payouts by remaining payable, lock return claims, and make inventory
    adjustments atomic. Add per-partner settlement line uniqueness plus
    schema, migrations, and unit/E2E coverage.
```

**Ghi chú amend:** commit được amend **một lần** chỉ để chỉnh message cho đúng (checkout đã có idempotency từ trước; commit này thêm lock-order, không thêm idempotency checkout). Tree, 36 file và nội dung `+4180 / −209` **không đổi**; SHA cuối là `5b35b974bae65f308cfdce3ab23a6aec959f2916`.

Commit message bao phủ đủ bốn nhóm nội dung bắt buộc: **idempotency, concurrency/lock-order, settlement, inventory**.

---

## 4. Danh sách 36 file đã commit

### 4.1 Admin-web (5 file)

| File | Trạng thái |
|---|---|
| `apps/admin-web/src/app/(admin)/inventory/page.tsx` | M |
| `apps/admin-web/src/app/(admin)/settlements/page.tsx` | M |
| `apps/admin-web/src/lib/api/client.ts` | M |
| `apps/admin-web/src/lib/api/idempotency.ts` | **A** |
| `apps/admin-web/src/lib/api/resources.ts` | M |

### 4.2 API — idempotency core (4 file)

| File | Trạng thái |
|---|---|
| `apps/api/src/common/decorators/idempotency-key.decorator.ts` | **A** |
| `apps/api/src/common/idempotency/idempotency.constants.ts` | **A** |
| `apps/api/src/common/idempotency/idempotency.module.ts` | **A** |
| `apps/api/src/common/idempotency/idempotency.service.ts` | **A** |

### 4.3 API — nghiệp vụ (11 file)

| File | Trạng thái |
|---|---|
| `apps/api/src/finance/finance.controller.ts` | M |
| `apps/api/src/finance/finance.module.ts` | M |
| `apps/api/src/finance/settlements.service.ts` | M |
| `apps/api/src/inventory/inventory.controller.ts` | M |
| `apps/api/src/inventory/inventory.module.ts` | M |
| `apps/api/src/inventory/inventory.service.ts` | M |
| `apps/api/src/orders/orders.service.ts` | M |
| `apps/api/src/payments/payments.controller.ts` | M |
| `apps/api/src/payments/payments.module.ts` | M |
| `apps/api/src/payments/payments.service.ts` | M |
| `apps/api/src/returns/returns.service.ts` | M |

### 4.4 Schema và migration (3 file)

| File | Trạng thái |
|---|---|
| `apps/api/prisma/schema.prisma` | M |
| `apps/api/prisma/migrations/20261019000000_settlement_line_unique_partner_order/migration.sql` | **A** |
| `apps/api/prisma/migrations/20261022000000_app_idempotency_keys/migration.sql` | **A** |

### 4.5 Test (13 file)

| File | Trạng thái |
|---|---|
| `apps/api/test/business-rules/evidence-aftersales.spec.ts` | M |
| `apps/api/test/business-rules/inventory.spec.ts` | M |
| `apps/api/test/business-rules/refund.spec.ts` | M |
| `apps/api/test/business-rules/settlement.spec.ts` | M |
| `apps/api/test/checkout-lock-order.e2e-spec.ts` | **A** |
| `apps/api/test/concurrency-money.e2e-spec.ts` | **A** |
| `apps/api/test/concurrency.e2e-spec.ts` | M |
| `apps/api/test/helpers/concurrency-fixtures.ts` | M |
| `apps/api/test/helpers/e2e-fixtures.ts` | M |
| `apps/api/test/helpers/pdf-text.ts` | M |
| `apps/api/test/idempotency-http.e2e-spec.ts` | **A** |
| `apps/api/test/idempotency.e2e-spec.ts` | **A** |
| `apps/api/test/mutation-acceptance.e2e-spec.ts` | M |

**Tổng: 36 file (`+4180 / −209`).** Không có file nào ngoài danh sách trên được stage.

---

## 5. File bị loại trừ khỏi commit

| Nhóm | File / thư mục | Lý do |
|---|---|---|
| Báo cáo audit | `audit-reports/01…13` | Tài liệu kiểm toán, không phải mã ứng dụng; commit riêng khi chủ dự án duyệt |
| Tài liệu chủ dự án | `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` | Tài sản riêng của chủ dự án, không tự ý đưa vào commit |
| Bằng chứng test | `.tmp-verify/**` | Gitignored; log, script, probe, DB evidence |
| Backup | `C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-round1-4-commit-backup-20261023-044812` | Ngoài repo |
| Secret / môi trường | `.env`, `.env.*`, biến môi trường | Không commit |
| DB dump / dữ liệu | `*.sql`, `*.dump`, backup DB | Không commit |
| Log / file cá nhân | `*.log`, file tạm, tài liệu cá nhân | Không commit |
| Dependency / generated | `node_modules`, `dist`, `coverage`, Prisma generated | Không commit |

Đã xác nhận: **không có báo cáo audit, tài liệu chủ dự án, `.env`, DB dump hoặc log nào nằm trong 36 file staged/committed.** Báo cáo 13 này được tạo **sau** commit và hiện là untracked.

---

## 6. Kiểm chứng BL-01 / BL-02 / BL-06 / BL-07

| Issue | Cơ chế đã sửa | Vị trí mã | Bằng chứng test | Kết quả |
|---|---|---|---|---|
| **BL-01** — refund vượt paid / double refund | Khóa `payment` bằng `SELECT … FOR UPDATE`, đọc lại tổng refund **sau** khi có khóa, chặn tổng refund vượt số đã trả; idempotency cho retry | `apps/api/src/payments/payments.service.ts` | `test/business-rules/refund.spec.ts`, `concurrency-money.e2e-spec.ts`, `idempotency*.e2e-spec.ts` | VERIFIED FIXED |
| **BL-02** — hai return claim cùng lúc | Khóa row return/claim trước khi đổi trạng thái; không cho hai yêu cầu cùng xử lý một claim | `apps/api/src/returns/returns.service.ts` | `test/business-rules/evidence-aftersales.spec.ts` | VERIFIED FIXED |
| **BL-06** — payout vượt payable / double payout | Khóa payout context + đọc lại số còn phải trả sau khóa; chặn vượt payable; idempotency | `apps/api/src/finance/settlements.service.ts` | `test/business-rules/settlement.spec.ts`, `concurrency-money.e2e-spec.ts` | VERIFIED FIXED |
| **BL-07** — adjust tồn kho không atomic | Chuyển sang câu `UPDATE … SET reserved/on_hand … WHERE điều kiện` atomic, kiểm tra lại predicate dưới khóa; idempotency | `apps/api/src/inventory/inventory.service.ts` | `test/business-rules/inventory.spec.ts`, `concurrency.e2e-spec.ts` | VERIFIED FIXED |
| **Checkout lock-order** — deadlock cancel/inbound | Pre-lock toàn bộ warehouse liên quan theo thứ tự cố định **trước** khi claim balance; giữ thứ tự `warehouse → balance` | `apps/api/src/orders/orders.service.ts` (`lockCheckoutWarehouses`, `reserveLine`) | `checkout-lock-order.e2e-spec.ts`; reproducer trước fix 10/10 + 10/10 reject, sau fix 0 reject; stress 30 vòng | VERIFIED FIXED |

Chi tiết trước/sau fix và reproducer nằm trong báo cáo `09`, `10`, `11`, `12`; báo cáo này chỉ xác nhận **mã hiện tại + test hiện tại** khớp kết luận đó.

---

## 7. Hợp đồng `Idempotency-Key` và call site Admin

### 7.1 Hợp đồng API

| Thuộc tính | Hành vi |
|---|---|
| Endpoint bắt buộc header | `POST /api/v1/inventory/adjust`, `POST /api/v1/payouts`, `POST /api/v1/refunds` |
| Thiếu header | **400** trước khi ghi bất kỳ dữ liệu nào |
| Header quá dài | **400** — tối đa **100** ký tự |
| Phạm vi khóa | Unique `(scope, actor_user_id, key)` — cùng key khác actor hoặc khác endpoint là hai operation độc lập |
| Cùng key + cùng payload | Replay response đã lưu; **không** chạy lại nghiệp vụ |
| Cùng key + payload khác | **409** — không ghi dữ liệu |
| Request đang xử lý | **409** — “still being processed, please retry” |
| Nghiệp vụ thất bại | Transaction rollback xóa claim; cùng key được thử lại ngay, không kẹt PENDING |
| Lưu response | `response_json` + `response_status` ghi **trước commit**, cùng transaction với nghiệp vụ |
| TTL mặc định | **30 ngày** (`DEFAULT_IDEMPOTENCY_RETENTION_DAYS`), override bằng `IDEMPOTENCY_RETENTION_DAYS` > 0 |
| Purge | Lúc khởi động + mỗi **6 giờ**; key hết hạn được coi như chưa dùng |
| Hash payload | SHA-256 trên JSON canonical (sort key, bỏ `undefined`, giữ thứ tự array, Date → ISO) |

### 7.2 Call site Admin

| Endpoint | Hàm client | Header | Trạng thái |
|---|---|---|---|
| Adjust tồn kho | `adjustInventory(body, idempotencyKey)` — `resources.ts:134` | `Idempotency-Key` | PASS |
| Tạo payout | `createPayout(body, idempotencyKey)` — `resources.ts:187` | `Idempotency-Key` | PASS |
| Tạo refund | Chưa có call site Admin-web | — | **GAP** — API đã bắt buộc header nhưng UI Admin chưa có luồng tạo refund |

Helper `apps/admin-web/src/lib/api/idempotency.ts` giữ **một key cho một payload form không đổi** trong lúc retry; payload đổi hoặc submit thành công sẽ sinh key mới. Trang inventory và settlements đã truyền key vào hai call site trên.

**Lưu ý rollout:** đây là thay đổi hợp đồng có chủ đích. API và admin-web phải deploy cùng nhau; client cũ không gửi header sẽ nhận 400 (R4-12/R4-21).

---

## 8. Trạng thái migration

### 8.1 Thứ tự và nội dung

| Migration | Nội dung | Thứ tự |
|---|---|---|
| `20261019000000_settlement_line_unique_partner_order` | `ALTER TABLE settlement_lines ADD UNIQUE INDEX settlement_lines_partner_order_id_key (partner_order_id)` | Trước |
| `20261022000000_app_idempotency_keys` | Bảng `app_idempotency_keys` + unique `(scope, actor_user_id, key)` + index `expires_at` + FK `actor_user_id → users.id` | Sau |

Hai migration **không phụ thuộc nhau**; thứ tự lexicographic hiện tại đúng và đã được áp theo đúng thứ tự trên test DB.

### 8.2 Trạng thái môi trường

| Môi trường | Số migration | Settlement unique | Bảng idempotency | Ghi chú |
|---|---|---|---|---|
| Test `agrimarket_v2_test` | **11** | Có — `NON_UNIQUE = 0` | Có — bảng + unique + FK | Đã áp; checksum file hiện tại khớp metadata |
| Dev `agrimarket_v2` | **9** | **Không** | **Không** | Chỉ đọc metadata; **không ghi** trong nhiệm vụ này |
| Staging / production | — | — | — | **Không áp**, không kiểm tra trong nhiệm vụ này |

Chi tiết test DB:

- `settlement_lines_partner_order_id_key`: `NON_UNIQUE = 0`.
- `app_idempotency_keys_scope_actor_user_id_key_key`: `NON_UNIQUE = 0`, thứ tự cột `scope, actor_user_id, key`.
- `app_idempotency_keys_expires_at_idx`: index thường.
- FK `app_idempotency_keys_actor_user_id_fkey` tồn tại.
- Sau test: `e2eUsers = 0`, `ccUsers = 0`, `idemRows = 0` — không còn fixture sót.

### 8.3 Rủi ro checksum — bắt buộc đọc trước khi deploy

- File migration settlement hiện tại có SHA-256 `a09467d7bdaae88824b7c9ffc2899ec43342b0a47615634f6d2061deaf233f6d`; test DB ghi đúng checksum này.
- Báo cáo `12` đã disclosure: metadata checksum trên **test DB** từng được sửa **chỉ trên test DB** sau khi nội dung comment migration thay đổi.
- Bất kỳ môi trường nào đã áp migration này với **bản comment/checksum cũ** sẽ có drift trong `_prisma_migrations`. **Không tự sửa metadata** và **không sửa file migration đã áp**; phải xử lý bằng runbook riêng (đối chiếu checksum, quyết định repair có phê duyệt, backup trước).
- Không có migration nào được áp lên dev/staging/production trong nhiệm vụ này.

---

## 9. Bằng chứng test của lần nghiệm thu

Tất cả chạy trên test DB `agrimarket_v2_test`; log tại `.tmp-verify/commit-acceptance/`.

| Lệnh / phạm vi | Kết quả | Thời gian | Log |
|---|---|---|---|
| API typecheck | exit 0 | — | `api-typecheck.log` |
| API lint | exit 0; 3 warning có sẵn | — | `api-lint.log` |
| API unit | **34 file / 440 test PASS** | 9,99 s | `api-unit.log` |
| API full E2E | **16 file / 408 test PASS** | 90,58 s | `api-e2e-full.log` |
| Stress đồng thời 30 vòng | **3 file / 52 test PASS** | 183,29 s | `stress-conc-30.log` |
| Admin-web typecheck | exit 0 | — | `admin-typecheck.log` |
| Admin-web test | **7 file / 40 test PASS** | 9,59 s | `admin-test.log` |
| Customer-web typecheck | exit 0 | — | `customer-typecheck.log` |
| Customer-web test | **3 file / 37 test PASS** | 0,46 s | `customer-test.log` |
| API build | exit 0 | — | `api-build.log` |
| Kiểm tra DB sau test | 11 migration; index/table đúng; 0 fixture | — | `db-state-after-tests.log` |

### 9.1 Warning lint

Chỉ còn 3 warning **có sẵn từ HEAD**, không phát sinh từ commit này:

- `test/concurrency.e2e-spec.ts:394` — `require-array-sort-compare` (2 warning).
- `test/warehouse-admin.e2e-spec.ts:271` — `require-array-sort-compare` (1 warning).

Không có warning mới trong các file idempotency/lock-order.

### 9.2 Phạm vi test đã chạy

- API unit: toàn bộ suite.
- Full E2E: toàn bộ 16 file, gồm checkout, concurrency, money, settlement, refund, return, PDF, trace, admin, idempotency HTTP.
- Stress: 30 vòng cho các spec đồng thời trọng yếu (money/stock/checkout).
- Admin: toàn bộ 40 test component/logic hiện có.
- Customer: toàn bộ 37 test hiện có.

**Không chạy lại mobile trong lần nghiệm thu này**; báo cáo `12` ghi nhận mobile 175 PASS ở vòng trước. Không suy diễn kết quả mobile từ lần chạy này.

---

## 10. An toàn dữ liệu, backup và secret

### 10.1 Backup ngoài repo

- Đường dẫn: `C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-round1-4-commit-backup-20261023-044812`
- Manifest: `meta\sha256-manifest.csv`
- Patch tracked: `meta\tracked-changes.patch`
- Kết quả: **49/49 file đối chiếu SHA-256 khớp**; `git apply --check --cached` exit 0.
- Backup chứa cả 11 file mới (trong đó có 2 migration) — không chỉ file tracked.

### 10.2 Cô lập DB

- Mọi test/probe ghi dữ liệu chỉ chạy trên `agrimarket_v2_test`.
- Dev `agrimarket_v2`: chỉ đọc metadata; xác nhận **9 migration**, không có settlement unique, không có bảng idempotency.
- Không chạy `prisma migrate deploy`, không chạy SQL tay trên dev/prod.
- Sau test: không còn user/fixture/idempotency row sót.

### 10.3 Secret scan

- Không phát hiện secret thật, private key, token, mật khẩu production hoặc connection string thật trong phạm vi commit.
- Chỉ có mật khẩu fixture tổng hợp trong test và assignment `process.env.DATABASE_URL = TEST_URL` (không chứa giá trị thật).
- `.env` và DB dump nằm ngoài commit.

---

## 11. Rủi ro còn mở

| ID | Rủi ro | Mức | Trạng thái | Điều kiện đóng |
|---|---|---|---|---|
| RR13-01 | Idempotency chỉ dedupe trong **30 ngày**; sau expiry/purge, retry chậm có thể tạo operation thứ hai nếu business cap còn headroom | **Trung bình–cao** (tài chính/tồn kho) | Chấp nhận có kiểm soát | Chốt retention theo nghiệp vụ; bổ sung immutable transaction identity/ledger dedupe nếu cần |
| RR13-02 | Checksum migration settlement có thể drift ở môi trường đã áp bản comment cũ | Trung bình | Đã disclosure | Runbook đối chiếu + repair có phê duyệt; không sửa metadata tùy tiện |
| RR13-03 | JWT secret fail-open: fallback `'CHANGE_ME'` ở `configuration.ts`, `auth.module.ts`, `jwt.strategy.ts` | **Cao — go-live blocker** | Chưa sửa | Fail-closed khi thiếu/yếu secret + test khởi động thất bại |
| RR13-04 | Không có CI (`.github/workflows` không tồn tại); toàn bộ ma trận chạy tay | **Cao — go-live blocker** | Chưa có | Pipeline PR/push chạy typecheck/lint/unit/E2E với DB test |
| RR13-05 | Chưa có backup/restore drill tự động cho DB | **Cao — go-live blocker** | Chưa có | Lịch backup + restore thử + log kiểm chứng |
| RR13-06 | Các endpoint khác chưa idempotent: inbound, tạo settlement, tạo payment, pay payout, update return… | Trung bình | Ngoài phạm vi | Change request riêng, không suy diễn từ 3 endpoint đã làm |
| RR13-07 | Chưa chạy crash injection sau commit trước HTTP response; chưa có 30-way HTTP thật | Thấp–trung bình | NOT VERIFIED | Bổ sung test crash/HTTP tải nếu cần bằng chứng vận hành |
| RR13-08 | Admin-web chưa có UI tạo refund; chưa có Playwright E2E UI thật | Trung bình | Carry-over | Bổ sung UI refund + E2E UI trước go-live |
| RR13-09 | SMTP/HTTPS/monitoring/rate-limit/audit retention chưa xác minh đầy đủ | Trung bình | Carry-over | Xác minh cấu hình + bằng chứng vận hành |
| RR13-10 | Migration mới chưa áp dev/staging/prod; chưa đo thời gian ALTER trên clone prod-like | Trung bình | Chờ triển khai | Chạy kế hoạch migration có backup + pre-check + staging rehearsal |
| RR13-11 | Stress mới 30 vòng, chưa chạy 60 vòng tùy chọn | Thấp | Đã ghi nhận | Chạy `CONCURRENCY_ROUNDS=60` nếu chủ dự án yêu cầu |
| RR13-12 | Suite E2E tự skip khi thiếu `TEST_DATABASE_URL` | Thấp | Theo thiết kế | CI phải cấu hình DB test để tránh “xanh giả” |
| RR13-13 | Purge idempotency chỉ log warn, không metric/alert; lệch đồng hồ app/DB | Thấp–trung bình | POTENTIAL RISK | Thêm metric/alert + chính sách NTP trước production |

### 11.1 Rủi ro retry sau khi key hết hạn 30 ngày

Đây là giới hạn **cốt lõi** cần chủ dự án hiểu đúng:

- Sau **30 ngày** (hoặc sau purge), row idempotency bị xóa và **cùng key có thể được dùng lại**. Khi đó hệ thống **không còn** khả năng nhận ra đây là retry của giao dịch cũ.
- **Adjust tồn kho:** không có “trần” tự nhiên. Retry muộn có thể cộng/trừ tồn thêm lần nữa; đây là impact trực tiếp lên stock và giá trị kho.
- **Payout:** chỉ bị chặn bởi điều kiện **không vượt remaining payable**. Nếu vẫn còn headroom, một payout thứ hai có thể được tạo.
- **Refund:** chỉ bị chặn bởi điều kiện **tổng refund ≤ paid**. Nếu vẫn còn headroom, một refund thứ hai có thể được tạo.
- **Crash/rollback:** claim rollback là hành vi đúng để cho phép retry, nhưng cũng có nghĩa không có dedupe cho giao dịch đã rollback — chỉ giao dịch **commit thành công** mới được replay.
- **Không có immutable transaction identity** ở tầng payment provider/ledger, không có reconciliation job, không có unique business reference cho adjust/payout/refund. Vì vậy **không được tuyên bố “dedupe vĩnh viễn”**.
- Biện pháp dài hạn nếu nghiệp vụ cần: tăng retention có kiểm soát, lưu provider transaction ID, thêm unique business reference/ledger entry, đối soát định kỳ. Các biện pháp này **chưa triển khai** và không thuộc commit này.

---

## 12. Trạng thái Git cuối cùng

```text
Branch: fix/bl-01-02-settlement-con-01
HEAD:   5b35b974bae65f308cfdce3ab23a6aec959f2916
Parent: 90c28de8f773af2b266b96979f9508155e9523fe

5b35b97 feat(api): idempotent money/stock mutations, checkout lock order and settlement guards
90c28de feat(v2): final fix round — Buy Now isolation, provenance badges, COD CAS, safe E2E
a02db75 chore: ignore per-workspace lockfiles and drop stray untracked artifacts
```

- Staged: **rỗng**.
- Tracked working tree: **sạch**.
- Untracked: 13 báo cáo audit + 1 tài liệu chủ dự án.
- Không có commit nào được push lên `origin`.
- Không merge, không rebase, không tag, không deploy.
- Không chạy migration trên dev/prod.
- Không xóa hoặc reset bất kỳ file/dữ liệu ngoài phạm vi.

---

## 13. Khuyến nghị merge

| Phạm vi | Khuyến nghị | Lý do |
|---|---|---|
| Giữ commit trên feature branch | **ĐỒNG Ý** | 36 file đúng phạm vi; toàn bộ test matrix PASS; backup và diff check đầy đủ |
| Merge vào `main` ngay | **KHÔNG** | Còn 3 go-live blocker: JWT fail-closed, CI, backup/restore; migration chưa rehearsal ngoài test |
| Merge vào nhánh tích hợp để tiếp tục phát triển | **CÓ ĐIỀU KIỆN** | Chỉ sau khi reviewer duyệt diff và chấp nhận các gap RR13-06/08/10; không coi là production-ready |
| Deploy production | **NO-GO** | Giữ nguyên kết luận báo cáo 07/11/12 |

**Đề xuất cụ thể:** giữ `5b35b97` trên `fix/bl-01-02-settlement-con-01`, mở PR review (không auto-merge), tách các blocker go-live thành issue riêng. Chỉ merge `main` khi JWT fail-closed + CI + backup/restore drill + migration runbook được đóng và có biên bản.

---

## 14. Việc còn lại — Admin và Customer

### 14.1 Admin

1. **UI tạo refund** trong Admin-web, gọi `POST /refunds` kèm `Idempotency-Key` ổn định; hiện API đã bắt buộc header nhưng UI chưa có luồng này.
2. **Idempotency cho các endpoint còn lại**: inbound, tạo settlement, tạo payment, pay payout, update return — cần change request riêng và test retry/409/rollback.
3. **Playwright E2E UI thật** cho các luồng Admin chính (điều chỉnh kho, settlement/payout, refund), thay vì chỉ vitest component + API E2E.
4. **Xử lý lỗi 400/409 trên UI**: hiển thị thông báo “key đang xử lý”/“payload khác” và hướng dẫn retry an toàn.
5. **Migration runbook dev/staging/prod**: backup, pre-check duplicate, rehearsal, verify index, rollback/restore — không tự động áp.

### 14.2 Customer

1. **Checkout retry UX**: đảm bảo client giữ nguyên `Idempotency-Key` khi timeout/retry và tạo key mới khi payload/đơn thay đổi (hợp đồng checkout hiện có đã được test ở API).
2. **Theo dõi trạng thái refund/return sau khi Admin xử lý**: bổ sung hiển thị trạng thái và thông báo cho khách; phần API đã có, UI cần đối soát.
3. **E2E UI Customer** cho checkout/retry/refund nếu muốn bằng chứng trình duyệt thật; hiện có API E2E + mobile test.
4. **Không mở thêm phạm vi** cho tới khi các blocker go-live được xử lý.

---

## 15. Việc đã không làm (xác nhận phạm vi)

- Không push, không merge, không rebase, không tag.
- Không deploy, không chạy migration trên dev/staging/production.
- Không sửa migration đã áp hoặc metadata `_prisma_migrations` ngoài test DB.
- Không commit `audit-reports/`, tài liệu chủ dự án, `.env`, DB dump, log, file cá nhân.
- Không xóa/reset file hoặc dữ liệu ngoài phạm vi.
- Không tuyên bố production-ready.
- Không chạy lại mobile trong lần nghiệm thu này; không suy diễn kết quả mobile.

---

## Phụ lục A — Lệnh kiểm tra nhanh

```powershell
git rev-parse HEAD
git show --stat --oneline HEAD
git status --porcelain=v1
git diff --cached --stat
git diff-tree --no-commit-id --check -r HEAD
```

Kỳ vọng:

- `HEAD` = `5b35b974bae65f308cfdce3ab23a6aec959f2916`.
- `git show --stat` = 36 file, `+4180 / −209`.
- `git diff --cached --stat` rỗng.
- `git status` chỉ còn tài liệu untracked.
- `git diff-tree --check` không in lỗi.

## Phụ lục B — Đường dẫn bằng chứng

- Log test: `.tmp-verify/commit-acceptance/`
- Manifest file commit: `.tmp-verify/commit-acceptance/commit-file-manifest.txt`
- DB state: `.tmp-verify/commit-acceptance/db-state-after-tests.log`
- Backup ngoài repo: `C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-round1-4-commit-backup-20261023-044812`

---

**Chữ ký nghiệm thu:** commit local `5b35b97` được chấp nhận cho phạm vi Round 1–4 trên feature branch. **Go-live: NO-GO.** Không có push/merge/deploy/migration ngoài test DB trong nhiệm vụ này.
