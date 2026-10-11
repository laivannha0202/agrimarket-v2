# PROMPT GỬI OPEN CODE — ÁP DỤNG BỘ ẢNH VÀ HOÀN THIỆN UI AGRIMARKET MOBILE V2

Tôi gửi kèm file ZIP `AGRIMARKET_MOBILE_V2_UI_IMAGES_AND_GUIDE_20261010.zip` chứa hình ảnh tham khảo UI và hình minh họa dùng được trong ứng dụng.

Hãy đọc `03_DOCS/README_BAT_DAU.md`, `03_DOCS/ASSET_MAP.csv`, toàn bộ `01_UI_REFERENCES` và `02_APP_ASSETS`. Đối chiếu với source thực tế của AgriMarket V2, đặc biệt `apps/mobile`, Customer Web và API.

## Mục tiêu

Thiết kế lại trải nghiệm Mobile theo bảng tham khảo, nhưng **chỉ triển khai tính năng thực sự tồn tại trong Backend V2**. Giữ Expo Go và Expo Router. Không tạo lại project. Không APK/EAS, không USB bắt buộc.

## Quy tắc bắt buộc

- Sử dụng ảnh `01_UI_REFERENCES` **chỉ làm tham khảo bố cục**. Tên người dùng, giá, giảm giá, ảnh nông sản, điểm thưởng, nút đăng ký/Google login, hình ảnh trang trại trong bảng tham khảo **không phải dữ liệu có thật**. Tuyệt đối không hardcode vào app.
- Chép ảnh được chọn ở `02_APP_ASSETS` vào `apps/mobile/assets/design/` và sử dụng static `require`. Chỉ dùng các ảnh thật sự cần; không cố nhồi 12 ảnh vào tất cả màn hình.
- Ảnh sản phẩm và trang trại phải ưu tiên URL từ API. Không dùng generated product photos để thay dữ liệu hoặc giả trang trại.
- Không dùng SVG trực tiếp trong Expo Go nếu phải cài native dependency mới không phù hợp; đã có PNG sẵn.
- Không thêm font files hoặc thay hệ chữ hiện có không cần thiết.
- Khi thiết kế giao diện hãy xử lý đúng UI states: `loading`, `success_data`, `success_empty`, `error`, `offline`; không dùng empty art để che API lỗi.
- Giữ các thao tác: danh mục, sản phẩm, quy cách, giỏ hàng, COD, đơn hàng, QR, địa chỉ. Chức năng chưa có API phải báo chưa hỗ trợ, không tạo nút chết.
- Không phá Backend/Admin, không reset/reseed DEV, không xóa thay đổi chưa commit, không tự commit/push.

## Công việc cụ thể

1. Kiểm tra source, kiểm kê routes/API và các images đã dùng. Báo cáo ảnh nào cần thiết, cái nào không cần.
2. Dùng bảng tham khảo để chuẩn hóa: Header, ô tìm kiếm, sản phẩm lưới 2 cột, nhãn giá/quy cách, bottom tabs, trạng thái rỗng, thanh Mua ngay/Thêm giỏ cố định; đảm bảo Safe Area Android.
3. Tích hợp các PNG minh họa hợp lý, hạn chế clutter; không ép ảnh banner nếu màn chủ đã có dữ liệu khuyến mãi thật đủ tốt.
4. Kiểm tra ảnh lấy từ API đúng URL, tải tốt từ điện thoại; không có giá hoặc mô tả viết vào bitmap.
5. Chạy typecheck, lint, tests, kiểm thử Expo Web và Expo Go Android nếu có thiết bị. Không coi browser screenshot là kiểm thử Native.
6. Chụp các màn hình sau sửa và ghi rõ phần nào thực sự được thử trên Android.
7. Tạo báo cáo `docs/AGRIMARKET-V2-MOBILE-IMAGE-INTEGRATION.md` với bảng `Asset | Screen | Used/Not used | Reason | Test`, toàn bộ file thay đổi và bằng chứng test. Không tự tuyên bố 100% khi còn thiếu.

Làm trực tiếp trên repo AgriMarket V2 hiện tại, không làm lại từ đầu. Ưu tiên trải nghiệm mua nông sản thật: rõ ràng, gọn, chuyên nghiệp, chính xác nghiệp vụ; không giao diện kiểu AI và không thêm quảng cáo hoặc dữ liệu giả.
