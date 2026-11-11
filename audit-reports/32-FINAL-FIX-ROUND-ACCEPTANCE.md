# Báo cáo 31 — Nghiệm thu vòng sửa lỗi cuối cùng

**Ngày:** 04/11/2026
**Phạm vi:** local `main`, commit mã nguồn `0a6939f`, không push/merge/deploy.
**Trạng thái:** **GO vòng sửa lỗi local** — **CONDITIONAL GO staging** — **NO-GO production**.

> Báo cáo này ghi lại kết quả thực tế của vòng sửa lỗi cuối: rà soát diff, UAT
> trình duyệt thật trên schema test cô lập, toàn bộ gate hồi quy bắt buộc, và kiểm tra
> read-only dữ liệu lịch sử. Các hạng mục chưa chạy (staging, chữ ký kế toán, thiết bị
> thật, cổng thanh toán online) được ghi rõ **NOT TESTED** / **BLOCKED**, không suy diễn
> thành PASS.

> **Định nghĩa GO local:** mã nguồn đã được review, commit an toàn, gate local PASS,
> UAT trình duyệt trên DB test PASS. GO local **không** phải GO staging và càng không
> phải GO production.

---

## 0. Tóm tắt điều hành

| Câu hỏi | Trả lời |
|---|---|
| Vòng sửa lỗi đã được commit? | **Có.** `0a6939f2c149d1f2f5751c7a5f2d070865f7c768`, 40 file, +1.815 / −390. |
| Có migration/schema mới? | **Không.** 0 file migration; không đổi schema. |
| UAT trình duyệt thật có chạy? | **Có.** 4 kịch bản cuối, chạy trên 2 viewport Admin; full suite **30/30 PASS**. |
| UAT có dùng DB test cô lập? | **Có.** `agrimarket_v2_test`; đã kiểm tra `DATABASE_URL` ≠ `TEST_DATABASE_URL`. |
| Gate hồi quy bắt buộc? | **PASS toàn bộ:** typecheck, lint, 978 unit/component, build, 495 API E2E. |
| Có lỗi P0/P1 mới? | **Không.** Còn 1 quyết định P2 (F-30-1), các P3 đã liệt kê, và dữ liệu lịch sử cần xử lý. |
| Dữ liệu lịch sử có bị sửa? | **Không.** 3 đơn và 13 lô hết hạn được kiểm tra read-only, giữ nguyên. |
| Có thể bàn giao staging? | **Có điều kiện.** Đúng commit, đúng kế hoạch 43 kịch bản, có ACC và xử lý dữ liệu lịch sử. |
| Có thể go-live production? | **Không.** Chưa có UAT staging, chữ ký kế toán, thiết bị thật, gateway thật. |
| Đã push/CI/deploy? | **Chưa.** Không thao tác remote, không chạy GitHub CI, không deploy. |

---

## 1. Bản ghi Git và phạm vi commit

### 1.1. Commit mã nguồn

| Mục | Giá trị |
|---|---|
| Nhánh | `main` |
| HEAD | `0a6939f2c149d1f2f5751c7a5f2d070865f7c768` |
| Parent | `2c942eaf0eb17b788f566ec1a2309889fdce5cb8` |
| Tác giả | `laivannha0202 <nguoikhongten02022005@gmail.com>` |
| Thời gian | `2026-11-04 13:13:09 +0700` |
| Thông điệp | `fix(orders): finalize delivery, payments and inventory UAT` |
| `origin/main` | `11b5ce8cde9b27b9cc81eeb6aed4451387e97a7a` |
| Ahead / behind | **11 ahead / 0 behind** |
| Diff | **40 file, +1.815 dòng, −390 dòng** |
| File mới | 3: `delivery-evidence.ts`, `shipment-statuses.ts`, `final-uat.spec.ts` |
| Migration | **0 file** — không có migration mới |
| Push / CI / deploy | **NOT RUN** |

### 1.2. Trạng thái working tree

Sau commit mã nguồn, working tree chỉ còn **2 file do người dùng sở hữu**, chưa tracked:

```text
?? apps/api/.tmp-readonly-audit.mjs
?? apps/api/.tmp-readonly-lot.mjs
```

Hai file này là công cụ truy vấn read-only phục vụ kiểm tra dữ liệu lịch sử; vòng này
**không sửa, không xoá, không commit** chúng.

Báo cáo này được commit riêng trong một commit tài liệu `docs(31)` sau khi hoàn tất.
Commit tài liệu không làm thay đổi SHA mã nguồn `0a6939f` và không thêm file mã nguồn nào.

### 1.3. Danh sách đầy đủ 40 file của commit

| # | Khu vực | File | Trạng thái |
|---:|---|---|---|
| 1 | Admin | `apps/admin-web/src/app/(admin)/lots/[id]/page.tsx` | M |
| 2 | Admin | `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx` | M |
| 3 | Admin | `apps/admin-web/src/app/(admin)/reconciliation/page.tsx` | M |
| 4 | Admin | `apps/admin-web/src/app/(admin)/shipments/page.tsx` | M |
| 5 | Admin | `apps/admin-web/src/components/orders/detail-tabs/OrderFinanceTab.tsx` | M |
| 6 | Admin | `apps/admin-web/src/components/orders/detail-tabs/OrderPaymentTab.tsx` | M |
| 7 | Admin | `apps/admin-web/src/components/orders/detail-tabs/OrderShippingTab.tsx` | M |
| 8 | Admin | `apps/admin-web/src/lib/api/resources.ts` | M |
| 9 | Admin | `apps/admin-web/src/lib/query/keys.ts` | M |
| 10 | Admin | `apps/admin-web/src/types/api.ts` | M |
| 11 | Admin test | `apps/admin-web/test/reconciliation.spec.tsx` | M |
| 12 | API | `apps/api/src/finance/payment-reconciliation.service.ts` | M |
| 13 | API | `apps/api/src/inventory/inventory.service.ts` | M |
| 14 | API | `apps/api/src/inventory/warehouse-documents.service.ts` | M |
| 15 | API | `apps/api/src/orders/delivery-evidence.ts` | **A** |
| 16 | API | `apps/api/src/orders/orders.service.ts` | M |
| 17 | API | `apps/api/src/payments/payments.service.ts` | M |
| 18 | API | `apps/api/src/reviews/reviews.service.ts` | M |
| 19 | API | `apps/api/src/shipments/shipment-statuses.ts` | **A** |
| 20 | API | `apps/api/src/shipments/shipments.controller.ts` | M |
| 21 | API | `apps/api/src/shipments/shipments.service.ts` | M |
| 22 | API test | `apps/api/test/business-rules/checkout-hardening.spec.ts` | M |
| 23 | API test | `apps/api/test/business-rules/delivery-return.spec.ts` | M |
| 24 | API test | `apps/api/test/business-rules/evidence-aftersales.spec.ts` | M |
| 25 | API test | `apps/api/test/business-rules/payment-reconciliation.spec.ts` | M |
| 26 | API test | `apps/api/test/business-rules/warehouse-document-draft.spec.ts` | M |
| 27 | API test | `apps/api/test/concurrency.e2e-spec.ts` | M |
| 28 | API test | `apps/api/test/finance-reconciliation.e2e-spec.ts` | M |
| 29 | API test | `apps/api/test/helpers/concurrency-fixtures.ts` | M |
| 30 | API test | `apps/api/test/helpers/prisma-mock.ts` | M |
| 31 | API test | `apps/api/test/mutation-acceptance.e2e-spec.ts` | M |
| 32 | API test | `apps/api/test/warehouse-admin.e2e-spec.ts` | M |
| 33 | Customer | `apps/customer-web/src/components/order/ReviewListView.tsx` | M |
| 34 | Customer | `apps/customer-web/src/lib/api/types.ts` | M |
| 35 | Mobile | `apps/mobile/app/my-reviews-new.tsx` | M |
| 36 | Mobile | `apps/mobile/src/lib/types.ts` | M |
| 37 | E2E | `e2e/admin/final-uat.spec.ts` | **A** |
| 38 | E2E | `e2e/admin/order-detail.spec.ts` | M |
| 39 | E2E | `e2e/customer/order-flow.spec.ts` | M |
| 40 | E2E | `e2e/support/api.ts` | M |

**Không có** `.env`, secret, dump DB, log nhạy cảm, ảnh/video Playwright, `node_modules`
hay file ngoài phạm vi trong commit. Không dùng `git add .` / `git add -A`; 40 file được
chọn tường minh.

### 1.4. An toàn lịch sử Git

- Không `git reset --hard`, không `git clean -fd`, không force-push, không rebase.
- Không amend commit mã nguồn cũ; commit mới nằm tuyến tính trên `2c942ea`.
- Không push GitHub, không chạy GitHub CI, không deploy.
- Không chạy seed/migration trên DEV/Production; seed chỉ chạy trên schema test.

---

## 2. Kết quả rà soát mã nguồn

Đã rà soát toàn bộ diff 40 file, tập trung vào các đường ghi dữ liệu có rủi ro tiền,
tồn kho và trạng thái đơn. Không phát hiện lỗi P0/P1 mới.

### 2.1. Giao hàng và trạng thái đơn

**Vấn đề trước đây:** đơn có thể được đánh dấu `DELIVERED` bằng tay dù chưa có vận đơn
giao thành công; đơn `DELIVERED` có thể còn vận đơn `IN_TRANSIT`; đơn đối tác bị ghi đè
trạng thái terminal.

**Thay đổi:**

- Thêm `apps/api/src/orders/delivery-evidence.ts` làm **một nơi duy nhất** quyết định
  bằng chứng giao hàng:
  - mọi đơn đối tác phải có ít nhất một shipment `DELIVERED` với `deliveredAt` thật;
  - không còn shipment active (`PENDING`, `READY`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`,
    `DELIVERY_FAILED`, `RETURNING`) trên bất kỳ đơn đối tác nào;
  - đơn đối tác `CANCELLED` bị từ chối.
- `OrdersService.applyStatusChange` đọc bằng chứng **trong cùng transaction** với
  compare-and-set, nên không thể lọt `DELIVERED` từ một snapshot cũ.
- Rollup từ shipment chỉ chuyển đơn `SHIPPING → DELIVERED`; không hồi sinh đơn
  `CANCELLED`, không trừ kho lần hai cho đơn đã `DELIVERED`.
- Menu Admin bỏ các lựa chọn `Bắt đầu giao` và `Đã giao`; giao hàng chỉ còn đi qua
  vận đơn. API trực tiếp vẫn giữ edge `READY_TO_SHIP → SHIPPING` (ghi nhận ở P3).
- Đơn đối tác terminal (`DELIVERED`, `CANCELLED`) không bị ghi đè bởi các trạng thái
  trung gian.

**Test:** `delivery-return.spec.ts`, `evidence-aftersales.spec.ts`,
`checkout-hardening.spec.ts`, `concurrency.e2e-spec.ts`, `mutation-acceptance.e2e-spec.ts`,
`final-uat.spec.ts` (UAT-02/04).

### 2.2. Vận đơn và truy vấn đơn đủ điều kiện

- Thêm endpoint Admin `GET /shipments/eligible-partner-orders`: chỉ trả đơn đối tác
  `READY_TO_SHIP`, đơn tổng `READY_TO_SHIP`, và chưa có shipment active.
- Picker trên Admin dùng đúng endpoint này, không còn bắt người vận hành nhập ID tay.
- Tách `ACTIVE_SHIPMENT_STATUSES` / `SHIPMENT_LEFT_WAREHOUSE_STATUSES` sang
  `shipment-statuses.ts` để order và shipment dùng chung một định nghĩa.
- Khi một shipment `DELIVERED`, chỉ rollup đơn đối tác nếu không còn shipment active
  khác; chỉ rollup đơn tổng khi toàn bộ bằng chứng đã đủ.

**Test:** `final-uat.spec.ts` (UAT-02/04), `shipments` API tests, `order-detail.spec.ts`.

### 2.3. Thanh toán và hoàn tiền

- `PaymentsService.updateStatus` gộp **status write + audit row trong một transaction**.
  Trước đây payment commit trước, audit ghi sau; nếu audit lỗi, sổ có tiền mà không có
  dấu vết ai thu.
- Compare-and-set được áp dụng cho **mọi transition**, không chỉ `PAID`; hai người thao
  tác đồng thời chỉ một người thắng, người còn lại nhận 409 và phải tải lại.
- Vẫn giữ các guard:
  - không cho đặt tay `PARTIALLY_REFUNDED` / `REFUNDED`;
  - `PAID` bắt buộc `transactionReference`;
  - COD chỉ được xác nhận sau khi đơn `DELIVERED`;
  - không xác nhận thu tiền cho đơn `CANCELLED`.
- `approveRefund` cũng gộp status + audit trong một transaction, cùng mô hình với các
  transition refund khác.

**Test:** `payment-collection.spec.ts`, `refund.spec.ts`, `evidence-aftersales.spec.ts`,
`concurrency-money.e2e-spec.ts`, `final-uat.spec.ts` (UAT-03/05).

### 2.4. Đối soát tài chính toàn kỳ

**Vấn đề trước đây:** báo cáo chỉ quét tối đa 2.000 đơn và trả cờ `truncated` /
`scanLimit`; summary có thể không phản ánh toàn kỳ.

**Thay đổi:**

- Bỏ giới hạn cứng `MAX_RECONCILIATION_SCAN`; thay bằng keyset cursor `id DESC`,
  `RECONCILIATION_BATCH_SIZE = 500`.
- Quét **toàn bộ khoảng ngày** theo từng batch; chỉ giữ trang được yêu cầu trong bộ nhớ,
  nhưng bộ đếm summary cộng dồn cho mọi đơn.
- Bỏ `truncated` / `scanLimit` khỏi API, Admin types và UI; không còn hợp đồng gây hiểu
  nhầm là báo cáo bị cắt.
- Tách `classify(order)` thành bước thuần cho từng dòng; summary gồm:
  `originalValue`, `obligation`, `collected`, `refunded`, `outstanding`, `refundDue`.
- Đơn `CANCELLED` có nghĩa vụ hiệu lực 0 nhưng **giữ nguyên** `grandTotal` gốc; tiền đã
  thu vượt nghĩa vụ được báo là `refundDue`, không sửa giá trị đơn.
- `outstanding` và `refundDue` cộng theo từng đơn, không bù trừ chéo giữa đơn thu vượt và
  đơn thu thiếu.

**Test:** `payment-reconciliation.spec.ts` (gồm test nhiều batch > 500),
`finance-reconciliation.e2e-spec.ts`, `reconciliation.spec.tsx`, UAT-01/06 và UAT-03/05.

### 2.5. Tồn kho và chứng từ kho

- `InventoryService.changeOnHand` thêm guard thứ hai:
  `on_hand + delta >= reserved + blocked`. Trước đây chỉ chặn `on_hand < 0`, nên phiếu
  xuất kho có thể lấy hàng đã giữ cho đơn hoặc đang cách ly, làm `available` âm.
- Phiếu xuất kho `OUTBOUND` giảm `product_lots.remaining_quantity` trong cùng transaction,
  có guard `remaining_quantity >= qty`, tránh lô âm hoặc vượt số lượng.
- Tạo phiếu kho draft được validate ngay trong transaction:
  - không trùng dòng;
  - lô và quy cách phải tồn tại;
  - **lô phải thuộc đúng sản phẩm của quy cách** — trước đây có thể ghép lô sản phẩm A
    với variant sản phẩm B, làm sai cả tồn kho lẫn truy xuất.
- Sửa lỗi hiển thị trên tab vận đơn: chỉ hiển thị `deliveredAt` thật, không lấy
  `shippedAt` thay cho thời điểm giao.
- Tab lô chuyển `Alert.message` sang `Alert.title` theo Ant Design 6.

**Test:** `warehouse-document-draft.spec.ts`, `warehouse-admin.e2e-spec.ts`,
`concurrency.e2e-spec.ts`, `inventory.spec.ts`.

### 2.6. Tài chính Admin và thời điểm giao của đánh giá

- Trang chi tiết đơn hiển thị **6 chỉ số tài chính** tách bạch: Giá trị đơn, Công nợ hiệu
  lực, Đã thu, Còn phải thu, Đã hoàn tiền, Cần hoàn trả. Đơn huỷ có cảnh báo riêng; đơn
  thu vượt có cảnh báo `refundDue`.
- Nhãn hoa hồng / phải trả đối tác phân biệt **dự kiến** (chưa có settlement line) và
  **đã ghi nhận/đã quyết toán**.
- Thay `Alert.message` bằng `Alert.title` theo Ant Design 6; UAT bắt warning console.
- `EligibleReviewItem.deliveredAt` chuyển thành `string | null`, lấy từ shipment
  `DELIVERED` mới nhất. Đơn legacy không có bằng chứng giao hiển thị **“Chưa giao”**,
  không lấy `createdAt` của đơn để giả làm thời điểm giao.
- Đồng bộ type ở Admin, Customer, Mobile và hiển thị ở hai màn đánh giá.

**Test:** `final-uat.spec.ts` (UAT-01/06), `reconciliation.spec.tsx`,
`order-detail.spec.ts`, `order-flow.spec.ts`, review tests.

### 2.7. Đánh giá chất lượng thay đổi test

Không nới lỏng assertion để “làm xanh”. Các test cũ được cập nhật theo hợp đồng mới,
đồng thời thêm test chặt hơn:

- `DELIVERED` thủ công bị từ chối khi thiếu bằng chứng (409, thông điệp nêu rõ đơn đối
  tác/vận đơn thiếu).
- Rollup chỉ xảy ra khi mọi đơn đối tác đã giao và không còn shipment active.
- Đối soát chạy nhiều batch, không còn `truncated`; test pin đúng summary toàn kỳ.
- Xuất kho không được lấy vào `reserved + blocked`; lô/variant sai sản phẩm bị từ chối.
- `deliveredAt = null` là trạng thái hợp lệ của đơn legacy, không bị thay bằng `createdAt`.

---

## 3. UAT trình duyệt thật trên DB test

### 3.1. Môi trường và cô lập dữ liệu

| Mục | Giá trị |
|---|---|
| Database | `agrimarket_v2_test` (schema test riêng) |
| Kiểm tra cô lập | Đã xác nhận `DATABASE_URL` ≠ `TEST_DATABASE_URL`; DB test kết thúc `_test`; global setup chỉ reseed schema `_test` |
| API | `http://localhost:3100` |
| Admin | `http://localhost:3101` |
| Customer | `http://localhost:3102` |
| Lý do cổng thay thế | Cổng 3000–3002 đang bị server của người dùng chiếm; **không kill** các server này |
| Cấu hình | Config Playwright tạm cho UAT local, đã xoá sau khi chạy; không commit |
| Dữ liệu | Chỉ tạo đơn/shipment/refund trong schema test; không đụng DEV/Production |
| Seed/migration | Seed chỉ chạy trên `agrimarket_v2_test`; không chạy migration mới |

### 3.2. Bốn kịch bản UAT cuối

Mỗi kịch bản chạy trên **admin-desktop (1440×900)** và **admin-small (390×844)**.

| ID | Kịch bản | Kết quả | Bằng chứng chính |
|---|---|---|---|
| **UAT-01/06** | 6 chỉ số tài chính của đơn COD mới; không có `[object Object]`; không tràn ngang; không warning AntD `Alert.message` | **PASS** | 6 card đúng số stored; `overflow ≤ 1px`; console warning rỗng |
| **UAT-02/04** | Giao hàng chỉ qua vận đơn; menu không còn `Đã giao`; picker chỉ trả đơn đủ điều kiện; `IN_TRANSIT` rollup đơn sang `SHIPPING`; `DELIVERED` thủ công bị 409 | **PASS** | Picker có đơn `READY_TO_SHIP`, không có đơn `PENDING_CONFIRMATION`; shipment tạo thật; API trả `SHIPPING`; 409 khớp `/bằng chứng/i`; 390px không tràn |
| **UAT-03/05** | Giao bằng shipment; tab vận đơn hiển thị `deliveredAt` thật, không còn “Chưa giao”; COD chưa thu; ghi nhận COD; hoàn một phần 10.000; 6 chỉ số cập nhật đúng | **PASS** | Order `DELIVERED`; bằng chứng `SHP-*` + “Đã giao”; cảnh báo COD chưa thu; sau thu `Đã thu = grandTotal`, `Còn phải thu = 0`; sau hoàn `Đã hoàn tiền = 10.000`, `Giá trị đơn` không đổi |
| **UAT-07** | Ranh giới vai trò và sở hữu trên API | **PASS** | Customer gọi finance/picker/order admin → 403; customer khác đọc đơn/PDF → 404; ẩn danh → 401; admin → 200 |

**Lưu ý về tab ở 390px:** Ant Design thu một phần tab strip vào nút overflow. UAT mở tab
`?tab=shipping` và `?tab=payment` bằng URL để thao tác ổn định; assertion nghiệp vụ vẫn
là thật, không bị nới lỏng. Đây là hạn chế UX P3, không phải lỗi dữ liệu.

### 3.3. Full Playwright suite

| Mục | Kết quả |
|---|---|
| Tổng | **30/30 PASS** |
| Thời gian | **1,2 phút** |
| Project | `admin-desktop`, `admin-small`, `customer` và các project setup |
| Retry | 0 |
| Phạm vi | Admin order detail desktop + 390px, Admin reconciliation, Customer COD/PDF/voucher/refund, UAT cuối |
| Artifact | `test-results`, `playwright-report`, `e2e/.auth` đã được dọn; không commit |

### 3.4. Giới hạn của UAT này

Các mục sau **NOT TESTED** trong vòng này:

- UAT trên staging với dữ liệu thật/đã ẩn danh và 43 kịch bản chính thức.
- Chữ ký kế toán cho quy tắc “đã thu đủ”, danh sách loại trừ và quy trình
  `MISSING_COLLECTION_EVIDENCE`.
- Thiết bị Android/iOS thật (D1–D9).
- Cổng thanh toán online; UAT chỉ chạy COD, `PAYMENTS_ONLINE_ENABLED=false`.
- Load test trên hạ tầng staging; số liệu tải cũ chỉ là local một máy.
- Đo tính đúng của báo cáo đối soát trên dữ liệu production quy mô lớn.

---

## 4. Hồi quy bắt buộc

Tất cả lệnh dưới đây đã chạy thực tế trên đúng commit `0a6939f`; không có kết quả nào
được suy diễn.

| Gate | Kết quả | Chi tiết |
|---|---|---|
| `npm run typecheck` | **PASS** | 6 workspace pass, 0 lỗi |
| `npm run lint` | **PASS** | 0 error; 5 warning tồn tại (không chặn) |
| `npm test` | **PASS 978** | Admin 55; API 637; Customer 37; Mobile 178; Shared 71 |
| `npm run build` | **PASS** | API, Admin, Customer build thành công; Admin 32 route, Customer 21 route |
| `npm run test:e2e --workspace @agrimarket/api` | **PASS 495** | 23 file, 134,72 giây, dùng `agrimarket_v2_test` |
| Playwright full suite | **PASS 30/30** | 1,2 phút; `admin-desktop`, `admin-small`, `customer` + setup; retry 0 |

### 4.1. Warning lint còn lại

Không có error. 5 warning hiện hữu:

- `apps/api/src/traceability/traceability.service.ts:76`
- `apps/api/test/concurrency.e2e-spec.ts:398` (2 warning)
- `apps/api/test/warehouse-admin.e2e-spec.ts:506`
- `apps/api/test/business-rules/payment-reconciliation.spec.ts:470`

Các warning này không liên quan đến thay đổi nghiệp vụ của vòng và không làm fail gate.

### 4.2. Xác nhận không nới lỏng test

- Không bỏ test, không `skip`, không tăng timeout để che lỗi.
- Test đối soát được sửa để **bỏ hợp đồng cũ** `truncated`/`scanLimit` và thêm test
  nhiều batch; đây là thay đổi theo hợp đồng mới, không phải hạ thấp kỳ vọng.
- Test giao hàng được **siết** thêm: `DELIVERED` thủ công phải bị từ chối nếu thiếu
  bằng chứng.
- Test tồn kho được **siết** thêm: xuất kho không được lấn `reserved + blocked`.
- Test review chấp nhận `deliveredAt = null` cho đơn legacy, nhưng **không** chấp nhận
  việc lấy `createdAt` thay thế.

---

## 5. Dữ liệu lịch sử

### 5.1. Phương pháp

- Chỉ chạy truy vấn **read-only** qua hai script do người dùng sở hữu:
  `apps/api/.tmp-readonly-audit.mjs`, `apps/api/.tmp-readonly-lot.mjs`.
- Không sửa, không xoá, không commit hai script.
- Không chạy seed/migration trên DEV/Production; không sửa tay bảng tiền, tồn kho.
- Snapshot được đối chiếu trước/sau vòng sửa lỗi; các trường nghiệp vụ dưới đây giữ nguyên.

### 5.2. Ba đơn lịch sử

| Mã đơn | Trạng thái | Grand total | Payment | Vận đơn | Ghi chú |
|---|---|---:|---|---|---|
| `ORD-20261006-0003` | `DELIVERED` | 201.000 | `PENDING`, chưa `paidAt` | 2 shipment `IN_TRANSIT`, `deliveredAt = null` | Đơn legacy đã giao nhưng vận đơn chưa từng `DELIVERED`; không sửa |
| `ORD-20261013-0006` | `DELIVERED` | 140.000 | `PENDING`, chưa `paidAt` | Không có shipment | Đơn legacy giao trước khi có bằng chứng vận đơn; không sửa |
| `ORD-20261101-0002` | `CANCELLED` | 56.000 | `PENDING`, chưa `paidAt` | Không có shipment | Đơn huỷ; không sửa |

Cả ba đơn đều **không** bị thay đổi trạng thái, tổng tiền, payment hay shipment bởi vòng
này. Đây là dữ liệu lịch sử có sai lệch legacy (đơn `DELIVERED` nhưng thiếu bằng chứng
giao), cần kế hoạch xử lý riêng trước staging/production.

### 5.3. Lô hết hạn

- **13 lô** đang ở trạng thái `SELLABLE` nhưng đã quá `expiresAt` tại thời điểm truy vấn;
  tất cả giữ nguyên.
- Lô được kiểm tra chi tiết (snapshot riêng): `LOT-20261003-0007`
  - trạng thái `SELLABLE`, `expiresAt = 2026-11-04T17:00:00Z`;
  - `remainingQuantity = 988`;
  - tồn kho: `onHand = 995`, `reserved = 2`, `blocked = 0`;
  - có một allocation số lượng 5 cho đơn lịch sử.
- Không có thay đổi nào đối với các lô này. Đây là **rủi ro dữ liệu/vận hành** cần được
  xử lý có kiểm soát (chặn bán, cách ly, hoặc quy trình huỷ hàng có biên bản), không được
  sửa tay trong UAT.

### 5.4. Kết luận về dữ liệu lịch sử

Yêu cầu “3 đơn và 13 lô phải giữ nguyên” đã được tuân thủ. Tuy nhiên, các sai lệch legacy
vẫn tồn tại và sẽ hiển thị trên UI (ví dụ đơn `DELIVERED` có shipment `IN_TRANSIT` hiển thị
“Chưa giao”). Đây là lý do staging phải có kế hoạch dữ liệu trước khi nghiệm thu, không
phải lỗi do vòng sửa lỗi tạo ra.

---

## 6. Kết luận liên nghiệp vụ

### 6.1. Chuỗi giao hàng → tồn kho → COD → doanh thu

1. Đơn chỉ sang `DELIVERED` khi **mọi** đơn đối tác có shipment `DELIVERED` với
   `deliveredAt` thật và không còn shipment active.
2. Khi đơn sang `DELIVERED`, tồn kho được trừ đúng một lần; rollup từ shipment không
   trừ lần hai.
3. COD chỉ được ghi nhận thu **sau** khi đơn `DELIVERED`; giao hàng không tự động ghi
   nhận tiền.
4. Tiền thu, tiền hoàn và công nợ hiển thị tách bạch; hoàn một phần không làm thay đổi
   giá trị đơn gốc.
5. Đối soát đọc cùng các dữ liệu payment/refund đã lưu, quét toàn kỳ, nên số liệu trên
   màn hình đơn và báo cáo tài chính không lệch nhau do giới hạn quét.

### 6.2. Tồn kho và chứng từ kho

- Xuất kho không thể lấy hàng đã reserved cho đơn hoặc đã blocked cách ly.
- Lô và quy cách sai sản phẩm bị từ chối ngay khi tạo draft, không đợi đến lúc hoàn tất
  phiếu mới lỗi.
- Số lượng còn lại của lô giảm cùng transaction với `on_hand`, tránh lô “còn hàng” nhưng
  kho hết hoặc ngược lại.

### 6.3. Phân quyền và ranh giới dữ liệu

- Finance reconciliation và shipment picker là ADMIN; customer nhận 403.
- Customer chỉ đọc đơn/PDF của mình; customer khác nhận 404, ẩn danh nhận 401.
- Admin đọc được đơn và thao tác đúng phạm vi.

### 6.4. Điểm cần ACC xác nhận

- Quy ước “Còn phải thu” tính trên **tổng đã thu gộp** (gross collected), còn “Đã hoàn
  tiền” hiển thị riêng. Vì vậy sau khi thu đủ và hoàn một phần, “Còn phải thu = 0” và
  “Đã hoàn tiền = 10.000”. ACC cần xác nhận cách trình bày này là đúng nghiệp vụ.
- Quy tắc “đã thu đủ” và danh sách đơn bị loại khỏi kỳ quyết toán theo
  `docs/STAGING-UAT-PLAN.md` §10.
- F-30-1: chọn loại trừ đơn thiếu `paidAt` khỏi quyết toán, hoặc duyệt công cụ backfill
  có audit; không sửa tay DB.

---

## 7. Rủi ro còn lại

### 7.1. F-30-1 — P2, quyết định vận hành

**Mô tả:** payment đã `PAID` nhưng thiếu `paidAt` không có đường nghiệp vụ để backfill.
`PATCH /payments/:id/status` với cùng trạng thái là no-op; chỉ chuyển sang `PAID` từ trạng
thái khác mới ghi `paidAt`.

**Ảnh hưởng:** dòng `MISSING_COLLECTION_EVIDENCE` do đối soát phát hiện không thể sửa
trong ứng dụng. Nếu kế toán kết luận đã thực thu, hiện chỉ còn cách sửa tay DB — trái
nguyên tắc audit và bị cấm trong UAT.

**Quyết định cần chủ dự án/ACC:** (a) loại các đơn này khỏi kỳ quyết toán và xử lý bằng
chứng từ ngoài hệ thống, hoặc (b) duyệt công cụ backfill có audit, chạy theo từng dòng
được kế toán ký. Không thử trên dữ liệu thật.

### 7.2. Các điểm P3

| ID | Mô tả | Ảnh hưởng | Đề xuất |
|---|---|---|---|
| P3-1 | API trực tiếp vẫn cho `READY_TO_SHIP → SHIPPING` dù chưa có shipment | UI đã bỏ nút; caller API ngoài luồng có thể làm đơn sang `SHIPPING` mà không có vận đơn | Siết state machine ở vòng sau hoặc cấm bằng vận hành; không chặn UAT |
| P3-2 | Picker vận đơn giới hạn 200 đơn đủ điều kiện | Kho lớn có thể không thấy hết đơn trong dropdown | Thêm phân trang/tìm kiếm khi số đơn lớn |
| P3-3 | Đối soát quét toàn kỳ là O(N) mỗi request | Kỳ rất lớn làm tăng thời gian phản hồi | Theo dõi trên staging; cân nhắc index/materialized summary |
| P3-4 | Đơn legacy `DELIVERED` không có `deliveredAt` hiển thị “Chưa giao” | Đúng sự thật dữ liệu nhưng dễ gây hiểu nhầm | Xử lý dữ liệu legacy có biên bản; không bịa timestamp |
| P3-5 | Tab strip AntD bị overflow ở 390px | Người dùng phải mở nút overflow; UAT dùng URL để ổn định | Cải thiện responsive ở vòng UI sau |
| P3-6 | 13 lô `SELLABLE` đã hết hạn vẫn còn trong hệ thống | Nguy cơ bán hàng hết hạn nếu không chặn kịp | Chặn bán/cách ly có biên bản trước staging; không sửa tay dữ liệu lịch sử |

> P3-6 được xếp vào nhóm dữ liệu/vận hành, không phải lỗi code của vòng này. Tuy nhiên,
> đây là điều kiện phải xử lý trước khi coi dữ liệu staging/production là sạch.

### 7.3. Không có P0/P1 mới

Không phát hiện mất tiền, lộ dữ liệu, sai tồn kho, hỏng đăng nhập hay regression hiệu
năng trong các gate đã chạy.

---

## 8. Quyết định phát hành

### 8.1. Vòng sửa lỗi local — **GO**

Điều kiện đã đạt:

- Commit an toàn, đúng phạm vi 40 file, không migration, không secret/artifact.
- 5 gate bắt buộc PASS; 978 unit/component; 495 API E2E; 30/30 Playwright.
- UAT trình duyệt thật trên `agrimarket_v2_test` PASS 4 kịch bản cuối.
- Không có P0/P1 mới; dữ liệu lịch sử được giữ nguyên.
- Working tree chỉ còn 2 file read-only của người dùng.

### 8.2. Bàn giao staging — **CONDITIONAL GO**

Chỉ GO khi đáp ứng đủ các điều kiện sau:

1. Deploy đúng commit `0a6939f` (kèm commit tài liệu `docs(31)`), không chỉnh mã nguồn
   trên staging.
2. Chạy đủ **43 kịch bản** tại `docs/STAGING-UAT-PLAN.md` §9; mỗi kịch bản có bằng
   chứng, người chạy, thời gian và kết quả.
3. ACC ký §10.1–10.8, đặc biệt quy trình `MISSING_COLLECTION_EVIDENCE`; quyết định
   F-30-1 theo hướng (a) hoặc (b).
4. ACC xác nhận cách trình bày “Còn phải thu” / “Đã hoàn tiền” / “Cần hoàn trả” sau khi
   thu đủ và hoàn một phần.
5. Có kế hoạch xử lý dữ liệu lịch sử: 3 đơn legacy và 13 lô hết hạn; không sửa tay bảng
   tiền; chặn bán lô hết hạn có biên bản.
6. Diễn tập backup/restore/rollback; chạy load test trên staging; xác nhận
   `TEST_DATABASE_URL` rỗng và `PAYMENTS_ONLINE_ENABLED=false` trên staging.
7. Chạy D1–D9 trên thiết bị Android/iOS thật; nếu bật gateway online, có UAT riêng và
   phê duyệt.
8. Chấp nhận hoặc có kế hoạch cho các P3 đã liệt kê.

### 8.3. Production — **NO-GO**

Chưa đủ điều kiện go-live vì chưa có:

- UAT staging 43 kịch bản và biên bản PASS.
- Chữ ký kế toán/ACC cho quy tắc tiền, loại trừ quyết toán và F-30-1.
- Xác nhận trên thiết bị thật.
- UAT cổng thanh toán online (nếu bật).
- Diễn tập backup/restore/rollback và load test trên hạ tầng thật.
- Quyết định go/no-go có chữ ký của RO.

### 8.4. Việc chưa làm

- Chưa push GitHub, chưa chạy GitHub CI, chưa deploy.
- Chưa UAT staging/production.
- Chưa có chữ ký ACC.
- Chưa chạy thiết bị thật.
- Chưa chạy gateway online.
- Chưa đo tải trên staging.

---

## 9. Bằng chứng và tài liệu tham chiếu

### 9.1. Commit và mã nguồn

- Commit: `0a6939f2c149d1f2f5751c7a5f2d070865f7c768`
- Parent: `2c942eaf0eb17b788f566ec1a2309889fdce5cb8`
- 40 file, +1.815 / −390, 0 migration.
- File chính: `apps/api/src/orders/delivery-evidence.ts`,
  `apps/api/src/shipments/shipment-statuses.ts`, `e2e/admin/final-uat.spec.ts`.

### 9.2. Test và kế hoạch

- `e2e/admin/final-uat.spec.ts` — 4 kịch bản UAT cuối.
- `apps/api/test/business-rules/delivery-return.spec.ts`
- `apps/api/test/business-rules/evidence-aftersales.spec.ts`
- `apps/api/test/business-rules/payment-reconciliation.spec.ts`
- `apps/api/test/business-rules/warehouse-document-draft.spec.ts`
- `apps/api/test/concurrency.e2e-spec.ts`
- `apps/api/test/finance-reconciliation.e2e-spec.ts`
- `apps/api/test/mutation-acceptance.e2e-spec.ts`
- `apps/api/test/warehouse-admin.e2e-spec.ts`
- `docs/STAGING-UAT-PLAN.md` — 43 kịch bản, cổng G0–G5, §10 ACC.
- `docs/BUSINESS-RULES.md` — quy tắc nghiệp vụ liên quan.

### 9.3. Báo cáo trước

- `audit-reports/31-RELEASE-CANDIDATE-UAT-HANDOFF.md` — bàn giao RC, F-30-1, checklist
  staging và thiết bị thật.
- `audit-reports/30-FINAL-FINANCE-UI-CLEANUP-ACCEPTANCE.md` — vòng dọn tài chính/UI trước.

### 9.4. Giới hạn bằng chứng

- Log gate và UAT được ghi nhận trong phiên chạy ngày 04/11/2026; artifact Playwright tạm
  đã được dọn để không đưa file không liên quan vào repo.
- Báo cáo này **không** thay thế biên bản UAT staging, chữ ký ACC, biên bản backup/restore
  hay nghiệm thu thiết bị thật.
- Mọi mục chưa chạy phải giữ trạng thái **NOT TESTED** cho đến khi có bằng chứng mới.

---

## 10. Bảng ký xác nhận (để trống cho staging)

| Vai trò | Họ tên | Kết luận | Ngày | Chữ ký |
|---|---|---|---|---|
| Release Owner | | | | |
| QA Lead | | | | |
| ACC / Kế toán | | | | |
| IT / Vận hành | | | | |
| Trưởng kho | | | | |

**Kết luận cuối:** vòng sửa lỗi local đạt **GO**; bàn giao staging đạt **CONDITIONAL GO**
với các điều kiện tại §8.2; production giữ **NO-GO** cho đến khi hoàn tất UAT staging,
chữ ký ACC, thiết bị thật, gateway và diễn tập vận hành.
