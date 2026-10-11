# Bố cục tham chiếu theo từng màn hình

**Lưu ý:** Các `png` trong `01_UI_REFERENCES` là mockup mô tả mong muốn về hình thức. Chúng không chứng minh bất kỳ chức năng/API nào đang có và có thể chứa nội dung dựng mẫu không chính xác.

1. **Trang chủ:** thương hiệu + tìm kiếm + danh mục + các nhóm sản phẩm thật; `home/hero_...` chỉ là banner trang trí tùy chọn.
2. **Sản phẩm:** lọc/danh mục gọn, 2 cột, ảnh thật từ API, thẻ giá/quy cách đồng bộ.
3. **Chi tiết sản phẩm:** gallery ảnh thật, giá theo variant, chọn quy cách/số lượng, CTA mua hàng rõ.
4. **Trang trại:** ảnh thật nếu có, card nhất quán; thiếu ảnh mới dùng `farm_fallback`.
5. **Giỏ hàng:** hiện sản phẩm/giá từ API; empty graphic chỉ khi giỏ tải thành công nhưng rỗng.
6. **Tài khoản:** các chức năng được Backend hỗ trợ; không nhét wishlist/điểm thưởng/Google login nếu không có API thật.
7. **Truy xuất:** form ngắn, kết quả lô thật, camera thật; hình scan chỉ dùng minh họa.
8. **Đăng nhập:** giảm chữ, bảo mật token, không vẽ nút OAuth giả.
9. **Checkout:** hiển thị preview từ backend; COD theo contract; không tính grandTotal ở client.

Mục tiêu thiết kế: nâng chất lượng UI/UX nhưng **không đánh đổi tính trung thực của dữ liệu và nghiệp vụ**.
