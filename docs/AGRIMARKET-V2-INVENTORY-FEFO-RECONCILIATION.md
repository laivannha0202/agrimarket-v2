# AgriMarket V2 — Inventory & FEFO Reconciliation (A1/A2 Final Acceptance)

**Ngày:** 2026-10-12 · **Phạm vi:** tồn kho, giữ chỗ, FEFO, xuất kho, giao hàng, hoàn hàng, COD.
**Nguyên tắc:** DEV `agrimarket_v2` chỉ SELECT; mọi kiểm thử ghi chạy trên TEST `agrimarket_v2_test` độc lập, có guard tên DB. Không branch mới, không commit/push, không ghi đè thay đổi chưa commit.

---

## 1. Executive Summary

| Vấn đề | Kết luận sau root-cause + test thực tế |
|---|---|
| **A1 — 11 lô drift (`remaining ≠ on_hand + reserved`)** | **Công thức kiểm toán cũ sai bất biến.** Schema chứng minh `on_hand` đã bao gồm `reserved` (`available = onHand − reserved − blocked`, `apps/api/src/inventory/inventory.service.ts:37-39`). Cộng `on_hand + reserved` là đếm trùng. Bất biến đúng: `remaining_quantity ≈ on_hand` (tồn vật lý) và `available = on_hand − reserved − blocked` (tồn có thể bán). Với bất biến đúng, 10/11 lô SELLABLE khớp (`remaining = on_hand`); phần `reserved` là giữ chỗ hợp lệ của đơn PENDING/CONFIRMED/SHIPPING, không phải drift. Lot #41 REJECTED/QC FAIL không có balance/movement — đúng (không nhập kho). Một phần `remaining` thấp hơn `on_hand` đúng bằng tổng allocation (ví dụ lot #39: `remaining 495 = on_hand 500 − 5 allocated`) là dấu vết **seed trừ `remaining` ngay khi reserve** (`apps/api/prisma/seed.ts:1377-1380`), trong khi code hiện hành chỉ trừ khi DELIVERED — **lỗi lịch sử/seed, không phải lỗi code hiện tại**. |
| **A2 — 0 OUTBOUND dù có 4 đơn DELIVERED** | **Đúng là thiếu, nhưng là dữ liệu lịch sử trước bản vá.** 3 đơn seed (#14, #15, #18) tạo trực tiếp qua Prisma với `status DELIVERED` mà không đi qua service (`seed.ts` không gọi `consumeOrderStock`); đơn #40 (tạo 01:17, DELIVERED 01:46 ngày 11/10) đi qua `OrdersService` **trước** commit `13431d8` (20:18 ngày 11/10) nên code khi đó chưa có consume + còn tự PAID COD. Code hiện tại (sau `13431d8` + đợt này) đã consume ở cả hai đường DELIVERED, đã chứng minh bằng TEST DB. **Không backfill OUTBOUND lịch sử** (thiếu bằng chứng nghiệp vụ). |
| **Order #40 `ORD-20261011-0018`** | Đơn thật qua app: CUSTOMER #19 tạo → ADMIN #13 (`admin@agrimarket.vn`) duyệt tuần tự PENDING→CONFIRMED→PREPARING→READY→SHIPPING→DELIVERED trong ~80 giây, không Shipment/Fulfillment, COD thành PAID cùng giây với DELIVERED (cơ chế cũ tự PAID). Allocation #48 (lot #53, qty 2) FEFO đúng; balance #50 giữ `reserved=32` (30 của đơn PENDING #28 + 2 của #40 đã giao nhưng chưa consume — đúng với code cũ). **Không sửa đơn #40.** |

**Verdict:** CODE FIXED (P0 đã chứng minh) · TEST PASS (unit 376/376, e2e 329/329 trên TEST DB) · DEV DATA PENDING APPROVAL (đối soát dry-run, dừng trước áp dụng) · Không còn P0/P1 code trong phạm vi này.

---

## 2. Git Baseline

- Branch: `main`. HEAD trước/sau: `c7220ee` (không commit mới trong nhiệm vụ).
- Commit `13431d8` (11/10 20:18): thêm `consumeStock`/`consumeOrderStock`, bỏ tự PAID COD khi DELIVERED, settlement chỉ DELIVERED + chống claim trùng, lot validate farm/partner + `FOR UPDATE`.
- Dirty tree được bảo toàn: 19 file `customer-web` modified + QA scripts untracked từ phiên trước giữ nguyên; đợt này chỉ sửa thêm 4 service + 4 test file API (xem §7). Không stash/checkout/reset/clean, không tạo branch, không commit/push.

---

## 3. Root Cause (bằng chứng từng hàm)

Semantics schema (đọc từ source, không suy đoán):
- `InventoryBalance`: `onHand` = tồn vật lý (đã bao gồm phần đang giữ), `reserved` = phần đã giữ, `blocked` = cách ly. `available = onHand − reserved − blocked`.
- `ProductLot.remainingQuantity` = tồn vật lý theo lô; khởi tạo = `quantity` khi tạo lô, seed nhập kho không đổi, seed **trừ ngay khi allocate** (`remainingQuantity: { decrement: take }`), code mới chỉ trừ khi DELIVERED.

| Hàm / đường | Bằng chứng code | Kết luận |
|---|---|---|
| `reserveStock` | `UPDATE ... SET reserved = reserved + ? WHERE on_hand − reserved − blocked >= ?` (`inventory.service.ts:237-242`) | Đúng, chống oversell ở DB. |
| `releaseStock` (trước fix) | `SET reserved = GREATEST(reserved − ?, 0) WHERE id = ?` — không guard, `before = after + quantity` bịa | **P0: che underflow + double release.** Đã fix → `SET reserved = reserved − ? WHERE reserved >= ?`, trả `null` khi guard fail. |
| `release()` Admin (`POST /inventory/release`, ADMIN-only) | Pre-check `quantity > reserved → 400` rồi gọi `releaseStock`; không gắn allocation/order nào, không idempotency, không chặn release sau consume/DELIVERED | **P1: thao tác thủ công mù.** Đã fix phần DB (guard + 409); còn lại chặn bằng quy trình (chỉ dùng cho sự cố, đối soát allocation trước khi bấm), đã ghi vào risk matrix. |
| `releaseOrderReservations` (cancel) | Gọi `releaseStock` không kiểm tra `null` (trước fix) | **P0:** đã fix → `null` thì `ConflictException`, rollback cả cancel. |
| `consumeStock` | `SET on_hand −= q, reserved −= q WHERE reserved >= q AND on_hand >= q` | Đúng từ `13431d8`. |
| `consumeOrderStock` (trước fix đợt này) | Ghi OUTBOUND **trước** khi trừ `remaining`; trừ lot bằng `GREATEST(remaining − q, 0)` không guard | **P1:** đã fix → guard `remaining >= q` **trước** movement, fail thì 409, không để lại movement nửa vời. |
| Đường A `OrdersService.applyStatusChange` | CAS `UPDATE orders SET status WHERE id AND status = expected` (chống double cancel/consume), DELIVERED → `consumeOrderStock`, CANCELLED từ SHIPPING → quarantine | Đúng; đợt này chỉ sửa comment + xử lý `null` của release. |
| Đường B `ShipmentsService.updateStatus` (trước fix đợt này) | `shipment.update` unconditional + `partnerOrder.update` unconditional + `order.update` unconditional; DELIVERY_FAILED unconditional; replay cùng status vẫn ghi event | **P0 race:** hai DELIVERED đồng thời → consume hai lần (lần 2 fail 409, shipment fail oan) hoặc ghi 2 event. Đã fix: CAS shipment, partner-order lên DELIVERED đúng một lần (replay vẫn 200 + 1 event, không consume lại), order CAS `status != DELIVERED` rồi mới consume, DELIVERY_FAILED không hồi sinh partner-order DELIVERED, replay cùng status là no-op 200. |
| `PaymentsService.updateStatus` (trước fix) | Mọi chuyển đổi đều cho phép, PAID không cần reference, không audit phân biệt replay | **P1:** đã fix → state machine PENDING→PAID/FAILED, PAID→PARTIALLY/REFUNDED, REFUNDED terminal; PAID bắt buộc `transactionReference`; replay cùng status là no-op (không audit trùng). |
| FEFO `allocateFefo` | Lọc SELLABLE + chưa hết hạn + QC PASS mới nhất + `available > 0`, sort expiry asc nhưng **thiếu tie-break** | **P2:** đã fix → sort `(expiresAt, balanceId)`. |
| Seed | Trừ `remaining` khi allocate; tạo đơn DELIVERED trực tiếp không qua service; flash-sale/địa chỉ/cert như báo cáo trước | Lỗi lịch sử/seed, không sửa DEV. |

Không thêm bảng/trạng thái allocation lifecycle: `InventoryAllocation` + `reserved` + CAS order + guard DB đã đủ để chống double release/consume mà không phình schema.

---

## 4. Release Guard Audit

| Câu hỏi | Kết quả sau fix |
|---|---|
| Ai gọi? Endpoint nào? | `POST /inventory/release` ADMIN-only; cancel customer/admin qua `OrdersService` (CAS). |
| Giải phóng reservation nào? | Thủ công: theo `(warehouse, lot, variant)` — **không gắn allocation** (rủi ro vận hành, đã ghi P2). Cancel: đúng từng allocation của order. |
| Gọi lại / retry? | Service: guard DB + 409; shipment replay: no-op; payment replay: no-op; cancel double: CAS order (test `double cancel releases exactly once`). |
| Release sau consume / đơn DELIVERED? | DELIVERED là terminal (`assertTransition`), cancel DELIVERED → 400; guard `reserved >= q` chặn release phần đã consume. |
| Đồng thời release + consume / release + release? | Guard DB serialize trên row lock; loser 409 + rollback (test mới). |
| `reserved` âm / `onHand` tăng bất thường / `available` vượt thực? | Guard `reserved >= q`, `on_hand >= q`, adjust chặn `onHand < reserved + blocked`; không còn clamp bịa số. |
| Movement RELEASE chính xác? | `before/after` là reserved thực sau CAS; không còn `GREATEST` + `before = after + q` giả. |
| Rollback? | Mọi guard fail đều throw trong transaction → rollback toàn bộ, không movement nửa vời (đã đảo thứ tự lot-guard trước movement). |

---

## 5. Order #40 Forensic

- Tạo 01:17:26 bởi CUSTOMER #19 → 5 bước ADMIN #13 (01:45:26 → 01:46:45) → DELIVERED, không shipment/fulfillment/settlement, 1 allocation FEFO đúng (lot #53 SELLABLE/PASS, qty 2), movement `RESERVE Order#40` nhưng không OUTBOUND, payment COD/PAID cùng giây DELIVERED, không audit `PAYMENT_*` (cơ chế cũ update trực tiếp).
- Đối chiếu: 3 đơn DELIVERED seed cũng 0 OUTBOUND (tạo trực tiếp, paidAt = createdAt seed); các đơn CANCELLED có cặp RESERVE/RELEASE khớp; lot #53 có 29 RESERVE + 25 RELEASE khớp từng cặp — chứng tỏ release/cancel hiện tại đúng, chỉ thiếu consume cho DELIVERED cũ.
- Kết luận: **dữ liệu trước bản vá**, không dùng để kết tội code hiện tại; đã tái hiện + chứng minh code mới trên TEST DB thay vì suy đoán.

---

## 6. Delivery Paths (đã thống nhất)

- Cả hai đường đều consume qua `consumeOrderStock` duy nhất; order CAS `status != DELIVERED` đảm bảo chỉ một đường consume; đường còn lại ghi event/cập nhật shipment nhưng không consume lại (e2e `a second DELIVERED ... cannot consume twice` PASS).
- Không có đường tắt: `assertTransition` chặn nhảy cóc; DELIVERED/CANCELLED terminal; shipment replay idempotent; COD không tự PAID ở bất kỳ đường nào.
- Thời điểm xuất kho theo hệ thống: **khi DELIVERED** (quy ước đã chốt từ `13431d8`, BUSINESS-RULES §6b). Hàng SHIPPING vẫn giữ reservation; cancel từ SHIPPING → quarantine (không bán lại). Không đổi state machine trong đợt này.

---

## 7. Code Fixes

| File | Sửa |
|---|---|
| `apps/api/src/inventory/inventory.service.ts` | `releaseStock` → guarded conditional UPDATE + `null`; `release()` xử lý `null` → 409; `consumeOrderStock` guard `remaining >= q` trước movement; FEFO tie-break `balanceId`. |
| `apps/api/src/orders/orders.service.ts` | `releaseOrderReservations` nhánh release kiểm tra `null` → 409 rollback. |
| `apps/api/src/shipments/shipments.service.ts` | CAS shipment + partner-order DELIVERED một lần, order CAS trước consume, DELIVERY_FAILED không hồi sinh DELIVERED, replay idempotent. |
| `apps/api/src/payments/payments.service.ts` | State machine payment, PAID bắt buộc reference, replay no-op, REFUNDED terminal. |
| Tests | `inventory.spec` (+3), `checkout-hardening.spec` (+2), `delivery-return.spec` (+2 mới, sửa mock CAS), `mutation-acceptance.e2e` (+5: COD cần reference, PAID idempotent, REFUNDED→PAID 400, shipment double/replay không consume lại). |

---

## 8. Test Evidence (TEST DB `agrimarket_v2_test`, guard tên DB trong fixtures)

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @agrimarket/api exec tsc --noEmit -p tsconfig.json` | PASS (exit 0). |
| `pnpm --filter @agrimarket/api exec oxlint --type-aware src/ test/ prisma/` | PASS, 5 warning có sẵn (evidence import, returns skip/take, 2 array-sort-compare). |
| `pnpm --filter @agrimarket/api exec vitest run` | **376/376 PASS** (28 files). |
| `pnpm --filter @agrimarket/api exec vitest run --config ./vitest.config.e2e.ts` | **329/329 PASS** (11 files, gồm concurrency 5 rounds: oversell/quota/cancel-vs-deliver/quarantine/double-complete + mutation 111 flows). |
| DEV kiểm tra lại sau test | Vẫn 11 drift công thức cũ / 0 OUTBOUND lịch sử — **DEV không bị chạm** (đúng yêu cầu). |

Bao phủ 25 điểm GĐ4: nhập→balance, QC→bán, reserve, oversell đồng thời, cancel 1 lần/2 lần, release-vs-consume, double consume, đua DELIVERED hai đường, xuất đúng thời điểm, COD không tự PAID + thu tiền có reference, fail không hồi tồn bán, hoàn quarantine, FEFO đúng/hết hạn/QC giữ, retry idempotent, rollback, preview-vs-confirm, ledger, dữ liệu cũ không backfill, phân quyền ADMIN, invariant `available = onHand − reserved − blocked`.

---

## 9. Inventory Invariants (đã kiểm thử)

- `onHand >= 0`, `reserved >= 0`, `blocked >= 0`, `available = onHand − reserved − blocked`.
- Không reserve vượt available; không release/consume/quarantine vượt reserved; không consume vượt onHand; không adjust để `onHand < reserved + blocked`.
- Mỗi allocation chỉ consume/release một lần (CAS order/shipment + guard DB + 409 rollback).
- FEFO: SELLABLE + chưa hết hạn + QC PASS mới nhất + `available > 0`, expiry asc + balanceId tie-break.
- Ledger: INBOUND/RESERVE/RELEASE/OUTBOUND/RETURN/QUARANTINE/ADJUSTMENT đúng basis; OUTBOUND `quantityDelta = −qty`, `referenceType Order`; không movement nửa vời.
- COD: DELIVERED không PAID; PAID cần reference + audit; REFUNDED terminal.

---

## 10. DEV Data (chưa sửa — kế hoạch đối soát, DỪNG trước áp dụng)

Không UPDATE/DELETE/INSERT DEV trong nhiệm vụ. Đề xuất dry-run (script riêng, mặc định chỉ in kế hoạch, có guard `dbName === agrimarket_v2`, backup, precondition, đối soát số dòng, rollback, audit trail), cần duyệt riêng:

1. Lot #53/balance #50: `reserved 32 = 30 (order #28 PENDING) + 2 (order #40 DELIVERED cũ)`. Phương án: consume 2 đơn #40 (ghi OUTBOUND post-dated + trừ lot) **hoặc** giữ nguyên + ghi chú lịch sử (khuyến nghị giữ nguyên vì thiếu bằng chứng giao hàng vật lý).
2. Các lot còn lại: `remaining` thấp hơn `on_hand` đúng bằng allocation đang giữ — **không phải drift**; khi các đơn PENDING/CONFIRMED/SHIPPING kết thúc (consume/release qua code mới), số liệu tự hội tụ. Không chỉnh tay.
3. 3 đơn seed DELIVERED + #40 thiếu OUTBOUND: không backfill (thiếu chứng từ); ghi chú báo cáo.
4. A3–A8 (cert hết hạn, flash sale, địa chỉ, returns/complaints demo) giữ theo báo cáo audit trước; không thuộc P0 đợt này.

---

## 11. Risk Matrix

| ID | Mức | Tồn dư | Giảm thiểu |
|---|---|---|---|
| R1 | P2 | `POST /inventory/release` thủ công không gắn allocation | Quy trình: đối soát allocation trước khi bấm; cân nhắc API release theo allocation/order trong backlog (không làm trong đợt này để tránh phình scope). |
| R2 | P2 | Thời điểm xuất kho = DELIVERED (hàng transit vẫn tính tồn) | Quy ước đã chốt + quarantine khi cancel SHIPPING; đổi sang SHIPPING cần đánh giá lại toàn bộ hoàn/giao thất bại — để backlog. |
| R3 | P3 | DEV lịch sử chưa đối soát | Kế hoạch §10, chờ duyệt. |
| R4 | P3 | Sale-unit ↔ kg (1 đơn vị bán = 1 kg sổ) | Quy ước modelling đã chốt ở audit trước, không đổi. |

Không còn P0/P1 code trong phạm vi A1/A2.

---

## 12. Final Verdict

- **CODE FIXED:** release/consume/Shipment/Payment/FEFO guards đã sửa + unit/e2e chứng minh.
- **TEST PASS:** 376/376 unit + 329/329 e2e trên TEST DB độc lập; typecheck/lint sạch (ngoài warning có sẵn).
- **DEV DATA PENDING APPROVAL:** §10 dừng trước áp dụng; DEV nguyên vẹn sau nhiệm vụ.
- **BLOCKED:** không.
- **NOT TESTED:** Admin/Customer/Mobile regression UI (không sửa frontend đợt này nên không chạy; browser smoke thuộc audit trước vẫn nguyên giá trị).
