# AGRIMARKET — BỘ DỮ LIỆU XÃ/PHƯỜNG HƯNG YÊN

**Đối chiếu đến ngày 10/10/2026**; không tuyên bố có văn bản ban hành riêng trong năm 2026. Danh mục áp dụng từ 01/07/2025 theo các văn bản quy định và nguồn tra cứu đính kèm.

## Nội dung ZIP

- `hung_yen_104_xa_phuong_2026.json`: JSON có metadata và 104 đơn vị với mã chuẩn.
- `hung_yen_104_xa_phuong_2026.csv`: CSV mở bằng Excel, mã cột `code` phải được giữ kiểu chuỗi.
- `DANH_SACH_104_XA_PHUONG.md`: bảng dễ đọc gồm toàn bộ 104 mã và tên.
- `HUONG_DAN_OPEN_CODE.md`: chỉ dẫn để AI nhập dữ liệu và nối API mà không phá dữ liệu cũ.
- `validate_dataset.py`: chạy `python validate_dataset.py` để đối chiếu JSON/CSV và các điều kiện không trùng.
- `SOURCE_METADATA.json`: thông tin nguồn, mốc đối chiếu và giới hạn.
- `SHA256SUMS.txt`: mã băm các file đầu ra.

## Nguồn chính

1. Quyết định **19/2025/QĐ-TTg** (30/06/2025, hiệu lực 01/07/2025): bảng mã cấp tỉnh và cấp xã, tỉnh Hưng Yên `33`.
   https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/19ttg.signed.pdf
2. Nghị quyết **1666/NQ-UBTVQH15** (16/06/2025): thành lập 104 xã/phường Hưng Yên mới.
   https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-1666-nq-ubtvqh15-sap-xep-cac-dvhc-cap-xa-cua-tinh-hung-yen-nam-2025-119250616195158879.htm
3. Bảng mã do Thư Viện Pháp Luật trích từ Mục 33 Phụ lục II Quyết định 19/2025/QĐ-TTg:
   https://thuvienphapluat.vn/hoi-dap-phap-luat/danh-sach-ma-dvhc-cap-xa-cua-tinh-hung-yen-sau-sap-nhap-nhu-the-nao-138057463.html

## Phạm vi và bảo đảm chất lượng

- **104 đơn vị: 93 xã + 11 phường**, mã cấp tỉnh: `33`.
- Mã xã/phường là **5 chữ số dạng string**, không đổi sang số nguyên trong JSON/DB.
- `fullName` có tiền tố `Xã`/`Phường`. `name` không có tiền tố.
- `searchText` là giá trị hỗ trợ tìm kiếm không dấu, không phải tên pháp lý.
- Địa chỉ mới hiển thị `Chi tiết, thôn/TDP (nếu có), xã/phường, tỉnh Hưng Yên`; **không bắt huyện**.
- **KHÔNG bao gồm danh sách thôn/tổ dân phố.** Không tự phát sinh thôn/TDP giả, không mặc định tất cả 104 xã đã có dữ liệu thôn.
- Không có GPS/ranh giới/địa chỉ số nhà trong danh mục này.
- Các địa chỉ/đơn hàng lịch sử vẫn phải được bảo toàn.
- Các tệp liên quan chứa dẫn nguồn, không chứa PDF gốc của văn bản; có thể mở URL ở trên khi cần.

**Lưu ý:** Đối chiếu theo các nguồn công khai truy xuất được đến 10/10/2026; không phát hiện văn bản thay thế danh mục 104 đơn vị trong lần tra cứu này. Khi đưa lên hệ thống, nên kiểm tra lại cổng thông tin chính phủ nếu có văn bản mới sau thời điểm trên.
