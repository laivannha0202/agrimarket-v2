# 09 — FIX ROUND 1 VERIFICATION (BL-01 · BL-02 · settlement-create · CON-01 · Flash Sale audit)

> **Audit metadata**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Baseline audit: commit `90c28de8f773af2b266b96979f9508155e9523fe` (báo cáo 01–08)
> - Branch làm việc: `fix/bl-01-02-settlement-con-01` — **thay đổi còn UNCOMMITTED, chưa push**
> - Ngày xác minh: 2026-10-19 (Asia/Ho_Chi_Minh)
> - DB an toàn: dev `agrimarket_v2` (không mutate, migration **chưa áp**) · test `agrimarket_v2_test` (migration đã áp, mọi test đều chạy ở đây)
> - Nguyên tắc: không tuyên bố "đã sửa" nếu không có test chạy thật; số liệu dưới đây lấy từ log thật trong `.tmp-verify/` (gitignored).

---

## 1. Bảng trạng thái issue

| Issue | Bằng chứng gốc | Trạng thái sau vòng này | Ghi chú trung thực |
|---|---|---|---|
| **BL-01** refund đôi (double refund) | Runtime repro trên baseline: kịch bản so le 4–7 ms → **8/20 vòng** cả hai refund đều commit (`sum=140000` trong khi `paid=70000`); kịch bản đồng thời tuyệt đối → bên thua nhận lỗi Prisma thô (InnoDB deadlock) thay vì 400 nghiệp vụ. Log: `.tmp-verify/refund-probe.txt` dòng 14–34, 1–13 | **FIXED (chờ chốt commit)** | Khóa `SELECT … FOR UPDATE` trên payment + `t.isolationLevel = ReadCommitted`, đọc lại tổng refund sau khóa, suy ra status từ giá trị đã khóa. E2E mới phủ cả case so le; stress 25 vòng pass |
| **BL-02** return vượt số đã giao | Runtime repro baseline: 2/2 yêu cầu trả hàng đồng thời đều được nhận, tổng claim 10 > đã giao 5 | **FIXED (chờ chốt commit)** | Khóa `SELECT … FOR UPDATE` trên `order_items` + ReadCommitted, đọc lại active claims sau khóa. Nuance status-revival (BL-03) **ngoài phạm vi**, ghi nhận |
| **settlement-create** claim 1 đơn 2 lần | Runtime repro baseline: 2 create đồng thời → **4 dòng / 2 partner order** (đơn bị trả tiền 2 lần) | **FIXED (migration chờ duyệt áp prod)** | Unique index `settlement_lines.partner_order_id` + bắt P2002 → **409 Conflict**. Lưu ý: bên thua đọc danh sách muộn có thể tạo settlement **rỗng** (không double-claim) — chấp nhận, ghi trong test |
| **BL-06** payout vượt payable | Test mới `it.fails`: 2 payout đồng thời có thể cùng commit > payable | **CONFIRMED — CHƯA SỬA (đợt sau)** | Giữ `it.fails` làm known-gap guard; khi vá phải đổi thành `it()` |
| **BL-07** adjust mất increment | Test mới `it.fails` cho `adjust`; test `inbound` **PASS** (inbound đã được serialize bởi warehouse FOR UPDATE lock) | **CONFIRMED — CHƯA SỬA (đợt sau)** | Lỗi lost-update nằm ở `adjust`, không phải `inbound` |
| **CON-01** assertion sai nhánh cancel | Nhánh else của race test cũ assert RAMLE (RELEASE) trong khi code mới quarantine | **FIXED** | Sửa else-branch sang quarantine semantics + **2 test deterministic** cho cả hai nhánh (cancel-first / deliver-first) |
| **Flash Sale "300 suất còn lại"** | Đối chiếu read-only dev DB + đọc code toàn vết | **KHÔNG PHẢI BUG — nhưng là SỐ LIỆU DEMO** | 300 = 100+200 quota seed, `sold=0`, **0 order line nào từng tiêu quota**. Khớp DB nhưng KHÔNG được diễn giải là "doanh số thật" (mục 1.1) |
| BL-08 voucher restore, BL-12, BL-16… | Báo cáo 03/08 | **KHÔNG CHẠM** | Vòng này không sửa, không tuyên bố hoàn tất 47 mục |

### 1.1 Flash Sale — kết quả audit READ-ONLY đầy đủ

Vết: **Admin config → DB → API → customer-web/mobile → checkout**, không mutate gì.

- **Admin config**: `apps/admin-web/src/app/(admin)/flash-sales/page.tsx` — tạo qua `resources.createFlashSale` (POST `/flash-sales`, ADMIN), bật/tắt qua `updateFlashSaleStatus` (PATCH `/flash-sales/:id`, ADMIN).
- **DB dev (read-only, 2026-10-19)**: 1 sale `id=1` — `status=ACTIVE`, cửa sổ `2026-09-14 10:00Z → 2026-11-13 10:00Z` (UTC, Prisma ghi UTC; hiện **đang live** theo `UTC_TIMESTAMP(3)`).
  - Item `CCB-1KG`: flash 50.000 / base 60.000, quota **100**, sold **0**, perCustomer 2.
  - Item `CRP-1KG`: flash 24.000 / base 28.000, quota **200**, sold **0**, perCustomer 3.
  - `ORDER_ITEMS_WITH_FLASH: lineCount=0 qty=0` → chưa từng có ai mua giá flash trong DB này.
- **API**: `GET /api/v1/flash-sales?status=ACTIVE` là `@Public()` (`promotions.controller.ts:76-81`), trả nguyên hàng item (kèm `quota`, `soldQuantity`).
- **customer-web**: `FlashSaleSection.tsx` lọc `isFlashSaleLive` (so `startsAt/endsAt` với đồng hồ máy khách) rồi hiển thị `flashSaleRemainingTotal(sale)` = Σ `max(0, quota − soldQuantity)` (dòng 114, 213). Mobile home tab tương tự (dòng 515, 552).
- **Checkout**: `orders.service.ts` — `resolvePriceForCustomer` (bỏ item khách đã hết quyền) rồi trong transaction `consumeFlashSaleQuota` = 1 câu UPDATE có JOIN `flash_sales`, guard `status=ACTIVE` + **`UTC_TIMESTAMP(3)` window** + quota + giá mong đợi; per-customer đếm sau row-lock. Fail → rollback toàn bộ.
- **Kết luận**: con số **"300 suất còn lại" là số liệu seed/demo** (100+200, sold=0), phản ánh đúng tổng `quota − sold` của DB nhưng không có dòng doanh số thật nào. Timezone an toàn: guard server dùng `UTC_TIMESTAMP(3)` (không phụ thuộc session tz=SYSTEM của MySQL); client so ISO instant, chỉ lệch nếu đồng hồ thiết bị sai.

---

## 2. File/diff + migration

Diff so với baseline 90c28de: **9 file, +490/−98** (chưa commit). Cộng thêm 3 nhóm file mới.

| File | Thay đổi | Vai trò |
|---|---|---|
| `apps/api/src/payments/payments.service.ts` | `refund()`: `SELECT id, amount, status FROM payments … FOR UPDATE` + `$transaction(..., { isolationLevel: 'ReadCommitted' })`, đọc lại tổng refund sau khóa | BL-01 |
| `apps/api/src/returns/returns.service.ts` | `create()`: `SELECT id, quantity FROM order_items … FOR UPDATE` + ReadCommitted, đọc lại active claims sau khóa | BL-02 |
| `apps/api/src/finance/settlements.service.ts` | `create()`: bắt P2002 trên unique mới → `ConflictException` (409) + docblock; không đổi shape response thường | settlement-create |
| `apps/api/prisma/schema.prisma` | `@@unique([partnerOrderId])` trên `SettlementLine` (+comment lý do) | DB guard |
| `apps/api/prisma/migrations/20261019000000_settlement_line_unique_partner_order/migration.sql` | **MỚI** — `ADD UNIQUE INDEX settlement_lines_partner_order_id_key (partner_order_id)`; kèm pre-check query duplicate trong comment | migration |
| `apps/api/test/concurrency-money.e2e-spec.ts` | **MỚI** — 10 test: BL-01 (4), BL-02 (2), settlement race (1), BL-06 `it.fails` (1), BL-07 inbound (pass) + adjust `it.fails` (1) | bằng chứng fix |
| `apps/api/test/concurrency.e2e-spec.ts` | CON-01: sửa else-branch sang quarantine + 2 test deterministic cancel-first/deliver-first (tổng 29 test) | CON-01 |
| `apps/api/test/helpers/concurrency-fixtures.ts` | `purgeCreated` xóa thêm refunds/returnRequests/settlements/payouts đúng thứ tự FK | vệ sinh test |
| `apps/api/test/business-rules/{refund,settlement,evidence-aftersales}.spec.ts` | Unit test mới: mock `$queryRaw` lock, REFUNDED status, P2002→409, code-collision retry | unit |

**Migration — trạng thái thật (kiểm tra read-only, log `.tmp-verify/index-check.txt`):**

| DB | Unique index trên `settlement_lines.partner_order_id` | `_prisma_migrations` | Duplicate pre-check |
|---|---|---|---|
| dev `agrimarket_v2` | **KHÔNG** (nguyên trạng) | chưa áp | 0 nhóm |
| test `agrimarket_v2_test` | **CÓ** (`settlement_lines_partner_order_id_key`, unique=true) | đã áp lúc 2026-10-18 16:42:13Z | 0 nhóm |

Pre-check bắt buộc trước khi áp mọi môi trường (có sẵn trong file migration):
`SELECT partner_order_id, COUNT(*) FROM settlement_lines GROUP BY partner_order_id HAVING COUNT(*) > 1;`
Rollback nếu cần: `DROP INDEX settlement_lines_partner_order_id_key ON settlement_lines;` (index thuần, không rewrite dữ liệu).
Lưu ý MySQL: khi có unique index, MySQL dùng luôn nó làm index FK nên index FK phụ không xuất hiện trên test — bình thường.

---

## 3. Test case + kết quả thật

### 3.1 Tĩnh + unit

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npm run typecheck --workspace @agrimarket/api` | **EXIT=0** (`.tmp-verify/typecheck-final-round.log`) |
| Lint (oxlint type-aware) | `npm run lint --workspace @agrimarket/api` | **EXIT=0**; 3 warning — tất cả có từ HEAD, 2 ở `concurrency.e2e-spec.ts:394` (đã xác minh có trong `git show HEAD`) + 1 ở `warehouse-admin.e2e-spec.ts:271` |
| Unit (vitest) | `npm run test --workspace @agrimarket/api` | **34 file / 438 test PASS** (`.tmp-verify/unit-final-round.log`) |

### 3.2 E2E toàn bộ — 4 lần (test DB `agrimarket_v2_test`)

| Lần | Files | Tests | Kết quả | Log |
|---|---|---|---|---|
| 1 | 13 passed | 359 passed + 2 expected fail | **PASS** (70.9s) | `.tmp-verify/e2e-run-1.log` |
| 2 | 1 failed, 12 passed | 358 + 2 expected fail + **1 failed** | **FAIL — flaky PDF decode** (72.8s) | `.tmp-verify/e2e-run-2.log` |
| 3 | 13 passed | 359 + 2 expected fail | **PASS** (71.8s) | `.tmp-verify/e2e-run-3.log` |
| 4 | 13 passed | 359 + 2 expected fail | **PASS** (70.8s) | `.tmp-verify/e2e-run-4.log` |
| + chẩn đoán | `reports-export.e2e-spec.ts` chạy riêng ×5 | 7/7 pass ×5 | **PASS 5/5** | `.tmp-verify/pdf-flake-runs.log` |

- **"2 expected fail"** = 2 test `it.fails` có chủ đích (BL-06 payout, BL-07 adjust) — vitest tính là đạt khi bug CÒN tái hiện được. Khi vá đợt sau **bắt buộc flip về `it()`**, nếu để nguyên `it.fails` thì suite sẽ đỏ.
- **Phân tích flaky (trung thực, chưa sửa)**: test `reports-export > exports a real PDF with extractable Vietnamese text` fail ở lần 2 do `RUN_ID` ngẫu nhiên khác → font subset của PDFKit khác → extractor tự viết `test/helpers/pdf-text.ts` decode sai glyph chuỗi mã đơn (`…-ORDEXP1` bị đọc thành `…-IREDXP·1`). Dữ liệu 2 đơn vẫn có đủ trong PDF; đây là lỗi decode text, **có sẵn từ HEAD, ngoài diff vòng này** (test + helper không bị chỉnh). Đề xuất đợt sau: làm extractor chịu lỗi hơn hoặc so khớp đã chuẩn hóa. **Không sửa vòng này** để giữ phạm vi.
- Stress trước đó trong vòng (log phiên): `concurrency.e2e-spec.ts` + `concurrency-money.e2e-spec.ts` với `CONCURRENCY_ROUNDS=25` → **37 passed + 2 expected fail** — trong đó BL-01 có case so le (delay 4–7 ms) từng là kịch bản tái hiện bug, giờ pass 25/25 vòng.

### 3.3 Bảng hồi quy bắt buộc (đều nằm trong suite đã chạy PASS)

| Điểm hồi quy | Test đang phủ | Kết quả |
|---|---|---|
| BUY_NOW không ghi vào giỏ | `business-rules/checkout-cart-source.spec.ts` (unit) + `mutation-acceptance.e2e-spec.ts:1799` "cờ BUY_NOW chỉ có thể 'không ghi gì' vào giỏ" | PASS |
| COD confirm cần DELIVERED + reference | `business-rules/payment-collection.spec.ts` (refuse before DELIVERED, cần reference, không thu 2 lần) + `mutation-acceptance.e2e-spec.ts:1264/1291/1306` (giao hàng không tự thu tiền; thiếu reference bị từ chối; thu rồi mới PAID) | PASS |
| Idempotency checkout | `mutation-acceptance.e2e-spec.ts:965/1084/1138` (retry cùng key → cùng đơn; khác payload → 409; 3 request đồng thời → 1 đơn) + `concurrency.e2e-spec.ts:1087` | PASS |
| FEFO | `business-rules/fefo.spec.ts` + luồng reserve/allocate trong `concurrency.e2e-spec.ts` (never oversells / never loses reservation) | PASS |
| Quarantine khi hủy SHIPPING (CON-01) | `concurrency.e2e-spec.ts:535` (race, cả 2 nhánh assert), `:639` cancel-first deterministic (**1 QUARANTINE / 0 RELEASE**; reserved 0, blocked 3, onHand 10; payment PENDING), `:722` deliver-first deterministic, `:804` dedicated + `checkout-hardening.spec.ts:419` | PASS |
| Voucher & Flash quota guard | `concurrency.e2e-spec.ts:400` (voucher usageLimit race), `:131/162/195/232/280/313/349/1128/1204/1276/1319` (flash quota, per-customer, 2 sale cùng giá, giá đổi/hủy sale giữa preview→confirm, MySQL rollback), `promotion-status.e2e-spec.ts`, unit `46+` case promotions | PASS |

---

## 4. Quy tắc cần chủ dự án quyết định

1. **Invariant "một partner order chỉ thuộc một settlement line, vĩnh viễn"** — phê duyệt để unique index có hiệu lực. Nếu tương lai muốn chia (split) một đơn qua nhiều kỳ, phải thiết kế lại **trước khi** áp prod; correction hiện biểu diễn bằng `settlements.adjustmentAmount`.
2. **Duyệt áp migration `20261019000000_settlement_line_unique_partner_order`** lên dev/staging/prod (kèm pre-check duplicate bắt buộc; hiện cả hai DB đều 0 duplicate). Dev **cố ý chưa áp** — cần lệnh của chủ dự án.
3. **BL-05 — trách nhiệm hoàn tiền sau khi đã settlement** (partner đã nhận tiền, đơn bị refund thì ai chịu?): chưa có chính sách code hoá; cần chủ dự án chốt trước khi gặp case thật.
4. **BL-08 — có hoàn voucher khi hủy đơn không?** Hiện voucher đã tiêu không được hoàn; cần quyết định (đúng/sai nghiệp vụ) trước khi sửa.
5. **BL-06 (payout vượt payable) + BL-07 (`adjust` mất increment)**: chốt đưa vào đợt 2; khi vá phải flip 2 test `it.fails` → `it()`.
6. **Flash Sale "300 suất còn lại" là demo data** (sold=0): quyết định go-live — giữ nguyên số demo, reseed dữ liệu giả lập có giao dịch, hoặc ẩn con số khi chưa có doanh số thật. Đây là quyết định marketing/truyền thông, không phải bug kỹ thuật.

---

## 5. Đánh giá go-live + phạm vi chưa làm

**Kết luận: chưa go-live toàn hệ thống.** Vòng này đủ điều kiện đưa **nhóm sửa an toàn tiền** vào release kế tiếp, với điều kiện:

- (a) Chủ dự án duyệt + áp migration với pre-check (rollback = drop index, dễ);
- (b) Chốt commit/push branch `fix/bl-01-02-settlement-con-01` (hiện uncommitted — rủi ro mất thay đổi nếu máy hỏng);
- (c) **BL-06/BL-07 còn nguyên lỗ tiền** — payout vượt payable là rủi ro tài chính thật, nên xử lý ở đợt 2 trước khi cho vận hành chi trả thật; nếu phải go-live sớm, cần kiểm soát thủ công (duyệt payout một người, đối soát payable) và chấp nhận bằng văn bản.

**Điểm cộng đã xác minh thật**: BL-01/BL-02/settlement-create được khoá ở tầng DB (row-lock / unique index), không chỉ che ở tầng app; CON-01 giờ test đúng semantics quarantine cả 2 nhánh deterministic; toàn bộ checklist hồi quy (BUY_NOW, COD, idempotency, FEFO, voucher, flash) PASS trên DB test.

**Phạm vi chưa làm (không tuyên bố hoàn tất 47 mục)**: BL-06, BL-07 (chờ đợt 2); BL-08, BL-12, BL-16 và phần còn lại của báo cáo 03/08 chưa chạm; chưa có CI (PRD-01); 1 test flaky PDF có sẵn của repo; dữ liệu vận hành dev giữ nguyên, chưa seed lại.

---

## Phụ lục — bằng chứng cục bộ (`.tmp-verify/`, gitignored)

| File | Nội dung |
|---|---|
| `refund-probe.txt` | Baseline BL-01: staggered 8/20 double refund (sum 140000); pure-simultaneous dính deadlock thô |
| `flash-audit.txt` | Read-only dev DB: sale/item/quota/sold/clock/window — nguồn con số "300" |
| `index-check.txt` | Dev vs test: unique index + `_prisma_migrations` + duplicate pre-check |
| `lint-final-round.log`, `typecheck-final-round.log`, `unit-final-round.log` | Lint/typecheck/unit lần cuối |
| `e2e-run-{1..4}.log` | 4 lần full e2e (PASS/FAIL/PASS/PASS) |
| `pdf-flake-runs.log` | 5 lần chạy riêng spec PDF — 5/5 PASS |
| `fix-diff.patch` | Toàn bộ diff 9 file so với `90c28de` |
