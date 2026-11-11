# AGRIMARKET V2 — FINAL MOBILE UX + POST-PURCHASE MEDIA + ADDRESS SHEETS + CROSS-PLATFORM ACCEPTANCE

> **DÁN TOÀN BỘ TÀI LIỆU NÀY VÀO OPENCODE, HOẶC YÊU CẦU AGENT ĐỌC TỆP NÀY TRONG GÓI ZIP.**
>
> **Các ảnh `anh_hien_trang/` ghi lại giao diện đang chạy và các lỗi cần sửa; KHÔNG phải mẫu cuối để copy y nguyên.** Phải giữ những phần đã tốt và cải thiện theo mục tiêu được mô tả bên dưới.

## A. VAI TRÒ, PHẠM VI VÀ NGUYÊN TẮC

Bạn là Senior Full-stack Engineer chuyên NestJS, Prisma, MySQL, Next.js, Expo React Native, Android UX, transactional e-commerce, secure evidence-media workflows và QA automation. Nhiệm vụ là **thực thi và nghiệm thu** một đợt sửa cuối có kiểm soát cho **AgriMarket V2**; không dừng ở phân tích hay chỉ dựng giao diện giả.

Repository Windows dự kiến: `E:\dev\Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` (tự kiểm tra vị trí thực tế). Các phần dự án: `apps/api`, `apps/admin-web`, `apps/customer-web`, `apps/mobile`. Mobile phải **giữ Expo Managed + Expo Go**.

**Phạm vi bắt buộc của đợt này:**

1. Fix lỗi bottom sheet chọn tỉnh/xã-phường tự mở/đóng sai, hoàn thiện sổ địa chỉ Hưng Yên mới.
2. Đổi luồng khiếu nại, trả hàng, đánh giá từ **nhập ID kỹ thuật** sang **chọn đơn hàng/sản phẩm đủ điều kiện** hoặc mở trực tiếp từ chi tiết đơn hàng.
3. Tích hợp **tối đa 5 ảnh bằng chứng** vào ba nghiệp vụ, từ Expo Go → Backend → Database/storage → Admin → Mobile/Customer Web, có phân quyền và test thật.
4. Làm gọn thiết kế các màn Tài khoản, Sổ địa chỉ, Khiếu nại, Trả hàng, Đánh giá, Trang trại; rà soát liên quan ở danh sách sản phẩm/đơn hàng; không thiết kế lại cả app, không mô phỏng từng pixel/thương hiệu Shopee.
5. Regression các chuỗi mua hàng, khuyến mãi, kho, hoàn trả, truy xuất và quyền người dùng; bàn giao bằng chứng thật.

**Nhất quán thiết kế:** tạo cảm giác TMĐT quen thuộc như Shopee/Lazada ở cách thao tác và độ rõ ràng, nhưng dùng thương hiệu AgriMarket, không chép tài sản, logo, màu sắc hay giao diện độc quyền của sàn khác; không “giao diện AI”, không trang trí vô nghĩa.

**Không làm:** APK, AAB, EAS Build, bare/prebuild, yêu cầu USB/ADB, reset/reseed/drop DEV DB, `git reset --hard`, `git clean`, xóa untracked, tự commit/push, deploy, thay toàn bộ UI framework, tạo mock API để hợp thức hóa tính năng, làm dashboard Admin Mobile, video upload ngoài scope, AI chat, feature creep.

## B. BASELINE: KIỂM TRA TRƯỚC KHI SỬA

1. `git branch --show-current`, `git rev-parse HEAD`, `git status --short`; liệt kê cả **untracked** chứ không chỉ `git diff`. Đặc biệt `apps/mobile/` và `apps/customer-web/` từng là untracked, phải **bảo vệ nguyên vẹn**. Không mặc định mọi thư mục untracked đều là rác.
2. Đọc các báo cáo `docs/AGRIMARKET-V2-FINAL-ACCEPTANCE.md`, `docs/AGRIMARKET-V2-MOBILE-ACCEPTANCE.md`, `docs/AGRIMARKET-V2-ADDRESS-AUTH-ACCEPTANCE.md`, `docs/AGRIMARKET-V2-AUTH-UI-FIX.md` nếu tồn tại. Kiểm tra code hiện tại thay vì tin tuyệt đối vào báo cáo cũ.
3. Ghi lại danh sách/đường dẫn/hash tệp dự kiến sửa để có thể đối chiếu. Không tự stash/reset nếu có phiên AI khác đang thay đổi repo.
4. Đọc NestJS controllers, DTO, guards, Prisma models, Swagger, Customer Web resources, Mobile resources, Expo Router và auth context. Tìm sẵn media upload/storage/permissions; tái sử dụng thay vì tạo hệ thống song song.
5. Xác định API đang kết nối **DEV hay TEST** trước mọi lệnh thay đổi dữ liệu. Thử nghiệm có ghi dữ liệu chỉ trên TEST DB độc lập, không ngầm chuyển kết nối.
6. Đọc từng ảnh trong `anh_hien_trang/` và bảng chẩn đoán trong `02_ANH_VA_YEU_CAU_UI.md`. Ảnh là bằng chứng vấn đề, không phải mẫu đẹp hoàn chỉnh.
7. Lập ma trận *Screen → CTA → Route → API → DTO → Data state → Required role → Actual behavior → Expected behavior → Automated/device test*.

## C. P1 — FIX CHÍNH XÁC LỖI CHỌN TỈNH/XÃ-PHƯỜNG

**Hiện trạng trong ảnh `02_dia_chi_chon_tinh_sheet.png` và `03_dia_chi_chon_xa_sheet.png`:** bấm/chọn/đóng tỉnh Hưng Yên khiến sheet xã/phường nháy mở rồi đóng, hoặc sheet chuyển trạng thái không đúng. Không suy đoán nguyên nhân trước khi tái hiện.

### Hành vi mong đợi

- Hệ thống hiện phục vụ **duy nhất tỉnh Hưng Yên**: form **hiển thị tỉnh Hưng Yên ở trường chỉ đọc** (không cần bottom sheet chọn tỉnh chỉ có một lựa chọn), trừ khi Backend thật sự hỗ trợ nhiều tỉnh giao hàng. Không lạm dụng dropdown một phần tử.
- Bấm **Xã/Phường** mới mở **duy nhất một** bottom sheet tìm kiếm danh mục API. Khi nhập từ khóa có dấu hoặc không dấu đều tìm được; dữ liệu đầy đủ **104 đơn vị (93 xã, 11 phường)** theo danh mục đã có. Không hardcode dữ liệu vào Mobile.
- Chọn một xã/phường: cập nhật `wardCode` + tên tương ứng, đóng sheet đúng một lần; form bên dưới giữ nguyên giá trị người nhận, điện thoại, thôn, địa chỉ chi tiết.
- Bấm X, bấm backdrop, Android Back hoặc vuốt đóng: đóng sheet không thay đổi giá trị đã chọn; không mở sheet khác, không click xuyên xuống ô nằm sau backdrop.
- Mở/đóng liên tục, thao tác nhanh, nhập từ khóa rồi xóa, bàn phím hiện/ẩn, thay đổi focus: không nháy, không đôi sheet, không treo scroll, không mất dữ liệu.
- Cẩn thận sự kiện Pressable bubbling, zIndex, portal, state stale closure, `onDismiss` vs `onClose`, blur/focus, race khi dismiss animation và keyboard; giải quyết tận gốc. **Không chữa bằng `setTimeout` chắp vá**.
- API list wards có giới hạn phù hợp 104 phần tử: kiểm tra trang 100/104 từng là lỗi; có phân trang hợp lý hoặc giới hạn đủ 104, test đếm chính xác. Mã tỉnh/xã dùng string (không mất số 0 đầu).
- Không bắt huyện cũ/mã bưu chính; thôn/tổ dân phố có thể nhập nếu chưa có nguồn chuẩn; tôn trọng snapshot địa chỉ đã lưu của đơn hàng lịch sử.

### Làm gọn sổ địa chỉ

- **Sổ địa chỉ**: danh sách thẻ địa chỉ đã lưu, badge Mặc định, nút Sửa/Xóa/Đặt mặc định có xác nhận đúng lúc. Một CTA rõ **+ Thêm địa chỉ**; **không render sẵn form dài dưới danh sách**.
- **Thêm/Sửa địa chỉ**: màn riêng/route riêng hoặc modal hợp lý, không nested bottom sheets; Người nhận, Điện thoại, Tỉnh Hưng Yên (chỉ đọc), Xã/Phường (tìm kiếm), Thôn/TDP (tùy chọn khi chính sách cho phép), Địa chỉ chi tiết, Mặc định. Chỉ hiển thị validation khi cần. Giữ input trên retry network fail.
- Các cụm thông tin giải thích kiểu “theo danh mục hành chính 2025”, “hệ thống lưu mã ...” thuộc docs, **không đặt trên form khách hàng**. Không có text `undefined`, `wardCode` hay `district` kỹ thuật.
- Khi sửa/xóa/chọn mặc định, invalidation cache, checkout chọn lại địa chỉ đúng; không ảnh hưởng snapshot cũ và fee policy.

## D. P1 — THAY ID KỸ THUẬT BẰNG LUỒNG TỪ ĐƠN HÀNG

**Ảnh hiện trạng**: `05_khieu_nai_nhap_orderid.png`, `06_tra_hang_nhap_orderitemid.png`, `07_danh_gia_nhap_orderitemid.png`.

### Cấu trúc trải nghiệm bắt buộc

**Chi tiết đơn hàng → sản phẩm trong đơn → hành động thích hợp:**

- Khiếu nại: từ chi tiết đơn hoặc chọn **Đơn hàng của tôi**, chọn đơn hợp lệ; có thể chọn sản phẩm liên quan nếu loại khiếu nại cần. Mobile giữ ID nội bộ trong state/request, **không bắt khách nhập orderId**.
- Trả hàng: từ đơn đã đủ điều kiện theo API/state machine → chọn dòng sản phẩm đã giao → chọn số lượng còn được trả → lý do và ảnh (nếu có). Mobile giữ orderItemId trong request, **không bắt nhập thủ công**.
- Đánh giá: từ đơn đã giao và dòng sản phẩm chưa đánh giá → chọn 1–5 sao → nhận xét/ảnh; **không bắt nhập orderItemId**. Không cho đánh giá trùng. Trạng thái duyệt hiển thị trung thực.
- Từ tab Tài khoản → Khiếu nại/Trả hàng/Đánh giá cũng mở được danh sách các yêu cầu của tôi, trạng thái và nút tạo yêu cầu theo đúng điều kiện, hoặc chọn đơn đủ điều kiện. Mọi con đường UI cùng sử dụng API và hành vi thống nhất.
- Chỉ hiển thị hành động **khi đủ điều kiện backend**. Nếu API chỉ trả trạng thái nhưng không expose eligibility, xác minh quy tắc từ Backend và tính khả năng hiển thị; **server luôn tái xác thực** để chống race/sai quyền.
- Từ đơn hàng: tên hiển thị, ảnh/thumb, quy cách, số lượng, mã đơn dễ đọc (vd ORD-...), giá snapshot. Ẩn ID kỹ thuật. Khi không có đơn giao hoặc đã đánh giá hết: empty state 1–2 dòng kèm CTA về Đơn hàng, **không hiện form vô nghĩa**.
- Không lọc 100 đơn đầu rồi giả như đó là tất cả; dùng phân trang hoặc API eligibility server-side phù hợp cho lượng dữ liệu lớn.
- Trước khi tạo phải kiểm tra session, orderId/orderItemId thuộc user, quantity còn có thể trả, status hợp lệ, không duplicate; báo lỗi tiếng Việt đúng loại thay vì toast “Dữ liệu sai”.

### After-sales UX mục tiêu

**Khiếu nại:** danh sách yêu cầu đã gửi + trạng thái → nút “Gửi khiếu nại” → Chọn đơn → chọn loại (sản phẩm, giao hàng, giao sai, khác theo enum thật) → nội dung ngắn gọn → **ảnh bằng chứng tùy chọn** → Gửi → màn kết quả/số yêu cầu và trạng thái. Không có câu “lấy orderId ở chi tiết đơn hàng”.

**Trả hàng:** danh sách đã gửi → tạo → chọn đơn và sản phẩm đủ điều kiện → số lượng max đúng policy → lý do → **ảnh bằng chứng** → Gửi → trạng thái xử lý. Không có “orderItemId” hay hướng dẫn kỹ thuật.

**Đánh giá:** danh sách đã đánh giá + các sản phẩm còn được đánh giá → chọn sản phẩm → 5 ngôi sao trực quan (các sao đã chọn tô màu, chưa chọn rỗng, nhãn số sao) → nội dung tùy chọn theo chính sách → **tải ảnh sản phẩm tùy chọn** → Gửi → trạng thái chờ duyệt. Không phải 5 nút xanh đặc như ảnh cũ.

### Màn danh sách/chi tiết phía khách

- Nếu API khách đã có `/returns/me`, `/complaints/me`, `/reviews/me` và `/:id`, dùng lại, phân trang/filter trạng thái thật, retry/error/loading chuẩn.
- Nếu chưa có đủ API, bổ sung endpoint **CUSTOMER-scope tối thiểu**; kiểm tra theo user từ JWT; không tái dùng endpoint ADMIN có thể lộ dữ liệu người khác.
- Hiển thị progress trạng thái thực tế do Backend quản lý; không cho khách tự cập nhật hoàn tiền, QC, shipment hoặc resolution.

## E. P1 — ẢNH ĐÍNH KÈM CHO KHIẾU NẠI / TRẢ HÀNG / ĐÁNH GIÁ

### Thiết kế mô hình

1. Kiểm kê module upload/storage hiện có (ảnh sản phẩm, chứng nhận, minh chứng giao hàng, v.v.). **Ưu tiên tái sử dụng** valid pipeline, storage provider và thư mục/chính sách media của V2.
2. Trước đây các payload client thấy: `POST /reviews` {orderItemId,rating,content}, `POST /complaints` {orderId,orderItemId?,type,content}, `POST /returns` {orderItemId,quantity,reason}; Prisma `Review`, `Complaint`, `ReturnRequest` chưa thấy collection ảnh. Kiểm tra bản source hiện tại, không mặc định chưa có.
3. Nếu thiếu, bổ sung quan hệ **additive** cho attachment (bảng chung polymorphic có FK/constraint đúng hoặc các quan hệ explicit) theo kiến trúc hiện có. Không sửa phá bản ghi cũ; attachment **tùy chọn**; status/logic cũ giữ nguyên.
4. Mỗi đánh giá/khiếu nại/trả hàng: tối đa **5 ảnh** (config dùng chung backend + client); chấp nhận JPEG/PNG/WebP (có thể chuyển HEIC/HEIF về JPEG trên client nếu Expo Go hỗ trợ; nếu không hỗ trợ thì báo đúng), giới hạn dung lượng hợp lý (đề xuất 5 MB/tệp sau nén, tổng theo quota) và kích thước. Có thể chọn thư viện ảnh hoặc chụp bằng camera khi hỗ trợ Expo Go; xin quyền đúng thời điểm.
5. Trên Mobile: ô “Thêm ảnh” gọn, mở image picker; hiển thị thumbnail preview, đếm `0/5`, nút xóa ảnh, trạng thái đang upload/lỗi/retry, hỗ trợ hủy. Không bắt buộc ảnh cho mọi nghiệp vụ nếu chính sách backend không yêu cầu.
6. Chọn ảnh chưa phải gửi yêu cầu thành công. **Chỉ** báo thành công sau khi Backend đã xác nhận entity và liên kết media hợp lệ. Chống nhấn gửi hai lần. Khi upload thất bại: giữ dữ liệu form, retry an toàn, tránh file mồ côi. Nếu dùng upload trước → submit entity sau, cần temporary upload token/scope/TTL và cleanup; nếu dùng multipart cùng transaction, xử lý DB failure và cleanup file.
7. **Không tự set `Content-Type: multipart/form-data` sai boundary** khi dùng `FormData`; kiểm tra RN/Expo API client token interceptors, timeout, các lỗi request > size. Không base64 images trong JSON nếu có đường upload nhị phân tốt hơn.
8. Backend xác thực nội dung tệp (magic bytes/decoder, không chỉ extension/client MIME), whitelist định dạng, giới hạn size/count, chống path traversal, chống tên file nguy hiểm, authorization, rate limits, image decompression bombs nếu phù hợp. Sinh khóa filename, tuyệt đối không dùng tên file người dùng làm đường dẫn trực tiếp.
9. **Phân quyền media khác nhau:**
   - Ảnh **đánh giá**: chỉ public khi bản đánh giá được APPROVED qua moderation; review pending/rejected không hiển thị công khai. Khách chỉ sửa/xem phần mình theo policy.
   - Ảnh **khiếu nại/trả hàng**: **riêng tư** cho khách sở hữu và nhân sự Admin được ủy quyền; không dùng đường dẫn public không bảo vệ; ưu tiên authenticated binary endpoint/signed short-lived URL nếu phù hợp. Hạn chế dữ liệu EXIF/vị trí riêng tư, kiểm tra cross-user IDOR.
10. Response DTO trả metadata ảnh cần cho UI và quyền truy cập, không trả storage absolute path, token dài hạn hoặc secrets. Admin ảnh thumbnail + mở ảnh lớn + trạng thái/nguồn gửi; không cần tính năng upload Admin mới nếu ngoài phạm vi.
11. Có migration an toàn trên TEST trước DEV; không drop/alter destructive, không xóa ảnh cũ. Kiểm tra compatibility Customer Web và contract hiện hành.

### Đồng bộ frontend/backend

- **Expo Go**: dùng `expo-image-picker` và công cụ xử lý ảnh **tương thích với SDK hiện đang cài**, không prebuild/eject. Nếu cần cấu hình quyền camera/photo thì làm trong phạm vi Expo Managed.
- **Customer Web**: cùng khả năng chọn và gửi ảnh, xem lại các minh chứng trong My Reviews / My Returns / My Complaints; file input HTML có giới hạn, preview, retry; không làm giao diện khác nghiệp vụ.
- **Admin Web**: xem ảnh bằng chứng trong chi tiết khiếu nại, yêu cầu trả hàng, đánh giá chờ duyệt và kết quả xử lý. Tái sử dụng Ant Design hiện hành, không thêm bảng/menu phân hệ trùng.
- **API**: OpenAPI/Swagger chính xác, type sharing/client, thumbnail URLs/secure retrieval documented, tất cả payload và endpoint có test.
- Nếu có ảnh đánh giá thì hiển thị trên trang chi tiết sản phẩm (chỉ approved). Nếu chưa có moderation backend hợp lệ, tuyệt đối không public pending.

## F. P2 — TIÊU CHUẨN THIẾT KẾ MOBILE (KHÔNG “AI-LOOK”)

Dùng **các ảnh hiện trạng** để nhận diện ngữ cảnh/thương hiệu, nhưng dùng quy chuẩn UI dưới đây để cải thiện:

- Màu xanh AgriMarket là màu CTA chính; nền sáng/trung tính; text đậm rõ; border rất nhẹ; padding đều; bo góc vừa phải. Không gradient thừa, shadow nặng, card lồng nhiều card, badge/emoji trang trí, hình AI giả trang trại.
- Header 1 hàng: Back + tên màn hình. Body chỉ nội dung chính, bỏ tiêu đề lặp (“Đánh giá của tôi” xuất hiện 2 lần).
- Bottom tabs luôn cố định, không chèn lên nội dung cuối; với form dài, keyboard avoiding / safe area, CTA Gửi luôn bấm được, không che ô nhập. Màn phụ không bắt buộc hiển thị tabs nếu gây chồng layout.
- Khu vực tài khoản: avatar chữ cái/tên/email, menu nhóm rõ; **Sửa thông tin là màn hình riêng** thay vì bung form dài trong Account tab. Hỗ trợ trạng thái đăng nhập, logout, loading/hydration, tránh cache tài khoản cũ.
- Sổ địa chỉ: danh sách trước, nút Thêm; không trưng bày form chưa dùng. Hiển thị tên và số điện thoại người nhận theo đúng quyền user; mã hóa/log tối thiểu.
- Khiếu nại/Trả hàng/Đánh giá: danh sách nội dung hoặc empty-state ngắn gọn; thao tác tạo nằm trong flow chọn đơn. **Không yêu cầu orderId/orderItemId nhập tay.** Không mô tả kỹ thuật cho khách.
- Trang trại: card gọn, tên/địa chỉ/tổ chức/diện tích chỉ khi thật sự cần; ảnh thật nếu có nguồn được phép. Nếu chưa có ảnh, placeholder trung tính thay cho **ảnh minh họa đồng loạt giả như ảnh thật**; không khẳng định chứng nhận/địa chỉ đã xác minh nếu dữ liệu không chứng minh. Đối chiếu hành chính mới, giữ các địa chỉ lịch sử và giải quyết mapping thận trọng.
- Sản phẩm: kiểm tra tên hàng mơ hồ (“Rau muống hạt” nhưng bán rau tươi), quy cách, tránh “Gói 500g · 500g/gói”, giá/sale. Kiểm tra tìm kiếm `rau` có lọc đúng sau khi submit/debounce; 14/14 không phải trạng thái tìm kiếm thực nếu query đã áp dụng.
- Flash sale: countdown/giá/quota lấy từ API hiện hành, theo múi giờ đúng; tên “cuối tuần” nhưng 27 ngày phải được coi là dữ liệu cần audit, **không được tự sửa lịch sử chương trình**.
- CTA kích thước dễ bấm (khoảng 44–48dp), contrast tốt, có accessibility labels/selected state, VoiceOver/TalkBack cơ bản; trạng thái lỗi/retry/empty/loading trong mọi form.

### Hình dung cấu trúc mục tiêu (wireframe text — không phải code)

**Sổ địa chỉ**

    ← Sổ địa chỉ
    [Địa chỉ mặc định]
      Tên người nhận · 09xx ...
      Số nhà, thôn..., xã..., Hưng Yên
      [Sửa]  [Đặt mặc định nếu chưa]  [Xóa]
    [+ Thêm địa chỉ]

**Thêm địa chỉ**

    ← Thêm địa chỉ
    Người nhận: [____________]
    Điện thoại: [___________]
    Tỉnh/thành: Hưng Yên [cố định]
    Xã/phường: [Tìm và chọn ▾]
    Thôn/TDP: [____________] (tùy chọn)
    Địa chỉ cụ thể: [__________]
    [Lưu địa chỉ]

**Chi tiết đơn hàng**

    Đơn #ORD-...  · Đã giao
    [Ảnh] Cà chua bi đỏ · Túi 1kg · x1
    [Đánh giá] [Trả hàng]
    [Khiếu nại về đơn]

**Đánh giá**

    ← Đánh giá sản phẩm
    [Ảnh] Cà chua bi đỏ — Túi 1 kg
    Đánh giá: ☆ ☆ ☆ ☆ ☆ (chọn 1–5)
    Nội dung: [____________]
    Ảnh thực tế [ + Thêm ảnh ] [0/5]
    [Gửi đánh giá]

**Khiếu nại/Trả hàng**

    ← Tạo yêu cầu
    [Chọn đơn hàng]  / [Sản phẩm] khi cần
    [Loại / số lượng hợp lệ]
    Lý do hoặc mô tả [____________]
    Ảnh minh chứng [ + Thêm ảnh ] [0/5]
    [Gửi yêu cầu]

Tất cả màn hình phải dùng **dữ liệu API**, các wireframe trên chỉ minh họa vị trí control.

## G. TẬP TRUNG NGHIỆP VỤ / BẢO MẬT

- Không tính tiền, không đổi FEFO/QC/stock, không tự hoàn tiền trên frontend. Review/return/complaint chỉ theo state machine server.
- Media không làm lộ quyền user: test khách A truy cập attachment của khách B trả 403/404; Admin có role phù hợp xem được; public chỉ xem approved review media.
- Không làm sai quantity trả hàng (số lượng orderItem còn đủ điều kiện), không tạo yêu cầu trùng không được phép, không review quá 1 lần/orderItem theo rule.
- Đảm bảo ảnh gắn đúng **request entity**, không gắn nhầm sản phẩm hay đơn; xử lý race/xóa/hủy tác vụ và giao diện app background/foreground.
- Migration reversible về schema khi hợp lý, không đụng dữ liệu lịch sử, không yêu cầu người dùng xóa đơn/đánh giá cũ.
- Tôn trọng khác biệt DEMO vs thực tế: không dùng ảnh trang trại vẽ để khẳng định chứng nhận hay chứng cứ có thật.
- Phải phát hiện báo cáo trước mọi thay đổi có nguy cơ giảm bảo mật, ví dụ làm public thư mục upload evidence hoặc nới guard của endpoint Admin.

## H. THỨ TỰ TRIỂN KHAI BẮT BUỘC

**Phase 0 — Inspection & contract freeze**: baseline Git + ma trận route/DTO/storage/ACL + xác định migration cần thiết; chốt phạm vi sửa; phân biệt lỗi nhìn thấy và giả thuyết. Viết checklist công việc ở file báo cáo, rồi tiếp tục coding.

**Phase 1 — Address P1**: tái hiện bug sheet (Expo Go nếu có), sửa state, đơn giản tỉnh cố định, ward picker ổn định, sổ địa chỉ gọn; thêm test 104 wards và modal close behavior.

**Phase 2 — Eligibility/order selection**: thêm entry points từ Order Detail, picker đơn/sản phẩm đúng quyền và phân trang, ẩn ID kỹ thuật; cập nhật create/list/detail/empty states cho 3 nghiệp vụ.

**Phase 3 — Evidence architecture**: xác định storage hiện có, thêm upload/migration/DTO/authorization/test backend; sau đó Expo image-picker và previews, tiếp Web + Admin xem đúng evidence. Không làm UI nút ảnh trước rồi coi hoàn thiện.

**Phase 4 — UX polish**: account profile riêng, farm list/images/address display, review stars, form keyboard/safe area, button feedback, empty states, products/search/campaign checks. Thay đổi **chỉ ở phạm vi đã xác định**, không phá những màn tốt.

**Phase 5 — Regression + real device**: chạy suite tự động, kiểm thử trên Expo Go; tạo báo cáo nguồn gốc, thay đổi, bằng chứng; không tuyên bố PASS nếu chưa kiểm thử thiết bị thật.

## I. TEST MATRIX — CÁC CASE PHẢI CÓ BẰNG CHỨNG

### Địa chỉ
1. Tỉnh Hưng Yên cố định, không còn dropdown 1 option.
2. Chỉ bấm xã/phường mới mở ward sheet.
3. Bấm X, backdrop, Back đóng sheet không mở sheet khác.
4. Thao tác nhanh mở/đóng 10 lần không nháy, không double sheet.
5. Tìm xã có dấu và không dấu; đủ 104 ward, 93/11, đúng mã.
6. Chọn một xã, giá trị và form không mất khi đóng.
7. Đổi/xóa/lưu/mặc định; checkout dùng địa chỉ mới, đơn cũ giữ snapshot.
8. Không cho khách A sửa/xóa địa chỉ B.

### Chọn đơn và tính hợp lệ
9. Đánh giá mở từ orderItem đã giao, tự binding đúng ID.
10. Chưa giao thì không có CTA đánh giá/trả hàng trái policy.
11. Đã đánh giá không tạo lần thứ hai.
12. Trả hàng chọn tối đa lượng đủ điều kiện; chống trả lặp.
13. Khiếu nại tự biết orderId; không có text `orderId` trong UI.
14. Nhiều đơn/nhiều sản phẩm, phân trang, chọn đúng item.
15. Khách A không gửi request trên đơn khách B.
16. List/detail yêu cầu sau tạo hiển thị đúng trạng thái, có refresh.

### Ảnh bằng chứng
17. Chọn 1–5 ảnh, preview/xóa từng ảnh.
18. Ảnh thứ sáu bị chặn rõ ràng.
19. Ảnh vượt dung lượng/định dạng không hợp lệ bị chặn cả client/server.
20. Từ chối quyền ảnh/camera không crash app; có lối mở cài đặt nếu cần.
21. Mất mạng trước upload, trong upload, sau upload trước submit: không báo thành công giả; hỗ trợ retry; không sinh orphan lâu dài.
22. Gửi request thành công → đúng entity, hiện thumbnail trong chi tiết.
23. Admin xem bằng chứng, public không xem ảnh riêng tư.
24. Review PENDING không public image; APPROVED mới được public.
25. Khách A cố đọc ảnh bằng chứng của B bị từ chối ở Backend.
26. Upload 2 lần/nhấn nhanh: không liên kết ảnh/đơn trùng sai nghiệp vụ.
27. File giả đuôi jpg nhưng nội dung không hợp lệ bị từ chối.
28. Web và Mobile nhìn thống nhất cùng file + trạng thái.

### Giao diện/điều hướng
29. Không còn nhập ID nội bộ ở 3 form.
30. Trang sổ địa chỉ không mở sẵn form Thêm.
31. Màn Tài khoản không bung form sửa hồ sơ trong tab.
32. 5 sao có lựa chọn rõ, nút Gửi có trạng thái loading/double submit guard.
33. Bàn phím không che input/CTA, Scroll không chồng tab.
34. Android Back từ sheet → form → chi tiết đơn đúng thứ tự.
35. Farm thiếu ảnh có placeholder trung tính và dữ liệu nguồn gốc minh bạch.
36. Search/filter sản phẩm và Flash Sale đối chiếu API.

### Regression luồng lớn
37. Đăng ký → đăng nhập → thêm địa chỉ → giỏ → checkout COD trên TEST DB.
38. Admin thấy đơn; trạng thái giao/giao thất bại/hủy theo Backend, tồn không lệch.
39. QR truy xuất liên kết đúng lô đã cấp phát.
40. API unit, API E2E, Web/Admin build/typecheck/lint, Mobile test/Metro đều chạy và báo số thật.
41. Expo Go trên thiết bị Android: chỉ PASS nếu có thao tác/bằng chứng thực tế.

### Chi tiết test kỹ thuật
- Test E2E dùng TEST DB được guard xác minh; không sửa DEV; không purge toàn bộ data lịch sử.
- Test file storage dùng thư mục/namespace TEST, cleanup của chính test và xác thực không xóa media hệ thống.
- Test ảnh được đọc từ fixtures kiểm thử đã được phép sử dụng, không lấy ảnh cá nhân người dùng làm fixture công khai.
- Test `GET /reviews/product/:id` không lộ ảnh Pending/Rejected; `GET /complaints/me` chỉ thấy dữ liệu user.
- Test `Content-Type`, status 401/403/404/413/415/422/429, timeout/mạng và quan hệ FK.
- Chạy test hiện có trước/sau để đánh giá regression; không giảm test/skip test để “xanh”.

## J. TIÊU CHÍ BÀN GIAO + BẰNG CHỨNG

Tạo `docs/AGRIMARKET-V2-MOBILE-UX-AFTERSALES-FINAL-ACCEPTANCE.md` gồm:

1. Baseline Git/working tree trước và sau, không commit/push.
2. Những lỗi tái hiện: steps, expected, actual, root cause, fix.
3. Danh sách tệp thay đổi, Prisma migrations, storage/media design, API routes/DTO.
4. Bảng chức năng per screen/CTA và dữ liệu thật, không có nút chết.
5. Phân quyền upload/đọc ảnh của chủ đơn, Admin và public reviews.
6. Migration trên TEST trước; các loại dữ liệu lịch sử giữ nguyên.
7. Số liệu test **thực tế**, gồm số passed/failed/skipped, stdout/exits và test DB.
8. Test liên thông Mobile ↔ API ↔ TEST DB ↔ Admin ↔ Customer Web.
9. UX before/after screenshots tại `docs/agrimarket-v2-ux-evidence/after/` nếu có thể chụp hợp lệ. Ảnh người dùng trong ZIP là ảnh **before**.
10. Chi tiết blocker **EXPO GO DEVICE TEST PENDING** nếu agent không cầm được điện thoại; không ghi đã test camera/keyboard nếu chỉ Metro bundle.
11. Các phần thiếu và P0/P1/P2/P3 còn tồn tại; hướng dẫn repro nhanh.
12. Lệnh chạy chính xác từ repo root hoặc apps/mobile, môi trường API LAN, lưu ý Expo Go.

### Điều kiện quyết định PASS

- **P0/P1** ở các luồng địa chỉ, after-sales, quyền user và ảnh phải được fix + có test thật trước khi gọi hoàn thành code.
- Nếu Backend chưa có media storage/private serving, phải triển khai an toàn hoặc báo BLOCKED; **không thêm nút upload giả**.
- Các ảnh minh chứng chỉ public khi đủ policy; dữ liệu Admin không rò rỉ.
- Có bằng chứng Android trên Expo Go nếu ghi `READY FOR EXPO GO DEMO`; nếu không ghi `SOURCE READY — ANDROID DEVICE ACCEPTANCE PENDING`.
- Không phá COD/discount/FEFO/trace/auth/104 wards/Admin.
- Không xóa/commit/push các file của người dùng.

**BẮT ĐẦU TRỰC TIẾP TRÊN SOURCE HIỆN TẠI. ĐỌC ẢNH, KIỂM KÊ CONTRACT, SỬA THEO PHASE, CHẠY TEST VÀ VIẾT BÁO CÁO ĐÚNG SỰ THẬT.**
