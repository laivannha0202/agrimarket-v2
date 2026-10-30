# 12 - ROUND 4: IDEMPOTENCY + CHECKOUT LOCK-ORDER VERIFICATION

## Tóm tắt: chứng minh retry không còn cộng tiền/tồn hai lần · tái hiện và sửa lock-order checkout `reserveLine` · làm rõ migration settlement · ma trận hồi quy 4 lần full E2E

> **Thông tin audit**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Baseline: commit `90c28de8f773af2b266b96979f9508155e9523fe`; branch `fix/bl-01-02-settlement-con-01`
> - Báo cáo trước: `09-FIX-ROUND-1-VERIFICATION.md`, `10-FIX-ROUND-2-VERIFICATION.md`, `11-ROUND-3-ACCEPTANCE-AND-RISK-REVIEW.md`
> - Ngày xác minh: 2026-10-22 → 2026-10-23 (Asia/Ho_Chi_Minh)
> - DB ghi dữ liệu/test: **chỉ** `agrimarket_v2_test` qua `TEST_DATABASE_URL`; dev `agrimarket_v2` chỉ được đọc metadata, **không ghi**
> - Trạng thái Git: toàn bộ thay đổi vòng 1–4 **còn uncommitted**; không commit, không push, không merge, không rebase, không reset cứng, không deploy, không chạy migration trên dev/prod
> - Bằng chứng cục bộ: `.tmp-verify/round4/` (gitignored), kèm `evidence-sha256.txt`; không in secret/giá trị `.env` vào báo cáo hay log
> - Nguyên tắc: chỉ kết luận từ test chạy thật; không nới assertion, không thêm skip, không xóa test, không che giấu lỗi

---

## 1. Phạm vi vòng 4

Vòng 4 gồm bốn nhóm việc, đúng brief nghiệm thu:

1. **Idempotency DB-backed** cho ba endpoint thay đổi trạng thái có rủi ro retry:
   - `POST /api/v1/inventory/adjust` — điều chỉnh tồn kho;
   - `POST /api/v1/payouts` — tạo lệnh chi trả;
   - `POST /api/v1/refunds` — tạo hoàn tiền.
2. **Tái hiện trước, sửa sau** lỗi thứ tự khóa của checkout `OrdersService.reserveLine` khi chạy song song với inbound / adjust.
3. **Review migration** `20261019000000_settlement_line_unique_partner_order`: giữ Policy A, làm rõ nghĩa "idempotent" của comment, xác nhận trạng thái test/dev.
4. **Hồi quy toàn bộ** sau thay đổi: typecheck, lint, unit, full E2E 4 lần, stress 30 vòng, build, test các app.

**Ngoài phạm vi (được ghi nhận, không sửa):** idempotency cho các endpoint khác như inbound, tạo settlement, tạo payment; thay đổi quy tắc kinh doanh; migration production; commit/push.

---

## 2. Baseline, môi trường và an toàn dữ liệu

| Hạng mục | Giá trị đã xác minh |
|---|---|
| Branch | `fix/bl-01-02-settlement-con-01` |
| HEAD | `90c28de8f773af2b266b96979f9508155e9523fe` |
| Test DB | `agrimarket_v2_test` — nơi duy nhất chạy test/probe ghi dữ liệu |
| Dev DB | `agrimarket_v2` — chỉ đọc metadata; **9 migration**, không có migration settlement mới, không có bảng `app_idempotency_keys` |
| Production | Không truy cập, không apply migration, không cấu hình |
| Checkpoint an toàn | `C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-round4-checkpoint` — patch tracked + bản copy untracked **trước vòng 4** |
| File riêng của chủ dự án | `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` — không đọc nội dung, không sửa, không đưa vào báo cáo này |

Checkpoint ngoài repo là biện pháp phòng ngừa trước khi sửa; nó **không thay thế Git** và không phải bản backup của trạng thái sau vòng 4. Working tree hiện tại vẫn là nguồn duy nhất của thay đổi chưa commit.

---

## 3. Tổng hợp thay đổi (vòng 1–4, còn uncommitted)

`git diff --stat` trên working tree hiện tại: **25 file tracked, +1413 / −209**. Con số này là **tổng vòng 1–4**, không phải riêng vòng 4; các vòng trước đã có +1053/−169. Phần vòng 4 được liệt kê theo nội dung dưới đây.

### 3.1 File mới của vòng 4

| File | Vai trò |
|---|---|
| `apps/api/src/common/idempotency/idempotency.service.ts` | Executor claim/replay/purge dùng UNIQUE index DB |
| `apps/api/src/common/idempotency/idempotency.constants.ts` | Scope, giới hạn key 100 ký tự, retention 30 ngày |
| `apps/api/src/common/idempotency/idempotency.module.ts` | Đăng ký service dùng chung |
| `apps/api/src/common/decorators/idempotency-key.decorator.ts` | Bắt buộc và chuẩn hóa header `Idempotency-Key` |
| `apps/api/prisma/migrations/20261022000000_app_idempotency_keys/migration.sql` | Bảng ledger + UNIQUE + index hết hạn + FK actor |
| `apps/api/test/idempotency.e2e-spec.ts` | 20 test trực tiếp service/DB |
| `apps/api/test/idempotency-http.e2e-spec.ts` | 14 test hợp đồng HTTP |
| `apps/api/test/checkout-lock-order.e2e-spec.ts` | 2 test hồi quy checkout × inbound/adjust |
| `apps/admin-web/src/lib/api/idempotency.ts` | Giữ key ổn định cho một payload form chưa đổi |

### 3.2 File đã có được sửa cho vòng 4 (tracked + untracked từ vòng 3)

| Nhóm | File | Thay đổi chính |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | Model `AppIdempotencyKey`, quan hệ `User`, unique `(scope, actorUserId, key)`, index `expiresAt` |
| Inventory | `inventory.service.ts`, `inventory.controller.ts`, `inventory.module.ts` | `adjust` nhận key; claim cùng transaction; thêm `lockWarehouseShared`; controller bắt buộc header + Swagger |
| Finance | `settlements.service.ts`, `finance.controller.ts`, `finance.module.ts` | Payout nhận key; replay trước precondition; claim cùng transaction; controller/module |
| Payments | `payments.service.ts`, `payments.controller.ts`, `payments.module.ts` | Refund nhận key; replay trước precondition; claim cùng transaction; controller/module |
| Checkout | `orders.service.ts` | `lockCheckoutWarehouses` lấy S(warehouse) theo thứ tự tăng dần trước balance; thêm S(warehouse) trước từng balance claim để phủ balance mới xuất hiện sau pre-lock |
| Admin UI | `client.ts`, `resources.ts`, `inventory/page.tsx`, `settlements/page.tsx` | Gửi header; key ổn định theo payload; reset sau thành công |
| Test | `mutation-acceptance.e2e-spec.ts`, `helpers/e2e-fixtures.ts`, `helpers/concurrency-fixtures.ts` | Thêm key cho các call bắt buộc; dọn bảng idempotency trong fixture |
| Migration (untracked từ vòng 3) | `20261019000000_settlement_line_unique_partner_order/migration.sql` | Làm rõ nghĩa idempotent, pre-check, guard thủ công; **không đổi SQL** |

### 3.3 Điều không thay đổi

- Không đổi FEFO, COD, luồng BUY_NOW/cart, quarantine, checkout idempotency hiện có.
- Không đổi BL-01 (refund cap), BL-02 (return/refund), BL-06 (payout cap/race), BL-07 (adjust nguyên tử).
- Không đổi quy tắc Policy A của settlement.
- Trong vòng 4, không sửa assertion cũ để PASS; chỉ thêm test mới và cập nhật call site/helper để gửi header bắt buộc. Các thay đổi assertion/mock/test helper của vòng 1–3 (quarantine/cancel, lock order, PDF) được giữ nguyên và đã ghi trong báo cáo 09–11.

---

## 4. Thiết kế idempotency DB-backed

### 4.1 Bảng và ràng buộc

`app_idempotency_keys` gồm:

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Khóa kỹ thuật |
| `scope` | VARCHAR(64) | Endpoint/operation, ví dụ `inventory.adjust` |
| `actor_user_id` | INT | User lấy từ JWT, không lấy từ body |
| `key` | VARCHAR(100) | `Idempotency-Key` đã trim |
| `request_hash` | VARCHAR(64) | SHA-256 của payload canonical |
| `response_status` | INT NULL | Status của response gốc (hiện là 201 cho cả ba POST) |
| `response_json` | JSON NULL | Body đã serialize để replay |
| `created_at` | DATETIME(3) | Thời điểm claim |
| `expires_at` | DATETIME(3) | Hạn retention |

Ràng buộc quyết định:

```sql
UNIQUE INDEX app_idempotency_keys_scope_actor_user_id_key_key
  (scope, actor_user_id, key);
INDEX app_idempotency_keys_expires_at_idx (expires_at);
FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE;
```

UNIQUE index là **cơ chế khóa duy nhất**. Không có `Map`, mutex hay cache trong process; nhiều instance API vẫn chia sẻ cùng một sự thật ở DB.

### 4.2 Luồng một request có key

1. Controller lấy `Idempotency-Key`, từ chối header thiếu/rỗng/quá 100 ký tự bằng 400 **trước khi** gọi service.
2. Service (payout/refund) gọi `replay()` trước các precondition nghiệp vụ. Điều này cần thiết vì retry hợp lệ phải replay dù trạng thái đã đổi (ví dụ payment đã `REFUNDED`).
3. Nếu chưa có key, `IdempotencyService.run()` mở transaction và **INSERT claim** `(scope, actor, key, request_hash, expires_at)`.
4. UNIQUE index serialize hai request cùng key:
   - request thắng chạy toàn bộ business work trong **cùng transaction**;
   - request thua nhận lỗi unique, transaction rollback, đọc row của winner ở transaction mới.
5. Winner ghi `response_json` **trước khi commit**. Vì vậy row đã commit luôn có response; không có trạng thái PENDING nhìn thấy được.
6. Nếu business work ném lỗi, claim rollback cùng transaction; key được tự do dùng lại. Không có "false success".
7. Nếu cùng key nhưng `request_hash` khác → 409, không ghi nghiệp vụ.
8. Nếu key hết hạn → coi như chưa dùng, xóa row hết hạn và cho phép claim lại.

### 4.3 Canonical hash và phạm vi

- `hashIdempotencyPayload` sort key object, bỏ `undefined`, giữ thứ tự array, Date → ISO. Vì vậy cùng payload semantic nhưng đổi thứ tự field JSON vẫn cùng hash.
- Payload adjust gồm `warehouseId`, `productLotId`, `productVariantId`, `quantityDelta`, `note`.
- Payload payout gồm `settlementId`, `amount`, `reference`.
- Payload refund gồm `paymentId`, `amount`, `reason`.
- Scope tách endpoint; actor tách người dùng. Cùng key + cùng payload ở hai endpoint là hai operation độc lập.

### 4.4 Điểm code

| Thành phần | Vị trí |
|---|---|
| Replay nhanh | `idempotency.service.ts:95-115` |
| Claim + work + response + retry | `idempotency.service.ts:123-200` |
| Purge | `idempotency.service.ts:206-211` |
| Validate key | `idempotency.service.ts:213-224` |
| Retention | `idempotency.service.ts:226-233` |
| Hash canonical | `idempotency.service.ts:269-286` |
| Scope/limit/retention | `idempotency.constants.ts:1-16` |
| Header decorator | `idempotency-key.decorator.ts:10-28` |
| Model | `schema.prisma:904-920` |

---

## 5. Bằng chứng TRƯỚC FIX — tái hiện đúng lỗi

Probe chạy thật trên `agrimarket_v2_test`, lưu `.tmp-verify/round4/pre-fix-runtime.json` và log tương ứng. Đây là **trước khi** thêm idempotency.

| Endpoint | Kịch bản | Kết quả đo | Kết luận |
|---|---|---|---|
| `POST /inventory/adjust` | +5, retry cùng payload sau khi request đầu commit | `firstOnHand=15`, `retryOnHand=20`, `onHandDelta=10`, `movementCount=2` (hai dòng +5), `auditCount=2` | Một hành động admin bị cộng **+10**, hai ledger/audit |
| `POST /payouts` | Tạo payout 30.000đ, retry cùng payload | `firstId=1454`, `retryId=1455`, `rowCount=2`, `committedAmount=60000`, `payoutCodes=[PAY-20261022-0001, PAY-20261022-0002]`, `auditCount=2` | Một lệnh chi bị tạo **hai lần**, tổng 60.000đ |
| `POST /refunds` | Refund 20.000đ, retry cùng payload | `firstId=1262`, `retryId=1263`, `rowCount=2`, `refundedAmount=40000`, `paymentStatus=PARTIALLY_REFUNDED`, `auditCount=2` | Một hoàn tiền bị tạo **hai lần**, tổng 40.000đ |

Điểm quan trọng: probe phân biệt rõ **hai operation +5 độc lập** (phải thành +10) với **một operation +5 bị retry** (phải giữ +5). Trước fix, hệ thống không có cách nào phân biệt hai trường hợp này.

---

## 6. Hợp đồng API sau fix

| Endpoint | Role | Header | Thiếu header | Key quá dài | Cùng key + payload khác |
|---|---|---|---|---|---|
| `POST /api/v1/inventory/adjust` | ADMIN | `Idempotency-Key` bắt buộc | 400, không ghi tồn | 400 | 409, không ghi tồn |
| `POST /api/v1/payouts` | ADMIN | `Idempotency-Key` bắt buộc | 400, không tạo payout | 400 | 409, không tạo payout |
| `POST /api/v1/refunds` | ADMIN | `Idempotency-Key` bắt buộc | 400, không tạo refund | 400 | 409, không tạo refund |

- Key tối đa **100 ký tự**, được trim; key rỗng bị từ chối.
- Actor lấy từ `AuthenticatedUser` (JWT), không tin actor do client gửi.
- Replay trả **201** cùng body gốc; body được lưu dưới dạng JSON đã serialize.
- Swagger của cả ba route mô tả header và hành vi replay/409.
- Cấu hình CORS hiện có đã cho phép `Idempotency-Key` (`main.ts:54`), nên admin-web gọi cross-origin không bị preflight chặn header này.
- Admin UI gửi key ổn định cho một payload form chưa đổi; reset store sau khi thành công. Refund hiện **không có màn hình tạo** trong admin-web, nên chỉ hợp đồng API/test được cập nhật.

**Đây là thay đổi hợp đồng có chủ đích:** client cũ gọi ba endpoint này mà không gửi header sẽ nhận 400. Việc rollout API + admin-web phải đi cùng nhau; xem mục 18–19.

---

## 7. Ma trận hành vi SAU FIX

Nguồn: `.tmp-verify/round4/post-fix-runtime.json`, `idempotency-e2e.log`, `idempotency-http-e2e.log`.

| # | Kịch bản | Kỳ vọng | Kết quả đo |
|---|---|---|---|
| 1 | Adjust +5, retry cùng key + payload | Tồn không đổi, 1 movement | `firstOnHand=15`, `retryOnHand=15`, `movementCount=1` |
| 2 | Hai adjust +5 với **hai key khác nhau** | +10, 2 movement | `independentOnHand=20`, `movementCount=2`, `movementDeltas=[5,5]` |
| 3 | Cùng key, payload khác | 409, không ghi | `conflict409=true`, `finalOnHand=15`, `movementCount=1` |
| 4 | 5 request đồng thời cùng key | Một commit, mọi response như nhau | `allOnHand=[15,15,15,15,15]`, `movementCount=1`, `keyRows=1` |
| 5 | Business write bị từ chối | Key rollback, dùng lại được | `refused=true`, `keyRowsAfterFailure=0`, `reuseSucceeded=true`, `finalOnHand=15` |
| 6 | Payout 30.000đ, retry cùng key | Cùng một payout | `firstId=1456`, `retryId=1456`, `rowCount=1`, `committedAmount=30000`, `auditCount=1` |
| 7 | Refund 100.000đ, retry cùng key | Cùng một refund | `firstId=1264`, `retryId=1264`, `rowCount=1`, `refundedAmount=100000`, `paymentStatus=REFUNDED`, `auditCount=1` |
| 8 | Ledger sau các test | Không row thiếu response | `rows=7`, `incompleteRows=0`, `expiredRows=0`, `allHaveRetention=true` |
| 9 | Dọn fixture | Không còn user/key rác | `leftoverUsers=0`, `leftoverKeys=0` |

Các ID 1454–1456, 1262–1264 là dữ liệu fixture trên test DB, không phải dữ liệu production.

---

## 8. Đồng thời 30 request cùng key

Mỗi endpoint có test gửi **30 request đồng thời** với cùng `(scope, actor, key, payload)`:

| Endpoint | Test | Kết quả |
|---|---|---|
| Adjust +5 | `replays exactly once when 30 requests race with the same key` | 30/30 response thành công; tồn chỉ +5; **1** movement; 1 key row |
| Payout 30.000đ | `creates exactly one payout when 30 requests race with the same key` | 1 payout; không cộng dồn payable; 1 key row |
| Refund 20.000đ | `creates exactly one refund when 30 requests race with the same key` | 1 refund; không vượt paid; 1 key row |

Cơ chế: 30 transaction cùng INSERT một UNIQUE key; DB chọn một winner, 29 loser chờ/đọc response của winner. Không có retry mù ở tầng application, không có "last write wins".

**Giới hạn trung thực:** test 30-way này chạy ở **tầng service/DB** (gọi service trực tiếp trong process test), không phải 30 request HTTP thật. Tầng HTTP có 14 test tuần tự cho missing header/replay/409/scope. Vì claim nằm trong service và HTTP chỉ chuyển key, đây là bằng chứng đủ cho cơ chế DB; nhưng nếu muốn đo cả connection pool/HTTP adapter dưới tải 30-way, cần bổ sung một test HTTP riêng (mục 18, R4-19).

---

## 9. Rollback, "no false success", "no stuck PENDING"

### 9.1 Rollback

- Adjust bị từ chối (ví dụ làm tồn âm) → transaction rollback → claim row biến mất. Cùng key được dùng lại và thành công sau đó; tồn cuối đúng +5.
- Payout bị từ chối (vượt payable) → key rollback; cùng key tạo payout hợp lệ sau đó thành công.
- Refund bị từ chối (vượt paid) → key rollback; cùng key refund hợp lệ sau đó thành công.

Đây là bằng chứng trực tiếp cho yêu cầu "rollback → không được coi là thành công" và "key không bị kẹt".

### 9.2 Không có PENDING nhìn thấy được

- Claim và response nằm trong **cùng transaction**; response được UPDATE trước commit.
- Row chỉ visible sau commit, và khi đó `response_json` đã có.
- Test `never leaves a committed row without a response (no stuck PENDING state)` quét ledger và assert không có row committed thiếu response.
- Trường hợp hiếm winner rollback sau khi loser đã thấy duplicate: loser đọc lại, thấy row biến mất, và được phép claim lại (tối đa 3 attempt để tránh loop bệnh lý).

### 9.3 Giới hạn chưa kiểm chứng

Chưa chạy **crash injection** (kill process đúng lúc sau commit DB nhưng trước khi HTTP response rời process). Về mặt thiết kế, row đã commit có response nên retry sẽ replay; nhưng đây là lập luận từ transaction boundary, chưa phải thực nghiệm crash. Xếp `NOT VERIFIED` cho kịch bản crash vật lý (R4-15), không che giấu.

---

## 10. Actor scope và endpoint scope

| Kịch bản | Kết quả | Ý nghĩa |
|---|---|---|
| Cùng key + payload, hai admin khác nhau | **Hai** adjustment độc lập | UNIQUE gồm `actor_user_id`; key không dùng chéo người |
| Cùng key + payload, adjust và payout | **Hai** operation đều thành công | UNIQUE gồm `scope`; key không dùng chéo endpoint |
| Cùng key + payload, cùng admin, cùng endpoint | Replay | Đúng một operation |

Đây là kiểm chứng trực tiếp cho yêu cầu "actor/endpoint scoped", không chỉ dựa vào đọc code.

---

## 11. Retention 30 ngày và purge

- Mặc định `DEFAULT_IDEMPOTENCY_RETENTION_DAYS = 30`; có thể override bằng `IDEMPOTENCY_RETENTION_DAYS` (số ngày > 0).
- `expires_at` được set khi claim; có index riêng để purge hiệu quả.
- `purgeExpired()` chạy lúc module khởi động và mỗi **6 giờ**, xóa row có `expires_at < UTC_TIMESTAMP(3)`.
- Key hết hạn được coi như chưa dùng: `replay()` xóa row hết hạn và trả `null`; request có thể claim lại.
- Test `treats an expired key as unused, then purges it` xác nhận cả hai hành vi.
- Test ledger xác nhận mọi row còn hạn đều có `expires_at`; `expiredRows=0` sau khi purge.

**Rủi ro vận hành (không phải lỗi chức năng):**
- `expires_at` tính bằng đồng hồ app, purge so bằng đồng hồ DB. Lệch giờ giữa các node có thể làm purge sớm/muộn.
- Purge lỗi chỉ ghi `logger.warn`, không có metric/alert; lỗi kéo dài làm bảng phình to.
- Response JSON được lưu plaintext trong DB; cần kiểm soát quyền đọc DB như mọi bảng tài chính.

Các điểm này xếp `POTENTIAL RISK` (R4-14), không chặn phạm vi chức năng của vòng 4.

---

## 12. Hợp đồng HTTP — 14 test

`apps/api/test/idempotency-http.e2e-spec.ts` chạy thật qua Nest HTTP app + test DB: **14/14 PASS**.

| Nhóm | Test | Kết quả |
|---|---|---|
| Adjust | Thiếu header → 400 trước khi ghi | PASS |
| Adjust | Cùng key + đúng body → replay cùng response | PASS |
| Adjust | Cùng key + payload khác → 409, tồn không đổi | PASS |
| Adjust | Key khác → operation độc lập | PASS |
| Adjust | Key quá dài → 400 | PASS |
| Payout | Thiếu header → 400 trước khi ghi | PASS |
| Payout | Cùng key + đúng body → replay cùng payout | PASS |
| Payout | Cùng key + amount khác → 409 | PASS |
| Payout | Cùng key với adjust → vẫn tạo payout (endpoint scope) | PASS |
| Refund | Thiếu header → 400 trước khi ghi | PASS |
| Refund | Cùng key + đúng body → replay cùng refund | PASS |
| Refund | Cùng key + amount khác → 409 | PASS |
| Refund | Replay sau khi payment đã `REFUNDED` | PASS |
| Ledger | Mọi key committed thuộc đúng scope và có response | PASS |

Điểm đáng chú ý: test refund replay sau `REFUNDED` chứng minh thứ tự `replay()` **trước** precondition là đúng; nếu replay sau precondition, retry hợp lệ sẽ bị 400 sai.

---

## 13. Checkout `reserveLine` — tái hiện TRƯỚC FIX

### 13.1 Công cụ và cách ép cửa sổ race

Script `.tmp-verify/round4/checkout-reserve-lock.mts` dựng một fixture sạch mỗi vòng, chạy checkout thật và một operation cạnh tranh thật:

- checkout: `OrdersService.createOrder` → `reserveLine` → `reserveStock` → `recordMovement`;
- cạnh tranh: inbound thật hoặc adjust thật trên cùng warehouse/lot/variant;
- một **gate** giữ transaction checkout đúng tại cửa sổ giữa `reserveStock` và `recordMovement`, để buộc hai transaction gặp nhau (race tự nhiên rất hiếm).

### 13.2 Kết quả trước fix

Log: `checkout-reserve-inbound.log`, `checkout-reserve-adjust.log`.

| Mode | Số vòng | Checkout | Operation cạnh tranh | Lỗi cạnh tranh | Vi phạm dữ liệu |
|---|---|---|---|---|---|
| Checkout ↔ inbound | 10 | commit 10/10 | **rollback 10/10** | P2034 / MySQL 1213 | 0 |
| Checkout ↔ adjust | 10 | commit 10/10 | **rollback 10/10** | P2010 / MySQL 1213 | 0 |

Diễn giải chính xác: checkout **không** bị rollback trong thiết lập này; nạn nhân là inbound/adjust. Đây vẫn là lỗi thật: một nghiệp vụ kho hợp lệ bị mất, client nhận lỗi deadlock, dù dữ liệu checkout không sai. Nguyên nhân là chu trình:

```
checkout:   X(inventory_balances) → INSERT movement → cần S(warehouses)
inbound:    X(warehouses) → X(inventory_balances)
adjust:     X(warehouses) → X(inventory_balances)
```

Checkout giữ balance rồi mới xin shared lock warehouse qua FK; writer giữ warehouse rồi xin balance → InnoDB chọn victim.

---

## 14. Checkout fix và kiểm chứng SAU FIX

### 14.1 Thay đổi

1. `OrdersService.createOrder` gọi `lockCheckoutWarehouses(tx, lines)` **trước** khi reserve bất kỳ balance nào (`orders.service.ts:559`).
2. `lockCheckoutWarehouses` (`orders.service.ts:735-755`):
   - lấy `warehouseId` của mọi balance hiện có cho các `productVariantId` của đơn, warehouse `ACTIVE`;
   - distinct + sort tăng dần;
   - gọi `InventoryService.lockWarehouseShared` cho từng warehouse.
3. `InventoryService.lockWarehouseShared` (`inventory.service.ts:236-240`) chạy `SELECT id FROM warehouses WHERE id = ? FOR SHARE`.
4. Trong `reserveLine`, **trước mỗi** `reserveStock` của một slice, gọi lại `lockWarehouseShared(tx, slice.warehouseId)` (`orders.service.ts:792-803`). Điều này phủ trường hợp inbound tạo balance mới ở warehouse chưa có trong pre-lock: checkout vẫn lấy S(warehouse) trước X(balance).
5. FEFO, `reserveStock`, allocation, COD, BUY_NOW/cart, quarantine, checkout idempotency **không đổi**.

`FOR SHARE` được chọn có chủ đích: checkout chỉ đọc warehouse, không sửa; shared lock không chặn nhau nên nhiều checkout cùng warehouse vẫn song song, nhưng chặn được writer đang giữ X(warehouse). Kết quả là thứ tự `warehouse → balance` cho cả checkout và writer, kể cả balance xuất hiện sau pre-lock.

### 14.2 Kết quả sau fix

| Kiểm chứng | Kết quả | Log |
|---|---|---|
| Checkout ↔ inbound, gate 10 vòng | checkout commit 10/10, inbound commit **10/10**, 0 violation, 0 P2034 | `checkout-reserve-inbound-afterfix.log` |
| Checkout ↔ adjust, gate 10 vòng | checkout commit 10/10, adjust commit **10/10**, 0 violation, 0 P2034 | `checkout-reserve-adjust-afterfix.log` |
| Natural (không gate) 30 vòng | cả hai commit 30/30, 0 reject, 0 violation | `checkout-reserve-natural-afterfix.log` |
| Control khác warehouse 5 vòng | cả hai commit 5/5 | `checkout-reserve-control-afterfix.log` |
| Hồi quy E2E 2 test × 10 vòng | 2/2 PASS, assert **cả hai** effect | `checkout-lock-order-e2e.log` |

Trạng thái sau fix trong log gate: `onHand=17, reserved=5, alloc=5, moves(r=1,o=1)` — reservation của checkout và effect của inbound/adjust cùng tồn tại đúng một lần.

### 14.3 Rủi ro còn lại

- Checkout lấy S lock cho **tất cả** warehouse ACTIVE có balance của variant, không chỉ warehouse mà FEFO sẽ chọn. Với dữ liệu nhiều warehouse, tập lock rộng hơn nhu cầu, có thể tăng contention shared→exclusive khi writer đến. Shared lock vẫn cho checkout song song; đây là đánh đổi hiệu năng, chưa thấy reject trong test.
- Cửa sổ balance mới xuất hiện sau pre-lock đã được đóng bằng S(warehouse) trước từng balance claim. Tuy nhiên chưa có test riêng dựng đúng kịch bản “inbound tạo balance mới xen giữa pre-lock và FEFO”; đây là `POTENTIAL RISK` về bằng chứng, không phải lỗi đã tái hiện.
- Fix không thay đổi logic chọn FEFO; nếu sau này thêm đường reserve khác không gọi `lockCheckoutWarehouses` hoặc không lấy S(warehouse) trước balance, lỗi có thể tái xuất. Cần giữ test hồi quy.

---

## 15. Review migration settlement + Policy A

### 15.1 Nội dung và ngữ nghĩa

Migration `20261019000000_settlement_line_unique_partner_order/migration.sql` vẫn giữ đúng một câu SQL:

```sql
ALTER TABLE `settlement_lines`
  ADD UNIQUE INDEX `settlement_lines_partner_order_id_key` (`partner_order_id`);
```

Policy A được giữ: **mỗi partner order chỉ thuộc tối đa một settlement line, trong mọi kỳ**; điều chỉnh dùng `settlements.adjustment_amount`, không claim lại.

Comment đã được làm rõ:

- Pre-check bắt buộc trước khi apply:
  ```sql
  SELECT partner_order_id, COUNT(*) AS claims
    FROM settlement_lines
   GROUP BY partner_order_id
  HAVING claims > 1;
  ```
- "Idempotent" **chỉ** đúng ở cấp Prisma migration runner: file được ghi một lần vào `_prisma_migrations`, không chạy lại. Bản thân SQL **không re-runnable**: MySQL/MariaDB không có `ADD UNIQUE INDEX IF NOT EXISTS`; chạy lại sẽ lỗi "Duplicate key name".
- Nếu operator chạy SQL thủ công, phải guard bằng `information_schema.statistics` trước khi ALTER.
- Rollback: `ALTER TABLE settlement_lines DROP INDEX settlement_lines_partner_order_id_key;`; khi drop index, DB-guard mất, code P2002→409 không còn tác dụng.

### 15.2 Trạng thái môi trường

| DB | Migration settlement | Index unique | Ghi chú |
|---|---|---|---|
| `agrimarket_v2_test` | Đã áp 2026-10-18 23:42:13 | Có `settlement_lines_partner_order_id_key` | Dùng cho test |
| `agrimarket_v2` (dev) | **Chưa áp** (9 migration) | Không có | Không ghi |
| Production | Không truy cập | Không kiểm chứng | Không apply |

### 15.3 Disclosure: sửa checksum metadata trên test DB

Khi làm rõ comment trong migration settlement, nội dung file đổi → SHA-256 đổi. Test DB đã áp migration từ trước với checksum cũ `12f9f53d...`; file hiện tại là `a09467d7...`.

Đã xử lý **chỉ trên test DB**:

- Script `.tmp-verify/round4/fix-test-migration-checksum.mts` xác minh thuật toán checksum của Prisma bằng một migration **không bị sửa** (`20261022000000_app_idempotency_keys`);
- UPDATE duy nhất `_prisma_migrations.checksum` cho migration settlement trên `agrimarket_v2_test`;
- Không đổi schema, không đổi data, không chạy lại SQL migration, không đụng dev/prod.

Bằng chứng: `checksum-repair.log`, `db-state-before-checksum-repair.log`, `db-state.log`. Sau sửa, checksum DB khớp file: `a09467d7bdaae88824b7c9ffc2899ec43342b0a47615634f6d2061deaf233f6d`. `checksum-repair.log` là lần chạy lại xác nhận (before = after = `a094...`); checksum cũ `12f9f53d...` được ghi trong `db-state-before-checksum-repair.log`.

**Rủi ro cần biết:** nếu một môi trường khác **đã áp** migration này với comment cũ, đổi comment sẽ làm Prisma thấy checksum khác. Không được tự sửa metadata ở dev/staging/prod nếu chưa có runbook/phê duyệt; ưu tiên giữ nguyên file đã deploy hoặc xử lý bằng quy trình migration chính thức. Dev hiện chưa áp nên không bị ảnh hưởng.

---

## 16. Ma trận hồi quy sau thay đổi

Tất cả chạy sau khi đã có idempotency + checkout fix + migration comment final.

| Bài | Lệnh | Kết quả | Log |
|---|---|---|---|
| API typecheck | `npm run typecheck --workspace @agrimarket/api` | EXIT 0 | `api-typecheck.log` |
| API lint | `npm run lint --workspace @agrimarket/api` | EXIT 0; **3 warning có sẵn từ HEAD**: `concurrency.e2e-spec.ts:394` (×2), `warehouse-admin.e2e-spec.ts:271` (`require-array-sort-compare`) | `api-lint.log` |
| API unit | `npm run test --workspace @agrimarket/api` | **34 file / 440 test PASS** | `api-unit.log` |
| API build | `npm run build --workspace @agrimarket/api` | EXIT 0 | `api-build.log` |
| Admin typecheck | `npm run typecheck --workspace @agrimarket/admin-web` | EXIT 0 | `admin-typecheck.log` |
| Admin lint | `npm run lint --workspace @agrimarket/admin-web` | EXIT 0, không warning | `admin-lint.log` |
| Admin test | `npm run test --workspace @agrimarket/admin-web` | **40/40 PASS** (7 file) | `admin-test.log` |
| Admin build | `npm run build --workspace @agrimarket/admin-web` | Next build thành công (27/27 static pages) | `admin-build.log` |
| Customer typecheck/test | workspace customer | typecheck EXIT 0; **37/37 PASS** | `customer-typecheck.log`, `customer-test.log` |
| Mobile typecheck/test | workspace mobile | typecheck EXIT 0; **175 pass / 3 skipped** (18 file pass, 1 file skipped) | `mobile-typecheck.log`, `mobile-test.log` |
| Shared domain | workspace shared-domain | typecheck EXIT 0; **65/65 PASS** | `shared-typecheck.log`, `shared-test.log` |
| Full E2E lần 1 | `npm run test:e2e --workspace @agrimarket/api` | **408/408 PASS** (16 file), 90.99s | `e2e-full-run1.log` |
| Full E2E lần 2 | cùng lệnh | **408/408 PASS**, 90.13s | `e2e-full-run2.log` |
| Full E2E lần 3 | cùng lệnh | **408/408 PASS**, 87.70s | `e2e-full-run3.log` |
| Full E2E lần 4 | cùng lệnh | **408/408 PASS**, 91.27s | `e2e-full-run4.log` |
| Stress 30 vòng | `CONCURRENCY_ROUNDS=30 CHECKOUT_LOCK_ROUNDS=30` cho concurrency + concurrency-money + checkout-lock | **52/52 PASS**, 176.38s | `stress-conc-30.log` |
| Idempotency service | spec riêng | **20/20 PASS** | `idempotency-e2e.log` |
| Idempotency HTTP | spec riêng | **14/14 PASS** | `idempotency-http-e2e.log` |
| Checkout lock-order | spec riêng | **2/2 PASS** | `checkout-lock-order-e2e.log` |

### 16.1 Quy mô test

- Full E2E trước vòng 4: **372** test; vòng 4 thêm **36** test (20 + 14 + 2) → **408**.
- 4 lần full E2E: **1632 lượt PASS**, 0 FAIL.
- Mobile 3 skip là các test **conditional live-API có sẵn từ vòng 3** (`checkout-live.test.ts`), không phải skip mới để né lỗi.
- Không có test nào bị xóa, bị nới assertion, hoặc chuyển thành skip trong vòng 4.

---

## 17. Trạng thái DB và dấu vết test

Nguồn: `.tmp-verify/round4/db-state.log`, `checksum-repair.log`.

### 17.1 Test DB `agrimarket_v2_test`

| Hạng mục | Kết quả |
|---|---|
| Số migration đã áp | **11** |
| Migration settlement | Có, `finished_at=2026-10-18T23:42:13.646Z`, `rolled_back_at=null` |
| Checksum settlement | `a09467d7...` — khớp file hiện tại |
| Unique index settlement | `settlement_lines_partner_order_id_key`, `NON_UNIQUE=0` |
| Bảng idempotency | `app_idempotency_keys` tồn tại |
| UNIQUE idempotency | `(scope, actor_user_id, key)`, `NON_UNIQUE=0` |
| Index hết hạn | `app_idempotency_keys_expires_at_idx` |
| FK actor | `app_idempotency_keys_actor_user_id_fkey` |
| User rác `e2e%` | 0 |
| User rác `cc%` | 0 |
| Row idempotency còn lại | 0 |

### 17.2 Dev DB `agrimarket_v2`

| Hạng mục | Kết quả |
|---|---|
| Số migration | 9 |
| Migration settlement mới | **Không có** |
| Bảng `app_idempotency_keys` | **Không có** |
| Ghi dữ liệu | Không |

### 17.3 Vệ sinh test

Fixture dọn user/partner/warehouse/balance/movement và bảng idempotency sau mỗi suite. Kết quả cuối: 0 user `e2e`, 0 user `cc`, 0 row idempotency. Không có dấu vết test nào được để lại dev/prod.

---

## 18. Phân loại issue

Quy ước: **VERIFIED FIXED** = đã sửa và có test chạy thật; **VERIFIED BUG—OPEN** = tái hiện được và chưa sửa; **POTENTIAL RISK** = chưa thấy lỗi trong test nhưng có điều kiện rủi ro; **BUSINESS DECISION REQUIRED** = cần chủ dự án quyết định; **NOT VERIFIED** = chưa có bằng chứng, không tuyên bố.

| ID | Vấn đề | Phân loại | Bằng chứng / ghi chú |
|---|---|---|---|
| R4-01 | Retry adjust +5 cộng +10, 2 movement/audit | **VERIFIED FIXED** | Pre-fix +10; post-fix giữ 15, 1 movement |
| R4-02 | Retry payout tạo 2 lệnh, 60.000đ | **VERIFIED FIXED** | Post-fix cùng ID 1456, 1 row, 30.000đ |
| R4-03 | Retry refund tạo 2 lệnh, 40.000đ | **VERIFIED FIXED** | Post-fix cùng ID 1264, 1 row, 100.000đ |
| R4-04 | Cùng key + payload khác | **VERIFIED FIXED** | 409, không ghi; HTTP + service test |
| R4-05 | 30 request đồng thời cùng key | **VERIFIED FIXED** | 1 commit cho adjust/payout/refund; test 30-way |
| R4-06 | Rollback rồi retry | **VERIFIED FIXED** | Key row 0 sau lỗi; cùng key thành công sau đó |
| R4-07 | PENDING kẹt vĩnh viễn | **VERIFIED FIXED** | `incompleteRows=0`; response ghi trước commit |
| R4-08 | Key dùng chéo actor/endpoint | **VERIFIED FIXED** | 2 admin = 2 operation; adjust+payout = 2 operation |
| R4-09 | Retention/purge | **VERIFIED FIXED** | 30 ngày mặc định; expired reuse + purge test |
| R4-10 | Checkout `reserveLine` lock-order | **VERIFIED FIXED** | Trước: competitor rollback 10/10+10/10; sau: 0 reject; natural 30/30 |
| R4-11 | Migration settlement "idempotent" mơ hồ | **VERIFIED FIXED** | Comment nêu rõ Prisma runner vs raw SQL; pre-check/guard |
| R4-12 | Header bắt buộc là breaking change | **BUSINESS DECISION REQUIRED** | Client cũ không header nhận 400; phải rollout API + admin-web cùng nhau |
| R4-13 | Chọn retention 30 ngày | **BUSINESS DECISION REQUIRED** | Mặc định 30; nếu nghiệp vụ cần cửa sổ retry dài/ngắn hơn, đổi env và test lại |
| R4-14 | Purge lỗi không alert; lệch đồng hồ app/DB | **POTENTIAL RISK** | Chỉ log warn; cần monitoring/clock policy trước production |
| R4-15 | Crash injection sau commit trước response | **NOT VERIFIED** | Thiết kế đảm bảo response đã commit; chưa thực nghiệm kill process |
| R4-16 | Các endpoint khác chưa idempotent (inbound, settlements create, payments create…) | **NOT VERIFIED** | Ngoài phạm vi brief; không tuyên bố toàn hệ thống idempotent |
| R4-17 | Checksum migration ở môi trường đã áp bản comment cũ | **POTENTIAL RISK** | Test DB đã repair; dev chưa áp; môi trường khác cần runbook, không tự sửa metadata |
| R4-18 | Checkout S-lock rộng hơn nhu cầu FEFO | **POTENTIAL RISK** | Có thể tăng contention; chưa thấy reject trong 30 vòng natural + stress |
| R4-19 | 30-way HTTP cho 3 endpoint chưa chạy | **NOT VERIFIED** | 30-way hiện ở service/DB; HTTP có 14 test tuần tự |
| R4-20 | Go-live gates (JWT fail-closed, CI, backup/restore) | **POTENTIAL RISK** | Carry-over từ báo cáo 07/11; **không** thuộc phạm vi sửa vòng 4 |
| R4-21 | Thứ tự deploy API/admin-web | **BUSINESS DECISION REQUIRED** | API bắt buộc header; admin-web cũ sẽ 400 nếu deploy lệch |
| R4-22 | Balance mới xuất hiện sau pre-lock checkout | **POTENTIAL RISK** | Đã thêm S(warehouse) trước từng balance claim; chưa có test riêng dựng đúng cửa sổ này |

**Không có mục nào trong phạm vi vòng 4 được xếp `VERIFIED BUG—OPEN`.** Các mục chưa đóng được xếp `POTENTIAL RISK` hoặc `NOT VERIFIED` để không biến "chưa kiểm chứng" thành "đã sửa".

---

## 19. Quyết định cần chủ dự án và lưu ý triển khai

1. **Duyệt diff vòng 4** (idempotency + checkout lock + migration wording + tests) trước khi commit. Đề xuất tách commit:
   - idempotency schema/service/API/UI/tests;
   - checkout pre-lock + per-slice shared lock + 2 test hồi quy;
   - migration settlement comment + test DB checksum disclosure;
   - báo cáo/evidence (nếu chủ dự án muốn commit docs).
2. **Chốt rollout header**: API và admin-web phải deploy cùng nhau. Client tích hợp ngoài (nếu có) phải gửi `Idempotency-Key`; nếu không, nhận 400. Đây là thay đổi hợp đồng có chủ đích, không phải lỗi.
3. **Chốt retention**: 30 ngày là mặc định kỹ thuật; nếu cần cửa sổ retry khác, đặt `IDEMPOTENCY_RETENTION_DAYS` và chạy lại test retention/purge.
4. **Chốt vận hành purge**: thêm metric/alert cho purge failure và chính sách đồng hồ (NTP) trước production.
5. **Migration**: chỉ test DB đã áp. Dev/staging/prod cần change request riêng, backup, pre-check duplicate, apply theo Prisma runner, verify index; không chạy raw SQL lặp. Không tự sửa `_prisma_migrations` ngoài test DB.
6. **Phạm vi mở rộng**: nếu muốn idempotent cho inbound/settlements/payments, mở change request mới; không suy diễn từ 3 endpoint đã làm.
7. **Go-live**: giữ nguyên kết luận NO-GO của báo cáo 07/11 cho đến khi xử lý JWT secret fail-closed, CI tự động, backup/restore có diễn tập. Vòng 4 không tuyên bố production-ready.

---

## 20. Kết luận

Trong phạm vi vòng 4:

- Ba endpoint adjust/payout/refund đã có idempotency **DB-backed, atomic**, replay đúng, 409 đúng, rollback sạch, không PENDING kẹt, actor/endpoint scoped, retention có purge.
- Checkout `reserveLine` đã được **tái hiện lỗi trước fix** và sửa bằng pre-lock shared warehouse + S(warehouse) trước từng balance claim (phủ balance mới xuất hiện sau pre-lock); 10/10 + 10/10 vòng gate trước fix làm mất operation cạnh tranh, sau fix **0 reject**, natural 30/30 và control 5/5 sạch.
- Migration settlement giữ Policy A, wording đã rõ; test DB metadata checksum đã được sửa **chỉ trên test DB** và được disclosure đầy đủ.
- Hồi quy: 4 × 408/408 full E2E, 52/52 stress, 440 unit, 40 admin, 37 customer, 175 mobile pass (3 skip có sẵn), 65 shared, typecheck/build PASS; lint chỉ còn 3 warning có sẵn từ HEAD.

Các mục chưa đóng (crash injection, 30-way HTTP, purge observability, rollout header, migration ngoài test DB, go-live gates) đã được ghi rõ ở mục 18–19; không có mục nào bị che thành "đã xong".

**Vòng 4 đủ điều kiện trình chủ dự án nghiệm thu và xem xét commit trên feature branch.**

Đây **không** phải kết luận production-ready; go-live vẫn là NO-GO cho đến khi các gate ở mục 19 được xử lý.

---

## Phụ lục A — Bằng chứng cục bộ

Thư mục: `.tmp-verify/round4/` (gitignored). Manifest SHA-256: `evidence-sha256.txt` (40 file bằng chứng; manifest tự loại chính nó).

| Nhóm | File tiêu biểu | Nội dung |
|---|---|---|
| Trước fix | `pre-fix-runtime.json`, `retry-probe-prefix.mts` | +10/2 movement, 2 payout, 2 refund |
| Sau fix | `post-fix-runtime.json`, `retry-probe-postfix.mts` | Replay/409/concurrency/rollback/retention |
| Idempotency E2E | `idempotency-e2e.log` | 20/20 PASS |
| Idempotency HTTP | `idempotency-http-e2e.log` | 14/14 PASS |
| Checkout trước fix | `checkout-reserve-inbound.log`, `checkout-reserve-adjust.log` | 10/10 + 10/10 competitor rollback |
| Checkout sau fix | `checkout-reserve-inbound-afterfix.log`, `checkout-reserve-adjust-afterfix.log`, `checkout-reserve-natural-afterfix.log`, `checkout-reserve-control-afterfix.log` | 0 reject; 30 natural; 5 control |
| Checkout hồi quy | `checkout-lock-order-e2e.log` | 2/2 PASS |
| Full E2E | `e2e-full-run1..4.log` | 408/408 ×4 |
| Stress | `stress-conc-30.log` | 52/52, 176.38s |
| Unit/app tests | `api-unit.log`, `admin-test.log`, `customer-test.log`, `mobile-test.log`, `shared-test.log` | 440/40/37/175 (3 skip)/65 |
| Static/build | `api-typecheck.log`, `api-lint.log`, `api-build.log`, `admin-typecheck.log`, `admin-lint.log`, `admin-build.log`, `customer-typecheck.log`, `mobile-typecheck.log`, `shared-typecheck.log` | PASS; lint 3 warning cũ |
| DB | `db-state.log`, `db-state-before-checksum-repair.log`, `checksum-repair.log` | 11 migration test; checksum khớp; dev 9 migration, không bảng |
| Công cụ | `checkout-reserve-lock.mts`, `fix-test-migration-checksum.mts`, `db-state.mts` | Repro/repair/audit read-only |

## Phụ lục B — Lệnh chạy lại

```bash
# 1. Chỉ test DB
npm run test:e2e --workspace @agrimarket/api

# 2. Idempotency riêng
npx vitest run --config apps/api/vitest.config.e2e.ts idempotency.e2e-spec idempotency-http.e2e-spec

# 3. Checkout lock-order riêng (10 vòng mỗi test)
npx vitest run --config apps/api/vitest.config.e2e.ts checkout-lock-order.e2e-spec

# 4. Stress 30 vòng
CONCURRENCY_ROUNDS=30 CHECKOUT_LOCK_ROUNDS=30 \
  npx vitest run --config apps/api/vitest.config.e2e.ts \
  concurrency.e2e-spec concurrency-money.e2e-spec checkout-lock-order.e2e-spec

# 5. Reproducer checkout (trước/sau fix)
npx tsx .tmp-verify/round4/checkout-reserve-lock.mts inbound 10
npx tsx .tmp-verify/round4/checkout-reserve-lock.mts adjust 10

# 6. Audit DB (read-only + test-only checksum repair)
npx tsx .tmp-verify/round4/db-state.mts
npx tsx .tmp-verify/round4/fix-test-migration-checksum.mts   # CHỈ test DB, đã chạy
```

Trên Windows PowerShell, dùng `$env:CONCURRENCY_ROUNDS=30` thay cho cú pháp `VAR=...` nếu cần.

## Phụ lục C — Checkpoint và giới hạn

- Checkpoint ngoài repo: `C:\Users\Lai Van Nha\AppData\Local\Temp\opencode\agrimarket-round4-checkpoint` — chứa `tracked-changes.patch`, `files/`, `filelist.txt`, `untracked-manifest-sha256.txt` của trạng thái **trước vòng 4**.
- Checkpoint không chứa `.tmp-verify/` (bằng chứng nằm trong repo-gitignored) và không chứa secret.
- Working tree hiện tại vẫn chưa commit; báo cáo này không tạo commit/tag/branch, không `git add`, không push.
- Mọi số liệu test lấy từ log thật trong `.tmp-verify/round4/`; không transcribe từ trí nhớ.
