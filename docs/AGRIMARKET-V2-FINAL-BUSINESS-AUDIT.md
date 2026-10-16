# AgriMarket V2 — Final Business Audit (P0/P1 repair round)

**Date:** 2026-10-11 (evening session)
**Scope:** NestJS/Prisma/MySQL API + Admin Web + Customer Web + Expo Mobile
**Method:** read-only DEV inspection → TEST-database repair verification → full automated suite + browser smoke
**Database discipline:** every mutation in this round ran against `agrimarket_v2_test`; DEV (`agrimarket_v2`) was never reset, reseeded, migrated or written by this round's *repairs*. The only DEV rows touched are the documented, self-cleaning probe orders created by the mobile live-integration suite (see §7).

---

## 1. What was fixed (P0/P1)

| # | Severity | Defect (Checkpoint A finding) | Fix | Verified by |
|---|----------|-------------------------------|-----|-------------|
| F3 | P1 | COD was auto-marked `PAID` on the `DELIVERED` transition in both `OrdersService.applyStatusChange` and `ShipmentsService.updateStatus` — delivery success was treated as proof of cash collection | Both paths no longer touch payments. `PATCH /payments/:id/status` (ADMIN) is the only path that sets `paidAt`. Admin order detail gained a **"Ghi nhận thu tiền"** button on PENDING payments and honest copy | `mutation-acceptance` e2e (delivered ⇒ COD still PENDING; explicit confirm ⇒ PAID once), `checkout-hardening.spec` ("never marks COD PAID on delivery") |
| F4 | P1 | Delivered orders never released/reduced stock: `reserved` was held forever, `on_hand` never fell, no OUTBOUND movement referenced an order | New atomic `InventoryService.consumeStock` (`on_hand -= q, reserved -= q` guarded by `reserved >= q AND on_hand >= q`) + `consumeOrderStock` (per-allocation consume, OUTBOUND movement with `referenceType: 'Order'`, lot `remaining_quantity` decrement). Called from both delivery paths; conflict ⇒ 409 rollback | `inventory.spec` (consume/guard), `checkout-hardening.spec` (OUTBOUND + 409 rollback), `concurrency.e2e` cancel-vs-deliver (delivered ⇒ reserved 0, on_hand 7, 1 OUTBOUND), `mutation-acceptance` e2e |
| F5 | P1 | Settlements included `READY_TO_SHIP`/`SHIPPING` partner orders (money not delivered) and could settle the same order twice across periods | Filter is now `status: DELIVERED` **and** `settlementLines: { none: {} }` — an order in transit is excluded and an already-settled order can never be claimed again | `settlement.spec` (exact where-clause pin), DEV check: 1 of 3 existing settlement lines referenced a non-DELIVERED order (CONFIRMED) — the defect was real in live data |
| F1 | P1 | Lot creation never validated that the product belongs to the harvest's farm/partner — the public trace chain could claim an origin the goods never had | `LotsService.create` requires `product.farmId === season.farmId` or (no farm) same `partnerId`; 400 otherwise | `harvest.spec` (reject mismatch, accept no-farm same-partner), `mutation-acceptance` e2e (cross-partner lot refused 400) |
| F2 | P1 | Two concurrent lot creations could both pass the Σ ≤ harvest check (read-then-write, no lock) | Σ-check + insert moved into one transaction; the harvest row is re-read `SELECT … FOR UPDATE` first (`lockHarvest`), serialising concurrent creations | Unit: transaction path with locked quantity; e2e: second over-quantity lot refused |
| F6 | P1 | "Sản phẩm bán chạy" counted *ordered* (non-cancelled) quantity, had no unit, and the label read "bán" | `topProducts` now counts **DELIVERED** orders only, carries the variant `saleUnit`, admin column is "SL đã giao" rendered via `formatQuantity(v, unit)`, export column split into "SL đã giao" + "Đơn vị" | Unit/e2e suites; browser smoke: `Gạo nếp cái hoa vàng · 1 bao · 215.000 ₫` |
| F7 | P1 | Traceability pages claimed "ghi nhận từ lô hàng thực tế / Không có dữ liệu mẫu" — a database row does not prove real-world origin | Mobile trace detail + trace tab now read: "Hồ sơ truy xuất do AgriMarket cung cấp theo dữ liệu ghi nhận của đơn vị sản xuất. AgriMarket không tự xác minh ngoài thực địa." Customer-web certificate badge changed from "Đã xác minh bởi AgriMarket" to "Hồ sơ đã đối chiếu" | Text verified in code; mobile/customer builds pass |
| F8 | P2 | Lot `remainingQuantity` was stale after real checkouts (never decremented outside seed); shown to customers as "Còn lại" | `consumeOrderStock` decrements `product_lots.remaining_quantity` (clamped at 0) in the same delivery transaction, so the figure now tracks real deliveries | `inventory.spec`; e2e delivered-order assertions |
| F9 | P2 | QR modal showed a technical env-var instruction (`NEXT_PUBLIC_TRACE_BASE_URL`) to end users | Replaced with user-facing copy: the AgriMarket app scans it; a generic camera shows the code as text | Browser smoke: modal contains no `NEXT_PUBLIC_TRACE_BASE_URL`; `lot-qr.spec.tsx` |
| F10 | P2 | QR print/download offered for `REJECTED`/`RECALLED`/expired lots (sales-label misuse) | `canShowLotQr` now also requires status ∉ {REJECTED, RECALLED} and `expiresAt` in the future (PENDING_QC stays allowed — labels are prepared during inspection) | `lot-qr.spec.tsx` (rejected + expired fixtures show no button), browser smoke: 18/19 DEV lots show QR; the rejected/expired one does not |
| F11 | P2 | QC criterion "Hư hỏng/Tổn thương: Đạt" was ambiguous ("damage: pass"?) | Labels are now positively phrased: "Không hư hỏng" (admin QC list, lot detail, mobile) and "Không tổn thương" (customer web) | Text verified in all three UIs; builds/tests pass |
| F12 | P2 | Movement rows showed "Thay đổi = 0" for RESERVE/RELEASE while Trước/Sau were *reserved* values — looked broken | Both movement tables now render the row's own delta (`+2`, `-2` for reserve/release; `quantityDelta` otherwise) with an explicit basis suffix "(Đã giữ)" / "(Tồn thực tế)" via `inventoryMovementBasis` | Browser smoke: reserve row reads `+2 (Đã giữ)`, before 32 → after 34 |
| F13 | P2 | Admin "Khách hàng" page listed ADMIN accounts too — the label misled | Menu group, page title, column, empty/error strings renamed to "Người dùng"; role column already distinguished Quản trị viên/Khách hàng | Browser smoke: sidebar "Người dùng", h1 "Người dùng" |
| F14 | P2 | Android warning `Response.blob() is using React Native…` from `fetchEvidenceImage` | Replaced `res.blob()`/`FileReader` with `XMLHttpRequest` (`responseType: 'arraybuffer'`) + a hand-rolled base64 encoder — no Blob, no `Buffer` | Mobile typecheck/lint/tests pass |
| F15 | P2 | Seed flash-sale name "Flash Sale cuối tuần Hưng Yên" spans ±30 days — misleading in fresh seeds | Seed name changed to "Flash Sale nông sản Hưng Yên" (the DEV row is documented, not rewritten) | `seed.ts`; note in §4 |

Also updated in the same round (documentation/consistency):

- `docs/BUSINESS-RULES.md` §6 rewritten ("COD is collected, not assumed"), new §6b ("Delivery consumes the reservation"), §11 settlement rule, §15/§16 state-machine notes.
- `docs/API.md` order/shipment `PATCH /:id/status` descriptions now state delivery consumes stock reservations and COD collection is confirmed separately.
- Admin order-detail COD banner + helper text now describe the real mechanism.

---

## 2. Verified-correct behaviours (audited, intentionally unchanged)

- Reservation release / quarantine / double-cancel CAS guards; `releaseStock`/`quarantineStock` atomic SQL (DEV movements confirm RESERVE/RELEASE pairs with correct before/after).
- FEFO eligibility (SELLABLE + not expired + latest QC PASS + available > 0) and no-oversell conditional UPDATE — 10-buyer races pass every round.
- Refund caps (Σ PENDING+COMPLETED ≤ paid), voucher/flash quota atomic claims, idempotency replay, 409 re-price, commission specificity (partner+category 7% wins, no stacking), warehouse-document completion CAS.
- Settlement arithmetic (`gross − refund − commission + adjustment = payable`) — verified on DEV `SET-0001` and locked by tests.

---

## 3. Test & build evidence (this round)

| Check | Result |
|---|---|
| API unit (`npm run test`, 28 files) | **369/369 pass** (was 361 before this round; +8 new assertions, 0 removed) |
| API e2e (`npm run test:e2e`, TEST DB, 11 files) | **325/325 pass** |
| API `typecheck` / `build` / `lint` | clean (lint: 5 pre-existing warnings only) |
| Admin web `typecheck` / `build` / `lint` / `test` | clean / 26 routes / clean / **40/40 pass** |
| Customer web `typecheck` / `build` / `lint` | clean / 28 routes / clean |
| Mobile `typecheck` / `lint` / `test` | clean / clean / **174/174 pass** |
| Browser smoke (production admin build on `http://localhost:3001`, DEV API read-only) | login OK; orders list; order detail shows "Ghi nhận thu tiền" on a PENDING COD row; lots list hides QR on the rejected/expired lot; QR modal centered, no env-var text; movements show `+2 (Đã giữ)`; reports show "SL đã giao" with units; menu/page "Người dùng" |

New/updated tests pinning the repaired rules:

- `apps/api/test/business-rules/inventory.spec.ts` — `consumeStock` guarded decrement + null-guard.
- `apps/api/test/business-rules/checkout-hardening.spec.ts` — DELIVERED consumes stock (OUTBOUND, −qty), never marks COD PAID, 409 when the reservation vanished.
- `apps/api/test/business-rules/settlement.spec.ts` — exact `DELIVERED` + `settlementLines: none` where-clause.
- `apps/api/test/business-rules/harvest.spec.ts` — partner/farm consistency (reject mismatch, accept same-partner no-farm) + transaction path.
- `apps/api/test/business-rules/lot-qc.spec.ts` — new-lot path with season/farm stub.
- `apps/api/test/mutation-acceptance.e2e-spec.ts` — cross-partner lot refused; delivered order keeps COD PENDING, consumes stock; explicit collection marks PAID.
- `apps/api/test/concurrency.e2e-spec.ts` — cancel-vs-deliver invariant updated to the consumed-stock outcome.
- `apps/admin-web/test/lot-qr.spec.tsx` — rejected/expired lots lose the QR action; fixture expiry moved out of "today" so it can't flip at midnight.
---

## 4. Data artefacts (documented, NOT rewritten)

- `WHD-20261003-0001` createdAt 2026-10-10 with note "Tách từ WHD-20260921-0001" — the 03/10 date is the declared business date; the row was backfilled later.
- `PAY-20261007-0001.requestedAt` (2026-10-06T17:00Z = 07/10 VN) vs settlement periodEnd — seed backfill.
- DEV flash sale still named "Flash Sale cuối tuần Hưng Yên" with its ±30-day window — a data artefact of the old seed; the seed source is fixed for fresh installs.
- DEV `LOT-20260930-0015.remainingQuantity` (260) predates the F8 fix; new deliveries now keep it truthful, but the historical value is not backfilled.
- DEV settlement lines: one references a CONFIRMED partner order (settled under the old permissive filter). Existing settlements are financial records and are not rewritten; the new filter prevents recurrence.

## 5. Owner decisions still open (not defects)

1. **Multi-warehouse scope** — the system supports many warehouses; the demo runs one. No code change pending a business decision.
2. **"Flash Sale cuối tuần Hưng Yên" (DEV row)** — the seed is fixed; renaming the live row is a content decision.
3. **"Rau muống hạt" product identity** — the name reads like a seed product but sells fresh greens; renaming affects DEV content and is the owner's call.
4. **Sale-unit ↔ stock-unit arithmetic** — DEV (read-only check) shows every allocation reserves 1 sale unit against 1 kg-labelled lot stock (e.g. `Bó 500 g` reserves 1 "kg"). This is a consistent, test-pinned modelling choice (stock is tracked in sale-unit equivalents), not a defect; converting to true weight-based stock is a product decision that would touch every lot, balance and historical order.

## 6. Boundary statement

- No commits, no branches, no `git reset/clean` were performed; all work is in the working tree.
- DEV was not reset, reseeded, migrated or edited by this round's repairs.
- The e2e suite ran against `agrimarket_v2_test` only (asserted by `TEST_DATABASE_URL` vs `DATABASE_URL` in `apps/api/.env`).
- Browser smoke ran against the DEV API **read-only** (login, lists, detail views) plus the local production admin build.

## 7. Honest caveats

- The mobile live-integration suite (`apps/mobile/src/lib/__tests__/checkout-live.test.ts`) is **designed** to create a real order against whichever API is reachable, then cancel it. Running `npm run test` in `apps/mobile` while the DEV API was up therefore created and cancelled `ORD-20261011-0025` and `ORD-20261011-0026` (both CANCELLED, reservations released, 1 cancel movement each — verified read-only). This is the suite's documented behaviour, not a defect introduced by this round; it is recorded here for full transparency.
- The production admin build used for the browser smoke was served locally on the CORS-allowed origin `http://localhost:3001`; `127.0.0.1` is intentionally not in the API's allow-list.
- The customer-web trace honesty fix (certificate badge, QC label) was verified by code review and build only — no customer-web server was running on `:3002` during the smoke.


