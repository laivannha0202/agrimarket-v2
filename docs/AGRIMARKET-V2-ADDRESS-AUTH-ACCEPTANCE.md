# AGRIMARKET V2 — ACCEPTANCE: DELIVERY ADDRESS (104 HƯNG YÊN XÃ/PHƯỜNG) + CUSTOMER ACCOUNT SELF-SERVICE

Feature scope: (A) delivery address built on the official 104-unit Hưng Yên catalogue (2025 reorganisation),
(B) customer account self-service (public register, login, change password, real token-based forgot/reset password)
shared by Customer Web and Mobile Expo Go, with the API as the single source of truth.

Result summary: **18/18 live HTTP smoke checks PASS · 333 API unit tests PASS · 281 API e2e tests PASS ·
82 Mobile tests PASS · 0 build/type/lint errors.** Two real email delivery and one real Android device
item are reported **BLOCKED / PENDING** below — not as PASS.

---

## 1. Objective and scope

Deliver two missing business features on top of the existing V2 work, on the real source tree:

| # | Feature | Delivered |
|---|---------|-----------|
| A | Delivery address on the official 104 xã/phường catalogue of Hưng Yên, replacing the pre-merger district model | API catalogue + Web picker + Mobile picker + checkout snapshot |
| B | Customer account self-service | Public register, login, change password, real token-based forgot/reset password, shared by Web and Mobile |

Explicitly out of scope, and not done: no APK/AAB build, no EAS, no Bare React Native, no USB/ADB, no
branch switch, no commit/push, no deploy, no DEV database reset/reseed.

## 2. Requirements and constraints honoured

- **Administrative codes are strings.** `Ward.code` is `VarChar(5)`; `provinceCode` is `VarChar(20)`. No code
  is ever parsed to an integer. Verified in the DB and over HTTP (`typeof w.code === 'string'`, `/^\d{5}$/`).
- **No invented data.** No thôn/tổ dân phố list, no GPS, no postcode, no old district list was fabricated.
  Thôn/tổ dân phố remains free text (`village`), because no verified list exists.
- **No pre-merger catalogue.** Only the delivered 2025 dataset is used; the dataset validator asserts
  104 units / 93 xã + 11 phường / province 33.
- **Backend is the single source of truth.** The 104-row list is **not** copied into Customer Web or Mobile.
  Both frontends fetch it from `GET /locations/provinces/:code/wards`.
- **Server-side validation is mandatory.** Ward must exist and belong to the submitted province; the display
  name is resolved from the code server-side; a client-supplied name is discarded. Ownership is enforced
  (IDOR-protected): address routes are scoped by `user.id`.
- **Checkout still computes the fee and the address snapshot server-side.** `CheckoutDto` has no
  `shippingFee` field, and the global `ValidationPipe` rejects an unknown field with 400.
- **Reset tokens are real.** SHA-256 hash at rest, 1-hour TTL, single-use, superseded on re-request,
  and a single generic error for every failure mode (no enumeration).
- **Auth module was extended, not rewritten.** One customer account system serves Web and Mobile.
- **Only related code was touched.** Admin/API/Mobile V2 work is preserved; the Admin change is a
  display-only two-generation address renderer.

## 3. Deliverable files

### 3.1 API — new

| Path | Purpose |
|------|---------|
| `apps/api/src/locations/locations.module.ts` | Locations module wiring |
| `apps/api/src/locations/locations.controller.ts` | Public catalogue routes |
| `apps/api/src/locations/locations.service.ts` | Catalogue read, cache, accent search, ward resolution |
| `apps/api/src/locations/dto/location.dto.ts` | Response DTOs + `MAX_WARD_LIMIT = 500` + ward query DTO |
| `apps/api/src/mail/mail.module.ts` | Mail module |
| `apps/api/src/mail/mail.service.ts` | `smtp` \| `test` transport, in-memory capture, honesty flag |
| `apps/api/src/auth/password-version.ts` | Password-version claim (`pwd`) helper |
| `apps/api/src/auth/dto/account.dto.ts` | Register / forgot / reset / change-password DTOs + shared policy |
| `apps/api/src/auth/auth-throttler.guard.ts` | Throttler guard keyed on IP + email/phone |
| `apps/api/src/common/utils/vietnamese-text.ts` | Accent folding + whitespace normalisation |
| `apps/api/src/common/utils/phone.util.ts` | Vietnamese mobile normalisation |
| `apps/api/prisma/import-wards.ts` | Reads the dataset JSON directly and upserts 104 wards |
| `apps/api/prisma/migrations/20261012000000_hung_yen_wards_and_auth/` | `provinces`, `wards`, `password_reset_tokens`, nullable address code columns |
| `apps/api/prisma/migrations/20261012000001_password_changed_at/` | `users.password_changed_at` (nullable, additive) |

### 3.2 API — modified

`src/auth/auth.service.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.module.ts`, `src/auth/jwt.strategy.ts`,
`src/users/users.service.ts`, `src/users/users.controller.ts`, `src/users/dto/user.dto.ts`,
`src/orders/orders.service.ts`, `src/orders/dto/checkout.dto.ts`, `src/config/configuration.ts`,
`src/app.module.ts`, `prisma/schema.prisma`, `.env.example`.

### 3.3 Frontends

- **Customer Web:** `components/common/WardPicker.tsx`, `components/account/AddressListView.tsx`,
  `components/auth/{RegisterForm,ForgotPasswordForm,ResetPasswordForm,ResetPasswordTokenGate,LoginForm}.tsx`,
  `components/account/ChangePasswordForm.tsx`, `components/account/AccountNav.tsx`,
  `components/checkout/CheckoutView.tsx`, `lib/address.ts`, `lib/auth/password-policy.ts`,
  `lib/auth/useAuth.ts`, `lib/api/{types,resources,query-keys}.ts`,
  routes `/dang-ky`, `/quen-mat-khau`, `/dat-lai-mat-khau`, `/tai-khoan/doi-mat-khau`.
- **Mobile:** `components/WardPicker.tsx`, `lib/address.ts`, `lib/checkout.ts`, `lib/types.ts`,
  `lib/resources.ts`, `providers.tsx` (`adoptToken`), `app/addresses.tsx`, `app/checkout.tsx`,
  `app/login.tsx`, `app/(tabs)/account.tsx`, screens `register`, `forgot-password`, `reset-password`,
  `change-password`, `app/_layout.tsx`.
- **Admin Web:** `src/components/common/InfoDescriptions.tsx` (`formatAddress()` two-generation display),
  `src/types/api.ts` (address codes). Display-only; no business logic changed.

### 3.4 Verification tooling

| Path | Purpose |
|------|---------|
| `apps/api/test/address-auth.e2e-spec.ts` | 37 e2e tests for both features over real HTTP + real DB |
| `apps/api/test/business-rules/locations.spec.ts` | 22 unit tests (catalogue, clamp, search, resolution) |
| `apps/api/test/business-rules/auth-account.spec.ts` | 28 unit tests (register/change/forgot/reset) |
| `apps/api/test/business-rules/password-version.spec.ts` | 4 unit tests (version claim) |
| `apps/api/test/business-rules/mail.spec.ts` | 9 unit tests (transport selection, capture, honesty) |
| `apps/api/test/business-rules/query-dto.spec.ts` | +`WardQueryDto` block (87 tests total) |
| `apps/api/test/helpers/test-app.ts` | `resetThrottler()` via `onApplicationShutdown()` |
| `scripts/address-auth-smoke.mjs` | Live HTTP acceptance smoke test (18 checks) |
| `scripts/purge-smoke-residue.mjs` | Dry-run-by-default cleanup of `smoke…` residue |

### 3.5 Reference documentation updated

The project's living references were stale for both features (e.g. `docs/API.md`
documented `/auth` with only `login` and `me`, and had no catalogue section at
all). They were brought in line with the shipped code:

| Path | Change |
|------|--------|
| `docs/API.md` | Auth section extended (register / forgot / reset / change-password, delivery honesty, rate-limit table); new **Administrative catalogue — `/locations`** section; **two generations of address** documented under Customers; the `limit ≤ 100` rule noted with its `wards` exception |
| `docs/DATABASE.md` | `provinces`, `wards`, `password_reset_tokens` added; address code columns and `users.password_changed_at` documented; migration ledger completed (8 migrations, 50 tables) |
| `docs/BUSINESS-RULES.md` | New rule **18** (delivery address follows the 2025 reorganisation) and rule **19** (customer accounts and password recovery) |

These are documentation-only edits: no source behaviour was changed by them.

## 4. Data model changes

Additive only; nothing destructive, nothing backfilled by guesswork.

| Object | Change |
|--------|--------|
| `provinces` (new) | `code VarChar(20)` PK, `name`, `fullName` |
| `wards` (new) | `code VarChar(5)` PK, `provinceCode`, `type` (`xa`\|`phuong`), `name`, `fullName`, precomputed accent-folded `searchText`, `effectiveFrom`, `status` |
| `addresses` | **+** `provinceCode VarChar(20)`, `wardCode VarChar(5)`, `wardName VarChar(120)` (all nullable) |
| `addresses` (kept) | legacy `province`, `district`, `ward`, `village` free text **preserved, never backfilled** |
| `users` | **+** `passwordChangedAt` (nullable — nobody is logged out by the migration) |
| `password_reset_tokens` (new) | `tokenHash` (SHA-256 only), `expiresAt`, `usedAt`; the raw token exists only in the email |

The legacy `district` column is deliberately **not** dropped: dropping it would destroy the historical text of
addresses saved before the reorganisation.

## 5. API surface

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/locations/provinces` | Public | Province list (Hưng Yên only — the storefront ships inside it) |
| GET | `/locations/provinces/:code` | Public | One province, 404 when unknown |
| GET | `/locations/provinces/:code/wards` | Public | Commune list, `search` (accent/case-insensitive, matches name **and** code) |
| GET | `/locations/provinces/:code/wards/:wardCode` | Public | One commune, 404 when unknown |
| POST | `/auth/register` | Public | Create an ACTIVE CUSTOMER; **no** session issued |
| POST | `/auth/login` | Public | JWT access token |
| POST | `/auth/forgot-password` | Public | Request a reset link; identical response for known/unknown |
| POST | `/auth/reset-password` | Public | Consume the single-use token, set the new password |
| PATCH | `/auth/change-password` | CUSTOMER | Change with the current password; returns a fresh token |
| GET | `/customers/me/addresses` | CUSTOMER | List my addresses |
| POST | `/customers/me/addresses` | CUSTOMER | Add an address (code-verified or legacy) |
| PATCH | `/customers/me/addresses/:id` | CUSTOMER | Edit my address (ownership enforced) |
| DELETE | `/customers/me/addresses/:id` | CUSTOMER | Delete my address (ownership enforced) |

Rate limits: login 10/min, register 5/min, forgot-password 3/min, reset-password 5/min — keyed on IP + the
submitted email/phone, so one client cannot exhaust another's budget.

## 6. Security decisions (and why)

1. **Codes are strings end to end.** A 5-char string PK cannot silently lose a leading zero.
2. **The client's commune name is never trusted.** When `wardCode` is present the server resolves
   `fullName` from the catalogue and overwrites any client text. Proven over HTTP: submitting
   `province: "Tỉnh Bịa Đặt"` alongside a valid code stored the official name, not the forged one.
3. **A ward code without its province code is a 400**, so a code cannot be validated against the wrong province.
4. **IDOR protection.** Every address route is scoped by the authenticated `user.id`.
5. **Anti-privilege-escalation on register.** The DTO has no `role` field and the global pipe forbids unknown
   properties, so `role: "ADMIN"` is a 400 — verified over HTTP, not assumed.
6. **Password change ends other sessions** via a `pwd` password-version claim in the JWT. `iat` alone was
   rejected during implementation because it has 1-second precision and cannot distinguish a token minted in
   the same second as the change. Legacy tokens without `pwd` fall back to `iat`.
7. **No email enumeration.** Known and unknown addresses return a byte-identical body *including* the
   `delivery` block; a delivery failure is logged without the token or the address.
8. **Reset tokens are hashed at rest** (SHA-256), 1-hour TTL, single-use, and superseded on re-request.
9. **The checkout fee is server-owned.** `FLAT_SHIPPING_FEE = 20000` in `src/orders/shipping-policy.ts` is the
   only fee computation; no DTO accepts a fee.

## 7. Two real bugs found and fixed during acceptance

Both were found by the new tests, not by reading code. Neither was a test-only adjustment.

**Bug 1 — catalogue truncation (the feature was silently broken).**
`listWards` clamped `limit` to the generic `MAX_PAGE_LIMIT = 100`, so a client asking for the whole
catalogue received 100 of 104 rows: **the last 4 wards were unselectable**, and the frontends had no way to
notice. Fixed with a dedicated `MAX_WARD_LIMIT = 500` in `src/locations/dto/location.dto.ts`, with the service
clamp and default updated (`limit: 200`) and `countWards` aligned. The regression test is
`test/business-rules/locations.spec.ts`; re-introducing the clamp makes it fail (2 failures), so it is
non-vacuous.

**Bug 2 — same-second session survival.**
A password change is supposed to sign out other devices, but the original check compared the token's `iat`
against `passwordChangedAt`. `iat` has 1-second precision, so a token minted in the same second as the change
survived. Fixed with an exact `pwd` claim (epoch ms of `passwordChangedAt`, `0` if never changed) written at
login and at change-password, and compared in `jwt.strategy.ts`. Covered by
`test/business-rules/password-version.spec.ts` and the e2e change-password test.

## 8. Verification — commands actually run and their real output

### 8.1 Dataset integrity

```
SHA256SUMS.txt: 7/7 files OK=7 MISMATCH=0
python validate_dataset.py
  → PASS: 104 đơn vị (93 xã, 11 phường); mã unique; tỉnh 33; JSON và CSV khớp.
```
(`PYTHONIOENCODING=utf-8` is required on Windows; the validator is otherwise unchanged.)

### 8.2 Database

```
8 migrations applied and finished, in BOTH agrimarket_v2 and agrimarket_v2_test:
  20260101000000_init_v2
  20260215000000_checkout_idempotency
  20261008000000_code_sequences
  20261009000000_inventory_quarantine_movement
  20261010000000_order_item_flash_sale_item
  20261011000000_product_image_metadata
  20261012000000_hung_yen_wards_and_auth
  20261012000001_password_changed_at
```
Catalogue, read back from **both** databases:

```
provinces: 1 → 33 Tỉnh Hưng Yên
wards: total=104 xa=93 phuong=11
wards outside province 33: 0
sample: 11953 (string) Phường Phố Hiến [phuong] prov=33
highest code: 13279 Xã Vũ Tiên
```

### 8.3 API tests

| Suite | Command | Result |
|-------|---------|--------|
| Unit | `npx vitest run` | **27 files / 333 tests passed** |
| E2E | `npx vitest run --config ./vitest.config.e2e.ts` | **9 files / 281 tests passed** |

New suites, per-file counts: `auth-account.spec.ts` 28, `locations.spec.ts` 22, `mail.spec.ts` 9,
`password-version.spec.ts` 4, `address-auth.e2e-spec.ts` **37**.
E2E per file: address-auth 37, app 68, concurrency 27, mutation-acceptance 104, product-images 14,
product-variant 6, promotion-status 7, reports-export 7, reports-revenue 11.

### 8.4 Live HTTP smoke test (real server, real network, TEST DB)

The API was built (`npx nest build`) and run as a real process (`node dist/src/main.js`, port 3111) against
`agrimarket_v2_test`, then driven over HTTP — so serialisation, routing and the global pipe stack are
exercised exactly as a browser and Expo Go hit them.

```
node scripts/address-auth-smoke.mjs http://127.0.0.1:3111/api/v1 --confirm-test-db=agrimarket_v2_test
```

```
target: TEST database "agrimarket_v2_test" (confirmed and cross-checked)
health: ok, database up
PASS catalogue: GET /locations/provinces — code=33 name=Tỉnh Hưng Yên
PASS catalogue: full 104-unit list in one call — 93 xã + 11 phường, string codes, no internal fields
PASS catalogue: accent-insensitive search — "duong Hao" → Phường Đường Hào
PASS catalogue: unknown ward code is a 404
PASS auth: POST /auth/register creates an ACTIVE CUSTOMER with no session
PASS auth: forged `role` on register is refused (400), not ignored
PASS auth: duplicate e-mail is a 409
PASS auth: POST /auth/login issues a CUSTOMER session
PASS address: official commune name resolved server-side — Phường Đường Hào
PASS address: an unknown commune code is refused (400)
PASS address: a commune code without its province code is refused (400)
PASS address: a legacy (pre-reorganisation) address is still saveable
PASS address: editing to a catalogue commune converts it and drops the district
PASS auth: change-password signs out other devices and keeps this one
PASS auth: forgot-password answers identically for known and unknown addresses — delivery=test delivered=false
PASS auth: an unknown reset token is refused with the generic message
PASS checkout: the order snapshot carries the verified commune — Phường Đường Hào, server-computed fee=20000 (matches preview)
PASS checkout: a bad commune code is refused without creating an order
18 passed, 0 failed
```

Note on the checkout fee assertion: `Order.shippingFee` is `Decimal(18,2)` per `docs/DATABASE.md`, and Prisma
serialises a `Decimal` as an exact string, so the wire type is a **string**. The assertion was corrected to
check the value and to require that the charged fee equals the fee the preview showed — the string contract is
pre-existing and is what the shipped e2e suite already asserts (`Number(res.body.shippingFee)`), so the API was
not changed to satisfy the script.

### 8.5 Frontends

| App | Typecheck | Lint | Build |
|-----|-----------|------|-------|
| Customer Web | `tsc --noEmit` → 0 | `eslint .` → 0 errors, 0 warnings | `next build` clean; `/dang-ky`, `/dat-lai-mat-khau`, `/quen-mat-khau`, `/tai-khoan`, `/tai-khoan/dia-chi`, `/tai-khoan/doi-mat-khau`, `/thanh-toan` all emitted |
| Mobile | `tsc --noEmit` → 0 | `eslint .` → 0 | 11 files / 82 tests passed |
| Admin Web | `tsc --noEmit` → 0 | `eslint .` → 0 | `next build` clean |

### 8.6 API lint

`npx oxlint --type-aware src/ test/ prisma/` → 0 errors. The only warnings are pre-existing
(`test/concurrency.e2e-spec.ts`, `require-array-sort-compare`), untouched by this work.

## 9. Test-DB hygiene (and a hazard avoided)

The smoke script registers a real customer through the public API, so it cannot delete its own account
(correctly — there is no customer self-delete route). Cleanup therefore happens in two layers:

1. **In-run, through the API:** the created order is cancelled via `POST /orders/me/:id/cancel`, addresses are
   deleted and the cart is cleared. Cancelling through the API is what releases the stock reservation
   correctly (`reserved` decremented by the real service, not by a raw delete).
2. **After the run:** `scripts/purge-smoke-residue.mjs` removes the `smoke…` account and its order graph.
   It is **dry-run by default**, requires an explicit `--confirm-test-db=<name>` that is cross-checked against
   `TEST_DATABASE_URL` in `apps/api/.env`, and only ever deletes rows reachable from a `smoke…` account.

Two hazards were found and avoided here:

- **Reusing the e2e purge helper would have been destructive.** `purgeRun` follows
  `partnerOrders[].partnerId` into the partner/product graph. That is correct for the e2e suites, which build
  their own throwaway catalogue — but a smoke order is placed against the **demo** catalogue, so the same
  cascade would have deleted demo partners, products and lots. The shared helper was therefore left
  **byte-identical** (the attempted extension was reverted and verified absent), and the smoke cleanup is a
  separate, narrowly scoped tool.
- **Deleting allocation rows without releasing the reservation leaks stock.** An order that still holds a
  reservation keeps `inventory_balances.reserved` raised; dropping its `inventory_allocations` rows would leak
  that reservation permanently and make the demo catalogue under-report sellable stock. The purge tool
  therefore releases first, using the same single statement `InventoryService.releaseStock` uses
  (`reserved = GREATEST(reserved - ?, 0)`, evaluated on the current column value), and only for orders that
  were not already cancelled.

Verified exactly, before and after: balance `#4158` (variant 4306) went `reserved 1 → 0`, i.e.
`available 259 → 260`, while the five pre-existing CANCELLED allocations on that balance were left untouched —
confirming the release was exact and not a blanket reset. Demo catalogue counts after the purge:
3 partners, 14 products, 17 variants, 19 lots, 1 warehouse, 5 categories, 4 farms — all intact, 0 smoke
accounts remaining, 0 orders owned by a smoke account.

## 10. Data preservation

- No `git reset --hard`, no `git clean`, no branch switch, no stash.
- DEV database `agrimarket_v2` was **not** dropped, reset, reseeded or overwritten. The two new migrations are
  additive (`CREATE TABLE`, nullable `ALTER TABLE ADD COLUMN`); no existing column was dropped, renamed or
  backfilled.
- Legacy address text (`province`, `district`, `ward`) is preserved as-is and is never rewritten by guesswork.
  A legacy address remains editable, and converting one to a catalogue commune drops the district **only**
  because the district level no longer exists in the new model — asserted over HTTP.
- `users.passwordChangedAt` is nullable, so applying the migration logged nobody out.
- No integration test writes to DEV: the e2e suites and the smoke script both target `agrimarket_v2_test`, and
  the smoke script refuses to run without an explicit, cross-checked TEST database confirmation.

## 11. Test counts (final source, this session)

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| API unit | 27 | 333 | all passed |
| API e2e | 9 | 281 | all passed |
| Mobile | 11 | 82 | all passed |
| Live HTTP smoke | 1 script | 18 | all passed |

## 12. Bugs found (summary table)

| # | Bug | Root cause | Fix | Proof |
|---|-----|-----------|-----|-------|
| 1 | 4 of 104 wards unselectable | Ward query reused `MAX_PAGE_LIMIT = 100` | `MAX_WARD_LIMIT = 500`, default 200 | `locations.spec.ts` fails when the clamp is re-introduced |
| 2 | Session survived a same-second password change | `iat` has 1-second precision | Exact `pwd` version claim | `password-version.spec.ts` + e2e change-password |
| 3 | Smoke script asserted a numeric fee on a `Decimal` field | Wrong assumption in the script (not an API defect) | Assert the value; require charged == preview | Smoke run 18/18 |
| 4 | Smoke cleanup called `POST /orders/:id/cancel` | Route is `POST /orders/me/:id/cancel` | Corrected; cancellation now actually releases stock | Balance `reserved 1 → 0` verified |
| 5 | Smoke script's TEST-DB guard was only a comment | No real check existed | Explicit confirmation flag cross-checked against `TEST_DATABASE_URL`, plus a health probe | Guards verified to refuse: no flag, DEV name, unreachable API |
| 6 | `repoRoot()` returned `scripts/` | Wrong `dirname` depth | Two-level `dirname` | The guard itself caught it (`apps/api/.env not found`) |

## 13. Known limitations (stated, not hidden)

1. **Thôn/tổ dân phố is free text.** No verified list was delivered, so inventing one was refused.
2. **Only Hưng Yên is served.** The province list contains exactly one entry, because the storefront ships
   inside Hưng Yên only; a decorative nationwide selector would imply coverage the business does not have.
3. **Rate-limit counters are in-memory.** Correct for single-instance protection of individual auth attempts;
   a multi-instance deployment would need shared storage (documented in `auth.module.ts`).
4. **Mail capture is in-process.** Over HTTP the raw reset token is unreachable by design; the full
   real-token reset flow is therefore proven by the e2e suite (which can read the capture buffer), not by the
   HTTP smoke script, which can only assert the generic-token error.
5. **A cancelled-after-shipping order quarantines its stock** (existing policy, unchanged): such units are
   blocked pending return/inspection rather than resold.

## 14. BLOCKED — real email delivery

**Status: BLOCKED.** No SMTP server is configured, so no real email was sent and none is claimed.

- `apps/api/.env` contains **no** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
  `MAIL_TRANSPORT` or `MAIL_FROM`.
- The service therefore selects the `test` transport (`jsonTransport`: messages are captured in memory and
  nothing leaves the process), and the forgot-password response reports
  `delivery: { mode: "test", delivered: false }` — verified over HTTP in the smoke run.
- The API deliberately surfaces this so a test transport can never be presented to a customer as a delivered
  email.

**What is proven:** token generation, hashing at rest, TTL, single-use, supersession, the generic error, the
neutral known/unknown response, and the complete reset flow using a real captured token (e2e).

**What is NOT proven:** that an email actually arrives in a real inbox.

**To unblock:** set `MAIL_TRANSPORT=smtp` plus `SMTP_HOST`/`SMTP_PORT` (and credentials if required) in
`apps/api/.env`, then request a recovery link and confirm `delivery.delivered === true` and that the message
reaches the inbox.

## 15. PENDING — real Android device test

**Status: ANDROID DEVICE TEST PENDING.** No physical Android device was used in this session.

- Mobile was verified by `tsc --noEmit` (0), `eslint .` (0) and **11 files / 82 tests passed**, and the API it
  calls was verified live over HTTP with CORS origins for Expo Web already configured.
- The reset screen accepts either a deep-link token or a pasted link/code, so a link opened outside the app
  still works.
- **Not verified:** rendering, picker interaction, keyboard behaviour and deep-link handoff on real Android
  hardware through Expo Go.

**To complete:** run `npx expo start` and open the project in Expo Go on a device, then walk the register →
login → address (catalogue picker) → checkout → change-password → forgot/reset flows.

## 16. Reproducing this verification

```bash
# 1. Dataset (Windows needs the encoding override)
cd AGRIMARKET_HUNG_YEN_104_XA_PHUONG_2026/AGRIMARKET_HUNG_YEN_2026
PYTHONIOENCODING=utf-8 python validate_dataset.py

# 2. API tests
cd apps/api
npx vitest run                                  # 27 files / 333 tests
npx vitest run --config ./vitest.config.e2e.ts  # 9 files / 281 tests
npx tsc --noEmit -p tsconfig.json
npx oxlint --type-aware src/ test/ prisma/

# 3. Live HTTP acceptance (API running against the TEST database)
npx nest build
node dist/src/main.js                           # with DATABASE_URL = TEST database
node scripts/address-auth-smoke.mjs http://127.0.0.1:3111/api/v1 --confirm-test-db=agrimarket_v2_test

# 4. Clean up the smoke account afterwards (dry run first)
cd apps/api
npx tsx ../../scripts/purge-smoke-residue.mjs --confirm-test-db=agrimarket_v2_test
npx tsx ../../scripts/purge-smoke-residue.mjs --confirm-test-db=agrimarket_v2_test --apply

# 5. Frontends
cd apps/customer-web && npx tsc --noEmit && npx eslint . && npx next build
cd apps/mobile       && npx tsc --noEmit && npx eslint . && npx vitest run
cd apps/admin-web    && npx tsc --noEmit && npx eslint . && npx next build
```

`npx tsx src/main.ts` cannot boot the Nest app (no `emitDecoratorMetadata` under tsx), so always
`npx nest build` then `node dist/src/main.js`.

## 17. Repository state

- Branch: `main`, HEAD `4b14267` ("Khoi tao Admin Web V2") — **unchanged**.
- **No commit and no push were made.** No tag, no deploy, no APK/AAB, no EAS.
- Working tree: 209 dirty entries (134 modified/deleted tracked, 75 untracked). `apps/customer-web` and
  `apps/mobile` are new untracked directories. The dirty tree is pre-existing V2 work plus this feature work;
  nothing was reverted to tidy it.

## 18. Requirement-to-evidence matrix

| Requirement | Evidence | Result |
|-------------|----------|--------|
| Official 104-unit catalogue, no pre-merger data | Dataset validator PASS; 104 = 93 + 11 in both DBs | PASS |
| Codes stored as 5-char strings | `VarChar(5)`; `typeof code === 'string'` over HTTP | PASS |
| Backend is the single source of truth | Frontends fetch `/locations/.../wards`; no list copied into any frontend | PASS |
| Whole catalogue in one call | 104 returned in one call (`MAX_WARD_LIMIT = 500`) | PASS |
| Accent/case-insensitive search | `"duong Hao"` → `Phường Đường Hào` over HTTP | PASS |
| Server resolves the display name | Forged province text discarded; official name stored | PASS |
| Ward must exist and belong to the province | 400 `Xã/phường không hợp lệ hoặc không thuộc tỉnh đã chọn` | PASS |
| Ward code without province code refused | 400 over HTTP | PASS |
| Legacy addresses still work and convert | Saved, converted, district dropped — over HTTP | PASS |
| Public register, CUSTOMER only | 201, no session, `role: CUSTOMER`; forged `role` → 400 | PASS |
| Duplicate email refused | 409 over HTTP | PASS |
| Login issues a session | 200 + `accessToken` + `role: CUSTOMER` | PASS |
| Change password ends other sessions | Old token 401, fresh token 200, old password 401 | PASS |
| Forgot password is enumeration-safe | Identical body incl. `delivery` for known/unknown | PASS |
| Reset token hashed, TTL, single-use | SHA-256 at rest; expired/used/unknown all 400 with one message | PASS |
| Checkout snapshots the verified commune | Snapshot carries code + official name, no client text | PASS |
| Shipping fee computed server-side | Charged fee == preview fee; DTO has no fee field; forged fee → 400 | PASS |
| Bad commune refused without creating an order | 400, order count unchanged, refusal reason asserted | PASS |
| Checkout validates before claiming resources | Address resolved before the transaction opens | PASS |
| DEV data preserved | Additive migrations; no reset/reseed; legacy text kept | PASS |
| Real email delivery | No SMTP configured → `delivered: false` | **BLOCKED** |
| Real Android device (Expo Go) | No device used | **PENDING** |

## 19. Test integrity statement

- No test was weakened, skipped or deleted to make a suite pass.
- The two failing suites that exposed Bugs 1 and 2 were left failing until the **source** was fixed.
- `locations.spec.ts` was proven non-vacuous by re-introducing the clamp and observing the expected failures.
- Rate limiting is genuinely enforced in the request path. Counters are cleared between tests that are not
  about throttling (a functional suite legitimately exceeds 5 registrations per minute), and the limiter is
  asserted in its own dedicated test: 6 forgot-password calls must include a 429, at most 3 may succeed, and
  the throttled body must not leak the limit or the route.
- The smoke script's guard was corrected to a real check after it was noticed that the previous "safety"
  claim existed only as a comment.

## 20. Remaining issues

1. Real email delivery — **BLOCKED** (section 14). Configuration only; no code change required.
2. Real Android device test — **PENDING** (section 15).
3. Rate-limit storage is in-memory (section 13.3) — adequate for the current single-instance deployment.
4. Thôn/tổ dân phố stays free text until a verified list is delivered (section 13.1).

## 21. Verdict

Feature A (delivery address on the official 104-unit Hưng Yên catalogue) and Feature B (customer account
self-service) are **implemented, integrated across API + Customer Web + Mobile, and verified** by 333 API unit
tests, 281 API e2e tests, 82 Mobile tests and 18 live HTTP checks against a real API process on the TEST
database, with clean typecheck/lint/build on all three frontends.

Two real defects were found by that verification and fixed at the source — one of which
(the 100-row clamp) silently made 4 of the 104 communes unselectable.

Two items are **not** claimed as passing: real email delivery is **BLOCKED** pending SMTP configuration, and
the real Android device test is **ANDROID DEVICE TEST PENDING**.

## 22. Sign-off checklist

| Item | State |
|------|-------|
| Feature A implemented on source | Yes |
| Feature B implemented on source | Yes |
| API tests green | 27 files / 333 tests |
| API e2e tests green | 9 files / 281 tests |
| Mobile tests green | 11 files / 82 tests |
| Live HTTP acceptance | 18/18 |
| Typecheck / lint / build (3 frontends + API) | Clean |
| Reference docs updated (`API.md`, `DATABASE.md`, `BUSINESS-RULES.md`) | Yes — documentation only |
| DEV database preserved | Yes — additive migrations only |
| Legacy address text preserved | Yes — never backfilled |
| Test DB left clean | Yes — smoke residue purged; balance restored exactly |
| Commit / push performed | **No** |
| Real email delivery | **BLOCKED** — no SMTP configured |
| Real Android device (Expo Go) | **ANDROID DEVICE TEST PENDING** |
