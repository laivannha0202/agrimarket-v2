# Báo cáo 28 — Hoàn thiện nghiệp vụ, dọn mã nguồn và tái cấu trúc AgriMarket V2

**Ngày:** 01/11/2026
**Phạm vi:** toàn monorepo (`apps/*`, `packages/*`, `scripts/`, `e2e/`, `docs/`, `audit-reports/`)
**Nguyên tắc:** không viết lại dự án, không xoá chức năng, không đổi nghiệp vụ tài chính trong refactor thuần tuý, không push/merge/deploy, không dùng CI.

---

## A. Git

| Mục | Giá trị |
|---|---|
| Branch | `main` |
| HEAD gốc | `11b5ce8` — `docs(26): record the verify:local consolidated gate (20/20 steps) and its evidence path` |
| HEAD cuối | `d12da0c` + commit báo cáo này — **4 commit local, không push** |
| Remote | `origin` → `github.com/laivannha0202/agrimarket-v2` (**không push**) |
| Working tree lúc bắt đầu | sạch (`git status --porcelain` rỗng) |
| Working tree lúc kết thúc | sạch (`git status --porcelain` rỗng sau commit báo cáo) |
| `git diff --check` | PASS — 0 lỗi whitespace (chỉ còn cảnh báo CRLF/LF của Git khi core.autocrlf bật) |

Chia theo giai đoạn của đề bài (được phép tạo commit local nhỏ, không push):

| Commit | Nội dung | File |
|---|---|---|
| `b983dd5` | `fix` — bằng chứng gateway, chặn quyết toán thiếu thu tiền, trạng thái hoàn tiền dẫn xuất, API đối chiếu, voucher/refund Mobile, lời nhắn huỷ đơn, chiều cao dòng PDF | 29 |
| `d934568` | `refactor` — tách state machine + checkout identity, tách tab chi tiết đơn admin, dùng chung formatter, khai báo workspace dependency | 18 |
| `d12da0c` | `chore` — xoá file chết, chuyển 9 script QA vào `apps/api/qa/`, index tài liệu | 42 |
| commit này | `docs` — báo cáo 28 | 1 |

Không reset, không clean, không đụng file chưa commit (lúc bắt đầu không có file nào
như vậy). Không tạo nhánh mới, không sửa `origin`.

---

## B. Bug fixes

### B1. P1 — Thanh toán online: biến môi trường không còn là bằng chứng gateway tồn tại

| | |
|---|---|
| **Hiện tượng** | `PAYMENTS_ONLINE_ENABLED=true` làm `VNPAY` được chấp nhận dù chưa có tích hợp gateway nào. Checkout tạo được đơn ở trạng thái chỉ có thể thanh toán bằng callback không tồn tại. |
| **Root cause** | `isPaymentMethodAvailable()` chỉ kiểm tra một cờ cấu hình (`isOnlinePaymentEnabled`) rồi `return method === VNPAY`. Cờ cấu hình bị dùng như bằng chứng "gateway đã sẵn sàng". |
| **Sửa** | `apps/api/src/payments/payment-methods.ts`: thêm registry adapter `PAYMENT_GATEWAYS` (hiện **rỗng** — chưa tích hợp gateway). Một phương thức online chỉ khả dụng khi **đồng thời**: (1) cờ bật, (2) có adapter đã đăng ký, (3) adapter cho phép ở môi trường hiện tại (`sandboxOnly` bị từ chối ở production). `MOCK_ONLINE` vẫn bị từ chối ở production và cũng cần adapter. |
| **Không làm** | Không tạo credential/giao dịch ngân hàng giả, không thêm endpoint khởi tạo thanh toán. COD giữ nguyên. |
| **Test** | `apps/api/test/business-rules/payment-availability.spec.ts`: thêm 3 ca — registry rỗng thì cờ bật vẫn từ chối VNPAY (mọi `NODE_ENV`); chỉ bật khi có **cả** cờ và adapter; `MOCK_ONLINE` cần adapter và vẫn bị chặn ở production. Cập nhật ca "chỉ liệt kê phương thức thực sự thanh toán được" → `[COD]` khi chỉ bật cờ. |

### B2. P1 — Đối chiếu tiền đã thu với nghĩa vụ thanh toán

| | |
|---|---|
| **Hiện tượng** | `SettlementsService.create` chỉ kiểm tra **trạng thái** payment (`PAID/PARTIALLY_REFUNDED/REFUNDED` + `paidAt`), không kiểm tra **số tiền đã thu** có đủ nghĩa vụ của đơn hay không. Một payment PAID với `amount < grandTotal` (dữ liệu lịch sử/backfill thiếu) vẫn được quyết toán đủ. Không có chỗ nào đối chiếu để phát hiện thiếu/dư tiền. |
| **Sửa 1 — chặn quyết toán thiếu bằng chứng** | `apps/api/src/finance/settlements.service.ts`: truy vấn ứng viên kèm `order.grandTotal` + toàn bộ `payments` (cùng một truy vấn, không thêm round-trip). Sau khi đã `FOR UPDATE` các payment, tính `collected = Σ amount` của payment có `paidAt` và khác `FAILED`; chỉ đơn có `collected ≥ grandTotal` mới vào settlement. Đơn bị loại được **ghi log** (không sửa dữ liệu), và nếu không còn đơn nào đủ điều kiện thì trả lỗi nghiệp vụ rõ ràng. |
| **Sửa 2 — không cho đặt tay trạng thái hoàn tiền** | `apps/api/src/payments/payments.service.ts`: `PATCH /payments/:id/status` từ chối `PARTIALLY_REFUNDED`/`REFUNDED`. Hai trạng thái này là **dẫn xuất** từ tổng refund `COMPLETED` (chỉ `completeRefund` được ghi). Trước đây đặt tay tạo ra payment "đã hoàn tiền" không có refund row, không reference, không adjustment — không thể phân biệt với hoàn tiền thật. |
| **Sửa 3 — báo cáo đối chiếu (read-only)** | Mới: `apps/api/src/finance/payment-reconciliation.service.ts` + `GET /finance/reconciliation` (ADMIN, lọc `from`/`to`, phân trang). Trả về `summary` (tổng nghĩa vụ / đã thu / đã hoàn / còn thiếu, số ca theo từng loại) và `findings` từng đơn với: `UNDER_COLLECTED`, `OVER_COLLECTED`, `SETTLED_WITHOUT_FULL_COLLECTION`, `REFUND_WITHOUT_COLLECTION`, `REFUND_STATUS_MISMATCH`, kèm `refundState` (`NONE/PARTIAL/FULL`) để **phân biệt đơn đã hoàn tiền với đơn chưa thu đủ** — hai thứ trông giống nhau trong một cột tổng nhưng nghĩa ngược nhau. Không ghi gì vào DB. |
| **Sửa 4 — invariant** | `scripts/db-invariant-audit.mjs`: thêm 4 check — `payment_status_refund_mismatch`, `refund_without_collected_payment`, `settled_order_under_collected`, `settlement_line_refund_over_gross`. |
| **Không làm** | Không backfill, không sửa dữ liệu lịch sử, không "tự chữa" bản ghi lệch. Đơn đã hoàn tiền toàn phần **vẫn** có dòng settlement (net 0) — giữ nguyên hành vi đã được kiểm thử, vì đơn biến mất khỏi kỳ khó đối soát hơn đơn hiện 0. |
| **Test** | `payment-reconciliation.spec.ts` (12 ca: sạch, thiếu, dư, settled thiếu, hoàn toàn phần, refund chưa hoàn tất, refund không có thu tiền, mismatch, read-only, phân trang, cắt do giới hạn quét). `payment-collection.spec.ts` +1 ca chặn đặt tay trạng thái hoàn tiền. `settlement.spec.ts` +2 ca (loại đơn thiếu bằng chứng; từ chối kỳ không có đơn đủ bằng chứng). |

### B3. P1 — Mobile: voucher thật, refund và trạng thái

| | |
|---|---|
| **Hiện tượng** | `apps/mobile/app/order/[id].tsx` in `Mã voucher #<id>` (khoá nội bộ) thay vì mã khách đã nhập; **không hiển thị refund** dù backend trả `payments[].refunds`; không phân biệt chờ hoàn / đã duyệt / đã hoàn tất / thất bại. |
| **Sửa** | In `voucher.code` (fallback `#id` khi dữ liệu cũ thiếu quan hệ). Thêm khối "Hoàn tiền" dùng `refundStatusMeta` từ `shared-domain`; chỉ refund `COMPLETED` được vẽ dấu `−` và màu nhấn, các trạng thái khác hiển thị trung tính + nhãn trạng thái + lý do thất bại. |
| **Tách file** | Khối refund tách thành `apps/mobile/src/components/OrderRefundList.tsx` (71 dòng) — dùng chung được, không nhét logic tiền vào màn hình. |
| **Test** | Typecheck Mobile PASS; UI dùng đúng `refundStatusMeta` đã có test trong `shared-domain`. |

### B4. P2 — Hủy đơn: lời nhắn phải khớp state machine tồn kho

| | |
|---|---|
| **Hiện tượng** | Web và Mobile đều báo "hàng đã giữ cho đơn này được trả lại kho" cho **mọi** đơn huỷ. Backend thì: hàng còn trong kho → `RELEASE` (bán được); hàng đã rời kho → chuyển sang **blocked + mở phiếu quarantine** chờ kiểm định, **không** về tồn bán được. |
| **Sửa** | `packages/shared-domain/src/statuses.ts`: thêm `SHIPMENT_LEFT_WAREHOUSE_STATUSES` và `cancellationStockNotice(shipments)` trả về thông điệp đúng theo trạng thái lô vận chuyển thật. Customer Web (`OrderDetail.tsx`) và Mobile dùng chung hàm này; toast sau khi huỷ và hộp thoại xác nhận cũng bỏ cam kết "trả về kho". |
| **Bug phụ đi kèm** | `ShipmentStatus` của shared-domain và 2 app **thiếu `CANCELLED`** (backend có) → shipment đã huỷ hiển thị "Không xác định". Đã bổ sung type + nhãn `Đã hủy (chưa giao)`. |
| **Test** | `shared-domain/src/__tests__/statuses.test.ts`: +4 ca (đủ nhãn shipment kể cả `CANCELLED`; không hứa trả kho khi đang vận chuyển; coi `DELIVERY_FAILED/RETURNING/RETURNED` là đã rời kho; rỗng → trả kho). |

### B5. P2 — PDF phiếu soạn hàng: chiều cao dòng cho nhiều mã lô

| | |
|---|---|
| **Hiện tượng** | Một dòng có nhiều mã lô bị xuống dòng trong cột 112pt, nhưng `rowH` chỉ tính chiều cao **tên sản phẩm** → mã lô tràn xuống đè dòng kế tiếp và đè cả sản phẩm sau khi sang trang. |
| **Sửa** | `apps/api/src/orders/order-document.service.ts`: đo `heightOfString` cho **cả ô tên/SKU và ô lô hàng** với đúng font/size sẽ vẽ, `rowH = max(16, nameH, lotsH) + 8`; ngắt trang dựa trên chiều cao thật. |
| **Bằng chứng** | Test mới render PDF thật, đọc toạ độ text: với dòng 10 mã lô, khoảng cách tới sản phẩm kế tiếp **28,95pt khi chưa sửa** → **≥60pt sau khi sửa**. Test được chứng minh là **fail trên code cũ** (đã chạy lại bằng cách tạm bỏ `lotsH`). |
| **Giữ nguyên** | Logo, mẫu phiếu, watermark đơn huỷ, phân quyền, snapshot lịch sử (không đọc dữ liệu catalogue hiện tại). |
| **Phiếu riêng cho từng đối tác** | **Không tạo.** Phiếu soạn hàng là chứng từ **nội bộ kho** cho cả đơn, có nhóm theo đối tác; không có endpoint/màn hình "phiếu riêng của một đối tác" nên không có nguy cơ lẫn thông tin đối tác khác vào phiếu dành riêng. Quyết định này ghi rõ trong báo cáo thay vì tự thêm mẫu chứng từ mới. |

### B6. P1 (phát hiện khi chạy invariant) — Seed tạo quyết toán cho đơn chưa giao, chưa thu tiền

| | |
|---|---|
| **Hiện tượng** | `npm run verify:invariants` trên schema test **FAIL 2 dòng**: hai đơn `SHIPPING`/`CONFIRMED` với payment `PENDING` (đã thu 0đ) lại có dòng trong `SET-0001`. |
| **Root cause** | `apps/api/prisma/seed.ts` lấy **toàn bộ** partner order của đối tác Minh Châu để tạo settlement, không lọc theo `DELIVERED` + đã thu tiền. Đây chính là trạng thái mà `SettlementsService.create` từ chối tạo — dữ liệu demo mâu thuẫn với quy tắc nghiệp vụ của chính hệ thống. |
| **Sửa** | Seed chỉ quyết toán partner order thuộc đơn `DELIVERED` (mọi đơn `DELIVERED` trong seed đều có payment `PAID` + `paidAt`), và **throw** nếu không còn partner order nào đủ điều kiện — để lần sửa seed sau không thể âm thầm tạo settlement rỗng. |
| **Bằng chứng** | Trước: `Database invariant audit: FAIL — settled_order_under_collected: 2`. Sau khi sửa seed và seed lại schema test: `PASS — 54 checks, 0 violations`. |
| **Ghi chú** | Đây là dữ liệu demo, không phải dữ liệu production; không sửa DB dev/production, chỉ chạy seed trên `agrimarket_v2_test`. |

### B7. P2 — Phí giao hàng

Đã kiểm tra: `calculateShippingFee()` là nơi **duy nhất** tính phí; `checkout-preview` và `checkout` đều gọi cùng hàm; DTO checkout **không có** trường phí nên client không gửi được; 3 app chỉ hiển thị số backend trả. Giữ nguyên phí cố định 20.000đ và bổ sung ghi chú **giới hạn nghiệp vụ** ngay trong `shipping-policy.ts` (không phụ thuộc khoảng cách/khối lượng/số kiện; không phải báo giá cước; muốn đổi phải có bảng cước thật + snapshot phiên bản). Không tạo công thức mới.

---

## C. File cleanup

### C1. Xoá (20 file)

| File | Hành động | Lý do | Kiểm chứng |
|---|---|---|---|
| `apps/api/scripts/_exportcheck.mts` | DELETE | Scratch một lần của vòng sửa ExcelJS; tài liệu cũ gọi thẳng là "throwaway"; không được import ở đâu | `git grep _exportcheck` → 0 tham chiếu; export thật đã có test `reports-export.spec.ts` |
| `apps/api/scripts/_exportread.mts` | DELETE | Cùng lý do (đọc lại file Excel để kiểm tra bằng mắt) | `git grep _exportread` → chỉ 1 dòng trong báo cáo cũ ghi "throwaway … FIXED" |
| `pnpm-lock.yaml` | DELETE | Lockfile của pnpm trong khi dự án chạy npm (`packageManager: npm@11.20.0`, `workspaces`, CI `npm ci`, `node_modules_pnpm_broken/` còn sót) | `git grep pnpm` → chỉ comment/ghi chú, không có lệnh build nào dùng pnpm; `npm install --package-lock-only` chạy sạch |
| `pnpm-workspace.yaml` | DELETE | Cấu hình workspace của pnpm, trùng `workspaces` trong `package.json` | như trên |
| `apps/mobile/.qa-shots/04-cart.png`, `05-trace.png`, `06-account.png`, `F02-catalog.png`, `F03-product.png`, `F04-cart.png`, `F05-trace.png`, `F06-account.png`, `G03-product.png`, `I02-catalog.png`, `J04-cart.png`, `J06-account.png`, `J12-order-detail.png`, `J13-checkout.png`, `J16-addresses.png`, `J20-order-cancelled.png` (16 file) | DELETE | **Trùng byte** (cùng SHA-1) với bản còn lại — ảnh chụp QA bị lưu nhiều tên qua các vòng | So SHA-1 theo nhóm; giữ bản `FINAL-*` (được trích dẫn trong `AGRIMARKET-V2-MOBILE-UI-KIT-FINAL.md`) hoặc bản tên gốc |
| `apps/admin-web/src/components/orders/OrderDetailTabs.tsx` | DELETE (thay bằng barrel `OrderDetailTabs.ts`) | Tách 863 dòng thành 5 tab + shared; giữ nguyên đường dẫn import cho trang chi tiết | Typecheck + `next build` PASS; `git grep OrderDetailTabs` chỉ còn 1 consumer |

### C2. Đổi chỗ (10 file)

| Từ | Đến | Lý do | Kiểm chứng |
|---|---|---|---|
| `apps/api/qa-a1-a2-audit.mjs` | `apps/api/qa/qa-a1-a2-audit.mjs` | 9 script forensic read-only nằm lẫn ở root app; chuyển vào `qa/` (đúng quy ước đã có của `apps/customer-web/qa/`) | Sửa `./generated/...` → `../generated/...`; cập nhật 4 tài liệu trích dẫn đường dẫn; thêm `qa/README.md` |
| `apps/api/qa-addr.mjs` | `apps/api/qa/qa-addr.mjs` | nt | nt |
| `apps/api/qa-audit-final.mjs` | `apps/api/qa/qa-audit-final.mjs` | nt | nt |
| `apps/api/qa-db-conn-probe.mjs` | `apps/api/qa/qa-db-conn-probe.mjs` | nt | sửa `new URL("./.env")` → `"../.env"` |
| `apps/api/qa-db-peek.mjs` | `apps/api/qa/qa-db-peek.mjs` | nt | nt |
| `apps/api/qa-fs-seasons.mjs` | `apps/api/qa/qa-fs-seasons.mjs` | nt | nt |
| `apps/api/qa-order40-audit.mjs` | `apps/api/qa/qa-order40-audit.mjs` | nt | nt |
| `apps/api/qa-order40-pay.mjs` | `apps/api/qa/qa-order40-pay.mjs` | nt | nt |
| `apps/api/qa-order40-trace.mjs` | `apps/api/qa/qa-order40-trace.mjs` | nt | nt |
| `apps/api/qa-run-e2e.cmd` | `apps/api/qa/run-e2e.cmd` | nt; sửa `cd` và đường dẫn output cho đúng cấp thư mục mới | Đọc lại nội dung; đường dẫn `.tmp-verify` đúng |

### C3. Giữ nguyên có chủ đích (đã kiểm tra, **không** xoá)

| File / thư mục | Lý do giữ |
|---|---|
| `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` (root) | Tài liệu riêng của chủ dự án; 4 báo cáo trước ghi rõ "không sửa, không di chuyển". Giữ nguyên vị trí, chỉ thêm ghi chú trong `docs/README.md`. |
| `apps/mobile/.qa-shots/` (33 ảnh còn lại, ~9 MB) | Được trích dẫn làm bằng chứng UI (`FINAL-01..06`) và là output của `apps/mobile/scripts/cart-roundtrip.mjs`; xoá sẽ mất bằng chứng nghiệm thu. Chỉ xoá bản trùng byte. |
| `AGRIMARKET_*` (3 thư mục thiết kế ở root) | Bộ ảnh/UI kit gốc của chủ dự án làm căn cứ thiết kế; không phải asset runtime. Di chuyển sẽ phá tham chiếu trong tài liệu UI kit. |
| `apps/api/scripts/import-demo-images.mts`, `replace-seed-images.mts`, `restore-seed-images-from-backup.mts` | Công cụ bảo trì ảnh seed, còn giá trị khi dựng lại dữ liệu demo; đã đổi ví dụ `pnpm exec` → `npx`. |
| `apps/api/generated/`, `apps/api/dist/`, `apps/*/.next/` | Sinh tự động, đã nằm trong `.gitignore` (không track). |
| `.github/workflows/ci.yml` | Không dùng CI trong task này và **không sửa**; vẫn là cấu hình hợp lệ cho chủ dự án. |

---

## D. Refactor

### D1. Logic trùng lặp đã gộp

| Quy tắc | Trước | Sau | Ghi chú |
|---|---|---|---|
| Format tiền/ngày/số lượng | 3 bản: `admin-web/src/lib/format`, `shared-domain/src/format` (Customer/Mobile), `api/src/common/export/format` | Admin dùng `@agrimarket/shared-domain/format`; API giữ bản riêng (backend không phụ thuộc package frontend) | `formatMoney` bỏ `toLocaleString("vi-VN")` → nhóm nghìn thủ công: cùng chuỗi trên Node/Hermes, không phụ thuộc ICU |
| Nhóm nghìn cho số lượng | Admin có (`2.500`), shared không (`2500`) | Shared nhóm nghìn; 3 app in giống nhau | Cập nhật 1 test customer-web và thêm 1 test shared-domain |
| Format ngày giờ trong PDF | `vnDateTime()` tự viết trong `order-document.service.ts` | `formatDateTimeVn()` của `common/export/format` | Cùng định dạng `dd/MM/yyyy HH:mm`, cùng quy ước giờ VN |
| Trim số lượng trong PDF | `formatQty()` tự `toFixed(3).replace(...)` | `trimNumberVn()` của module export | PDF và Excel không thể lệch số |
| Lời nhắn tồn kho khi huỷ đơn | Chuỗi hard-code ở Web + Mobile | `cancellationStockNotice()` trong `shared-domain` | Một nguồn cho cả hai app |
| Nhãn trạng thái refund/shipment | Mobile đã re-export shared; customer cũng vậy | Giữ nguyên + bổ sung `CANCELLED` | Không tạo bản sao thứ ba |

Không gộp mọi helper vào một `utils.ts`: mỗi nhóm ở đúng tầng (domain dùng chung → `packages/shared-domain`; định dạng tài liệu backend → `apps/api/src/common/export`; helper chỉ admin dùng → `apps/admin-web/src/lib/format`).

### D2. File lớn đã tách

| File | Trước | Sau | Cách tách |
|---|---|---|---|
| `apps/admin-web/src/components/orders/OrderDetailTabs.tsx` | 863 | Barrel 13 dòng + `detail-tabs/`: `OrderOverviewTab` 125, `OrderItemsTab` 79, `OrderPaymentTab` 241, `OrderShippingTab` 156, `OrderFinanceTab` 226, `PaymentBadge` 16, `shared` 79 | Tách theo **tab** (một câu hỏi vận hành mỗi file); `itemColumns`/`SectionEmpty`/`itemUnit` về `shared` để hai tab không lệch bảng |
| `apps/api/src/orders/orders.service.ts` | 1512 | 1426 + `order-state-machine.ts` (37) + `checkout-request.ts` (76) | Chỉ tách **hàm thuần**: bảng chuyển trạng thái + `assertOrderTransition`; `resolveCheckoutSource` + `hashCheckoutRequest`. Không đụng transaction/lock |
| `apps/mobile/app/order/[id].tsx` | 572 → 585 (thêm refund) | 585 + `OrderRefundList.tsx` (71) | Khối refund tách thành component |
| `apps/api/src/orders/order-document.service.ts` | 601 | 599 | Gộp helper định dạng (không tách file: vẫn là một trách nhiệm "render chứng từ") |

**Không tách** `payments.service.ts` (730) và `settlements.service.ts` (~1000): cả hai là **ranh giới transaction tiền**. Tách service sẽ tạo transaction lồng nhau hoặc buộc phải truyền `tx` xuyên module — rủi ro cao hơn lợi ích, và không thể chứng minh an toàn chỉ bằng unit test. Quyết định ghi ở mục H.

### D3. Ngăn circular dependency

- `order-state-machine.ts` chỉ import `@nestjs/common` + enum Prisma.
- `checkout-request.ts` chỉ import DTO + enum Prisma.
- `payment-reconciliation.service.ts` chỉ import `PrismaService` + DTO phân trang.
- `OrderDetailTabs.ts` (barrel) → `detail-tabs/*` → `shared`; không file nào import ngược barrel.
- Shared-domain vẫn **không** import React/DOM/React Native/network.

Kiểm chứng: `tsc --noEmit` + `next build` + `nest build` + Expo export đều PASS (circular import trong NestJS/Next thường lộ ra ở bước này), và `nx`-style graph không có trong dự án nên dùng build làm bằng chứng.

### D4. Chuẩn hoá khác

- `apps/api/.env.example`: mô tả lại ngữ nghĩa `PAYMENTS_ONLINE_ENABLED` (cờ vận hành **không** phải bằng chứng gateway).
- `apps/api/.gitignore`, 2 script ảnh: ví dụ lệnh `pnpm` → `npm`/`npx`.
- `apps/customer-web/package.json`: khai báo `@agrimarket/shared-domain` và `@agrimarket/design-tokens` (đang dùng qua hoisting nhưng **chưa khai báo** — `npm ci` sạch vẫn chạy nhưng đó là phụ thuộc ngầm).
- `apps/admin-web`: thêm dependency `@agrimarket/shared-domain` + `transpilePackages`.
- `package-lock.json`: cập nhật 3 dòng cho các dependency workspace mới (giữ `npm ci` đồng bộ).

---

## E. Cấu trúc thư mục

### Trước

```text
agrimarket-v2/
├── apps/
│   ├── api/
│   │   ├── qa-a1-a2-audit.mjs … qa-order40-trace.mjs   (9 script rời ở root)
│   │   ├── qa-run-e2e.cmd
│   │   ├── scripts/_exportcheck.mts, _exportread.mts   (scratch)
│   │   └── src/orders/orders.service.ts                 (1512 dòng, gồm cả state machine)
│   ├── admin-web/src/components/orders/OrderDetailTabs.tsx (863 dòng, 5 tab)
│   └── mobile/app/order/[id].tsx                        (572 dòng, gồm cả refund)
├── packages/shared-domain/   (Customer + Mobile)
├── pnpm-lock.yaml, pnpm-workspace.yaml                  (còn sót từ pnpm)
└── docs/ (34 file, không có index)
```

### Sau

```text
agrimarket-v2/
├── apps/
│   ├── api/
│   │   ├── qa/                       # 9 script forensic read-only + run-e2e.cmd + README.md
│   │   ├── scripts/                  # chỉ còn script bảo trì ảnh seed
│   │   └── src/orders/
│   │       ├── orders.service.ts     (1426)
│   │       ├── order-state-machine.ts
│   │       ├── checkout-request.ts
│   │       └── order-document.service.ts
│   ├── admin-web/src/
│   │   ├── components/orders/detail-tabs/{shared,OrderOverviewTab,OrderItemsTab,OrderPaymentTab,OrderShippingTab,OrderFinanceTab,PaymentBadge}.tsx
│   │   └── lib/format/index.ts       # re-export shared + helper chỉ admin
│   └── mobile/src/components/OrderRefundList.tsx
├── packages/shared-domain/           # + cancellationStockNotice, SHIPMENT_LEFT_WAREHOUSE_STATUSES
├── docs/README.md                    # index: hiện hành vs lịch sử
└── package-lock.json                 # lockfile duy nhất (npm)
```

**Lợi ích thực tế:** mở `apps/api` không còn 10 file script lẫn với `src/`; mở một tab chi tiết đơn chỉ đọc ~150 dòng thay vì 863; quy tắc trạng thái đơn và "danh tính một lần checkout" đọc được độc lập, có test riêng; tài liệu có một điểm vào và phân biệt rõ hiện hành/lịch sử.

---

## F. Dependencies

| Mục | Kết quả |
|---|---|
| Package thêm | `@agrimarket/shared-domain` (admin-web), `@agrimarket/shared-domain` + `@agrimarket/design-tokens` (customer-web — đã dùng sẵn, nay khai báo đúng) |
| Package bỏ | `pnpm-lock.yaml`, `pnpm-workspace.yaml` (không phải package, nhưng là cấu hình package manager thứ hai) |
| Package không dùng | Không phát hiện: quét import thực tế của 4 workspace → 0 dependency khai báo mà không được tham chiếu |
| Security advisory (production) | `security-scan.mjs`: **0 high/critical** ở cả 4 workspace; 23 advisory rows toàn bộ là dev-only (ghi nhận, không `audit fix --force`) |
| Breaking change | Không nâng major nào. Không đổi framework. |
| Package manager | Chỉ npm (khớp `packageManager`, `workspaces`, `npm ci` của CI) |

---

## G. Testing

### G1. Kết quả

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Typecheck API | `npx tsc --noEmit -p tsconfig.json` (apps/api) | **PASS** |
| Typecheck Admin | `npx tsc --noEmit` | **PASS** |
| Typecheck Customer | `npx tsc --noEmit` | **PASS** |
| Typecheck Mobile | `npx tsc --noEmit` | **PASS** |
| Typecheck Shared-domain | `npx tsc --noEmit` | **PASS** |
| Unit API | `npx vitest run` | **PASS** — 46 file / **623 test** (baseline 44/592 → +2 file, +31 test) |
| Unit Admin | `npx vitest run` | **PASS** — 8 file / 48 test |
| Unit Customer | `npx vitest run` | **PASS** — 3 file / 37 test |
| Unit Mobile | `npx vitest run` | **PASS** — 18 file / 175 test (3 skip có sẵn) |
| Unit Shared-domain | `npx vitest run` | **PASS** — 5 file / 71 test |
| Lint API | `oxlint --type-aware src/ test/ prisma/` | **PASS** — 0 error, 4 warning có sẵn từ trước (template literal, `sort()` thiếu compare trong test) |
| Lint Admin | `eslint .` | **PASS** — 0 lỗi |
| Lint Mobile | `eslint .` | **PASS** — 0 lỗi |
| Build API | `nest build` | **PASS** — `dist/src/main.js` |
| Build Admin | `next build` | **PASS** — toàn bộ route admin render/compile |
| Build Customer | `next build` | **PASS** |
| Expo export | `expo export --platform android` | **PASS** — bundle Hermes 3,6 MB + 12 asset |
| E2E API | `vitest run --config vitest.config.e2e.ts` trên `agrimarket_v2_test` | **PASS** — 22 file / **484 test** |
| PDF render | nằm trong unit API (`order-documents.spec.ts`, 13 test, đọc byte PDF thật) | **PASS** |
| Security scan | `node scripts/security-scan.mjs` | **PASS** — 9 check, 0 high/critical |
| DB invariants | `node scripts/db-invariant-audit.mjs --url $TEST_DATABASE_URL` | **PASS** — 54 check, 0 vi phạm |
| Playwright | `npx playwright test` (API + Admin + Customer thật, Chromium) | **PASS** — 14 test (admin desktop + admin 390px + customer) |
| `verify:local` | `npm run verify:local` | **PASS** — 20/20 bước, schema dùng-rồi-xoá `agrimarket_v2_c19_20261101t143622z7mzb_test` |

### G2. Test mới / sửa

| File | Thay đổi |
|---|---|
| `payment-availability.spec.ts` | +3 ca (cờ đơn thuần không đủ; cần adapter; `MOCK_ONLINE` cần adapter) |
| `payment-collection.spec.ts` | +1 ca (không đặt tay `REFUNDED`/`PARTIALLY_REFUNDED`) |
| `payment-reconciliation.spec.ts` | **mới** — 12 ca |
| `settlement.spec.ts` | +2 ca (loại đơn thiếu bằng chứng; từ chối kỳ rỗng); fixture bổ sung `order.payments` |
| `order-state-machine.spec.ts` | **mới** — 12 ca (đồ thị trạng thái + danh tính checkout) |
| `order-documents.spec.ts` | +1 ca PDF nhiều lô (đọc toạ độ text) |
| `statuses.test.ts` (shared) | +4 ca (shipment `CANCELLED`, lời nhắn huỷ đơn) |
| `format.test.ts` (shared) | +1 ca (nhóm nghìn) |
| `status-format.test.ts` (customer) | sửa kỳ vọng `1.000 g` (nhóm nghìn) |

Không xoá test nào. Không nới lỏng assertion nào (2 thay đổi kỳ vọng đều do **định dạng hiển thị** đổi có chủ đích và được ghi rõ).

### G3. Invariant dữ liệu

Thêm 4 check vào `scripts/db-invariant-audit.mjs` (tổng 50 → 54):
`payment_status_refund_mismatch`, `refund_without_collected_payment`,
`settled_order_under_collected`, `settlement_line_refund_over_gross`.

Kết quả trên schema test (`agrimarket_v2_test`, sau khi seed lại):

```
Database invariant audit: PASS
  PASS  54 checks, 0 violations
  INFO  trace coverage: 18 sellable lot(s), 0 incomplete (reported, not backfilled)
```

Lần chạy **đầu tiên** sau khi thêm invariant là `FAIL — settled_order_under_collected: 2`;
nguyên nhân là seed (xem B6), đã sửa và chạy lại PASS. Log: `.tmp-verify/invariants-round28.json`.

### G4. Những mục chưa kiểm chứng

Playwright và `verify:local` **đã chạy được** trong phiên này (MySQL 8.0.46 local +
Chromium đã cài), nên hai mục từng bị bỏ trống ở bản nháp trước đã được đóng:

- `npx playwright test`: 14/14 test PASS trên 3 server dựng từ source (API trỏ vào
  `TEST_DATABASE_URL`), gồm admin 1440px, admin 390px, customer COD + voucher +
  partial refund + PDF + chặn đọc chứng từ của khách khác.
- `npm run verify:local`: 20/20 bước PASS, gồm preflight 16 check, typecheck 5
  workspace, lint, unit, build 3 app, tạo/migrate/seed schema dùng-rồi-xoá, 14
  migration + checksum, invariant 54 check (2 lần), backup/restore drill, E2E API,
  stress đồng thời 10 vòng, business smoke 72 check, security 9 check, ui-smoke 64
  route/asset. Schema chạy là `agrimarket_v2_c19_20261101t143622z7mzb_test` và đã
  được drop; `agrimarket_v2` không bị ghi.

| Mục | Lý do | Cách chạy khi có môi trường |
|---|---|---|
| Mobile trên thiết bị thật | Chỉ export bundle + typecheck/lint/test | Expo Go quét QR |
| Kiểm tra UI bằng mắt cho 2 thay đổi hiển thị | Playwright chụp ảnh chỉ khi fail; không có bước so ảnh | Ảnh chụp trước/sau ở vòng 26 vẫn còn trong `audit-reports/assets/26` |
| Load test hiệu năng (`verify:load`) | Không nằm trong gate `verify:local`; baseline vòng 27 vẫn là số tham chiếu | `npm run verify:load` |

---

## H. Những gì đã kiểm tra nhưng **giữ nguyên**

| Hạng mục | Lý do |
|---|---|
| `payments.service.ts` (735 dòng), `settlements.service.ts` (1052 dòng) | Là ranh giới transaction tiền (lock order: payment → refund → settlement). Tách file sẽ đổi nơi đặt `$transaction`/`FOR UPDATE`; không chứng minh được an toàn bằng unit test trong phạm vi task. |
| `inventory.service.ts` (972), `promotions.service.ts` (840) | Cùng lý do (tồn kho/quota). Không có triệu chứng khó bảo trì cụ thể. |
| `OrderDetail` (Customer, 808 dòng) | Đã tách theo component con từ trước; các khối còn lại dùng chung state truy vấn. |
| `CheckoutView.tsx` (1077) | Một luồng thanh toán liên tục; tách sẽ phải chia sẻ state form phức tạp, lợi ích thấp. |
| Đơn đã hoàn tiền toàn phần vẫn có dòng settlement net 0 | Hành vi đã được kiểm thử và có lý do: đơn hiện 0 dễ đối soát hơn đơn biến mất khỏi kỳ. |
| `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` ở root | Tài liệu riêng của chủ dự án, 4 báo cáo trước đã cam kết không đụng. |
| `apps/mobile/.qa-shots/*` (33 ảnh) | Là bằng chứng UI được trích dẫn; chỉ xoá bản trùng byte. |
| `.github/workflows/ci.yml` | Không dùng CI trong task; không sửa để tránh phá pipeline của chủ dự án. |
| Phí ship cố định 20.000đ | Chưa có dữ liệu cước đáng tin cậy; chỉ ghi rõ giới hạn. |
| Nhãn trạng thái trong admin (`lib/status`) | Dùng màu Ant Design, khác shape với `Tone` của shared-domain; gộp sẽ phải đổi toàn bộ bảng màu admin — ngoài phạm vi, rủi ro cao. |

---

## I. Production readiness

**Phân loại: LOCAL-TEST-READY** — toàn bộ gate local đã chạy và PASS: `verify:local`
20/20 bước, Playwright 14/14, E2E API 484 test, invariant 54 check trên schema test.

Không đánh dấu STAGING/UAT/PRODUCTION vì:

- Chưa kiểm tra trên môi trường staging thật (biến môi trường, reverse proxy, SMTP, backup).
- Thay đổi nghiệp vụ tiền (chặn quyết toán thiếu bằng chứng; chặn đặt tay trạng thái hoàn tiền) cần một vòng UAT với kế toán trước khi go-live.
- Báo cáo đối chiếu mới chỉ có API, **chưa có màn hình admin** — vận hành sẽ phải gọi API cho tới khi có UI.
- Mobile mới dừng ở export bundle + typecheck/lint/test, chưa chạy trên thiết bị thật.

---

## J. Trả lời trực tiếp 13 câu hỏi bàn giao

1. **Đã sửa hết lỗi P1/P2 nào?** P1 thanh toán online (cờ ≠ gateway), P1 đối chiếu payment/settlement, P1 Mobile voucher + refund, P2 lời nhắn huỷ đơn + nhãn shipment `CANCELLED`, P2 PDF nhiều mã lô, P2 phí ship (xác minh nhất quán + ghi giới hạn).
2. **Còn lỗi nào?** Không còn lỗi P1/P2 đã biết trong phạm vi báo cáo 26/27. Còn: chưa có UI cho báo cáo đối chiếu; thanh toán online vẫn **chưa tích hợp** (đúng thiết kế — registry rỗng); chưa chạy trên staging/UAT và thiết bị Mobile thật.
3. **Đã xoá bao nhiêu file thừa?** 20 file (2 scratch, 2 lockfile pnpm, 16 ảnh trùng byte); 1 file `.tsx` được thay bằng barrel `.ts` sau khi tách.
4. **Đã gộp bao nhiêu logic/file trùng?** 6 nhóm quy tắc (format tiền/ngày/số lượng; nhóm nghìn; format ngày PDF; trim số PDF; lời nhắn huỷ đơn; nhãn shipment), tương ứng 4 module nguồn chuẩn.
5. **Đã chia bao nhiêu file quá lớn?** 3 file tách (OrderDetailTabs 863 → 7 file; orders.service 1512 → 3 module; order/[id].tsx → +1 component).
6. **Đã di chuyển bao nhiêu file?** 10 (9 script QA + 1 .cmd vào `apps/api/qa/`).
7. **Đã chuẩn hoá những thư mục nào?** `apps/api` (root sạch script), `apps/api/qa` (mới, có README), `apps/admin-web/src/components/orders/detail-tabs` (mới), `apps/api/src/orders` (thêm 2 module thuần), `docs/` (thêm index), root (bỏ lockfile pnpm).
8. **Có package dư thừa nào được loại bỏ?** Không có dependency npm dư (đã quét). Loại bỏ cấu hình package manager thứ hai (pnpm).
9. **Có tạo thêm circular dependency không?** Không — các module mới chỉ phụ thuộc một chiều vào enum/DTO; build + typecheck + Expo export đều PASS.
10. **Có API hoặc màn hình nào bị ảnh hưởng không?** API: thêm `GET /finance/reconciliation`; `PATCH /payments/:id/status` từ chối thêm 2 trạng thái dẫn xuất; `POST /settlements` loại đơn thiếu bằng chứng. Không đổi route/screen nào; Admin/Customer/Mobile giữ nguyên đường dẫn.
11. **Có mất dữ liệu, migration hay test không?** Không. Không có migration mới, không sửa migration cũ, không xoá test, không đụng DB dev/production (chỉ chạy E2E trên `agrimarket_v2_test`).
12. **Toàn bộ test có còn PASS không?** Có: unit 954 test (623 API + 48 Admin + 37 Customer + 175 Mobile + 71 Shared), E2E API 484 test, Playwright 14/14, typecheck 5 workspace, 3 build, Expo export, security scan, lint, và gate `verify:local` 20/20 bước.
13. **Những thay đổi này có cải thiện khả năng bảo trì thật không?** Có, ở 4 điểm đo được: (a) một nguồn định dạng cho 3 app; (b) quy tắc trạng thái đơn và danh tính checkout có module + test riêng; (c) tab chi tiết đơn tách theo trách nhiệm; (d) root `apps/api` không còn script lẫn với mã nguồn, tài liệu có index phân biệt hiện hành/lịch sử.

---

## K. Bằng chứng bổ sung

- E2E: `.tmp-verify/e2e-round28-final.txt` (log đầy đủ, có dòng `EXIT=`).
- Playwright: `.tmp-verify/playwright-round28.log` — 14 passed, `EXIT=0`.
- Gate hợp nhất: `.tmp-verify/verify-local-round28.log` và
  `.tmp-verify/c19/local-20261101t143622z7mzb/` (manifest + log từng bước) —
  20 bước PASS, `EXIT=0`.
- Lần chạy E2E đầu tiên phát hiện **1 test đỏ** (`a full refund before settlement settles at zero payable`) do thay đổi loại trừ đơn `REFUNDED` khỏi settlement. Đã **hoàn nguyên** thay đổi đó (giữ hành vi net-0 đã được kiểm thử), thay bằng cảnh báo `refundState` trong báo cáo đối chiếu và invariant `settlement_line_refund_over_gross`. Đây là ví dụ cụ thể của nguyên tắc "không đổi nghiệp vụ tài chính trong refactor".
- PDF: test mới được chứng minh **fail trên code cũ** (28,95pt < 60pt) trước khi sửa.
- `git diff --check`: PASS. Working tree sạch sau commit báo cáo; 4 commit local, không push.
