# 11 - ROUND 3 ACCEPTANCE AND RISK REVIEW

## Tóm tắt chứng minh: khóa warehouse chặn deadlock cancel↔inbound · chứng cứ idempotency `/inventory/adjust` · review migration settlement-line · ma trận kiểm thử 4 lần full E2E

> **Thông tin audit**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Baseline audit: commit `90c28de8f773af2b266b96979f9508155e9523fe` (báo cáo 01–08); vòng 1: `audit-reports/09-FIX-ROUND-1-VERIFICATION.md`; vòng 2: `audit-reports/10-FIX-ROUND-2-VERIFICATION.md`
> - Branch làm việc: `fix/bl-01-02-settlement-con-01` — thay đổi vòng 1 + 2 + 3 **còn uncommitted, chồng lấn lên nhau, chưa push**. Vòng 3 chỉ thêm phần nhỏ lên đỉnh thay đổi vòng trước; không reset, không rebase, không đụng file riêng của chủ dự án `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md`
> - Ngày xác minh: 2026-10-21 → 2026-10-22 (Asia/Ho_Chi_Minh)
> - DB an toàn: dev `agrimarket_v2` **không bị đụng** (chỉ đọc metadata bằng pre-flight read-only); mọi test/probe ghi dữ liệu chỉ chạy trên test DB `agrimarket_v2_test` qua `TEST_DATABASE_URL` trong `apps/api/.env` (không in giá trị nào vào log)
> - Nguyên tắc giữ nguyên từ vòng 1: không tuyên bố "đã sửa" nếu không có test chạy thật; mọi bằng chứng lưu file tại `.tmp-verify/round3/` (gitignored), không chỉ transcribe từ console; không sửa assertion cho dễ PASS; không đổi quy tắc kinh doanh; không commit tự động

---

## 1. Phạm vi vòng 3

Vòng 3 làm 5 việc, đúng theo brief nghiệm thu:

1. **Đối soát kế thừa**: xác nhận thay đổi vòng 1/2 chưa commit còn nguyên vẹn trên working tree (13 file modified + 4 untracked; diff tổng `+1053/-169`; đã đối chiếu từng file của `git status` với danh sách bàn giao của vòng 2).
2. **Phát hiện và sửa 1 bệnh tồn dư của vòng 2** (mục 5): deadlock thật giữa hủy đơn từ SHIPPING (dỡ giao + quarantine tồn kho) và nhập kho / hoàn tất phiếu (inbound / `documents.complete`). Tái hiện bằng **180 vòng thời điểm tự nhiên + 90+90 vòng gate** trước fix và **0 vòng bị từ chối** sau fix, cùng mỗi thiết lập gate.
3. **Bằng chứng hành vi `POST /inventory/adjust`** (mục 8): probe chạy thật trên test DB chứng minh endpoint này **không idempotent** — retry sau timeout cộng tồn kho 2 lần (+10 thay vì +5). Đây là phát hiện tồn dư; vòng 3 **không sửa**, chỉ nộp kèm đề xuất kỹ thuật.
4. **Chạy lại toàn bộ mặt bằng kiểm thử sau khi sửa lock** (mục 9–10): typecheck, lint, unit, 4 lần full E2E độc lập (372/372 mỗi lần), stress 30 vòng, standalone money/PDF, build, test admin-web và mobile.
5. **Vật liệu nghiệm thu**: review migration `settlement_line_unique_partner_order` (mục 13), cập nhật go-live gates (mục 15), checklist Admin/Customer flows (mục 14), danh sách quyết định cần chủ dự án (mục 16).

Sự thật phạm vi (đọc trước khi nghiệm thu): vòng 3 **chỉ sửa 3 phương thức** — thêm lệnh khóa hàng theo `warehouse` trước khi một vòng lặp ghi tồn kho. Không đổi semantics quarantine, không gate theo status, không đụng quy tắc kinh doanh đã duyệt ở vòng 1/2.

## 2. Bảng trạng thái issue (tổng hợp vòng 1 → 3)

| Issue | Nguồn | Vào vòng 3 | Vòng 3 làm gì | Sau vòng 3 |
|---|---|---|---|---|
| BL-01 refund vượt số tiền đã trả | 03/08 | đã sửa vòng 1, PASS | đối soát code `payments.service.ts` (cap theo tổng đã trả) + suite PASS 4/4 lần | PASS — giữ nguyên |
| BL-02 trả hàng refund lệch | 03/08 | đã sửa vòng 1/2, PASS | đối soát code `returns.service.ts` + suite PASS | PASS — giữ nguyên |
| Settlement create double-claim | 05/08 | đã sửa vòng 2 (guard + `P2002` → 409) | review migration + trạng thái dev/test, trình policy A/B | ĐÃ XỬ LÝ — chờ duyệt policy + apply dev/tiếp theo (mục 13) |
| BL-06 payout vượt payable / payout race | 05/08 | đã sửa vòng 2 (SELECT FOR UPDATE, re-read, guard 400) | xác minh lại code (PL-06) + suite PASS | PASS — giữ nguyên |
| BL-07 adjust lost update | 05/08 | đã sửa vòng 2 (UPDATE điều kiện nguyên tử) | đối soát code + unit/e2e PASS | PASS — giữ nguyên — còn 1 mặt lõm: không idempotent (mục 8) |
| Deadlock cancel-quarantine ↔ inbound/document | vòng 2 mục 6.4 (lý thuyết) | **tái hiện runtime + ĐÃ SỬA** (3 phương thức khóa warehouse) | 90+90 vòng reject trước fix; 60+60 vòng 0 reject sau fix; 2 test hồi quy mới; ma trận full PASS | ĐÃ SỬA — PASS, chờ duyệt commit |
| Checkout `reserveLine` thứ tự khóa ngược lý thuyết | vòng 3 (mục 6) | hình dạng tĩnh (shape code), chưa tái hiện runtime | KHÔNG sửa — tài liệu hóa + đề xuất đợt riêng | CHỜ DUYỆT — đề xuất Q4 |
| `POST /inventory/adjust` không idempotent | vòng 3 (mục 8) | hành vi thật, probe chứng minh +10 | KHÔNG sửa — đề xuất kỹ thuật hoàn chỉnh | CHỜ DUYỆT — đề xuất Q3 |
| Flash Sale "300 suất" | vòng 1 | dữ liệu seed demo (sold=0) | không đụng | đúng — chỉ là số liệu demo |

## 3. File/diff tổng (vòng 1 + 2 + 3, còn uncommitted)

`git diff --stat`: 13 file, **+1053/−169** (bàn giao vòng 2 là +812/−168; phần tăng dư là thay đổi vòng 3):

| File | Diff tổng | Thuộc vòng |
|---|---|---|
| `apps/api/prisma/schema.prisma` | +7 | vòng 2 |
| `apps/api/src/finance/settlements.service.ts` | +226 (tổng thay đổi) | vòng 2 |
| `apps/api/src/inventory/inventory.service.ts` | +146 | vòng 1/2 **+ vòng 3: `consumeOrderStock` và `release` thêm `lockWarehouse`** |
| `apps/api/src/orders/orders.service.ts` | +19 | **hoàn toàn vòng 3**: `releaseOrderReservations` khóa từng warehouse (distinct, sort ASC) + docblock |
| `apps/api/src/payments/payments.service.ts` | +135 | vòng 1 |
| `apps/api/src/returns/returns.service.ts` | +81 | vòng 1/2 |
| `apps/api/test/business-rules/inventory.spec.ts` | +97 | vòng 2 |
| `apps/api/test/business-rules/settlement.spec.ts` | +60 | vòng 2 |
| `apps/api/test/business-rules/refund.spec.ts` | +35 | vòng 1 |
| `apps/api/test/business-rules/evidence-aftersales.spec.ts` | +3 | vòng 1/2 |
| `apps/api/test/concurrency.e2e-spec.ts` | +364 | vòng 1/2 (hầu hết) **+ vòng 3: 2 test hồi quy deadlock (dòng 876, 963)** |
| `apps/api/test/helpers/concurrency-fixtures.ts` | +14 | vòng 1/2 |
| `apps/api/test/helpers/pdf-text.ts` | +35 | vòng 2 |

Untracked (4): `apps/api/prisma/migrations/20261019000000_settlement_line_unique_partner_order/`, `apps/api/test/concurrency-money.e2e-spec.ts`, `audit-reports/`, `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` (file riêng của chủ dự án — vòng 3 không đọc nội dung, không sửa, không đưa vào bản sao backup).

**Sao lưu an toàn phần A2**: bản copy read-only toàn bộ working tree thay đổi đặt ra ngoài repo; đối chứng SHA256 khớp 25/25 file — xem Phụ lục C.

## 4. Độ thật của phạm vi sửa

- **Đã sửa và có bằng chứng**: 3 phương thức lock-order (`releaseOrderReservations`, `consumeOrderStock`, `release`) — reject vòng trước fix = 90+90, reject sau fix = 0+0 cùng thiết lập gate; 2 test hồi quy mới nằm trong suite đã chạy PASS.
- **Đã chứng minh, chưa sửa**: (a) checkout `reserveLine` thứ tự khóa ngược lý thuyết (mục 6); (b) `/inventory/adjust` không idempotent (mục 8). Cả hai chờ quyết định của chủ dự án.
- **Không đổi**: semantics `quarantine`, `requireActiveWarehouse`, `ALLOWED_TRANSITIONS`, logic refund/payout vòng trước. `InventoryService.lockWarehouse` (`inventory.service.ts:202`) là **ROW lock thuần**: `SELECT id FROM warehouses WHERE id = ? FOR UPDATE`, không đọc status, không nhánh logic nghiệp vụ.
- **Không chạy trên prod**: mọi thứ ghi dữ liệu chạy trên `agrimarket_v2_test`; mọi thứ đụng dev/prod ở trạng thái "chờ duyệt" (migration chưa áp ở dev — mục 13).

## 5. Deadlock cancel-quarantine ↔ inbound/document — tái hiện, fix, verify

### 5.1 Hình dạng cuộc thi (đọc tĩnh ở vòng 2, đo được ở vòng 3)

Đường **hủy đơn từ SHIPPING** (`OrdersService.applyStatusChange` → `releaseOrderReservations` → `quarantineStock` → `recordMovement`):

```
X(orders) → X(inventory_balances) → INSERT movements [FK warehouse_id → warehouses] cần S(warehouses)
```

Đường **nhập kho / hoàn tất phiếu** (`inbound`, `WarehouseDocumentsService.complete`):

```
X(warehouses) → X(inventory_balances) → INSERT movements (đã có X(warehouses))
```

Kết quả: T1 cầm X(balance) chờ S(warehouse); T2 cầm X(warehouse) chờ X(balance) — InnoDB chọn victim (P2034/1213) và nạn nhân trả lỗi về cho người gọi. FK `inventory_movements.warehouse_id → warehouses.id` đã được xác nhận trong pre-flight FK dump (`.tmp-verify/round3/preflight.txt`).

### 5.2 Reproducer và kết quả TRƯỚC FIX

Script `.tmp-verify/round3/cancel-inbound-deadlock.mts` (chạy `npx tsx --tsconfig apps/api/tsconfig.json … <mode> <rounds>`). Mỗi vòng là một thế giới fixture sạch riêng; bất biến: mọi giao dịch đã commit phải thể hiện đúng delta của chính nó trong balance + ledger + status; kết hợp hành vi sai nghĩa là HARD violation; fixture được dọn sạch sau mỗi lần.

Kết quả trước fix (logs `deadlock-full-run1.txt`, `deadlock-full-run2.txt`):

| Mode | Thiết lập | Vòng | Kết quả |
|---|---|---|---|
| A / A2 | cancel thật vs inbound thật, thời điểm tự nhiên (T2 trước) | 180 | 0 reject — thời điểm tự nhiên hiếm khi gặp đủ độ trễ (vì vậy cần gate B/C bên dưới) |
| B | **gate**: delay 25ms ngay sau `quarantineStock` (T1 cầm X(balance)) trước khi insert movement (cần S(warehouse)) vs inbound thật | 30 + 60 = **90** | **P2034 90/90** trên `tx.inventoryBalance.update()` — victim = inbound |
| C | cancel-gated vs `documents.complete` thật (phiếu DRAFT, cùng warehouse) | 30 + 60 = **90** | **1213/P2010 90/90** trên `$executeRaw` — victim = document, phiếu kết thúc DRAFT |
| D | control: cancel-gated vs inbound **khác warehouse** (không hot row chung) | 60 | 0 reject — xác nhận race không xảy ra khi không cùng hàng nóng |

### 5.3 Fix — lấy khóa `warehouse` trước vòng ghi (quy ước của vòng 2)

1. **`OrdersService.releaseOrderReservations`** (`orders.service.ts`): trước vòng lặp phân bổ, khóa **từng warehouse một, distinct và sort ASC** qua `InventoryService.lockWarehouse` (không gate status):
   ```ts
   const warehouseIds = [...new Set(allocs.map((a) => a.warehouseId))].sort((a, b) => a - b);
   for (const wh of warehouseIds) await InventoryService.lockWarehouse(tx, wh);
   ```
2. **`InventoryService.consumeOrderStock`**: cùng chuẩn, trước vòng consume.
3. **`InventoryService.release`**: thêm `await InventoryService.lockWarehouse(tx, dto.warehouseId)` trước `requireBalance`.

Sau fix, mọi đường ghi tồn kho đều **bắt đầu bằng X(warehouse thứ nhất theo ASC)** (đường inbound đã mở đầu như vậy từ vòng 2) — thứ tự khóa toàn cục trở thành nhất quán, InnoDB không còn chu kỳ chờ.

### 5.4 Verify SAU FIX

Cùng thiết lập gate của 5.2, mode mới:

| Mode | Vòng | Kết quả |
|---|---|---|
| B2 (cancel-gated vs inbound thật) | 60 | 0 rejection; P2034 = 0 — log `deadlock-afterfix-B2-60.txt` |
| C2 (cancel-gated vs doc complete) | 60 | 0 rejection; 1213 = 0 — log `deadlock-afterfix-C2-60.txt` |

- 2 test hồi quy vào suite PASS (`test/concurrency.e2e-spec.ts` dòng 876 và 963 — mục 11).
- Sau fix, toàn bộ ma trận kiểm thử chạy lại sạch — mục 9–10.
- Deliver path (delivery từ SHIPPING) dùng `consumeOrderStock` — được fix cùng đợt; phần còn lại của checkout là mục 6.

## 6. Checkout `reserveLine` — thứ tự khóa ngược lý thuyết (KHÔNG sửa, chờ duyệt)

`OrdersService.reserveLine` (đường checkout): giữ `X(inventory_balances)` cho từng dòng rồi `recordMovement` (insert cần S(warehouse)). Hình dạng này **vẫn ngược hướng so với đường đã fix**: đường đã fix giữ X(warehouse) rồi X(balance); checkout giữ X(balance) rồi mới cần S(warehouse) khi insert.

Trung thực trạng thái:
- Vòng 3 **không tái hiện runtime** hình dạng này — đây là phân tích tĩnh theo shape code.
- Vòng 3 **không sửa** — đường checkout là transaction dài với nhiều tác dụng phụ (idempotency-key, voucher, flash quota, payment, ledger); thêm khóa wh vào đây không phải là thay đổi nhỏ như 3 phương thức trên; cần đợt làm việc riêng kèm test (Q4, mục 16).

Đánh giá rủi ro (công bằng): cửa sổ giữa X(balance) và S(warehouse) của checkout nhỏ, nhưng về lý thuyết vẫn trùng shape; nếu chủ dự án muốn đối xứng hoàn toàn, áp cùng pattern `lockWarehouse` cho `reserveLine` trong một đợt nhỏ (1 hàm + tests riêng).

## 7. Đối soát lại BL-01 / BL-02 / BL-06 / BL-07 (mã + suite đã PASS)

| BL | Điểm code (đối soát vòng 3) | Suite chạy PASS |
|---|---|---|
| BL-01 refund ≤ paid | `apps/api/src/payments/payments.service.ts` — refund cap theo tổng paid-so-far; không refund vượt; audit mỗi refund | `test/business-rules/refund.spec.ts` (trong full-E2E 372/372 ×4) |
| BL-02 returns lệch | `apps/api/src/returns/returns.service.ts` — tính từng item + cap refund theo item | `test/business-rules/evidence-aftersales.spec.ts` + refund.spec (trong full-E2E ×4) |
| BL-06 payouts | `apps/api/src/finance/settlements.service.ts` — `PayoutsService.create`: SELECT ... FOR UPDATE settlements + re-read payouts sau khóa + guard `paidSoFar + amount > payable` → 400; insert + audit cùng transaction; **SettlementsService.create** P2002 (partner_order double-claim) → ConflictException 409 với thông báo "reload" | `test/business-rules/settlement.spec.ts` + `concurrency-money.e2e-spec.ts` (19/19 — mục 10) |
| BL-07 adjust nguyên tử | `apps/api/src/inventory/inventory.service.ts` — UPDATE điều kiện `on_hand + ? >= 0 AND on_hand + ? >= reserved + blocked`; guard reject (0 affected) → BadRequest kèm lý do kinh doanh rõ ràng; race get-or-create đã xử lý winner/loser | `test/business-rules/inventory.spec.ts` |

Không thấy regression: toàn bộ PASS trong ma trận 4 lần full E2E + stress (mục 9–10).

## 8. `POST /inventory/adjust` không idempotent — bằng chứng + đề xuất (KHÔNG triển khai)

### 8.1 Phát hiện

Contract hiện tại: `AdjustInventoryDto` (`apps/api/src/inventory/dto/inventory.dto.ts`) gồm `warehouseId / productLotId / productVariantId / quantityDelta / note` — **không có** trường idempotency. Route `@Post('adjust')` tại `inventory.controller.ts:46`. Logic service (BL-07) an toàn race nhưng **không dedup retry** — mỗi request hợp lệ là một lần cộng tồn kho. UI admin-web gọi `resources.adjustInventory` **không có header idempotency**; CORS cho phép header `Idempotency-Key` từ `main.ts:54` nhưng chỉ checkout sử dụng (`apps/api/src/orders/orders.service.ts`, khoảng dòng 276 — `checkoutIdempotencyKeys`).

### 8.2 Bằng chứng chạy thật trên test DB

Probe `.tmp-verify/round3/adjust-retry-probe.mts`, log `.tmp-verify/round3/adjust-retry-probe.txt` (EXIT=0; lần chạy đầu bị crash bởi sai thứ tự đối số fixture, đã lưu và sửa script — minh bạch về hai lần chạy):

```
PASS  DTO has NO idempotency field — retry is indistinguishable from a new request
PASS  Route confirmed: POST /inventory/adjust (inventory.controller.ts)
INFO  onHand before probe = 50
INFO  after request #1 (committed): DB onHand=55
PASS  request #1 applied +5 exactly once
INFO  after retry (committed): DB onHand=60
INFO  ledger ADJUSTMENT(+5) rows for this balance: 2
RESULT NON_IDEMPOTENT=true observedDelta=10 (expected 5 if at-most-once); movements=2 (expected 1)
CLEANUP removed all probe fixtures (users/partners/…/warehouses/balances)
```

Kịch bản thật: admin bấm "Điều chỉnh +5" → máy chủ commit (ledger +5) → HTTP response mất (timeout/gateway) → frontend retry cùng payload → máy chủ cộng lần 2 → tồn kho +10, 2 dòng ADJUSTMENT cho 1 hành động admin. Probe cũng đặt evidence bằng đọc FILE gốc (không qua DTO runtime) — file `inventory.dto.ts` không chứa bất kỳ từ nào gợi "idempoten".

### 8.3 Đề xuất kỹ thuật (chờ duyệt; KHÔNG code trong vòng 3)

1. **Database**: bảng idempotency `app_idempotency_keys` (`key_hash` PK, `scope` ví dụ `inventory_adjust`, `actor_user_id`, `request_hash` = canonical serialization của DTO, `result_digest` để replay response, `created_at`, `expires_at` TTL) — hoặc tái dùng scheme đồng nhất config tương tự bảng idempotency của checkout cho nhất quán kiến trúc.
2. **API**: controller nhận `@Headers('Idempotency-Key') key`, bắt buộc cho verb mutate; CORS đã allow (`main.ts:54`).
3. **Service flow** trong 1 transaction:
   - INSERT key (scope + request_hash):
     - cùng request_hash → replay kết quả đã lưu (HTTP 200);
     - khác request_hash → 409 "Idempotency-Key reused with different payload";
   - thực hiện `adjust`, lưu result_digest.
4. **UI**: `FormModal`/`useAction` attach key mỗi lần mở modal; nút chỉ đè 1 lần trước timeout (đã có `confirmLoading` chặn double-click tại cấp modal — mục 12 — nhưng network-retry vượt HTTP cần đúng cơ chế này).
5. **Retention** TTL (ví dụ 24 giờ) + job dọn — theo quyết định chủ dự án.

Phạm vi đổi: 1 migration + 1 bảng + DTO/controller/service/UI + tests (retry idempotent, replay, hash-mismatch 409). Ước lượng: 1 đợt làm việc riêng, không lẫn vào vòng 3.

## 9. Kiểm tra tĩnh + unit — nền trước khi đo động

| Bài | Lệnh | Kết quả | Log |
|---|---|---|---|
| Typecheck (sau fix) | `pnpm --filter @agrimarket/api typecheck` | EXIT 0 | `typecheck-round3-fix.log` |
| Typecheck (sau khi thêm 2 test) | cùng lệnh | EXIT 0 | `typecheck-round3-tests.log` |
| Lint | `pnpm --filter @agrimarket/api lint` (`oxlint --type-aware`) | EXIT 0; **đúng 3 warning có sẵn từ HEAD**: `concurrency.e2e-spec.ts:394` (×2) + `warehouse-admin.e2e-spec.ts:271` — `require-array-sort-compare` | `lint-round3.log` |
| Unit | `pnpm --filter @agrimarket/api test` | **34 file / 440 test PASS** | `unit-round3.log` |
| Build | `pnpm --filter @agrimarket/api build` (nest build) | EXIT 0 | `api-build-round3.log` |

## 10. E2E + stress — ma trận chạy thật trên `agrimarket_v2_test`

| Lần | Phạm vi | Kết quả | Log |
|---|---|---|---|
| Full E2E lần 1 | toàn bộ | **372/372 PASS** (13 files) | `e2e-full-round3-run1.log` |
| Full E2E lần 2 | toàn bộ | **372/372 PASS** | `e2e-full-round3-run2.log` |
| Full E2E lần 3 | toàn bộ | **372/372 PASS** | `e2e-full-round3-run3.log` |
| Full E2E lần 4 | toàn bộ | lần đầu bị treo máy (không tạo log, không tính bằng chứng) → **chạy lại sạch: 372/372 PASS, 87.98s** | `e2e-full-round3-run4.log` |
| Conc spec standalone | `concurrency.e2e-spec.ts` | **31/31** | `conc-spec-smoke.txt` |
| Stress 30 vòng | `CONCURRENCY_ROUNDS=30` cho cả 2 spec concurrency + money | **50/50 PASS, 173.26s** | `stress-conc-30-round3.log` |
| Money standalone | `concurrency-money.e2e-spec.ts` | **19/19** | `money-standalone-round3.log` |
| PDF standalone ×3 | PDF spec | **7/7 × 3 lần** | `pdf-standalone-round3-{1,2,3}.log` |
| Admin-web vitest | toàn suite | **40/40 PASS** (7 files) | `admin-web-test-round3.log` |
| Mobile vitest | toàn suite | **175 pass / 3 skipped** (18 file pass, 1 file skipped) | `mobile-test-round3.log` |

Ghi chú trung thực:
- Brief stress yêu cầu ≥30 vòng (60 nếu đủ sức): vòng 3 chạy được mức **30 vòng**, đủ sanity-retry cho cả 2 spec; **chưa chạy mức 60** — nếu chủ dự án yêu cầu chỉ cần đổi `CONCURRENCY_ROUNDS=60` và chạy lại (Phụ lục B).
- Full E2E lần 4 lần đầu treo vì máy ngủ giữa chừng: không tạo log nào, không đếm; chạy lại sạch thấy `Tests  372 passed (372)` / `Duration  87.98s`.
- Tổng tín hiệu tích cực: 4 × 372 = **1488 pass** full E2E sau fix; 0 FAIL xuất hiện trong ma trận.
- Flash Sale "300 suất" là dữ liệu seed demo (sold=0) — không dùng làm bằng chứng kinh doanh.

## 11. Hồi quy bắt buộc — 2 test mới và vị trí trong suite

2 test hồi quy vòng 3 nằm **trong** `apps/api/test/concurrency.e2e-spec.ts` (suite 31 test giữ nguyên; tổng test dự án 370 → 372):

| # | Tên test | Dòng | Chứng minh |
|---|---|---|---|
| 1 | `cancel SHIPPING + concurrent inbound on the same balance: both survive (lock order), ledger matches` | 876 | Hủy SHIPPING (quarantine) ↔ inbound trên cùng warehouse/lot/variant: không ai bị P2034; blocked tăng (quarantine) VÀ onHand tăng (inbound) đúng 1 lần; ledger `inventory_movements` khớp delta |
| 2 | `cancel SHIPPING + concurrent inbound document complete: both survive (lock order)` | 963 | Hủy SHIPPING ↔ `WarehouseDocumentsService.complete` (phiếu nhập DRAFT): hoàn tất phiếu vẫn thành công; ledger khớp; không deadlock |

Cả hai dùng pattern fixture chuẩn (`createConcurrencyWorld`, `world.base`, `createShippingOrder`) và assert theo bất biến hợp đồng (double-effect phải đúng 1 lần) — assertion không được nới lỏng để PASS.

## 12. PL-06 payout (xác minh chéo vòng 3) + UI admin double-click

- **PL-06** — `PayoutsService.create` (`apps/api/src/finance/settlements.service.ts:228`):
  1. SELECT `FOR UPDATE` các settlement DELIVERED của partner — 2 payout song song serialize;
  2. re-read toàn bộ payouts sau khi cầm khóa (tránh race chèn giữa read và eval);
  3. guard `paidSoFar + amount > payable` → `BadRequestException` 400 với lý do rõ ràng;
  4. insert + audit cùng transaction (ReadCommitted).
  Suite PASS: `settlement.spec.ts` + stress 50/50 (mục 10).
- **UI admin double-click** — `apps/admin-web` `FormModal.tsx` dùng `confirmLoading={submitting}` (antd Modal OK button loading): double-click bị chặn ở cấp form/modal, sau mutation thành công modal đóng. `useAction` (react-query mutation) không có guard riêng — lớp chống double-click nằm ở modal; network-retry vượt HTTP cần mục 8.

## 13. Review migration `settlement_line_unique_partner_order`

### 13.1 Nội dung file

`apps/api/prisma/migrations/20261019000000_settlement_line_unique_partner_order/migration.sql`:

```sql
ALTER TABLE `settlement_lines`
  ADD UNIQUE INDEX `settlement_lines_partner_order_id_key` (`partner_order_id`);
```

Comment trong file (nguyên văn ý): pre-check duplicate bằng `SELECT partner_order_id, COUNT(*) … HAVING claims > 1` ở mọi môi trường TRƯỚC khi apply (ALTER sẽ fail nếu có duplicate — trành vi an toàn); góc nhận double-claim từ 2 concurrent creates (đo được vòng 2: 2 creates song song tạo 4 lines cho 2 partner orders); corrections/splits dùng `settlements.adjustment_amount`, không claim lại một partner order lần 2; additive, không rewrite data.

`schema.prisma` dòng SettlementLine thêm `@@unique([partnerOrderId])` + docblock — đúng tên index theo Prisma convention (`settlement_lines_partner_order_id_key`).

### 13.2 Trạng thái môi trường (preflight `.tmp-verify/round3/preflight.txt`)

| DB | Migration | Duplicate check |
|---|---|---|
| dev `agrimarket_v2` | **CHƯA áp** (chỉ có PK + FK + idx settlement_id) | `dupGroups=0` — apply sẽ không fail |
| test `agrimarket_v2_test` | **ĐÃ áp** 2026-10-18 23:42:13 (idx `settlement_lines_partner_order_id_key` unique=true) | `dupGroups=0` |
| prod (nếu có) | chưa check | bắt buộc chạy pre-check SQL ở đích trước khi apply (Q5) |

### 13.3 Nhận xét kỹ thuật (không tô hồng)

- **Đúng nguyên lý**: application filter `settlementLines: { none: {} }` (`settlements.service.ts:82`) không chặn được race khi 2 creates đọc cùng tập unclaimed; DB-level unique index làm loser nhận P2002 → code map sang ConflictException 409 "reload" (`settlements.service.ts:138–141`).
- **Schema-safe**: additive, không rewrite data; FK `settlement_lines_partner_order_id_fkey` giữ nguyên; index mới chỉ là secondary index.
- **Nuance "idempotent to deploy"** trong comment: dòng SQL không có `IF NOT EXISTS` (MySQL/MariaDB không hỗ trợ cho index) — chạy lại SQL trực tiếp sẽ lỗi "Duplicate key name". "Idempotent" đúng ở cấp migration runner (Prisma ghi `_prisma_migrations`, không re-run). Nếu deploy bằng script SQL thủ công ngoài Prisma, cần guard kiểm tra index tồn tại trước.
- **Rollback**: `ALTER TABLE settlement_lines DROP INDEX settlement_lines_partner_order_id_key;` — độc lập; sau khi áp, giữ code như cũ vì P2002 chỉ phát ra khi index tồn tại (nếu drop index mà vẫn giữ code, đường 409 mất → quay về race như trước).
- **Thứ tự triển khai khuyến nghị**: (1) pre-check duplicate ở DB đích; (2) apply migration; (3) deploy code. Đảo ngược thứ tự vẫn an toàn về functional (index chỉ là defense-in-depth dưới application guard), áp trước vẫn sạch hơn.

### 13.4 Policy A/B — cần chủ dự án quyết định (Q2, mục 16)

| | A (đang trong repo) | B (nếu muốn settle nhiều kỳ) |
|---|---|---|
| Ý nghĩa | Mỗi partner order **chỉ bao giờ** thuộc 1 settlement line (DRAFT tính); corrections qua `adjustmentAmount` | Partner order có thể claim trong mỗi period riêng |
| DB | `UNIQUE(partner_order_id)` | Bỏ unique trên; thay bằng `UNIQUE(settlement_id, partner_order_id)` — **mất DB-guard chống double-pay giữa 2 settlements khác nhau** |
| Application | giữ nguyên code | phải nâng guard: advisory lock / SELECT FOR UPDATE toàn tập partner orders khi create + kiểm tra period không chồng lấn — vẫn còn cửa hở DB-level |
| Rủi ro | thấp; đã test đầy đủ | cao: cùng một order được pay lần 2 nếu guard hở; test phải làm lại từ đầu |
| Migration cần | có sẵn | migration mới (drop + add composite), tests mới, đụng đường refund/payout kế toán |

Đề xuất: **giữ A** — khớp business rule trong comment migration ("each partner order contributes to at most one settlement line, across all periods"), đã PASS toàn bộ suite, dễ giải thích với kế toán. B chỉ nên mở khi có yêu cầu chính thức từ doanh nghiệp cần settle đa kỳ.

## 14. Checklist Admin + Customer flows (đối soát theo cây test hiện có)

Mỗi dòng = luồng người dùng và nơi bảo vệ trong test đã PASS suốt ma trận vòng 3 (full E2E ×4 + 40 admin-web + 175 mobile):

| Flow | Nơi bảo vệ | Kết quả |
|---|---|---|
| Admin login + RBAC | auth spec trong full-E2E | PASS ×4 |
| Admin sản phẩm/farm/QC | admin specs trong full-E2E | PASS ×4 |
| Admin nhập kho | `concurrency.e2e-spec.ts` (double complete exactly-once, dòng 1199) | PASS ×4 + standalone 31/31 |
| Admin điều chỉnh tồn kho | `business-rules/inventory.spec.ts` (atomic UPDATE) — **retry idempotent chưa có** (mục 8) | PASS nhưng gap đã ghi rõ |
| Admin hủy SHIPPING → quarantine | `concurrency.e2e-spec.ts` dòng 804 + 876 (mới) + 963 (mới) | PASS ×4 |
| Settlements + payouts | `business-rules/settlement.spec.ts` + `concurrency-money.e2e-spec.ts` | PASS ×4 + 50 stress |
| Xuất PDF báo cáo | PDF spec | 7/7 ×3 |
| Customer browse + Buy Now | buy-now suite trong full-E2E | PASS ×4 |
| Customer checkout không oversell | `concurrency.e2e-spec.ts` dòng 95 + 115 | PASS ×4 |
| Customer checkout idempotent (header key) | `concurrency.e2e-spec.ts` dòng 1270 | PASS ×4 |
| Flash Sale quota / per-customer / overlap / rollback giữa preview-confirm | `concurrency.e2e-spec.ts` dòng 131–402 + 1311–1517 | PASS ×4 |
| Voucher | dòng 400 + 432 | PASS ×4 |
| Cancel/deliver race | dòng 535–806 | PASS ×4 |
| Trả hàng + refund | `business-rules/evidence-aftersales.spec.ts` + refund.spec | PASS ×4 |
| COD / 3DS CAS theo hàng | payment cluster trong full-E2E | PASS ×4 |
| Truy xuất nguồn gốc (trace) | trace spec trong full-E2E + business-rules | PASS ×4 |
| Mobile storefront | mobile vitest 175 pass | PASS |

Gap ghi nhận vòng 3 (không phải FAIL — là phần chưa có kiểm chứng): (a) adjust idempotency (mục 8); (b) checkout lock-order (mục 6 — thuộc cải tiến, không phải hành vi sai; chưa có test); (c) không có E2E UI Playwright thật cho admin-web (chỉ vitest component 40/40 + logic thuộc API e2e) — carry-over, không đổi trong vòng 3.

## 15. Gates go-live (cập nhật vòng 3; carry-over từ báo cáo 07/10)

Đánh giá: **CHƯA đủ điều kiện go-live**. Điểm kiểm chứng mới trong vòng 3:

| Gate | Trạng thái vòng 3 |
|---|---|
| **JWT secret fail-closed** | 🔴 `configuration.ts:24` fallback `'CHANGE_ME'`; cùng fallback tại `auth.module.ts:23` và `jwt.strategy.ts:32` — khi env `JWT_SECRET` trống, server **vẫn khởi động** và chấp nhận token ký bằng secret mặc định công khai. Bắt buộc fail-closed trước go-live |
| **CI** | 🔴 `.github/workflows` **KHÔNG tồn tại** (kiểm tra vòng 3) — không có kiểm thử tự động trên PR/push; toàn bộ ma trận chạy bằng tay |
| Migration settlement unique ở dev | 🟡 đã áp ở test DB; dev chưa áp — bước triển khai chờ duyệt (Q5) |
| SMTP / Mail | 🟡 `configuration.ts:33–39` trống mặc định theo `MAIL_TRANSPORT`; prod cần cấu hình SMTP + secret thật |
| Secret quản lý | 🔴 secrets nằm trong `.env` máy dev (không commit — đúng) nhưng chưa có vault; carry-over |
| **HTTPS/TLS** | 🔴 không kiểm chứng được từ code — hạ tầng deploy; carry-over |
| **Backup/DR DB** | 🔴 chưa thấy thành phần backup tự động; carry-over từ báo cáo 07 |
| Monitoring / audit retention | 🟡 có audit service; retention policy chưa verify; carry-over |
| Rate limiting | 🟡 ngoài phạm vi vòng 3; carry-over |
| Adjust idempotency | 🟡 hành vi kém rerun-safe nhưng impact thấp; chờ duyệt (Q3) |

Fix deadlock + BL-01/02/06/07 không phải go-live gates nhưng phải đi vào đợt deploy đầu sau duyệt.

## 16. Quy tắc cần chủ dự án quyết định + ngưỡng nghiệm thu

- **Q1 — Duyệt fix lock-order vòng 3** (3 phương thức + 2 test hồi quy): bằng chứng pre/post đầy đủ (mục 5.2 vs 5.4), ma trận full PASS. Khuyến nghị: duyệt, commit riêng với nội dung lock-order.
- **Q2 — Policy A/B settlement claim** (mục 13.4): khuyến nghị giữ A.
- **Q3 — Duyệt idempotency `/inventory/adjust`** (mục 8): đề xuất có sẵn; triển khai như một đợt riêng.
- **Q4 — Duyệt lock-order cho checkout `reserveLine`** (mục 6): đợt nhỏ riêng, kèm tests riêng.
- **Q5 — Deployment migration**: pre-check duplicate ở DB đích, apply, rồi deploy code; nếu deploy bằng SQL thủ công cần guard index-exists (mục 13.3).
- **Q6 — Go-live gates**: 🔴 JWT fail-closed + CI + backup plan phải chốt trước go-live; 🟡 xếp lộ trình sau (SMTP, HTTPS, DR, monitoring).

Ngưỡng nghiệm thu đã đạt của vòng 3: mọi bằng chứng lưu `.tmp-verify/round3/` (Phụ lục A); code fix không commit (đúng protocol); 0 FAIL trong ma trận; 2 phát hiện mới (checkout, adjust idempotency) đã có đề xuất duyệt được.

**Kết luận: vòng 3 đủ điều kiện trình chủ dự án nghiệm thu đối với phạm vi fix lock-order + review migration + policy A; hai phát hiện mới (checkout `reserveLine`, `/inventory/adjust` idempotency) đã nộp nền kỹ thuật chờ quyết định riêng.**

---

## Phụ lục A — Bằng chứng cục bộ (`.tmp-verify/round3/`, gitignored)

| File | Nội dung |
|---|---|
| `preflight.txt` | đọc-only metadata 2 DB — dev chưa áp migration + dup=0; test đã áp (2026-10-18); FK `inventory_movements.warehouse_id → warehouses` |
| `env-and-fk-check.mjs` | script pre-flight (read-only, không in secret) |
| `cancel-inbound-deadlock.mts` | reproducer 7 modes A/A2/B/C/D/B2/C2 |
| `deadlock-full-run1.txt`, `deadlock-full-run2.txt` | trước fix: B 90/90 P2034; C 90/90 1213; A/A2/D sạch |
| `deadlock-afterfix-B2-60.txt`, `deadlock-afterfix-C2-60.txt` | sau fix: 0/60 + 0/60 rejection |
| `adjust-retry-probe.mts`, `adjust-retry-probe.txt` | probe non-idempotency: +10 thay vì +5, 2 movement rows, EXIT=0 |
| `typecheck-round3-fix.log`, `typecheck-round3-tests.log` | EXIT 0 ×2 |
| `lint-round3.log` | EXIT 0; 3 warning có sẵn từ HEAD |
| `unit-round3.log` | 34 file / 440 test PASS |
| `api-build-round3.log` | nest build EXIT 0 |
| `e2e-full-round3-run1..4.log` | 372/372 ×4 (run4 re-run sạch 87.98s) |
| `conc-spec-smoke.txt` | 31/31 |
| `stress-conc-30-round3.log` | 50/50, 173.26s |
| `money-standalone-round3.log` | 19/19 |
| `pdf-standalone-round3-{1,2,3}.log` | 7/7 ×3 |
| `admin-web-test-round3.log` | 40/40 |
| `mobile-test-round3.log` | 175 pass / 3 skipped |

Mỗi file log ghi cả stdout/stderr + `EXIT=$LASTEXITCODE` tại chỗ; PowerShell `Tee-Object` hiện NativeCommandError trên stderr (artifact cấu hình powershell) — không ảnh hưởng exit code ghi nhận.

## Phụ lục B — Thủ tục chạy lại

```bash
# 1. pre-flight (read-only, không in secret)
node .tmp-verify/round3/env-and-fk-check.mjs

# 2. deadlock reproducer sau fix (60 vòng mỗi mode)
npx tsx --tsconfig apps/api/tsconfig.json .tmp-verify/round3/cancel-inbound-deadlock.mts B2 60
npx tsx --tsconfig apps/api/tsconfig.json .tmp-verify/round3/cancel-inbound-deadlock.mts C2 60

# 3. ma trận kiểm thử
pnpm --filter @agrimarket/api test          # unit 440
pnpm --filter @agrimarket/api typecheck
pnpm --filter @agrimarket/api lint
pnpm --filter @agrimarket/api test:e2e      # full 372
CONCURRENCY_ROUNDS=30 pnpm --filter @agrimarket/api test:e2e -- concurrency.e2e-spec concurrency-money.e2e-spec
CONCURRENCY_ROUNDS=60 …                     # mức 60 nếu chủ dự án yêu cầu
pnpm --filter @agrimarket/admin-web test
pnpm --filter @agrimarket/mobile test

# 4. idempotency probe (test DB)
npx tsx --tsconfig apps/api/tsconfig.json .tmp-verify/round3/adjust-retry-probe.mts
```

## Phụ lục C — Sao lưu A2 (ngoài repo)

- Đích: `C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-backup-round3\`
- `BACKUP-MANIFEST.txt`: HEAD `90c28de8f773af2b266b96979f9508155e9523fe`, branch `fix/bl-01-02-settlement-con-01`, ngày tạo, danh sách 25 file.
- 25 file (13 modified + untracked expand qua `-uall`), đã **bỏ chủ ý** `.tmp-verify/*` và file riêng chủ dự án.
- Đối chứng **SHA256 25/25 khớp** giữa source ↔ backup; bản copy read-only; repo và branch không bị tác động.
- Thư mục temp có thể bị OS dọn — đây là biện phòng chợt mưa, **không thay thế git**: quyết định cuối thuộc mục 16 Q1 sau duyệt.
- `.tmp-verify/` không được backup ra ngoài (chứng cứ nằm nguyên vị trí trong repo-gitignored), không bị xóa, nguyên vẹn sau vòng 3.

---

# BỔ SUNG BÀN GIAO — 2026-10-22

> **Tính toàn vẹn của báo cáo:** mục 1–16 và Phụ lục A–C phía trên được giữ nguyên văn bản gốc; SHA256 bản gốc trước khi bổ sung là `0B42D902E49615029026984B64D5CB6ECAABCD2CD0203CCC4552CA58525C8E72` (bản gốc được lưu tại bundle, xem mục 24). Phần dưới chỉ **ghi thêm**: quyết định của chủ dự án, vật liệu bàn giao, danh sách file commit/loại trừ, kế hoạch commit, kế hoạch migration dev/staging, rủi ro mở và điều kiện nghiệm thu.

## 17. Biên bản quyết định của chủ dự án (Q1–Q6)

| Câu hỏi | Quyết định của chủ dự án | Hệ quả / việc tiếp theo |
|---|---|---|
| **Q1 — Fix lock-order vòng 3** | Đồng ý về nguyên tắc với bản sửa lock-order; **chưa commit cho đến khi hoàn tất review diff** | Điều kiện AC1: chủ dự án review xong diff 3 phương thức + 2 test hồi quy, sau đó mới thực hiện chuỗi commit C1–C9 (mục 21). Bằng chứng pre/post fix giữ nguyên ở mục 5. |
| **Q2 — Settlement policy** | **Chọn A** — một partner order thuộc một settlement line duy nhất; **không tự áp migration production** | Schema + migration + nhánh P2002→409 đi vào commit C5. Migration chỉ được apply theo kế hoạch Q5 với phê duyệt riêng; production không nằm trong phạm vi. |
| **Q3 — Idempotency `/inventory/adjust`** | Đồng ý thiết kế phương án; **chưa sửa code hoặc tạo migration cho đến khi phương án được duyệt** | Bằng chứng non-idempotent (`+10` thay vì `+5`, 2 movement rows) giữ nguyên mục 8. Đợt triển khai phải là change request riêng: bảng idempotency + header + UI + test retry/replay/409 + TTL. Không hunk nào của phần này có trong patch hiện tại (đúng yêu cầu). |
| **Q4 — Checkout `reserveLine` lock-order** | Kiểm toán thêm checkout `reserveLine`, **ưu tiên kiểm thử tái hiện; không refactor khi chưa có bằng chứng và phương án an toàn** | Việc tiếp theo: viết reproducer dùng lại harness `.tmp-verify/round3/cancel-inbound-deadlock.mts` cho cặp checkout-reserve ↔ inbound/document/adjust trên test DB, chạy gate đủ vòng; chỉ khi tái hiện được mới trình phương án. Chưa có test/không sửa trong vòng 3 (mục 6). |
| **Q5 — Migration dev/staging** | Chuẩn bị kế hoạch migration dev/staging kèm **backup, duplicate pre-check và rollback**; **chưa thực hiện** | Kế hoạch đầy đủ tại `migration/MIGRATION-PLAN-DEV-STAGING.md` (mục 22). Điều kiện AC5: pre-check = 0, backup restore thử OK, rollback diễn tập trên clone, mới apply dev → staging. |
| **Q6 — Go-live** | **Chưa cho phép go-live.** JWT fail-closed, CI và backup/restore là các **điều kiện cần hoàn thiện** | Trạng thái go-live vẫn là **NO-GO**. Ba blocker bắt buộc: (1) JWT secret fail-closed; (2) CI tự động chạy test; (3) backup/restore có bằng chứng và diễn tập. Sau đó mới xét các mục 🟡 SMTP/HTTPS/DR/monitoring/rate-limit. |

## 18. Trạng thái thực hiện nhiệm vụ bàn giao này

Đã làm:

- Giữ nguyên toàn bộ mã nguồn, baseline và bằng chứng vòng 1–3; không commit, không push, không merge, không deploy, không apply migration, không sửa code.
- Xuất báo cáo này kèm Git diff, migration và log kiểm thử quan trọng trong một bundle bàn giao ngoài repo (mục 24).
- Tạo **một patch** chỉ chứa thay đổi ứng dụng + test của ba vòng; đã kiểm tra patch chứa đủ 2 file mới chưa được Git theo dõi.
- Lập danh sách chính xác file dự kiến commit và file phải loại trừ (mục 20).
- Đề xuất chuỗi commit nhỏ, có thể truy vết, kèm cách tách hunk và kiểm tra không mất thay đổi (mục 21).
- Ghi nhận rủi ro mở và điều kiện nghiệm thu (mục 23).

Không làm (theo đúng chỉ đạo):

- Không tạo commit/tag/branch mới; không `git add`; không thay đổi index/staging; không chạy `format`/`lint --fix`; không regenerate Prisma client; không đụng `.env`, `backups/`, `uploads/`.
- Không sửa file riêng của chủ dự án `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md`; không đọc secret; không in giá trị secret vào bất kỳ log nào.
- Không chạy thêm test ghi dữ liệu trong nhiệm vụ này; mọi số liệu test trích từ log vòng 3 đã có.

## 19. Patch bàn giao

| Thuộc tính | Giá trị |
|---|---|
| Tên file | `agrimarket-round1-3-app-test.patch` |
| Vị trí trong bundle | `git/agrimarket-round1-3-app-test.patch` |
| Kích thước | 108.201 bytes |
| SHA256 | `605E44CC31B292E6669700013A8A591FB20BFCB5B73D01703721622C80A77686` |
| Baseline | HEAD `90c28de8f773af2b266b96979f9508155e9523fe`, branch `fix/bl-01-02-settlement-con-01` |
| Phạm vi | 13 file tracked-modified + 2 file mới chưa theo dõi = 15 file |
| Tổng diff | 2.086 insertions / 169 deletions |
| File mới bắt buộc có | `apps/api/prisma/migrations/20261019000000_settlement_line_unique_partner_order/migration.sql` (28 dòng), `apps/api/test/concurrency-money.e2e-spec.ts` (1.005 dòng) |
| Định dạng | Unified diff, UTF-8 không BOM, LF; có `new file mode 100644` cho 2 file mới |

Kiểm chứng đã chạy trong nhiệm vụ này (log tại `verification/patch-apply-and-hash-verification.txt`):

1. `git apply --check` trên cây HEAD sạch: **EXIT 0**.
2. Apply thật lên cây HEAD sạch (`git -c core.autocrlf=false archive HEAD` + `git apply`): **EXIT 0**.
3. Đối chiếu SHA256 sau apply với working tree: **14/15 file khớp byte-for-byte**. File còn lại `apps/api/test/business-rules/evidence-aftersales.spec.ts` khác do working tree đang CRLF (`git ls-files --eol`: `i/lf w/crlf`) trong khi patch mang LF — đúng nội dung Git sẽ commit; `git diff --ignore-cr-at-eol` giữa hai bản rỗng (không khác nội dung). 14 file còn lại đều `i/lf w/lf`.
4. Không có path ngoài danh sách 15 file trong patch (`git apply --numstat`).
5. Quét secret/PII: xem `security/patch-secret-pii-scan.txt` — 0 private key, 0 AWS key, 0 JWT/bearer, 0 credentialed DB URL, 0 hardcoded password/secret, 0 email cá nhân; 1 match regex số điện thoại là fixture tổng hợp `0900000000` trong test, không phải dữ liệu cá nhân thật.

Lưu ý kỹ thuật khi dùng patch: repo đang bật `core.autocrlf=true`; nếu apply trên máy khác, nên dùng `git -c core.autocrlf=false apply` để tái lập chính xác nội dung LF như khi commit, hoặc dùng `git apply` mặc định rồi để Git chuẩn hoá khi `git add`.

## 20. File dự kiến commit và file phải loại trừ

**Dự kiến commit — 15 file (chi tiết + SHA256 trong `git/commit-file-manifest.txt`):**

| # | File | Trạng thái | Vòng | Commit đích |
|---|---|---|---|---|
| 1 | `apps/api/prisma/schema.prisma` | M | 2 | C5 |
| 2 | `apps/api/src/finance/settlements.service.ts` | M | 2 | C4 + C5 |
| 3 | `apps/api/src/inventory/inventory.service.ts` | M | 2 + 3 | C3 + C9 |
| 4 | `apps/api/src/orders/orders.service.ts` | M | 3 | C9 |
| 5 | `apps/api/src/payments/payments.service.ts` | M | 1 | C1 |
| 6 | `apps/api/src/returns/returns.service.ts` | M | 1 + 2 | C2 |
| 7 | `apps/api/test/business-rules/evidence-aftersales.spec.ts` | M | 2 | C2 |
| 8 | `apps/api/test/business-rules/inventory.spec.ts` | M | 2 | C3 |
| 9 | `apps/api/test/business-rules/refund.spec.ts` | M | 1 | C1 |
| 10 | `apps/api/test/business-rules/settlement.spec.ts` | M | 2 | C5 |
| 11 | `apps/api/test/concurrency.e2e-spec.ts` | M | 1/2 + 3 | C8 + C9 |
| 12 | `apps/api/test/helpers/concurrency-fixtures.ts` | M | 1/2 | C6 |
| 13 | `apps/api/test/helpers/pdf-text.ts` | M | 2 | C7 |
| 14 | `apps/api/prisma/migrations/20261019000000_settlement_line_unique_partner_order/migration.sql` | **A (untracked)** | 2 | C5 |
| 15 | `apps/api/test/concurrency-money.e2e-spec.ts` | **A (untracked)** | 1–2 | C6 |

**Phải loại trừ khỏi patch/commit code (chi tiết trong `git/excluded-files.txt`):**

| Nhóm | File/thư mục | Lý do |
|---|---|---|
| Tài liệu chủ dự án | `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` | File riêng của chủ dự án; không phải app/test; không sửa |
| Báo cáo kiểm toán | `audit-reports/01..11*.md` | Bằng chứng/báo cáo, không phải app/test; `11` là hiện vật bàn giao, commit docs riêng nếu được duyệt |
| Bằng chứng cục bộ | `.tmp-verify/**` | Gitignored; giữ nguyên tại chỗ, không commit |
| Secret | `apps/api/.env`, `apps/admin-web/.env.local`, `apps/mobile/.env` | Gitignored; chứa credential thật |
| Database | `backups/` | Dump DB; chính sách "never commit" |
| Dữ liệu người dùng | `apps/api/uploads/`, `uploads/` | File upload có thể chứa PII |
| Generated/tooling | `node_modules*/`, `dist/`, `.next/`, `generated/`, `.expo/`, `.kilo/`, `.playwright-mcp/`, `*.log`, `tsconfig.tsbuildinfo` | Không phải nguồn; có thể chứa token/máy cục bộ |
| Tracked không đổi | `package.json`, lockfile, `README.md`, `docs/**`, các app web/mobile | Không có diff; không nằm trong patch |

## 21. Kế hoạch commit nhỏ, truy vết được (đề xuất — chưa thực hiện)

Nguyên tắc: một commit = một mối quan tâm; tách hunk bằng `git add -p`; không reset cứng; kiểm tra `git diff --cached --check` sau mỗi lần stage. Kế hoạch chi tiết + hướng dẫn tách hunk nằm ở `git/commit-plan.md`. Tóm tắt 9 commit:

| # | Commit message đề xuất | File/hunk | Kiểm tra chính |
|---|---|---|---|
| C1 | `fix(api): serialize refunds and cap to paid amount (BL-01)` | `payments.service.ts`, `refund.spec.ts` | unit refund + typecheck |
| C2 | `fix(api): serialize return creation and bound claims (BL-02)` | `returns.service.ts`, `evidence-aftersales.spec.ts` | unit evidence + typecheck |
| C3 | `fix(api): make inventory adjustment atomic with warehouse-first lock (BL-07)` | hunk `adjust` + `lockWarehouse` của `inventory.service.ts`, `inventory.spec.ts` | unit inventory |
| C4 | `fix(api): serialize payouts on the settlement row (BL-06)` | hunk `PayoutsService.create` của `settlements.service.ts` | typecheck (test phủ ở C6) |
| C5 | `fix(api): enforce one settlement line per partner order (policy A)` | `schema.prisma`, migration file mới, hunk `SettlementsService.create`, `settlement.spec.ts` | unit settlement |
| C6 | `test(api): add money and stock race acceptance suite` | `concurrency-money.e2e-spec.ts` (mới), `concurrency-fixtures.ts` | e2e money (cần `TEST_DATABASE_URL`) |
| C7 | `test(api): make PDF text extraction ligature-safe` | `pdf-text.ts` | e2e reports-export |
| C8 | `test(api): add deterministic cancel/deliver race coverage` | hunk round 1/2 của `concurrency.e2e-spec.ts` | e2e concurrency |
| C9 | `fix(api): order warehouse locks to remove cancel/inbound deadlock (round 3)` | `orders.service.ts`, hunk `consumeOrderStock` + `release`, hunk 2 test mới của `concurrency.e2e-spec.ts` | e2e concurrency + full E2E |

Biện pháp chống mất thay đổi: (1) patch ngoài repo đã có trước; (2) copy thêm một backup trước commit đầu; (3) sau mỗi commit chạy `git diff HEAD -- <các file của commit>` để chắc không còn phần sót; (4) sau commit cuối, `git diff HEAD -- <15 file>` phải rỗng và `git status` chỉ còn mục loại trừ có chủ đích. Nếu một hunk bị dính ranh giới, dùng `git add -p` → `e` để chỉnh chứ không sửa code.

## 22. Kế hoạch migration dev/staging (Q5 — tóm tắt)

Kế hoạch đầy đủ: `migration/MIGRATION-PLAN-DEV-STAGING.md`. Tóm tắt bắt buộc:

1. **Pre-check duplicate** trên DB đích: `SELECT partner_order_id, COUNT(*) … HAVING claims > 1` → phải **0 dòng** trước khi apply; nếu >0 thì dừng và xử lý theo nghiệp vụ.
2. **Backup** `mysqldump --single-transaction --routines --triggers --events` + SHA256 + **restore thử** sang DB scratch và đối chiếu row counts (bảng settlement/payout/partner order).
3. **Đo và diễn tập trên clone staging**: apply vào bản sao prod-like, chạy full E2E + concurrency money/stock trỏ vào clone, đo thời gian ALTER.
4. **Apply dev** bằng `npm run db:deploy --workspace @agrimarket/api` (Prisma `migrate deploy`); verify index unique, `dupGroups=0`, `_prisma_migrations.finished_at`; smoke 409 khi claim lại.
5. **Rollback**: drop index `settlement_lines_partner_order_id_key`; lưu ý mất DB-guard và Prisma không có down-migration (cần phê duyệt thủ công nếu muốn xoá dòng migration để deploy lại). Phương án cuối là restore backup.
6. **Production: KHÔNG thực hiện trong nhiệm vụ này**, không tự động apply; chỉ mở khi có change request + backup + cửa sổ + phê duyệt.

## 23. Rủi ro mở và điều kiện nghiệm thu

### 23.1 Rủi ro còn mở

| ID | Rủi ro | Mức | Trạng thái | Điều kiện đóng |
|---|---|---|---|---|
| RR3-01 | `POST /inventory/adjust` không idempotent (retry cộng tồn 2 lần; probe +10 thay vì +5, 2 movement rows) | Trung bình (thao tác admin) | Chờ duyệt (Q3), chưa code | Phương án idempotency được duyệt + triển khai + test retry/replay/409 + migration riêng |
| RR3-02 | Checkout `reserveLine` giữ X(balance) trước S(warehouse) — hình dạng ngược lock-order, **chưa tái hiện runtime** | Trung bình–cao (lý thuyết) | Chờ bằng chứng (Q4) | Reproducer gate đủ vòng trên test DB; nếu tái hiện thì có phương án + test an toàn trước khi refactor |
| RR3-03 | JWT secret fail-open: `configuration.ts:24`, `auth.module.ts:23`, `jwt.strategy.ts:32` fallback `'CHANGE_ME'` | **Cao — go-live blocker** | Chưa sửa | Fail-closed khi thiếu/secret yếu + test khởi động thất bại khi env thiếu |
| RR3-04 | Không có CI (`.github/workflows` không tồn tại); toàn bộ ma trận chạy tay | **Cao — go-live blocker** | Chưa có | Pipeline PR/push chạy typecheck/lint/unit/E2E (có DB test) và báo đỏ khi fail |
| RR3-05 | Chưa có bằng chứng backup/restore tự động cho DB | **Cao — go-live blocker** | Chưa có | Có lịch backup + restore drill định kỳ + log kiểm chứng |
| RR3-06 | Migration unique chưa áp dev; prod chưa kiểm tra duplicate; chưa chạy apply ở staging | Trung bình | Chờ thực hiện (Q5) | Kế hoạch mục 22 chạy xong với biên bản + 0 duplicate |
| RR3-07 | Stress mới chạy 30 vòng (khuyến nghị ≥30, tùy chọn 60) | Thấp | Đã ghi nhận | Chạy `CONCURRENCY_ROUNDS=60` cho 2 spec concurrency nếu chủ dự án yêu cầu |
| RR3-08 | Chưa có E2E UI Playwright thật cho admin-web (chỉ vitest component + API e2e) | Trung bình | Carry-over | Bổ sung E2E UI theo luồng nghiệp vụ chính trước go-live |
| RR3-09 | SMTP/HTTPS/rate-limit/monitoring/audit retention chưa xác minh đầy đủ | Trung bình | Carry-over | Xác minh cấu hình + bằng chứng vận hành; xếp lộ trình sau 3 blocker |
| RR3-10 | `audit-reports/` và báo cáo 11 đang untracked, chưa vào Git | Thấp | Chờ quyết định | Commit docs riêng khi chủ dự án duyệt; nội dung đã được đóng gói trong bundle |
| RR3-11 | Câu "idempotent to deploy" trong migration chỉ đúng ở cấp Prisma runner; chạy SQL thủ công lần 2 sẽ lỗi "Duplicate key name" | Thấp | Đã tài liệu hoá | Chỉ apply qua `migrate deploy`; nếu chạy tay phải guard index-exists trước |
| RR3-12 | Suite mới tự skip khi thiếu `TEST_DATABASE_URL` | Thấp | Theo thiết kế | CI phải cấu hình DB test để suite thực sự chạy, tránh "xanh giả" |
| RR3-13 | Dữ liệu test/fixture là tổng hợp, không phải dữ liệu kinh doanh thật; Flash Sale "300 suất" là seed demo | Thấp | Đã ghi nhận | Không dùng làm bằng chứng kinh doanh; đối chiếu runtime khi nghiệm thu nghiệp vụ |

### 23.2 Điều kiện nghiệm thu

| # | Điều kiện | Trạng thái hiện tại |
|---|---|---|
| AC1 | Chủ dự án review xong diff lock-order (3 phương thức + 2 test hồi quy) và đồng ý commit | **Chờ** (Q1) — patch sẵn sàng |
| AC2 | Policy A được ghi nhận; không tự áp migration production | **Đạt về quyết định**; thực thi migration chờ Q5 |
| AC3 | Phương án idempotency `/inventory/adjust` được duyệt trước khi code | **Chờ duyệt** (Q3); chưa code/migration |
| AC4 | Checkout `reserveLine` được tái hiện bằng test trước khi refactor | **Chưa** (Q4); ưu tiên kiểm thử tái hiện |
| AC5 | Kế hoạch migration dev/staging được duyệt và chạy với backup + pre-check + rollback | **Chờ thực hiện** (Q5); kế hoạch đã có |
| AC6 | JWT fail-closed + CI + backup/restore hoàn thiện | **Chưa đạt — go-live blocker** (Q6) |
| AC7 | Patch apply sạch lên HEAD, đủ 15 file gồm 2 file mới untracked, không mất thay đổi | **Đạt** — log verification trong bundle |
| AC8 | Patch không chứa secret/database/PII | **Đạt** — scan 0 secret thật; 1 fixture giả |
| AC9 | Bằng chứng vòng 1–3 được giữ nguyên, không sửa/xoá | **Đạt** — `.tmp-verify/` nguyên vẹn; báo cáo 11 chỉ ghi thêm, có hash bản gốc |

### 23.3 Kết luận go/no-go

**NO-GO cho go-live.** Vòng 3 **đủ điều kiện trình nghiệm thu phạm vi** (fix lock-order + policy A + review migration + kế hoạch migration) theo Q1–Q5, nhưng **chưa đủ điều kiện vận hành production** cho đến khi RR3-03 (JWT fail-closed), RR3-04 (CI) và RR3-05 (backup/restore) được đóng theo Q6.

## 24. Hiện vật bàn giao

Bundle ngoài repo (không chứa secret; có thể gửi cho AI kiểm toán chéo):

`C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-handoff-round3\`

| Đường dẫn | Nội dung |
|---|---|
| `README-HANDOFF.md` | Chỉ mục bundle + thứ tự đọc đề xuất |
| `reports/11-ROUND-3-ACCEPTANCE-AND-RISK-REVIEW.md` | Báo cáo này (bản đầy đủ sau bổ sung) |
| `reports/11-ROUND-3-ACCEPTANCE-AND-RISK-REVIEW.original.md` | Bản gốc trước khi bổ sung (SHA256 `0B42D902…C8E72`) |
| `reports/01-ARCHITECTURE.md` … `10-FIX-ROUND-2-VERIFICATION.md` | Báo cáo kiểm toán 01–10, bối cảnh vòng 1–2 |
| `reports/CONCURRENCY-AUDIT.md`, `reports/BUSINESS-RULES.md` | Tài liệu quy tắc được code tham chiếu |
| `reports/AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` | Ghi chú kiểm toán chéo của chủ dự án (giữ nguyên) |
| `git/agrimarket-round1-3-app-test.patch` | Patch 15 file app + test (SHA256 `605E44CC…A77686`) |
| `git/commit-plan.md` | Kế hoạch 9 commit nhỏ + cách tách hunk + kiểm tra an toàn |
| `git/commit-file-manifest.txt` | 15 file dự kiến commit + SHA256 + commit đích |
| `git/excluded-files.txt` | Danh sách loại trừ + lý do (secret/DB/PII/generated/docs) |
| `git/git-diff-tracked-full.patch` | Toàn bộ `git diff` phần tracked (13 file, 63.713 bytes) |
| `git/git-status-porcelain-uall.txt`, `git-diff-stat.txt`, `git-diff-numstat.txt`, `patch-numstat.txt` | Đối chiếu Git diff/status |
| `migration/20261019000000_settlement_line_unique_partner_order.sql` | Bản sao migration gốc |
| `migration/MIGRATION-PLAN-DEV-STAGING.md` | Kế hoạch backup/pre-check/apply/rollback dev–staging (Q5) |
| `logs/round3/**` | Toàn bộ log/script vòng 3: deadlock pre/post, adjust probe, e2e ×4, unit, lint, typecheck, build, money, PDF, admin, mobile, preflight |
| `logs/` (root) + `logs/pdf-flake*` | Log/probe vòng 1–2 liên quan (e2e-run 1–4, refund probe, round2 PDF, index-check…) |
| `security/patch-secret-pii-scan.txt` | Kết quả quét secret/PII trên patch |
| `verification/patch-apply-and-hash-verification.txt` | Log apply patch lên HEAD sạch + đối chiếu SHA256 (2 phương pháp LF/CRLF) |
| `verification/report-11-integrity.txt` | Kiểm tra prefix gốc của báo cáo 11 (hash bản gốc và bản sau bổ sung) |
| `SHA256SUMS.txt` | Checksum toàn bộ file trong bundle |

Hiện vật trong repo (giữ nguyên vị trí, không commit):

- `audit-reports/11-ROUND-3-ACCEPTANCE-AND-RISK-REVIEW.md` — bản chính của báo cáo này (mục 17–24 vừa bổ sung).
- `.tmp-verify/round3/**` — bằng chứng gốc vòng 3 (gitignored).
- `.tmp-verify/**` — bằng chứng vòng 1–2 (gitignored).

## 25. Xác nhận phạm vi

Nhiệm vụ bàn giao dừng ở mức tài liệu + patch + kế hoạch. **Không** commit, **không** push, **không** merge, **không** deploy, **không** apply migration, **không** sửa mã nguồn, **không** xoá/đổi bằng chứng. Mọi hành động ghi vào Git/DB tiếp theo thuộc thẩm quyền chủ dự án sau các điều kiện AC1–AC6.




