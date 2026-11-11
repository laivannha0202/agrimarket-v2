# AGRIMARKET MOBILE V2 — BỘ ẢNH & GIAO DIỆN THAM KHẢO

## Cách dùng đúng

Gói này gồm **12 tài nguyên có thể dùng trong app (PNG + SVG)** và **8 ảnh thiết kế tham khảo**.

- `01_UI_REFERENCES/`: hai bảng thiết kế AI (board) và sáu màn hình cắt từ board. **Chỉ để tham khảo bố cục, không đặt vào ứng dụng làm ảnh chụp sản phẩm/giá thực**. Bảng thiết kế minh họa có thể chứa tên, giá, tính năng, nút hoặc số liệu chưa có trong Backend V2. Không sao chép chúng thành tính năng giả.
- `02_APP_ASSETS/`: 12 asset PNG dùng được trong Expo Go, kèm SVG gốc (tùy chọn cho Web). Có thể chọn một phần, không bắt buộc nhồi tất cả vào UI.
- `03_DOCS/ASSET_MAP.csv`: vị trí dùng từng ảnh + kích thước + SHA256.
- `03_DOCS/PROMPT_OPEN_CODE_ATTACH_WITH_ZIP.md`: prompt gửi OpenCode cùng ZIP này.

## Quy tắc không được sai

1. **Sản phẩm, hình sản phẩm, trang trại có ảnh thật, giá, SKU/quy cách, voucher, tồn kho, đánh giá, chứng nhận và thông tin QR phải lấy từ Backend API**. Không dùng ảnh tham khảo UI hay minh họa thành dữ liệu thật.
2. Banner `hero_nong_san_no_text_1200x480` là **minh họa nhận diện thương hiệu**, không phải một Flash Sale, không được gán ngày giờ/giảm giá giả.
3. `farm_fallback` chỉ là **ảnh dự phòng minh họa**, không phải hình trang trại được xác thực.
4. Hình `trace_scan_illustration` không chứa mã QR có thể quét, không hiển thị như kết quả truy xuất.
5. Nếu đã có logo doanh nghiệp hợp lệ, ưu tiên logo chính thức thay vì logo lá mẫu.
6. Chỉ hiển thị danh mục API thực sự trả về. Các icon minh họa là tùy chọn, không tự thêm danh mục mới.
7. Các màn hình tham khảo là gợi ý về phân cấp, lưới 2 cột, khoảng cách và màu sắc; các yếu tố như đăng ký, Google login, ví tiền, điểm thưởng và các mức giá trong hình **không phải yêu cầu phát triển** nếu Backend V2 chưa hỗ trợ.

## Tích hợp nhanh (Expo Go)

Giải nén, chép nội dung `02_APP_ASSETS` vào `apps/mobile/assets/design/` (đúng cấu trúc thư mục). Trong React Native, dùng `Image` hoặc `expo-image` **nếu đã có và tương thích**. Dùng static `require(...)` cho ảnh đóng gói.

Ví dụ trong `apps/mobile/app/(tabs)/index.tsx`:

```tsx
import { Image } from 'react-native';

<Image
  source={require('../../assets/design/home/hero_nong_san_no_text_1200x480.png')}
  resizeMode="cover"
  style={{ width: '100%', height: 150, borderRadius: 12 }}
  accessibilityLabel="Minh họa nông sản AgriMarket"
/>
```

Sử dụng layout thực tế để tránh cắt phần hình minh họa và không che chữ. Không nhúng thông tin tính tiền vào ảnh; chữ, nút và dữ liệu phải hiển thị bằng component từ API.

## Phân bổ ảnh đề xuất

| Màn hình | Tài nguyên | Ghi chú |
|---|---|---|
| Trang chủ | `home/hero_nong_san_no_text_1200x480.png` | Tùy chọn; tránh lặp/banner quá to |
| Danh mục | `categories/*_256.png` | Chỉ khi API có đúng danh mục đó |
| Trang trại | `farm/farm_fallback_1000x600.png` | Chỉ khi không có ảnh thật |
| Truy xuất | `trace/trace_scan_illustration_640x440.png` | Chỉ là minh họa nhỏ, không thay camera |
| Giỏ chưa có hàng | `empty_states/empty_cart_360.png` | Error != empty |
| Đơn hàng rỗng | `empty_states/empty_orders_360.png` | Sau đăng nhập và tải thành công |
| Tìm kiếm không kết quả | `empty_states/empty_search_360.png` | Sau request thành công trả danh sách rỗng |
| Mất kết nối | `empty_states/empty_network_360.png` | Có nút Thử lại |

## Font và icon

Không đóng gói **font files**. Dùng hệ thống chữ đang có của Expo/React Native. Dùng Ionicons đã cài trong app; không thay hệ icon bằng ký tự tam giác/emoji hoặc ép dùng SVG cho React Native.

## Gợi ý palette (không bắt buộc override theme)

Primary `#087A3B` · Deep green `#065E32` · Pale green `#E8F7EE` · Background `#F7FAF8` · Text `#192526` · Danger `#D94D36` · Border `#E4EBE6`.

**Chỉ thay theme nếu không làm lệch Customer Web.** Ưu tiên tái sử dụng token thật từ codebase.
