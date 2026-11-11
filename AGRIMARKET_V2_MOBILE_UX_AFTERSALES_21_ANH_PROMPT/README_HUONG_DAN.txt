AGRIMARKET V2 — BỘ BÀN GIAO TỐI ƯU GIAO DIỆN & NGHIỆP VỤ HẬU MÃI

MỤC ĐÍCH:
Bộ ZIP này bao gồm prompt OpenCode rất chi tiết, ảnh chụp UI hiện trạng từ Expo Go và checklist test. Ảnh giúp agent thấy chính xác các chỗ cần sửa — KHÔNG phải mockup UI hoàn thiện, KHÔNG yêu cầu clone Shopee từng pixel.

CẤU TRÚC:
01_PROMPT_OPEN_CODE_FULL.md — Prompt triển khai từ source thật
02_ANH_VA_YEU_CAU_UI.md — Ánh xạ 21 ảnh sang lỗi/đích thiết kế
03_QUICK_QA_CHECKLIST.md — Checklist nghiệm thu cuối
anh_hien_trang/*.png — 21 ảnh kiểm tra UI; các vùng cá nhân nhạy cảm đã được che ở những ảnh tương ứng

CÁCH SỬ DỤNG:
1. Giải nén ZIP vào thư mục gốc dự án AgriMarket V2, hoặc một thư mục tạm trong dự án mà OpenCode đọc được.
2. Mở OpenCode tại repository đúng máy Windows của bạn.
3. Gửi đúng lệnh: "Đọc 01_PROMPT_OPEN_CODE_FULL.md, 02_ANH_VA_YEU_CAU_UI.md, toàn bộ ảnh trong anh_hien_trang và 03_QUICK_QA_CHECKLIST.md. Triển khai trực tiếp lên mã nguồn V2 hiện có theo thứ tự Phase 0–5. Không tạo lại app, không APK/EAS, không reset DEV, không tự commit/push. Báo cáo test thật.".
4. Chỉ chạy một agent ghi source tại một thời điểm.
5. Sau khi OpenCode báo xong, mở Expo Go để tự nghiệm thu các thao tác và ảnh bằng chứng.

LƯU Ý BẢO MẬT:
- Những ảnh chứa email/số điện thoại/dữ liệu nhập được che một phần để tránh lộ tài khoản khi chuyển file cho AI. Không gửi ảnh có mật khẩu nguyên văn.
- Không đưa .env, JWT, mật khẩu, database dump vào ZIP.
- Tránh đẩy nguyên bộ ảnh kiểm thử vào Git khi không cần; có thể đặt bộ dữ liệu ở thư mục tạm ngoài repo và chỉ cho agent đọc.

Đây là bộ hướng dẫn triển khai, chưa phải bản source đã được sửa và không phải lời xác nhận các chức năng đã được nghiệm thu.
