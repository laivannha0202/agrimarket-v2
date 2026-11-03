# Báo cáo 30 — Chốt AgriMarket V2 và bàn giao nghiệm thu thực tế

**Ngày:** 03/11/2026
**Phạm vi:** HEAD local `main`, 9 commit sau `origin/main`, không push/merge/deploy.
**Trạng thái:** **STAGING-HANDOFF-READY** — sẵn sàng bàn giao cho staging/UAT.
**Không phải:** STAGING-VERIFIED, UAT-ACCEPTED hay PRODUCTION-READY.

> Báo cáo này tổng hợp bằng chứng đã có và các bước còn thiếu. Mọi mục UAT/chứng từ
> chưa chạy đều ghi **NOT RUN** / **NOT VERIFIED**. Không có kết quả nào được suy diễn
> từ kiểm thử local sang môi trường thật.

> **Định nghĩa STAGING-HANDOFF-READY:** mã nguồn RC đã khóa, gate local đã PASS, kế
> hoạch UAT và bằng chứng bàn giao đã đủ để một nhóm khác dựng staging và nghiệm thu.
> Trạng thái này **không** có nghĩa staging đã chạy, UAT đã đạt hay production đã sẵn sàng.

---

## 0. Tóm tắt điều hành

| Câu hỏi | Trả lời |
|---|---|
| Mã nguồn RC có thay đổi trong vòng này? | **Không.** Chỉ sửa 3 tài liệu và thêm báo cáo này. |
| 9 commit local có còn nguyên? | **Có.** Linear, không merge, không rebase, `origin/main` là tổ tiên trực tiếp. |
| Gate local còn PASS? | **Có.** `verify:local` 20/20; 967 unit; 493 API E2E; 27 Playwright; mobile export. |
| Có lỗi P0/P1 mới? | **Không.** Có 1 khoảng trống vận hành P2 (mục 4.1), 2 việc P3 và 23 cảnh báo dependency moderate (0 high/critical, dưới ngưỡng chặn). |
| Có thể bàn giao staging ngay? | **Có, về phía mã nguồn + kế hoạch.** Cần môi trường và người nghiệm thu. |
| Có thể go-live? | **Không.** Thiếu UAT, chữ ký kế toán, thiết bị thật, gateway thật. |
| Đã push/merge/deploy? | **Chưa.** Không thao tác remote nào. |

---

## 1. HEAD và trạng thái Git thực tế

### 1.1. Trạng thái tại thời điểm bắt đầu kiểm tra

| Mục | Giá trị |
|---|---|
| Nhánh | `main` |
| HEAD | `7b93c84b67bfa6a0d479dccf450708659d969e62` |
| Commit đầu | `docs(29): pin the round's commit SHAs in the acceptance report` |
| Tác giả | `laivannha0202 <nguoikhongten02022005@gmail.com>` |
| Remote | `origin` → `https://github.com/laivannha0202/agrimarket-v2.git` |
| `origin/main` | `11b5ce8cde9b27b9cc81eeb6aed4451387e97a7a` |
| Ahead / behind | **9 ahead / 0 behind** |
| Quan hệ | `origin/main` là tổ tiên trực tiếp → fast-forward được, không cần merge commit |
| Working tree | **Sạch** (`git status --porcelain` rỗng) |
| Merge commit trong 9 commit | 0 (lịch sử tuyến tính) |
| Stash / nhánh khác | Không có |
| Tag | Không có |

### 1.2. 9 commit local (RC code)

| # | SHA | Nội dung |
|---|---|---|
| 1 | `b983dd5` | `fix(api,shared,mobile,customer)`: bắt buộc bằng chứng thu tiền thật, hiển thị hoàn tiền; thêm `MISSING_COLLECTION_EVIDENCE` và guard quyết toán |
| 2 | `d934568` | `refactor(api,admin)`: tách state machine đơn hàng và các tab chi tiết đơn |
| 3 | `d12da0c` | `chore(repo)`: xoá file chết, gom QA vào `apps/api/qa`, bỏ lockfile pnpm |
| 4 | `04b0af4` | `docs(28)`: biên bản dọn mã nguồn + bằng chứng Playwright/verify |
| 5 | `39723ec` | `feat(api)`: lọc báo cáo đối soát, cờ thiếu bằng chứng thu |
| 6 | `808bc04` | `feat(admin)`: màn hình đối soát dòng tiền chỉ đọc `/reconciliation` |
| 7 | `663a02a` | `test(e2e)`: phủ đối soát qua HTTP, trình duyệt và PDF |
| 8 | `d929d25` | `docs(29)`: biên bản nghiệm thu tài chính/UI + kế hoạch staging |
| 9 | `7b93c84` | `docs(29)`: ghim SHA của vòng vào báo cáo |

**Migration:** 9 commit **không thêm migration nào**. Tập migration vẫn là 14 file như
`origin/main`; đây là điều kiện quan trọng để staging không phải chạy migration mới.

### 1.3. Trạng thái tại thời điểm soạn báo cáo (trước commit tài liệu vòng 30)

| Mục | Giá trị |
|---|---|
| HEAD | Không đổi: `7b93c84` (không commit, không amend) |
| File sửa | `docs/STAGING-UAT-PLAN.md`, `docs/BUSINESS-RULES.md`, `docs/README.md` |
| File mới | `audit-reports/30-RELEASE-CANDIDATE-UAT-HANDOFF.md` |
| Mã nguồn thay đổi | **0 file** |
| `git diff --check` | PASS |

Trạng thái `git status --porcelain=v1` **tại thời điểm bàn giao**:

```text
 M docs/BUSINESS-RULES.md
 M docs/README.md
 M docs/STAGING-UAT-PLAN.md
?? audit-reports/30-RELEASE-CANDIDATE-UAT-HANDOFF.md
```

> Vòng 30 **không commit**. Working tree chưa sạch **chỉ vì 4 file tài liệu của vòng 30**
> (3 file sửa + báo cáo này); không có file mã nguồn nào thay đổi.
>
> **Cập nhật vòng 31 — chốt tài liệu:** 4 file này đã được review (không có secret,
> đường dẫn sai đã sửa) và commit trong **một commit tài liệu riêng**. Sau commit,
> working tree sạch; 9 commit RC giữ nguyên; bundle mới và nhánh `release/30-uat`
> được tạo từ HEAD mới. Không push/merge/deploy. Commit tài liệu không làm thay đổi
> SHA mã nguồn RC `7b93c84`.

---

## 2. Phạm vi mã nguồn đã khóa

- Không chia file, gộp file, đổi cấu trúc hay tối ưu mã nguồn.
- Không sửa logic nghiệp vụ, không đổi migration, không đổi schema.
- Không sửa test để "làm xanh" kết quả.
- Thay đổi duy nhất ngoài tài liệu: **không có**.
- Bản sao lưu lịch sử đã tạo trước khi bàn giao:
  `backups/agrimarket-v2-main-7b93c84b67bf-20261103.bundle` (19 MB),
  `git bundle verify` → *okay, complete history*,
  SHA-256 `fd9261149de94863b79a7f6d9bbc3067ad88eeb52cc09a6f18506da3c8e0038e`.

---

## 3. Các chức năng đã sẵn sàng (mức local)

Cột "Bằng chứng" là test tự động đã chạy trong vòng này hoặc vòng 29 trên **cùng mã
nguồn**. Cột "UAT" luôn là NOT RUN vì chưa có môi trường/người nghiệm thu.

| # | Chức năng | Trạng thái local | Bằng chứng chính | UAT |
|---|---|---|---|---|
| 1 | Đặt hàng COD | READY | `e2e/customer/order-flow.spec.ts` (đặt COD thật, mở PDF); `test/business-rules/order-state-machine.spec.ts`; `test/release-blockers.e2e-spec.ts` | NOT RUN |
| 2 | Giỏ hàng và Mua ngay | READY | `test/business-rules/checkout-cart-source.spec.ts`; `checkout-hardening.spec.ts`; nhánh `BUY_NOW` không đụng giỏ (`orders.service.ts`) | NOT RUN |
| 3 | Voucher | READY | `test/business-rules/promotions.spec.ts`; `promotion-discount-validation.spec.ts`; Playwright "shows a voucher once and keeps the snapshot total" | NOT RUN |
| 4 | Giữ hàng và tồn kho | READY | `order-reservation-expiry.spec.ts`; `fefo.spec.ts`; `inventory.spec.ts`; `test/concurrency.e2e-spec.ts` (10 vòng) | NOT RUN |
| 5 | Thanh toán và xác nhận thu COD | READY | `payment-collection.spec.ts`; `payments.service.updateStatus` (bắt buộc reference, chỉ COD sau DELIVERED, compare-and-set); `test/concurrency-money.e2e-spec.ts` | NOT RUN |
| 6 | Trả hàng, hoàn tiền | READY | `refund.spec.ts`; `delivery-return.spec.ts`; `test/evidence-aftersales.e2e-spec.ts`; Playwright "shows a partial refund..." | NOT RUN |
| 7 | Reconciliation | READY | `payment-reconciliation.spec.ts`; `test/finance-reconciliation.e2e-spec.ts`; Playwright `e2e/admin/reconciliation.spec.ts` (4 test) + ảnh 3 viewport | NOT RUN |
| 8 | Settlement và payout | READY | `settlement.spec.ts`; `test/concurrency-settlement-payout.e2e-spec.ts`; guard adjustment OPEN trước confirm/payout | NOT RUN |
| 9 | Truy xuất nguồn gốc | READY | `test/c08-c14.e2e-spec.ts`; `harvest.spec.ts`; route công khai `GET /api/v1/trace/:traceCode`; `mobile/src/lib/__tests__/trace-code.test.ts` | NOT RUN |
| 10 | Xem trước, in, tải PDF | READY | `order-documents.spec.ts`; `test/order-documents.e2e-spec.ts`; Playwright kiểm tra `%PDF-`, logo, tiếng Việt, dòng tiền, nút in | NOT RUN |
| 11 | Phân quyền Admin/Customer | READY | `p0-a-security-pricing.e2e-spec.ts`; `address-auth.e2e-spec.ts`; `finance-reconciliation.e2e-spec.ts` (CUSTOMER 403, ẩn danh 401); Playwright: khách A không đọc PDF của khách B (404), ẩn danh 401 | NOT RUN |

**Kết luận mục 3:** không có chức năng nào trong danh sách bị thiếu ở mức mã nguồn.
"READY" ở đây nghĩa là *đã có implementation + test tự động local*, **không** phải
nghiệm thu nghiệp vụ.

---

## 4. Lỗi mới phát hiện

### 4.1. F-30-1 (P2 — khoảng trống vận hành, không phải regression)

**Mô tả:** Không có đường nghiệp vụ để sửa một payment đã `PAID` nhưng thiếu `paid_at`.
`PATCH /payments/:id/status` với cùng trạng thái là no-op; đường duy nhất ghi `paidAt`
là chuyển sang `PAID` từ trạng thái khác.

**Bằng chứng:**

- `apps/api/src/payments/payments.service.ts:132-140` — nếu `dto.status === payment.status`
  thì trả về nguyên bản (trừ `REFUNDED` bị chặn).
- `apps/api/src/payments/payments.service.ts:194` — chỉ nơi ghi `paidAt`.
- `grep paidAt` trong `apps/api/src` không có endpoint backfill.

**Ảnh hưởng:** Dòng `MISSING_COLLECTION_EVIDENCE` do báo cáo đối soát phát hiện **không
thể** được sửa trong ứng dụng. Nếu kế toán kết luận "đã thực thu", hiện chỉ còn cách sửa
tay DB — điều bị cấm trong UAT và trái nguyên tắc audit.

**Chính sách tạm thời của RC:** payment `PAID` thiếu `paid_at` bị **chặn khỏi
settlement**, **không backfill tự động**, **không sửa tay DB**. Đơn bị loại khỏi kỳ
quyết toán; danh sách trường hợp và biên bản xử lý có audit theo mẫu tại
`docs/STAGING-UAT-PLAN.md` §10.2.1.

**Xử lý trong vòng này:** không thêm endpoint (thay đổi quy tắc tài chính cần kế toán
duyệt). Đã ghi rõ quy trình và giới hạn tại `docs/STAGING-UAT-PLAN.md` §10.2, §10.2.1
và §10.4; đã sửa câu chữ gây hiểu nhầm trong `docs/BUSINESS-RULES.md`.

**Cần chủ dự án quyết định:** chọn (a) loại các đơn này khỏi quyết toán và xử lý bằng
chứng từ ngoài hệ thống, hoặc (b) duyệt một công cụ backfill có audit, chạy theo từng
dòng được kế toán ký. Không được dùng UAT để thử trên dữ liệu thật.

### 4.2. F-30-2 (P3 — dọn dẹp, không phải blocker)

Có **5 thư mục `node_modules_pnpm_broken`** bị bỏ lại, tất cả đã nằm trong `.gitignore`:

| Đường dẫn | File | Dung lượng |
|---|---:|---:|
| `apps/admin-web/node_modules_pnpm_broken` | 21.348 | **400,79 MB** |
| `node_modules_pnpm_broken` (gốc repo) | 5.372 | **10,65 MB** |
| `apps/mobile/node_modules_pnpm_broken` | 31 | 0,07 MB |
| `apps/customer-web/node_modules_pnpm_broken` | 12 | 0,03 MB |
| `apps/api/node_modules_pnpm_broken` | 0 | 0,00 MB (chỉ cây thư mục rỗng) |
| **Tổng** | **26.763** | **~411,5 MB** |

Đã thử lại trong vòng 30 bằng `cmd /c rmdir /s /q` cho cả 5 thư mục: tất cả vẫn còn
nguyên (Windows trả `Access denied`; thư mục rỗng `apps/api` cũng không xoá được).
Không thử `takeown`/`icacls` vì cần quyền Administrator.

- Đây là di sản của lần cài pnpm lỗi; repo đã chuyển sang npm (`package-lock.json`,
  CI dùng `npm ci`).
- Không được import bởi mã nguồn, không nằm trong git, không ảnh hưởng build/test.
- **Không phải blocker production.** Cần phiên Administrator (`takeown`/`icacls`) nếu
  muốn xoá triệt để.

### 4.3. F-30-3 (P3 — tài liệu, đã sửa)

`docs/BUSINESS-RULES.md` viết rằng tiền sẽ được tính lại "cho tới khi timestamp được ghi
qua luồng thu tiền bình thường" — nhưng luồng đó không tồn tại cho payment đã `PAID`.
Đã sửa thành: phải có quy trình sửa dữ liệu được duyệt, có audit; không sửa tay bảng
`payments`.

Đồng thời sửa hai tham chiếu chéo sai trong `docs/STAGING-UAT-PLAN.md`: cổng G4 ghi
"§10.3 đủ 8.1–8.7" (đúng là 10.1–10.8) và §11 ghi thiết bị thật ở "§6" (đúng là §7 của
báo cáo này). Không thay đổi nội dung nghiệp vụ.

### 4.4. Không có lỗi P0/P1

Không phát hiện mất tiền, lộ dữ liệu, sai tồn kho, hỏng đăng nhập, hay regression hiệu
năng trong các gate đã chạy.

---

## 5. Kết quả kiểm thử và bằng chứng

### 5.1. Gate tổng hợp

| Gate | Kết quả | Chi tiết | Bằng chứng |
|---|---|---|---|
| `npm run verify:local` | **PASS 20/20** | 19 bước chọn + bước cleanup; 0 fail, 0 skip | `.tmp-verify/c19/local-20261103t021806zvui7/summary.json` |
| Preflight | PASS | 16 check; MySQL 8.0.46; 14 migration; Playwright sẵn sàng | `logs/01-preflight.log` |
| Typecheck | PASS | 5 workspace, 42,4 s | `logs/03-typecheck.log` |
| Lint | PASS | 5 workspace, 62,0 s | `logs/04-lint.log` |
| Unit/component | **967 PASS, 3 SKIP** | Admin 55; API 629; Customer 37; Mobile 175 (+3 skip); Shared 71 | `logs/05-unit.log` |
| Build | PASS | API + Admin + Customer, 38,3 s | `logs/06-build.log` |
| Migration | PASS | 14 migration, checksum khớp, drift 0 | `logs/11-migrations.log` |
| Invariants | PASS | 54 check; trace coverage 18 lô bán được | `invariants.json`, `invariants-final.json` |
| Backup/restore drill | PASS | 56 bảng / 462 dòng; dump 22.485 byte; sha256 khớp; bản restore khớp | `backup-restore.json` |
| API E2E | **493 PASS** (23 file) | 166,8 s, schema dùng-rồi-xoá | `logs/14-api-e2e.log` |
| Concurrency stress | PASS | 10 vòng | `logs/15-stress.log` |
| Business smoke | PASS | 72 check HTTP/nghiệp vụ, 0 warning | `business-smoke.json` |
| Security scan | PASS | 9 check; 0 secret; 0 high/critical; **23 moderate** (API 9, Admin 1, Customer 1, Mobile/Expo tooling 12) — dưới ngưỡng chặn | `security-scan.json` |
| UI smoke | PASS | 64 route/asset | `ui-smoke.json` |
| Dọn schema | PASS | Schema test đã drop | `summary.json` (`databaseDropped: true`) |

### 5.2. Playwright (trình duyệt thật)

| Mục | Kết quả |
|---|---|
| Tổng | **27/27 PASS** (2,1 phút) |
| Phạm vi | Admin order detail (desktop + 390px), Admin reconciliation, Customer COD + PDF + voucher + refund, visual 3 viewport, PDF bytes/logo/tiếng Việt |
| Bằng chứng | `.tmp-verify/playwright-round30.log` |

### 5.3. Mobile export

| Nền tảng | Kết quả |
|---|---|
| Android | `.hbc` 3,6 MB |
| iOS | `.hbc` 3,6 MB |
| Web | Đủ chunk, `index.html` + `metadata.json` |
| Kết luận | **PASS** (export, không phải chạy trên máy thật) |
| Bằng chứng | `.tmp-verify/mobile-export-round30.log`, `.tmp-verify/expo-export-round30/` |

### 5.4. Kiểm thử tải (vòng 29, cùng mã nguồn — không có thay đổi API từ đó)

| Concurrency | Requests | RPS | p99 | Lỗi | Kết quả |
|---|---|---|---|---|---|
| 10 | 2.797 | — | 39,6 ms | 0,00% | PASS |
| 20 | 10.887 | — | 68,2 ms | 0,00% | PASS |
| 40 | 10.395 | 345,72 | 136,9 ms | 0,00% | PASS |

Bằng chứng: `.tmp-verify/load-round29-c10.log`, `-c20.log`, `-c40.log`.
Đây là tải **local một máy**, không thay thế đo trên hạ tầng staging.

### 5.5. Rerun hẹp vòng 30 (không thay đổi mã nguồn)

Sau khi hoàn thiện tài liệu, chạy lại lúc **09:43 ngày 03/11/2026** **9 file unit test
nghiệp vụ trọng yếu** trên đúng HEAD `7b93c84`:

| Nhóm | File | Kết quả |
|---|---|---|
| Đơn hàng / giữ hàng | `order-state-machine.spec.ts` | PASS |
| Thu tiền COD | `payment-collection.spec.ts`, `payment-availability.spec.ts` | PASS |
| Đối soát | `payment-reconciliation.spec.ts` | PASS |
| Quyết toán | `settlement.spec.ts` | PASS |
| Trả hàng / hoàn tiền | `refund.spec.ts`, `evidence-aftersales.spec.ts` | PASS |
| Giỏ / Mua ngay | `checkout-cart-source.spec.ts` | PASS |
| PDF | `order-documents.spec.ts` | PASS |
| **Tổng** | **9 file** | **138 PASS, 0 FAIL** (4,55 s) |

Bằng chứng: `.tmp-verify/round30-targeted-unit.log` (exit 0). Đây là kiểm tra bổ sung,
**không thay thế** gate 20/20 và **không phải** bằng chứng UAT.

### 5.6. Điều kiện môi trường của lần chạy

`summary.json` ghi `head = 7b93c84b67bfa6a0d479dccf450708659d969e62`,
`databaseDropped = true`, không có warning/failure. Working tree sạch tại thời điểm
preflight. Ba tài liệu vòng 30 được sửa **trong và ngay sau khi gate chạy** (một phần
sau preflight, phần còn lại sau cleanup) và báo cáo này được tạo sau đó; **không file
mã nguồn nào thay đổi**, nên kết quả gate vẫn ứng với đúng HEAD `7b93c84`.

---

## 6. Checklist staging/UAT có thể thực hiện ngay

Kế hoạch đầy đủ ở **`docs/STAGING-UAT-PLAN.md`** (đã hoàn thiện trong vòng này: bước
thực hiện, người chịu trách nhiệm, kết quả mong đợi, cổng GO/NO-GO, backup/rollback,
và quy trình kế toán cho `MISSING_COLLECTION_EVIDENCE`).

### 6.1. Thứ tự thực hiện

| Bước | Việc | Người | Cổng | Kết quả mong đợi |
|---|---|---|---|---|
| 1 | Điền tên/liên hệ 6 vai trò; chốt lịch T-5…T+1 | RO | — | §1 có đủ chữ ký |
| 2 | Dựng staging; đặt `NODE_ENV=production`, DB staging, JWT riêng, CORS hẹp | IT | G0 | §3 đủ 11/11 PASS |
| 3 | Xác nhận `TEST_DATABASE_URL` rỗng; `PAYMENTS_ONLINE_ENABLED=false` | IT | G0 | chỉ COD khả dụng |
| 4 | Rehearsal migration trên bản sao dữ liệu thật | IT + ACC | G1 | 14 migration, số liệu tiền khớp |
| 5 | Backup full + restore thử schema tạm + checksum | IT + ACC | G1 | §5 PASS, có bản backup thứ hai |
| 6 | Diễn tập rollback ứng dụng và rollback DB | IT | G1 | §7 PASS, đo được thời gian |
| 7 | Deploy RC tại HEAD mới (mã nguồn `7b93c84` + commit tài liệu) + smoke 8 bước | IT + QA | G2 | §6 PASS, không 5xx |
| 8 | Chạy UAT nghiệp vụ §9 (9 nhóm, 43 kịch bản) | QA + WH + OPS | G3 | PASS có bằng chứng từng dòng |
| 9 | Kế toán đối chiếu + ký §10 | ACC | G4 | 10.1–10.8 PASS |
| 10 | Họp go/no-go | RO | G5 | Quyết định có chữ ký |

### 6.2. Điều kiện tối thiểu để bắt đầu bước 8

- G0, G1, G2 đã PASS và có biên bản.
- Không còn `TEST_DATABASE_URL` trên staging.
- `GET /payments/methods` chỉ trả `COD`.
- Backup đã restore thử được.
- Có tài khoản ADMIN + 2 CUSTOMER + dữ liệu mẫu (đơn COD, đơn đã giao, đơn có voucher,
  đơn có refund một phần, một lô có mã truy xuất).

### 6.3. Điều cấm trong UAT

- Không sửa tay bảng `payments`, `refunds`, `settlements`, `payouts`.
- Không bật gateway online để "thử".
- Không dùng dữ liệu khách hàng thật nếu chưa ẩn danh.
- Không ghi PASS khi chưa có người ký và bằng chứng.

---

## 7. Checklist thiết bị thật (Android / iOS)

**Trạng thái chung: NOT VERIFIED — không có thiết bị/emulator trong phiên này.**
Không có ảnh, log hay kết quả nào được tạo giả.

Thiết bị tối thiểu: 1 Android (API 30+) và 1 iOS (16+), cài Expo Go hoặc dev build
tương ứng SDK 58. Ghi rõ model, OS, phiên bản app, mạng (Wi-Fi/4G).

| # | Hạng mục | Các bước | Kết quả mong đợi | Android | iOS | Bằng chứng |
|---|---|---|---|---|---|---|
| D1 | Đăng nhập | Mở app → nhập tài khoản CUSTOMER → đăng nhập → kill app → mở lại | Vào trang chủ; phiên còn sau khi mở lại (SecureStore) | NOT VERIFIED | NOT VERIFIED | |
| D2 | Mua hàng | Danh mục → sản phẩm → thêm giỏ → sửa số lượng → mở giỏ | Đúng sản phẩm/biến thể/số lượng; tổng đúng | NOT VERIFIED | NOT VERIFIED | |
| D3 | Checkout COD | Giỏ → thanh toán → chọn địa chỉ → chọn COD → đặt | Tạo đơn, màn hình thành công, không chọn được online | NOT VERIFIED | NOT VERIFIED | |
| D4 | Xem đơn | Tài khoản → Đơn hàng → mở đơn vừa tạo → kéo làm mới | Đúng trạng thái, đúng dòng tiền, đúng địa chỉ | NOT VERIFIED | NOT VERIFIED | |
| D5 | Voucher | Nhập mã hợp lệ ở checkout → xem giảm giá → đặt; thử mã hết lượt | Giảm đúng; mã hết lượt bị từ chối, không tạo đơn | NOT VERIFIED | NOT VERIFIED | |
| D6 | Refund | Mở đơn đã giao → tạo yêu cầu trả → xem trạng thái hoàn tiền | Đúng luồng; số tiền hoàn hiển thị đúng; lỗi mạng có thông báo | NOT VERIFIED | NOT VERIFIED | |
| D7 | PDF: mở/lưu/chia sẻ | Mở đơn → "Phiếu PDF" → tải → mở share sheet → lưu/chia sẻ | File `%PDF-` hợp lệ; share sheet mở; lưu được vào Files/Drive | NOT VERIFIED | NOT VERIFIED | |
| D8 | Mạng yếu / mất mạng | Bật chế độ máy bay → thao tác → tắt → thử lại; mạng chập chờn | Thông báo "Không kết nối được máy chủ", không crash, không tạo đơn trùng | NOT VERIFIED | NOT VERIFIED | |
| D9 | Đăng xuất / đăng nhập lại | Tài khoản → Đăng xuất → đăng nhập lại | Token cũ bị xoá; đăng nhập lại vào đúng tài khoản; không lộ dữ liệu cũ | NOT VERIFIED | NOT VERIFIED | |

**Ghi chú kỹ thuật để người test biết:**

- PDF trên mobile do backend render; app tải bytes, kiểm tra magic `%PDF-`, rồi mở
  `expo-sharing`. Expo Go không có PDF viewer nhúng — dùng "Open in…"/"Save to Files".
- API base URL lấy từ `EXPO_PUBLIC_API_BASE_URL`; nếu test LAN, phải trỏ IP máy chạy API,
  không dùng `localhost`.
- Lỗi mạng được phân biệt với lỗi 4xx/5xx (`isNetworkError`); khi mất mạng phải thấy
  thông báo mạng, không phải "sai mật khẩu".

---

## 8. Quy trình kế toán xác nhận reconciliation

### 8.1. Quy tắc cần xác nhận

**"Đã thu đủ":** `Σ payments.amount` với `paid_at` khác null và status khác `FAILED`
phải `>= grand_total` (dung sai 0,01). Đơn không đủ bị **loại khỏi kỳ quyết toán**,
không bị sửa.

**`MISSING_COLLECTION_EVIDENCE`:** payment ở `PAID` / `PARTIALLY_REFUNDED` / `REFUNDED`
nhưng `paid_at` null. Tiền **không** được tính; đơn có thể hiện "Thu thiếu" và bị loại
khỏi quyết toán.

### 8.2. Các bước bắt buộc trước khi áp dụng vận hành thật

1. **Xuất báo cáo:** Admin → `/reconciliation` → lọc `issue = MISSING_COLLECTION_EVIDENCE`
   → chọn kỳ → lưu ảnh màn hình + danh sách mã đơn (và JSON nếu có).
2. **Đối chiếu nguồn tiền:** từng đơn, đối chiếu sao kê ngân hàng / biên bản thu COD /
   xác nhận giao hàng. Ghi nguồn cho từng dòng.
3. **Phân loại:** đã thực thu / chưa thực thu / nghi ngờ sai dữ liệu.
4. **Lập biên bản:** mã đơn, số tiền, nguồn, kết luận, người xác nhận.
5. **Chốt danh sách loại trừ** khỏi kỳ quyết toán; ACC ký.
6. **Chỉ sau 1–5** mới dùng báo cáo cho vận hành thật.
7. **Lặp lại mỗi kỳ**; lưu biên bản cùng hồ sơ kỳ.

**Mẫu bảng:** dùng bảng tại `docs/STAGING-UAT-PLAN.md` §10.2.1 (mã đơn, payment,
số tiền, nguồn đối chiếu, kết luận, xử lý, ACC ký, bằng chứng). Mỗi dòng phải có
nguồn chứng từ; không suy đoán từ trạng thái payment.

### 8.3. Bảng ký duyệt (trích từ UAT plan §10.3)

| # | Điều kiện | Người duyệt | Ngày | Bằng chứng |
|---|---|---|---|---|
| 10.1 | Hiểu quy tắc "đã thu đủ" | ACC | | Biên bản/email |
| 10.2 | Danh sách đơn bị loại là đúng | ACC | | Ảnh + mã đơn |
| 10.3 | Quy trình xử lý đơn bị loại được chấp thuận | ACC | | Quy trình ký |
| 10.4 | Quy trình adjustment/recovery sau quyết toán | ACC | | Quy trình ký |
| 10.5 | Người duyệt adjustment/recovery được chỉ định tên | ACC | | Danh sách |
| 10.6 | Báo cáo đối soát được dùng làm báo cáo kỳ | ACC | | Biên bản |
| 10.7 | **Quy trình `MISSING_COLLECTION_EVIDENCE` được ký** | ACC | | Biên bản + mẫu |
| 10.8 | Không có đơn nào bị sửa tay | ACC | | Biên bản |

**Không có đủ 10.1–10.8 thì không được go-live** (10.7 là điều kiện bắt buộc riêng cho
quy trình `MISSING_COLLECTION_EVIDENCE`).

### 8.4. Giới hạn phải quyết định trước UAT

Vì F-30-1, dòng `MISSING_COLLECTION_EVIDENCE` đã thực thu **không thể** được sửa bằng
API. Trước UAT, chủ dự án phải chọn:

- **(a)** Chấp nhận loại các đơn này khỏi quyết toán; xử lý bằng chứng từ ngoài hệ thống
  (an toàn, không đổi mã); hoặc
- **(b)** Duyệt công cụ backfill có audit, chỉ chạy khi ACC ký từng dòng (cần code + test
  + migration/rollback riêng).

Không được chọn (c) "sửa tay DB" — phá audit và không tái lập được.

---

## 9. Blocker phụ thuộc bên ngoài

| # | Blocker | Ảnh hưởng | Điều kiện đóng | Người |
|---|---|---|---|---|
| B1 | Chưa có môi trường staging | Không chạy được G0–G2 | Cấp domain, DB, secret, SMTP, storage | Chủ dự án/IT |
| B2 | Chưa có người nghiệm thu có tên | Không ký được PASS | Điền §1 UAT plan | RO |
| B3 | Chưa có phê duyệt kế toán | Không go-live | Ký 10.1–10.8 (bắt buộc 10.7) | ACC |
| B4 | Chưa có gateway/credential thật | Online payments vẫn khóa | Hợp đồng + sandbox + callback + UAT tài chính | Chủ dự án |
| B5 | Chưa có thiết bị Android/iOS | D1–D9 NOT VERIFIED | Thiết bị thật + người test | QA |
| B6 | Chưa đo tải trên hạ tầng thật | Không chứng minh production | Staging nhiều instance, c20/c50/c100 | IT |
| B7 | Quyền push GitHub | Chưa đồng bộ được | Chủ dự án cấp quyền/duyệt lệnh push | Chủ dự án |
| B8 | ACL Windows trên 5 thư mục rác ~411,5 MB | Không ảnh hưởng chạy | Phiên Administrator | IT (không bắt buộc) |

Không blocker nào trong B1–B8 được ghi là PASS trong báo cáo này.

---

## 10. Phương án đồng bộ GitHub an toàn (chưa thực hiện)

### 10.1. Kiểm tra trước khi push

| Kiểm tra | Kết quả |
|---|---|
| `origin/main` là tổ tiên của HEAD | Có → fast-forward, không cần force |
| 10 commit local (9 RC + 1 tài liệu), tuyến tính, không merge | Có |
| Migration mới so với `origin/main` | 0 |
| Secret trong lịch sử 10 commit | 0 (security scan + `git grep`) |
| File > 2 MB trong 10 commit | Không (ảnh audit ~100–160 KB; ảnh tham chiếu cũ 1,8 MB đã có từ trước) |
| Kích thước `.git` | 24 MB; lớn nhất 1,8 MB → dưới giới hạn GitHub |
| `package-lock.json` đồng bộ | `npm ci --dry-run` exit 0 (3 s); log `.tmp-verify/npm-ci-dry-run-round30.log` |
| CI dùng gì | `npm ci` + typecheck/lint/test/build/migrate/e2e; không deploy, không secret |
| Logo/brand | Có trong `public` hoặc `assets` của từng app và `apps/api/assets`; PDF có fallback chữ nếu thiếu ảnh |
| File rác ngoài git | 5 thư mục `node_modules_pnpm_broken` ~411,5 MB, đều đã ignore; không commit/push |

### 10.2. Bản sao lưu đã tạo

```
backups/agrimarket-v2-main-7b93c84b67bf-20261103.bundle   (19 MB)
backups/agrimarket-v2-main-7b93c84b67bf-20261103.bundle.sha256
```

- `git bundle verify` → *okay, complete history*.
- Bundle chứa `refs/heads/main` tại `7b93c84`.
- `git fsck --full --no-dangling` → exit 0; `git bundle verify` → *complete history*.
- Có thể restore ở máy khác bằng `git clone <bundle> agrimarket-restore`.
- Bundle trên là mốc **trước** commit tài liệu: nó **không chứa 4 file tài liệu vòng 30**.
- Vòng 31 đã tạo **bundle mới từ HEAD sau commit tài liệu** (gồm `main` và
  `release/30-uat`), verify bằng `git bundle verify` và clone thử; bundle cũ vẫn giữ
  làm mốc `7b93c84`.
- **Cần copy cả hai bundle sang nơi lưu trữ thứ hai** (ổ ngoài/cloud nội bộ) — chủ dự án.

### 10.3. Phương án A — push thẳng `main` (khuyến nghị sau khi duyệt)

```bash
# 1. Xác nhận lần cuối
git status --porcelain          # rỗng nếu đã commit tài liệu; hoặc chỉ 4 file tài liệu vòng 30 nếu chưa
git fetch origin
git rev-list --left-right --count origin/main...HEAD   # 0 10 nếu đã commit tài liệu; 0 9 nếu chưa

# 2. Push fast-forward, KHÔNG force
git push origin main

# 3. Xác minh
git fetch origin
git rev-parse origin/main       # phải bằng HEAD local
git rev-list --count origin/main..HEAD   # 0
```

- Không dùng `--force`, `--force-with-lease`, không rebase.
- Push sẽ kích hoạt CI (`ci.yml`) — CI chỉ đọc, không deploy.
- Nếu CI đỏ: sửa bằng commit mới, **không** force-push `main`.

### 10.4. Phương án B — đẩy lên nhánh review trước (an toàn hơn)

```bash
git push origin release/30-uat
# mở PR release/30-uat -> main; review + CI xanh rồi merge fast-forward
```

> Nhánh `release/30-uat` đã được tạo local từ HEAD mới nhưng **chưa push**.

- `main` trên GitHub không đổi cho tới khi merge.
- Nhánh `release/**` không nằm trong trigger `push` của CI, nhưng PR sẽ chạy CI.
- Sau merge, xác minh `origin/main == HEAD local` (`7b93c84` nếu chỉ push 9 commit RC;
  SHA mới nếu có thêm commit tài liệu vòng 30).

### 10.5. Phương án C — chỉ bàn giao offline

- Giao bundle + SHA-256 + báo cáo này; không thao tác remote.
- Phù hợp nếu chưa có quyền push hoặc cần review nội bộ trước.

### 10.6. Sau khi đồng bộ (chủ dự án quyết định)

- Tag phát hành: `git tag -a v2.0.0-rc.1 HEAD -m "AgriMarket V2 RC1"` + `git push origin v2.0.0-rc.1`
  (HEAD sau commit tài liệu; mã nguồn RC vẫn là `7b93c84`).
- Chỉ tag sau khi CI xanh và có biên bản.
- Không tạo release GitHub cho tới khi UAT staging xong.

### 10.7. Điều không làm

- Không force-push, không xoá nhánh, không `git reset --hard` trên `main`.
- Không push file `.env`, `dist/`, `generated/`, `uploads/`, `backups/`.
- Không đưa credential gateway/DB thật vào repo hoặc CI.

---

## 11. Kết luận GO/NO-GO theo từng môi trường

| Môi trường | Trạng thái | Quyết định | Căn cứ / điều kiện |
|---|---|---|---|
| **Local dev** | LOCAL-TEST-READY | **GO** | 20/20 gate, 967 unit, 493 API E2E, 27 Playwright, mobile export, load c10/c20/c40 |
| **Staging — triển khai RC** | HANDOFF-READY | **GO về kỹ thuật, chờ chủ dự án cấp môi trường** | Mã nguồn RC `7b93c84` + commit tài liệu tại HEAD mới; không migration mới; bundle đã tạo. **Chưa deploy.** |
| **Staging — nghiệm thu G0–G2** | NOT RUN | **NO-GO** | Chưa có môi trường/người; phải chạy UAT plan §3–§7 |
| **UAT nghiệp vụ G3** | NOT RUN | **NO-GO** | Chưa có staging; 43 kịch bản §9 chưa chạy |
| **Phê duyệt tài chính G4** | NOT RUN | **NO-GO** | Chưa ký 10.1–10.8; F-30-1 chưa có quyết định |
| **Thiết bị thật** | NOT VERIFIED | **NO-GO** | Không có Android/iOS trong phiên |
| **Production** | — | **NO-GO** | Thiếu UAT, chữ ký kế toán, thiết bị, tải hạ tầng thật, gateway thật |

**Câu chốt:** AgriMarket V2 đã đạt **STAGING-HANDOFF-READY**. Đây là mức cao nhất có
thể chứng minh trên máy local. **Không** được ghi PRODUCTION-READY, không được ghi UAT
PASS, không được deploy production từ báo cáo này.

---

## 12. Hành động chủ dự án cần quyết định

1. **Duyệt mở staging** và cấp môi trường/secret/tài khoản để chạy G0–G2.
2. **Chỉ định tên 6 vai trò** (RO, ACC, WH, OPS, QA, IT) và lịch UAT.
3. **Quyết định F-30-1:** phương án (a) loại đơn khỏi quyết toán + chứng từ ngoài, hay
   (b) duyệt công cụ backfill có audit. Đây là điều kiện của G4.
4. **Duyệt lệnh push GitHub:** phương án A (push `main`) hay B (nhánh `release/30-uat`).
   Chưa có lệnh nào được chạy.
5. **Cấp thiết bị Android/iOS** (hoặc chấp nhận D1–D9 NOT VERIFIED cho staging, nhưng
   không cho production).
6. **Duyệt nội dung 4 file tài liệu vòng 30** đã commit trong vòng 31 trước khi push.
7. **Quyết định xử lý 5 thư mục rác ~411,5 MB** (cần Administrator) — không bắt buộc,
   không phải blocker production.

---

## Phụ lục A — Đường dẫn bằng chứng

| Nội dung | Đường dẫn |
|---|---|
| Gate tổng hợp | `.tmp-verify/c19/local-20261103t021806zvui7/summary.json` |
| Log từng bước | `.tmp-verify/c19/local-20261103t021806zvui7/logs/` |
| Checksum bằng chứng | `.tmp-verify/c19/local-20261103t021806zvui7/SHA256SUMS.txt` |
| Playwright | `.tmp-verify/playwright-round30.log` |
| Mobile export | `.tmp-verify/mobile-export-round30.log` |
| Load test | `.tmp-verify/load-round29-c10.log`, `-c20.log`, `-c40.log` |
| Rerun unit trọng yếu | `.tmp-verify/round30-targeted-unit.log` |
| Lockfile dry-run | `.tmp-verify/npm-ci-dry-run-round30.log` |
| Trạng thái/checksum cuối | `.tmp-verify/round30-final-state.txt` |
| Backup bundle | `backups/agrimarket-v2-main-7b93c84b67bf-20261103.bundle` (+ `.sha256`) |
| Ảnh nghiệm thu UI | `audit-reports/assets/29/` (17 ảnh) |
| Kế hoạch UAT | `docs/STAGING-UAT-PLAN.md` |
| Quy tắc nghiệp vụ | `docs/BUSINESS-RULES.md` §11 |

## Phụ lục B — Lệnh tái lập nhanh

```bash
# Gate local đầy đủ (tạo schema tạm, tự drop)
npm run verify:local

# Playwright (dùng TEST_DATABASE_URL trong apps/api/.env)
npx playwright test

# Rerun hẹp 9 file unit nghiệp vụ trọng yếu (từ apps/api)
npx vitest run test/business-rules/order-state-machine.spec.ts test/business-rules/payment-collection.spec.ts test/business-rules/payment-availability.spec.ts test/business-rules/payment-reconciliation.spec.ts test/business-rules/settlement.spec.ts test/business-rules/refund.spec.ts test/business-rules/order-documents.spec.ts test/business-rules/checkout-cart-source.spec.ts test/business-rules/evidence-aftersales.spec.ts

# Mobile export
cd apps/mobile
npx expo export --platform all --output-dir ../../.tmp-verify/expo-export-round30

# Kiểm tra lịch sử trước khi push
git log --oneline origin/main..HEAD
git rev-list --left-right --count origin/main...HEAD
git status --porcelain
```
