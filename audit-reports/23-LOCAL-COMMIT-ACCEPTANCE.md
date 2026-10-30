# 23 — LOCAL COMMIT ACCEPTANCE

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Commit local:** `ec5e4a860c9087c01b6b17e862bd2539f50e2393`  
**Parent:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Ngày nghiệm thu:** 24/10/2026  
**Checkpoint:** `C:\Users\Lai Van Nha\AppData\Local\Temp\agrimarket-checkpoints\local-commit-20261024-150954`  
**Kết luận điều hành:** **LOCAL COMMIT — GO**. Commit local đã được tạo, đúng parent, đúng phạm vi và không chứa report/secret/log. **PUSH/MERGE/STAGING/UAT/PRODUCTION — NO-GO**; không có push, merge, deploy hay migration ngoài test DB trong phiên này.

---

## 1. Tóm tắt điều hành

| Hạng mục | Kết quả |
|---|---|
| Commit local | `ec5e4a860c9087c01b6b17e862bd2539f50e2393` |
| Parent | `5b35b974bae65f308cfdce3ab23a6aec959f2916` |
| Branch | `fix/p0-a-security-pricing` |
| Số file trong commit | **124** — 88 modified + 36 added |
| Diff commit | **+11.626 / −952** |
| Trạng thái sau commit | Tracked tree sạch; 24 untracked là report/audit (23 report trước khi tạo Report 23), không nằm trong commit |
| `git show --check` | Exit 0 |
| `git diff --cached --check` trước commit | Exit 0 sau khi sửa một blank line ở EOF |
| Test cuối | API unit `565/565`, API E2E `450/450`, Admin `44/44`, Customer `37/37`, Mobile `175 pass + 3 skip`, Shared `65/65` |
| Typecheck/lint/build | Full workspace PASS; build bằng Next.js `16.4.1` |
| Prisma | Schema valid; test DB có `13` migration và up to date |
| Security smoke | PASS — 5 file được kiểm tra |
| Push/merge/deploy | **Không thực hiện** |

Commit này đóng gói các thay đổi P0-A/B/C/D và release blockers đã được mô tả trong Report 22, cộng hai sửa đổi bổ sung được tìm thấy trong vòng review cuối:

1. **Refund complete-vs-fail race:** `completeRefund()` dùng compare-and-set trên `status = APPROVED`; một `failRefund()` đồng thời không thể bị ghi đè.
2. **Order-item receipt lock:** `receiveReturnedGoods()` khóa dòng `order_items` bằng `FOR UPDATE` để serialize việc nhận hàng hoàn của cùng một dòng và tránh phân bổ lot trùng.

Không có thay đổi source nào sau các lần test cuối, ngoại trừ việc bỏ một blank line ở cuối `docs/BACKUP-RESTORE-RUNBOOK.md` để `git diff --cached --check` trả về 0. Report này được tạo **sau** commit và cố ý không được stage.

---

## 2. Checkpoint và trạng thái trước commit

### 2.1. Checkpoint ngoài repo

| Hạng mục | Giá trị |
|---|---|
| Đường dẫn | `C:\Users\Lai Van Nha\AppData\Local\Temp\agrimarket-checkpoints\local-commit-20261024-150954` |
| File ZIP | `local-commit-20261024-150954.zip` |
| SHA-256 ZIP | `96AEE1CF29ACD6171A57C50AD1E74DD69FBC8C250056C2EE18C293A6094EC0F3` |
| Manifest | `SHA256SUMS.txt` — 147 entry |
| SHA-256 manifest | `BA1B5B6447DF5172FBE69033B5738689B4DCB9E51167331979590AF03EAE4BF1` |
| Kiểm tra giải nén | 147 file, **0 mismatch** |
| Thời điểm | 24/10/2026 15:09:57 +07:00 |

Checkpoint nằm ngoài repository, không bị `git clean`, `git reset` hay thao tác worktree nào chạm tới.

### 2.2. Trạng thái trước commit

| Hạng mục | Giá trị |
|---|---|
| HEAD trước commit | `5b35b974bae65f308cfdce3ab23a6aec959f2916` |
| Branch | `fix/p0-a-security-pricing` |
| Modified tracked | 88 |
| Untracked | 59 |
| Tổng entry `git status --porcelain -uall` | 147 |
| Tracked diff cuối (chỉ file modified) | **5.525 thêm / 952 xoá** (Report 22 ghi 5.419 trước hai fix cuối) |
| Commit/push/merge/deploy trước phiên | Không thực hiện |
| `git reset`, `git clean`, xoá file người dùng | Không thực hiện |

88 modified tracked khớp với Report 22. Phần untracked có sai lệch số liệu so với Report 22 và được giải thích ở mục 3.

---

## 3. Sai lệch 35 so với 59 untracked

Report 22 ghi **35 untracked**. Trạng thái thực tế tại checkpoint và trước commit là **59**. Đây là sai lệch số liệu trong Report 22, không phải file lạ phát sinh trong lúc commit.

| Nhóm | Số lượng | Xử lý |
|---|---:|---|
| Audit reports `01`–`22` | 22 | **Loại khỏi commit** |
| `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` | 1 | **Loại khỏi commit** |
| File source/test/migration/CI/script/docs mới | 36 | **Đã đưa vào commit** |
| **Tổng untracked thực tế** | **59** | |
| Report 22 ghi | 35 | |
| Chênh lệch | **+24** | |

Cách đối chiếu:

```text
59 untracked thực tế
− 22 audit reports
−  1 root audit markdown
= 36 file không phải report
```

36 file này đều đã được review, stage và commit; 23 file report cố ý để ngoài commit. Không có entry nào không giải thích được. Số liệu của Git (`git status --porcelain -uall`) là nguồn chuẩn; con số 35 trong Report 22 nên được coi là count chưa đầy đủ/đã cũ, không dùng để thay thế trạng thái Git.

Sau khi commit, 23 untracked còn lại đúng bằng danh sách loại trừ. Sau khi tạo Report 23, trạng thái hiện tại là 24 untracked (thêm chính report này), tracked tree vẫn sạch.

---

## 4. Phương pháp stage và phạm vi commit

### 4.1. Stage tường minh, không dùng `git add .`

Danh sách 124 đường dẫn được tạo từ:

```text
git diff --name-only --diff-filter=ACMRTUXB
git ls-files --others --exclude-standard
```

Sau đó loại `audit-reports/*` và `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md`, ghi thành file pathspec NUL-separated và stage bằng:

```text
git --literal-pathspecs add \
  --pathspec-from-file=<temp-path>\staging-paths-23.bin \
  --pathspec-file-nul
```

Không dùng `git add .`, `git add -A` hay `git add -u` để tránh stage ngoài phạm vi. Kết quả stage: 88 modified + 36 added = 124 file; 0 unstaged tracked; 23 untracked report còn lại.

### 4.2. Phạm vi

| Nhóm | Số file | Nội dung chính |
|---|---:|---|
| API source | 46 | security/JWT/CORS, pricing/promotions, orders/shipments, inventory/quarantine, returns/refunds, settlements, audit |
| API migrations/schema | 3 | P0-B/C/D migration, reservation-expiry migration, Prisma schema |
| Test files | 30 | 29 API test file + 1 Admin UI component test |
| Admin Web | 17 | audit/quarantine/refunds/shipments/season screens, return/complaint/settlement dialogs, types/resources/status |
| Customer Web | 9 | infinite lists, deep-link handling, return/complaint/review/checkout |
| Mobile | 11 | infinite lists, pickers, order/return/complaint/review screens, types |
| CI/tooling/docs | 5 | CI workflow, security smoke, backup/restore scripts, runbook |
| Dependency | 4 | `package.json`, `package-lock.json`, `apps/admin-web/package.json`, `apps/customer-web/package.json` |

Các nhóm trên có thể chồng lấn ở file dependency; tổng unique theo Git vẫn là **124 file**. Danh sách đầy đủ ở Phụ lục A/B.

### 4.3. Loại trừ

Các nhóm sau **không** nằm trong commit:

- `audit-reports/01`–`22` — 22 file report.
- `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` — root audit markdown.
- `audit-reports/23-LOCAL-COMMIT-ACCEPTANCE.md` — report này, tạo sau commit.
- `.env`, `.env.*` (chỉ `.env.example` được commit), credential, private key.
- `.tmp-verify/`, test log, dump, backup, ZIP, `node_modules`, build output.
- Không có file dữ liệu cá nhân, ảnh chụp hay log runtime.

### 4.4. File bắt buộc

`apps/admin-web/test/release-blockers-ui.spec.tsx` **đã được stage và có trong commit**. Kiểm tra:

```text
git diff-tree --no-commit-id --name-only -r HEAD \
  | Where-Object { $_ -eq 'apps/admin-web/test/release-blockers-ui.spec.tsx' }
→ 1
```

File này chứa 4 component test:

- C-06: dropdown refund hợp lệ tải danh sách và submit đúng `refundId`.
- C-06: báo operator khi không có refund COMPLETED hợp lệ.
- C-15: terminal complaint bắt buộc resolution.
- C-08: review settlement adjustment, không sửa settlement gốc.

---

## 5. Pre-commit gates

| Gate | Cách kiểm tra | Kết quả |
|---|---|---|
| Branch/HEAD | `git branch --show-current`, `git rev-parse HEAD` | Đúng `fix/p0-a-security-pricing`, parent `5b35b97…` |
| Trạng thái trước stage | `git status --porcelain -uall` | 88 M + 59 ?? = 147 |
| Stage tường minh | pathspec NUL, không `git add .` | 124 file; 88 M + 36 A |
| Whitespace | `git diff --cached --check` | Exit 0 sau khi bỏ blank line EOF |
| Staged list | `git diff --cached --name-status` | Đúng 124 file, không report |
| Prisma schema | `npx prisma validate` | Schema valid |
| Migration | `npx prisma migrate status` trên `agrimarket_v2_test` | 13 migration, schema up to date |
| Package/lockfile | `git diff --cached -- package-lock.json`, `npm ls next eslint-config-next` | 51/51 dòng lock; cả Admin/Customer dùng Next + eslint-config-next `16.4.1` |
| Secret scan staged | `git grep --cached` cho private key/AWS/GitHub/Stripe/credential; kiểm tra path `.env`, `.pem`, `.key`, dump/log | Không match high-confidence; không `.env`/private key/log/dump |
| Security smoke | `npm run security:smoke` | PASS — 5 file |
| UI test bắt buộc | `git diff-tree …` | Có mặt |
| Report ngoài commit | `git diff-tree …` lọc `audit-reports/*` và root markdown | 0 |
| Test/evidence khớp Report 22 | Đối chiếu test counts, migration, file scope | Khớp; hai regression mới được bổ sung |

### 5.1. Sửa lỗi hygiene trước commit

`git diff --cached --check` lần đầu trả về:

```text
docs/BACKUP-RESTORE-RUNBOOK.md:159: new blank line at EOF.
```

Đã bỏ đúng một blank line cuối file, stage lại và chạy lại:

```text
git diff --cached --check
→ exit 0
```

Không có thay đổi nội dung runbook khác.

### 5.2. Secret scan

Đã quét staged index, không chỉ working tree:

- Không có private key block.
- Không có AWS access key, GitHub token, Stripe live key.
- Không có `Nha02022005` hoặc credential local của máy.
- Không có file `.env`/`.env.*` ngoài `.env.example`.
- Không có `.pem`, `.key`, `.p12`, `.pfx`.
- Không có log, dump, backup, ZIP.
- Các chuỗi `mysql://` còn lại là placeholder trong `.env.example`, credential dev/test đã có từ trước trong README/script, hoặc DB ephemeral `root/root` của CI. Không có credential production.

`npm run security:smoke` kiểm tra 5 file guardrail và PASS.

---

## 6. Bằng chứng kiểm thử

### 6.1. Chạy cuối trước commit

| Bộ | Kết quả | Ghi chú |
|---|---:|---|
| API unit | **42 file / 565 test PASS** | `npm test` workspace API |
| API E2E | **19 file / 450 test PASS** | Chạy 15:27:16, duration 100.57s |
| Admin Web unit | **8 file / 44 test PASS** | Gồm 4 test release-blockers UI |
| Customer Web unit | **3 file / 37 test PASS** | |
| Mobile unit | **18 pass + 1 skip file; 175 pass + 3 skip test** | 3 skip có sẵn, không thêm skip mới |
| Shared domain unit | **5 file / 65 test PASS** | |
| Full workspace typecheck | PASS | Tất cả workspace |
| Full workspace lint | PASS | 3 warning `require-array-sort-compare` có sẵn trong test API; không lỗi |
| Full workspace build | PASS | Admin/Customer đều Next.js `16.4.1`; API Nest build |
| Security smoke | PASS | 5 file |
| Prisma validate | PASS | Schema valid |
| Migration status | PASS | 13 migration, test DB up to date |
| `git diff --cached --check` | Exit 0 | Sau khi sửa blank line EOF |

Tổng unit test của một vòng chính: **44 + 565 + 37 + 175 + 65 = 886 test pass**, chưa tính 3 test Mobile skip có sẵn. API E2E là bộ riêng: **450 test**.

### 6.2. Hai regression bổ sung trong vòng đóng commit

| Vấn đề | Sửa đổi | Test |
|---|---|---|
| `completeRefund()` có thể ghi đè một refund vừa bị `failRefund()` chuyển khỏi `APPROVED` | `updateMany` CAS trên `status = APPROVED`; nếu update count = 0 thì đọc trạng thái và trả conflict/không resurrect | Unit `does not resurrect a refund that a concurrent failure moved out of APPROVED`; real-DB test `complete and fail racing on one APPROVED refund` |
| Hai luồng nhận hàng hoàn cùng một `orderItem` có thể phân bổ lot trùng | Khóa `order_items` bằng `SELECT … FOR UPDATE` trước khi đọc active claims | Nằm trong `returns.service.ts`; full E2E 450 pass |

### 6.3. Giới hạn bằng chứng

- API E2E chạy trên `agrimarket_v2_test`, không phải staging/production.
- Không có Playwright UI E2E; Admin chỉ có component test.
- Mobile test là unit/component, không phải thiết bị thật.
- Build PASS không chứng minh runtime production.
- DB invariant report 22 là read-only trên test DB; không chứng minh dữ liệu production sạch.
- Không có remote CI, SMTP thật, payment gateway thật hay carrier thật trong phiên này.

---

## 7. Commit đã tạo

| Hạng mục | Giá trị |
|---|---|
| SHA | `ec5e4a860c9087c01b6b17e862bd2539f50e2393` |
| Parent | `5b35b974bae65f308cfdce3ab23a6aec959f2916` |
| Branch | `fix/p0-a-security-pricing` |
| Author/Committer | `laivannha0202 <nguoikhongten02022005@gmail.com>` |
| Thời điểm | 24/10/2026 15:33:55 +07:00 |
| Subject | `feat(api,web,mobile): harden P0 flows and close release blockers` |
| Files changed | **124** |
| Diff | **+11.626 / −952** |
| `git show --check` | Exit 0 |
| `git ls-tree` tổng file | 855 |
| Audit reports trong tree | 0 |
| `.env`/private key/log/dump trong tree | 0 |
| UI test trong tree | 1 |

Commit message bao phủ đủ các nhóm yêu cầu:

- Security/pricing hardening.
- Shipment/order integrity.
- Inventory quarantine/QC.
- Returns/refunds/settlement.
- Admin/Customer/Mobile integrations.
- Next.js security patch.
- CI/backup tooling.
- Regression tests.

Commit message cũng ghi rõ đây là **local commit**, không push/merge/deploy/migrate production, và C-08/C-14/C-19 vẫn mở hoặc partially complete.

### 7.1. Trạng thái sau commit

Ngay sau commit: 23 untracked, 0 tracked dirty, 0 staged. Sau khi tạo report này, trạng thái hiện tại là:

```text
git status --porcelain -uall
→ 24 untracked
→ 0 tracked dirty
→ 0 staged
```

24 untracked gồm 22 audit reports + 1 root audit markdown + Report 23 này; tất cả đều là report/audit, không có source hoặc test bị bỏ quên.

Không có tag, không có push, không có merge, không có deploy. HEAD hiện tại là commit local `ec5e4a8`.

---

## 8. Migration và database

### 8.1. Trạng thái

| Hạng mục | Kết quả |
|---|---|
| Tổng migration | **13** |
| Migration mới trong commit | `20261023000000_p0b_integrity_quarantine_refunds` |
| Migration mới trong commit | `20261024000000_order_reservation_expiry` |
| Test DB | `agrimarket_v2_test` |
| `prisma migrate status` | `13 migrations found`, `Database schema is up to date!` |
| Development DB | Không migrate/sửa |
| Staging DB | Không migrate/sửa |
| Production DB | Không migrate/sửa |

Migration P0-B/C/D là additive ở mức row: thêm enum value, cột nullable, bảng mới; không rewrite dữ liệu lịch sử. Migration reservation expiry thêm `orders.reservation_expires_at` nullable và index; row cũ nhận `NULL` nên không bị sweep.

### 8.2. Chưa được chứng minh

- Chưa chạy `prisma migrate deploy` trên remote CI.
- Chưa có migration rollback drill.
- Chưa có backup/restore production-size.
- Chưa có migration trên staging/UAT/production.
- Chưa có xác nhận dữ liệu production sạch invariant.

---

## 9. Open issues và quyết định kinh doanh

### 9.1. C-08, C-14, C-19

| Mã | Trạng thái sau commit | Residual |
|---|---|---|
| **C-08** — refund sau settlement/clawback/commission | **PARTIALLY COMPLETE + BUSINESS DECISION REQUIRED** | Adjustment `OPEN` chặn confirm settlement/payout và có UI review; chưa tự động `DEDUCT_NEXT`, chưa clawback, chưa hoàn commission, chưa có chính sách ai chịu khoản refund sau settlement |
| **C-14** — trace authoring/8-event chain | **PARTIALLY COMPLETE** | Đã có event đóng gói/xuất kho/hoàn hàng từ các vòng trước; chưa có authoring UI harvest/farming đầy đủ và chưa có bằng chứng chuỗi 8 event end-to-end |
| **C-19** — CI/observability/RBAC/deploy | **PARTIALLY COMPLETE / NOT VERIFIED** | CI file, security smoke, backup/restore script và runbook đã có trong commit; chưa chạy CI remote, chưa có branch protection, metrics/alerting, RBAC chi tiết, deploy/rollback, offsite backup/RPO/RTO |

### 9.2. Quyết định kinh doanh còn mở

Các mục sau **chưa được phê duyệt**; code không tự chọn thay chủ sản phẩm/kế toán/vận hành:

1. **Refund sau settlement, clawback, commission:** ai chịu khoản refund sau khi đối tác đã settle; thu hồi bằng `DEDUCT_NEXT`, `WRITE_OFF`, `MANUAL` hay clawback; xử lý payout đã `PAID`; có hoàn commission theo tỷ lệ refund không.
2. **Kỳ settlement:** theo ngày đặt, ngày giao hay ngày thu tiền; đơn tạo kỳ trước giao kỳ sau; COD thu muộn thuộc kỳ nào.
3. **COD:** ai được xác nhận thu tiền; bằng chứng bắt buộc; đối soát carrier theo ngày/tuần; có cho thu một phần không.
4. **Return/refund policy:** cửa sổ trả hàng; kênh hoàn tiền; có hoàn phí vận chuyển/chiết khấu/thuế không; cap theo giá trị hàng hoàn hay số đã thanh toán.
5. **Reservation TTL:** số phút cuối cùng; có khác theo phương thức thanh toán/khu vực/khung giờ; có thông báo trước khi hủy tự động không.
6. **Backup/credential vận hành:** RPO/RTO, retention, offsite, encryption owner; ai giữ và rotate JWT/DB/SMTP secret; COD-only cho MVP có chấp nhận không; có cần RBAC/staff/partner portal trước go-live không.
7. **Complaint:** ai được đóng complaint; evidence bắt buộc khi `RESOLVED`/`REJECTED`; SLA xử lý và thời hạn khách phản hồi.

### 9.3. Residual kỹ thuật đã biết

- Settlement attribution hiện dùng goods gross trong khi payment/refund có thể gồm shipping; chính sách shipping/tax vẫn là quyết định kinh doanh (Report 19).
- Report 22 ghi `npm audit` còn **29 lỗ hổng: 12 moderate, 17 high, 0 critical**; Next.js không còn trong danh sách. Không có thay đổi dependency nào khác ngoài patch Next.js trong commit này; audit chưa được chạy lại trong bước commit.
- Remote CI chưa chạy; local dùng Node `v26.12.0`, CI workflow khai báo Node 24. Khác biệt runtime này chưa được xác minh.
- Không có Playwright UI E2E; không có SMTP/payment/carrier thật; không có restore production-size.

---

## 10. Push-readiness cho remote CI

### 10.1. Điều kiện kỹ thuật

| Điều kiện | Trạng thái |
|---|---|
| Commit self-contained, đúng parent | Có |
| Tracked tree sạch sau commit | Có |
| CI workflow có trong commit | Có — `.github/workflows/ci.yml` |
| CI trigger cho `fix/**` | Có |
| Lockfile đầy đủ cho `npm ci` | Có — `package-lock.json` đã stage |
| Secret trong commit | Không phát hiện |
| Migration chạy được trên test DB | Có — 13 migration, up to date |
| Remote CI xanh | **Chưa chạy** |
| Branch protection/required checks | **Chưa xác minh** |
| Node parity local/CI | **Chưa xác minh** — local Node 26.12.0, CI Node 24 |
| Playwright/UI E2E trên CI | **Chưa có** |

### 10.2. Phán quyết push

- **Có thể push commit này lên remote để chạy CI verification**, với điều kiện chủ repo phê duyệt và coi đây là commit ứng viên, không phải commit release.
- **Không nên merge, không nên deploy, không nên migrate staging/production** dựa trên bằng chứng local này.
- Nếu push, cần theo dõi CI remote cho `npm ci`, security smoke, typecheck, lint, unit, build, migration deploy trên MySQL ephemeral và E2E.
- Nếu CI remote đỏ do khác biệt Node 24/26 hoặc môi trường MySQL, phải sửa và tạo commit mới; không amend mù quáng hoặc bỏ qua.
- Push chưa được thực hiện trong phiên này. Không có remote CI run, không có branch protection, không có review độc lập.

---

## 11. Phán quyết cuối cùng

| Mục | Phán quyết |
|---|---|
| **Local commit** | **GO** — đã tạo, đúng scope, test local PASS, tree sạch |
| **Push để chạy CI** | **CONDITIONAL** — cần owner approval; CI remote chưa chạy |
| **Merge** | **NO-GO** — thiếu remote CI, review độc lập, branch protection; C-08/C-14/C-19 mở |
| **Staging** | **NO-GO** — chưa migrate staging, chưa cấu hình SMTP/payment/carrier thật, chưa có deploy/rollback drill |
| **UAT** | **NO-GO cho UAT đầy đủ** — chỉ có thể demo nội bộ với dữ liệu giả lập, COD-only, không tiền thật |
| **Production** | **NO-GO** — thiếu CI remote, backup/restore production-size, refund-after-settlement policy, RBAC/observability, integrations thật |

**Không tuyên bố production-ready.** Commit `ec5e4a8` là một mốc local có kiểm soát để bàn giao và chạy CI, không phải giấy chứng nhận release.

---

## Phụ lục A — 36 file added trong commit

- `.github/workflows/ci.yml`
- `apps/admin-web/src/app/(admin)/audit/page.tsx`
- `apps/admin-web/src/app/(admin)/quarantine/page.tsx`
- `apps/admin-web/src/app/(admin)/refunds/page.tsx`
- `apps/admin-web/src/app/(admin)/seasons/[id]/page.tsx`
- `apps/admin-web/src/app/(admin)/shipments/page.tsx`
- `apps/admin-web/test/release-blockers-ui.spec.tsx`
- `apps/api/prisma/migrations/20261023000000_p0b_integrity_quarantine_refunds/migration.sql`
- `apps/api/prisma/migrations/20261024000000_order_reservation_expiry/migration.sql`
- `apps/api/src/common/audit/audit-log.controller.ts`
- `apps/api/src/common/audit/dto/audit-log.dto.ts`
- `apps/api/src/common/utils/refund-allocation.ts`
- `apps/api/src/orders/order-reservation-expiry.service.ts`
- `apps/api/src/orders/reservation-policy.ts`
- `apps/api/src/promotions/validators/is-valid-discount-value.validator.ts`
- `apps/api/src/quarantine/dto/quarantine.dto.ts`
- `apps/api/src/quarantine/quarantine.controller.ts`
- `apps/api/src/quarantine/quarantine.module.ts`
- `apps/api/src/quarantine/quarantine.service.ts`
- `apps/api/test/audit-logs.e2e-spec.ts`
- `apps/api/test/business-rules/complaint-lifecycle.spec.ts`
- `apps/api/test/business-rules/jwt-config.spec.ts`
- `apps/api/test/business-rules/order-reservation-expiry.spec.ts`
- `apps/api/test/business-rules/partners-public.spec.ts`
- `apps/api/test/business-rules/product-visibility.spec.ts`
- `apps/api/test/business-rules/promotion-discount-validation.spec.ts`
- `apps/api/test/business-rules/quarantine.spec.ts`
- `apps/api/test/business-rules/warehouse-return.spec.ts`
- `apps/api/test/p0-a-security-pricing.e2e-spec.ts`
- `apps/api/test/release-blockers.e2e-spec.ts`
- `apps/api/test/setup-unit.ts`
- `apps/api/test/test-env.ts`
- `docs/BACKUP-RESTORE-RUNBOOK.md`
- `scripts/backup-db.mjs`
- `scripts/restore-db.mjs`
- `scripts/security-smoke.mjs`

## Phụ lục B — 88 file modified trong commit

- `apps/admin-web/package.json`
- `apps/admin-web/src/app/(admin)/farms/[id]/page.tsx`
- `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx`
- `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx`
- `apps/admin-web/src/app/(admin)/settlements/page.tsx`
- `apps/admin-web/src/components/common/ListPage.tsx`
- `apps/admin-web/src/components/layout/AdminShell.tsx`
- `apps/admin-web/src/lib/api/resources.ts`
- `apps/admin-web/src/lib/query/keys.ts`
- `apps/admin-web/src/lib/status/index.ts`
- `apps/admin-web/src/types/api.ts`
- `apps/api/.env.example`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/auth/jwt.strategy.ts`
- `apps/api/src/common/audit/audit.module.ts`
- `apps/api/src/common/audit/audit.service.ts`
- `apps/api/src/complaints/complaints.service.ts`
- `apps/api/src/config/configuration.ts`
- `apps/api/src/finance/dto/finance.dto.ts`
- `apps/api/src/finance/finance.controller.ts`
- `apps/api/src/finance/settlements.service.ts`
- `apps/api/src/inventory/inventory.service.ts`
- `apps/api/src/inventory/warehouse-documents.service.ts`
- `apps/api/src/lots/lots.service.ts`
- `apps/api/src/mail/mail.service.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.module.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/partners/dto/partner.dto.ts`
- `apps/api/src/partners/partners.controller.ts`
- `apps/api/src/partners/partners.service.ts`
- `apps/api/src/payments/dto/payment.dto.ts`
- `apps/api/src/payments/payments.controller.ts`
- `apps/api/src/payments/payments.service.ts`
- `apps/api/src/products/products.controller.ts`
- `apps/api/src/products/products.service.ts`
- `apps/api/src/promotions/dto/promotion.dto.ts`
- `apps/api/src/promotions/promotions.service.ts`
- `apps/api/src/returns/dto/return.dto.ts`
- `apps/api/src/returns/returns.controller.ts`
- `apps/api/src/returns/returns.module.ts`
- `apps/api/src/returns/returns.service.ts`
- `apps/api/src/seasons/seasons.service.ts`
- `apps/api/src/shipments/shipments.controller.ts`
- `apps/api/src/shipments/shipments.module.ts`
- `apps/api/src/shipments/shipments.service.ts`
- `apps/api/src/traceability/traceability.service.ts`
- `apps/api/test/app.e2e-spec.ts`
- `apps/api/test/business-rules/checkout-hardening.spec.ts`
- `apps/api/test/business-rules/delivery-return.spec.ts`
- `apps/api/test/business-rules/mail.spec.ts`
- `apps/api/test/business-rules/refund.spec.ts`
- `apps/api/test/business-rules/settlement.spec.ts`
- `apps/api/test/concurrency.e2e-spec.ts`
- `apps/api/test/concurrency-money.e2e-spec.ts`
- `apps/api/test/helpers/concurrency-fixtures.ts`
- `apps/api/test/helpers/e2e-fixtures.ts`
- `apps/api/test/helpers/prisma-mock.ts`
- `apps/api/test/idempotency.e2e-spec.ts`
- `apps/api/test/idempotency-http.e2e-spec.ts`
- `apps/api/test/mutation-acceptance.e2e-spec.ts`
- `apps/api/test/setup-e2e.ts`
- `apps/api/test/warehouse-admin.e2e-spec.ts`
- `apps/api/vitest.config.ts`
- `apps/customer-web/package.json`
- `apps/customer-web/src/components/checkout/CheckoutSuccess.tsx`
- `apps/customer-web/src/components/order/ComplaintListView.tsx`
- `apps/customer-web/src/components/order/OrderDetail.tsx`
- `apps/customer-web/src/components/order/ReturnDetail.tsx`
- `apps/customer-web/src/components/order/ReturnListView.tsx`
- `apps/customer-web/src/components/order/ReviewListView.tsx`
- `apps/customer-web/src/lib/api/query-keys.ts`
- `apps/customer-web/src/lib/api/types.ts`
- `apps/mobile/app/complaints.tsx`
- `apps/mobile/app/complaints-new.tsx`
- `apps/mobile/app/my-reviews.tsx`
- `apps/mobile/app/my-reviews-new.tsx`
- `apps/mobile/app/order/[id].tsx`
- `apps/mobile/app/orders.tsx`
- `apps/mobile/app/product/[id].tsx`
- `apps/mobile/app/return/[id].tsx`
- `apps/mobile/app/returns.tsx`
- `apps/mobile/app/returns-new.tsx`
- `apps/mobile/src/lib/types.ts`
- `package.json`
- `package-lock.json`

## Phụ lục C — 23 file report/audit được loại khỏi commit

- `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md`
- `audit-reports/01-ARCHITECTURE.md`
- `audit-reports/02-SECURITY.md`
- `audit-reports/03-BUSINESS-LOGIC.md`
- `audit-reports/04-ADMIN-CUSTOMER-CONSISTENCY.md`
- `audit-reports/05-CONCURRENCY-DATA-INTEGRITY.md`
- `audit-reports/06-TEST-QUALITY.md`
- `audit-reports/07-PRODUCTION-READINESS.md`
- `audit-reports/08-FIX-ROADMAP.md`
- `audit-reports/09-FIX-ROUND-1-VERIFICATION.md`
- `audit-reports/10-FIX-ROUND-2-VERIFICATION.md`
- `audit-reports/11-ROUND-3-ACCEPTANCE-AND-RISK-REVIEW.md`
- `audit-reports/12-ROUND-4-IDEMPOTENCY-CHECKOUT-VERIFICATION.md`
- `audit-reports/13-ROUND-1-4-COMMIT-ACCEPTANCE.md`
- `audit-reports/14-FULL-FEATURE-INVENTORY-AND-GAP-ANALYSIS.md`
- `audit-reports/15-P0-A-SECURITY-PRICING-VERIFICATION.md`
- `audit-reports/16-P0-B-SHIPPING-ORDER-VERIFICATION.md`
- `audit-reports/17-P0-C-QUARANTINE-QC-VERIFICATION.md`
- `audit-reports/18-P0-D-RETURNS-REFUNDS-VERIFICATION.md`
- `audit-reports/19-P0-D-SETTLEMENT-COD-REFUND-ACCOUNTING.md`
- `audit-reports/20-PRODUCTION-READINESS-CI-SECURITY-BACKUP.md`
- `audit-reports/21-FINAL-SYSTEM-ACCEPTANCE.md`
- `audit-reports/22-RELEASE-BLOCKERS-CLOSURE.md`

`audit-reports/23-LOCAL-COMMIT-ACCEPTANCE.md` là report này, được tạo sau commit và cũng không nằm trong commit.
