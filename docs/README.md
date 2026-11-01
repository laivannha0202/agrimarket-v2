# Tài liệu AgriMarket V2

Một điểm vào duy nhất cho tài liệu của repo. Hai loại tài liệu **không** trộn lẫn:

- **Hiện hành** — mô tả hệ thống đang chạy. Sửa khi hành vi thay đổi.
- **Lịch sử** — biên bản nghiệm thu của một vòng cụ thể. **Không sửa nội dung**;
  chỉ đọc để tra cứu bằng chứng. Khi cần nêu lại kết quả cũ, hãy liên kết tới
  báo cáo gốc thay vì chép lại.

## 1. Bắt đầu

| Tài liệu | Nội dung |
|---|---|
| [`../README.md`](../README.md) | Cài đặt từng bước, tài khoản demo, lệnh thường dùng, xử lý sự cố |
| [`DOMAIN.md`](DOMAIN.md) | Mô hình miền: đối tác, lô, đơn, tồn kho, quyết toán |
| [`BUSINESS-RULES.md`](BUSINESS-RULES.md) | Quy tắc nghiệp vụ bắt buộc (tiền, tồn kho, trạng thái) |
| [`DATABASE.md`](DATABASE.md) | Schema, migration, invariant ở mức database |
| [`API.md`](API.md) | Hợp đồng REST: endpoint, quyền, mã lỗi |
| [`CONCURRENCY-AUDIT.md`](CONCURRENCY-AUDIT.md) | Thứ tự lock và các race đã đóng |

## 2. Vận hành

| Tài liệu | Nội dung |
|---|---|
| [`DEPLOYMENT-ROLLBACK-RUNBOOK.md`](DEPLOYMENT-ROLLBACK-RUNBOOK.md) | Triển khai và rollback |
| [`BACKUP-RESTORE-RUNBOOK.md`](BACKUP-RESTORE-RUNBOOK.md) | Sao lưu, phục hồi, diễn tập |

Cổng kiểm chứng cục bộ: `npm run verify:local` (xem `scripts/local-verify.mjs`).
Invariant dữ liệu: `npm run verify:invariants` → `scripts/db-invariant-audit.mjs`.

## 3. Báo cáo nghiệm thu (lịch sử)

Các báo cáo theo vòng nằm ở [`../audit-reports/`](../audit-reports/), đánh số
`01`…`28`. Đọc báo cáo mới nhất trước; báo cáo cũ chỉ dùng để tra cứu bằng chứng.

Biên bản theo từng hạng mục nằm trong thư mục này, tiền tố `AGRIMARKET-V2-`:

| Nhóm | Tài liệu |
|---|---|
| Xác thực / địa chỉ | `AGRIMARKET-V2-AUTH-UI-FIX.md`, `AGRIMARKET-V2-ADDRESS-AUTH-ACCEPTANCE.md` |
| Customer Web | `AGRIMARKET-V2-CUSTOMER-WEB-FINAL-ACCEPTANCE.md`, `AGRIMARKET-V2-CHECKOUT-PROMOTION-UI-FIX.md` |
| Mobile | `AGRIMARKET-V2-MOBILE-ACCEPTANCE.md`, `AGRIMARKET-V2-MOBILE-UI-FINAL-AUDIT.md`, `AGRIMARKET-V2-MOBILE-UI-KIT-FINAL.md`, `AGRIMARKET-V2-MOBILE-UX-AFTERSALES-FINAL-ACCEPTANCE.md`, `AGRIMARKET-V2-MOBILE-API-CONNECTION-FIX.md`, `AGRIMARKET-V2-EXPO-CORS-ICON-FIX.md`, `AGRIMARKET-V2-STANDARD-EXPO-GO-ACCEPTANCE.md`, `AGRIMARKET-V2-STABLE-LAN-EXPO-ACCEPTANCE.md` |
| Admin / kho | `ADMIN-V2-TASKS.md`, `ADMIN-V2-REPORT.md`, `AGRIMARKET-V2-FINAL-ADMIN-WAREHOUSE-ACCEPTANCE.md` |
| Dữ liệu / nghiệp vụ | `AGRIMARKET-V2-FINAL-DATA-BUSINESS-AUDIT.md`, `AGRIMARKET-V2-FINAL-DATA-CONSISTENCY-ACCEPTANCE.md`, `AGRIMARKET-V2-FINAL-BUSINESS-AUDIT.md`, `AGRIMARKET-V2-INVENTORY-FEFO-RECONCILIATION.md`, `AGRIMARKET-V2-CERTIFICATE-EXPIRATION-ACCEPTANCE.md` |
| Tổng hợp / bàn giao | `AGRIMARKET-V2-FINAL-ACCEPTANCE.md`, `AGRIMARKET-V2-FINAL-SYSTEM-ACCEPTANCE.md`, `AGRIMARKET-V2-GITHUB-FINAL-HANDOFF.md` |
| Chia sẻ Web–Mobile | `AGRIMARKET-V2-WEB-MOBILE-SHARED-CONSOLIDATION.md` |

Ảnh chụp UI dùng làm bằng chứng: `audit-reports/assets/` và
`apps/mobile/.qa-shots/` (được sinh bởi `apps/mobile/scripts/cart-roundtrip.mjs`
và được trích dẫn trong `AGRIMARKET-V2-MOBILE-UI-KIT-FINAL.md`).

> `../AgriMarket-V2-Kiem-Toan-Cheo-90c28de.md` là tài liệu riêng của chủ dự án
> (kiểm toán chéo bộ 8 báo cáo). Giữ nguyên tại root, không sửa, không di chuyển.

## 4. Quy ước khi thêm tài liệu

1. Hướng dẫn/kiến trúc/hợp đồng đang có hiệu lực → `docs/`, cập nhật bảng ở mục 1–2.
2. Biên bản nghiệm thu một vòng → `audit-reports/NN-….md`, không thêm vào mục 1–2.
3. Không tạo tài liệu mới chỉ để lặp lại nội dung đã có — liên kết tới tài liệu gốc.
4. Đổi tên/đường dẫn tài liệu đang được script hoặc báo cáo trích dẫn thì phải
   cập nhật mọi tham chiếu trong cùng thay đổi.
