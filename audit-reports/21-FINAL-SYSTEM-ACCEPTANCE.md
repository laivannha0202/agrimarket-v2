# 21 — FINAL SYSTEM ACCEPTANCE

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Ngày tổng hợp:** 23/10/2026  
**Bằng chứng:** `.tmp-verify/final-hardening/` và các report 15–20  
**Kết luận điều hành:** **NO-GO cho bán hàng thật tại HEAD hiện tại.** Hệ thống đã được hardening đáng kể ở P0-A/P0-B/P0-C và một phần P0-D, nhưng chưa đủ điều kiện production-ready.

---

## 1. Baseline và phạm vi nghiệm thu

| Hạng mục | Giá trị |
|---|---|
| Branch | `fix/p0-a-security-pricing` |
| HEAD | `5b35b974bae65f308cfdce3ab23a6aec959f2916` |
| Tracked file thay đổi | 65 file |
| Untracked entry | 27 entry (gồm báo cáo, test mới, CI, script backup) |
| Diff | 4.034 dòng thêm / 699 dòng xoá |
| Migration | 12 thư mục; 1 migration mới trong đợt hardening |
| Test database | `agrimarket_v2_test` (cô lập) |
| Production/development DB | Không sửa, không migrate, không seed |
| Commit/push/merge/deploy | **Không thực hiện** |
| `git diff --check` | Sạch (chỉ còn cảnh báo LF/CRLF của Git) |

Phạm vi nghiệm thu: C-01 đến C-19 trong Report 14, các luồng P0-A (bảo mật/giá), P0-B (shipment/order), P0-C (quarantine/QC), P0-D (return/refund/settlement), CI/backup/security và bằng chứng UI.

---

## 2. Phán quyết tổng quát

### 2.1. Điều đã đạt

- JWT fail-closed; không còn fallback `CHANGE_ME`.
- API public không còn trả bank/tax của Partner.
- Giảm giá PERCENT bị chặn trên 100%; không tạo được giá âm qua API.
- Shipment/order có guard trạng thái, CAS và đồng bộ khi huỷ đơn `SHIPPING`.
- `blocked` có vòng đời release/scrap; phiếu kho `RETURN` không cộng thẳng vào hàng bán được.
- Return có state machine, ownership, receipt, quarantine và link refund.
- Refund có PENDING → APPROVED → COMPLETED/FAILED, idempotency, reference, cap theo số đã thanh toán.
- Settlement chỉ lấy đơn đã thu tiền, trừ refund COMPLETED; adjustment `OPEN` chặn confirm/payout/mark-paid.
- COD không tự PAID khi giao; client copy đã sửa.
- Có CI file hợp lệ, security smoke, backup/restore script, audit viewer.
- Toàn bộ unit/E2E/typecheck/lint/build trong phạm vi local đã chạy; DB invariant audit bằng 0.

### 2.2. Điều chưa đạt

- Return/refund chưa khép kín: refund chưa bị cap theo giá trị hàng hoàn; dialog return vẫn nhập tay `refundId`.
- Complaint API vẫn không có state machine.
- Refund sau settlement mới tạo adjustment `OPEN`, chưa có phương án thu hồi/clawback; chưa có UI review adjustment.
- Swagger/comment COD vẫn còn câu “DELIVERED settles COD”.
- Reservation chưa có job hết hạn; client vẫn cắt trang đầu ở nhiều danh sách.
- Trace chưa có authoring UI đầy đủ và chưa chứng minh chuỗi 8 event.
- CI chưa chạy remote; chưa có Playwright UI E2E; chưa test SMTP/payment/carrier thật.
- Backup mới là drill local; RPO/RTO chưa được phê duyệt.
- Next.js `16.4.0` vẫn là dependency bị advisory; chưa nâng `16.4.1`.
- Chưa có metrics/alerting, RBAC chi tiết, deploy/rollback.

---

## 3. Ma trận nghiệm thu C-01 → C-19

| Mã | Mức | Nội dung | Phân loại | Bằng chứng chính | Khoảng trống còn lại |
|---|---|---|---|---|---|
| C-01 | P0 | JWT secret fail-open | **VERIFIED FIXED** | `resolveJwtSecret`, test startup fail, security smoke | Chưa rotate secret thật/thu hồi token cũ |
| C-02 | P0 | Shipment tạo cho đơn huỷ; DELIVERED trên đơn huỷ bị kẹt | **VERIFIED FIXED** | Guard create/status, CAS, test cancel/deliver | — |
| C-03 | P0 | Shipment RETURNED chỉ ghi trace | **VERIFIED FUNCTIONAL** | RETURNED → blocked + quarantine + trace; không tự refund | Không tự tạo ReturnRequest/refund (policy có chủ đích) |
| C-04 | P0 | `blocked` chỉ tăng, không release | **VERIFIED FIXED** | Release/scrap CAS, double-release test, DB row evidence | — |
| C-05 | P0 | Return không state machine; `refundId` tuỳ ý | **PARTIALLY COMPLETE** | State machine, ownership, same-order refund, quarantine gate | Refund chỉ cap theo paid, chưa cap theo `quantity × unitPriceSnapshot` |
| C-06 | P0 | Không có UI refund; refund COMPLETED ngay | **PARTIALLY COMPLETE** | Refund lifecycle + trang `/refunds` + approve/complete | Return dialog vẫn nhập tay `refundId`; hoàn tiền COD vẫn thủ công |
| C-07 | P0 | Phiếu kho RETURN cộng thẳng hàng bán được | **VERIFIED FIXED** | RETURN vào `blocked`, cần QC release | — |
| C-08 | P0/P1 | Settlement bỏ refund, settle COD chưa thu | **PARTIALLY COMPLETE** + **BUSINESS DECISION REQUIRED** | Require payment paid, deduct completed refunds, OPEN guards | Chưa thực thi thu hồi refund sau settlement; chưa có UI adjustment |
| C-09 | P1 | PERCENT > 100 tạo giá âm | **VERIFIED FIXED** | Validator + 12 test; legacy 200% clamp | — |
| C-10 | P1 | Public Partner lộ bank/tax | **VERIFIED FIXED** | Public select an toàn; test nested routes | — |
| C-11 | P1/P2 | Product INACTIVE vẫn public | **PARTIALLY COMPLETE** | Public list/detail chỉ ACTIVE; route ADMIN riêng | Chưa có test hồi quy trực tiếp cho inactive |
| C-12 | P1 | Copy COD sai | **PARTIALLY COMPLETE** | Customer/Mobile copy đã sửa | Swagger `orders.controller.ts:112` và comment service vẫn sai |
| C-13 | P0/P1 | Huỷ SHIPPING khi shipment vẫn chạy | **VERIFIED FIXED** | Cancel order đồng bộ shipment; test | Chính sách huỷ khi đang giao cần được phê duyệt vận hành |
| C-14 | P1 | Trace thiếu event/authoring | **PARTIALLY COMPLETE** | Thêm event đóng gói/xuất kho/hoàn hàng | Chưa có UI harvest/farming; chưa chứng minh đủ 8 event |
| C-15 | P1 | Return/complaint transition chỉ ở UI | **PARTIALLY COMPLETE** | Return state machine ở backend | Complaint API vẫn nhận mọi status |
| C-16 | P2 | Client cắt danh sách trang đầu | **VERIFIED BUG — OPEN** | Code vẫn `page:1`, limit 100/30/20 | Chưa sửa |
| C-17 | P1/P2 | Không có job hết hạn reservation | **VERIFIED BUG — OPEN** | Không có scheduler/TTL | Chưa sửa |
| C-18 | P1/P2 | Mail mặc định capture | **PARTIALLY COMPLETE** | API báo `deliveryMode`; không giả “đã gửi” | Chưa test SMTP thật; chưa fail-fast production |
| C-19 | P0/P1 | Thiếu CI/backup/observability/RBAC | **PARTIALLY COMPLETE** | CI file, security smoke, backup drill, audit viewer | Remote CI, deploy, metrics, RBAC, offsite backup, RPO/RTO |

**Đọc ma trận:** 7 mục đạt **VERIFIED FIXED** (C-01, C-02, C-04, C-07, C-09, C-10, C-13), 1 mục **VERIFIED FUNCTIONAL** (C-03), 9 mục **PARTIALLY COMPLETE** (C-05, C-06, C-08, C-11, C-12, C-14, C-15, C-18, C-19), 2 mục **VERIFIED BUG — OPEN** (C-16, C-17). Trong đó C-08 và RPO/RTO vẫn cần **BUSINESS DECISION REQUIRED**. Không có mục nào được đánh dấu hoàn thiện tuyệt đối ngoài phạm vi đã nêu.

---

## 4. Thay đổi code chính

### 4.1. Bảo mật và giá

- `apps/api/src/config/configuration.ts`: `resolveJwtSecret` fail-closed; từ chối thiếu/rỗng/placeholder/ngắn/entropy thấp.
- `apps/api/src/auth/auth.module.ts`, `jwt.strategy.ts`: bỏ fallback.
- `apps/api/src/partners/*`: public response chỉ trường an toàn; route ADMIN riêng.
- `apps/api/src/promotions/*`: validator PERCENT/FIXED; chặn >100, âm, không phải số; clamp dữ liệu legacy.
- `apps/api/src/products/*`: public list/detail chỉ ACTIVE; thêm route ADMIN.

### 4.2. Shipment, order, kho

- `apps/api/src/shipments/shipments.service.ts`: guard create/status, CAS, cancel sync, RETURNED → quarantine.
- `apps/api/src/orders/orders.service.ts`: cancel `SHIPPING` đồng bộ shipment; không auto-PAID COD.
- `apps/api/src/quarantine/*`: case lifecycle, PASS/FAIL, RELEASE/SCRAP.
- `apps/api/src/inventory/inventory.service.ts`: release blocked có guard.
- `apps/api/src/inventory/warehouse-documents.service.ts`: RETURN không cộng sellable; complete CAS.

### 4.3. Return, refund, settlement

- `apps/api/src/returns/*`: state machine, row lock, ownership, receipt, quarantine gate, refund link.
- `apps/api/src/payments/*`: refund lifecycle, idempotency, reference, cap theo paid, adjustment sau settlement.
- `apps/api/src/finance/settlements.service.ts`: require paid, trừ refund COMPLETED, adjustment OPEN guards.
- `apps/api/src/finance/finance.controller.ts`, DTO: adjustment review API.

### 4.4. UI

- Admin: `/refunds`, `/quarantine`, `/shipments`, `/seasons`, `/audit`; order detail refund prefill; return dialog state machine.
- Customer Web: copy COD, hiển thị refund/return.
- Mobile: copy COD, hiển thị refund/return.

### 4.5. Hạ tầng

- `.github/workflows/ci.yml`, `scripts/security-smoke.mjs`, `scripts/backup-db.mjs`, `scripts/restore-db.mjs`, `docs/BACKUP-RESTORE-RUNBOOK.md`.
- `package.json`: script `security:smoke`, `backup:db`, `restore:db`.

### 4.6. Migration

`apps/api/prisma/migrations/20261023000000_p0b_integrity_quarantine_refunds/migration.sql`:

- enum movement `QUARANTINE`, `QUARANTINE_RELEASE`, `SCRAP`;
- bảng `quarantine_cases`;
- refund lifecycle columns/index/unique;
- `return_requests.received_at`, unique refund link;
- bảng `settlement_adjustments`.

Migration additive; không viết lại dữ liệu lịch sử.

---

## 5. Kết quả kiểm thử

### 5.1. Tổng hợp

| Bộ | Kết quả | Log |
|---|---|---:|
| API typecheck | PASS | `verify-api-typecheck.log` |
| API lint | PASS (exit 0; 3 cảnh báo thứ tự import có sẵn) | `verify-api-lint.log` |
| API build | PASS | `verify-api-build.log` |
| API unit | **39 file / 531 test PASS** | `verify-api-unit.log` |
| API E2E | **18 file / 439 test PASS** | `verify-api-e2e.log` |
| Admin typecheck | PASS | `verify-admin-typecheck.log` |
| Admin lint | PASS | `verify-admin-lint.log` |
| Admin unit | **7 file / 40 test PASS** | `verify-admin-test.log` |
| Admin build | **PASS sau retry**; lần đầu bị `SecurityFatalError` | `verify-admin-build-attempt1/2.log` |
| Customer typecheck | PASS | `verify-customer-typecheck.log` |
| Customer lint | PASS | `verify-customer-lint.log` |
| Customer unit | **3 file / 37 test PASS** | `verify-customer-test.log` |
| Customer build | **PASS sau retry**; lần đầu bị `SecurityFatalError` | `verify-customer-build*.log` |
| Mobile typecheck | PASS | `verify-mobile-typecheck.log` |
| Mobile lint | PASS | `verify-mobile-lint.log` |
| Mobile unit | **19 file / 178 test PASS** (API up) | `verify-mobile-test-with-api.log` |
| Shared domain typecheck | PASS | `verify-shared-domain-typecheck.log` |
| Shared domain test | **5 file / 65 test PASS** | `verify-shared-domain-test.log` |
| Design tokens typecheck | PASS | `verify-design-tokens-typecheck.log` |
| Security smoke | PASS — 5 file | `verify-security-smoke.log` |
| Migration status | 12 migration, up to date | `verify-migration-status.log` |
| DB invariant audit | tất cả 0 | `verify-db-invariant-audit.log` |

Tổng test đã chạy: **531 + 439 + 40 + 37 + 178 + 65 = 1.290 test**. Con số này không bao gồm test mobile trên thiết bị thật, Playwright UI E2E hoặc test production.

### 5.2. Test targeted cho khoảng trống mới

| Bộ | Kết quả | Nội dung |
|---|---:|---|
| `delivery-return.spec.ts` + `refund.spec.ts` | 2 file / **35 test PASS** | RETURNED replay no-op; cancel sync mapping; losing CAS; wrong-order refund link |
| `warehouse-admin.e2e-spec.ts` | **11 test PASS** | PASS chưa release; RETURN complete một lần; double-complete; movement/case |
| `concurrency-money.e2e-spec.ts` | **20 test PASS** | Adjustment OPEN chặn confirm/payout/mark-paid; review mở khoá |

Các test này được thêm vì trước đó thiếu, không phải chạy lại test đã có.

### 5.3. Build và cảnh báo Next.js

- Lần build đầu của Admin và Customer đều bị `Error [SecurityFatalError]` do Next.js phát hiện phiên bản bị advisory.
- Retry thành công nhưng vẫn in cảnh báo “Your version of Next.js is affected…”.
- Đây là **build gate**, không phải bằng chứng khai thác. Chi tiết tại Report 20.
- Không được ghi “build PASS” mà bỏ qua việc lần đầu fail; trạng thái đúng là **PASS sau retry, dependency còn advisory**.

### 5.4. Điều không được coi là bằng chứng

- Unit test PASS không chứng minh luồng UI thật.
- Ảnh chụp màn hình không thay thế Playwright.
- DB invariant 0 sau test không chứng minh dữ liệu production sạch.
- CI file hợp lệ không chứng minh CI remote xanh.
- Backup có checksum không chứng minh restore production thành công.

---

## 6. Dữ liệu và tính toàn vẹn DB

### 6.1. Invariant audit

```json
{
  "negative_balances": 0,
  "bad_refunded_returns": 0,
  "refunded_without_quarantine": 0,
  "duplicate_refund_links": 0,
  "shipment_order_mismatch": 0,
  "open_adjustments": 0,
  "warehouse_return_without_quarantine": 0,
  "quarantine_blocked_mismatch": 0,
  "refund_over_payment": 0,
  "payout_over_settlement": 0
}
```

### 6.2. Bằng chứng quarantine/warehouse

- Case `QTN-20261023-0110` đã `RELEASED`, nguồn `WAREHOUSE_RETURN`, document 2137.
- Balance 966: `on_hand=701`, `reserved=0`, `blocked=0`.
- Lot 978: `remaining=701`.
- Movement `RETURN` 700 → 701.
- Trace: `RETURNED`, `QC`, `WAREHOUSE_IN`.
- Audit: `CREATE`, `COMPLETE`, `PASS`, `RELEASE`.

Đây là bằng chứng DB thật cho chuỗi nhận hàng hoàn → cách ly → QC → release, không phải mock.

### 6.3. Fixture và cleanup

- Fixture test còn lại trong `agrimarket_v2_test` là dữ liệu test có chủ đích (ví dụ case `QTN-20261023-0110`), không phải lỗi cleanup.
- Schema restore `agrimarket_v2_restore` đã được xoá sau drill.
- Chỉ còn `agrimarket_v2` và `agrimarket_v2_test`.
- Không có migration/sửa dữ liệu trên development/production.

### 6.4. Backup/restore

- Dump 23.275 bytes, SHA-256 `e0d5b066...146f77`, sidecar `restoreVerified: false`.
- Restore local vào schema cô lập và đọc lại: 6 user, 6 order, 9 order item, 6 payment, 1 return, 6 shipment; `paidTotal=628000`.
- Chưa có restore production/offsite, chưa đo RTO, chưa mã hoá dump.

---

## 7. Bằng chứng UI và giới hạn

### 7.1. Ảnh hợp lệ

| Ảnh | SHA-256 (rút gọn) | Nội dung |
|---|---|---|
| `admin-quarantine-warehouse-return.png` | `7BA326D1…` | Quarantine case trước release, stock blocked |
| `admin-quarantine-warehouse-return-released.png` | `9AA6F8E5…` | Cùng case sau release, stock về sellable |
| `admin-shipments.png` | `9BA3A9A8…` | Shipment list + copy COD |
| `admin-order-2392.png` | `7ABCCBB4…` | Order detail/payment/refund action |
| `admin-refund-prefill.png` | `87CB1A51…` | Refund prefill từ order |
| `customer-order-2391-paid.png` | `1249E5FC…` | Customer order đã thanh toán |
| `customer-order-2396-pending.png` | `CA82AB38…` | Customer order COD pending |

### 7.2. Ảnh không hợp lệ

`admin-inventory-return-blocked.png` và `admin-inventory-return-released.png` có **cùng SHA-256** `C4275DF5F8E368D0C948CB9D170B4C6D0482FA7B4F07836BBE0EB0ECF82EE6FB` và cùng kích thước 131.544 bytes. Hai ảnh này **không** được dùng làm bằng chứng cho hai trạng thái khác nhau; bằng chứng đúng là cặp ảnh quarantine ở trên.

### 7.3. Giới hạn

- Ảnh chụp thủ công, không phải Playwright trace/video.
- Không chứng minh được mọi nhánh UI, responsive, accessibility.
- Không có E2E UI tự động cho checkout → admin duyệt → giao → thu COD → return → refund.

---

## 8. Trạng thái các luồng end-to-end

| Luồng | Trạng thái | Ghi chú |
|---|---|---|
| Đăng ký/đăng nhập/JWT | **VERIFIED FUNCTIONAL** | Fail-closed; chưa revoke server-side |
| Catalog/giỏ/checkout COD | **VERIFIED FUNCTIONAL** | Server-side pricing; chỉ COD |
| Duyệt đơn → giao → thu COD | **VERIFIED FUNCTIONAL** | COD thu thủ công; không auto-PAID |
| Huỷ đơn khi SHIPPING | **VERIFIED FIXED** | Shipment được đồng bộ, không treo stock |
| Giao thất bại/hoàn hàng | **VERIFIED FUNCTIONAL** | RETURNED → blocked + quarantine; không auto-refund |
| Return → QC → refund | **PARTIALLY COMPLETE** | State machine/quarantine/refund lifecycle có; cap theo giá trị hàng hoàn thiếu; dialog nhập tay refundId |
| Settlement/COD/refund | **PARTIALLY COMPLETE** | Trừ refund đã completed; adjustment OPEN chặn chi tiền; thu hồi sau settlement chưa thực thi |
| Trace | **PARTIALLY COMPLETE** | Thêm event; thiếu authoring UI/đủ chuỗi |
| Online payment | **CHƯA CÓ** | Không có gateway/callback/refund online |
| Notification/SMTP | **PARTIALLY COMPLETE** | Mail mặc định capture; chưa test SMTP thật |
| CI/backup/deploy | **PARTIALLY COMPLETE** | CI file + backup drill local; remote/deploy chưa |

---

## 9. Trường hợp chưa xác minh

1. CI GitHub Actions chạy thật; branch protection/required checks.
2. Playwright UI E2E và kiểm thử trình duyệt thật.
3. SMTP thật, email giao dịch, retry/alert.
4. Payment gateway/carrier sandbox; callback/webhook/refund online.
5. Dữ liệu production; migration trên bản sao production.
6. Load/performance/stress ở quy mô thật.
7. Khả năng khai thác Next.js trên môi trường Linux thật.
8. Backup offsite, mã hoá, restore production, RTO thực đo.
9. Rotate JWT/DB/SMTP credential.
10. C-11: chưa có test hồi quy trực tiếp cho product INACTIVE.
11. C-05: chưa có E2E refund vượt giá trị hàng hoàn (vì code chưa cap).
12. C-08: chưa có E2E settlement trừ refund thật; chỉ unit mock.
13. C-08: chưa có E2E COD `DELIVERED` nhưng `PENDING` bị loại khỏi settlement.
14. UI review adjustment; `DEDUCT_NEXT` chưa thực thi.
15. C-15: complaint API chưa state machine.
16. C-16/C-17: pagination và reservation expiry chưa sửa.
17. RBAC/staff/partner portal; audit retention/immutability.
18. Metrics/tracing/alerting; deploy/rollback.
19. Mobile trên thiết bị thật; push/FCM.
20. Tính đúng của ảnh hưởng refund đến thuế/phí vận chuyển/chiết khấu.

---

## 10. Quyết định kinh doanh cần phê duyệt

> Các mục dưới đây **chưa được phê duyệt**. Không được tự chọn thay chủ sản phẩm/kế toán/vận hành.

### 10.1. Refund sau settlement — `BUSINESS DECISION REQUIRED`

- Ai chịu khoản refund sau khi đối tác đã được settle: đối tác, nền tảng, hay chia tỷ lệ?
- Thu hồi bằng `DEDUCT_NEXT`, `WRITE_OFF`, `MANUAL`, hay clawback?
- Nếu payout đã `PAID`, có clawback không? Thời hạn?
- Có lãi/phạt/ngưỡng tối thiểu?
- Ai phê duyệt? Adjustment có hiển thị trên sao kê đối tác?
- Hiện hệ thống chỉ chặn chi tiền khi adjustment `OPEN`; **chưa thực thi** phương án thu hồi.

### 10.2. Commission khi refund

- Có hoàn commission theo tỷ lệ refund không?
- Hoàn ở kỳ nào, có adjustment riêng không?
- Nếu không, đối tác chịu commission trên doanh thu đã hoàn — có chấp nhận?

### 10.3. Kỳ settlement

- Settlement theo ngày đặt, ngày giao, hay ngày thu tiền?
- Đơn tạo kỳ trước giao kỳ sau thuộc kỳ nào?
- COD thu muộn thuộc kỳ nào?

### 10.4. COD

- Ai được xác nhận thu COD? Admin hiện tại.
- Bắt buộc bằng chứng gì (biên nhận/ảnh/mã giao dịch)?
- Đối soát với carrier theo ngày/tuần?
- Có cho xác nhận một phần không?

### 10.5. Return/refund policy

- Cửa sổ trả hàng bao lâu?
- Hoàn tiền qua kênh nào (tiền mặt/chuyển khoản/credit)?
- Có hoàn phí vận chuyển/chiết khấu/thuế không?
- Refund cap theo giá trị hàng hoàn hay theo số đã thanh toán? (Code hiện cap theo paid.)

### 10.6. Vận hành và hạ tầng

- RPO/RTO/retention/offsite/encryption owner.
- Ai giữ secret và quy trình rotate?
- Có chấp nhận COD-only cho MVP không?
- Có cần RBAC/staff/partner portal trước go-live không?
- Lịch nâng `next@16.4.1` và người chịu trách nhiệm.

### 10.7. Complaint

- Có cần state machine backend cho complaint trước go-live không?
- Ai được đóng complaint, có bắt buộc resolution/evidence không?

---

## 11. Go-live gate G1 → G15

| Gate | Nội dung | Trạng thái | Ghi chú |
|---|---|---|---|
| G1 | JWT fail-closed, secret mạnh, rotate | **PARTIALLY COMPLETE** | Code fixed; rotate chưa làm |
| G2 | CI bắt buộc, xanh trên commit release | **NOT VERIFIED** | Chưa chạy remote |
| G3 | Migration parity + backup/restore | **PARTIALLY COMPLETE** | Test DB 12/12; backup local; RPO/RTO chưa duyệt |
| G4 | Shipment/order invariant | **PASS local** | C-02/C-13 verified fixed |
| G5 | Return/refund ownership + state | **PARTIALLY COMPLETE** | C-05/C-06/C-15 còn gap |
| G6 | Quarantine/QC lifecycle | **PASS local** | C-04/C-07 verified fixed |
| G7 | Settlement/COD/refund | **PARTIALLY COMPLETE** | C-08 + business decision |
| G8 | Pricing | **PASS local** | C-09 verified fixed |
| G9 | Trace chain | **PARTIALLY COMPLETE** | C-14 |
| G10 | Dữ liệu public | **PARTIALLY COMPLETE** | C-10 fixed; C-11 thiếu test |
| G11 | Playwright UI E2E critical | **NOT VERIFIED** | Không có bộ test |
| G12 | SMTP/notification | **NOT VERIFIED** | Mail capture |
| G13 | Vận hành: metrics/alert/audit/RBAC | **PARTIALLY COMPLETE** | Audit viewer có; còn lại thiếu |
| G14 | UAT dữ liệu giống thật | **NOT VERIFIED** | Chưa thực hiện |
| G15 | Quyết định nghiệp vụ | **BUSINESS DECISION REQUIRED** | Mục 10 |

---

## 12. Kết luận và điều kiện bàn giao

### 12.1. Phán quyết

**NO-GO cho bán hàng thật.** Hệ thống có thể dùng cho **demo/UAT nội bộ với dữ liệu giả lập**, không xử lý tiền thật, không nhận đơn thật, không tuyên bố production-ready.

Đây không phải đánh giá “hệ thống kém”. Nhiều lỗi P0 nghiêm trọng đã được sửa và có bằng chứng chạy thật. Nhưng các điều kiện release gate vẫn thiếu: CI remote, UI E2E, refund-after-settlement policy, complaint state machine, reservation expiry, SMTP/payment thật, backup offsite, observability và RBAC.

### 12.2. Điều kiện tối thiểu trước khi xem xét lại

1. **CI remote xanh** trên đúng commit release + branch protection.
2. **Chốt và thực thi chính sách refund-after-settlement** (kể cả clawback/commission).
3. **Đóng C-05/C-06/C-15**: cap refund theo giá trị hàng hoàn, bỏ nhập tay `refundId`, state machine complaint.
4. **Nâng `next@16.4.1`** tối thiểu, chạy lại toàn bộ test/build.
5. **Backup offsite + restore drill production-size**, RPO/RTO được ký duyệt.
6. **Playwright UI E2E** cho COD/cancel/return/refund/settlement.
7. **SMTP/payment/carrier sandbox** nếu cam kết các tính năng đó.
8. **Metrics/alerting + RBAC + deploy/rollback runbook**.
9. **Rotate credential** trước khi mở môi trường thật.

### 12.3. Bàn giao

- Toàn bộ thay đổi vẫn **chưa commit, chưa push, chưa deploy**.
- HEAD không đổi: `5b35b974bae65f308cfdce3ab23a6aec959f2916`.
- Không có migration/sửa dữ liệu trên development/production.
- Báo cáo 15–21 là bằng chứng local; không thay thế kiểm thử remote/UAT.
- Các quyết định tại mục 10 phải được chủ sản phẩm/kế toán/vận hành phê duyệt bằng văn bản trước khi go-live.
