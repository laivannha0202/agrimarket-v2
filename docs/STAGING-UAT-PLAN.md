# Kế hoạch nghiệm thu Staging / UAT — AgriMarket V2

**Trạng thái tài liệu:** kế hoạch + biên bản trống. **Không phải** biên bản PASS.
**Phiên bản:** vòng 30 — 03/11/2026 (kế thừa vòng 29).
**Phạm vi:** môi trường staging/UAT thật, có người nghiệm thu. Mọi mục dưới đây chỉ được
đánh dấu PASS khi có người ký và bằng chứng đính kèm.

> Quy tắc: mục nào chưa chạy thì ghi **NOT RUN**. Không suy diễn từ kết quả local
> (`verify:local`, Playwright) sang staging. Không sửa quy tắc tài chính để "vượt" một
> blocker UAT. Không sửa tay bảng tiền để làm một dòng biến thành PASS.

---

## 0. Quy ước kết quả và bằng chứng

| Ký hiệu | Nghĩa | Điều kiện |
|---|---|---|
| NOT RUN | Chưa thực hiện | Mặc định cho mọi dòng mới |
| PASS | Đạt | Có người thực hiện + thời điểm + bằng chứng đính kèm |
| FAIL | Không đạt | Có mô tả lỗi, ảnh/log, mã đơn/khoản tiền tái hiện được |
| BLOCKED | Không thể chạy | Ghi rõ phụ thuộc (môi trường, người, credential) |
| N/A | Không áp dụng | Chỉ dùng khi phạm vi không có (phải ghi lý do) |

- Tên bằng chứng: `UAT-<gate>-<id>-<yyyymmdd>-<nn>.<ext>` (ảnh, log, PDF, JSON).
- Bằng chứng lưu trong thư mục dùng chung của đợt UAT, **không** commit dữ liệu khách hàng thật.
- Chỉ người có tên trong §1 được ký PASS. QA chạy kịch bản không thay thế chữ ký kế toán.
- Kết quả local (verify:local, Playwright, load test) là **điều kiện vào cửa**, không phải
  bằng chứng UAT.

---

## 1. Vai trò, người chịu trách nhiệm và thời gian biểu

Mã vai trò dùng trong các bảng: **RO** release owner, **ACC** kế toán (trưởng hoặc được uỷ
quyền tài chính), **WH** trưởng kho, **OPS** trưởng vận hành giao nhận, **QA** kiểm thử,
**IT** IT/DevOps.

| Vai trò | Trách nhiệm chính | Tên | Điện thoại/email | Ký |
|---|---|---|---|---|
| RO | Điều phối, chặn/mở cổng, quyết định go/no-go | | | |
| ACC | Duyệt quy tắc "đã thu đủ", duyệt đối soát dòng tiền, duyệt xử lý chênh lệch | | | |
| WH | Nhập/xuất, kiểm kê, nhận hàng hoàn, cách ly | | | |
| OPS | COD, giao thất bại, hoàn hàng, đối chiếu tiền thu hộ | | | |
| QA | Chạy kịch bản, ghi bằng chứng, mở lỗi | | | |
| IT | Cấu hình, migration, backup, deploy, rollback | | | |

**Thời gian biểu tối thiểu**

| Mốc | Việc | Chủ trì | Đầu ra |
|---|---|---|---|
| T-5 ngày | Chốt người, lịch, dữ liệu mẫu, tài khoản | RO | Bảng §1 đã điền |
| T-3 ngày | Dựng staging, cấu hình §3, chạy migration rehearsal trên bản sao | IT | Biên bản §3–§4 |
| T-2 ngày | Backup + restore drill + rollback drill | IT | Biên bản §5–§7 |
| T-1 ngày | Deploy RC, smoke, khóa thanh toán online | IT + QA | Biên bản §6, §8 |
| T-0 | UAT nghiệp vụ §9, đối soát §10 | QA + ACC + WH + OPS | Biên bản §9–§10 |
| T+1 | Họp go/no-go, ký §11 | RO | Quyết định cuối |

---

## 2. Cổng GO/NO-GO

Không được nhảy cổng. Mỗi cổng chỉ mở khi **tất cả** điều kiện của cổng đó PASS và có chữ ký.

| Cổng | Tên | Điều kiện mở cổng | Người duyệt |
|---|---|---|---|
| G0 | Sẵn sàng môi trường | §3 đủ 11/11 PASS; không còn `TEST_DATABASE_URL`; `PAYMENTS_ONLINE_ENABLED=false` | IT + RO |
| G1 | Sẵn sàng dữ liệu | §4 migration + §5 backup/restore + §7 rollback drill PASS; số liệu tiền trước/sau khớp | IT + ACC |
| G2 | Deploy RC | §6 deploy + smoke PASS; lỗi P0/P1 bằng 0 | RO |
| G3 | UAT nghiệp vụ | §9 tất cả kịch bản bắt buộc PASS (hoặc FAIL có biên bản chấp nhận rủi ro do RO ký) | QA + RO |
| G4 | Phê duyệt tài chính | §10.3 đủ 10.1–10.8, đặc biệt quy trình `MISSING_COLLECTION_EVIDENCE` | ACC |
| G5 | Go-live | G0–G4 PASS + §10.4 xử lý xong + không còn blocker P0 | RO |

**NO-GO tự động** khi bất kỳ điều nào sau đây đúng:

- Còn đơn đã quyết toán nhưng chưa thu đủ tiền mà chưa có biên bản xử lý.
- Có refund `COMPLETED` nhưng payment không có `paid_at`.
- `PAYMENTS_ONLINE_ENABLED=true` khi chưa có adapter/gateway thật.
- Backup chưa restore thử được.
- Chưa có chữ ký ACC ở §10.3.
- Còn lỗi P0 (mất tiền, lộ dữ liệu, sai tồn kho, không đăng nhập được).

---

## 3. Cấu hình môi trường (bắt buộc trước khi test)

Danh sách đầy đủ biến môi trường API/web ở `docs/DEPLOYMENT-ROLLBACK-RUNBOOK.md`
§2.2–§2.3. Bảng dưới là các kiểm tra bắt buộc trước UAT.

Mỗi dòng: chạy lệnh, ghi kết quả thật, đính bằng chứng, người thực hiện.

| # | Hạng mục | Cách kiểm | Kỳ vọng | Người | Kết quả | Bằng chứng |
|---|---|---|---|---|---|---|
| 3.1 | `NODE_ENV=production` ở API | `printenv NODE_ENV` trên tiến trình API | `production` | IT | NOT RUN | |
| 3.2 | `DATABASE_URL` trỏ đúng schema staging | `SELECT DATABASE();` | schema staging, không `*_test`, không dev | IT | NOT RUN | |
| 3.3 | `TEST_DATABASE_URL` **không** tồn tại trên staging | `printenv TEST_DATABASE_URL` | rỗng | IT | NOT RUN | |
| 3.4 | `JWT_SECRET` riêng cho staging | So nguồn cấp phát/độ dài, **không** in giá trị | khác dev/production, ≥ 32 byte ngẫu nhiên | IT | NOT RUN | |
| 3.5 | `CORS_ORIGIN` chỉ chứa origin staging | Gọi từ origin lạ | bị chặn, không có `*` | IT | NOT RUN | |
| 3.6 | `PAYMENTS_ONLINE_ENABLED` | `printenv` + `GET /api/v1/payments/methods` | `false`; chỉ trả `COD` | IT | NOT RUN | |
| 3.7 | `NEXT_PUBLIC_API_BASE_URL` của Admin/Customer | Network tab | trỏ API staging, không localhost | IT | NOT RUN | |
| 3.8 | SMTP/mail | Gửi thử 1 email thật (quên mật khẩu) | nhận được trong 2 phút | IT | NOT RUN | |
| 3.9 | Upload ghi/đọc bền | Upload ảnh → restart API → mở lại | ảnh còn, đúng URL | IT | NOT RUN | |
| 3.10 | Reverse proxy | `curl -I`; upload vượt giới hạn | HTTPS, `X-Forwarded-*` đúng, body bị chặn đúng ngưỡng | IT | NOT RUN | |
| 3.11 | Đồng hồ/timezone | `SELECT NOW();` so giờ Việt Nam | lệch ≤ 5 giây; hiển thị đúng GMT+7 | IT | NOT RUN | |

---

## 4. An toàn migration

| # | Bước | Cách làm | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 4.1 | Chụp trạng thái trước | `npx prisma migrate status` trên staging | danh sách khớp repo, không có migration lạ | IT | NOT RUN |
| 4.2 | Đối chiếu migration | So `apps/api/prisma/migrations` với bản đã rehearsal | không có migration mới chưa diễn tập | IT | NOT RUN |
| 4.3 | Rehearsal trên bản sao | Restore bản sao dữ liệu thật → chạy `npm run db:deploy` | không lỗi; thời gian đo được | IT | NOT RUN |
| 4.4 | Đo thời gian | Ghi số phút + kích thước bảng lớn nhất | nằm trong cửa sổ bảo trì đã chốt | IT | NOT RUN |
| 4.5 | Bảo toàn số liệu tiền | So `SUM(payments.amount)`, `SUM(refunds.amount)`, `SUM(settlements.payable_amount)` trước/sau | khớp tuyệt đối | ACC | NOT RUN |
| 4.6 | Kiểm tra migration | `npm run verify:migrations` trên staging | PASS | IT | NOT RUN |
| 4.7 | Kiểm tra bất biến | `npm run verify:invariants` trên staging, lưu JSON | PASS, 0 vi phạm | IT | NOT RUN |

> Nếu 4.3 hoặc 4.5 FAIL: dừng, không deploy. Không sửa migration đã phát hành; tạo migration mới.

---

## 5. Backup trước triển khai

| # | Bước | Cách làm | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 5.1 | Backup full ngay trước deploy | `BACKUP_CONFIRM=YES BACKUP_DATABASE_URL=... npm run backup:db -- --out backups` | tạo `.sql.gz` + sidecar `.json` | IT | NOT RUN |
| 5.2 | Ghi checksum | `sha256sum backups/<file>` lưu cùng biên bản | khớp sidecar | IT | NOT RUN |
| 5.3 | Restore thử schema tạm | `RESTORE_DATABASE_URL=...<schema>_drill RESTORE_CONFIRM=RESTORE npm run restore:db -- --file <dump> --create-database` | restore thành công, đếm bảng/dòng khớp | IT | NOT RUN |
| 5.4 | Đối chiếu số dòng bảng tiền | Đếm `orders`, `payments`, `refunds`, `settlements`, `payouts` trước/sau restore | khớp | ACC | NOT RUN |
| 5.5 | Bản backup thứ hai ngoài máy chủ | Copy sang kho lưu trữ thứ hai | tồn tại, đọc lại được | IT | NOT RUN |
| 5.6 | Ghi người + thời điểm | Điền bảng này | đủ thông tin truy vết | IT | NOT RUN |

> Backup chưa restore thử = chưa có backup. Không được bỏ qua 5.3.
> Nếu shell đặt `NODE_ENV=production`, script backup từ chối chạy nếu thiếu
> `BACKUP_CONFIRM=YES`. Lệnh restore phải chạy với `NODE_ENV` **khác** `production`
> (script từ chối `NODE_ENV=production`) và target phải kết thúc `_drill`, không trùng
> schema `DATABASE_URL`.

---

## 6. Deploy RC và smoke

| # | Bước | Cách làm | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 6.1 | Ghi lại SHA phát hành | `git rev-parse HEAD` trên artefact deploy | đúng SHA được duyệt | IT | NOT RUN |
| 6.2 | Deploy API | Quy trình của đơn vị vận hành | tiến trình lên, health check 200 | IT | NOT RUN |
| 6.3 | Deploy Admin/Customer web | Build từ cùng SHA | trang đăng nhập mở được | IT | NOT RUN |
| 6.4 | Smoke đăng nhập | ADMIN + CUSTOMER | vào đúng khu vực | QA | NOT RUN |
| 6.5 | Smoke đọc dữ liệu | Danh sách đơn, sản phẩm, tồn kho | 200, số liệu không rỗng | QA | NOT RUN |
| 6.6 | Smoke PDF | Tải 1 PDF đơn + 1 phiếu soạn hàng | mở được, tiếng Việt đúng | QA | NOT RUN |
| 6.7 | Smoke đối soát | Mở `/reconciliation` | tải được, không lỗi 500 | QA | NOT RUN |
| 6.8 | Kiểm tra log | 15 phút sau deploy | không có lỗi 5xx lặp lại | IT | NOT RUN |

---

## 7. Rollback

**Cây quyết định**

- Lỗi chỉ ở ứng dụng, DB chưa bị ghi sai → rollback artefact (§7.1).
- Migration đã chạy và dữ liệu tiền sai → **không** rollback schema bằng tay; restore từ §5
  vào schema mới, đối chiếu dữ liệu phát sinh, rồi chuyển hướng (runbook §6.3).
- Không chắc → dừng, gọi RO và IT, không tự xử lý.

| # | Bước | Cách làm | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 7.1 | Rollback ứng dụng | Triển khai lại artefact SHA trước | health check 200 | IT | NOT RUN |
| 7.2 | Rollback DB (restore) | Theo `docs/DEPLOYMENT-ROLLBACK-RUNBOOK.md` §6.3 | dữ liệu về mốc backup | IT | NOT RUN |
| 7.3 | Đo thời gian | Bấm giờ từ quyết định đến smoke xong | nằm trong RTO đã chốt | IT | NOT RUN |
| 7.4 | Smoke sau rollback | Đăng nhập, xem đơn, xem đối soát, tải PDF | chạy được | QA | NOT RUN |
| 7.5 | Đối chiếu dữ liệu phát sinh trong lúc lỗi | Liệt kê đơn/khoản tiền tạo sau mốc backup | có danh sách, ACC xác nhận xử lý | ACC | NOT RUN |
| 7.6 | Xác nhận không sửa tay bảng tiền | Kiểm tra audit + binlog nếu có | không có UPDATE tay | IT | NOT RUN |

---

## 8. Thanh toán online (chưa tích hợp — kiểm tra "không bật nhầm")

| # | Hạng mục | Cách kiểm | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 8.1 | Cờ tắt | `GET /payments/methods` | chỉ `COD` | IT | NOT RUN |
| 8.2 | Bật cờ nhưng không có adapter | Đặt `true`, gọi lại, khôi phục `false` | vẫn chỉ `COD` | IT | NOT RUN |
| 8.3 | Không có endpoint/màn hình gateway giả | Rà route + UI checkout | không có VNPAY/MoMo/ZaloPay | QA | NOT RUN |
| 8.4 | Không có credential bị commit | `git grep -i vnpay`, `momo`, `zalopay` | không có secret | IT | NOT RUN |
| 8.5 | Điều kiện mở gateway được ghi rõ | §8.1 dưới | có biên bản | RO | NOT RUN |

**Điều kiện triển khai gateway thật (chưa đáp ứng):** hợp đồng merchant + credential
sandbox, endpoint callback/IPN có xác thực chữ ký, đối soát tự động với sao kê, quy trình
hoàn tiền qua gateway, và một vòng UAT tài chính. Cho tới khi đó, phương thức online phải
ở trạng thái không khả dụng — đây là thiết kế, không phải bug.

---

## 9. Kiểm thử người dùng (UAT) theo nghiệp vụ

Mỗi kịch bản: người thực hiện, thời điểm, dữ liệu dùng, ảnh chụp, kết quả. Cột "Bước"
là thứ tự thao tác tối thiểu; có thể bổ sung bước phụ nhưng không bỏ bước.

**Tổng số: 43 kịch bản** — 9.1: 4; 9.2: 5; 9.3: 4; 9.4: 3; 9.5: 6; 9.6: 8;
9.7: 4; 9.8: 3; 9.9: 6. Trọng tâm bắt buộc của RC: COD (9.2), kho (9.3), refund
(9.5), settlement/payout (9.6), PDF (9.7) và truy xuất nguồn gốc (9.8).

### 9.1. Tài khoản và phân quyền

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.1.1 | Đăng nhập ADMIN / CUSTOMER | Mở web → nhập tài khoản → đăng nhập | vào đúng khu vực, không lộ menu sai quyền | QA | NOT RUN |
| 9.1.2 | CUSTOMER gọi đối soát | Lấy token CUSTOMER → `GET /api/v1/finance/reconciliation` | 403 | QA | NOT RUN |
| 9.1.3 | Khách A mở đơn của khách B | Đăng nhập A → mở URL đơn của B → tải PDF đơn B | 403/404, không lộ dữ liệu | QA | NOT RUN |
| 9.1.4 | Tài khoản INACTIVE đăng nhập | Admin khoá tài khoản → thử đăng nhập | bị từ chối, thông báo rõ | QA | NOT RUN |

### 9.2. COD và thu tiền

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.2.1 | Đặt COD → giao → thu tiền | Khách đặt COD → admin xác nhận đơn → giao → admin `PATCH /payments/:id/status` PAID kèm reference | Payment PAID có `paid_at`, đơn hiện "Đã thu đủ", đối soát không báo lỗi | OPS | NOT RUN |
| 9.2.2 | Giao thất bại → hoàn hàng | Đánh dấu giao thất bại → hoàn kho | Không ghi nhận thu; tồn kho về đúng; có movement | OPS + WH | NOT RUN |
| 9.2.3 | Ghi nhận thu thiếu | Dùng đơn test có payment nhỏ hơn `grand_total` (tạo bằng dữ liệu test, không sửa DB thật) | Đơn hiện "Thu thiếu" trong `/reconciliation` | ACC | NOT RUN |
| 9.2.4 | Payment PAID thiếu `paid_at` | Dùng fixture test đã chuẩn bị sẵn | Đơn hiện "Thiếu bằng chứng thu tiền"; tiền **không** được tính; đơn bị loại khỏi kỳ quyết toán | ACC | NOT RUN |
| 9.2.5 | Xác nhận COD khi chưa giao | Gọi PAID trên đơn chưa DELIVERED | 400, thông báo "chỉ xác nhận sau khi giao" | QA | NOT RUN |

### 9.3. Kho

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.3.1 | Nhập kho theo phiếu | Tạo phiếu nhập → duyệt → xem tồn | Tồn tăng đúng, có movement + audit | WH | NOT RUN |
| 9.3.2 | Xuất kho theo đơn | Xác nhận đơn → xem phân bổ lô | Tồn giảm đúng, FEFO (lô hết hạn trước) | WH | NOT RUN |
| 9.3.3 | Kiểm kê điều chỉnh | Tạo phiếu kiểm kê → duyệt chênh lệch | Có movement + audit, không sửa tay | WH | NOT RUN |
| 9.3.4 | Hàng cách ly | Đưa hàng vào cách ly → giải phóng/tiêu huỷ | Tồn và trạng thái đúng, có chứng từ | WH | NOT RUN |

### 9.4. Giao nhận

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.4.1 | Tạo vận đơn, cập nhật trạng thái | Tạo shipment → cập nhật trạng thái | Đơn và vận đơn khớp | OPS | NOT RUN |
| 9.4.2 | Giao thất bại → hoàn | Đánh dấu thất bại → nhận hoàn | Tồn kho + trạng thái đơn đúng | OPS + WH | NOT RUN |
| 9.4.3 | Huỷ đơn khi đang giao | Huỷ đơn đã xuất kho | Có lý do huỷ, hàng vào cách ly, tồn đúng | OPS + WH | NOT RUN |

### 9.5. Trả hàng và hoàn tiền

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.5.1 | Yêu cầu trả → nhận → QC | Khách tạo return → admin duyệt → kho nhận → QC | Đúng luồng trạng thái, có audit | OPS + WH | NOT RUN |
| 9.5.2 | Hoàn một phần | Tạo refund một phần → approve → complete kèm reference | Payment `PARTIALLY_REFUNDED`, đối soát "Hoàn một phần", không có issue | ACC | NOT RUN |
| 9.5.3 | Hoàn toàn bộ | Refund toàn bộ → approve → complete | Payment `REFUNDED`, `refundState=FULL` | ACC | NOT RUN |
| 9.5.4 | Hoàn tiền thiếu reference | Gọi complete không có reference | 400, refund vẫn APPROVED | ACC | NOT RUN |
| 9.5.5 | Đặt tay trạng thái REFUNDED | `PATCH /payments/:id/status` → REFUNDED | 400, không đổi trạng thái | QA | NOT RUN |
| 9.5.6 | Hoàn tiền sau quyết toán | Quyết toán → refund → complete | Sinh adjustment OPEN, chặn confirm/payout | ACC | NOT RUN |

### 9.6. Quyết toán và chi trả

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.6.1 | Tạo kỳ có đơn thu đủ | Chọn đối tác + kỳ → tạo settlement | Tạo được, gross/refund/commission/payable khớp | ACC | NOT RUN |
| 9.6.2 | Tạo kỳ có đơn chưa thu đủ | Tạo kỳ chứa đơn under-collected | Đơn bị loại, có log cảnh báo, số liệu chỉ gồm đơn đủ | ACC | NOT RUN |
| 9.6.3 | Kỳ không còn đơn đủ điều kiện | Tạo kỳ rỗng | 400 với thông báo nghiệp vụ | ACC | NOT RUN |
| 9.6.4 | Hoàn tiền sau khi đã quyết toán | Complete refund trên đơn đã settle | Sinh adjustment OPEN, chặn confirm/payout | ACC | NOT RUN |
| 9.6.5 | Duyệt adjustment / recovery | Mở adjustment → review → ghi chú + người duyệt | Lưu đúng người, thời điểm, lý do | ACC | NOT RUN |
| 9.6.6 | Tạo payout khi còn adjustment OPEN | Tạo payout | 400, thông báo phải xử lý adjustment | ACC | NOT RUN |
| 9.6.7 | Đánh dấu payout PAID | `POST /payouts/:id/pay` | Có audit, không sửa số liệu kỳ | ACC | NOT RUN |
| 9.6.8 | Xuất bảng kê quyết toán | `GET /settlements/:id/export?format=xlsx` và `format=pdf` | Số liệu khớp màn hình, mở được | ACC | NOT RUN |

### 9.7. Hoá đơn và phiếu in

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.7.1 | PDF đơn hàng | Mở đơn → "Xem trước" → tải PDF | Logo, font tiếng Việt, dòng tiền, tổng thanh toán đúng | QA | NOT RUN |
| 9.7.2 | PDF phiếu soạn hàng | Mở đơn → tải phiếu soạn hàng | Đúng SKU/lô/số lượng, không lộ giá | WH | NOT RUN |
| 9.7.3 | In từ trình duyệt | Mở preview → "In phiếu" → chọn A4 | Không cắt dòng, đủ trang | QA | NOT RUN |
| 9.7.4 | Bảng kê quyết toán | Xuất xlsx + pdf | Số liệu khớp màn hình | ACC | NOT RUN |

### 9.8. Truy xuất nguồn gốc

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.8.1 | Quét QR lô | Quét mã trên bao bì → mở trang công khai (`GET /api/v1/trace/:traceCode`) | Đúng chuỗi truy xuất, đúng lô | QA | NOT RUN |
| 9.8.2 | Lô bị thu hồi | Mở lô đã đánh dấu thu hồi | Cảnh báo thu hồi rõ ràng | QA | NOT RUN |
| 9.8.3 | Audit chuỗi (admin) | Mở audit truy xuất | Báo thiếu mắt xích nếu có, không bịa | QA | NOT RUN |

### 9.9. Giỏ hàng, Mua ngay, Voucher

| # | Kịch bản | Bước thực hiện | Kỳ vọng | Người | Kết quả |
|---|---|---|---|---|---|
| 9.9.1 | Mua từ giỏ | Thêm 2 sản phẩm → checkout | Đơn tạo đúng dòng, giỏ được dọn | QA | NOT RUN |
| 9.9.2 | Mua ngay | "Mua ngay" 1 sản phẩm → checkout | Đơn tạo đúng, giỏ **không** bị đổi | QA | NOT RUN |
| 9.9.3 | Voucher hợp lệ | Áp mã → xem preview → đặt | Giảm đúng, tổng khớp preview | QA | NOT RUN |
| 9.9.4 | Voucher hết lượt | Dùng mã đã hết `usage_limit` | 400, không tạo đơn | QA | NOT RUN |
| 9.9.5 | Voucher sai điều kiện | Mã dưới giá trị tối thiểu / hết hạn | 400, thông báo đúng | QA | NOT RUN |
| 9.9.6 | Giữ hàng hết hạn | Tạo đơn PENDING_CONFIRMATION → chờ quá TTL | Đơn hết hạn, tồn kho được giải phóng | QA + WH | NOT RUN |

---

## 10. Cổng phê duyệt tài chính (bắt buộc)

### 10.1. Hai quy tắc phải được kế toán hiểu và duyệt

**Quy tắc A — "đã thu đủ" (dùng cho quyết toán).**
`collected = SUM(payments.amount)` chỉ tính payment có `paid_at` và status khác `FAILED`.
Đơn chỉ được đưa vào kỳ quyết toán khi `collected + 0.01 >= grand_total`.
Đơn không đủ điều kiện bị **loại khỏi kỳ** (không bị sửa), có log cảnh báo.

**Quy tắc B — `MISSING_COLLECTION_EVIDENCE` (dùng cho đối soát).**
Payment ở trạng thái `PAID` / `PARTIALLY_REFUNDED` / `REFUNDED` nhưng `paid_at IS NULL`.
Hệ quả: số tiền của payment đó **không** được tính vào `collected`; đơn có thể hiện
"Thu thiếu"; đơn cũng bị loại khỏi quyết toán. Đây là tín hiệu **dữ liệu thiếu bằng chứng**,
không phải một trạng thái hợp lệ.

> **Chính sách tạm thời của RC:** payment `PAID` thiếu `paid_at` bị **chặn khỏi
> settlement**, **không backfill tự động**, **không sửa tay DB**. Đơn bị loại khỏi kỳ
> quyết toán và chỉ được xử lý theo quy trình có biên bản ACC ký tại §10.2.

### 10.2. Quy trình kế toán xác nhận `MISSING_COLLECTION_EVIDENCE` (làm trước khi áp dụng vận hành thật)

1. **Xuất báo cáo**: Admin → `/reconciliation` → lọc `issue = MISSING_COLLECTION_EVIDENCE`,
   chọn kỳ → xuất/lưu danh sách mã đơn + ảnh màn hình. Lưu cả JSON nếu có.
2. **Đối chiếu nguồn tiền**: với từng đơn, ACC đối chiếu (a) sao kê ngân hàng, (b) biên bản
   thu COD của đơn vị giao, (c) xác nhận giao hàng. Ghi rõ nguồn cho từng dòng.
3. **Phân loại từng dòng**:
   - **Đã thực thu** → nếu chọn phương án (b) tại 10.4, ghi nhận lại bằng chứng qua công cụ
     backfill có audit; nếu chọn (a), loại đơn khỏi kỳ và lưu chứng từ ngoài hệ thống.
     Không sửa tay DB.
   - **Chưa thực thu** → giữ nguyên; đơn không được quyết toán; xử lý như đơn thu thiếu.
   - **Nghi ngờ sai dữ liệu** → chuyển IT điều tra, không tự sửa.
4. **Lập biên bản**: bảng mã đơn, số tiền, nguồn đối chiếu, kết luận, người xác nhận.
5. **Chốt danh sách loại trừ**: ACC ký danh sách đơn bị loại khỏi kỳ quyết toán.
6. **Chỉ sau khi 1–5 xong** mới được dùng báo cáo này cho vận hành thật.
7. **Định kỳ**: lặp lại mỗi kỳ quyết toán; lưu biên bản cùng hồ sơ kỳ.

### 10.2.1. Mẫu danh sách đơn cần kế toán xác minh (điền cho từng kỳ)

| # | Mã đơn | Payment ID | Số tiền | Trạng thái | `paid_at` | Nguồn đối chiếu | Ngày đối chiếu | Kết luận | Xử lý đề xuất | ACC xác nhận | Bằng chứng |
|---|---|---|---:|---|---|---|---|---|---|---|---|
| 1 | | | | PAID | NULL | Sao kê / Biên bản COD / Xác nhận giao | | Đã thu / Chưa thu / Nghi sai dữ liệu | Loại khỏi kỳ / Chờ duyệt backfill | | Số chứng từ |

**Nguyên tắc audit cho từng dòng:**

- Mỗi dòng phải truy được về **một** mã đơn, **một** payment và **một** nguồn chứng từ.
- Kết luận "đã thu" chỉ được ghi khi có chứng từ đối chiếu; không suy đoán từ trạng thái payment.
- Không sửa trực tiếp bảng `payments`. Nếu sau này chọn phương án (b), công cụ backfill phải
  được duyệt riêng, có audit log, chạy từng dòng theo phiếu ACC ký và có kế hoạch rollback.
- Danh sách + biên bản ký + ảnh màn hình được lưu cùng hồ sơ kỳ quyết toán; không commit
  dữ liệu khách hàng thật vào Git.
- Kỳ quyết toán chỉ được chốt khi mọi dòng `MISSING_COLLECTION_EVIDENCE` đã có kết luận
  và chữ ký ACC, hoặc đã được loại khỏi kỳ bằng biên bản.

### 10.3. Bảng ký duyệt

| # | Điều kiện | Người duyệt | Ngày | Bằng chứng |
|---|---|---|---|---|
| 10.1 | ACC đọc và hiểu quy tắc "đã thu đủ" (`docs/BUSINESS-RULES.md`) | | | Biên bản họp/email |
| 10.2 | ACC xác nhận danh sách đơn bị loại khỏi kỳ quyết toán là **đúng** | | | Ảnh màn hình + danh sách mã đơn |
| 10.3 | Quy trình xử lý đơn bị loại được chấp thuận: theo phương án (a) hoặc (b) tại §10.4; không sửa tay payment | | | Quy trình ký |
| 10.4 | Quy trình hoàn tiền sau quyết toán (adjustment/recovery) được chấp thuận | | | Quy trình ký |
| 10.5 | Người có quyền duyệt adjustment/recovery được chỉ định bằng tên | | | Danh sách |
| 10.6 | Báo cáo đối chiếu dòng tiền được dùng làm báo cáo kỳ (tần suất, người xem) | | | Biên bản |
| 10.7 | **Quy trình `MISSING_COLLECTION_EVIDENCE` tại §10.2 được ACC ký duyệt** | | | Biên bản + danh sách đơn mẫu |
| 10.8 | ACC xác nhận **không** có đơn nào bị sửa tay trong quá trình đối chiếu | | | Biên bản |

**Không có đủ 10.1–10.8 thì không được go-live.** Nếu kế toán yêu cầu đổi ngưỡng/định nghĩa,
thay đổi đó phải làm ở backend + test, không được nới ở UI.

### 10.4. Giới hạn đã biết về đường sửa dữ liệu (phải quyết định trước UAT)

Hiện **không có** endpoint nghiệp vụ để đặt `paid_at` cho một payment đã ở trạng thái `PAID`
(`PATCH /payments/:id/status` với cùng trạng thái là no-op). Vì vậy:

- Với dòng `MISSING_COLLECTION_EVIDENCE` đã thực thu, **không được** sửa tay DB trong UAT.
- Cần một trong hai quyết định của chủ dự án trước khi áp dụng vận hành thật:
  (a) chấp nhận loại các đơn này khỏi quyết toán và xử lý ngoài hệ thống có chứng từ, hoặc
  (b) duyệt một công cụ backfill có audit (chỉ chạy khi ACC ký từng dòng).
- Không dùng UAT để thử trực tiếp trên dữ liệu thật.

---

## 11. Biên bản tổng hợp

| Hạng mục | Kết quả | Người ký | Ngày | Ghi chú |
|---|---|---|---|---|
| Cấu hình môi trường (§3) | NOT RUN | | | |
| Migration (§4) | NOT RUN | | | |
| Backup (§5) | NOT RUN | | | |
| Deploy + smoke (§6) | NOT RUN | | | |
| Rollback (§7) | NOT RUN | | | |
| Thanh toán online (§8) | NOT RUN | | | |
| UAT nghiệp vụ (§9) | NOT RUN | | | |
| Phê duyệt tài chính (§10) | NOT RUN | | | **blocker go-live** |
| Thiết bị thật (báo cáo vòng 30, §7) | NOT VERIFIED | | | Không có thiết bị trong phiên |

**Kết luận staging/UAT:** NOT RUN — chưa có môi trường staging và người nghiệm thu.
**Không được ghi PRODUCTION-READY từ tài liệu này.**
