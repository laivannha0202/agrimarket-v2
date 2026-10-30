# AgriMarket V2 — Kiểm toán chéo bộ 8 báo cáo (vòng 2)

**Nguồn:** `AgriMarket-V2-Full-Audit-90c28de.zip` (SHA-256 `2FCAB9008122D9A7C5F6455103D9554EF51D6DF67D0A6A36D3457B7B0AFA3C5E`), gồm 8 báo cáo trong `audit-reports/` và `HANDOVER-NOTES.md`.  
**Commit được báo cáo kiểm toán:** `90c28de8f773af2b266b96979f9508155e9523fe` (`main`, 18/10/2026).  
**Phạm vi đánh giá này:** đọc và đối chiếu 9 tài liệu trong ZIP; **không có mã nguồn, môi trường chạy, database hoặc log gốc** để tự chứng minh việc tái hiện bug. Mọi nhận định về code dưới đây là đánh giá bằng chứng được báo cáo, chưa phải kiểm toán runtime độc lập.

## 1. Kiểm tra tính toàn vẹn và thống kê

- ZIP mở được, `testzip()` không phát hiện entry hỏng; có 9 entry đúng như bàn giao, không có file rỗng.
- SHA-256 khớp checksum được người dùng cung cấp.
- `08-FIX-ROADMAP.md` có **47 mã duy nhất:** 2 P1, 17 P2, 28 P3, 0 P0. `ARC-03` là ghi chú **verified-clean**, không phải lỗi: thực tế **46 phát hiện/đề xuất + 1 ghi chú**.
- Danh mục chưa tính thêm **candidate settlement creation double-claim** tại `HANDOVER-NOTES.md` §5. Nếu xác nhận và bổ sung finding thì tổng tăng thành 48 mã.

## 2. Phân nhóm kết luận

### Nhóm A — Chặn vận hành đơn thật cho tới khi xác minh/sửa

1. **BL-01 (`03-BUSINESS-LOGIC.md`) — concurrent refund:** tổng COMPLETED refunds cho một payment không được vượt mức đã thu/đủ điều kiện hoàn. Nếu dùng khóa dòng, phải khóa payment **trước** khi đọc lại tổng refund trong cùng transaction và bảo đảm mọi luồng tạo refund dùng cùng cơ chế. Chống request lặp/idempotency nếu nghiệp vụ yêu cầu.
2. **BL-02 — concurrent return:** tổng số lượng **đang chiếm quyền trả + đã hoàn tất** trên một order item không được vượt số lượng đã giao. Nếu chọn `FOR UPDATE` trên parent order item, cần đọc aggregate sau khi lock (lưu ý MVCC/isolation snapshot) và định nghĩa trạng thái bị loại khỏi tổng.
3. **Candidate: settlement-create double claim (`HANDOVER-NOTES.md` §5):** báo cáo nêu truy vấn “chưa được claim” không lock và chưa có unique `partnerOrderId`. Phải thử đồng thời và chốt chính sách: một partner order chỉ thuộc **một settlement hợp lệ** hay có thể split/correction. Nếu một-một, unique constraint + bắt lỗi constraint là lớp bảo vệ mạnh; cần migration và kiểm tra dữ liệu tồn tại trước khi tạo unique.
4. **BL-06 — concurrent payout overpayment:** dù báo cáo xếp P2, nguy cơ tổng payout vượt payable liên quan tiền thật; coi là **go-live blocker** nếu chức năng thực sự dùng để chi trả. Khóa settlement, tính lại tổng payout dưới lock và test hai payout cạnh tranh.
5. **BL-07 — inventory quick inbound/adjust:** Admin có thể làm sai số lượng tồn khi hai thao tác chạy đồng thời. Nếu luồng nhập kho nhanh được sử dụng ngoài thực tế, coi là go-live blocker; cần nguyên tử hóa số lượng + chống replay.
6. **SEC-01 — JWT secret mặc định `CHANGE_ME`:** kiểm tra fail-closed trên production. Tác động có thể rất nghiêm trọng nếu deployment dùng secret công khai; dù ghi P2 trong báo cáo, phải coi đây là **điều kiện bắt buộc trước khi public hệ thống**.

### Nhóm B — Phải sửa sau nhóm A và trước nghiệm thu vận hành đầy đủ

- **CON-01:** kiểm thử cancel `SHIPPING` thắng phải xác nhận `QUARANTINE`, không phải `RELEASE`. Đòi hỏi test **deterministic cho cả hai nhánh**; chạy lại 3 lần trên test DB được cách ly.
- **BL-03/BL-04:** return và complaint cần transition matrix rõ ràng; chỉ CAS mà không kiểm tra transition hợp lệ là chưa đủ.
- **BL-05:** settlement refund bị hardcode 0; phải chốt ai chịu chi phí refund, theo nghiệp vụ đối tác, thời điểm tính gross/net và refund phát sinh **sau khi payout**. Cần chính sách adjustment ở kỳ sau thay vì chỉ trừ refund lúc tạo.
- **BL-12:** đơn hoàn trả phải có chứng từ nhận hàng và QC. **Không cộng tồn bán được khi mới chấp thuận yêu cầu trả**; chỉ chuyển sang vùng kiểm tra/cách ly khi đã thực nhận, sau QC quyết định restock hay tiêu hủy.
- **PRD-01/03/04/06:** CI, backup/restore, SMTP và chặn seed phá hủy/credential demo. Cần kiểm tra chức năng khôi phục dữ liệu, không chỉ có file dump.
- **ACE-01/02/03:** Admin cần tạo harvest và vận hành shipment, farming events để chuỗi truy xuất không lệ thuộc dữ liệu seed.

### Nhóm C — Cần xác minh quy tắc kinh doanh trước khi sửa

- **BL-08:** hoàn voucher khi hủy đơn tùy lý do hủy và trạng thái giao hàng; không tự suy luận chỉ RELEASE mới được hoàn.
- **BL-10:** review tự APPROVED có thể là chính sách đăng tự động, không nhất thiết là bug nếu UI/admin không hứa kiểm duyệt trước.
- **BL-13:** khiếu nại trên đơn CANCELLED có thể hợp lệ đối với hủy không hoàn tiền / dịch vụ / giao nhận; cần phân loại complaint thay vì cấm tất cả.
- **BL-14:** COD-only là giới hạn sản phẩm, không tự động là lỗi. Pilot COD có thể vận hành nếu chính sách minh bạch và đối soát tốt.
- **BL-16:** chỉ gộp `updateMany(false)` + `create(isDefault=true)` trong một `$transaction` **không đủ bảo đảm** duy nhất một địa chỉ mặc định khi hai transaction độc lập chạy đồng thời. Cần serialize theo customer row, CAS/khóa thích hợp hoặc constraint phù hợp với schema.
- **BL-11:** giải pháp logout bằng tăng `passwordVersion` có thể vô hiệu hóa **mọi** phiên/tất cả thiết bị, cần quyết định ý định logout một thiết bị hay logout toàn bộ.

## 3. Sai sót hoặc điều cần chỉnh trong chất lượng kết luận kiểm toán

1. **BL-01 ví dụ test chưa đúng:** “2 concurrent refunds, mỗi cái `paid/2` → chỉ một request được chấp nhận” không hợp lệ nếu 2 lần hoàn 50% được phép. Phải test trường hợp mỗi yêu cầu **70%**, hoặc hai yêu cầu cạnh tranh trên phần dư nhỏ hơn mỗi amount, và assert tổng refund tối đa, cộng với test tuần tự 50% + 50% hợp lệ.
2. **Nhãn VERIFIED BUG với BL-01/BL-02:** `HANDOVER-NOTES.md` §6 xác nhận **chưa chạy repro đồng thời**. Đây là bằng chứng static mạnh nhưng chưa là xác minh runtime; phải trình bày rõ trạng thái.
3. **Kết luận không có mock:** scan text, API mapping và test không đủ chứng minh mọi dữ liệu là kinh doanh thật. Dữ liệu có thể đọc trực tiếp từ database nhưng vẫn do `db:seed` tạo. Với Flash Sale, UI “300 suất còn lại” và giá hiển thị vẫn **chưa được đối chiếu** với record runtime.
4. **Kết luận production-ready:** không nên coi gateway thanh toán online hay notification là blocker tuyệt đối cho **pilot COD có vận hành thủ công**; đó là quyết định sản phẩm theo quy mô và cam kết phục vụ. Ngược lại race payout, kho và JWT là rủi ro thực tế cần nâng mức ưu tiên vận hành.
5. **CON-01:** fix assertion cũ là cần thiết nhưng **không đủ** để test hai nhánh được chạy; tạo tình huống cancel-wins / deliver-wins định hướng, assert invariant và kết quả phụ (movement, blocked, reserved, onHand).
6. **BL-12 roadmap wording:** “On return approval/completion write warehouse document” dễ bị hiểu là cộng tồn khi hàng chưa về; cần ranh giới rõ giữa giấy chấp nhận RMA, hàng thật nhận tại kho, QC và điều chỉnh tồn.
7. **Thuật ngữ phạm vi:** đọc 8 báo cáo **không tương đương đọc full source**. Đây là cross-audit tài liệu và kiểm tra logic phát hiện, không phải bảo đảm code đã sửa hoặc phát hiện đủ 100% lỗi.

## 4. Flash Sale — checklist chứng minh con số trên UI là đúng

- Xác định **300 suất** là `campaign capacity`, `flash item quota`, `quota remaining` hay số cấu hình tĩnh; ghi rõ đơn vị/đối tượng áp dụng.
- Theo vết tại cùng thời điểm: Admin cấu hình → hàng ghi DB → API trả về → web/mobile render → checkout server tính giá → số suất/trạng thái thay đổi sau khi xác nhận.
- Đối chiếu giá thường/giá sale, phần trăm giảm và hiệu lực theo `Asia/Ho_Chi_Minh`; ngày bắt đầu/kết thúc phải có quy ước inclusive/exclusive rõ.
- Test 2 checkout song song cạnh tranh một suất; test tắt campaign khi khách đã mở trang; test đồng hồ và thông báo hết suất; test hủy đơn theo chính sách hoàn/không hoàn suất.
- Phân biệt: **(a)** dữ liệu lấy từ DB/API, **(b)** dữ liệu seed/demo trong DB, **(c)** dữ liệu kinh doanh thực. Ba điều không đồng nghĩa.

## 5. Trình tự khuyến nghị (không sửa đồng loạt 46 vấn đề)

**Đợt 0 — Xác minh trên test DB:** BL-01, BL-02, candidate settlement-create; đối chiếu Flash Sale UI, chốt policy và baseline test.  
**Đợt 1 — Chặn rủi ro tiền/stock:** fix BL-01, BL-02, settlement-create (nếu xác nhận), BL-06, BL-07 với regression/concurrency tests.  
**Đợt 2 — Giữ hệ thống đáng tin:** CON-01 deterministic, SEC-01, PRD-01 CI, PRD-06 seed guard, backup/restore và secret/SMTP.  
**Đợt 3 — Nghiệp vụ hậu mãi:** BL-05, BL-12, BL-03/04 và các test vòng đời, bao gồm hoàn tiền phát sinh sau payout.  
**Đợt 4 — Admin/Customer hoàn thiện:** ACE-01/02/03, notification, Flash Sale transparency, UX và quyết định online payment.  
**Đợt 5 — P3:** tinh chỉnh cart, reviews, voucher, address, document drift, chất lượng test.

### Điều kiện nghiệm thu của mỗi đợt

- Nêu commit/branch, file đã thay đổi, migrations và tác động dữ liệu.
- Test cả case hợp lệ (positive) và case race / lỗi (negative), không chỉ chạy test cũ.
- Chạy typecheck, lint, unit, E2E trên `agrimarket_v2_test` đã xác thực; không dùng DB production.
- Chứng minh không regress: Buy Now không sửa cart, trust badge có dữ liệu, COD confirm CAS, order/cancel/quarantine, API Admin/Customer.
- Báo rõ FAIL/SKIP/NOT RUN và nguyên nhân. Không tự deploy hoặc sửa production.
