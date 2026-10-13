# AgriMarket V2 — Final Admin CRUD & Warehouse Acceptance

Đợt hoàn thiện cuối: thao tác quản trị + nghiệp vụ kho. Triển khai trực tiếp trên
source, kiểm thử toàn diện trên TEST DB độc lập, không ghi DEV, dừng trước
commit/push để người dùng duyệt diff.

- Branch: `main`
- Old HEAD (mốc bàn giao): `792cb3e`
- HEAD hiện tại: `792cb3e0f280118dcfb0c088a4f6e9fa7bf94b49` (không commit mới trong đợt này)
- Dirty tree: có (xem §A). Không `reset --hard`, không `clean`, không branch mới.

---

## A. Git Baseline

| Mục | Giá trị |
|---|---|
| Branch | `main` |
| Old HEAD | `792cb3e` (mốc tham chiếu) |
| HEAD hiện tại | `792cb3e0f280118dcfb0c088a4f6e9fa7bf94b49` |
| Dirty tree | **Có** — 13 file sửa + 4 nhóm untracked (không commit/push theo yêu cầu) |

File thay đổi (tracked):

| File | Nội dung |
|---|---|
| `apps/api/src/warehouses/warehouses.service.ts` | Guard `ACTIVE → INACTIVE` trong transaction + row lock; mã kho auto `WH-NNNN` chống trùng đồng thời; audit create/update/deactivate/reactivate |
| `apps/api/src/warehouses/warehouses.controller.ts` | Truyền `CurrentUser` để ghi audit |
| `apps/api/src/inventory/inventory.service.ts` | `requireActiveWarehouse` (lock kho trước mọi ghi tồn mới); `inbound`/`reserve` kiểm tra kho; FEFO (`allocateFefo`, `sellableQuantities`) chỉ đọc kho `ACTIVE` |
| `apps/api/src/inventory/warehouse-documents.service.ts` | `updateDraft` (sửa nháp), `cancelDraft` (`DRAFT → CANCELLED`); `create`/`complete` kiểm tra kho; `complete` khóa kho trước rồi mới claim (tránh deadlock với sửa) |
| `apps/api/src/inventory/warehouse-documents.controller.ts` | Thêm `PATCH /warehouse-documents/:id`, `POST /warehouse-documents/:id/cancel` |
| `apps/api/src/inventory/dto/warehouse-document.dto.ts` | Thêm `UpdateWarehouseDocumentDto` (note + lines, validation đầy đủ) |
| `apps/api/test/business-rules/inventory.spec.ts` | Bổ sung mock kho `ACTIVE` cho 3 test reserve hiện có |
| `apps/admin-web/src/app/(admin)/warehouses/page.tsx` | **Mới** — trang quản lý kho (thêm/sửa/ngừng/kích hoạt/xem tồn, không nút xóa cứng) |
| `apps/admin-web/src/app/(admin)/warehouse-documents/[id]/page.tsx` | Chi tiết phiếu: sửa nháp, hủy (confirm), hoàn tất — chỉ hiện khi `DRAFT` không nguồn; `COMPLETED`/`CANCELLED` chỉ xem |
| `apps/admin-web/src/app/(admin)/inventory/page.tsx` | Deep-link `?warehouseId=` từ trang Kho (seed filter + `Suspense`) |
| `apps/admin-web/src/components/layout/AdminShell.tsx` | Thêm menu `Kho hàng` |
| `apps/admin-web/src/lib/api/resources.ts` | Thêm `warehouse(s)`, `updateWarehouseDocument`, `cancelWarehouseDocument` |
| `docs/API.md` | Ghi 2 endpoint mới + guard kho |
| `docs/BUSINESS-RULES.md` | Thêm §4b (vòng đời kho) + §4c (vòng đời phiếu) |

Untracked (mới, chưa commit):

| Nhóm | Ghi chú |
|---|---|
| `apps/admin-web/src/app/(admin)/warehouses/` | Trang Kho mới (1 file `page.tsx`) |
| `apps/api/test/business-rules/warehouse-deactivation.spec.ts` | 12 unit tests guard kho |
| `apps/api/test/business-rules/warehouse-document-draft.spec.ts` | 8 unit tests sửa/hủy nháp |
| `apps/api/test/warehouse-admin.e2e-spec.ts` | 8 E2E kho/phiếu trên TEST DB |
| `apps/api/s.name` | File rỗng **có từ trước đợt này** (timestamp 10:17, trước khi triển khai) — giữ nguyên, không xóa theo nguyên tắc bảo toàn |

Không migration mới (trạng thái `CANCELLED` đã có sẵn trong schema).

---

## B. CRUD Audit Matrix

`Chức năng | Trạng thái | Create | Update | Delete | Cancel | Disable | Backend | Admin UI | Result`

| Chức năng | Trạng thái | Create | Update | Delete | Cancel | Disable | Backend | UI | Kết luận |
|---|---|---|---|---|---|---|---|---|---|
| Danh mục | ACTIVE/INACTIVE | Có | Có | Không (đúng — dùng status) | N/A | Có (status) | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Sản phẩm | ACTIVE/INACTIVE | Có | Có (ngừng bán = status) | Không (đúng) | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Quy cách (variant) | ACTIVE/INACTIVE | Có | Có điều kiện | Không (đúng) | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Ảnh sản phẩm | — | Có | Thay thế | Có (đúng — ảnh không phải lịch sử) | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Trang trại | ACTIVE/INACTIVE | Có | Có | Không (đúng) | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Đối tác | ACTIVE/INACTIVE | Có | Có | Không (đúng) | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Mùa vụ | PLANNED…CANCELLED | Có | Có điều kiện | Không (đúng) | Có (status) | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Nhật ký canh tác | — | Có | Sửa trong giới hạn | Không | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Thu hoạch | — | Có | Có (không phá phân bổ) | Không | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Lô hàng | PENDING_QC…RECALLED | Có | Hạn chế (QC/recall) | Không (đúng) | N/A | QC/recall | PASS giữ nguyên | Có đủ | PASS, không sửa |
| QC | PASS/FAIL | Có | Không (bản ghi mới) | Không (đúng) | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Chứng nhận | PENDING/VERIFIED… | Có | Xác minh/từ chối | Không (đúng) | N/A | Hiệu lực | PASS giữ nguyên | Có đủ | PASS, không sửa |
| **Kho** | **ACTIVE/INACTIVE** | Có | **Đã sửa** (trim, guard, audit) | **Không — đúng, không thêm DELETE** | N/A | **Đã siết guard** | **Đã sửa** | **Đã bổ sung trang** | **FIXED + TESTED** |
| **Phiếu kho** | **DRAFT/COMPLETED/CANCELLED** | Có | **Đã bổ sung sửa nháp** | **Không — dùng CANCELLED** | **Đã bổ sung hủy nháp** | N/A | **Đã sửa** | **Đã đồng bộ** | **FIXED + TESTED** |
| Tồn kho | — | Nhập/điều chỉnh theo quy trình | Giữ/giải phóng/điều chỉnh | Không | N/A | N/A | PASS + guard kho mới | Có đủ | FIXED (guard) + TESTED |
| Đơn hàng | State machine | Checkout | Chuyển trạng thái | Không (hủy hợp lệ) | Có | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Giao hàng | State machine | Tạo vận đơn | Cập nhật trạng thái | Không | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Thanh toán | PENDING/PAID… | Ghi nhận có chứng từ | Xác nhận COD | Không | Hoàn tiền riêng | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Voucher | ACTIVE/INACTIVE | Có | Bật/tắt | Không (giữ lịch sử dùng) | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Product Discount | ACTIVE/INACTIVE | Có | Bật/tắt (giữ giá đã chốt) | Không | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Flash Sale | ACTIVE/INACTIVE | Có | Bật/tắt (giữ quota) | Không | N/A | Có | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Đánh giá | PENDING/APPROVED/HIDDEN | Khách tạo | Duyệt/ẩn (admin) | Không | N/A | Ẩn | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Trả hàng | State machine | Tiếp nhận | Xử lý theo state | Không | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Khiếu nại | State machine | Tiếp nhận | Xử lý/kết thúc | Không | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Đối soát | DRAFT/CONFIRMED/PAID | Có | Xác nhận/chi trả có chứng từ | Không | N/A | N/A | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Tài khoản | ACTIVE/INACTIVE | Có | Khóa/mở khóa | Không | N/A | Khóa | PASS giữ nguyên | Có đủ | PASS, không sửa |
| Dashboard | — | N/A | N/A | N/A | N/A | N/A | PASS giữ nguyên | Xem/lọc/xuất | PASS, không sửa |

Kết luận GĐ1: toàn bộ Admin đã đủ CRUD theo đúng chính sách mục tiêu; **chỉ 2 thiếu
sót có bằng chứng** thuộc phạm vi đợt này (guard ngừng kho + sửa/hủy phiếu nháp)
được sửa. Không thêm CRUD thừa cho các nghiệp vụ chỉ cần chuyển trạng thái.

---

## C. Warehouse Audit

| Kiểm tra | Kết quả |
|---|---|
| Tạo kho (`POST /warehouses`, ADMIN) | PASS — tên/địa chỉ trim + bắt buộc; mã `WH-NNNN` theo next-free-sequence; retry tối đa 3 lần khi trùng unique (chống 2 request đồng thời); trạng thái ban đầu `ACTIVE`; audit `WAREHOUSE_CREATE` |
| Sửa kho (`PATCH /warehouses/:id`, ADMIN) | PASS — sửa tên/địa chỉ/status; mã kho và quan hệ lịch sử bất biến; audit `WAREHOUSE_UPDATE` |
| Guard ngừng kho (`ACTIVE → INACTIVE`) | **FIXED + TESTED** — transaction + `SELECT ... FOR UPDATE` row lock; từ chối `409` khi còn `onHand > 0` / `reserved > 0` / `blocked > 0` / phiếu `DRAFT` / cấp phát cho đơn chưa kết thúc; không đổi trạng thái, không tự giải phóng/chuyển/xóa; claim cuối `updateMany WHERE status=ACTIVE` chống race |
| Kích hoạt lại (`INACTIVE → ACTIVE`) | PASS — cho phép, audit `WAREHOUSE_REACTIVATE` |
| Kho có tồn / giữ chỗ / cách ly | PASS — 3 unit tests + E2E B (409, tồn không đổi) |
| Kho có chứng từ chưa hoàn tất | PASS — unit + E2E (409 khi còn DRAFT) |
| Không DELETE kho | PASS — không endpoint DELETE; lịch sử (sổ kho, chứng từ, movement, truy xuất lô) được giữ |
| Kho ngừng không dùng sai chính sách | PASS — `create`/`complete` phiếu, `inbound`/`reserve` thủ công đều `409`; FEFO và sellable-preview chỉ đọc kho `ACTIVE`; điều chỉnh (sửa sai số) vẫn cho phép |

---

## D. Warehouse Document Audit

| Kiểm tra | Kết quả |
|---|---|
| Tạo `DRAFT` | PASS giữ nguyên + thêm guard kho `ACTIVE` |
| Sửa nháp (`PATCH /warehouse-documents/:id`) | **MỚI + TESTED** — chỉ `DRAFT` không `sourceType`; sửa note và/hoặc thay toàn bộ lines (validate lot/variant tồn tại, số lượng dương, đơn vị đúng, không trùng lot+variant); **không chạm tồn/movement**; claim `WHERE status=DRAFT` chống race; audit `WAREHOUSE_DOCUMENT_UPDATE_DRAFT` |
| Hủy nháp (`POST /warehouse-documents/:id/cancel`) | **MỚI + TESTED** — `DRAFT → CANCELLED` (tái dùng enum có sẵn, không migration); không tồn/movement; idempotent khi đã `CANCELLED`; audit `WAREHOUSE_DOCUMENT_CANCEL` |
| Hoàn tất (`POST .../complete`) | PASS + cứng thêm: khóa kho trước → claim CAS; thứ tự lock kho → phiếu đồng nhất mọi đường (sửa deadlock E2E H) |
| `COMPLETED` immutable | PASS — PATCH/CANCEL bị từ chối 400 (unit + E2E F) |
| `CANCELLED` immutable | PASS — COMPLETE/PATCH bị từ chối 400 (unit + E2E E); không mở lại |
| Transaction / idempotency | PASS — double COMPLETE 1 thắng/1 thua, tồn +1 lần, movement 1 dòng (E2E G); edit-vs-complete và cancel-vs-complete mỗi cặp đúng 1 nhánh thắng (E2E H/I); không tồn âm, không nhập trùng |
| Audit trail | PASS — create/update/deactivate/reactivate kho + update/cancel/complete phiếu đều ghi `AuditLog` |
| Swagger/API docs | PASS — 2 endpoint mới có trong `/docs-json`; `docs/API.md` + `docs/BUSINESS-RULES.md` (§4b/§4c) đã cập nhật |

---

## E. FEFO & Inventory Regression

- `allocateFefo` + `sellableQuantities`: chỉ đọc kho `ACTIVE` (không phân bổ từ kho
  đã ngừng) — unit FEFO hiện có vẫn pass (mock không assert `where`).
- Reserve/release/consume/quarantine: giữ nguyên CAS chống oversell — 406/406 unit pass.
- E2E hồi quy: `concurrency` + `mutation-acceptance` 140/140 pass; full E2E
  339/339 pass (12 files) trên TEST DB thật.
- OUTBOUND: **giữ nguyên chính sách** ghi khi đơn `DELIVERED` (không đổi thời điểm,
  không nút xuất kho thứ hai). Đánh giá ảnh hưởng: tồn vật lý trong lúc vận chuyển
  vẫn hiển thị trên `onHand` đồng thời `reserved` giữ phần đã cấp phát, nên báo cáo
  phải đọc `available = onHand − reserved − blocked` (đã đúng); cải tiến tách trạng
  thái in-transit thuộc phạm vi riêng, ngoài đợt này.

## F. UI Acceptance

| Trang / kiểm tra | Kết quả |
|---|---|
| Menu `Kho hàng` mới trong sidebar | PASS — hiển thị trên Dashboard thật (ảnh + snapshot browser) |
| `/warehouses` (mới) | PASS trên browser thật: 1 kho `WH-0001` hiển thị đúng tên/mã/địa chỉ/trạng thái; đủ nút Thêm/Sửa/Ngừng hoạt động-Xem tồn; **không nút xóa cứng**; lỗi 409 hiển thị nghiệp vụ |
| `/inventory?warehouseId=3` deep-link | FIXED — seed filter kho từ URL (có `Suspense` cho Next 16) |
| Chi tiết phiếu `[id]` | FIXED — `DRAFT` không nguồn: Sửa nháp + Hủy (confirm) + Hoàn thành; `COMPLETED`/`CANCELLED`: chỉ xem; phiếu có nguồn: ghi chú không sửa tay |
| Console/network trang Kho | PASS — không lỗi console; API `GET /warehouses` 200 qua browser |
| Chưa kiểm thử thật | Form sửa phiếu, dialog hủy, nút ngừng kho ở trạng thái lỗi (không có credentials Admin DEV để đăng nhập; **không dò mật khẩu**) — backend của mọi nút đã E2E đầy đủ; UI dùng chung component `FormModal`/`useAction` đã có unit (40/40) |

## G. Test Results

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @agrimarket/api typecheck` | PASS (exit 0) |
| `pnpm --filter @agrimarket/api lint` | PASS (exit 0; chỉ warnings có sẵn + 1 warning sort-compare ở file E2E mới) |
| `pnpm --filter @agrimarket/api test` (unit) | **406/406 PASS** (31 files) — gồm 20 tests mới (guard kho + nháp) |
| `pnpm --filter @agrimarket/api test:e2e` | **339/339 PASS** (12 files) trên MySQL thật `agrimarket_v2_test` — gồm 8 E2E mới (A–I, L) |
| `pnpm --filter @agrimarket/api build` | PASS |
| `pnpm --filter @agrimarket/admin-web typecheck` | PASS |
| `pnpm --filter @agrimarket/admin-web lint` | PASS |
| `pnpm --filter @agrimarket/admin-web test` | **40/40 PASS** (7 files) |
| `pnpm --filter @agrimarket/admin-web build` | PASS (27 routes, gồm `/warehouses` mới) |
| `pnpm --filter @agrimarket/customer-web typecheck/lint/build` | PASS / PASS / PASS (không ảnh hưởng contract) |
| `pnpm --filter @agrimarket/mobile typecheck/lint/test` | PASS / PASS / **174/174 PASS** (18 files) |

Chưa chạy: không có. Blocker môi trường đã xử lý: MySQL restart làm rớt cache
`caching_sha2_password` của driver mariadb (lỗi `ER_CANNOT_RETRIEVE_RSA_KEY`) —
đã mồi lại cache bằng 1 kết nối SELECT (read-only), API health 200 trở lại; **DEV
không bị ghi** (xác minh §I).

## H. Remaining Issues

- **P1 — UI chưa đăng nhập kiểm thử đầy đủ:** không có mật khẩu Admin DEV (seed
  `Agri@12345`/`Admin@12345` đều 401) và không được dò credentials. Các nút mới
  (sửa/hủy phiếu, ngừng kho, form kho) dùng chung component đã unit-test; backend
  đã E2E đầy đủ. Cần người dùng đăng nhập và bấm thử 3 luồng: ngừng kho còn tồn
  (expect 409), sửa nháp → hoàn tất, hủy nháp.
- **P2 — Báo cáo tồn trong lúc vận chuyển:** OUTBOUND ghi tại `DELIVERED` nên
  `onHand` bao gồm cả hàng đang giao (có `reserved` đối ứng). Đã ghi nhận phương
  án tách in-transit riêng; ngoài phạm vi đợt này.
- **P3 — File lạ `apps/api/s.name`:** rỗng, tồn tại từ trước đợt này — giữ nguyên
  theo nguyên tắc bảo toàn; đề nghị chủ repo xác nhận xóa.
- Không có P0 tồn đọng trong phạm vi này.

## I. Database

- **DEV (`agrimarket_v2`): chỉ SELECT.** Xác minh read-only sau triển khai:
  - warehouses: 1 dòng `WH-0001 / ACTIVE` (không đổi).
  - lots #44/#53: `SELLABLE`, `remaining` 450/260, `updated_at` 2026-10-07 (không đổi).
  - certificate #11: `ACTIVE` (không đổi). flash sale #3: `ACTIVE` (không đổi).
  - `inventory_balances`: 18 dòng; movements: INBOUND 18 / RESERVE 32 / RELEASE 28;
    `warehouse_documents`: COMPLETED 10 / CANCELLED 1 (không có ghi mới từ đợt này).
- **TEST (`agrimarket_v2_test`):** dùng độc lập cho toàn bộ 339 E2E; fixtures tự
  dọn (leftover check 0); migrations đã `deploy` đủ 9/9.
- **Migration mới:** không có (tái dùng `CANCELLED` sẵn có). Không chạy migration
  nào lên DEV.

## J. Final Verdict

| Nhãn | Giá trị |
|---|---|
| CODE FIXED | Guard ngừng kho + sửa/hủy phiếu nháp + guard kho ngừng + FEFO lọc kho ACTIVE + Admin UI kho/phiếu |
| TEST PASS | Unit 406/406 · E2E 339/339 (TEST DB) · Admin unit 40/40 · Mobile 174/174 |
| UI PASS (một phần) | Trang Kho + menu + deep-link verified trên browser thật; luồng cần đăng nhập chờ duyệt tay (P1) |
| DEV MIGRATION PENDING | Không có (không migration mới) |
| DEV DATA PENDING APPROVAL | Không có (không đổi dữ liệu DEV) |
| BLOCKED | Không |
| NOT TESTED | Đăng nhập tay 3 luồng Admin (thiếu credentials, đã nêu ở §H) |

Không ghi `100% COMPLETE`: còn 1 mục P1 chờ người dùng bấm thử với tài khoản
Admin thật. Không commit/push — diff đang chờ duyệt.
