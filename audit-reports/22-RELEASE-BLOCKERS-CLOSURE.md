# 22 — RELEASE BLOCKERS CLOSURE

**Dự án:** AgriMarket V2 — nền tảng bán nông sản tích hợp truy xuất nguồn gốc  
**Commit nền:** `5b35b974bae65f308cfdce3ab23a6aec959f2916`  
**Branch:** `fix/p0-a-security-pricing`  
**Ngày nghiệm thu:** 24/10/2026  
**Bằng chứng:** `.tmp-verify/release-blockers/`  
**Kết luận điều hành:** Các lỗi C-16/C-17 và 6 khoảng trống code thuộc C-05/C-06/C-11/C-12/C-15/C-18 đã được đóng ở phạm vi local. C-08, C-14 và C-19 vẫn **PARTIALLY COMPLETE** vì phụ thuộc quyết định nghiệp vụ hoặc hạ tầng chưa được kiểm chứng. Hệ thống vẫn **NO-GO cho production**, nhưng đủ điều kiện để **commit local có kiểm soát**.

---

## 1. Tóm tắt điều hành

Đợt này xử lý đúng các blocker được giao, không mở rộng sang refactor lớn:

| Nhóm | Kết quả |
|---|---|
| C-16 — client cắt danh sách trang đầu | **CLOSED (local)** — web/mobile dùng infinite query và nút “Xem thêm”; picker cũng phân trang |
| C-17 — không có job hết hạn reservation | **CLOSED (local)** — TTL, migration, scheduler, safe cancellation, test E2E |
| C-05/C-06 — refund vượt giá trị hàng hoàn; nhập tay `refundId` | **CLOSED (local)** — cap theo `quantity × unitPriceSnapshot`, endpoint eligible-refunds, Admin dropdown |
| C-11 — product INACTIVE vẫn public | **CLOSED (local)** — public list/detail chỉ ACTIVE, có regression test |
| C-12 — copy/Swagger/comment COD sai | **CLOSED (local)** — Swagger và các comment còn sót đã sửa |
| C-15 — complaint không có state machine | **CLOSED (local)** — state machine, resolution bắt buộc, CAS 409 |
| C-18 — mail production capture | **CLOSED (local code gap)** — fail-fast khi production thiếu SMTP; chưa test SMTP thật |
| C-08 — refund sau settlement/clawback | **PARTIALLY COMPLETE + BUSINESS DECISION REQUIRED** |
| C-14 — trace authoring/8 event | **PARTIALLY COMPLETE** |
| C-19 — CI/observability/RBAC/deploy | **PARTIALLY COMPLETE + NOT VERIFIED** |
| Next.js `16.4.0` → `16.4.1` | **DONE** — chỉ `next` và `eslint-config-next`, lockfile chỉ đổi họ Next |

**Bằng chứng chính:** API unit `564/564`, API E2E `449/449` chạy 4 lần, concurrency `53/53` trong 30 vòng, Admin `44/44`, Customer `37/37`, Mobile `175 pass + 3 skip`, Shared domain `65/65`, DB invariant `13/13 = 0`, migration test DB `13/13 up to date`, security smoke PASS, `git diff --check` exit 0.

**Không tuyên bố:** không có remote CI xanh, không có branch protection, không có Playwright UI E2E, không có SMTP/payment/carrier thật, không có restore production-size, không có UAT dữ liệu thật. Đây là nghiệm thu local trên test DB cô lập.

---

## 2. Git, checkpoint và trạng thái làm việc

### 2.1. Checkpoint trước khi sửa

| Hạng mục | Giá trị |
|---|---|
| Đường dẫn | `C:\Users\Lai Van Nha\AppData\Local\Temp\agrimarket-checkpoints\release-blockers-20261024-075930` |
| File được đóng gói/đối chiếu | 115 |
| SHA-256 snapshot | `F29CE6A92F27E49623C1A2BA9B9AF3F8B49611F3733AE266A5F1353A5ABD3B1D` |
| Mismatch sau giải nén | 0 |
| Thời điểm | 24/10/2026 08:00 (trước các sửa đổi của đợt này) |

Checkpoint nằm ngoài repo, không bị `git clean` hoặc thao tác worktree nào chạm tới. File `00-baseline.txt` ghi lại HEAD, đường dẫn checkpoint, hash và trạng thái test DB.

### 2.2. Trạng thái hiện tại

| Hạng mục | Giá trị |
|---|---|
| HEAD | `5b35b974bae65f308cfdce3ab23a6aec959f2916` (không đổi) |
| Branch | `fix/p0-a-security-pricing` |
| Tracked file thay đổi | 88 |
| Untracked entry | 35 (gồm report, test mới, CI, script backup/security, migration mới) |
| Diff tracked | 5.419 dòng thêm / 952 dòng xoá |
| Commit/push/merge/deploy | **Không thực hiện** |
| Migration ngoài test DB | **Không thực hiện** |

Các thay đổi của đợt này không ghi đè hoặc xoá công việc cũ. Report 14–21, các fix P0-A/B/C/D và toàn bộ test trước đó vẫn còn trong worktree. Không có `git reset`, `git clean`, `git checkout --`, commit, push, merge hay deploy.

### 2.3. Phạm vi thay đổi của đợt này

Ngoài các file đã có từ các vòng trước, đợt này chủ yếu chạm:

- API: `returns`, `payments`, `complaints`, `orders`, `mail`, `config`, `schema.prisma`, migration reservation expiry.
- Admin: return/complaint dialog, settlement-adjustment tab, types/resources/query keys/status map.
- Customer Web: return/complaint/review lists và eligible pickers.
- Mobile: orders/returns/complaints/reviews, các form picker, product-detail reviews.
- Test: `release-blockers.e2e-spec.ts`, `order-reservation-expiry.spec.ts`, `complaint-lifecycle.spec.ts`, `product-visibility.spec.ts`, `release-blockers-ui.spec.tsx`, cập nhật `refund.spec.ts`, `mail.spec.ts`, `mutation-acceptance.e2e-spec.ts`.
- Dependency: `apps/admin-web/package.json`, `apps/customer-web/package.json`, `package-lock.json`.

Danh sách đầy đủ theo Git nằm ở `git status` và `git diff --stat`; report này không liệt kê toàn bộ 88 file tracked để tránh biến thành bản sao của diff.

---

## 3. Môi trường, phương pháp và giới hạn

### 3.1. Môi trường

| Hạng mục | Giá trị |
|---|---|
| Test DB | `agrimarket_v2_test` (lấy từ `TEST_DATABASE_URL` trong `apps/api/.env`) |
| Development DB | Không migrate, không sửa dữ liệu |
| Production DB | Không migrate, không sửa dữ liệu |
| API | NestJS, Prisma, MySQL |
| Web | Next.js 16.4.1 (Admin/Customer) |
| Mobile | Expo/React Native |
| Node/npm | Node hiện hành của máy; npm workspace, lockfile hiện có |

Không in credential, connection string đầy đủ hoặc mật khẩu tài khoản demo trong report này.

### 3.2. Cách làm cho từng lỗi

1. Đọc Report 14–21 và xác nhận lại mô tả lỗi trong code.
2. Viết test hồi quy trước khi sửa (unit hoặc E2E, tùy tầng).
3. Sửa tối thiểu ở backend/frontend, giữ nguyên contract cũ nếu có thể.
4. Kiểm tra DB sau test: invariant, migration, row-level evidence.
5. Với tiền/tồn kho/trạng thái: chạy test concurrency hoặc CAS, không chỉ test tuần tự.
6. Lưu log, exit code, kiểm tra `git diff --check`, không xoá test và không nới assertion.

### 3.3. Giới hạn

- Test chạy local trên Windows; không phải Linux container production.
- Không có Playwright/UI E2E tự động cho các luồng mới.
- Mobile test là unit/component, không phải thiết bị thật.
- DB invariant audit chỉ đọc test DB, không chứng minh dữ liệu production sạch.
- Concurrency 30 vòng được chạy trong phiên; log lưu vòng cuối (`53/53`), không có file log riêng cho từng vòng.
- Không có remote CI, không có UAT, không có backup/restore production-size.

---

## 4. C-16 — client cắt danh sách trang đầu

### 4.1. Trước khi sửa

Các màn hình khách hàng gọi một trang duy nhất và bỏ phần còn lại:

- Customer Web: return/complaint/review list dùng `page: 1`, `limit: 100`; eligible picker dùng `page: 1`, `limit: 30`.
- Mobile: orders/returns/complaints/reviews dùng `page: 1`; một số picker dùng `limit: 30`; product-detail reviews chỉ lấy trang đầu.
- Không có nút tải thêm, không có `hasNextPage`, không hiển thị “đang hiển thị X/Y”.
- Hệ quả: khách có hơn 20/30/100 bản ghi chỉ thấy trang đầu, tưởng dữ liệu đã hết.

### 4.2. Sau khi sửa

- Customer Web dùng `useInfiniteQuery`:
  - danh sách return/complaint/review: page size 20;
  - eligible return/review/order picker: page size 30 (giữ khả năng resolve deep link cũ);
  - nút “Xem thêm”, `isFetchingNextPage`, `getNextPageParam` theo `meta.page < meta.totalPages`;
  - hiển thị `Hiển thị X/Y` khi còn dữ liệu.
- Mobile dùng `useInfiniteQuery` cho orders, returns, complaints, my reviews; các form picker cũng tải thêm; product-detail reviews dùng page size 10 và nút “Xem thêm đánh giá”.
- Query key có biến thể `infinite`/`eligibleInfinite` để không trộn cache với query cũ.
- Khi deep link trỏ tới item chưa nằm trong trang đầu, UI hiển thị gợi ý bấm “Xem thêm” thay vì im lặng không tìm thấy.

### 4.3. File chính

- `apps/customer-web/src/components/order/ReturnListView.tsx`
- `apps/customer-web/src/components/order/ComplaintListView.tsx`
- `apps/customer-web/src/components/order/ReviewListView.tsx`
- `apps/customer-web/src/lib/api/query-keys.ts`
- `apps/mobile/app/orders.tsx`
- `apps/mobile/app/returns.tsx`, `returns-new.tsx`
- `apps/mobile/app/complaints.tsx`, `complaints-new.tsx`
- `apps/mobile/app/my-reviews.tsx`, `my-reviews-new.tsx`
- `apps/mobile/app/product/[id].tsx`

### 4.4. Bằng chứng và trạng thái

- Customer Web: typecheck, lint, unit `37/37`, build PASS trên Next 16.4.1.
- Mobile: typecheck, lint, unit `175 pass / 3 skip` (tổng 178; 3 skip có sẵn, không thêm skip mới).
- Không có component test riêng cho infinite list; không có Playwright UI E2E.
- **C-16: CLOSED ở phạm vi code + build + unit local.** Giới hạn UI E2E được ghi ở mục 15.

---

## 5. C-17 — job hết hạn reservation

### 5.1. Trước khi sửa

- `Order` không có `reservationExpiresAt`.
- Không có TTL, không có scheduler, không có sweep.
- Checkout reserve tồn kho rồi để `PENDING_CONFIRMATION` vô thời hạn nếu khách đóng tab.
- Tồn kho bị giữ mãi; không có cách phân biệt “đơn đang chờ” với “đơn bị bỏ quên”.

### 5.2. Sau khi sửa

- Thêm `Order.reservationExpiresAt DateTime?` và index `(status, reservationExpiresAt)`.
- Checkout ghi deadline ngay khi tạo đơn, dùng `ORDER_RESERVATION_TTL_MINUTES`.
- Giá trị mặc định đề xuất: 30 phút; giá trị không hợp lệ làm API fail-fast khi khởi động.
- `OrderReservationExpiryService`:
  - `setInterval` nội bộ, không thêm `@nestjs/schedule`;
  - interval = `min(TTL, 60 giây)`, timer `unref()` và clear trong `onModuleDestroy`;
  - `sweep()` public cho test/ops, batch 100, lỗi một row không làm dừng batch.
- `OrdersService.expireReservation(id, now)`:
  - chỉ xử lý `PENDING_CONFIRMATION`;
  - bỏ qua nếu chưa tới hạn, đã có payment PAID/PARTIALLY_REFUNDED/REFUNDED, hoặc đã có shipment;
  - hủy qua đúng `applyStatusChange`/CAS cũ, không viết đường tắt;
  - trả `NOT_FOUND`, `NOT_PENDING`, `NOT_DUE`, `PAID`, `SHIPMENT`, `RACED` thay vì ném lỗi cho các trường hợp bình thường;
  - audit action `ORDER_RESERVATION_EXPIRED`;
  - status transition xóa `reservationExpiresAt`.
- Migration additive: existing rows nhận `NULL` và không bị sweep.

### 5.3. Test

- `apps/api/test/business-rules/order-reservation-expiry.spec.ts`: 14 test cho policy, parse env, fail-closed, interval, các nhánh skip, CAS race, sweep lỗi.
- `apps/api/test/release-blockers.e2e-spec.ts`: 1 test E2E hủy đơn quá hạn và release reservation đúng một lần.
- Full API E2E `449/449` bốn lần.
- DB invariant `negative_balances = 0`.

### 5.4. Trạng thái và residual

- **C-17: CLOSED ở phạm vi bug được giao.**
- TTL cuối cùng vẫn là **BUSINESS DECISION REQUIRED** (đề xuất 30 phút).
- Lần sweep đầu tiên trễ một interval; đơn có thể bị hủy muộn tối đa khoảng `TTL + interval`.
- Không có distributed lock; nhiều instance cùng sweep là an toàn nhờ CAS nhưng có thể tạo query trùng. Chưa test multi-instance.

---

## 6. Chín mục PARTIALLY COMPLETE của Report 21

Report 21 ghi 9 mục PARTIALLY COMPLETE: C-05, C-06, C-08, C-11, C-12, C-14, C-15, C-18, C-19. Kết quả đợt này:

| Mã | Trước đây | Đã làm trong đợt này | Trạng thái hiện tại | Residual |
|---|---|---|---|---|
| **C-05** | Return thiếu state machine; `refundId` tùy ý; refund chỉ cap theo paid | Return state machine; refund cap theo `quantity × unitPriceSnapshot`; kiểm tra same order, COMPLETED, không link return khác, quarantine đã xử lý; unique index | **CLOSED (local)** | Chưa có UI E2E; chính sách refund sau settlement vẫn mở |
| **C-06** | UI refund chưa có; dialog return nhập tay `refundId`; refund COMPLETED ngay | Refund lifecycle PENDING→APPROVED→COMPLETED/FAILED đã có; thêm `GET /returns/:id/eligible-refunds`; Admin dùng dropdown, không nhập ID; có 4 component test cho dropdown/terminal complaint/adjustment | **CLOSED (local)** | Hoàn tiền COD vẫn thủ công; kênh hoàn tiền là business decision |
| **C-08** | Settlement bỏ refund; adjustment chưa có UI; chưa có clawback | UI tab “Điều chỉnh đối soát” đọc `GET /settlement-adjustments`, review qua `POST /settlement-adjustments/:id/review`; OPEN chặn confirm/payout; settlement gốc không bị sửa | **PARTIALLY COMPLETE** | `DEDUCT_NEXT` chưa được thực thi tự động; chưa có clawback/commission refund; cần business decision |
| **C-11** | Product INACTIVE vẫn public; thiếu test hồi quy | Public list/detail chỉ ACTIVE; route ADMIN riêng; test product-visibility 4 test + E2E C-11 | **CLOSED (local)** | Không còn gap code đã biết |
| **C-12** | Swagger/comment COD sai | Sửa Swagger `PATCH /orders/:id/status`; sửa các comment còn sót trong `orders.service.ts`; copy Customer/Mobile đã đúng | **CLOSED (local)** | Không còn câu “DELIVERED settles COD” trong source |
| **C-14** | Thiếu event/authoring UI; chưa chứng minh chuỗi 8 event | Không thêm code trong đợt này | **PARTIALLY COMPLETE** | Authoring UI harvest/farming và bằng chứng chuỗi 8 event vẫn thiếu |
| **C-15** | Complaint API nhận mọi status | State machine `OPEN→PROCESSING→RESOLVED/REJECTED`, `OPEN→REJECTED`; terminal bắt buộc resolution; CAS 409; Admin form bắt buộc resolution khi chọn terminal | **CLOSED (local)** | Ai được đóng complaint / evidence bắt buộc vẫn là policy |
| **C-18** | Mail mặc định capture; production không fail-fast | Production yêu cầu SMTP + host, nếu không API fail-fast; test 13 case | **CLOSED (local code gap)** | Chưa test SMTP thật/retry/alert |
| **C-19** | Thiếu CI/backup/observability/RBAC | CI file, security smoke, backup/restore drill, audit viewer đã có từ trước | **PARTIALLY COMPLETE** | Remote CI, branch protection, metrics/alerting, RBAC, deploy/rollback, offsite/RPO/RTO chưa xác minh |

**Đọc bảng:** 8 mục đã đóng ở phạm vi code local (C-05, C-06, C-11, C-12, C-15, C-18, cộng C-16/C-17 ở mục 4–5). 3 mục vẫn mở một phần (C-08, C-14, C-19). Không có mục nào được đánh dấu “production ready”.

### 6.1. C-05/C-06 — refund theo giá trị hàng hoàn

- `POST /refunds` nhận `returnRequestId` tùy chọn; nếu có, return phải `QC_PENDING`, cùng order, chưa có refund, và `amount <= quantity × unitPriceSnapshot`.
- `PATCH /returns/:id` khi chuyển `REFUNDED` kiểm tra lại: refund `COMPLETED`, cùng order, không link return khác, cap theo giá trị hàng hoàn, tất cả quarantine case đã `RELEASED`/`SCRAPPED`.
- Unique index trên `return_requests.refund_id` là chốt DB cuối cùng.
- `GET /returns/:id/eligible-refunds` trả `returnValue` và danh sách refund COMPLETED hợp lệ; Admin chỉ chọn từ danh sách này.
- API vẫn giữ `refundId` để tương thích, nhưng không còn tin giá trị client gửi lên.

### 6.2. C-08 — adjustment review nhưng chưa thực thi thu hồi

- UI mới cho phép ADMIN xem adjustment `OPEN`, chọn `DEDUCT_NEXT` / `WRITE_OFF` / `MANUAL` và nhập note bắt buộc.
- Review chỉ ghi nhận quyết định; **không tự trừ kỳ sau, không tự clawback, không sửa settlement gốc**.
- Khi adjustment còn `OPEN`, confirm settlement/payout/mark-paid bị chặn. Đây là trạng thái an toàn: hệ thống không thể chi tiền khi khoản hoàn chưa được xử lý.
- Chính sách ai chịu khoản refund sau settlement và cách thu hồi vẫn là **BUSINESS DECISION REQUIRED**.

### 6.3. C-14 — trace vẫn thiếu authoring/8 event

- Các event đóng gói/xuất kho/hoàn hàng đã có từ các vòng trước.
- Chưa có UI authoring harvest/farming đầy đủ.
- Chưa có bằng chứng chuỗi 8 event end-to-end.
- Không tuyên bố C-14 đã đóng.

### 6.4. C-19 — hạ tầng vẫn là local artifact

- `.github/workflows/ci.yml`, `scripts/security-smoke.mjs`, `scripts/backup-db.mjs`, `scripts/restore-db.mjs`, `docs/BACKUP-RESTORE-RUNBOOK.md` tồn tại.
- Chưa chạy CI remote; chưa có branch protection/required checks.
- Chưa có Playwright UI E2E, metrics/alerting, RBAC chi tiết, deploy/rollback.
- Backup/restore mới là drill local; chưa có offsite, encryption, RPO/RTO được duyệt.

---

## 7. Quyết định kinh doanh cần phê duyệt

> Các mục dưới đây **chưa được phê duyệt**. Hệ thống không tự chọn thay chủ sản phẩm/kế toán/vận hành.

### 7.1. Refund sau settlement, clawback và commission — `BUSINESS DECISION REQUIRED`

- Ai chịu khoản refund sau khi đối tác đã được settle: đối tác, nền tảng, hay chia tỷ lệ?
- Thu hồi bằng `DEDUCT_NEXT`, `WRITE_OFF`, `MANUAL`, hay clawback?
- Nếu payout đã `PAID`, có clawback không? Thời hạn và lãi/phạt?
- Có hoàn commission theo tỷ lệ refund không? Hoàn ở kỳ nào?
- Ai phê duyệt adjustment, và adjustment có hiển thị trên sao kê đối tác?
- **Hiện trạng an toàn:** adjustment `OPEN` chặn confirm/payout; chưa có tự động thu hồi.

### 7.2. Kỳ settlement — `BUSINESS DECISION REQUIRED`

- Settlement theo ngày đặt, ngày giao, hay ngày thu tiền?
- Đơn tạo kỳ trước giao kỳ sau thuộc kỳ nào?
- COD thu muộn thuộc kỳ nào?

### 7.3. COD — `BUSINESS DECISION REQUIRED`

- Ai được xác nhận thu COD? Hiện tại ADMIN.
- Bắt buộc bằng chứng gì: biên nhận, ảnh, mã giao dịch?
- Đối soát với carrier theo ngày/tuần?
- Có cho xác nhận thu một phần không?

### 7.4. Return/refund policy — `BUSINESS DECISION REQUIRED`

- Cửa sổ trả hàng bao lâu?
- Hoàn tiền qua kênh nào: tiền mặt, chuyển khoản, credit?
- Có hoàn phí vận chuyển/chiết khấu/thuế không?
- Refund cap theo giá trị hàng hoàn hay số đã thanh toán? Code hiện áp **cả hai**: không vượt giá trị hàng hoàn và không vượt số đã thanh toán.

### 7.5. Reservation TTL — `BUSINESS DECISION REQUIRED`

- TTL cuối cùng là bao nhiêu phút? Đề xuất hiện tại: 30.
- Có khác nhau theo phương thức thanh toán/khu vực/khung giờ không?
- Có cần thông báo cho khách trước khi hủy tự động không?

### 7.6. Vận hành, backup, credential — `BUSINESS DECISION REQUIRED`

- RPO/RTO, retention, offsite, encryption owner.
- Ai giữ secret và quy trình rotate JWT/DB/SMTP.
- Có chấp nhận COD-only cho MVP không?
- Có cần RBAC/staff/partner portal trước go-live không?

### 7.7. Complaint — `BUSINESS DECISION REQUIRED`

- Ai được đóng complaint?
- Có bắt buộc evidence ảnh/tài liệu khi `RESOLVED`/`REJECTED` không?
- SLA xử lý và thời hạn khách phản hồi?

**Nguyên tắc:** không có quyết định nào ở trên được tự động “đoán” trong code. Các chỗ có thể gây bất biến tài chính đang bị chặn hoặc yêu cầu ADMIN + reference/note.

---

## 8. Nâng cấp Next.js 16.4.1

### 8.1. Thay đổi

| Gói | Trước | Sau | Phạm vi |
|---|---|---|---|
| `next` (Admin) | `16.4.0` | `16.4.1` | patch |
| `eslint-config-next` (Admin) | `16.4.0` | `16.4.1` | patch |
| `next` (Customer) | `16.4.0` | `16.4.1` | patch |
| `eslint-config-next` (Customer) | `16.4.0` | `16.4.1` | patch |

- Lockfile đổi 51 dòng thêm / 51 dòng xoá; chỉ các entry `next`, `@next/*`, `eslint-config-next` đổi version/integrity.
- `npm ls next eslint-config-next --depth=0` xác nhận cả hai workspace dùng `16.4.1`, được dedupe.
- Không nâng major, không nâng blanket toàn bộ dependency.

### 8.2. Kiểm tra sau nâng cấp

| Bộ | Kết quả |
|---|---|
| Admin typecheck | PASS |
| Admin lint | PASS |
| Admin unit | `44/44` |
| Admin build | PASS, Next 16.4.1, không còn `SecurityFatalError` |
| Customer typecheck | PASS |
| Customer lint | PASS |
| Customer unit | `37/37` |
| Customer build | PASS, Next 16.4.1, không còn `SecurityFatalError` |

`SecurityFatalError` từng xuất hiện ở các build 16.4.0 trước đây; build cuối trên 16.4.1 không còn. Đây là build local, không phải bằng chứng runtime production.

### 8.3. Audit dependency

`npm audit` hiện còn **29 lỗ hổng: 12 moderate, 17 high, 0 critical**. Next.js **không còn** trong danh sách vulnerability. Một số fix là non-major nhưng nằm ngoài phạm vi patch-only được giao; không blanket-fix, không tuyên bố audit sạch. Chi tiết ở mục 14.

---

## 9. File thay đổi chính

### 9.1. Backend API

- `apps/api/prisma/schema.prisma`: `reservationExpiresAt`, index, quan hệ refund/return/quarantine/adjustment.
- `apps/api/prisma/migrations/20261024000000_order_reservation_expiry/migration.sql`: migration additive.
- `apps/api/src/orders/order-reservation-expiry.service.ts`: scheduler/sweep mới.
- `apps/api/src/orders/reservation-policy.ts`: TTL/interval resolver mới.
- `apps/api/src/orders/orders.service.ts`: ghi deadline, clear deadline, `expireReservation`, comment COD đã sửa.
- `apps/api/src/orders/orders.module.ts`: đăng ký service.
- `apps/api/src/orders/orders.controller.ts`: Swagger COD đã sửa.
- `apps/api/src/returns/returns.service.ts`: cap theo giá trị hàng hoàn, state machine, eligible-refunds, receipt/quarantine.
- `apps/api/src/returns/returns.controller.ts`, `dto/return.dto.ts`: endpoint và validation.
- `apps/api/src/payments/payments.service.ts`, `payments.controller.ts`, `dto/payment.dto.ts`: refund lifecycle, `returnRequestId`, cap, reference, adjustment.
- `apps/api/src/complaints/complaints.service.ts`: state machine + resolution + CAS.
- `apps/api/src/mail/mail.service.ts`: production fail-fast.
- `apps/api/src/config/configuration.ts`: TTL config.
- `apps/api/.env.example`: `ORDER_RESERVATION_TTL_MINUTES=30`.

### 9.2. Admin Web

- `apps/admin-web/src/app/(admin)/returns-complaints/page.tsx`: dropdown refund hợp lệ; complaint resolution bắt buộc khi terminal.
- `apps/admin-web/src/app/(admin)/settlements/page.tsx`: tab “Điều chỉnh đối soát” + review dialog.
- `apps/admin-web/src/lib/api/resources.ts`, `lib/query/keys.ts`, `lib/status/index.ts`, `types/api.ts`: contract/types/status cho refund, adjustment, shipment, audit.
- `apps/admin-web/package.json`: Next 16.4.1.

### 9.3. Customer Web

- `apps/customer-web/src/components/order/ReturnListView.tsx`
- `apps/customer-web/src/components/order/ComplaintListView.tsx`
- `apps/customer-web/src/components/order/ReviewListView.tsx`
- `apps/customer-web/src/lib/api/query-keys.ts`
- `apps/customer-web/package.json`

### 9.4. Mobile

- `apps/mobile/app/orders.tsx`
- `apps/mobile/app/returns.tsx`, `returns-new.tsx`
- `apps/mobile/app/complaints.tsx`, `complaints-new.tsx`
- `apps/mobile/app/my-reviews.tsx`, `my-reviews-new.tsx`
- `apps/mobile/app/product/[id].tsx`
- `apps/mobile/src/lib/types.ts`

### 9.5. Test và tài liệu

- `apps/api/test/release-blockers.e2e-spec.ts`
- `apps/api/test/business-rules/order-reservation-expiry.spec.ts`
- `apps/api/test/business-rules/complaint-lifecycle.spec.ts`
- `apps/api/test/business-rules/product-visibility.spec.ts`
- `apps/api/test/business-rules/refund.spec.ts`, `mail.spec.ts`
- `apps/api/test/mutation-acceptance.e2e-spec.ts`
- `apps/admin-web/test/release-blockers-ui.spec.tsx`
- `audit-reports/22-RELEASE-BLOCKERS-CLOSURE.md` (report này)

### 9.6. Dependency

- `package-lock.json`
- `apps/admin-web/package.json`
- `apps/customer-web/package.json`

---

## 10. Migration và DB invariant

### 10.1. Migration

- Tổng số migration: **13**.
- Migration mới: `20261024000000_order_reservation_expiry`.
- Nội dung:
  - `ALTER TABLE orders ADD COLUMN reservation_expires_at DATETIME(3) NULL`;
  - `CREATE INDEX orders_status_reservation_expires_at_idx ON orders(status, reservation_expires_at)`.
- Additive, không viết lại dữ liệu cũ; row cũ có `NULL` nên không bị sweep.
- Đã apply trên `agrimarket_v2_test`; `prisma migrate status` báo `13 migrations found`, `Database schema is up to date`.
- **Không apply trên development/staging/production.**

### 10.2. DB invariant audit

Chạy read-only trên test DB sau test:

```json
{
  "negative_balances": 0,
  "bad_refunded_returns": 0,
  "refunded_without_quarantine": 0,
  "duplicate_refund_links": 0,
  "refund_over_returned_goods_value": 0,
  "return_refund_wrong_order": 0,
  "terminal_complaints_without_resolution": 0,
  "shipment_order_mismatch": 0,
  "open_adjustments": 0,
  "warehouse_return_without_quarantine": 0,
  "quarantine_blocked_mismatch": 0,
  "refund_over_payment": 0,
  "payout_over_settlement": 0
}
```

Kết quả: `ALL_INVARIANTS_ZERO`.

Ba invariant mới của đợt này là `refund_over_returned_goods_value`, `return_refund_wrong_order`, `terminal_complaints_without_resolution`. Việc tất cả bằng 0 chỉ chứng minh test DB hiện tại không có vi phạm; không chứng minh dữ liệu production sạch.

### 10.3. Dữ liệu test

- Fixture test còn lại trong `agrimarket_v2_test` là dữ liệu test có chủ đích.
- Không xoá schema, không reset DB, không seed lại development/production.
- Không có migration/sửa dữ liệu ngoài test DB.

---

## 11. Thay đổi hợp đồng API

### 11.1. Endpoint mới

`GET /api/v1/returns/:id/eligible-refunds` — ADMIN:

- Trả `returnRequestId`, `returnValue` (string), `data[]`.
- Mỗi refund gồm `id`, `paymentId`, `amount`, `reference`, `completedAt`, `payment.method/status`, `linkedToThisReturn`.
- Chỉ trả refund `COMPLETED`, cùng order, chưa link return khác, `amount <= returnValue`.
- Danh sách chỉ là gợi ý; `PATCH /returns/:id` kiểm tra lại toàn bộ.

### 11.2. Endpoint thay đổi hành vi

| Endpoint | Thay đổi |
|---|---|
| `POST /api/v1/refunds` | Nhận `returnRequestId` tùy chọn; tạo refund `PENDING`; cap theo paid + giá trị hàng hoàn; kiểm tra same order/QC_PENDING/chưa có refund |
| `PATCH /api/v1/returns/:id` | State machine; `refundId` phải COMPLETED, same order, không link return khác, cap theo giá trị hàng hoàn, quarantine đã xử lý; lỗi 400/404/409 |
| `PATCH /api/v1/complaints/:id` | State machine; terminal bắt buộc resolution; transition sai 400; CAS thua 409 |
| `PATCH /api/v1/orders/:id/status` | Swagger sửa: DELIVERED không mark COD PAID; behavior không đổi |
| `GET /api/v1/settlement-adjustments` | UI Admin mới tiêu thụ; contract không đổi |
| `POST /api/v1/settlement-adjustments/:id/review` | UI Admin mới tiêu thụ; resolution + note bắt buộc |

### 11.3. Tương thích

- `refundId` trong `PATCH /returns/:id` vẫn được chấp nhận để không phá client cũ, nhưng mọi giá trị đều bị kiểm tra.
- Các list endpoint giữ nguyên response `{ data, meta }`; C-16 chỉ đổi cách client gọi trang.
- Không thêm endpoint public cho scheduler; cấu hình qua `ORDER_RESERVATION_TTL_MINUTES`.
- Không đổi tên field/status enum hiện có.

### 11.4. Mã lỗi chính

- `400`: transition không hợp lệ, thiếu resolution, refund chưa COMPLETED, refund vượt giá trị hàng hoàn, return chưa QC_PENDING, quarantine chưa xử lý.
- `404`: return/refund/order không tồn tại.
- `409`: refund/return đã bị link, complaint/order đã bị operator khác đổi trạng thái, reservation race.

---

## 12. Thay đổi Admin, Customer Web và Mobile

### 12.1. Admin Web

- **Return dialog:** khi chọn `REFUNDED`, hiển thị dropdown “Giao dịch hoàn tiền” lấy từ eligible-refunds; không còn ô nhập `refundId`. Nếu chưa có refund hợp lệ, UI báo phải hoàn tất refund trước.
- **Complaint dialog:** state machine giống backend; khi chọn `RESOLVED`/`REJECTED`, field “Hướng giải quyết” bắt buộc; các trạng thái terminal không còn action.
- **Settlement:** tab “Điều chỉnh đối soát” hiển thị adjustment OPEN/REVIEWED, refund, settlement, partner order, số tiền, lý do; dialog review chọn resolution + note bắt buộc.
- **Types/resources/query keys:** bổ sung eligible refund, settlement adjustment, status map.
- Đã có 4 component test trong `apps/admin-web/test/release-blockers-ui.spec.tsx` cho dropdown refund, resolution bắt buộc của complaint và tab adjustment; typecheck/lint/unit/build vẫn PASS.

### 12.2. Customer Web

- Return/complaint/review list và eligible picker chuyển sang infinite query.
- Có nút “Xem thêm”, trạng thái loading, tổng số bản ghi.
- Deep link vẫn hoạt động; nếu item nằm ngoài trang đầu, UI hướng dẫn tải thêm.
- Không thay đổi backend contract của các list.

### 12.3. Mobile

- Orders, returns, complaints, my reviews dùng infinite query.
- Form picker (order/returnable/reviewable) tải thêm thay vì chỉ trang đầu.
- Product-detail reviews dùng infinite query, page size 10, nút “Xem thêm đánh giá”.
- Types cập nhật theo response phân trang.
- Test mobile `175 pass / 3 skip`; không chạy trên thiết bị thật.

---

## 13. Kiểm thử và log thô

### 13.1. Tổng hợp một vòng đầy đủ

| Bộ | Kết quả | Log |
|---|---:|---|
| API typecheck | PASS, exit 0 | `42-api-typecheck-final.log` |
| API lint | PASS, exit 0 (3 warning thứ tự import có sẵn) | `43-api-lint-final.log` |
| API build | PASS, exit 0 | `47-api-build-final.log` |
| API unit | **42 file / 564 test PASS** | `01-api-unit.log` |
| API E2E | **19 file / 449 test PASS** | `28-e2e-full-run1..4.log` |
| API E2E exit codes | run1–run4 = 0 | `28-e2e-full-exit-codes.txt` |
| Release-blockers E2E | **7/7 PASS** | `06-e2e-release-blockers.log` |
| Mutation acceptance E2E | **125/125 PASS** | `07-e2e-mutation-acceptance.log` |
| Concurrency 30 vòng | **53/53 PASS** mỗi vòng; log vòng cuối | `29-concurrency-30rounds.log` |
| Admin typecheck | PASS, exit 0 | `51-admin-typecheck-final2.log` |
| Admin lint | PASS, exit 0 | `52-admin-lint-final2.log` |
| Admin unit | **8 file / 44 test PASS**, exit 0 | `53-admin-unit-final2.log` |
| Admin build | PASS, exit 0, Next 16.4.1 | `54-admin-build-final2.log` |
| Customer typecheck | PASS | `19-customer-typecheck-next1641.log` |
| Customer lint | PASS | `20-customer-lint-next1641.log` |
| Customer unit | **3 file / 37 test PASS** | `22-customer-unit-next1641.log` |
| Customer build | PASS, Next 16.4.1 | `24-customer-build-next1641.log` |
| Mobile typecheck | PASS, exit 0 | `35-mobile-typecheck-final.log` |
| Mobile lint | PASS, exit 0 | `36-mobile-lint-final.log` |
| Mobile unit | **18 pass + 1 skip file; 175 pass + 3 skip test** | `37-mobile-unit-final.log` |
| Shared domain typecheck | PASS | `26-shared-typecheck.log` |
| Shared domain unit | **5 file / 65 test PASS** | `27-shared-unit.log` |
| Security smoke | PASS — 5 file | `32-security-smoke.log` |
| Migration status | 13 migration, up to date | `31-migration-status-test-db.log` |
| DB invariant audit | 13/13 = 0 | `30-db-invariant-audit.log` |
| `git diff --check` | exit 0, chỉ warning LF/CRLF | `57-git-diff-check-final2.log` |

Tổng test pass của một vòng chính (không gồm 53 test concurrency lặp 30 vòng, không gồm 4 lần E2E): **564 + 449 + 44 + 37 + 175 + 65 = 1.334**. Mobile còn 3 test skip có sẵn; không thêm skip mới.

### 13.2. So sánh baseline

| Bộ | Baseline | Hiện tại |
|---|---:|---:|
| API unit | 531 | **564** |
| API E2E | 439 | **449** |
| Admin unit | 40 | **44** |
| Customer unit | 37 | **37** |
| Mobile | 178 | **175 pass + 3 skip** (tổng 178) |
| Shared domain | 65 | **65** |

### 13.3. Test hồi quy mới

- C-05/C-06: 5 test E2E refund cap/eligibility/link; 20 test unit refund.
- C-06/C-08/C-15 UI: 4 component test Admin trong `release-blockers-ui.spec.tsx` — dropdown refund (2), complaint terminal bắt buộc resolution (1), review adjustment (1). Log riêng `50-admin-ui-tests.log`; nằm trong full run `53-admin-unit-final2.log`.
- C-11: 4 test unit product visibility + 1 E2E.
- C-15: 8 test unit complaint lifecycle + 3 test E2E mới trong mutation acceptance.
- C-17: 14 test unit reservation + 1 E2E.
- C-18: 13 test mail, gồm production fail-fast.
- C-12: không cần test mới vì chỉ sửa Swagger/comment; behavior COD đã có test từ trước.

### 13.4. Log và checksum

- Toàn bộ log nằm trong `.tmp-verify/release-blockers/`.
- Manifest checksum: `41-SHA256SUMS.txt` — 81 entry, phủ toàn bộ file bằng chứng (trừ chính manifest); SHA-256 của manifest: `EDA3A9A908ED0F813E2785BC1A114ED0F19215FB3CD802CA58935B10356F5BF6`.
- `.tmp-verify` là thư mục git-ignored; không đưa log/secret vào commit.
- Log không chứa mật khẩu hay connection string đầy đủ.

### 13.5. Điều không được coi là bằng chứng

- Unit test PASS không chứng minh UI thật.
- Build PASS không chứng minh runtime production.
- DB invariant 0 trên test DB không chứng minh production sạch.
- CI file hợp lệ không chứng minh CI remote xanh.
- Ảnh chụp/typcheck không thay thế Playwright.
- Log 30 vòng concurrency chỉ lưu vòng cuối; không có log từng vòng.

---

## 14. Security scan và dependency audit

### 14.1. Security smoke

- `npm run security:smoke` PASS, 5 file được kiểm tra (`32-security-smoke.log`).
- `git diff --check` exit 0; chỉ có warning LF/CRLF của Git, không có whitespace error.
- Không commit `.env`, không in credential, checkpoint nằm ngoài repo.
- Không có secret mới trong source.

### 14.2. `npm audit`

- Tổng: **29 lỗ hổng**.
  - 12 moderate
  - 17 high
  - 0 critical
- Next.js **không còn** trong danh sách.
- Ví dụ direct high: `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing`, `expo`, `multer`, `nodemailer`, `prisma`.
- Một số fix là non-major nhưng nằm ngoài phạm vi patch-only; không blanket-fix.
- `npm audit` exit 1 là đúng thiết kế vì còn lỗ hổng; **không** tuyên bố audit sạch.
- Chi tiết JSON: `34-npm-audit.json`.

### 14.3. Chưa xác minh

- Remote CI/branch protection.
- Playwright UI E2E.
- SMTP thật, payment gateway/carrier sandbox.
- RBAC/staff/partner portal.
- Metrics/tracing/alerting.
- Deploy/rollback runbook.
- Backup offsite, encryption, restore production-size, RPO/RTO.
- Rotate JWT/DB/SMTP credential.

---

## 15. Open issues và phán quyết

### 15.1. Open issues

| Ưu tiên | Vấn đề | Trạng thái | Điều kiện đóng |
|---|---|---|---|
| P0 | Refund sau settlement/clawback/commission | **BUSINESS DECISION REQUIRED** | Chính sách bằng văn bản + thực thi/thử nghiệm adjustment |
| P0 | Remote CI + branch protection | **NOT VERIFIED** | Chạy CI trên commit release, bật required checks |
| P0 | Playwright UI E2E critical flows | **NOT VERIFIED** | Bộ test COD/cancel/return/refund/settlement |
| P0 | Backup offsite + restore production-size + RPO/RTO | **NOT VERIFIED** | Drill có đo thời gian, có owner ký duyệt |
| P1 | C-14 trace authoring/8 event | **PARTIALLY COMPLETE** | UI harvest/farming + bằng chứng chuỗi 8 event |
| P1 | C-19 metrics/alerting/RBAC/deploy/rollback | **PARTIALLY COMPLETE** | Hạ tầng thật + runbook + test |
| P1 | Real SMTP/payment/carrier | **NOT VERIFIED** | Sandbox/staging test có log |
| P2 | C-16/C-17 UI E2E | **NOT VERIFIED** | Playwright mobile/web |
| P2 | 29 npm vulnerabilities | **OPEN** | Kế hoạch nâng dependency ngoài patch scope |
| P2 | Reservation TTL cuối | **BUSINESS DECISION REQUIRED** | Chốt số phút + thông báo khách |
| P2 | Mobile 3 test skip | **CÓ SẴN** | Không phải skip mới; xem lại nếu muốn full pass |

### 15.2. Phán quyết riêng

#### Local commit — **GO có điều kiện**

- Toàn bộ kiểm tra local chính PASS; thay đổi được checkpoint bảo vệ; không có dấu hiệu mất công việc.
- Chỉ nên commit sau khi review 88 file tracked + 35 untracked, xác nhận không có secret/log/test DB trong commit, và commit message mô tả đúng phạm vi.
- **Chưa commit.** Đây là phán quyết cho phép commit local, không phải xác nhận đã commit.

#### Merge — **NO-GO**

- Chưa có remote CI, chưa có review độc lập, chưa có branch protection.
- C-08/C-14/C-19 còn mở; chưa có Playwright UI E2E.
- Không merge vào nhánh release/protected khi các điều kiện trên chưa đóng.

#### Staging — **NO-GO**

- Chưa chạy migration trên staging; chưa cấu hình SMTP/payment/carrier staging.
- Chưa có deploy/rollback runbook được diễn tập.
- Chỉ test DB local đã được migrate.

#### UAT — **CONDITIONAL / NO-GO cho UAT đầy đủ**

- Có thể dùng **demo nội bộ với dữ liệu giả lập**, COD-only, không tiền thật.
- UAT đầy đủ bị chặn bởi: quyết định refund-after-settlement, refund channel, COD evidence, SMTP thật, UI E2E, dữ liệu giống production.
- Không tuyên bố UAT đã pass.

#### Production — **NO-GO**

- Không đáp ứng các gate P0: CI remote, backup/restore production, refund-after-settlement policy, RBAC/observability, real integrations.
- Không có migration/rollback production đã diễn tập.
- Không xử lý tiền thật, không nhận đơn thật, không tuyên bố production-ready.

### 15.3. Bàn giao

- Toàn bộ thay đổi vẫn **chưa commit, chưa push, chưa merge, chưa deploy**.
- `apps/admin-web/test/release-blockers-ui.spec.tsx` đang untracked; phải `git add` cùng commit để 44 test Admin có mặt trong lịch sử.
- HEAD không đổi: `5b35b974bae65f308cfdce3ab23a6aec959f2916`.
- Không có migration/sửa dữ liệu trên development/staging/production.
- Không có tài khoản demo/mật khẩu trong report này.
- Báo cáo 14–22 là bằng chứng local; không thay thế CI remote/UAT/production verification.
- Việc tiếp theo trước khi xem xét lại: chốt các quyết định mục 7, chạy CI remote + Playwright, diễn tập backup/restore production-size, và xử lý C-08/C-14/C-19.
