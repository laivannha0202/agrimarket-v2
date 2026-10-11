# Ảnh hiện trạng → thay đổi cần làm (sử dụng cùng prompt 01)

**Quan trọng**: Tất cả ảnh trong `anh_hien_trang/` là ảnh chụp giao diện *trước khi sửa*. OpenCode phải **giữ đặc trưng thương hiệu AgriMarket**, nhưng KHÔNG sao chép nguyên lỗi hoặc các đoạn chữ thừa. Các ảnh có hiển thị thông tin cá nhân được che một phần trong bản bàn giao.

| Mã ảnh | Màn hình hiện có | Vấn đề quan sát được | Đích thiết kế / hành vi |
|---|---|---|---|
| 01 | Tài khoản đã đăng nhập | Menu khá gọn nhưng nhiều khoảng trắng; nút sửa nằm trong card riêng | Header hồ sơ + menu nhóm ngắn, mở trang Sửa hồ sơ riêng |
| 02 | Chọn tỉnh từ Sổ địa chỉ | Bottom sheet tỉnh một lựa chọn; có thể nháy chuyển sheet khác | Nếu chỉ giao Hưng Yên, tỉnh hiển thị readonly, không cần sheet |
| 03 | Chọn xã/phường | Sheet danh sách 104 xã có search; hiện bug mở/đóng theo tỉnh | Sheet chỉ mở do bấm Xã/phường, Back/X/backdrop đóng ổn định |
| 04 | Địa chỉ đã lưu + form Thêm | Form quá dài, luôn mở dưới danh sách; mô tả kỹ thuật nhiều | Danh sách address + nút Thêm; form trang riêng; ít chữ |
| 05 | Khiếu nại | Bắt gõ `orderId`, không ảnh; giải thích dài | Chọn từ Đơn hàng / nút từ chi tiết đơn, có ảnh minh chứng riêng tư |
| 06 | Trả hàng | Bắt gõ `orderItemId`, không ảnh | Chọn sản phẩm từ đơn đủ điều kiện, chọn lượng và ảnh bằng chứng |
| 07 | Đánh giá của tôi | Bắt gõ `orderItemId`, ngôi sao nút vuông; không ảnh | Chọn item đã giao, 1–5 sao rõ, ảnh thực tế, trạng thái duyệt |
| 08 | Danh sách trang trại | 4 ảnh minh họa giống nhau; tên địa danh/huyện cũ | Ảnh thật nếu có bằng chứng và nguồn hợp pháp; nếu không placeholder trung tính; địa chỉ đúng dữ liệu pháp lý |
| 09 | Hồ sơ đang sửa | Form Sửa bung ngay trong tab Tài khoản | Route sửa thông tin riêng, tab chỉ là hub |
| 10 | Đăng nhập cũ | Từng không có đăng ký công khai | Giữ luồng đã được sửa, không hồi quy |
| 11 | Form Đăng ký | Trước đây có lời giới thiệu thừa, validation chưa đồng nhất | Giữ phiên UI fix mới nhất, kiểm tra trên Expo Go |
| 12 | Tài khoản chưa đăng nhập | Đã có nút đăng ký nhưng từng nhiều khoảng trống | Giữ UI gọn, nút rõ, không thêm thông điệp dài |
| 13 | Trang chủ | Banner minh họa, danh mục chữ R, Flash Sale dài | Giữ cấu trúc, cải thiện icon nếu có nguồn, hạn chế lặp, giá/timer lấy API |
| 14 | Sản phẩm nổi bật | Danh sách quá dài, nhiều card | Trang chủ xem một tập chọn lọc, Xem tất cả mở catalog |
| 15 | Đáy trang chủ và trang trại | Hàng sản phẩm còn lẻ; địa chỉ cũ | Giới hạn hiển thị trang chủ; chuẩn hóa địa chỉ có căn cứ |
| 16 | Chi tiết sản phẩm phần đầu | Ảnh tốt, một vài thông tin lặp | Giữ ảnh/CTA; quy cách/giá rõ; QR liên kết đúng nguồn |
| 17 | Chi tiết sản phẩm phần dưới | Mô tả/đánh giá, sticky CTA | Đảm bảo sticky CTA không che scroll; rating approved |
| 18 | Chi tiết trang trại | Quá ít thông tin hữu ích; tọa độ/mã kỹ thuật | Tối ưu cho khách: chứng nhận hợp lệ, nguồn gốc, sản phẩm; không phóng đại chứng nhận |
| 19 | Danh sách sản phẩm | Các card khá tốt | Giữ thiết kế, rà soát ảnh/crop, search/filter rõ |
| 20 | Tìm kiếm `rau` | 14/14 vẫn chưa đổi trong ảnh khi đang nhập | Xác minh hành vi search sau submit/debounce, không kết luận sai chỉ từ ảnh đang gõ |
| 21 | Flash Sale cận cảnh | Tên “cuối tuần” nhưng đếm ngược 27 ngày | Kiểm toán thời gian/quota theo API, không đổi sai record |

## 3 mô hình hành vi quan trọng

### Địa chỉ

- **Đang ở Sổ địa chỉ** → bấm **Thêm** → chuyển form; khách không phải cuộn qua form chưa cần.
- **Form mới** → Tỉnh: “Hưng Yên” chỉ đọc → bấm Xã/phường → tìm/chọn → đóng sheet → trở lại form giữ nguyên dữ liệu.
- **Hủy sheet** (nút X, ngoài sheet, Android Back) → chỉ đóng sheet, không tự mở sheet khác và không xóa input.

### Khiếu nại / Trả hàng / Đánh giá

- **Đơn hàng của tôi** → **Chi tiết** → sản phẩm phù hợp → nút thao tác có điều kiện → form đã có context.
- **Tài khoản** → các danh sách yêu cầu/đánh giá → chọn đơn/sản phẩm nếu cần → không dùng ID kỹ thuật.
- **Gửi** → chỉ báo thành công khi backend tạo request và liên kết ảnh theo thiết kế; hiển thị trạng thái.

### Ảnh

- `+ Thêm ảnh` → thư viện/camera trên Expo Go → thumbnails 1..5 → xóa/đổi chọn → upload an toàn → record backend gắn đúng ID → khách/ADMIN xem theo quyền.
- Đánh giá chưa duyệt: ảnh không public. Khiếu nại và trả hàng: ảnh không public, kể cả có URL đoán được.

## Bộ tiêu chí thiết kế

- Đơn giản, tự nhiên, ưu tiên người Việt mua nông sản.
- Phân cấp rõ (screen title 16–18, section 14–16, text 13–15, caption 12–13 tương đối), vùng chạm >= 44dp, hỗ trợ accessibility, tương phản chữ hợp lý.
- Ít card, ít border, không gradient/emoji và không dùng hình minh họa giả làm bằng chứng.
- Ảnh là bằng chứng hiện trạng để agent nhìn lỗi; **không phải tài liệu chứng minh chức năng đã PASS**.
