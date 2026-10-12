# AgriMarket V2 — Final Data Consistency Acceptance (A4/A5/A6)

**Ngày:** 2026-10-12 · **Phạm vi:** A4 Flash Sale, A5 địa chỉ, A6 chứng từ chứng nhận + nhất quán hiển thị Admin/Customer/Mobile/QR.
**Nguyên tắc:** giữ dirty tree, DEV `agrimarket_v2` chỉ SELECT, TEST `agrimarket_v2_test` cho kiểm thử ghi (guard tên DB trong fixtures), không reset/reseed DEV, không commit/push. A1/A2/A3 đã đạt, không làm lại.

---

## 1. A4 — Flash Sale

### 1.1. Bằng chứng DEV (SELECT)

- fs#3 duy nhất: `'Flash Sale cuối tuần Hưng Yên'`, ACTIVE, `2026-09-07T17:00:00.000Z → 2026-11-06T17:00:00.000Z` (60 ngày), 2 items: `#5 CCB-1KG flash 50.000/base 60.000 sold 2/100`, `#6 CRP-1KG flash 24.000/base 28.000 sold 0/200`.
- Logic giá/quota/window ở backend đúng và đã có test: `resolvePrice` chỉ sale ACTIVE trong window, flash thắng discount, quota claim bằng conditional UPDATE join window + `sold + qty <= quota`, per-customer limit, hết quota hoàn về giá thường không throw (`promotions.service.ts`, `promotions.spec.ts` 34 tests cũ PASS).
- Seed hiện tại đã sửa: tên `'Flash Sale nông sản Hưng Yên'`, window `±30 ngày`, comment nêu rõ DEV giữ nguyên (`seed.ts:1125-1143`). DEV vẫn mang tên cũ — đúng là dữ liệu lịch sử, không phải code sai.

### 1.2. Lỗi có bằng chứng và fix

`createFlashSale` trước fix không validate gì: API chấp nhận window ngược và nhãn "cuối tuần" cho chương trình 60 ngày — chính lỗ hổng đã sinh ra fs#3. Đã fix `promotions.service.ts`: `endsAt > startsAt` bắt buộc; span > 7 ngày mà tên chứa `cuối tuần/cuoi tuan/weekend` → 400, trước khi ghi gì. Admin `flash-sales/page.tsx` chỉ sửa placeholder hướng dẫn (không redesign): tên dài ngày không dùng chữ "cuối tuần".

### 1.3. Đề xuất DEV từng trường (chờ duyệt, KHÔNG thực thi)

| Bản ghi | Trường hiện tại | Đề xuất | Căn cứ / rủi ro |
|---|---|---|---|
| fs#3 `name` | `'Flash Sale cuối tuần Hưng Yên'` | `'Flash Sale nông sản Hưng Yên'` | Khớp seed mới; tên cũ sai lệch 60 ngày vs "cuối tuần". Đổi tên không ảnh hưởng quota/giá đã bán (items join bằng id). |
| fs#3 `startsAt/endsAt` | `09-07 → 11-06` (60 ngày) | Giữ nguyên **hoặc** rút về ≤ 7 ngày nếu đúng ý đồ "cuối tuần" | Window dài không vi phạm guard (chỉ tên sai). Đổi window khi đang ACTIVE có thể đổi giá checkout giữa chừng → khuyến nghị giữ window, chỉ đổi tên. |
| fs#3 `status` | ACTIVE | Giữ ACTIVE tới 06/11 rồi hết tự nhiên | Tắt sớm làm mất giá flash đang bán; bật/tắt đã có nút Admin + test. |
| items #5/#6 giá/quota/sold | 50.000/100/sold2, 24.000/200/sold0 | Giữ nguyên | Giá < base đúng; sold khớp checkout; quota claim đã atomic. |

Không tuyên bố fs#3 là chương trình thực tế đã xác minh — đây là dữ liệu seed/demo mang tên sai, đã chặn tái diễn bằng guard.

---

## 2. A5 — Địa chỉ (huyện/xã cũ, mã 12205)

### 2.1. Bằng chứng DEV (SELECT)

- 4 farms giữ nguyên văn địa chỉ tiền sáp nhập: #9 `Thôn Đa Hòa, xã Minh Châu, huyện Văn Lâm`, #10 `Thôn Đình Dù, xã Đình Dù, huyện Văn Lâm`, #11 `Thôn Phú Thị, xã Phú Cường, huyện Kim Động`, #12 `Xã Hồng Nam, TP Hưng Yên`. Seed vẫn ghi 4 chuỗi này (`seed.ts:188-279`) — DEV = seed, chưa ai sửa.
- Catalogue 104 đơn vị đã import: `wards = 104` trong DEV, nguồn dataset `hung_yen_104_xa_phuong_2026.json` + `SOURCE_METADATA.json` (tỉnh 33, hiệu lực 2025-07-01, căn cứ 1666/NQ-UBTVQH15 và 19/2025/QĐ-TTg). Không tên xã cũ nào còn là xã/phường (`Minh Châu/Đình Dù/Phú Cường/Hồng Nam/Văn Lâm/Kim Động/Tân Quang` đều NONE trong catalogue).
- addr#16: `provinceCode 33 + wardCode 12205 + wardName "Xã Khoái Châu"` hợp lệ (mã tồn tại trong catalogue), nhưng `village/detail "gần ủy ban"` vô nghĩa + `ward NULL + district NULL` (row tạo 10/10/2026 qua flow mới, verified-code nhưng free-text cẩu thả). Đây là dữ liệu test, không phải địa chỉ giao hàng thật đã xác minh.
- Schema giữ hai thế hệ cố ý (`schema.prisma:286-301`): free-text cũ không bao giờ bị đoán lại; `wardCode/wardName` chỉ set khi mã verified. Order snapshot (`shippingAddressSnapshot`) đóng băng tại checkout nên không bị ảnh hưởng bởi bất kỳ ánh xạ nào.

### 2.2. Kết luận và đề xuất (KHÔNG tự đoán xã mới)

- Không có bằng chứng thôn → xã mới cho 4 farms (dataset REM GHI: không bao gồm thôn/tổ dân phố). **Không đề xuất ánh xạ mã** cho farms; mọi đoán thôn Đa Hòa/Đình Dù/Phú Thị thuộc xã mới nào đều là bịa.
- Đề xuất duy nhất chờ duyệt: khi chủ farm cung cấp địa chỉ mới theo CCCD/sổ đỏ, Admin cập nhật thủ công từng farm qua API/farm form (địa chỉ farm là free-text vận hành, không qua catalogue validation); giữ chuỗi cũ trong audit log. Snapshot đơn lịch sử không đụng tới.
- addr#16: đề xuất vô hiệu hóa/xóa row test **khi chủ tài khoản xác nhận** (row gắn customer #16 đang ACTIVE) — không tự xóa; đồng thời nhắc nhập liệu: `detail` bắt buộc có số nhà/đường (đã có validation phía form, row này lọt trước đó hoặc qua API trực tiếp).

---

## 3. A6 — Chứng nhận (4 VERIFIED thiếu file)

### 3.1. Bằng chứng DEV (SELECT)

| cert | farm | window | file | validity tính lúc đọc |
|---|---|---|---|---|
| #9 VG-HY-2026-014 VietGAP | #9 Minh Châu 1 | 2026-06-09 → 2027-06-09 | có PDF | VALID |
| #10 VG-HY-2026-027 VietGAP | #10 Minh Châu 2 | 2026-07-04 → 2027-07-04 | NULL | INVALID (thiếu chứng từ) |
| #11 GG-HY-2025-003 GlobalGAP | #11 Phú Cường | 2025-09-02 → 2026-09-07 | NULL | EXPIRED |
| #12 VG-HY-2026-041 VietGAP | #12 Sông Hồng | 2026-08-08 → 2027-08-08 | NULL | INVALID trong DEV hiện tại (seed ghi PENDING; DEV đã VERIFIED — xem dưới) |

Seed ghi: #9 VERIFIED + file, #10 VERIFIED không file, #11 VERIFIED hết hạn không file, #12 **PENDING** không file (`seed.ts:282-333`). DEV hiện tại: cả 4 đều VERIFIED — tức **ai đó đã verify #12 trên DEV sau seed** (có audit `CERTIFICATE_*`, không truy sâu actor trong đợt này). Không tuyên bố bất kỳ row nào là "đã xác minh thực tế": hệ thống chỉ biết cờ + audit, không có biên bản site-audit.

### 3.2. Nhãn "Hồ sơ đã đối chiếu" và fix hiển thị

Nhãn đúng với những gì hệ thống kiểm được (record tồn tại + ACTIVE + trong window + có chứng từ) và đã ghi chú không nhận site-audit. Sau A3, `/valid` + trace chỉ trả VALID (có file), nên #10/#11/#12 không bao giờ lọt ra public dù vẫn VERIFIED. Đợt này chỉ sửa copy cho khớp: `resources.ts` + `TraceDetail.tsx` nêu rõ "+ carrying a document" (2 dòng comment/doc, không đổi UI).

Admin đã đủ (tag Hết hiệu lực/Thiếu chứng từ từ A3); Customer/Mobile/QR dùng chung `/valid` nên nhất quán. Không sửa UI thêm.

### 3.3. Đề xuất DEV (chờ duyệt, KHÔNG thực thi)

- Không cấp/gia hạn/đổi trạng thái/ngày. Không coi demo là xác minh thật.
- Khi có scan chứng từ thật: Admin đính kèm `fileUrl` từng cert (mutation thường, có audit), hệ thống tự lên VALID lúc đọc nếu còn window. #11 hết window vẫn EXPIRED dù bổ sung file — phải tái chứng nhận ngoài đời, không fix bằng DB.
- #12 VERIFIED-trên-DEV: đề nghị chủ sở hữu xác nhận có biên bản xác minh thật không; nếu không, revert về PENDING + lý do (hành động có audit, chờ duyệt).

---

## 4. Files đã sửa (đợt A4/A5/A6)

- `apps/api/src/promotions/promotions.service.ts`: guard `createFlashSale` (window + nhãn weekend).
- `apps/api/test/business-rules/promotions.spec.ts`: +3 tests (window ngược, weekend-60-ngày, weekend-7-ngày).
- `apps/admin-web/src/app/(admin)/flash-sales/page.tsx`: placeholder hướng dẫn tên.
- `apps/customer-web/src/lib/api/resources.ts`, `components/trace/TraceDetail.tsx`: doc nhãn chứng từ (không đổi UI).

Không sửa A5 schema/code (thiết kế hai thế hệ + snapshot đã đúng), không sửa A6 logic (A3 đã đủ).

---

## 5. Test evidence (TEST DB độc lập)

| Lệnh | Kết quả |
|---|---|
| `tsc --noEmit apps/api` | PASS |
| `vitest run apps/api` | **386/386 PASS** (29 files, gồm promotions 37 + certificate-validity 7) |
| `vitest e2e apps/api` | **331/331 PASS** (11 files) |
| `oxlint apps/api` | PASS, 5 warning có sẵn |
| `tsc admin-web + customer-web` | PASS |

DEV sau test: fs#3, 4 farms, addr#16, 4 certs nguyên trạng (chỉ SELECT trong nhiệm vụ).

---

## 6. Final verdict

- **A4 GUARDED + PENDING APPROVAL:** tái diễn bị chặn bằng test; DEV fs#3 chờ duyệt đổi tên (khuyến nghị) + giữ window/giá/quota.
- **A5 DOCUMENTED + NO GUESS:** không ánh xạ khi thiếu bằng chứng thôn→xã; snapshot lịch sử an toàn; addr#16 chờ xác nhận chủ tài khoản.
- **A6 CONSISTENT + PENDING EVIDENCE:** thiếu file không bao giờ hiển thị còn hiệu lực; nhãn không nhận site-audit; chờ chứng từ thật/audit xác nhận #12.
- **BLOCKED:** không. **NOT TESTED:** smoke tay trình duyệt (không đổi layout).
