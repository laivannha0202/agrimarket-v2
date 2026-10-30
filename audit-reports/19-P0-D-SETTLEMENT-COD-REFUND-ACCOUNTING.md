# 19 — P0-D SETTLEMENT, COD & REFUND ACCOUNTING

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Phạm vi:** C-08 (settlement không trừ refund, không yêu cầu COD đã thu), C-12 (copy COD sai ở client/Swagger), đối soát refund sau settlement.  
**Ngày xác minh:** 23/10/2026  
**Bằng chứng:** `.tmp-verify/final-hardening/`  
**Kết quả trong phạm vi:** **PARTIALLY COMPLETE**; refund liability sau settlement là **BUSINESS DECISION REQUIRED**. Không tuyên bố production-ready.

---

## 1. Phạm vi và trạng thái

| Mã | Nội dung | Phân loại sau xác minh |
|---|---|---|
| C-08 | Settlement bỏ qua refund; settle COD chưa thu | **PARTIALLY COMPLETE** + **BUSINESS DECISION REQUIRED** |
| C-12 | Copy COD sai ở Customer Web/Mobile/Swagger | **PARTIALLY COMPLETE** |
| — | Chặn confirm/payout/mark-paid khi có adjustment `OPEN` | **VERIFIED FUNCTIONAL** |
| — | Refund sau settlement tạo adjustment thay vì sửa lịch sử | **VERIFIED FUNCTIONAL** |

**Kết luận ngắn:** settlement hiện chỉ lấy đơn `DELIVERED` có payment `PAID/PARTIALLY_REFUNDED/REFUNDED` với `paidAt`, trừ refund `COMPLETED`, và chặn chi tiền khi còn adjustment `OPEN`. Tuy nhiên **cách thu hồi khoản refund sau settlement chưa được quyết định và chưa được thực thi tự động**; chưa có UI review adjustment; commission chưa được hoàn lại; kỳ settlement đang tính theo `createdAt` của partner order.

---

## 2. Phát hiện gốc từ Report 14

### C-08 — Settlement không trừ refund, không yêu cầu COD đã thu

- `apps/api/src/finance/settlements.service.ts:86-93` (HEAD): chỉ lấy `partnerOrder.status = DELIVERED`, trong kỳ, chưa có settlement line; **không** kiểm tra payment `PAID`.
- `:95-114` (HEAD): `let refundTotal = 0;` và mỗi line gán `refundAmount: 0`; payable = gross − 0 − commission + adjustment.
- `:31` định nghĩa công thức đúng có refund nhưng dữ liệu refund chưa bao giờ được nạp.
- `:133` lưu `refundAmount: round2(refundTotal)` = 0.
- Hệ quả: đối tác được settle trên doanh thu gộp dù khách đã refund; COD `DELIVERED` nhưng payment `PENDING` vẫn được settle — trả tiền đối tác trước khi thu tiền khách.

### C-12 — Copy COD sai

- `apps/api/src/orders/orders.controller.ts:112` (HEAD): summary “DELIVERED settles COD”.
- `apps/api/src/orders/orders.service.ts:1125-1128` (HEAD): code **deliberately NOT** mark COD `PAID`; chỉ `PATCH /payments/:id/status` mới set `paidAt`.
- Customer Web `OrderDetail.tsx:371-375` (HEAD): “Trạng thái sẽ chuyển sang đã thanh toán sau khi giao thành công”.
- Customer Web `CheckoutSuccess.tsx:126-128` (HEAD): cùng nội dung.
- Mobile `order/[id].tsx` có copy tương tự.
- Hệ quả: khách tin giao xong là tự động `PAID`; thực tế payment vẫn `PENDING` tới khi Admin thu.

---

## 3. Nguyên nhân gốc

1. **Công thức settlement có refund nhưng query không nạp refund.** Comment mô tả đúng, implementation bỏ trống.
2. **Settlement coi “delivered” là “collected”.** COD chưa thu vẫn được trả tiền đối tác.
3. **Không có mô hình hậu kiểm refund sau settlement.** Sửa trực tiếp settlement đã chốt sẽ phá audit; cần adjustment riêng.
4. **Không có chặn chi tiền khi còn bất đồng.** Adjustment `OPEN` không được kiểm tra ở confirm/payout/mark-paid.
5. **Copy COD được viết theo giả định sai** và không được kiểm thử như một contract hiển thị.

---

## 4. Thay đổi code

### 4.1. Settlement

`apps/api/src/finance/settlements.service.ts`:

- `create()` chỉ lấy partner order:
  - `status = DELIVERED`;
  - `createdAt` trong kỳ;
  - chưa bị settlement nào claim (`settlementLines: { none: {} }`);
  - order có payment `PAID/PARTIALLY_REFUNDED/REFUNDED` **và** `paidAt != null`.
- Nạp refund `COMPLETED` của các order:
  - refund gắn return → trừ trực tiếp vào partner order của return;
  - refund không gắn return → phân bổ theo gross của các partner order, remainder chính xác ở dòng cuối;
  - `PENDING/APPROVED` không trừ vì chưa phải tiền đã chuyển.
- Công thức:
  ```text
  payable = gross - refundTotal - commissionTotal + adjustmentAmount
  ```
- unique index `settlement_lines.partner_order_id` chống claim trùng; lỗi P2002 map thành 409.
- `confirm()`:
  - chỉ `DRAFT`;
  - đếm `settlement_adjustments` `OPEN`; nếu > 0 → 409, không confirm.
- `reviewAdjustment()`:
  - chỉ `OPEN`, bắt buộc note;
  - ghi `resolution` (`DEDUCT_NEXT`/`WRITE_OFF`/`MANUAL`), reviewer, thời gian;
  - **chỉ đóng trạng thái**, không tự trừ kỳ sau/không ghi bút toán tiền.

### 4.2. Payout

`PayoutsService`:

- chỉ tạo payout khi settlement `CONFIRMED` hoặc `PAID`;
- khóa settlement `FOR UPDATE`, đọc lại payable sau khóa;
- chặn nếu còn adjustment `OPEN`;
- tổng payout `PENDING + PAID` không vượt payable;
- `markPaid()` chặn nếu còn adjustment `OPEN`;
- CAS/audit; nếu tổng payout `PAID >= payable` thì settlement → `PAID`.

### 4.3. Refund sau settlement

`PaymentsService.recordSettlementAdjustments()`:

- khi refund `COMPLETED`:
  - tìm settlement line của partner order;
  - nếu đã có line, tạo `settlement_adjustments`:
    - `type = REFUND_AFTER_SETTLEMENT`;
    - `status = OPEN`;
    - `amount` = phần refund quy cho partner order;
    - unique `(refund_id, partner_order_id)` chống trùng;
  - **không** sửa `settlements`/`settlement_lines` lịch sử.

### 4.4. COD

`PaymentsService.updateStatus()`:

- `DELIVERED` không set `PAID` (orders service giữ nguyên);
- xác nhận `PAID` bắt buộc `transactionReference`;
- COD chỉ xác nhận khi order `DELIVERED`;
- không xác nhận payment cho order `CANCELLED`;
- CAS chống hai người cùng thu.

UI:

- Admin shipments/orders copy: giao thành công không tự thu COD.
- Customer Web `CheckoutSuccess`, `OrderDetail`: nói rõ trạng thái chỉ đổi sau khi cửa hàng xác nhận đã thu tiền.
- Mobile order detail: copy tương ứng.

### 4.5. Test

- `apps/api/test/business-rules/settlement.spec.ts` (9 test):
  - công thức gross − refund − commission + adjustment;
  - phân bổ refund theo gross, remainder chính xác;
  - refund gắn return trừ đúng partner order;
  - query chỉ lấy DELIVERED + đã thu + chưa claim;
  - period không hợp lệ;
  - retry code collision;
  - P2002 partner_order_id → 409;
  - confirm bị chặn khi OPEN;
  - mark-paid bị chặn khi OPEN.
- `apps/api/test/concurrency-money.e2e-spec.ts` (20 test), trong đó test mới:
  - `OPEN reconciliation guards`: tạo fixture DB thật với adjustment `OPEN`; chứng minh confirm, payout create, mark-paid đều bị chặn; review xong mới cho phép.
- `apps/api/test/mutation-acceptance.e2e-spec.ts`:
  - DELIVERED không tự đánh dấu COD PAID;
  - từ chối xác nhận COD không có transaction reference;
  - chỉ sau khi xác nhận mới `PAID`;
  - settlement/payout lifecycle.
- `apps/api/test/business-rules/refund.spec.ts`:
  - refund sau settlement tạo một adjustment `OPEN`.

---

## 5. Migration

`20261023000000_p0b_integrity_quarantine_refunds`:

- tạo `settlement_adjustments`:
  - `partner_id`, `settlement_id`, `partner_order_id`, `refund_id`;
  - `amount`, `type = REFUND_AFTER_SETTLEMENT`;
  - `status OPEN/REVIEWED`;
  - `resolution DEDUCT_NEXT/WRITE_OFF/MANUAL`;
  - `reason`, `resolution_note`, reviewer/timestamps;
  - unique `(refund_id, partner_order_id)`, index status/settlement/partner.
- không sửa settlement/payout lịch sử.

---

## 6. Trước/sau

### 6.1. Trước

```text
settlement.create:
  partnerOrders = DELIVERED, in period, unclaimed
  // no payment PAID check
  refundTotal = 0
  payable = gross - 0 - commission + adjustment

payment COD:
  order DELIVERED -> payment still PENDING
  admin UI/copy says "auto paid after delivery"

refund after settlement:
  no adjustment; settlement unchanged; partner already paid gross
```

### 6.2. Sau

```text
settlement.create:
  require payment PAID/PARTIALLY_REFUNDED/REFUNDED with paidAt
  refundTotal = completed refunds attributed to partner order
  payable = gross - refundTotal - commission + adjustment

COD:
  delivery -> payment PENDING
  PATCH /payments/:id/status PAID requires reference + delivered order

refund after settlement:
  settlement line exists -> one OPEN adjustment
  confirm/payout/markPaid blocked until review
  historical settlement rows unchanged
```

---

## 7. Kiểm thử và log thô

| Bộ | Lệnh | Kết quả | Log |
|---|---|---|---:|
| API unit toàn bộ | `npm run test --workspace @agrimarket/api` | **39 files / 531 tests PASS** | `verify-api-unit.log` |
| API E2E toàn bộ | `npm run test:e2e --workspace @agrimarket/api` | **18 files / 439 tests PASS** | `verify-api-e2e.log` |
| Money/concurrency targeted | `npx vitest run --config ./vitest.config.e2e.ts test/concurrency-money.e2e-spec.ts` | **1 file / 20 tests PASS** | `targeted-new-concurrency-money.log` |

```text
Test Files  1 passed (1)
     Tests  20 passed (20)

Test Files  18 passed (18)
     Tests  439 passed (439)
```

### 7.1. Fixture `OPEN` thật trong DB

Test `OPEN reconciliation guards` tạo:

1. settlement `DRAFT` payable 100.000;
2. adjustment `OPEN` 30.000 → `confirm()` ném lỗi `/OPEN reconciliation adjustment/`; settlement vẫn `DRAFT`;
3. review `DEDUCT_NEXT` + note → confirm thành công;
4. payout 40.000 `PENDING`;
5. adjustment `OPEN` thứ hai 20.000 → tạo payout mới bị chặn; `markPaid` payout cũ bị chặn; payout vẫn `PENDING`;
6. review `MANUAL` + note → `markPaid` thành công.

Đây là bằng chứng DB thật, không mock, cho cả ba cửa: confirm, payout create, mark-paid.

### 7.2. Điểm chưa có E2E

- Chưa có E2E tạo settlement thật rồi refund `COMPLETED` và đọc `refundAmount` trên line. Việc trừ refund mới được unit test với Prisma mock.
- Chưa có E2E chứng minh đơn COD `DELIVERED` nhưng `PENDING` **không** vào settlement. Query đúng được unit test assert; E2E chỉ chứng minh DELIVERED không tự PAID.

---

## 8. Kết quả DB

Audit read-only:

```json
{
  "open_adjustments": 0,
  "payout_over_settlement": 0,
  "refund_over_payment": 0,
  "negative_balances": 0
}
```

Ý nghĩa:

- không còn adjustment `OPEN` sau khi suite dọn fixture;
- không có payout vượt payable;
- không có refund vượt paid;
- không có balance âm.

Các số 0 này chứng minh invariant sau test, **không** chứng minh chưa từng có lỗi trong production.

---

## 9. UI và hợp đồng hiển thị

- `admin-shipments.png`: copy “Giao thành công không tự động thu COD — xác nhận thu tiền tại mục Thanh toán.”
- `admin-order-2392.png`: payment VNPAY `Đã thanh toán`; nút thu/hoàn tiền tách biệt.
- Customer Web/Mobile copy đã sửa: trạng thái chỉ đổi sau khi cửa hàng xác nhận đã thu tiền.
- **C-12 vẫn mở một phần:** `apps/api/src/orders/orders.controller.ts:112` vẫn ghi `'Advance order status (ADMIN) - DELIVERED settles COD'`; `apps/api/src/orders/orders.service.ts:1057` vẫn có comment “DELIVERED settles COD payments”. Đây là Swagger/comment sai so với behavior, dù client copy đã đúng.
- **Không có UI** cho `GET /settlement-adjustments` hoặc `POST /settlement-adjustments/:id/review`; admin phải gọi API/Swagger. Vì adjustment `OPEN` chặn confirm/payout, thiếu UI làm kẹt vận hành.

---

## 10. Trường hợp chưa xác minh

1. **E2E settlement trừ refund thật** — chỉ unit mock.
2. **E2E COD chưa thu bị loại khỏi settlement** — chỉ unit query assertion.
3. **UI review adjustment** — không có.
4. **`DEDUCT_NEXT` có thực sự trừ kỳ sau không** — không; hiện chỉ ghi nhận quyết định.
5. **Hoàn tiền sau khi payout đã `PAID`** — adjustment `OPEN` được tạo nhưng tiền đã ra; chưa có clawback/ledger.
6. **Hoàn commission cho đối tác khi refund** — chưa có; settlement vẫn trừ commission gốc.
7. **Kỳ settlement theo `createdAt`** — chưa xác nhận có đúng policy (thường theo ngày giao/ngày thu).
8. **Thuế, phí vận chuyển, chiết khấu** trong refund/settlement — chưa có policy.
9. **Đối soát ngân hàng/courier thật** — `transactionReference` nhập tay.
10. **Production data** — chưa kiểm tra.

---

## 11. Quyết định kinh doanh bắt buộc

> Đây là các quyết định **chưa được phê duyệt**. Không được tự chọn thay chủ sản phẩm/kế toán.

### 11.1. Refund liability sau settlement — `BUSINESS DECISION REQUIRED`

Khi refund `COMPLETED` sau khi partner order đã vào settlement:

- Ai chịu khoản refund: đối tác, nền tảng, hay chia theo tỷ lệ?
- Thu hồi bằng cách nào:
  - `DEDUCT_NEXT`: trừ vào kỳ settlement kế tiếp;
  - `WRITE_OFF`: nền tảng chịu lỗ;
  - `MANUAL`: thu tiền mặt/chuyển khoản ngoài hệ thống;
- Nếu payout đã `PAID`, có clawback không? Thời hạn bao lâu?
- Có tính lãi/phạt/ngưỡng tối thiểu không?
- Ai phê duyệt? Kế toán hay ops?
- Adjustment có cần hiển thị trên sao kê đối tác không?

Hiện hệ thống **chặn chi tiền** khi adjustment `OPEN`, nhưng **chưa thực thi** bất kỳ phương án thu hồi nào.

### 11.2. Commission khi refund

Settlement hiện trừ gross refund nhưng **không hoàn commission**. Cần quyết định:

- commission có bị hoàn theo tỷ lệ refund không;
- nếu có, hoàn ở kỳ nào, có adjustment riêng không;
- nếu không, đối tác chịu commission trên doanh thu đã hoàn — có chấp nhận không.

### 11.3. Kỳ settlement

Query dùng `partnerOrder.createdAt` trong kỳ. Cần chốt:

- settlement theo ngày đặt hàng, ngày giao, hay ngày thu tiền?
- đơn tạo kỳ trước nhưng giao kỳ sau thuộc kỳ nào?
- đơn COD thu tiền muộn thuộc kỳ nào?

### 11.4. COD

- Ai được xác nhận thu COD? Admin hiện tại.
- Bắt buộc bằng chứng gì (biên nhận, ảnh, mã giao dịch)?
- Đối soát với đơn vị vận chuyển theo ngày/tuần?
- Có cho xác nhận một phần không?

### 11.5. Adjustment UI và kế toán

- Có cần màn hình riêng cho adjustment `OPEN`/`REVIEWED`?
- Có cần export cho kế toán?
- Có cần audit log bất biến/dual approval?

---

## 12. Điều kiện nghiệm thu

- [x] Settlement chỉ lấy đơn `DELIVERED` có payment đã thu (`paidAt`).
- [x] Refund `COMPLETED` được trừ vào settlement line đúng partner order.
- [x] Refund không gắn return được phân bổ theo gross, remainder chính xác.
- [x] Không claim một partner order vào hai settlement.
- [x] Refund sau settlement tạo adjustment `OPEN`, không sửa lịch sử.
- [x] Adjustment `OPEN` chặn confirm, payout create, mark-paid (fixture DB thật).
- [x] COD không tự `PAID` khi giao; xác nhận cần reference + order delivered.
- [x] Client copy COD đã sửa.
- [x] Full suite 531 unit + 439 E2E PASS; DB invariant 0.
- [ ] Swagger/comment C-12 vẫn sai — **VERIFIED BUG — OPEN**.
- [ ] UI review adjustment — **NOT VERIFIED / thiếu**.
- [ ] E2E settlement trừ refund, E2E COD chưa thu bị loại — **NOT VERIFIED**.
- [ ] Chính sách refund-after-settlement, commission, kỳ settlement — **BUSINESS DECISION REQUIRED**.

---

## 13. Kết luận

C-08 đạt **PARTIALLY COMPLETE**: phần “không trừ refund” và “settle COD chưa thu” đã được xử lý ở code + unit test; adjustment `OPEN` chặn chi tiền đã được chứng minh bằng DB thật. Nhưng **cách thu hồi refund sau settlement chưa được quyết định**, chưa có UI, và `DEDUCT_NEXT` chưa được thực thi.

C-12 đạt **PARTIALLY COMPLETE**: copy Customer Web/Mobile đã đúng; Swagger summary và comment service vẫn nói sai.

Đây là **BUSINESS DECISION REQUIRED** trước khi có thể coi luồng settlement/refund là production-ready.
