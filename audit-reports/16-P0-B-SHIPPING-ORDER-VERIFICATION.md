# 16 — P0-B SHIPPING & ORDER VERIFICATION

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Phạm vi:** C-02 (shipment/order state divergence), C-03 (shipment `RETURNED` không xử lý nghiệp vụ), C-13 (hủy đơn `SHIPPING` trong khi shipment vẫn hoạt động).  
**Ngày xác minh:** 23/10/2026  
**Bằng chứng:** `.tmp-verify/final-hardening/`  
**Kết quả trong phạm vi:** **VERIFIED FIXED** cho tính nhất quán shipment/order và **VERIFIED FUNCTIONAL** cho luồng hàng hoàn về kho. Không tuyên bố production-ready.

> Báo cáo local, test database cô lập `agrimarket_v2_test`. Không commit, push, merge, deploy; không sửa dữ liệu development/production.

---

## 1. Phạm vi và trạng thái

| Mã | Nội dung | Phân loại sau xác minh |
|---|---|---|
| C-02 | Tạo shipment cho đơn đã hủy; `DELIVERED` trên đơn hủy bị kẹt | **VERIFIED FIXED** |
| C-03 | Shipment `RETURNED` chỉ ghi trace, không xử lý tồn kho/đơn | **VERIFIED FUNCTIONAL** |
| C-13 | Hủy đơn `SHIPPING` nhưng shipment vẫn `PENDING/IN_TRANSIT` | **VERIFIED FIXED** |

**Giới hạn có chủ đích:** shipment `RETURNED` **không** tự tạo `ReturnRequest` và **không** tự hoàn tiền. Hàng về kho được chuyển sang `blocked`, mở phiếu cách ly và chờ QC; hoàn tiền là quyết định tài chính riêng. Đây là mô hình đã triển khai, không phải bằng chứng rằng mọi chính sách hoàn tiền đã được phê duyệt.

---

## 2. Phát hiện gốc từ Report 14

### C-02 — Shipment tạo cho đơn đã hủy; `DELIVERED` trên đơn hủy bị kẹt

Bằng chứng tại HEAD trước sửa:

- `apps/api/src/shipments/shipments.service.ts:32-58`: `create()` chỉ kiểm tra `partnerOrder` tồn tại, không kiểm tra `OrderStatus`/`PartnerOrderStatus`, không chặn `CANCELLED`/`DELIVERED`.
- `apps/api/src/shipments/shipments.service.ts:165-195`: khi shipment `DELIVERED`, code đổi partner order sang `DELIVERED` bất kể trạng thái trước đó, rồi đổi order sang `DELIVERED` nếu tất cả partner order đã delivered; sau đó gọi `consumeOrderStock`.
- Nếu order đã `CANCELLED` từ `SHIPPING`, reservation đã bị chuyển thành `blocked`; `consumeOrderStock` không tìm đủ reserved/on-hand và ném lỗi. Transaction rollback, shipment bị kẹt.
- `apps/api/src/shipments/dto/shipment.dto.ts:24-37`: DTO chỉ nhận enum status, không ràng buộc theo order.

### C-03 — Shipment `RETURNED` chỉ ghi trace

- `shipments.service.ts:208-224` (HEAD): nhánh `RETURNED` chỉ lấy allocation và tạo `TraceEvent` với mô tả “chờ kiểm định lại”; không cập nhật order/partner order, không chuyển `reserved` sang `blocked`, không tạo phiếu nhập, không tạo refund.
- Comment tại `:209` nói hàng hoàn phải qua quarantine nhưng code không làm.
- `DELIVERY_FAILED` chỉ đưa partner order về `SHIPPING`, không có hàng đợi xử lý.

### C-13 — Hủy đơn `SHIPPING` trong khi shipment vẫn hoạt động

- `apps/api/src/orders/orders.service.ts:1257-1265` (HEAD): `ALLOWED_TRANSITIONS.SHIPPING = [DELIVERED, CANCELLED]`.
- `apps/api/src/shipments/shipments.service.ts:13-21` (HEAD): shipment transitions không có nhánh cancel; `create/updateStatus` không kiểm tra order status.
- Customer Web/Mobile vẫn cho hủy khi `SHIPPING`; không có quy tắc module nào thắng.

---

## 3. Nguyên nhân gốc

1. **Thiếu state machine liên module.** Order và shipment có state machine riêng, không có invariant chung “không tạo/giao/hủy shipment trái trạng thái order”.
2. **Thiếu compare-and-set.** Đọc trạng thái rồi ghi vô điều kiện cho phép hai request cùng thắng, ghi đè trạng thái và chạy side effect hai lần.
3. **Side effect không nằm trong cùng transaction với trạng thái.** `RETURNED` chỉ ghi trace; cancellation của order không cập nhật shipment.
4. **Không phân biệt hàng còn trong kho và hàng đã rời kho.** Hủy đơn `SHIPPING` release thẳng reservation, trong khi hàng vật lý đang trên đường.
5. **Không có idempotency cho webhook vận chuyển.** Retry `DELIVERED`/`RETURNED` có thể tạo event và side effect lần hai.

---

## 4. Thay đổi code

### 4.1. `apps/api/src/shipments/shipments.service.ts`

- `create()`:
  - khóa `partner_orders` bằng `SELECT ... FOR UPDATE` trước khi đọc;
  - từ chối `partnerOrder.status === CANCELLED` hoặc `order.status === CANCELLED` với 409;
  - chỉ cho tạo khi **cả** order và partner order là `READY_TO_SHIP`;
  - nếu đã có shipment active cùng carrier/tracking → trả bản ghi cũ (retry idempotent); khác carrier/tracking → 409;
  - ghi `PACKING` trace cho các lot được phân bổ.
- `updateStatus()`:
  - map transition tường minh `PENDING → READY/IN_TRANSIT/CANCELLED`, `IN_TRANSIT → OUT_FOR_DELIVERY/DELIVERY_FAILED/RETURNING`, `RETURNING → RETURNED`, terminal states không quay lại;
  - replay cùng trạng thái là no-op, không ghi event/side effect;
  - `DELIVERED` chỉ khi order và partner order đang `SHIPPING` (hoặc đã `DELIVERED` để replay an toàn), từ chối order hủy;
  - `IN_TRANSIT` đồng bộ partner order/order sang `SHIPPING`, ghi trace `SHIPPING`;
  - `DELIVERED` dùng `updateMany` compare-and-set; chỉ bên thắng gọi `consumeOrderStock`, ghi trace `DELIVERED`;
  - `RETURNED` gọi `quarantineOrderReservations()` nếu order chưa hủy, sau đó đóng partner order và order;
  - mọi thay đổi ghi `ShipmentEvent` + audit.
- `syncOrderCancellation(tx, orderId)`:
  - `PENDING/READY → CANCELLED`;
  - `IN_TRANSIT/OUT_FOR_DELIVERY/DELIVERY_FAILED/RETURNING → RETURNING`;
  - `DELIVERED/RETURNED/CANCELLED` giữ nguyên;
  - mỗi shipment dùng CAS; bên thua không ghi event.

### 4.2. `apps/api/src/orders/orders.service.ts`

- `applyStatusChange()` dùng `UPDATE ... WHERE id = ? AND status = ?` (compare-and-set) thay vì đọc rồi ghi.
- `DELIVERED`: gọi `consumeOrderStock` đúng một lần; **không** tự đánh dấu COD `PAID`.
- `CANCELLED`:
  - nếu hàng đã rời kho (`previousStatus === SHIPPING` hoặc có shipment ở trạng thái đã rời kho) → `quarantineOrderReservations()`, **không** release reservation;
  - nếu hàng còn trong kho → `releaseOrderReservations()` với guarded `releaseStock`;
  - gọi `shipments.syncOrderCancellation()` trong cùng transaction.
- `cancelForCustomer()` dùng cùng state machine và side effect như admin.

### 4.3. UI và module

- `apps/admin-web/src/app/(admin)/shipments/page.tsx`: danh sách vận đơn, trạng thái, tạo/cập nhật; copy nêu rõ giao thành công **không** tự thu COD.
- `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx`: hiển thị shipment và trạng thái; nút thu COD tách khỏi giao hàng.
- `apps/api/src/shipments/shipments.module.ts`, `orders.module.ts`: đăng ký `QuarantineService`/`ShipmentsService` theo dependency hiện có.

### 4.4. Test thêm trong đợt này

- `apps/api/test/business-rules/delivery-return.spec.ts`:
  - `keeps quarantine and stock untouched when RETURNED is replayed`;
  - `syncs an order cancellation: pre-handover parcels cancel, travelling parcels return, terminal states stay`;
  - `a losing cancellation CAS writes no shipment event`.
- Các test B1 đã có trong branch (không lặp lại): tạo shipment cho order hủy, replay, DELIVERED guard, cancel sau khi hàng rời kho, quarantine RETURNED.

---

## 5. Migration

Migration: `apps/api/prisma/migrations/20261023000000_p0b_integrity_quarantine_refunds/migration.sql`

- `shipments.status` và `shipment_events.status` thêm `CANCELLED`;
- không xóa/không viết lại row lịch sử;
- bảng `quarantine_cases` phục vụ `RETURNED` được tạo trong cùng migration.

Đã áp dụng trên test DB: 12 migration, `Database schema is up to date!` (`.tmp-verify/final-hardening/verify-migration-status.log`). Không chạy migration trên production.

---

## 6. Bằng chứng trước/sau

### 6.1. Trước sửa (tĩnh tại HEAD)

```text
create():
  only checks partnerOrder exists
  no OrderStatus/PartnerOrderStatus guard
  no active-shipment duplicate check

updateStatus(DELIVERED):
  partnerOrder.status = DELIVERED
  order.status = DELIVERED if all delivered
  consumeOrderStock(...)   // fails after cancel -> whole tx rolls back

updateStatus(RETURNED):
  TraceEvent(RETURNED, "chờ kiểm định lại")
  // no order update, no quarantine, no warehouse receipt

order cancel:
  release reservations
  // shipment untouched
```

### 6.2. Sau sửa (code hiện tại)

```text
create():
  SELECT id FROM partner_orders ... FOR UPDATE
  reject CANCELLED order/partner order           -> 409
  require BOTH READY_TO_SHIP                     -> 400
  same carrier/tracking active shipment          -> replay
  different carrier/tracking                     -> 409

updateStatus(DELIVERED):
  reject CANCELLED order/partner order           -> 409
  require SHIPPING (or already DELIVERED replay)
  updateMany WHERE id AND status = previous      -> one winner
  consumeOrderStock once
  TraceEvent(DELIVERED)

updateStatus(RETURNED):
  if order not already cancelled:
    quarantineOrderReservations() -> blocked + cases
  close partner order/order
  replay is a pure read

syncOrderCancellation():
  PENDING/READY -> CANCELLED
  left-warehouse -> RETURNING
  terminal -> unchanged
```

---

## 7. Kiểm thử

### 7.1. Lệnh và kết quả

| Bộ | Lệnh | Kết quả | Log |
|---|---|---|---:|
| API unit toàn bộ | `npm run test --workspace @agrimarket/api` | **39 files / 531 tests PASS** | `verify-api-unit.log` |
| API E2E toàn bộ | `npm run test:e2e --workspace @agrimarket/api` | **18 files / 439 tests PASS** | `verify-api-e2e.log` |
| Unit targeted (B1+B3) | `npx vitest run test/business-rules/delivery-return.spec.ts test/business-rules/refund.spec.ts` | **2 files / 35 tests PASS** | `targeted-new-unit.log` |
| Warehouse targeted | `npx vitest run --config ./vitest.config.e2e.ts test/warehouse-admin.e2e-spec.ts` | **1 file / 11 tests PASS** | `targeted-new-warehouse-e2e.log` |
| Money/concurrency targeted | `npx vitest run --config ./vitest.config.e2e.ts test/concurrency-money.e2e-spec.ts` | **1 file / 20 tests PASS** | `targeted-new-concurrency-money.log` |

### 7.2. Test B1 trọng yếu

Unit (`delivery-return.spec.ts`, 18 test):

- tạo shipment chỉ khi cả hai `READY_TO_SHIP`;
- từ chối shipment cho order hủy;
- replay cùng carrier/tracking trả shipment cũ;
- khác carrier/tracking → 409;
- `IN_TRANSIT` đồng bộ order/partner order;
- `DELIVERED` consume đúng một lần, replay idempotent;
- từ chối `DELIVERED` khi chưa `SHIPPING` hoặc order đã hủy;
- từ chối hủy sau khi hàng rời kho;
- `RETURNED` mở quarantine, không bán lại;
- không quarantine hai lần khi order đã hủy;
- replay `RETURNED` không tạo event/stock/case;
- sync cancellation theo 9 trạng thái shipment;
- CAS thua không ghi event.

E2E:

- `cancel-wins SHIPPING race (deterministic)`: cancel thắng, delivery muộn bị từ chối;
- `deliver-wins SHIPPING race (deterministic)`: delivery thắng, cancel muộn bị từ chối;
- `cancelling a SHIPPING order quarantines stock instead of re-selling it`;
- `advances the order to DELIVERED without pretending COD was collected`;
- `a second DELIVERED through the shipment path cannot consume twice`;
- `a retried shipment DELIVERED is idempotent`.

### 7.3. Log thô

```text
Test Files  39 passed (39)
     Tests  531 passed (531)

Test Files  18 passed (18)
     Tests  439 passed (439)
```

---

## 8. Kết quả DB

Audit read-only `.tmp-verify/final-hardening/verify-db-invariant-audit.log`:

```json
{
  "shipment_order_mismatch": 0,
  "negative_balances": 0,
  "refunded_without_quarantine": 0,
  "warehouse_return_without_quarantine": 0,
  "quarantine_blocked_mismatch": 0
}
```

Ý nghĩa:

- không còn shipment ở trạng thái mâu thuẫn với order trong test DB;
- không có balance âm;
- return đã refund đều có quarantine case;
- phiếu RETURN không thiếu case cách ly;
- `blocked` khớp với case còn mở.

Đây là invariant trên **test DB sau khi chạy suite**, không phải kiểm tra production. Không có truy vấn ghi nào vào development/production.

---

## 9. UI

- `admin-shipments.png` (SHA-256 `9BA3A9A8...`): danh sách 6 vận đơn, trạng thái “Đã kết thúc”, copy “Giao thành công không tự động thu COD — xác nhận thu tiền tại mục Thanh toán.”
- `admin-order-2392.png` (SHA-256 `7ABCCBB4...`): order `ORD-20261003-0002`, shipment `SHP-20261003-0002-01`, payment VNPAY `Đã thanh toán`, nút “Hoàn tiền”.
- Ảnh chỉ là bằng chứng giao diện; logic được xác minh bằng unit/E2E, không suy ra từ ảnh.

---

## 10. Trường hợp chưa xác minh

1. **Không có tích hợp courier thật.** Không kiểm thử webhook/callback từ GHN/GHTK/Viettel Post; chỉ kiểm thử API nội bộ.
2. **Không có E2E trình duyệt cho tạo/cập nhật shipment.** Ảnh chỉ chụp danh sách; chưa có Playwright flow tạo shipment → IN_TRANSIT → DELIVERED.
3. **Không kiểm thử tải/đa instance.** CAS đúng ở mức DB, nhưng chưa có load test nhiều API instance.
4. **Không kiểm thử webhook retry kéo dài** hoặc thứ tự event không đều (out-of-order delivery).
5. **Không có refund tự động** khi shipment `RETURNED`; payment online vẫn `PAID` cho tới khi admin tạo refund.
6. **Không xác minh dữ liệu production/lịch sử** — chỉ test DB.
7. **Không xác minh policy** khách có được hủy khi `SHIPPING` hay không; code cho phép và xử lý hậu quả, nhưng đây là quyết định kinh doanh.

---

## 11. Rủi ro nghiệp vụ còn mở

1. **Hủy khi đang giao:** hàng bị đưa vào `blocked` và order `CANCELLED`; nếu courier vẫn giao thành công, cần quy trình thu hồi/hoàn tiền. Chưa có đối soát tự động với courier.
2. **Không tự hoàn tiền:** khách trả online có thể đã trả tiền nhưng đơn bị hủy/hoàn; admin phải tạo refund thủ công. Cần SLA và policy.
3. **Một order nhiều partner:** shipment của partner A `RETURNED` chỉ đóng partner A; order còn `SHIPPING` nếu partner B chưa giao. Đã có logic đếm, nhưng chưa có E2E nhiều partner cho nhánh RETURNED.
4. **Không có chứng từ đối soát courier** (biên bản giao/hoàn); trace chỉ ghi trạng thái nội bộ.

---

## 12. Điều kiện nghiệm thu

- [x] Không tạo shipment cho order/partner order `CANCELLED`.
- [x] Chỉ tạo shipment khi cả hai `READY_TO_SHIP`.
- [x] Retry cùng carrier/tracking không mở kiện thứ hai; khác carrier/tracking bị 409.
- [x] `DELIVERED` bị từ chối cho order hủy/chưa `SHIPPING`.
- [x] `DELIVERED` consume reservation đúng một lần; replay không consume lần hai.
- [x] `RETURNED` chuyển hàng sang `blocked` + quarantine, không bán lại; replay là no-op.
- [x] Hủy order đồng bộ shipment: trước bàn giao → `CANCELLED`, đã rời kho → `RETURNING`; terminal không đổi.
- [x] CAS thua không ghi event/side effect.
- [x] Unit 18 test B1, E2E 6 test B1, full suite 531/439 PASS.
- [x] Migration áp dụng trên test DB; audit invariant bằng 0.
- [x] Không commit/push/deploy; không sửa dữ liệu ngoài test DB.
- [ ] Tích hợp courier thật, load test, production data — **NOT VERIFIED**.
- [ ] Refund tự động khi hoàn hàng — **BUSINESS DECISION REQUIRED**.

---

## 13. Kết luận

C-02 và C-13 đạt **VERIFIED FIXED**; C-03 đạt **VERIFIED FUNCTIONAL** ở phạm vi tồn kho/order/quarantine. Bằng chứng gồm code hiện tại, 18 unit test B1, 6 E2E B1, full suite 531 unit + 439 E2E, migration đã áp dụng trên test DB và audit invariant bằng 0.

**Không** tuyên bố production-ready: chưa có tích hợp courier thật, load test, hay chính sách hoàn tiền tự động khi hàng hoàn.
