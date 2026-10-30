# 17 — P0-C QUARANTINE & QC VERIFICATION

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Phạm vi:** C-04 (`blocked` chỉ tăng, không release), C-07 (phiếu kho `RETURN` cộng thẳng vào hàng bán được), vòng đời quarantine/QC.  
**Ngày xác minh:** 23/10/2026  
**Bằng chứng:** `.tmp-verify/final-hardening/`  
**Kết quả trong phạm vi:** **VERIFIED FIXED** cho C-04 và C-07; luồng quarantine/QC đạt **VERIFIED FUNCTIONAL**. Không tuyên bố production-ready.

---

## 1. Phạm vi và trạng thái

| Mã | Nội dung | Phân loại sau xác minh |
|---|---|---|
| C-04 | `blocked` chỉ tăng, không bao giờ được giải phóng | **VERIFIED FIXED** |
| C-07 | Phiếu kho `RETURN` cộng thẳng vào `on_hand` bán được, bỏ qua QC | **VERIFIED FIXED** |
| C-03 (phần kho) | Hàng hoàn về kho phải vào `blocked` + quarantine | **VERIFIED FUNCTIONAL** |
| C-14 (phần trace) | Thiếu event đóng gói/xuất kho/QC/hoàn hàng | **PARTIALLY COMPLETE** — đã thêm event, chưa có công cụ authoring đầy đủ |

---

## 2. Phát hiện gốc từ Report 14

### C-04 — `blocked` chỉ tăng

- `apps/api/src/inventory/inventory.service.ts:462-483` (HEAD): `quarantineStock()` thực hiện `reserved = reserved - qty`, `blocked = blocked + qty`.
- Không có `UPDATE` nào giảm `blocked`; không có method `releaseBlocked`/`unblock`/`passQc`.
- `orders.service.ts:1132-1143`, `:1175-1179` (HEAD): hủy đơn từ `SHIPPING` chuyển reservation sang `blocked`, chờ “return/re-inspection flow” nhưng flow không tồn tại.
- Hệ quả: hàng khóa vĩnh viễn, `available` giảm dù hàng đã về kho.

### C-07 — Phiếu `RETURN` vào thẳng hàng bán được

- `apps/api/src/inventory/warehouse-documents.service.ts:403-426` (HEAD): `INBOUND` và `RETURN` đều gọi `changeOnHand(+qty)`; `RETURN` chỉ khác movement type.
- Không có bước `blocked`/QC trước khi cộng `on_hand`; không kiểm tra lot đang bị quarantine.
- Admin UI cho chọn `RETURN` tại `warehouse-documents/page.tsx:171-172`; mapping loại phiếu tại `lib/status/index.ts:222-226`.
- Hệ quả: hàng hoàn có thể bán ngay, bỏ qua kiểm định; nếu `blocked` cũ còn, `on_hand` tăng thêm và `blocked` không giảm.

---

## 3. Nguyên nhân gốc

1. **Thiếu vòng đời sau `blocked`.** Chỉ có đường vào, không có đường ra; không có trạng thái QC và quyết định release/scrap.
2. **Đồng nhất sai `RETURN` với `INBOUND`.** Cả hai được coi là hàng mới có thể bán, trong khi hàng hoàn phải qua QC.
3. **Thiếu case cách ly có nguồn gốc.** Không có bảng liên kết order/return/warehouse document với số lượng, lot, kho, người tạo, người xử lý.
4. **Thiếu guarded update.** Nếu chỉ đọc rồi trừ `blocked`, hai request đồng thời có thể release cùng số lượng; cần `WHERE blocked >= qty`.
5. **Thiếu trace/audit cho QC.** Không có event QC, release, scrap; không thể chứng minh hàng đã kiểm định trước khi bán lại.

---

## 4. Thay đổi code

### 4.1. Schema và migration

Migration `20261023000000_p0b_integrity_quarantine_refunds`:

- thêm enum movement `QUARANTINE`, `QUARANTINE_RELEASE`, `SCRAP`;
- tạo bảng `quarantine_cases` với:
  - `code` duy nhất (`QTN-YYYYMMDD-NNNN`);
  - `warehouse_id`, `product_lot_id`, `product_variant_id`, `quantity`;
  - `status` `PENDING/PASSED/FAILED/RELEASED/SCRAPPED`;
  - `source_type` (`ORDER_CANCEL`, `SHIPMENT_RETURN`, `RETURN`, `WAREHOUSE_RETURN`);
  - `order_id`, `return_request_id`, `stock_added_to_balance`;
  - `inspected_at`, `resolved_at`, `created_by_user_id`, `resolved_by_user_id`;
  - index theo status/order/return/lot.

Không viết lại row lịch sử; bảng mới bắt đầu rỗng.

### 4.2. `QuarantineService`

- `quarantineOrderReservations()`:
  - đọc allocation, khóa warehouse theo thứ tự tăng dần;
  - `quarantineStock()` guarded `reserved >= qty`;
  - ghi movement `QUARANTINE`, tạo case `PENDING` và trace `RETURNED`.
- `inspect()`:
  - chỉ `PENDING` được inspect;
  - `PASS → PASSED`, `FAIL → FAILED`;
  - `FAIL` bắt buộc có note;
  - **không** di chuyển stock ở bước này;
  - ghi trace `QC` + audit.
- `resolve()`:
  - `RELEASE` chỉ từ `PASSED`, gọi `releaseBlocked()` guarded `blocked >= qty`, ghi `QUARANTINE_RELEASE`, trace `WAREHOUSE_IN`;
  - `SCRAP` chỉ từ `FAILED`, gọi `scrapBlocked()` guarded cả `blocked` và `on_hand`, giảm `remaining_quantity` của lot, ghi `SCRAP`, trace `WAREHOUSE_OUT`;
  - case status CAS, audit, không xóa lịch sử.
- Không tự động release/scrap; luôn cần quyết định của người vận hành.

### 4.3. `InventoryService`

- `releaseBlocked(tx, balanceId, quantity)`:
  ```sql
  UPDATE inventory_balances
     SET blocked = blocked - :qty
   WHERE id = :id AND blocked >= :qty
  ```
- `scrapBlocked(tx, balanceId, quantity)`:
  ```sql
  UPDATE inventory_balances
     SET blocked = blocked - :qty,
         on_hand = on_hand - :qty
   WHERE id = :id
     AND blocked >= :qty
     AND on_hand >= :qty
  ```
- `receiveReturnedStock()` cộng **cả** `on_hand` và `blocked`, không cộng riêng `on_hand`.
- `quarantineStock()` vẫn là đường duy nhất biến reservation thành blocked.

### 4.4. Phiếu kho `RETURN`

`warehouse-documents.service.ts`:

- `complete()` CAS `DRAFT → COMPLETED` trước khi di chuyển stock;
- với `RETURN`, mỗi dòng gọi `receiveReturnedDocumentLine()`:
  - `on_hand + qty`, `blocked + qty`;
  - cộng lại `product_lots.remaining_quantity`;
  - movement `RETURN`;
  - tạo `quarantine_cases` nguồn `WAREHOUSE_RETURN`, `stockAddedToBalance = true`;
  - trace `RETURNED` (“chờ kiểm định”), **không** trace `WAREHOUSE_IN` bán được;
- `INBOUND`/`OUTBOUND` giữ nguyên semantics; `ADJUSTMENT` vẫn đi qua endpoint riêng.

### 4.5. UI

- `apps/admin-web/src/app/(admin)/quarantine/page.tsx`: danh sách case, trạng thái, nút kiểm định, release/scrap theo trạng thái.
- `apps/admin-web/src/app/(admin)/warehouse-documents/page.tsx`: tạo phiếu `RETURN`; sau khi complete, hàng vào cách ly.
- `apps/admin-web/src/app/(admin)/inventory/page.tsx`: hiển thị `on_hand/reserved/blocked`.

### 4.6. Test

- `apps/api/test/business-rules/quarantine.spec.ts` (8 test):
  - tạo case trong transaction;
  - PASS không đổi stock;
  - FAIL bắt buộc note;
  - không inspect lại case đã resolve;
  - RELEASE giảm blocked + movement;
  - RELEASE trước PASS bị từ chối;
  - SCRAP giảm blocked/on_hand/lot + movement;
  - SCRAP rollback khi lot không đủ số lượng.
- `apps/api/test/business-rules/warehouse-return.spec.ts` (2 test):
  - cộng `on_hand` và `blocked` cùng lúc, mở case, không gọi inbound bán được;
  - rollback toàn bộ khi không tạo được case.
- `apps/api/test/warehouse-admin.e2e-spec.ts`:
  - `receives into blocked, opens a WAREHOUSE_RETURN case, and releases only after PASS`;
  - `two concurrent RETURN completes apply the receipt and open one case exactly once`.

---

## 5. Trước/sau

### 5.1. Trước

```text
quarantineStock: reserved -= qty; blocked += qty
// không có releaseBlocked/scrapBlocked
// blocked chỉ tăng

warehouse RETURN complete:
  on_hand += qty
  movement RETURN
  // không blocked, không case, không QC
```

### 5.2. Sau

```text
blocked lifecycle:
  PENDING --inspect PASS--> PASSED --resolve RELEASE--> RELEASED
  PENDING --inspect FAIL--> FAILED --resolve SCRAP----> SCRAPPED
  release: blocked -= qty (guarded)
  scrap:   blocked -= qty; on_hand -= qty; lot.remaining -= qty

warehouse RETURN complete:
  on_hand += qty AND blocked += qty
  lot.remaining += qty
  quarantine_cases(WAREHOUSE_RETURN, PENDING)
  trace RETURNED "chờ kiểm định"
  // chỉ release sau PASS + RELEASE
```

---

## 6. Kiểm thử và log thô

| Bộ | Lệnh | Kết quả | Log |
|---|---|---|---:|
| Quarantine unit | `npx vitest run test/business-rules/quarantine.spec.ts` | **8 tests PASS** | `unit-quarantine-1.log` |
| Warehouse RETURN unit | nằm trong full unit | **531 tests PASS** | `verify-api-unit.log` |
| Warehouse E2E targeted | `npx vitest run --config ./vitest.config.e2e.ts test/warehouse-admin.e2e-spec.ts` | **11 tests PASS** | `targeted-new-warehouse-e2e.log` |
| API E2E toàn bộ | `npm run test:e2e --workspace @agrimarket/api` | **18 files / 439 tests PASS** | `verify-api-e2e.log` |

```text
Test Files  1 passed (1)
     Tests  8 passed (8)

Test Files  1 passed (1)
     Tests  11 passed (11)

Test Files  18 passed (18)
     Tests  439 passed (439)
```

---

## 7. Bằng chứng DB thực tế

Từ `.tmp-verify/final-hardening/warehouse-return-ui-db.log` (test DB):

```text
quarantine_cases:
id  code                    status    source_type       source_id  stock_added  qty   inspected_at           resolved_at
110 QTN-20261023-0110      RELEASED  WAREHOUSE_RETURN  2137       1            1.000 2026-10-23 14:40:19    2026-10-23 14:40:34

inventory_balances:
id  on_hand  reserved  blocked
966 701.000  0.000     0.000

product_lots:
id  remaining_quantity
978 701.000

inventory_movements:
type    quantity_delta  before   after   reference_type      reference_id
RETURN  1.000           700.000  701.000 WarehouseDocument 2137

trace_events:
WAREHOUSE_IN  Hàng hoàn đạt kiểm định, nhập lại kho bán (QTN-20261023-0110)
QC            Kiểm định hàng hoàn đạt (QTN-20261023-0110) — chờ nhập lại kho
RETURNED      Đã nhận hàng hoàn theo phiếu WHD-20261023-0191 — chờ kiểm định

audit_logs:
QUARANTINE_CREATE
WAREHOUSE_DOCUMENT_COMPLETE
QUARANTINE_INSPECT_PASS
QUARANTINE_RELEASE
```

Điểm quan trọng:

- `on_hand` tăng 1, `blocked` tăng 1 tại thời điểm nhận;
- sau QC PASS + RELEASE, `blocked` về 0 và hàng trở lại bán được;
- movement `RETURN` 700 → 701 khớp lot remaining 701;
- trace có `RETURNED` trước, `QC` sau, `WAREHOUSE_IN` chỉ sau khi release.

Audit invariant:

```json
{
  "negative_balances": 0,
  "warehouse_return_without_quarantine": 0,
  "quarantine_blocked_mismatch": 0,
  "refunded_without_quarantine": 0
}
```

---

## 8. UI và bằng chứng ảnh

### 8.1. Ảnh hợp lệ

| Ảnh | SHA-256 | Nội dung |
|---|---|---|
| `admin-quarantine-warehouse-return.png` | `7BA326D1C4C945ECD93569208E5184AE5EC5194C798D42B568E43B3D1DB5CB18` | Case `QTN-20261023-0110`, trạng thái chờ kiểm định, nút “Kiểm định” |
| `admin-quarantine-warehouse-return-released.png` | `9AA6F8E5FB9B54B9E4EF32E78F66661FC60BCC47A56F6111DFA2E825DAF6EE0D` | Cùng case, trạng thái “Đã kết thúc” |

Hai ảnh có hash khác nhau, là hai trạng thái thật của cùng case; không phải ảnh trùng.

### 8.2. Ảnh không hợp lệ — loại khỏi bằng chứng

| Ảnh | SHA-256 | Vấn đề |
|---|---|---|
| `admin-inventory-return-blocked.png` | `C4275DF5F8E368D0C948CB9D170B4C6D0482FA7B4F07836BBE0EB0ECF82EE6FB` | Trùng byte với ảnh dưới |
| `admin-inventory-return-released.png` | `C4275DF5F8E368D0C948CB9D170B4C6D0482FA7B4F07836BBE0EB0ECF82EE6FB` | Trùng byte; không chứng minh hai trạng thái |

Hai ảnh inventory có cùng SHA-256 nên **không** được dùng làm bằng chứng “trước/sau”. Báo cáo chỉ dùng cặp ảnh quarantine.

---

## 9. Trường hợp chưa xác minh

1. **Chưa có E2E cho QC FAIL → SCRAP.** Scrap được kiểm thử unit, chưa có HTTP/DB E2E.
2. **Chưa có ảnh UI cho SCRAP.** Chỉ có ảnh PASS/RELEASE.
3. **Chưa kiểm thử cân/đếm thực tế**, tem/lô, nhiều kho, nhiều đơn vị tính.
4. **Chưa có kiểm soát “hàng đã về kho” trước khi release** đối với case tạo từ `ORDER_CANCEL`: case được mở ngay khi hủy đơn đang giao, trước khi shipment `RETURNED`. Operator có thể PASS/RELEASE trước khi hàng vật lý về.
5. **Chưa có phân quyền thủ kho riêng.** Chỉ `ADMIN`; chưa tách người kiểm định và người release (segregation of duties).
6. **Chưa có chứng từ tiêu hủy/thải bỏ** ngoài movement và audit.
7. **Chưa kiểm thử production data** hoặc dữ liệu legacy có `blocked` treo từ trước migration.

---

## 10. Rủi ro nghiệp vụ còn mở

1. **Release sớm:** với case `ORDER_CANCEL`, hàng có thể được release trước khi courier trả về. Cần gate theo shipment `RETURNED` hoặc quy trình thủ kho xác nhận.
2. **Scrap là quyết định tài chính:** giảm `on_hand` và `remaining_quantity`; cần ngưỡng phê duyệt, biên bản, người chứng kiến.
3. **Kiểm định chất lượng không có tiêu chí:** PASS/FAIL phụ thuộc operator, không có checklist/nhiệt độ/hình ảnh.
4. **Hàng tồn legacy:** nếu có `blocked` từ trước, cần audit và tạo case/đối soát trước khi release.
5. **Không có cảnh báo case tồn đọng:** case `PENDING` có thể nằm vô thời hạn, làm đóng băng tồn kho.

---

## 11. Điều kiện nghiệm thu

- [x] `blocked` chỉ giảm qua `releaseBlocked`/`scrapBlocked` có guard.
- [x] RELEASE chỉ từ `PASSED`; SCRAP chỉ từ `FAILED`.
- [x] PASS/FAIL không tự di chuyển stock.
- [x] Phiếu kho `RETURN` cộng `on_hand` + `blocked`, mở case, không cộng thẳng hàng bán được.
- [x] Double-complete phiếu RETURN chỉ áp dụng một lần, một case.
- [x] Có trace `RETURNED`, `QC`, `WAREHOUSE_IN`/`WAREHOUSE_OUT` và audit.
- [x] Unit 8 quarantine + 2 warehouse return; E2E 11 warehouse; full 531/439 PASS.
- [x] DB thực tế chứng minh `on_hand` và `blocked` tăng cùng lúc, release đưa `blocked` về 0.
- [x] Ảnh quarantine hợp lệ; ảnh inventory trùng hash bị loại.
- [ ] E2E SCRAP, gate “hàng đã về kho”, segregation of duties — **NOT VERIFIED**.
- [ ] Chính sách tiêu hủy/phê duyệt — **BUSINESS DECISION REQUIRED**.

---

## 12. Kết luận

C-04 và C-07 đạt **VERIFIED FIXED**. Vòng đời quarantine/QC là **VERIFIED FUNCTIONAL** trong phạm vi local/test DB: hàng hoàn không thể bán lại trước QC, `blocked` có đường ra, mọi thao tác có trace và audit.

Còn hai khoảng trống vận hành phải xử lý trước production: gate xác nhận hàng vật lý đã về kho trước khi release case `ORDER_CANCEL`, và quy trình tiêu hủy có phê duyệt.
