# YÊU CẦU TRIỂN KHAI API ĐỊA CHỈ HƯNG YÊN CHO AGRIMARKET V2

Đây là bộ dữ liệu đã đối chiếu đầy đủ 104 xã/phường tỉnh Hưng Yên (93 xã, 11 phường) theo Nghị quyết 1666/NQ-UBTVQH15 và mã chính thức Quyết định 19/2025/QĐ-TTg, đối chiếu đến 10/10/2026.

## Nhiệm vụ cho OpenCode

1. ĐỌC file `hung_yen_104_xa_phuong_2026.json`, `README.md`, `SOURCE_METADATA.json` và chạy `python validate_dataset.py` trước khi thực hiện.
2. KIỂM TRA repository AgriMarket V2 đang làm, Prisma schema, API controllers/service và UI address forms trên cả Customer Web + Expo Go. Tái sử dụng cấu trúc địa chỉ nếu đã có, tránh tạo bảng và dịch vụ trùng chức năng.
3. Import/upsert (idempotent) danh mục 104 xã/phường bằng **code string 5 ký tự** + `provinceCode: "33"`, `fullName`, `type`. Nếu bảng dữ liệu cũ dùng tên xã, ánh xạ an toàn không tự gộp bằng tên mơ hồ. **Không truncate, drop, reseed hoặc overwrite DEV**. Nếu cần migration, review an toàn và test trên TEST DB trước; yêu cầu người dùng duyệt trước mọi thay đổi dữ liệu lịch sử có khả năng gây mất mát.
4. Backend cung cấp API đọc tỉnh và xã/phường Hưng Yên theo hợp đồng hiện tại hoặc route tối thiểu, ví dụ `GET /locations/provinces/33/wards?q=`. Không bắt client gọi API bên thứ ba. API trả mã chuẩn, tên chuẩn, loại, tỉnh, có tìm kiếm không dấu và phân trang nếu cần. Không tự tạo thêm API nếu API cũ đã tương đương.
5. Customer Web và Expo Go: tỉnh Hưng Yên mặc định; xã/phường dropdown searchable lấy từ API; thôn/TDP **nhập tự do hoặc gợi ý theo dữ liệu xác minh có sẵn**, không bắt khách chọn giá trị không tồn tại; địa chỉ chi tiết bắt buộc, số điện thoại và tên người nhận bắt buộc; không bắt chọn huyện theo mô hình hành chính mới và không bắt postcode.
6. Backend validate bằng mã xã/phường (không tin tên tự nhập từ frontend); chỉ ghi snapshot hiển thị địa chỉ trên đơn mới, không sửa đơn cũ; giữ địa chỉ lịch sử. Giá giao hàng/quy tắc vùng giao tiếp tục do backend quyết định.
7. Test thật: đếm 104 (93 + 11), mã unique, tìm không dấu/có dấu, CRUD sổ địa chỉ, chọn mặc định, luồng checkout-preview, COD trên TEST DB, Mobile và Web dùng chung API, dữ liệu đơn cũ không đổi. Không đánh dấu PASS nếu chưa chạy.
8. Giao diện gọn, dễ chọn, không chữ giải thích thừa. Không thêm quận/huyện cũ, xã cũ hoặc thôn/TDP giả.
9. Bảo toàn mọi file chưa commit. Không reset/hủy thay đổi, không tự commit/push, không build APK/EAS và không sửa nghiệp vụ Admin không liên quan.
10. Cuối cùng tạo báo cáo danh sách file sửa, endpoint, schema/migration, số bản ghi thực tế, kết quả test, các xã thiếu danh mục thôn/TDP (nếu kiểm tra), hướng dẫn chạy Expo Go.

HÃY THỰC HIỆN TRÊN SOURCE V2 HIỆN CÓ, KHÔNG TẠO LẠI ỨNG DỤNG.
