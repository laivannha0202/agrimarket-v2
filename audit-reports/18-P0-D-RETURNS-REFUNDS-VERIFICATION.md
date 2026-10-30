# 18 — P0-D RETURNS & REFUNDS VERIFICATION

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Phạm vi:** C-05 (return không có state machine/ownership, nhận `refundId` tùy ý), C-06 (không có UI refund; refund ghi `COMPLETED` ngay), C-15 (return/complaint transition chỉ bảo vệ ở UI), IDOR return của khách khác.  
**Ngày xác minh:** 23/10/2026  
**Bằng chứng:** `.tmp-verify/final-hardening/`  
**Kết quả trong phạm vi:** **PARTIALLY COMPLETE**. State machine/ownership/refund lifecycle đã có; còn ba khoảng trống được ghi rõ bên dưới. Không tuyên bố production-ready.

---

## 1. Phạm vi và trạng thái

| Mã | Nội dung | Phân loại sau xác minh |
|---|---|---|
| C-05 | Return không có state machine; nhận `refundId` tùy ý; không kiểm tra refund | **PARTIALLY COMPLETE** |
| C-06 | Không có UI tạo refund; refund được ghi `COMPLETED` ngay | **PARTIALLY COMPLETE** |
| C-15 | Return/complaint transition chỉ được bảo vệ ở UI | **PARTIALLY COMPLETE** |
| — | IDOR `GET /returns/me/:id` của khách khác | **VERIFIED FIXED** |

**Ba khoảng trống còn lại:**

1. Refund **không** bị giới hạn theo giá trị hàng hoàn (`quantity × unitPriceSnapshot`); chỉ bị cap bởi số tiền đã thanh toán. Có thể hoàn nhiều hơn giá trị hàng thực trả.
2. Admin vẫn phải **nhập tay `refundId`** khi chuyển return sang `REFUNDED`; chưa có dropdown/prefill refund hợp lệ trong dialog return.
3. **Complaint API vẫn nhận mọi trạng thái**, không có state machine; chỉ return được sửa. C-15 vì vậy chỉ hoàn thành một nửa.

---

## 2. Phát hiện gốc từ Report 14

### C-05 — Return không có state machine, nhận `refundId` tùy ý

- `apps/api/src/returns/dto/return.dto.ts:42-52` (HEAD): `UpdateReturnRequestDto` chỉ `@IsEnum(ReturnRequestStatus)` và `refundId?: number`.
- `apps/api/src/returns/returns.service.ts:295-312` (HEAD): `updateStatus()`:
  - không kiểm tra transition hợp lệ;
  - không kiểm tra return thuộc order/payment nào;
  - không kiểm tra refund tồn tại;
  - không kiểm tra refund thuộc đúng payment;
  - không kiểm tra status refund;
  - không kiểm tra số tiền refund khớp quantity/price.
- `returnRequest.refundId` là FK tùy chọn, có thể trỏ sang refund của đơn khác.
- Comment nói hàng hoàn phải quarantine/QC nhưng `updateStatus` không có side effect kho.

### C-06 — Không có UI tạo refund; refund `COMPLETED` ngay

- `apps/admin-web/src/lib/api/resources.ts:192-194` (HEAD): chỉ có `payments`, `updatePaymentStatus`; không có `refunds`/`createRefund`.
- `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx:185-193` (HEAD): yêu cầu nhập **ID hoàn tiền bằng tay** khi chuyển return sang `REFUNDED`.
- `apps/api/src/payments/payments.service.ts:264-271` (HEAD): refund tạo với `status: COMPLETED`, `completedAt` ngay; không có bước PENDING/APPROVED, không có mã giao dịch.
- `POST /payments` tạo payment `PENDING` cho mọi method, không có callback gateway.

### C-15 — State chỉ ở UI

- Return: `RETURN_TRANSITIONS` ở Admin page, API nhận mọi status.
- Complaint: `COMPLAINT_TRANSITIONS` ở Admin page, `complaints.service.ts:153-165` (HEAD) nhận mọi `ComplaintStatus`.

---

## 3. Nguyên nhân gốc

1. **State machine nằm ở client.** UI chỉ render select; API không tái kiểm tra transition.
2. **Thiếu ownership trong query.** Detail return ban đầu có thể đọc theo id mà không ràng `customerId`.
3. **Thiếu ràng buộc giữa return và refund.** `refundId` là FK rời, không kiểm tra order/payment/status/số tiền.
4. **Refund được mô hình hóa như một lần ghi nhận tức thời**, không phải quy trình quyết định → chuyển tiền → chứng từ.
5. **Không có giao dịch kho khi nhận hàng hoàn.** Return chỉ đổi status, không nhập kho/cách ly.

---

## 4. Thay đổi code

### 4.1. Return state machine và ownership

`apps/api/src/returns/returns.service.ts`:

```text
REQUESTED -> APPROVED | REJECTED
APPROVED  -> RETURNING | REJECTED
RETURNING -> RECEIVED
RECEIVED  -> QC_PENDING
QC_PENDING-> REFUNDED | REJECTED
REFUNDED  -> []
REJECTED  -> []
```

- `updateStatus()` khóa row `return_requests ... FOR UPDATE` trước khi đọc;
- replay cùng status là no-op, không nhận hàng/audit lần hai;
- transition sai → 400;
- `RECEIVED` gọi `receiveReturnedGoods()`:
  - cộng `on_hand` + `blocked`, cộng lại lot remaining;
  - movement `RETURN`;
  - tạo quarantine case nguồn `RETURN`, `stockAddedToBalance = true`;
  - trace `RETURNED`;
  - chống nhận trùng bằng offset các return đã RECEIVED/QC_PENDING/REFUNDED.
- `REFUNDED` yêu cầu:
  - có `refundId` (từ DTO hoặc đã link trước);
  - refund tồn tại, `COMPLETED`;
  - refund thuộc **cùng order**;
  - return đã có quarantine case;
  - **tất cả** case đã `RELEASED` hoặc `SCRAPPED`;
  - return chưa link refund khác.

`returns.controller.ts`:

- `GET /returns/me` và `GET /returns/me/:id` chỉ dùng `customerId` trong WHERE;
- return của khách khác trả 404, không lộ tồn tại.

`returns.service.ts` `create()`:

- khóa `order_items` `FOR UPDATE`;
- tính `returnable = purchased - active claims`;
- từ chối vượt số còn lại;
- chỉ cho return order `DELIVERED` của chính khách.

### 4.2. Refund lifecycle

`apps/api/src/payments/payments.service.ts`:

```text
PENDING -> APPROVED -> COMPLETED
PENDING/APPROVED -> FAILED
COMPLETED -> terminal
```

- `POST /refunds` tạo `PENDING`, bắt buộc `Idempotency-Key`;
- cap tổng refund `PENDING + APPROVED + COMPLETED` theo số đã thanh toán;
- nếu link return: return phải `QC_PENDING`, cùng order, chưa có refund;
- `approve` chỉ PENDING, ghi `approvedAt`;
- `complete` chỉ APPROVED, bắt buộc `reference`, cập nhật payment `PARTIALLY_REFUNDED`/`REFUNDED`, ghi adjustment nếu đã settlement;
- `fail` chỉ PENDING/APPROVED, giải phóng link return, giữ row lịch sử;
- mọi bước CAS + audit.

Controller: `POST /refunds`, `/approve`, `/complete`, `/fail`, `GET /refunds`, `GET /refunds/:id` — ADMIN.

### 4.3. UI

- `apps/admin-web/src/app/(admin)/refunds/page.tsx`: danh sách refund, tạo, approve, complete (nhập reference), fail.
- `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx`: nút “Hoàn tiền”, prefill payment ID.
- `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx`: transition return theo state machine; hiển thị refund đã link.
- `apps/admin-web/src/lib/api/resources.ts`: thêm `refunds`, `createRefund`, `approveRefund`, `completeRefund`, `failRefund`.
- Customer Web/Mobile: hiển thị trạng thái return/refund và bằng chứng; không thay đổi quyền.

### 4.4. Test thêm trong đợt này

- `apps/api/test/business-rules/refund.spec.ts`:
  - `rejects a return link that belongs to a different order` (mới trong đợt này).
- Các test đã có trong branch:
  - refund PENDING không đổi tiền/payment;
  - cap theo paid amount;
  - link return đúng một lần;
  - approve/complete/fail đúng trạng thái;
  - adjustment sau settlement;
  - return state machine, receipt, quarantine;
  - IDOR `GET /returns/me/:id` (E2E có sẵn, không thêm trùng).

---

## 5. Migration

`apps/api/prisma/migrations/20261023000000_p0b_integrity_quarantine_refunds/migration.sql`:

- `refunds.status` thêm `PENDING/APPROVED/COMPLETED/FAILED` (mặc định `PENDING`), thêm `reference`, `failure_reason`, `approved_at`, index status;
- `return_requests` thêm `received_at`, index status;
- unique index `return_requests_refund_id_key` — một refund chỉ gắn tối đa một return;
- bảng `quarantine_cases` và enum movement liên quan.

Không viết lại refund/return lịch sử; migration additive ở mức row.

---

## 6. Trước/sau

### 6.1. Trước

```text
PATCH /returns/:id { status: "REFUNDED", refundId: 999 }
  -> accepted if enum valid
  -> no transition check
  -> no ownership/order check
  -> no refund existence/status/amount check
  -> no quarantine requirement

POST /refunds
  -> status COMPLETED immediately
  -> no reference/proof
  -> no PENDING/APPROVED step
```

### 6.2. Sau

```text
PATCH /returns/:id
  -> row lock
  -> transition map
  -> RECEIVED: stock + blocked + lot + case + trace
  -> REFUNDED: same order + refund COMPLETED + all cases resolved
  -> audit

POST /refunds
  -> PENDING (idempotency key)
  -> approve -> APPROVED
  -> complete(reference) -> COMPLETED + payment update
  -> fail -> FAILED + release return link
```

---

## 7. Kiểm thử và log thô

| Bộ | Lệnh | Kết quả | Log |
|---|---|---|---:|
| API unit toàn bộ | `npm run test --workspace @agrimarket/api` | **39 files / 531 tests PASS** | `verify-api-unit.log` |
| API E2E toàn bộ | `npm run test:e2e --workspace @agrimarket/api` | **18 files / 439 tests PASS** | `verify-api-e2e.log` |
| Refund + delivery unit targeted | `npx vitest run test/business-rules/delivery-return.spec.ts test/business-rules/refund.spec.ts` | **2 files / 35 tests PASS** | `targeted-new-unit.log` |

```text
Test Files  2 passed (2)
     Tests  35 passed (35)

Test Files  18 passed (18)
     Tests  439 passed (439)
```

### 7.1. E2E return/refund trọng yếu

Trong `mutation-acceptance.e2e-spec.ts`:

- `refuses to skip the return state machine straight to REFUNDED` → 400;
- `receives the return, clears quarantine QC and refunds the payment`:
  - APPROVED → RETURNING → RECEIVED → QC_PENDING;
  - RECEIVED mở đúng 1 quarantine case;
  - refund tạo `PENDING`, approve → `COMPLETED`;
  - return `REFUNDED` bị chặn khi quarantine chưa resolve;
  - sau PASS + RELEASE, return mới `REFUNDED`;
- `refuses a refund larger than the paid amount`;
- `refuses a zero refund`;
- `hides other customers' returns and complaints behind a 404`;
- `lists my own returns and re-reads one after logging in again`.

Trong `concurrency-money.e2e-spec.ts`:

- hai refund 70% đồng thời: chỉ một thắng, tổng ≤ paid;
- refund 50% + 50% tuần tự: cả hai hợp lệ, payment `REFUNDED`;
- hai return full quantity đồng thời: chỉ một được nhận.

Trong `idempotency*.e2e-spec.ts`:

- cùng key + payload replay đúng refund cũ, kể cả sau khi payment `REFUNDED`;
- cùng key + payload khác → 409;
- 30 request cùng key tạo đúng một refund.

---

## 8. Kết quả DB

Audit read-only:

```json
{
  "bad_refunded_returns": 0,
  "refunded_without_quarantine": 0,
  "duplicate_refund_links": 0,
  "refund_over_payment": 0,
  "quarantine_blocked_mismatch": 0
}
```

Ý nghĩa:

- không có return `REFUNDED` thiếu refund hợp lệ;
- không có return đã refund mà thiếu quarantine;
- không có hai return cùng trỏ một refund;
- tổng refund không vượt payment;
- `blocked` khớp case.

Đây là invariant trên test DB sau suite, không phải production.

---

## 9. UI

- `admin-refund-prefill.png` (SHA-256 `87CB1A51...`): dialog “Tạo yêu cầu hoàn tiền”, payment ID `1061`, ô số tiền, lý do, ID yêu cầu trả hàng (tùy chọn).
- Ảnh chứng minh có UI tạo refund; **không** chứng minh luồng approve/complete/fail.
- Dialog return vẫn hiển thị ô “Mã hoàn tiền” dạng nhập tay khi chọn `REFUNDED`; chưa có ảnh dropdown/prefill.

---

## 10. Trường hợp chưa xác minh

1. **Refund amount theo giá trị hàng hoàn:** chưa có kiểm tra `amount <= quantity × unitPriceSnapshot`; chưa có test.
2. **Manual refund ID:** chưa có E2E UI chọn refund từ danh sách; chưa chứng minh operator không nhập nhầm ID (API chặn khác order nhưng không chặn cùng order khác return).
3. **Complaint state machine:** API vẫn nhận mọi status; chưa sửa.
4. **Gateway hoàn tiền thật:** không có VNPAY/ngân hàng callback; `reference` là chuỗi nhập tay.
5. **Hoàn một phần nhiều lần:** có test 50% + 50%, nhưng chưa test nhiều return item/partial quantity phức tạp.
6. **Restocking fee, shipping fee, tax:** chưa có policy/tính toán.
7. **Return sau khi order đã settlement:** adjustment được tạo, nhưng chưa có UI review (xem Report 19).
8. **Production data** và dữ liệu legacy: chưa kiểm tra.

---

## 11. Rủi ro nghiệp vụ còn mở

1. **Over-refund tương đối:** khách trả 1.000.000 cho 10 sản phẩm, return 1 sản phẩm nhưng admin có thể tạo refund tới 1.000.000 (miễn là chưa vượt paid). Cần policy và validation theo giá trị hàng hoàn.
2. **Refund same order nhưng khác return:** API chỉ kiểm tra refund cùng order, không kiểm tra refund gắn đúng order item/return. Operator có thể link return A với refund của return B trong cùng order.
3. **Manual ID:** dễ nhập nhầm; cần dropdown refund `COMPLETED` chưa link, cùng order.
4. **Complaint không có state machine:** API có thể nhảy trạng thái, làm sai audit/báo cáo.
5. **Không có bằng chứng chuyển tiền:** `reference` text tự do; cần upload chứng từ/đối soát ngân hàng.
6. **Refund sau settlement** kích hoạt adjustment OPEN nhưng chưa có UI xử lý; xem Report 19.

---

## 12. Điều kiện nghiệm thu

- [x] Return có state machine tường minh, terminal states không quay lại.
- [x] Return quantity không vượt số còn lại; create được serialize.
- [x] `GET /returns/me/:id` của khách khác trả 404.
- [x] `RECEIVED` nhập kho + blocked + quarantine + trace, không bán lại.
- [x] `REFUNDED` yêu cầu refund `COMPLETED`, cùng order, quarantine đã resolve.
- [x] Refund có PENDING → APPROVED → COMPLETED/FAILED, reference bắt buộc.
- [x] Refund cap theo paid amount, idempotency key, CAS, audit.
- [x] Có UI tạo/approve/complete/fail refund.
- [x] Full suite 531 unit + 439 E2E PASS.
- [ ] Refund amount khớp giá trị hàng hoàn — **NOT VERIFIED / cần sửa**.
- [ ] UI chọn refund thay vì nhập tay — **NOT VERIFIED**.
- [ ] Complaint state machine — **VERIFIED BUG — OPEN**.
- [ ] Gateway hoàn tiền thật — **NOT VERIFIED**.

---

## 13. Kết luận

C-05, C-06 và C-15 đạt **PARTIALLY COMPLETE**:

- phần lớn rủi ro “API nhận refundId tùy ý”, “refund COMPLETED ngay”, “return không có state machine” đã được xử lý;
- IDOR return của khách khác đạt **VERIFIED FIXED**;
- nhưng chưa đủ để gọi C-05/C-06/C-15 là đóng hoàn toàn, vì còn over-refund theo giá trị hàng, nhập tay refund ID và complaint API không có state machine.

Không tuyên bố production-ready cho luồng return/refund.
