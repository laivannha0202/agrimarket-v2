# 10 — FIX ROUND 2 VERIFICATION (BL-06 · BL-07 · test PDF flaky + phát sinh deadlock thuộc BL-07)

> **Thông tin audit**
> - Repository: `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (AgriMarket V2)
> - Baseline audit: commit `90c28de8f773af2b266b96979f9508155e9523fe` (báo cáo 01–08); vòng 1: `audit-reports/09-FIX-ROUND-1-VERIFICATION.md`
> - Branch làm việc: `fix/bl-01-02-settlement-con-01` — **thay đổi vòng 2 còn uncommitted, chồng lên thay đổi vòng 1, chưa push**
> - Ngày xác minh: 2026-10-20 (Asia/Ho_Chi_Minh)
> - DB an toàn: dev `agrimarket_v2` **không bị đụng** (không query, không mutate); mọi test chạy trên test DB `agrimarket_v2_test` qua `TEST_DATABASE_URL` (apps/api/.env)
> - Nguyên tắc giữ nguyên từ cuối vòng 1: không tuyên bố "đã sửa" nếu không có test chạy thật; mọi instrumentation chẩn đoán tạm đã revert hết — `TEMP-DIAG` trong `reports-export.e2e-spec.ts` đã trở về đúng trạng thái HEAD (grep `TEMP-DIAG|tmp-verify` trong cây test = 0 kết quả)

---

## 1. Phạm vi vòng 2

Đúng hẹn cuối vòng 1 (mục 4.5 báo cáo 09):

1. **BL-06** — payout vượt payable (hai payout đồng thời cùng commit vượt `payable_amount`).
2. **BL-07** — `adjust` mất increment (read-then-write: hai admin điều chỉnh cùng lúc đọc cùng `before`).
3. **Test PDF flaky** — `reports-export > exports a real PDF with extractable Vietnamese text` fail ~2%/run do decode sai mã đơn trong PDF.
4. Flip 2 test `it.fails` còn lại (BL-06 payout, BL-07 adjust) về `it()` và **PASS thật** — không dùng expected-fail che bug.
5. Giữ nguyên toàn bộ thay đổi vòng 1; không commit/push; không đụng dev/production.

## 2. Bảng trạng thái issue

| Issue | Bằng chứng trước vá | Trạng thái sau vòng 2 | Ghi chú trung thực |
|---|---|---|---|
| **BL-06** payout vượt payable | Test `it.fails` (vòng 1): hai payout đồng thời có thể cùng commit vượt payable | **ĐÃ SỬA (chờ duyệt commit)** | `PayoutsService.create` giờ chạy theo trình tự: pre-flight (settlement phải CONFIRMED/PAID, amount>0) → `$transaction` ReadCommitted → `SELECT id, payable_amount, status FROM settlements … FOR UPDATE` → **đối chiếu lại tổng payouts đang PENDING/PAID ngay sau khi giữ khóa** → chặn `paidSoFar + amount > payable` → 400. Insert payout + audit trong cùng transaction; retry code-collision giữ nguyên. 6 test payout (bao gồm match-exact, retry, burst, so le) PASS thật |
| **BL-07** adjust mất increment | Test `it.fails` (vòng 1): hai điều chỉnh đồng thời đọc cùng `before` → một increment bị ghi đè | **ĐÃ SỬA (chờ duyệt commit)** + **1 deadlock thật phát sinh trong vòng 2 đã được fix thêm** | `adjust` giờ là **một câu UPDATE có điều kiện**: `on_hand = on_hand + Δ WHERE on_hand + Δ >= 0 AND on_hand + Δ >= reserved + blocked` — phép cộng chạy trên giá trị cột hiện hành dưới khóa hàng nên không thể mất increment; movement + audit ghi từ read-back sau update trong cùng transaction. **Lỗi phát sinh được bắt đúng trong vòng 2**: adjust tạo vòng khóa ngược với inbound qua FK movement → InnoDB **P2034 deadlock thật (reproducer 2/40 vòng; nạn nhân là inbound, mất vĩnh viễn một lần +5)** → fix thêm bằng `lockWarehouse` (mục 6) |
| **Test PDF flaky** (`…-ORDEXP1` bị đọc thành `…-IREDXP·1`) | Vòng 1: 1/4 full run fail; lúc đó chỉ có thể phỏng đoán "font subset khác" | **ĐÃ SỬA — nguyên nhân gốc xác định bằng dissect thật, không còn phỏng đoán** | PDF là **chuẩn** (ToUnicode đúng PDF spec); lỗi nằm ở **parser ToUnicode CMap của test helper** (`parseCMap`): không hiểu được đích token đa-unit (ligature `fl`/`fi`/`ff` chứa 2 code units trong một token) → mọi entry sau đó bị lệch 1 ô. Fix nằm ở helper (mục 7): không xóa assertion, không bỏ kiểm tra tiếng Việt, không hardcode RUN_ID. Repro 300 vòng: **6/300 fail trước fix → 0/300 sau fix** |
| **`it.fails` còn lại trong suite** | 2 test (BL-06, BL-07) | **ĐÃ FLIP về `it()`, PASS thật** | Grep toàn `apps/api/test`: **0 `it.fails`** (chỉ còn 2 dòng comment ghi lịch sử tại `concurrency-money.e2e-spec.ts:408` và `:680`). Suite money giờ là 19 test `it()` thật |
| BL-01 / BL-02 / settlement-create / CON-01 (vòng 1) | — | **GIỮ NGUYÊN — không đảo ngược, không hồi quy** | Diff vòng 1 giữ nguyên; mục 10 xác nhận suite vẫn phủ đủ các điểm hồi quy |
| Unit test `adjust` cũ | Mock theo flow read-then-write cũ | **Cập nhật mock theo flow mới + thêm 2 test** | Unit từ 438 → 440: thêm nhánh từ chối "undercut reserved + blocked" và nhánh thành công có ledger/audit ghi từ read-back |

## 3. File/diff tổng (vòng 1 + vòng 2, chưa commit)

Diff so với baseline `90c28de`: **12 file modified + 4 mục untracked mới, thêm 812 / xóa 168 dòng** (mục untracked: thư mục migration `20261019000000_settlement_line_unique_partner_order`, `apps/api/test/concurrency-money.e2e-spec.ts`, `audit-reports/`, `AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` — file cuối là tài liệu gốc của chủ dự án, không đụng). Trọng tâm vòng 2:

| File | Thay đổi vòng 2 | Vai trò |
|---|---|---|
| `apps/api/src/finance/settlements.service.ts` | `PayoutsService.create` theo trình tự chốt tiền như bảng mục 2 (không đổi message lỗi "exceed settlement payable" để giữ contract e2e cũ) | BL-06 |
| `apps/api/src/inventory/inventory.service.ts` | Fix chính BL-07 (UPDATE có điều kiện, read-back, bắt P2002 cho race get-or-create) **+ vòng 2 thêm `lockWarehouse`** (SELECT … FOR UPDATE trên `warehouses`, **không gate status**) và gọi nó trong `adjust` trước `getOrCreateBalance` — chốt thứ tự khóa `warehouse → balance` giống mọi path ghi tồn kho khác | BL-07 + fix deadlock phát sinh |
| `apps/api/test/business-rules/inventory.spec.ts` | Mock adjust theo flow mới (`$executeRaw` trả 0 → đọc lại bằng `findUniqueOrThrow` để chọn đúng lý do từ chối); +2 test mới như mục 2 | unit |
| `apps/api/test/concurrency-money.e2e-spec.ts` | **19 test** (mục 4): BL-01×4, BL-02×2, settlement×1, **BL-06×6**, **BL-07×6** | bằng chứng fix |
| `apps/api/test/helpers/pdf-text.ts` | `parseCMap` gom **đích token đa-unit**: một `<…>` trọn = một glyph (1+ đơn vị 4-hex — ligature/astral); dùng chung cho `bfchar` + `bfrange` dạng array; dạng triple giữ nguyên | test PDF flaky |
| `apps/api/test/reports-export.e2e-spec.ts` | **Khác biệt ròng = 0 so với HEAD** — TEMP-DIAG đã revert | vệ sinh |

**Không có migration mới.** Unique index `settlement_lines.partner_order_id` (vòng 1) vẫn ở đúng trạng thái báo cáo 09: đã áp trên test DB, dev/prod chờ duyệt của chủ dự án. Vòng 2 không chạy migration nào.

Chi tiết hợp đồng giữ nguyên của BL-06: e2e cũ vẫn khớp `/exceed settlement payable/i` và số tiền khi không truyền `amount` mặc định là phần còn lại — cả hai đều PASS trong full run.

## 4. Độ phủ thật của phạm vi sửa

`grep "it\.fails"` trên toàn `apps/api/test` → **0 khớp** (2 dòng duy nhất chứa chuỗi này là comment lịch sử tại `concurrency-money.e2e-spec.ts` dòng 408 và 680). 19 test của `concurrency-money.e2e-spec.ts`:

- **BL-01 refund (4)**: hai refund 70% đồng thời (đúng một cái trúng, tổng ≤ đã trả); refund so le/retry (đọc lại tổng sau khóa, không hoàn quá); hai refund đồng thời giành phần còn lại (đúng một cái trúng, tổng = đã trả); refund 50% + 50% tuần tự (cả hai hợp lệ, kết thúc đã hoàn đủ).
- **BL-02 return (2)**: hai claim đủ số lượng đồng thời (đúng một cái được chấp nhận); claim tuần tự không vượt số lượng đã giao.
- **settlement create (1)**: hai create đồng thời cho cùng đối tác/kỳ không claim một đơn hai lần.
- **BL-06 payouts (6)**: hai payout full-size đồng thời không vượt payable; hai payout **cộng đúng bằng payable** thì cả hai phải trúng; payout lớn hơn phần còn lại → 400 và **không còn dòng nào trong DB**; retry sau khi thua race chi đúng phần còn lại thật; **burst nhiều payout cùng phần còn lại: đúng một cái trúng**; so le theo cơ chế mặc định (mỗi lần chi phần còn lại) không bao giờ chìm vào âm.
- **BL-07 (6)**: hai inbound đồng thời (baseline — PASS từ vòng 1); hai adjust đồng thời (trước đây là `it.fails`); adjust +/− so le (balance và ledger luôn đồng bộ); adjust được retry phải ghi đủ từng lần áp dụng; **adjust cài kẽ với checkout thật** (dùng `OrdersService` thật — không bị bán vượt, không mất movement); **adjust cài kẽ với inbound thật** (cả hai lần tăng đều sống sót ở balance và ledger).

Mỗi case đều đối chiếu trạng thái trong DB (tổng cộng + movements/ledger), không dừng ở giá trị trả về của hàm.

## 5. BL-06 — payout không bao giờ vượt payable

- **Trước vá** (vòng 1): test `it.fails` tái hiện hai payout đồng thời cùng commit vượt `payable_amount`.
- **Sau vá**: trình tự chốt tiền trong mục 2. Chứng minh bằng các test ở mục 4 với `CONCURRENCY_ROUNDS` mặc định 5 và **stress 30 vòng** (mục 9) — không một trường hợp nào còn vượt payable; mọi từ chối đều là 400 nghiệp vụ (không có lỗi Prisma thô); cả hai luồng "đúng phần còn lại" đều được đo lại và khớp trong DB.
- **Hồi quy**: luồng settlement statement (`reports-export.e2e-spec.ts` — dòng trạng thái "Nháp → Đã xác nhận → Đã chi trả", KPI "Đã chi trả / Còn phải trả") chạy ổn qua mọi full run — không đổi hành vi.

## 6. BL-07 — adjust nguyên tử, và một deadlock thật bị bắt + fix trong vòng này

### 6.1 Fix chính (đúng chủ trương vòng 1)

`adjust` là một câu UPDATE có điều kiện do DB đánh giá trong quá trình giữ khóa hàng (chi tiết nằm trong docblock của code). Không còn path nào tính `after` phía JavaScript → không có lost update; movement được ghi từ read-back sau khi update nên ledger không bao giờ mô tả một update chưa commit.

### 6.2 Lỗi phát sinh không lường trước, được phát hiện đúng trong vòng 2

Một lần chạy trong loạt full e2e khiến test mới **"adjust interleaved with an inbound"** đỏ với một promise bị **rejected**. Reproducer độc lập (`.tmp-verify/adj-inbound-deadlock.mts`, chạy service thật trên test DB) tái hiện được: **2/40 vòng — Prisma `P2034`** ("write conflict or a deadlock") bùng nổ trong path inbound (`inventory.service.ts:166`); rollback khiến **onHand = 15** (một lần +5 của inbound mất vĩnh viễn, dù giao dịch của nó vừa báo thành công ngay trước thời điểm rollback). Cơ chế (khớp FK graph):

- inbound: `requireActiveWarehouse` → **X(warehouses)** → update → **X(inventory_balances)** → chèn `inventory_movements` (FK `warehouse_id` chỉ cần **S(warehouses)**);
- sau fix 6.1, adjust: **X(inventory_balances)** trước → chèn movement → cần **S(warehouses)** đang bị inbound giữ X → vòng khóa.

### 6.3 Fix phát sinh (khép trong phạm vi BL-07)

Thêm `lockWarehouse` (FOR UPDATE trên `warehouses`, **không gate status**) và gọi trong `adjust` **trước** `getOrCreateBalance`. Mọi path ghi tồn kho giờ dẫn theo cùng thứ tự `warehouse → balance`; quy tắc nghiệp vụ **"adjust vẫn được phép chạy ở kho đã ngừng hoạt động" giữ nguyên** (docblock của `requireActiveWarehouse` ghi rõ cho phép ngoại lệ này — `lockWarehouse` chỉ giữ khóa, không chặn vì trạng thái).

- Kết quả sau fix: reproducer **60/60 vòng — 0 rejected**, onHand luôn = 20, ledger luôn 1 INBOUND + 1 ADJUSTMENT, dọn fixtures sạch (leftovers = 0) — file bằng chứng ở Phụ lục.
- **Đối soát FK để chắc chắn fix không tạo chu trình mới**: `inventory_allocations` và các bảng `orders*` không FK → `warehouses`, nên luồng checkout/cancel không giữ khóa X nào trên `warehouses` để tạo vòng ngược với X(warehouse) của adjust. Phần ghi audit log của adjust đi qua FK → users; đối soát theo cùng phương pháp cho thấy không có đường khóa ngược về `warehouses`.

### 6.4 Giới hạn trung thực — hình dạng cùng lớp còn một cặp nằm ngoài phạm vi

Cặp **cancel-quarantine ↔ inbound/document** có hình dạng vòng giống mục 6.2 trên lý thuyết (cancel giữ X(balance) rồi chèn movement cần S(warehouse), trong khi inbound giữ ngược chiều). Vòng 2 **không sửa** và không tuyên bố đã sửa; chưa từng tái hiện trong suite (stress CON-01 30 vòng trắng). Vết này **có sẵn tại HEAD**, không phải hệ quả của những gì vòng 2 thêm vào. Đề xuất đợt 3 (mục 11).

## 7. PDF flaky — nguyên nhân gốc xác định bằng bằng chứng dissect, không còn phỏng đoán

### 7.1 Chuỗi nguyên nhân (mỗi mắt xích có hiện vật)

1. `makeRunId` (base36) ngẫu nhiên có khi chứa `"fl"`, `"fi"`, `"ff"` — khớp chính xác các run fail đã lưu: `e2eexpmvfw4zsx3fl` (hậu tố fl, kèm fl ở giữa), `e2eexpmvfw505u5fi` (…fi), `e2eexpmvfw55ff3et` (…ff) (cùng với 3 run fail còn lại — tổng 6 PDF lưu).
2. Fontkit (qua PDFKit) bật mặc định `liga`: hai ký tự kề nhau hợp thành **một glyph ligature** (codePoints = 2 đơn vị UTF-16).
3. PDFKit ghi ToUnicode CMap **đúng PDF spec** (`beginbfrange` dạng array): đích của glyph đó là một token `<0066 006c>` (một token, một glyph, bên trong có 2 đơn vị). Hiện vật: `.tmp-verify/pdf-flake/fail/fail-e2eexpmvfw4zsx3fl.cmap-F3.txt`, dòng 15.
4. Test helper `parseCMap` (cũ) đọc đích array bằng regex đơn-unit `<([0-9a-fA-F]+)>` → token ligature **không khớp** → mọi đích phía sau bị **dịch lệch lên 1 ô**: `map(0x56)='-'` thay vì `'fl'`, `map(0x67)='R'` thay vì `'O'`, entry cuối mất → `"ORDEXP1"` đọc thành `"REDXP·1"` hoặc `"IREDXP·1"`; các ký tự sau vị trí ligature (`.` `₫` và chữ tiếng Việt) đều sai cùng kiểu. Chứng minh bằng script chạy trên chính cmap đã lưu: `.tmp-verify/round2-parse-probe.txt` (ví dụ: raw `00670068001b0069006a006b…` → v1 `"REDXP·1"` vs fixed `"ORDEXP1"`).
5. Dữ liệu PDF đầy đủ và chuẩn; bên đọc PDF (người dùng) thấy đúng — chỉ có **tool kiểm tự động của suite** đọc nhầm. → Sửa đúng chỗ sai: **fix ở helper, không đổi assertion**.

### 7.2 Fix — ở đúng chỗ sai

`apps/api/test/helpers/pdf-text.ts`: một regex token dùng chung `/<([0-9a-fA-F]{4}(?:\s+[0-9a-fA-F]{4})*)>/g` — **một `<…>` trọn = một glyph**, decode bằng cách nối từng đơn vị (`fromCharCode`); tự nhiên hỗ trợ surrogate pair (ký tự ngoài BMP). Áp dụng cho `bfchar` + `bfrange` dạng array; dạng triple giữ nguyên.

- **Không xóa assertion, không bỏ phép kiểm tra tiếng Việt, không hardcode RUN_ID** — mảng needle gồm 9 phần tử (các nhãn báo cáo tiếng Việt + mã đơn theo RUN_ID) và mọi assertion của test giữ nguyên như HEAD.
- **Chạy trên chính hiện vật thật**: 6 PDF fail đã lưu được helper ĐÃ SỬA đọc → **6/6 PASS** (`.tmp-verify/round2-pdf-fix-verify.txt`).
- **Stress không cần DB**: repro (`.tmp-verify/pdf-flake/repro.mts` — buildReportPdf thật + extractPdfText thật, không DB) — **trước fix 6/300 fail (số transcribe từ console), sau fix 0/300** (`.tmp-verify/round2-pdf-repro-300.txt`).
- Test PDF trong 4 full run + stress sau fix: **PASS mỗi lần**.

## 8. Kiểm tra tĩnh + unit — nền trước khi đi vào động

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npm run typecheck --workspace @agrimarket/api` | **EXIT=0** (tee'd: `.tmp-verify/typecheck-final-round.log`; chạy lại sau cả hai thay đổi source) |
| Lint (oxlint type-aware) | `npm run lint --workspace @agrimarket/api` | **EXIT=0**; 3 warning — **đúng 3 vị trí như vòng 1**, có sẵn tại HEAD (`concurrency.e2e-spec.ts:394` ×2, `warehouse-admin.e2e-spec.ts:271`) (tee'd: `.tmp-verify/lint-final-round.log`) |
| Unit (vitest) | `npm run test --workspace @agrimarket/api` | **34 file / 440 test PASS** (438 cũ + 2 test adjust mới); snapshot ngay trước khi thêm 2 test mới được tee'd trong `.tmp-verify/unit-final-round.log` (438 PASS, 9,51s) |

## 9. E2E + stress — ma trận chạy thật (test DB `agrimarket_v2_test`)

| Lần | Cấu hình | Kết quả | Thời lượng |
|---|---|---|---|
| Full e2e #1 (trước khi phát hiện lỗi phát sinh) | toàn bộ suite | **13 file / 370 test PASS** | 70,5s |
| Full e2e #2 | toàn bộ suite | **370/370 PASS** | 73,6s |
| Full e2e #3 (lần đầu) | toàn bộ suite | **369/370 — 1 fail: "adjust interleaved with an inbound"** (deadlock P2034 — mục 6.2) | 70,2s |
| Full e2e #3 (chạy lại sau fix `lockWarehouse`) | toàn bộ suite | **370/370 PASS** | 71,2s |
| Full e2e #4 | toàn bộ suite | **370/370 PASS** | 70,2s |
| Stress `CONCURRENCY_ROUNDS=30` | `concurrency*` (2 file: 19 + 29 test) | **48/48 PASS**, mỗi case 30 vòng | 159,5s |

- Ghi chú trung thực: run #3 lần đầu (369/370) **không bị che giấu** — thời điểm đó test trả đỏ, lỗi được nhận diện là lỗi thật, fix `lockWarehouse` được bổ sung rồi mới tiếp tục; các lần chạy sau đó đều trắng.
- Provenance số liệu: các run full e2e + stress ở bảng trên được **transcribe từ console** (PowerShell không tee được output sạch qua tooling); những phép thử đã **tee thành file** gồm: các log tĩnh/unit (mục 8), suite money riêng — `money-run3.log`/`money-run4.log` **19/19 PASS (9,1s / 9,3s)**, PDF 6/6 + 0/300 (mục 7), deadlock reproducer 0/60 (mục 6). Còn hiện vật vòng 1: `e2e-run-1..4.log` (359 pass + 2 expected fail; run 2 chụp đúng lần fail PDF flaky) — giữ lại làm bằng chứng "trước vá".
- Các "2 expected fail" từ vòng 1 đã biến mất: 19 test money giờ là `it()` thật. Nếu giữ `it.fails` nguyên trạng (vòng 1), suite sau fix sẽ **đỏ ngay** vì bug không còn tái hiện — đúng như vòng 1 dự báo.
- **Mọi run đều dọn fixture**: `afterAll` assert `leftovers === 0`; `purgeStaleConcurrencyFixtures` chạy trước trong `beforeAll` của mỗi describe.
- Reproducer cần chạy kèm `--tsconfig apps/api/tsconfig.json` (tsx cần `experimentalDecorators` từ tsconfig này); thiếu cờ này sẽ văng lỗi `IsOptional` decorator.

## 10. Hồi quy bắt buộc (tất cả nằm trong suite đã chạy PASS)

| Điểm hồi quy | Test đang phủ | Kết quả |
|---|---|---|
| BL-01 refund đôi / BL-02 return vượt giao | `business-rules/{refund,evidence-aftersales}.spec.ts` (unit) + 6 test money | PASS |
| settlement-create không nhân đôi | `business-rules/settlement.spec.ts` (unit) + money test + unique index | PASS |
| BUY_NOW / COD confirm / Idempotency checkout / source cart | `mutation-acceptance.e2e-spec.ts`, `business-rules/{checkout-cart-source,payment-collection}.spec.ts`, `concurrency.e2e-spec.ts` | PASS |
| FEFO / reserve / không bán vượt / quarantine / rollback | `business-rules/fefo.spec.ts`, `concurrency.e2e-spec.ts`, `checkout-hardening.spec.ts` + 2 test money "adjust ↔ checkout thật", "adjust ↔ inbound thật" | PASS |
| Voucher + Flash Sale quota | `promotion-status.e2e-spec.ts`, các case flash/voucher trong `concurrency.e2e-spec.ts` | PASS |
| Settlement/Payout phản ánh đúng số trên xlsx + PDF | `reports-export.e2e-spec.ts` (Nháp → Đã xác nhận → Đã chi trả; KPI khớp) | PASS |
| Export PDF tiếng Việt | test "exports a real PDF…" — ổn định trên 4 full run + repro 300 vòng | PASS (vòng 1: 1/4 fail) |

## 11. Quy tắc cần chủ dự án quyết định (tổng hợp vòng 2)

1. **Duyệt commit/push** branch `fix/bl-01-02-settlement-con-01` (12 file modified + thư mục migration + suite money mới + audit reports) — hiện uncommitted.
2. **Chấp nhận quy ước khóa của vòng 2 làm chuẩn thiết kế**: mọi path ghi tồn kho lấy khóa theo thứ tự `warehouse → balance` (`requireActiveWarehouse` hay `lockWarehouse` cho ngoại lệ adjust). Path mới thêm vào sau phải theo cùng quy ước; đổi quy ước = re-audit.
3. **Đợt 3 (đề xuất)**: khép hình dạng vòng khóa tương tự cho cặp **cancel-quarantine ↔ inbound/document** (mục 6.4) — đưa `lockWarehouse`/`requireActiveWarehouse` vào path cancel; vòng 2 không chạm vì nằm ngoài phạm vi hẹn và không tái hiện trong suite.
4. Nhắc lại những quyết định còn treo từ vòng 1 (mục 4 báo cáo 09, giữ nguyên giá trị): duyệt áp unique-index migration lên dev/prod (kèm pre-check trùng lặp); BL-05 — trách nhiệm refund sau settlement; BL-08 — hoàn voucher khi hủy; dữ liệu demo Flash Sale (sold=0); thiết lập CI (PRD-01).
5. **PDF test**: nếu bạn chọn thay helper tối giản bằng thư viện phân tích PDF thật, cần audit riêng về hành vi của thư viện đó; với chính PDFKit như hiện tại, helper đa-token đã đủ và không còn đọc sai ligature/astral.

## 12. Đánh giá go-live (cập nhật cho vòng 2)

- **Tiền (BL-01/BL-02/BL-06)**: khóa hàng + đối chiếu lại bên trong transaction; kịch bản chấp nhận nào cũng không cho phép vượt/refund đôi/settlement nhân đôi. Suite money 19 `it()` thật + stress 30 vòng trắng.
- **Tồn kho (BL-07)**: UPDATE nguyên tử + thứ tự khóa `warehouse → balance` → không mất increment, không mất movement, không deadlock với inbound (chạy trên service thật, 60 vòng).
- **Export PDF** ổn định (nguyên nhân gốc đã dissect + fix đúng chỗ).
- **Còn chờ trước go-live** (nguyên tắc từ vòng 1, không đổi): (a) commit/push branch; (b) duyệt + áp unique-index migration kèm pre-check; (c) hình dạng vòng khóa cancel↔inbound — khuyến nghị đợt 3; (d) phần còn lại của roadmap 47 mục chưa chạm (BL-08/BL-12/BL-16…); (e) chưa có CI.
- **Không tuyên bố hoàn tất 47 mục** — vòng 2 chỉ khép những hạng mục nó hẹn.

---

## Phụ lục — bằng chứng cục bộ (`.tmp-verify/`, gitignored)

| File | Nội dung |
|---|---|
| `pdf-flake/fail/fail-*.pdf` × 6 (`4zsx3fl`, `505u5fi`, `50qb7fl`, `51cp4fl`, `52ft7fi`, `55ff3et`) + cặp `*.cmap-F2.txt`/`*.cmap-F3.txt`, `*.diag.json`, `*.extracted.txt` | 6 hiện vật PDF fail + cmap thô + phân tích glyph; chính là dòng chứa token `<0066 006c>` và chỗ map bị dịch lệch đúng 1 ô |
| `pdf-flake/fail-e2eexpmvfw4zsx3fl.dissect.txt` + `.dissect.jsonl.txt`, `pdf-flake/fail/dissect-view.txt` | dissect từng glyph — liệt kê từng token CMap, trực quan hóa phần chuỗi bị đọc sai |
| `pdf-flake/verify-parse.mjs` → `round2-parse-probe.txt` | hành vi của hai phiên bản regex trên chính cmap đã lưu: map v1 (lệch) vs map fixed (đúng) — gồm ví dụ `ORDEXP1` vs `REDXP·1` |
| `pdf-flake/verify-fix.mts` → `round2-pdf-fix-verify.txt` | helper ĐÃ SỬA chạy trên 6 PDF fail lưu sẵn: **6/6 PASS** |
| `pdf-flake/repro.mts` → `round2-pdf-repro-300.txt` | stress PDF không DB: **0/300 fail sau fix** (**6/300** trước fix — số lần chạy đó được transcribe từ console) |
| `adj-inbound-deadlock.mts` → `round2-adj-deadlock-60.txt` | reproducer deadlock BL-07: **60/60 vòng, 0 rejected, leftovers=0** sau fix (**2/40 fail P2034** trước fix — số transcribe từ console) |
| `money-run3.log`, `money-run4.log` | suite money 19 test: **19/19 PASS** — 9,1s / 9,3s |
| `typecheck-final-round.log`, `lint-final-round.log`, `unit-final-round.log` | typecheck EXIT=0; lint: đúng 3 warning có sẵn tại HEAD; unit snapshot **438 PASS ngay trước khi thêm 2 test adjust mới** (con số lần chạy cuối: 34 file / 440 — transcribe từ console) |
| `e2e-run-1..4.log`, `e2e-full.log` + `.txt`, `pdf-flake-runs.log` | hiện vật **vòng 1** (359 pass + 2 expected fail; `e2e-run-2.log` chụp chính xác lần fail PDF flaky kèm stack; `pdf-flake-runs.log` = 5 lần chạy riêng file reports-export (mỗi lần 7/7, EXIT=0) — cho thấy việc chạy lại đơn thuần không chụp được flake, điều này thúc đẩy việc đi dissect) |
| `pdf-flake/dissect.mts`, `measure.mts`, `dotenv-probe.mts`, `adj-inbound-deadlock.mts` | scripts chẩn đoán throwaway — nên xóa sau khi báo cáo được duyệt |

Lưu ý chung về provenance: những mục **tee thành file** nêu trên có thể mở ra kiểm tra trực tiếp; những số liệu **transcribe từ console** (4 full e2e + stress 30 vòng; trước fix: 6/300 PDF và 2/40 deadlock; unit cuối 34 file / 440) gắn với lệnh chạy + exit code của lần chạy tương ứng. Toàn bộ phép thử thực hiện trong phiên làm việc ngày 2026-10-20; không có lần chạy nào sau phiên.
