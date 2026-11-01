# Kế hoạch nghiệm thu Staging / UAT — AgriMarket V2

**Trạng thái tài liệu:** kế hoạch + biên bản trống. **Không phải** biên bản PASS.
**Ngày tạo:** 01/11/2026 (vòng 29)
**Phạm vi:** môi trường staging/UAT thật, có người nghiệm thu. Mọi mục dưới đây chỉ được
đánh dấu PASS khi có người ký và bằng chứng đính kèm.

> Quy tắc: mục nào chưa chạy thì ghi **NOT RUN**. Không suy diễn từ kết quả local
> (`verify:local`, Playwright) sang staging. Không sửa quy tắc tài chính để "vượt" một
> blocker UAT.

---

## 1. Vai trò và người chịu trách nhiệm

| Vai trò | Trách nhiệm | Tên | Ký |
|---|---|---|---|
| Release owner | Điều phối, quyết định go/no-go | | |
| Kế toán trưởng (hoặc người được uỷ quyền tài chính) | Duyệt quy trình chặn quyết toán thiếu bằng chứng; duyệt đối soát dòng tiền | | |
| Trưởng kho | Nhập/xuất, kiểm kê, hoàn hàng | | |
| Trưởng vận hành giao nhận | COD, giao thất bại, hoàn hàng | | |
| QA | Chạy kịch bản, ghi bằng chứng | | |
| IT/DevOps | Cấu hình, migration, backup, rollback | | |

---

## 2. Cấu hình môi trường (bắt buộc trước khi test)

| # | Hạng mục | Cách kiểm | Kết quả | Bằng chứng |
|---|---|---|---|---|
| 2.1 | `NODE_ENV=production` ở API | `printenv NODE_ENV` | NOT RUN | |
| 2.2 | `DATABASE_URL` trỏ đúng schema staging (không phải `*_test`, không phải dev) | `SELECT DATABASE()` | NOT RUN | |
| 2.3 | `TEST_DATABASE_URL` **không** tồn tại trên staging | `printenv TEST_DATABASE_URL` (phải rỗng) | NOT RUN | |
| 2.4 | `JWT_SECRET` riêng cho staging, khác dev/production | So sánh độ dài/nguồn cấp phát, **không** in giá trị | NOT RUN | |
| 2.5 | `CORS_ORIGIN` chỉ chứa origin staging (không `*`) | Gọi thử từ origin lạ → bị chặn | NOT RUN | |
| 2.6 | `PAYMENTS_ONLINE_ENABLED` | Xem mục 6 — phải là `false` khi chưa có gateway | NOT RUN | |
| 2.7 | `NEXT_PUBLIC_API_BASE_URL` của Admin/Customer trỏ API staging | Kiểm tra Network tab | NOT RUN | |
| 2.8 | SMTP/mail: gửi thử 1 email thật | Hộp thư nhận được | NOT RUN | |
| 2.9 | Upload (ảnh sản phẩm, chứng từ) ghi được và đọc lại được sau restart | Upload → restart → mở ảnh | NOT RUN | |
| 2.10 | Reverse proxy: HTTPS, `X-Forwarded-*`, giới hạn body | `curl -I` + upload lớn hơn giới hạn | NOT RUN | |
| 2.11 | Đồng hồ hệ thống (timezone) | So `SELECT NOW()` với giờ Việt Nam | NOT RUN | |

---

## 3. An toàn migration

| # | Hạng mục | Cách kiểm | Kết quả |
|---|---|---|---|
| 3.1 | Danh sách migration khớp repo | `npx prisma migrate status` trên staging | NOT RUN |
| 3.2 | Không có migration mới chưa được rehearsal trên bản sao | Đối chiếu `prisma/migrations` với bản chạy thử | NOT RUN |
| 3.3 | Rehearsal trên bản sao dữ liệu thật (restore → migrate) | Theo `docs/DEPLOYMENT-ROLLBACK-RUNBOOK.md` §4.2 | NOT RUN |
| 3.4 | Thời gian migrate đo được trên bản sao | Ghi số phút + kích thước bảng | NOT RUN |
| 3.5 | Migration không phá dữ liệu lịch sử tiền | So `SUM(payments.amount)`, `SUM(refunds.amount)`, `SUM(settlements.payable_amount)` trước/sau | NOT RUN |
| 3.6 | `scripts/verify-migrations.mjs` PASS trên staging | Chạy script | NOT RUN |
| 3.7 | `scripts/db-invariant-audit.mjs` PASS trên staging | Chạy script, lưu JSON | NOT RUN |

---

## 4. Backup trước triển khai

| # | Hạng mục | Cách kiểm | Kết quả |
|---|---|---|---|
| 4.1 | Backup full ngay trước deploy | `npm run backup:db` (hoặc mysqldump theo runbook) | NOT RUN |
| 4.2 | Backup **được restore thử** ở schema tạm | `npm run restore:db` vào schema tạm, đếm bảng/dòng | NOT RUN |
| 4.3 | Checksum backup được lưu cùng biên bản | `SHA256SUMS` | NOT RUN |
| 4.4 | Thời điểm backup + người thực hiện được ghi | Bảng này | NOT RUN |
| 4.5 | Có bản backup thứ hai ngoài máy chủ | Vị trí lưu trữ | NOT RUN |

---

## 5. Rollback

| # | Hạng mục | Cách kiểm | Kết quả |
|---|---|---|---|
| 5.1 | Rollback ứng dụng (không đụng DB) đã diễn tập | `docs/DEPLOYMENT-ROLLBACK-RUNBOOK.md` §6.2 | NOT RUN |
| 5.2 | Rollback DB (restore) đã diễn tập trên schema tạm | §6.3 | NOT RUN |
| 5.3 | Thời gian rollback đo được | Ghi số phút | NOT RUN |
| 5.4 | Sau rollback: đăng nhập, xem đơn, xem đối soát vẫn chạy | Smoke tối thiểu | NOT RUN |
| 5.5 | Dữ liệu phát sinh trong lúc lỗi được đối chiếu trước khi restore | Danh sách đơn/khoản tiền phát sinh | NOT RUN |
| 5.6 | Không rollback migration bằng cách sửa tay bảng tiền | Xác nhận quy trình | NOT RUN |

---

## 6. Thanh toán online (chưa tích hợp — kiểm tra "không bật nhầm")

| # | Hạng mục | Cách kiểm | Kết quả |
|---|---|---|---|
| 6.1 | `PAYMENTS_ONLINE_ENABLED=false` | `GET /payments/methods` chỉ trả `COD` | NOT RUN |
| 6.2 | Bật cờ nhưng **không** có adapter → vẫn chỉ `COD` | Đặt cờ `true`, gọi lại, khôi phục cờ | NOT RUN |
| 6.3 | Không tồn tại màn hình/endpoint tạo giao dịch VNPAY/MoMo/ZaloPay giả | Rà route + UI checkout | NOT RUN |
| 6.4 | Không có credential sandbox bị commit | `git grep -i "vnpay\|momo\|zalopay"` không có secret | NOT RUN |
| 6.5 | Điều kiện triển khai gateway thật được ghi rõ | Xem §6.1 dưới | NOT RUN |

**Điều kiện triển khai gateway thật (chưa đáp ứng):** hợp đồng merchant + credential
sandbox, endpoint callback/IPN có xác thực chữ ký, đối soát tự động với sao kê, quy trình
hoàn tiền qua gateway, và một vòng UAT tài chính. Cho tới khi đó, phương thức online phải
ở trạng thái không khả dụng — đây là thiết kế, không phải bug.

---

## 7. Kiểm thử người dùng (UAT) theo nghiệp vụ

Mỗi kịch bản: người thực hiện, thời điểm, dữ liệu dùng, ảnh chụp, kết quả.

### 7.1. Tài khoản và phân quyền

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.1.1 | Đăng nhập ADMIN / CUSTOMER | Vào đúng khu vực | NOT RUN |
| 7.1.2 | CUSTOMER gọi `GET /finance/reconciliation` | 403 | NOT RUN |
| 7.1.3 | Khách A mở đơn của khách B | 403/404, không lộ dữ liệu | NOT RUN |
| 7.1.4 | Tài khoản INACTIVE đăng nhập | Bị từ chối | NOT RUN |

### 7.2. COD và thu tiền

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.2.1 | Đặt đơn COD → giao thành công → admin ghi nhận thu | Payment PAID có `paid_at`, đơn hiện "Đã thu đủ" | NOT RUN |
| 7.2.2 | Giao thất bại → hoàn hàng | Không ghi nhận thu; tồn kho về đúng | NOT RUN |
| 7.2.3 | Ghi nhận thu thiếu (dữ liệu lịch sử) | Đơn hiện "Thu thiếu" trong đối chiếu dòng tiền | NOT RUN |
| 7.2.4 | Payment PAID nhưng thiếu `paid_at` | Đơn hiện "Thiếu bằng chứng thu tiền", tiền **không** được tính | NOT RUN |

### 7.3. Kho

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.3.1 | Nhập kho theo phiếu | Tồn tăng đúng, có movement | NOT RUN |
| 7.3.2 | Xuất kho theo đơn | Tồn giảm đúng, FEFO | NOT RUN |
| 7.3.3 | Kiểm kê điều chỉnh | Có movement + audit | NOT RUN |
| 7.3.4 | Hàng cách ly → giải phóng / tiêu huỷ | Tồn và trạng thái đúng | NOT RUN |

### 7.4. Giao nhận

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.4.1 | Tạo vận đơn, cập nhật trạng thái | Đơn và vận đơn khớp | NOT RUN |
| 7.4.2 | Giao thất bại → hoàn | Tồn kho + trạng thái đơn đúng | NOT RUN |
| 7.4.3 | Huỷ đơn khi đang giao | Có lời nhắn huỷ, hàng vào cách ly | NOT RUN |

### 7.5. Trả hàng và hoàn tiền

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.5.1 | Yêu cầu trả → nhận hàng → QC | Đúng luồng trạng thái | NOT RUN |
| 7.5.2 | Hoàn một phần | Payment `PARTIALLY_REFUNDED`, đối chiếu hiện "Hoàn một phần", không có vấn đề | NOT RUN |
| 7.5.3 | Hoàn toàn bộ | Payment `REFUNDED`, refundState `FULL` | NOT RUN |
| 7.5.4 | Hoàn tiền thiếu reference | Không cho COMPLETED | NOT RUN |
| 7.5.5 | Đặt tay trạng thái `REFUNDED` qua `PATCH /payments/:id/status` | Bị từ chối | NOT RUN |

### 7.6. Quyết toán và chi trả

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.6.1 | Tạo kỳ quyết toán có đơn thu đủ | Tạo được, số liệu khớp | NOT RUN |
| 7.6.2 | Tạo kỳ có đơn **chưa thu đủ** | Đơn bị loại, có log cảnh báo | NOT RUN |
| 7.6.3 | Kỳ không còn đơn đủ điều kiện | 400 với thông báo nghiệp vụ | NOT RUN |
| 7.6.4 | Hoàn tiền sau khi đã quyết toán | Sinh adjustment OPEN, chặn confirm/payout | NOT RUN |
| 7.6.5 | Duyệt adjustment / recovery | Có ghi chú, có người duyệt | NOT RUN |
| 7.6.6 | Tạo payout khi còn adjustment OPEN | Bị chặn | NOT RUN |
| 7.6.7 | Đánh dấu payout PAID | Có audit, không sửa số liệu kỳ | NOT RUN |

### 7.7. Hoá đơn và phiếu in

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.7.1 | PDF đơn hàng | Logo, font tiếng Việt, dòng tiền, tổng thanh toán đúng | NOT RUN |
| 7.7.2 | PDF phiếu soạn hàng | Đúng SKU/lô/số lượng, không lộ giá | NOT RUN |
| 7.7.3 | In từ trình duyệt | Khổ A4, không cắt dòng | NOT RUN |
| 7.7.4 | Bảng kê quyết toán (xlsx/pdf) | Số liệu khớp màn hình | NOT RUN |

### 7.8. Truy xuất nguồn gốc

| # | Kịch bản | Kỳ vọng | Kết quả |
|---|---|---|---|
| 7.8.1 | Quét QR lô | Trang công khai hiển thị đúng chuỗi | NOT RUN |
| 7.8.2 | Lô bị thu hồi | Cảnh báo thu hồi rõ ràng | NOT RUN |
| 7.8.3 | Audit chuỗi truy xuất (admin) | Báo thiếu mắt xích nếu có | NOT RUN |

---

## 8. Cổng phê duyệt tài chính (bắt buộc)

Thay đổi từ vòng 28 **chặn quyết toán** khi đơn chưa có bằng chứng thu đủ tiền
(`collected ≥ grand_total`, tính từ payment có `paid_at` và khác `FAILED`). Đây là thay
đổi quy tắc tài chính, nên **không được** coi là PASS nếu chỉ có QA chạy.

| # | Điều kiện | Người duyệt | Ngày | Bằng chứng |
|---|---|---|---|---|
| 8.1 | Kế toán trưởng đọc và hiểu quy tắc "đã thu đủ" (định nghĩa trong `docs/BUSINESS-RULES.md`) | | | Biên bản họp/email |
| 8.2 | Kế toán xác nhận danh sách đơn bị loại khỏi kỳ quyết toán là **đúng** (không phải lỗi dữ liệu) | | | Ảnh màn hình + danh sách mã đơn |
| 8.3 | Quy trình xử lý đơn bị loại được chấp thuận: ghi nhận thu còn thiếu → tạo kỳ mới (không sửa tay payment) | | | Quy trình ký |
| 8.4 | Quy trình hoàn tiền sau quyết toán (adjustment/recovery) được chấp thuận | | | Quy trình ký |
| 8.5 | Người có quyền duyệt adjustment/recovery được chỉ định bằng tên | | | Danh sách |
| 8.6 | Báo cáo đối chiếu dòng tiền được dùng làm báo cáo kỳ (tần suất, người xem) | | | Biên bản |

**Không có 8.1–8.5 thì không được go-live.** Nếu kế toán yêu cầu đổi ngưỡng/định nghĩa,
thay đổi đó phải làm ở backend + test, không được nới ở UI.

---

## 9. Biên bản tổng hợp

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| Cấu hình môi trường (§2) | NOT RUN | |
| Migration (§3) | NOT RUN | |
| Backup (§4) | NOT RUN | |
| Rollback (§5) | NOT RUN | |
| Thanh toán online (§6) | NOT RUN | |
| UAT nghiệp vụ (§7) | NOT RUN | |
| Phê duyệt tài chính (§8) | NOT RUN | **blocker go-live** |

**Kết luận staging/UAT:** NOT RUN — chưa có môi trường staging và người nghiệm thu.
