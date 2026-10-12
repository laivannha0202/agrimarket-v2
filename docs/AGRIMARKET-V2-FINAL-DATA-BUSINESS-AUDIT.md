# AgriMarket V2 — FINAL DATA & BUSINESS AUDIT

**Ngày kiểm toán:** 2026-10-11 · **Phạm vi:** READ-ONLY, không sửa dữ liệu, không reseed, không commit/push.
**DB:** `agrimarket_v2` (DEV). **Công cụ:** `apps/api/qa-db-peek.mjs`, `qa-audit-final.mjs`, `qa-addr.mjs` (chỉ SELECT).

---

## 0. Git & bảo toàn source

- Commit mới nhất: `c7220ee docs: add complete step-by-step root README`.
- `git status`: **19 file modified** trong `apps/customer-web` (home, catalog, checkout, account, header/footer, flash sale, promotion…) **chưa commit**; cùng các file mới (`qa/`, `ma-giam-gia/`, `promotion/`, `FarmListView.tsx`, `vouchers.ts`, `icon.svg`) và `apps/api/qa-db-*.mjs`.
- **Hành động:** không stash, không checkout, không sửa/xóa. Toàn bộ thay đổi local Customer Web/Mobile giữ nguyên trạng để ngườidùng commit thủ công.
- Không reset/reseed DEV, không sửa dữ liệu lịch sử, không commit/push — đúng yêu cầu.

---

## 1. Tổng quan dữ liệu gốc (đếm thực tế)

| Bảng | Số lượng | Ghi chú |
|---|---|---|
| Products | 14 (ACTIVE) | 5 category |
| Variants | 17 | gói/túi/bó/cây/nải/hộp/bao; 200 g–5 kg |
| Categories | 5 | rau ăn lá, rau ăn quả, củ quả, trái cây, gạo & ngũ cốc |
| Farms | 4 (ACTIVE) | địa chỉ text — xem §4 |
| Partners | 3 (ACTIVE) | HTX Minh Châu, HTX Phú Cường, Nông sản Sông Hồng |
| Certificates | 4 (đều VERIFIED) | xem §4 |
| Seasons | 14 (13 HARVESTING, 1 COMPLETED) | 1 harvest/season |
| Harvests | 14 | 220–3000 kg |
| Lots | 19 (SELLABLE) | TRC-000001…19 |
| QC inspections | 19 (18 PASS, 1 FAIL lot#41) | |
| Inventory movements | 72 | INBOUND 18, RESERVE 29, RELEASE 25, **0 OUTBOUND** |
| Warehouse docs | 11 | 10 INBOUND/COMPLETED, 1 INBOUND/CANCELLED |
| Orders | 35 | DELIVERED 4, SHIPPING 1, CONFIRMED 1, PENDING_CONFIRMATION 4, CANCELLED 25 |
| Payments | 35 | COD/PAID 2, VNPAY/PAID 2, COD/PENDING 31 |
| Shipments | 6 | DELIVERED 4, IN_TRANSIT 2 |
| Returns | 3 (REQUESTED) | ret#3, #4, #5 |
| Complaints | 2 | cmp#3 PROCESSING, cmp#4 OPEN |
| Reviews | 2 | users 7 (6 CUSTOMER) |
| Vouchers | 1 | HUNGYEN50K (used 1/500) |
| Flash Sales | 1 | fs#3, 2 items |
| Addresses | 6 | + catalogue 104 wards Hưng Yên |

### Phân biệt demo/seed vs dữ liệu xác minh

- **Seed/demo (chứng minh được):** 14 sản phẩm/17 variant, 4 farm, 4 chứng nhận, 14 mùa vụ/thu hoạch, 19 lô, voucher HUNGYEN50K, flash sale fs#3, user demo — id liên tục, sinh theo kịch bản seed. **Không có nguồn bên ngoài** xác minh giá/ảnh/số lượng.
- **Dữ liệu vận hành trong DEV (phát sinh qua app/e2e):** 35 đơn, 35 payment, 6 shipment, 3 return, 2 complaint, 2 review, 72 movement, 11 phiếu kho — kết quả chạy chức năng (kể cả script kiểm thử), **không phải dữ liệu khách hàng thật**.
- **Không có dữ liệu nào có nguồn xác minh bên ngoài** (hóa đơn, giấy chứng nhận thật, file scan). Ảnh sản phẩm là ảnh minh họa trong `uploads/products/*.webp`.


---

## 2. Đối chiếu số liệu Admin với bản ghi gốc

Công thức trong `apps/api/src/reports/reports.service.ts` (định nghĩa rõ, không dùng list-limit 100):

- `totalOrderValue` = Σ `grandTotal` đơn **không CANCELLED** tạo trong kỳ (order value, không phải tiền mặt).
- Revenue = cash flow: `grossCollected` (payment PAID/PARTIALLY_REFUNDED/REFUNDED theo `paidAt`) − `refundTotal` (refund COMPLETED theo `completedAt`) = `netCollected`.
- Đơn hủy không tính order value/commission; tiền đã thu vẫn là cash.

**Recompute độc lập (script SELECT):**

- Σ `grandTotal` các đơn DELIVERED = **672.000 ₫ / 4 đơn** (cash tương ứng 2 COD/PAID + 2 VNPAY/PAID = khớp 4 đơn delivered đều có PAID payment).
- `grandTotal` khớp `Σ items.subtotal − discountTotal + shippingFee` cho **35/35 đơn (0 mismatch)**.
- 0 đơn DELIVERED thiếu payment PAID; 31 COD/PENDING nằm trên đơn PENDING/CONFIRMED/SHIPPING/CANCELLED — đúng quy tắc F3 (không auto-PAID khi DELIVERED).

→ **Kết luận:** công thức thống kê backend đúng với bản ghi gốc; không phát hiện thống kê sai. Dữ liệu nền nhỏ (35 đơn, 71% hủy) nên mẫu ít.

---

## 3. Ảnh và tên sản phẩm (kiểm chứng thị giác từng ảnh)

14/14 sản phẩm có ảnh; xem trực tiếp từng file `uploads/products/*.webp` và đối chiếu tên:

| prod# | Tên | Ảnh (đã xem) | Khớp? |
|---|---|---|---|
| 29 | Cà chua bi đỏ | chùm cà chua bi đỏ | ✅ |
| 30 | Dưa leo baby | dưa leo xanh nhỏ | ✅ |
| 31 | Cải ngọt Hưng Yên | bó cải ngọt hoa vàng (2 ảnh) | ✅ |
| 32 | Xà lách lô tô | cây xà lách xoăn lá | ✅ |
| 33 | Cà rốt Phú Cường | nắm cà rốt cam có lá | ✅ |
| 34 | Khoai tây Đà Lạt | củ khoai tây vàng | ✅ |
| 35 | Hành lá Phú Cường | bó hành lá | ✅ |
| 36 | Gạo nếp cái hoa vàng | bát gỗ gạo nếp trắng | ✅ (tên “hoa vàng” là giống) |
| 37 | Nhãn lồng Hưng Yên | chùm nhãn vỏ vàng | ✅ |
| 38 | Vải thiều Hưng Yên | chùm vải đỏ | ✅ |
| 39 | Chuối tiêu hồng | nải chuối tiêu vàng | ✅ |
| 40 | Ớt chuông đỏ | 3 quả ớt chuông đỏ | ✅ |
| 41 | Bắp cải trắng | cây bắp cải trắng | ✅ |
| 42 | Rau muống hạt | bó rau muống có rễ | ✅ |

→ **Không còn lỗi tên/ảnh không khớp** trên 14 sản phẩm (ảnh demo minh họa, không có nguồn xác minh).

---

## 4. Các vấn đề đã phát hiện trước đây — tái kiểm chứng

| Vấn đề | Hiện trạng (bằng chứng) | Kết luận |
|---|---|---|
| **Flash Sale kéo dài bất thường** | fs#3 “Flash Sale cuối tuần Hưng Yên” ACTIVE, `2026-09-07 → 2026-11-06` = **60 ngày**, 2 items (cà chua 50k/60k, cà rốt 24k/28k). Tên “cuối tuần” nhưng span 2 tháng. | **Còn nguyên — lỗi seed (P2)** |
| **Địa chỉ trang trại theo huyện/xã cũ** | farm#9 “xã Minh Châu, huyện Văn Lâm”; farm#10 “xã Đình Dù, huyện Văn Lâm”; farm#11 “xã Phú Cường, huyện Kim Động”; farm#12 “Xã Hồng Nam, TP Hưng Yên” — vẫn mô hình **huyện/xã trước sáp nhập**. Catalogue mới (104 xã/phường, `wards=104`) chỉ áp cho **địa chỉ khách**, chưa migrate `farms.address` (text tự do). addr#16 còn `ward=12205` (mã cũ) không có wardName. | **Còn nguyên — P2** |
| **Chứng nhận VietGAP chưa xác minh** | 4/4 cert `VERIFIED`/`ACTIVE`, issuer “Trung tâm Kiểm định và Chứng nhận Hưng Yên”. **Nhưng không có file scan** trong DB; mã VG-HY-2026-014/027/041 là seed. cert#11 GlobalGAP GG-HY-2025-003 **hết hạn 2026-09-07** (currentlyValid=false) vẫn ACTIVE. | **VERIFIED theo cờ nhưng chưa có nguồn — P1**; cert#11 hết hạn vẫn ACTIVE — **P2** |
| Tên & ảnh sản phẩm không khớp | xem §3 | **Đã hết (14/14 khớp)** |

---

## 5. Phát hiện mới trong đợt audit này

| ID | Sev | Bản ghi | Bằng chứng | Nguyên nhân | Ảnh hưởng | Phương án sửa an toàn |
|---|---|---|---|---|---|---|
| **A1** | **P0** | lots #39,41,42,43,45,47,48,50,51,53,56 | `BALANCE-DRIFT`: `remaining_quantity ≠ on_hand + reserved`. VD lot#41 `remaining=300` nhưng `on_hand=0, reserved=0`; lot#53 `remaining=260` vs `on_hand=260 + reserved=32`. | `remaining_quantity` trên `product_lots` không đồng bộ với tổng `inventory_balances` — có thể do tiêu hao khi DELIVERED (F4) trừ `remaining` nhưng thiếu OUTBOUND, hoặc seed set lệch. | Tồn “có thể bán” lệch tồn thực → FEFO phân bổ sai, truy xuất/đối soát lệch. | Điều chỉnh bằng **bút toán đối soát (INVENTORY-COUNT/ADJUSTMENT)**: `remaining := Σ(on_hand+reserved)` từng lô + ghi movement kèm lý do. Cần duyệt (chạm dữ liệu kho). |
| **A2** | **P1** | 72 movements | `byType={INBOUND:18, RESERVE:29, RELEASE:25}` — **0 OUTBOUND** dù có 4 đơn DELIVERED và F4 yêu cầu OUTBOUND khi tiêu hao. | Dữ liệu lịch sử trước khi F4 áp dụng, hoặc OUTBOUND không ghi cho các đơn delivered cũ. | Không tái lập dòng xuất kho cho 4 đơn đã giao → FEFO/đối soát thiếu chân xuất. | Không sửa lịch sử; ghi **movement bổ sung (post-dated ADJUSTMENT)** hoặc chấp nhận và ghi chú báo cáo. Cần xác nhận. |
| **A3** | **P1** | cert#11 GlobalGAP | `expiresAt=2026-09-07` < hôm nay, `currentlyValid=false` nhưng `status=ACTIVE`. | Không có job tự động hạ `ACTIVE → EXPIRED` khi quá hạn. | Farm#11 vẫn hiển thị “được chứng nhận” với giấy hết hạn → sai lệch truy xuất. | Sửa code: scheduler/computed-status khi đọc; dữ liệu chỉ đổi qua job, không update tay. |
| **A4** | **P2** | fs#3 | span 60 ngày, tên “cuối tuần”. | Seed đặt `endsAt = startsAt + 60d`. | Flash sale kéo dài → mất ý nghĩa “giờ vàng”, khóa giá flash dài hạn. | Sửa seed hoặc update `endsAt` (dữ liệu DEV, cần duyệt); hoặc đổi tên “Khuyến mãi tháng”. |
| **A5** | **P2** | farms #9–12, addr#16 | địa chỉ huyện/xã cũ; addr#16 `ward=12205` (mã), thiếu `wardName`. | `farms.address` text tự do chưa migrate sang catalogue 104 xã/phường; 1 address cũ chưa chuẩn hóa. | Truy xuất nguồn gốc hiển thị địa danh không còn hành chính → giảm độ tin cậy. | Migration chuẩn hóa text theo bảng `wards` (map huyện→xã mới), cần duyệt. |
| **A6** | **P2** | cert #9–12 | VERIFIED nhưng không có `fileUrl`/scan giấy chứng nhận. | Seed chỉ set cờ, không đính kèm chứng từ. | “Xác minh” chỉ là cờ DB, không bằng chứng vật lý → rủi ro khi bảo vệ nếu bị hỏi nguồn. | Upload scan hoặc hạ `UNVERIFIED`/thêm trường nguồn; thuộc thay đổi dữ liệu cần duyệt. |
| **A7** | **P3** | 25/35 đơn CANCELLED | 71% đơn hủy trong DEV. | Đơn sinh từ script/e2e rồi hủy để giữ DB sạch. | KPI “tỷ lệ hủy” trông rất xấu nếu đọc nhầm là vận hành thật. | Ghi chú rõ là dữ liệu test; không cần sửa dữ liệu. |
| **A8** | **P3** | 3 returns REQUESTED, 2 complaints mở | ret#3/#4/#5, cmp#3/#4 chưa xử lý; ret#4 reason “Kiểm thử tự động”. | Dữ liệu kiểm thử để lại. | Hàng đợi aftersales không về 0 → nhiễu demo. | Xử lý/hủy trong DEV sau khi duyệt, hoặc gắn nhãn test. |

**Không phát hiện:** lệch grandTotal (0/35), đơn DELIVERED thiếu thanh toán, sản phẩm thiếu ảnh, ảnh/tên không khớp, lô SELLABLE không có QC PASS (lot#41 FAIL không nằm trong lô đang bán), danh mục/variant trùng lặp.

---

## 6. Kết luận & khuyến nghị trước khi bảo vệ

- **Đúng nghiệp vụ & thống kê:** công thức báo cáo backend khớp bản ghi gốc; COD không auto-PAID; FEFO/QC/đối soát vận hành đúng hướng.
- **Vấn đề cốt lõi là dữ liệu, không phải code:** lệch tồn kho lô (A1), thiếu OUTBOUND lịch sử (A2), chứng nhận hết hạn/chưa kèm chứng từ (A3/A6), flash sale/địa chỉ seed chưa chuẩn (A4/A5).
- **Không sửa gì trong đợt này.** Mọi thay đổi dữ liệu DEV (A1–A6) cần duyệt; chỉ sửa **code** có bằng chứng (A3: auto-expire cert) được đề xuất làm tiếp.
- **Ưu tiên trước demo:** (1) A1 đối soát tồn kho bằng bút toán chuẩn, (2) A3 job hết hạn chứng nhận, (3) A6 bổ sung chứng từ hoặc hạ cờ VERIFIED, (4) A4/A5 chuẩn hóa seed flash-sale & địa chỉ farm.

> Báo cáo này chỉ đọc; toàn bộ số liệu trích trực tiếp từ `agrimarket_v2` tại thờidiểm kiểm toán bằng các script SELECT trong `apps/api/qa-*.mjs`.
