# Checklist nghiệm thu nhanh sau khi OpenCode sửa

## A. Expo Go trực tiếp (người dùng thao tác)

- [ ] Khởi động Backend thật + Expo Go LAN, không APK/EAS/USB bắt buộc.
- [ ] Mở Sổ địa chỉ: chỉ thấy danh sách và CTA Thêm, không có form dài mặc định.
- [ ] Mở Thêm: tỉnh Hưng Yên không bật sheet không cần thiết.
- [ ] Mở/đóng Xã phường >10 lần, không nháy/chuyển sheet bất thường.
- [ ] Tìm xã/phường có dấu/không dấu, kết quả thật; không mất form khi đóng sheet.
- [ ] Tạo/sửa/xóa địa chỉ trên tài khoản thử, Web thấy cùng bản ghi.
- [ ] Đơn đã giao → đánh giá từ đơn; không gõ orderItemId.
- [ ] Đơn đủ điều kiện → trả hàng và khiếu nại từ đơn; không gõ orderId/orderItemId.
- [ ] Chọn ảnh thư viện, preview, xóa, tối đa 5, gửi thành công trên TEST.
- [ ] Mất mạng khi gửi: lỗi rõ, không báo thành công sai, không tạo trùng.
- [ ] Mở lại yêu cầu: có ảnh và trạng thái chính xác.
- [ ] Trang Tài khoản không bị bung form Sửa hồ sơ dài; form riêng lưu được.
- [ ] Camera/media permissions và Android Back/keyboard hoạt động.
- [ ] Ảnh trang trại có nguồn hợp lệ hoặc placeholder rõ ràng, không “hình minh họa” đồng loạt gây nhầm.

## B. API/Admin/Customer Web (agent cung cấp bằng chứng)

- [ ] Mọi upload yêu cầu auth, MIME + magic bytes + size + count.
- [ ] Khách A không đọc ảnh/private request của B.
- [ ] Chỉ review APPROVED và ảnh của nó được public.
- [ ] Admin hợp lệ xem bằng chứng trong chi tiết yêu cầu.
- [ ] Web và Mobile cùng phản ánh ảnh và status.
- [ ] Return quantity, order ownership, eligibility và duplicate review được server validate.
- [ ] DEV dữ liệu nguyên vẹn; migrations thử trên TEST trước.
- [ ] API unit/E2E, Mobile tests, Web/Admin typecheck/lint/build, Metro report số thật.
- [ ] COD/flash/checkout/QR/hàng hoàn không hồi quy.
- [ ] Git working tree được bảo toàn, không commit/push.

## C. Mức nghiệm thu

- `READY FOR EXPO GO DEMO` khi đã test trên Android thật với bằng chứng.
- `SOURCE READY — ANDROID DEVICE ACCEPTANCE PENDING` khi mới có unit/E2E/Metro, chưa test thiết bị.
- `BLOCKED` nếu upload bảo mật hoặc API khách vẫn thiếu, không lắp nút giả.
