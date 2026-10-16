# AgriMarket V2 — Certificate Expiration Acceptance (A3) + GĐ1 Compatibility

**Ngày:** 2026-10-12 · **Phạm vi:** GĐ1 tương thích sau A1/A2 + FIX A3 chứng nhận hết hạn.
**Nguyên tắc:** giữ mọi thay đổi hiện tại, DEV `agrimarket_v2` chỉ SELECT, TEST `agrimarket_v2_test` cho mọi kiểm thử ghi (guard tên DB trong fixtures), không branch mới, không commit/push.

---

## 1. GĐ1 — Tương thích sau A1/A2

### 1.1. Admin thu COD sau `transactionReference` bắt buộc

Đối chiếu contract: `UpdatePaymentStatusDto.status + transactionReference?` (`apps/api/src/payments/dto/payment.dto.ts:24-33`); `PaymentsService.updateStatus` yêu cầu reference khi PAID, state machine PENDING→PAID/FAILED, PAID→PARTIALLY/REFUNDED, REFUNDED terminal, replay no-op.

Phát hiện: nút Admin `Ghi nhận thu tiền` gọi `resources.updatePaymentStatus(paymentId, "PAID")` **không gửi reference** (`orders/[id]/page.tsx:76` trước fix) → mọi lần bấm đều 400 sau A1/A2. Resource helper đã hỗ trợ tham số thứ ba nhưng UI không dùng.

Fix tối thiểu (không redesign): dialog nhập `Mã biên lai / mã giao dịch` bắt buộc, required-rule phía client, gửi kèm `transactionReference`; giữ nguyên bảng, copy cảnh báo, invalidate queries. File: `apps/admin-web/src/app/(admin)/orders/[id]/page.tsx`.

Kiểm thử: e2e `refuses to confirm COD collection without a transaction reference` (400, payment vẫn PENDING), `records the COD collection explicitly...` (PAID + `paidAt`, replay idempotent), `refuses to move a REFUNDED payment back to PAID` — PASS trên TEST DB.

### 1.2. Order → Shipment → DELIVERED → OUTBOUND, không double consume

Luồng đã chứng minh: order DELIVERED qua `OrdersService` consume 1 lần (`reserved → 0`, `onHand 200 → 195`, 1 OUTBOUND `referenceType Order`); shipment sau đó lên DELIVERED ghi 1 `ShipmentEvent` nhưng OUTBOUND không tăng; replay shipment DELIVERED không thêm event. E2E `a second DELIVERED through the shipment path cannot consume twice` + `a retried shipment DELIVERED is idempotent` PASS. Không sửa thêm backend ở GĐ1 ngoài dialog Admin (logic CAS/consume đã chốt ở A1/A2).

### 1.3. Lot lịch sử vs guard mới (read-only DEV)

Quét `qa-a1-a2-audit.mjs` trên DEV: mọi lot SELLABLE có `remaining <= onHand` và `remaining + allocated = onHand` (seed trừ `remaining` khi reserve). Guard mới `remaining >= qty` khi DELIVERED luôn thỏa vì `remaining` chỉ giảm khi consume thật, còn allocation đang giữ không làm `remaining` âm. Lot #41 REJECTED/QC FAIL không balance nên không bao giờ vào FEFO/consume. **Không lot nào gây 409 oan; không sửa dữ liệu DEV.** Rủi ro duy nhất còn lại là reservation treo của đơn DELIVERED cũ (lot #53, `reserved 32` gồm 2 đơn #40) — đã ghi kế hoạch dry-run ở báo cáo A1/A2, không backfill.

---

## 2. A3 — Root cause

Schema `Certificate`: `verificationStatus` (PENDING/VERIFIED/REJECTED) + `status` (ACTIVE/INACTIVE) + `issuedAt/expiresAt` + `fileUrl?`. Không có EXPIRED/REVOKED lưu trữ — đúng thiết kế (expiry là sự kiện thời gian, không phải cờ tay).

Lỗi: mọi bề mặt đọc cờ VERIFIED như "còn hiệu lực":
- `findValidByFarm` đã lọc window nhưng vẫn trả rows thiếu `fileUrl` (chứng từ là bắt buộc theo A6) và callers khác (`findAll`, `findOne`, `verify`, trace) không có cờ hiệu lực nào.
- Admin list chỉ gắn tag "Hết hiệu lực" bằng `Date.now()` phía client, farm detail không gắn gì; Customer `FarmCertificates` ghi badge sai "Đã xác minh bởi AgriMarket"; trace/mobile chỉ liệt kê `certificates` đã lọc mà không nói rõ đó là hồ sơ đã đối chiếu.
- DEV cert#11 `GlobalGAP GG-HY-2025-003` (`2025-09-02 → 2026-09-07`, VERIFIED/ACTIVE, không fileUrl) vẫn ACTIVE quá hạn từ 07/09 — đúng là demo/seed hết hạn, nhưng hệ thống không có chỗ nào nói "đã hết hiệu lực, không dùng nữa" ngoài tag client-side.

Timezone: `issuedAt/expiresAt` lưu UTC (MySQL `DateTime` + Prisma), so sánh `<= / >=` trực tiếp với `now`; window inclusive cả hai đầu (đúng ngày hết hạn vẫn VALID, sau 1ms là EXPIRED — đã pin bằng test biên).

---

## 3. Fix A3 (không cron, không viết lại DEV)

Nguyên tắc: **hiệu lực tính lúc đọc**, cờ lưu trữ giữ nguyên lịch sử. Không cron job (tránh ghi nền, #: EvidenceSweep đã nêu lý do không thêm scheduler; expiry là hàm của `now`, job chỉ tạo race + ghi lịch sử). Không cấp/gia hạn/sửa ngày, không biến demo thành xác minh thực.

Backend `apps/api/src/certificates/certificates.service.ts`:
- `certificateValidityAt(cert, at)`: `VALID` khi VERIFIED + ACTIVE + trong `[issuedAt, expiresAt]` + có `fileUrl`; ngoài window → `EXPIRED` (bất kể pending/rejected/inactive — quá hạn thì không bao giờ trình bày là còn hiệu lực); còn lại → `INVALID`.
- `findAll/findOne/create/verify` trả `validity`; `findValidByFarm` lọc DB (`VERIFIED + ACTIVE + window + fileUrl NOT NULL`), lọc rỗng chuỗi, chỉ trả `VALID`.
- `verify` giữ audit, 명시: VERIFIED không hồi sinh window hết hạn.

Frontend (tối thiểu, giữ layout):
- Admin `certificates/page.tsx` + `farms/[id]/page.tsx`: dùng `validity`, fallback date-check cho rows cũ; thêm tag "Thiếu chứng từ" khi VERIFIED nhưng INVALID do thiếu file.
- Customer `FarmCertificates.tsx`: badge sửa "Đã xác minh bởi AgriMarket" → "Hồ sơ đã đối chiếu" (khớp TraceDetail), copy header nêu rõ backend lọc VERIFIED + ACTIVE + window + chứng từ.
- Types Admin/Customer/Mobile thêm `validity?` (optional, tương thích rows cũ). Trace/mobile dùng chung `findValidByFarm` nên tự hưởng; QR trace không đổi contract.

---

## 4. Test evidence (TEST DB độc lập)

| Lệnh | Kết quả |
|---|---|
| `npm exec --workspace @agrimarket/api -- tsc --noEmit -p tsconfig.json` | PASS |
| `npm exec --workspace @agrimarket/api -- vitest run` | **383/383 PASS** (29 files, gồm `certificate-validity.spec.ts` 7 tests: VALID/EXPIRED biên inclusive/ngày hết hạn/PENDING/REJECTED/INACTIVE/chưa hiệu lực/thiếu file/`findValidByFarm` loại cert#11-shape/verify giữ audit) |
| `npm exec --workspace @agrimarket/api -- vitest run --config ./vitest.config.e2e.ts` | **331/331 PASS** (11 files; governance +2: expired-VERIFIED giữ cờ nhưng không vào `/valid`, thiếu file không vào `/valid`) |
| `npm exec --workspace @agrimarket/api -- oxlint` | PASS, 5 warning có sẵn |
| `npm exec --workspace @agrimarket/admin-web -- tsc --noEmit` | PASS |
| `npm exec --workspace @agrimarket/admin-web -- vitest run` | **40/40 PASS** |
| `npm exec --workspace @agrimarket/customer-web -- tsc --noEmit` | PASS |
| `npm exec --workspace @agrimarket/mobile -- tsc --noEmit` | PASS |

DEV sau test (SELECT): cert#9/#10/#12 VALID, **cert#11 GlobalGAP GG-HY-2025-003 vẫn VERIFIED/ACTIVE hết hạn 2026-09-07, không fileUrl** — nguyên trạng, chờ duyệt. Không cron, không job nền, không sửa DEV.

---

## 5. DEV data chưa chỉnh sửa

- cert#11 + 3 cert còn lại: giữ nguyên cờ + ngày (demo/seed). Hệ thống giờ trình bày đúng (EXPIRED/INVALID, không vào `/valid`/trace), nên không cần ghi khẩn.
- Nếu duyệt: phương án là **không sửa cờ**, chỉ bổ sung `fileUrl` scan thật khi có chứng từ hoặc `INACTIVE` hóa khi hết hiệu lực vận hành — quyết định chủ sở hữu, dry-run riêng.

---

## 6. Files đã sửa

API: `src/certificates/certificates.service.ts`, `test/business-rules/certificate-validity.spec.ts` (mới), `test/mutation-acceptance.e2e-spec.ts` (governance + cleanup `farmId`).
Admin: `src/app/(admin)/orders/[id]/page.tsx` (dialog COD reference), `src/app/(admin)/certificates/page.tsx`, `src/app/(admin)/farms/[id]/page.tsx`, `src/types/api.ts`.
Customer: `src/components/product/FarmCertificates.tsx`, `src/lib/api/types.ts`.
Mobile: `src/lib/types.ts`.

---

## 7. Final verdict

- **GĐ1 COMPATIBLE:** Admin thu COD gửi reference, Order→Shipment→DELIVERED consume đúng một lần, lot lịch sử không gây 409 oan.
- **A3 FIXED + TEST PASS:** hết hạn tính lúc đọc, VERIFIED quá hạn không bao giờ hiển thị còn hiệu lực, thiếu file không vào `/valid`, nhất quán API/Admin/Customer/Mobile/QR.
- **DEV DATA PENDING APPROVAL:** cert#11 và dữ liệu kho cũ nguyên trạng, chờ duyệt riêng.
- **BLOCKED:** không. **NOT TESTED:** browser smoke tay (không đổi layout nên dùng lại smoke audit trước).
