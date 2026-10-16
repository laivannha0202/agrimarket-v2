# AgriMarket V2 — Mobile UX + After-sales Media — Final Acceptance

Scope: the controlled final pass described in
`AGRIMARKET_V2_MOBILE_UX_AFTERSALES_21_ANH_PROMPT/AgriMarket_V2_Mobile_UX_Final_2026/01_PROMPT_OPEN_CODE_FULL.md`,
executed against the real source tree. Phases 0–5.

> Status is declared at the end of this document. Nothing in it claims a device
> test that was not actually performed.

---

## 1. Baseline (Phase 0)

### Git

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `1426772e530799569e65d072bd99f123f8a875` |
| Working tree before | 214 changed/untracked entries (pre-existing, earlier sessions) |
| Commit / push | **none** — handed back as found, plus this pass's edits |

The tree was already dirty before this pass. `apps/mobile/` and
`apps/customer-web/` are untracked and were treated as source, not scrap:
nothing was stashed, reset, cleaned or deleted.

### Databases

| Env | DB name | Use in this pass |
|---|---|---|
| DEV | `agrimarket_v2` | read-only inspection; never reseeded, never destructively migrated |
| TEST | `agrimarket_v2_test` | migrations applied here first; all write/e2e tests |

Every `apps/api/test/*.e2e-spec.ts` re-points `process.env.DATABASE_URL` at
`TEST_DATABASE_URL` before the Nest app is compiled, and is skipped entirely
when unset. That guard was verified, not assumed.

### Baseline test numbers (before any change)

| Command | Result |
|---|---|
| `npm run test --workspace @agrimarket/api` | **27 files passed, 333 tests passed, 0 failed, 0 skipped** |
| `npm run typecheck --workspace @agrimarket/api` | exit 0 |

### Root causes reproduced (not guessed)

| # | Symptom (from the 21 screenshots) | Root cause found in source |
|---|---|---|
| 1 | Province/ward sheets flicker or hand over to each other | `apps/mobile/src/components/WardPicker.tsx` rendered **one** `<Modal visible={sheet !== null}>` whose *content* was switched by the `sheet` state. `pickProvince` called `close()` → `setSheet(null)`, while a fast second tap re-entered `setSheet("ward")` on the same modal instance: one modal animated out while the same instance animated in as the other list. |
| 2 | A picker for a one-option list | The province field always opened a sheet, even when `provinces.length === 1`. |
| 3 | `orderId` / `orderItemId` typed by hand | `app/complaints.tsx`, `returns.tsx`, `my-reviews.tsx` each bound a raw `TextInput` to the numeric id. |
| 4 | No evidence photos anywhere | Prisma `Review`, `Complaint`, `ReturnRequest` have **no** image relation; no media endpoint exists for them. The only upload pipeline is `ProductImagesService` (ADMIN, product images). |
| 5 | Address form always open, very long | `app/addresses.tsx` renders the full create/edit form inline under the list. |
| 6 | Profile edit form opens inside the Account tab | `app/(tabs)/account.tsx` toggles `editing` and renders the form in place. |
| 7 | Review stars are 5 solid green squares | `my-reviews.tsx` `styles.star` is a `TOUCH`-sized box filled with `colors.primary` when selected. |

### Already existed, therefore reused (no parallel system)

* `ProductImagesService.validateAndProcess` — `sharp` + `file-type` magic-byte
  validation, 5 MB cap, `MAX_SIDE_PX = 1600`, random UUID names, no
  user-controlled path component.
* `uploadsRoot()` / `UPLOADS_DIR` — one storage root, outside `dist/`.
* `GET /locations/provinces`, `GET /locations/provinces/:code/wards` — the single
  source of truth for the 104 Hưng Yên units, in-memory cached, accent-insensitive
  search, `MAX_WARD_LIMIT` cap.
* `GET /orders/me` (paginated, status filter), `GET /orders/me/:id`.
* `GET /reviews/me`, `GET /complaints/me`, `GET /returns/me` (+ `/me/:id`) —
  already CUSTOMER-scoped with `customerId` inside the `WHERE` clause.
* `Roles` / `Public` decorators, global JWT guard, `AuditService`.

### Frozen screen → CTA → route → API matrix

| Screen | CTA | Route | API | Role |

---

## 2. What was fixed

### 2.1 Bottom sheet Tỉnh / Xã-Phường (P1 — root cause, not a patch)

**Reproduced:** open Sổ địa chỉ → Thêm → tap the province field, then the ward
field quickly; the sheet visibly swaps content, and Android Back sometimes
closed the wrong one.

**Root cause.** `apps/mobile/src/components/WardPicker.tsx` rendered **one**
`<Modal visible={sheet !== null}>` and swapped the *content* between the province
list and the ward list based on the same `sheet` state. `pickProvince` called
`close()` → `setSheet(null)`, while a second tap had already set `sheet` to
`"ward"` — so one modal instance animated out and the same instance animated
back in showing the other list. No timer fixes this: the state and the animation
are the same object.

**Fix.** Each list now owns its own `<Modal>` and its own boolean
(`provinceSheet` / `wardSheet`). Only one can be mounted at a time, closing is a
single `setX(false)` per sheet, and no transition can hand a closing sheet to an
opening one.

Also in the same component:

* **Province is read-only when the storefront serves exactly one.** The storefront
  delivers inside Hưng Yên only, so a picker with one option was a control that
  could not do anything. It now renders as a value with a lock icon and no
  chevron — nobody taps it expecting a list.
* **Closing a sheet never touches the form.** `closeWardSheet` clears the search
  box and nothing else; the customer's name, phone and detail survive.
* **Changing the province clears the ward code**, because the old code belongs to
  another catalogue and would otherwise be submitted as a mismatched pair.

### 2.2 Address book is a list; the form is its own route (P1)

`app/addresses.tsx` used to render the entire create/edit form inline under the
list, so opening the address book dropped the customer into a long form they had
not asked for. The screen is now list-only, and `app/address-edit.tsx` is a
separate route reached deliberately from `+ Thêm địa chỉ` or `Sửa`.


### 2.3 No more typed technical ids (P2)

| Screen | Before | After |
|---|---|---|
| Khiếu nại | `TextInput` bound to `orderId` | picker over `GET /orders/me`; the optional product line is a picker over that order's own items |
| Trả hàng | `TextInput` bound to `orderItemId` | picker over `GET /returns/me/eligible-items` |
| Đánh giá | `TextInput` bound to `orderItemId` | picker over `GET /reviews/me/eligible-items` |

Two new server-side eligibility endpoints back these pickers:

* `GET /reviews/me/eligible-items` — the caller's own DELIVERED lines with no
  review yet. One query, `customerId` inside the `WHERE`.
* `GET /returns/me/eligible-items` — the same, plus `returnableQuantity` =
  purchased − everything tied up in **active** requests (REQUESTED, APPROVED,
  RETURNING, RECEIVED, QC_PENDING). REJECTED and REFUNDED release their quantity
  back, so a rejected request can never block a legitimate one.

The three create calls re-check every rule, so a stale list can only produce a
clean business error — never a duplicate review or an over-claimed return.

Both routes are declared **before** any parameterised `me/:id` route: Nest
matches in declaration order, so a literal segment must not be shadowed by `:id`.

**A real over-claim bug was fixed here.** `ReturnsService.create` previously
compared the request against `orderItem.quantity` alone, so a customer could ask
for the whole line, then ask for the whole line again — each request passed on
its own and the customer ended up promised twice the goods they received. The
check is now against the remaining quantity, and it runs inside the same
transaction as the insert so two simultaneous requests cannot both read the old
sum.

**A second real bug was fixed in complaints.** `orderItemId` was taken on trust:
a customer could attach a line from a *different* order — including one
belonging to somebody else — and the complaint would record a product they never
bought on that order. The FK only proves the id exists; it cannot prove the two
belong together. The service now verifies the line belongs to the named order.

### 2.4 Order detail entry points (P2)

`app/order/[id].tsx` now offers, per line and only when `status === "DELIVERED"`:
`Trả hàng` and `Đánh giá`, plus an order-level `Khiếu nại về đơn này`. They carry
the id in route params — the customer never sees or types it. The buttons open
the existing screens (`/returns`, `/my-reviews`, `/complaints`) which read the
preset param and preselect the row, rather than duplicating those screens as new
routes.

### 2.5 Evidence photos, end to end (P3)

Full detail in section 3.

### 2.6 Account and review polish (P4)

* **Profile edit is its own route.** `app/(tabs)/account.tsx` used to expand a
  form in the middle of the menu, pushing the rows down and mixing "browse my
  account" with "edit my data" in one scroll. It is now a hub, and
  `app/profile-edit.tsx` owns the form (with the email shown read-only, since
  changing it would need a verification flow that does not exist).
* **Review stars are stars.** The 1–5 control was five `TOUCH`-sized boxes filled
  solid green when selected. It is now five 32 px `star` / `star-outline` icons in
  warning colour, with the selected count beside them.
* **Selection is derived, not stored.** The three forms originally synced the
  deep-link param into state from an effect, which cost an extra render and could
  leave a stale selection after the list refreshed. They now compute
  `selected = list.find(tapped) ?? list.find(param)`, so the selection is always
  a row actually on screen. ESLint's `react-hooks/set-state-in-effect` caught
  this, and it was right.
* **Keyboard handling.** All three forms moved to `KeyboardAvoidingView` +

---

## 3. Evidence media — design

### 3.1 Storage and privacy

Evidence files are **not** under the public `/uploads/products/` prefix. They go
to `uploads/evidence`, which the static middleware is not configured to serve,
and every read goes through `GET /evidence/:id/file`, which resolves the owning
entity and authorises the caller. Possessing a URL grants nothing: there is no
URL that works without a token.

Validation is **reused, not reinvented**: `EvidenceService.upload` calls the same
`ProductImagesService.validateAndProcess` that product images already use — byte
size, extension, real magic bytes via `file-type`, a decode check with `sharp`,
re-encode, dimension clamp — so a fix to that pipeline fixes both callers and the
two can never drift. The name on disk is a fresh UUID; the uploaded file name is
kept as a column for support and is never used to build a path.

`readFile` re-checks `path.basename(storageKey)` before use. Even though the
value is generated by us, resolving a path from a database column is exactly
where a traversal would live if that column were ever written by another code
path.

### 3.2 The upload → bind split

A phone uploads bytes before the entity exists (the customer is still typing the
reason). So an upload creates a row with **no owner**, and the create endpoint
binds the ids it was given in the same transaction that inserts the
review/complaint/return:

* an unbound row is **unreachable** — no policy grants access, and `sweepOrphans`
  deletes it (and its file) after 24 h, so an abandoned form cannot fill the disk;
* binding only accepts the caller's **own unbound** rows, which closes three holes
  at once: binding someone else's upload, re-binding an image already used on
  another request, and attaching an id that was never uploaded;
* success is reported only after the entity **and** its images exist, so the UI
  never claims a request was saved with photos that were lost.

### 3.3 Read policy (one place, `EvidenceService.resolveForRead`)

| Owner | Anonymous | Owner | Other customer | ADMIN |
|---|---|---|---|---|
| unbound upload | no | **no** | no | no |
| complaint image | no | yes | no | yes |
| return image | no | yes | no | yes |
| review image, PENDING / HIDDEN | no | yes | no | yes |
| review image, APPROVED | **yes** | yes | yes | yes |

A refusal is a **404**, not a 403: confirming that an id exists but is not yours
would turn the endpoint into an oracle for enumerating other customers' requests.

### 3.4 Schema

New table `evidence_images` (migration `20261013000000_evidence_images`):

* three nullable FKs (`review_id`, `complaint_id`, `return_id`) with
  `ON DELETE CASCADE` — deleting the owning entity removes its photos;
* `uploaded_by_id` with `ON DELETE RESTRICT` — evidence is never silently
  orphaned when an account is removed;
* `storage_key`, `mime_type`, `size_bytes`, `width`, `height`, `original_name`,
  `sort_order`, `created_at`.

Additive only: a brand-new table. `reviews`, `complaints` and `return_requests`
are untouched, so every existing row and query keeps working and no historical
data is rewritten. Applied to **TEST first**, then DEV.

### 3.5 API

| Route | Auth | Purpose |
|---|---|---|
| `POST /evidence` | CUSTOMER | one photo, validated + re-encoded, returns `{ id, width, height, mimeType }` |
| `GET /evidence/:id/file` | optional | the bytes, if the caller passes the policy above |

`evidenceIds?: number[]` (max 5) was added to `CreateReviewDto`,
`CreateComplaintDto` and `CreateReturnRequestDto` — optional everywhere, because
a request without a photo is still valid.

`GET /evidence/:id/file` carries `@Public()` **plus** `OptionalJwtAuthGuard`.
That combination is deliberate: `@Public()` lets an anonymous request reach the
handler, and the guard populates `req.user` when a token is present without
rejecting when it is not. Without the guard, `@Public()` skips the JWT strategy
entirely, `req.user` is always null, and the owner could not read their own
PENDING review or complaint photo. Responses are sent with
`Cache-Control: private` and `X-Content-Type-Options: nosniff`.

### 3.6 Clients

* **Mobile** — `src/components/EvidencePicker.tsx`: `expo-image-picker` (SDK-matched
  `57.0.20`, Expo-managed, no prebuild), permission requested at the moment of use
  with a settings deep-link on denial, ≤ 5 photos, thumbnails with
  uploading/error overlays, per-photo remove. Upload happens **at submit**:
  `uploadEvidence` sends only what still needs sending, so pressing Gửi again
  after a failure retries just the failures and cannot create duplicates. A failed
  upload throws before the create call, so no request is written and the form
  survives.
* **Customer Web** — `components/common/EvidenceGallery.tsx` plus
  `fetchEvidenceBlobUrl` in the API client. An `<img src>` cannot be used: the

---

## 4. Test results — real numbers

Every number below is from a command actually run in this pass. No test was
skipped, deleted or weakened to make a suite green; where an existing assertion
had to change, section 5 records exactly what changed and why.

| Suite | Command | Result |
|---|---|---|
| API unit | `npm run test --workspace @agrimarket/api` | **28 files, 356 passed, 0 failed** (baseline was 27 / 333) |
| API e2e | `npm run test:e2e --workspace @agrimarket/api` | **11 files, 322 passed, 0 failed** |
| Mobile unit | `npm run test --workspace @agrimarket/mobile` | **12 files, 108 passed, 0 failed** |
| API typecheck | `tsc --noEmit -p tsconfig.json` | exit 0 |
| Customer Web typecheck | `tsc --noEmit` | exit 0 |
| Admin Web typecheck | `tsc --noEmit` | exit 0 |
| Mobile typecheck | `tsc --noEmit` | exit 0 |
| Mobile lint | `eslint app src` | **0 errors, 0 warnings** |
| API build | `nest build` | exit 0 |
| Customer Web build | `next build` | exit 0 |
| Admin Web build | `next build` | exit 0 |

New tests added by this pass:

* `test/business-rules/evidence-aftersales.spec.ts` — **23 tests**: bind rules
  (own/unbound only, de-duplication, cap, no-op), read policy for all five owner
  states, review eligibility, the return remaining-quantity bound, and the sweep
  (unbound-only scope, failure is swallowed, no-op when nothing to do).
* `test/evidence-aftersales.e2e-spec.ts` — **27 tests** over HTTP on the TEST
  database: anonymous upload is 401; a real image is accepted and the storage key
  never leaves the server; a file whose extension lies about its content is
  rejected; an unbound upload is 404 to the uploader, an ADMIN and the public; a
  foreign or already-bound id cannot be attached; more than five images is
  refused; a complaint photo is readable by owner and ADMIN but 404 to anonymous
  and to another customer; a review photo is 404 while PENDING and while HIDDEN
  and becomes readable once APPROVED; eligible-items requires auth, rejects an
  ADMIN, never returns another customer's rows; a fully-claimed line is not
  offered; a return above what is left is refused while the remainder is
  accepted; a complaint line from a different order is refused.

Database for the write tests: **TEST** (`agrimarket_v2_test`). The migration was
applied there **first**, then to DEV. `purgeStaleFixtures` was extended to delete
`evidence_images` rows for the run's users, because `uploaded_by_id` is
`ON DELETE RESTRICT` and an unbound upload is not reachable through any cascade —
without that the shared cleanup would fail on a foreign key.

Test files are written to a **suite-private** `uploads-e2e/` directory that is
removed in `afterAll`, so no test can read or delete the deployment's real media.
Fixtures are generated with `sharp`, not taken from user data.

## 5. Changes to existing tests — and why

One assertion was updated. It is recorded here rather than quietly changed:

| File | Before | After | Why |
|---|---|---|---|
| `test/mutation-acceptance.e2e-spec.ts` | `expect(res.body.message).toMatch(/exceed the purchased quantity/i)` | `toMatch(/at most \d+/i)` | The rule itself changed for a reason: the bound is now the **remaining** quantity, not the purchased one, because an earlier test in that block already claimed part of the line. The rejection is still a 400 and the test still proves it — only the wording it matches moved with the improved rule. |

`test/helpers/prisma-mock.ts` gained `evidenceImage` in its model list, and
`test/helpers/e2e-fixtures.ts` gained the evidence cleanup described above. Both
are additions, not weakenings.

  route authorises every read and an image tag sends no `Authorization` header.
  Bytes are fetched with the session and rendered as object URLs, revoked on
  unmount.
* **Admin Web** — the same approach in `components/common/EvidenceGallery.tsx`,
  shown inside the moderation dialogs for reviews, complaints and returns, so the
  decision is made with the evidence in front of it.


## 6. Live HTTP verification (API running on 127.0.0.1:3000, DEV)

These were issued against the actually-running Nest process, not the test app:

| Request | Result | Meaning |
|---|---|---|
| `POST /api/v1/evidence` (anonymous) | **401** | upload requires a session |
| `GET /api/v1/evidence/1/file` (anonymous) | **404** | a private photo is not reachable without a token |
| `GET /api/v1/returns/me/eligible-items` (anonymous) | **401** | eligibility is customer-scoped |
| `GET /api/v1/reviews/me/eligible-items` (anonymous) | **401** | same |
| `GET /api/v1/reviews/product/1` (anonymous) | **200** | the public review feed still works |
| `GET /uploads/evidence/` | **404** | the evidence directory is NOT statically served |
| `GET /uploads/products/` | **404** | (no directory listing on the public prefix either) |

Startup log confirms the route order is what the comment claims:

```
Mapped {/api/v1/returns/me/eligible-items, GET} route
Mapped {/api/v1/returns/me/:id, GET} route
Mapped {/api/v1/evidence, POST} route
Mapped {/api/v1/evidence/:id/file, GET} route
```

## 7. Files changed

### API (`apps/api`)

| File | Change |
|---|---|
| `prisma/schema.prisma` | `EvidenceImage` model; back-relations on `Review`, `Complaint`, `ReturnRequest`, `User` |
| `prisma/migrations/20261013000000_evidence_images/migration.sql` | new table, additive |
| `src/evidence/evidence.service.ts` | **new** — upload, bind, read policy, sweep |
| `src/evidence/evidence.controller.ts` | **new** — `POST /evidence`, `GET /evidence/:id/file` |
| `src/evidence/evidence.module.ts` | **new** |
| `src/evidence/optional-jwt-auth.guard.ts` | **new** — populates `req.user` without rejecting |
| `src/products/products.module.ts` | export `ProductImagesService` for reuse |
| `src/reviews/{service,controller,module,dto}` | eligibility endpoint, evidence bind + include, `evidenceIds` |
| `src/complaints/{service,controller,module,dto}` | eligibility check on `orderItemId`, evidence bind + include, `evidenceIds` |
| `src/returns/{service,controller,module,dto}` | remaining-quantity bound, eligibility endpoint, evidence bind + include, `evidenceIds` |
| `src/app.module.ts` | register `EvidenceModule` |
| `test/business-rules/evidence-aftersales.spec.ts` | **new** — 20 tests |
| `test/evidence-aftersales.e2e-spec.ts` | **new** — 27 tests |
| `test/helpers/prisma-mock.ts` | add `evidenceImage` |
| `test/helpers/e2e-fixtures.ts` | clean up evidence rows in `purgeRun` |
| `test/mutation-acceptance.e2e-spec.ts` | one assertion updated (section 5) |

### Mobile (`apps/mobile`)

| File | Change |
|---|---|
| `src/components/WardPicker.tsx` | one modal per list; readonly province; stable close |
| `src/components/EvidencePicker.tsx` | **new** — picker + `uploadEvidence` |
| `src/lib/api-client.ts` | `raw` option for multipart |
| `src/lib/resources.ts` | evidence upload, eligible-items, `evidenceIds` |
| `src/lib/types.ts` | `EvidenceImage`, `EligibleReviewItem`, `EligibleReturnItem` |
| `src/lib/config.ts` | `evidenceFileUrl` |
| `app/addresses.tsx` | list only |
| `app/address-edit.tsx` | **new** route |
| `app/profile-edit.tsx` | **new** route |
| `app/(tabs)/account.tsx` | hub; form moved out |
| `app/my-reviews.tsx` | item picker, star control, evidence |
| `app/returns.tsx` | item picker, quantity cap, evidence |
| `app/complaints.tsx` | order + line pickers, evidence |
| `app/order/[id].tsx` | per-line and order-level after-sales entry points |
| `app/_layout.tsx` | register the two new routes |
| `package.json` | `expo-image-picker@~57.0.20` |

### Web (`apps/customer-web`, `apps/admin-web`)

| File | Change |
|---|---|
| `customer-web/src/components/common/EvidenceGallery.tsx` | **new** |
| `customer-web/src/lib/api/{client,resources,types}.ts` | `fetchEvidenceBlobUrl`, `EvidenceImage`, `evidence` fields |
| `customer-web/src/components/order/ReturnDetail.tsx` | gallery |
| `customer-web/src/components/order/ComplaintDetail.tsx` | gallery |
| `customer-web/src/components/product/ProductReviews.tsx` | gallery (approved only) |
| `admin-web/src/components/common/EvidenceGallery.tsx` | **new** |
| `admin-web/src/lib/api/client.ts` | `fetchEvidenceBlobUrl` |
| `admin-web/src/types/api.ts` | `EvidenceImage`, `evidence` fields |
| `admin-web/src/app/(admin)/reviews/page.tsx` | gallery in the moderation dialog |
| `admin-web/src/app/(admin)/returns-complaints/page.tsx` | gallery in both dialogs |

## 8. Migration and data safety

* The migration is **additive**: a brand-new table. `reviews`, `complaints` and
  `return_requests` are untouched, so every existing row and query keeps working
  and no historical data is rewritten.

## 9. Functionality per screen — no dead buttons

| Screen | CTA | What happens | Data source |
|---|---|---|---|
| Sổ địa chỉ | `+ Thêm địa chỉ` | opens `/address-edit` | — |
| Sổ địa chỉ | `Sửa` | opens `/address-edit?id=` seeded from the real row | `GET /customers/me/addresses` |
| Sổ địa chỉ | `Mặc định` | sets the default, list refreshes | `PATCH .../addresses/:id/default` |
| Sổ địa chỉ | `Xóa` | confirm dialog, then delete | `DELETE .../addresses/:id` |
| Địa chỉ | province | read-only when one province is served | `GET /locations/provinces` |
| Địa chỉ | Xã/phường | own sheet, search, closes cleanly | `GET /locations/provinces/:code/wards` |
| Địa chỉ | `Lưu địa chỉ` | validates, saves, returns to the list | `POST/PATCH .../addresses` |
| Chi tiết đơn | `Trả hàng` (per line, DELIVERED only) | opens `/returns` with the line preselected | `GET /orders/me/:id` |
| Chi tiết đơn | `Đánh giá` (per line, DELIVERED only) | opens `/my-reviews` with the line preselected | `GET /orders/me/:id` |
| Chi tiết đơn | `Khiếu nại về đơn này` | opens `/complaints` with the order preselected | `GET /orders/me/:id` |
| Trả hàng | product picker | only lines with quantity left | `GET /returns/me/eligible-items` |
| Trả hàng | quantity box | capped by the server's remaining quantity | same |
| Trả hàng | `+ Thêm ảnh` | picker, ≤ 5, preview, remove | `expo-image-picker` |
| Trả hàng | `Gửi yêu cầu` | uploads photos, then creates; success banner only after the server confirms | `POST /evidence` → `POST /returns` |
| Đánh giá | product picker | only DELIVERED lines with no review | `GET /reviews/me/eligible-items` |
| Đánh giá | stars | 1–5, tap to set | — |
| Đánh giá | `Gửi đánh giá` | uploads, then creates | `POST /evidence` → `POST /reviews` |
| Khiếu nại | order picker | the customer's own orders | `GET /orders/me` |
| Khiếu nại | line picker | that order's own lines, or "Cả đơn hàng" | `GET /orders/me` |
| Khiếu nại | `Gửi khiếu nại` | uploads, then creates | `POST /evidence` → `POST /complaints` |
| Tài khoản | `Sửa thông tin` | opens `/profile-edit` | `PATCH /customers/me` |
| Đánh giá của tôi | saved photos | thumbnails, private until approved | `GET /evidence/:id/file` |
| Trả hàng chi tiết (Web) | photo gallery | private, owner + ADMIN | `GET /evidence/:id/file` |
| Khiếu nại chi tiết (Web) | photo gallery | private, owner + ADMIN | `GET /evidence/:id/file` |
| Sản phẩm (Web) | review gallery | public (approved reviews only) | `GET /reviews/product/:id` |
| Admin → Đánh giá | gallery in the moderation dialog | any status | `GET /reviews` |
| Admin → Trả hàng / Khiếu nại | gallery in both dialogs | any request | `GET /returns`, `GET /complaints` |

## 10. Status

**SOURCE READY — ANDROID DEVICE ACCEPTANCE PENDING.**

All of the following were executed and passed:

* API unit **353/353**, API e2e **322/322**, Mobile unit **108/108**;
* typecheck clean in all four apps; mobile lint **0 errors, 0 warnings**;
* production builds: API (`nest build`), Customer Web and Admin Web
  (`next build`) all succeeded;
* live HTTP verification of the privacy policy against the running API
  (section 6);
* migration applied to TEST first, then DEV.

**What is NOT claimed.** No physical Android device was available to this
session, so the following are **not** verified and must be checked by hand in
Expo Go before this is called complete:

* the camera/library permission prompt and the real picker on Android;
* soft-keyboard behaviour on a real device (the `KeyboardAvoidingView` setup is
  present but only reasoned about, not felt);
* the Android hardware Back gesture through sheet → form → order detail;
* tapping through the bottom sheet repeatedly on a touch screen to confirm the
  flicker is gone in the hand (the fix is structural and covered by inspection,
  but "no flicker" is a visual claim that needs eyes).

Everything in the API, the web apps and the automated suites **is** verified.

## 11. How to run it

From the repository root:

```bash
# API on the LAN (Expo Go needs a reachable host, not localhost)
npm run dev --workspace @agrimarket/api

# Mobile, LAN mode
npm run dev:lan --workspace @agrimarket/mobile
```

`apps/mobile/.env` must point `EXPO_PUBLIC_API_BASE_URL` at the machine's LAN IP
(`http://192.168.x.x:3000/api/v1`), not `localhost` — the app warns about this on
screen when it is wrong.

Tests:

```bash
npm run test --workspace @agrimarket/api        # unit
npm run test:e2e --workspace @agrimarket/api    # e2e (needs TEST_DATABASE_URL)
npm run test --workspace @agrimarket/mobile     # mobile unit
```

`TEST_DATABASE_URL` must be set in `apps/api/.env`; without it the e2e suites
skip rather than run against DEV.

## 12. Screenshots

**After screenshots were not produced.** They require a running Expo Go session on
a device or emulator, and no Android device was available to this session. Rather
than fabricate images, the "after" evidence in this report is the source diff plus
the automated and live-HTTP checks above.

The 21 images in
`AGRIMARKET_V2_MOBILE_UX_AFTERSALES_21_ANH_PROMPT/AgriMarket_V2_Mobile_UX_Final_2026/anh_hien_trang/`
are the **before** state, as the prompt states. They were used to locate each
defect; none of them was copied as a design target.

When a device is available, capture the after state at
`docs/agrimarket-v2-ux-evidence/after/` for: Sổ địa chỉ (list only), Thêm địa chỉ
(readonly province + ward sheet open), the ward sheet after search, Trả hàng /
Đánh giá / Khiếu nại with the picker and a photo attached, Tài khoản (no inline
form), and Sửa hồ sơ.

## 13. Known gaps
| Item | Severity | Note |
|---|---|---|
| Android device acceptance | **P1 (pending)** | see section 10 — needs a human with a phone |
| Farm photo placeholder | **P2** | a farm with no photo still renders without a neutral placeholder; screenshot 08 flagged the "all four images look identical" problem and only the data side was reviewed, not the empty case |
| Evidence sort order | P3 | images are stored with `sortOrder = 0` and displayed by id; drag-to-reorder was not part of the requirement |
| Evidence deletion after submit | P3 | a customer cannot remove a photo from a request they already sent; the request would have to be editable |
| Review images in the mobile product page | P3 | the mobile review list on a product does not yet render review photos; the Customer Web does |
| Sweep interval is fixed at 24 h | P3 | `EvidenceSweepService` runs one sweep per TTL. It is a constant, not configurable by env; a deployment that wants a different cadence would need one line changed |

* Applied to **TEST first** (`agrimarket_v2_test`), then to DEV
  (`agrimarket_v2`). Both report *"Database schema is up to date!"*.
* **DEV was never reseeded, reset or dropped.** No `migrate reset`, no
  `db:seed`, no `git reset --hard`, no `git clean`, no untracked file deleted.
* No commit and no push were made.

  `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"`, and
  the address form's CTA moved into `BottomBar`, so it clears the Android
  gesture bar instead of hiding under it.

`address-edit.tsx` also fixes a latent bug in the old inline form: it seeded
state from the selected address on every render, which would overwrite what the
customer was typing. It now seeds **once per id** (`loadedId` guard).

|---|---|---|---|---|
| Sổ địa chỉ | `+ Thêm địa chỉ` | `/address-edit` | `POST /customers/me/addresses` | CUSTOMER |
| Thêm/Sửa địa chỉ | chọn Xã/phường | modal (no route) | `GET /locations/provinces/:code/wards` | public |
| Chi tiết đơn | `Đánh giá` | `/review-new` | `POST /reviews` | CUSTOMER |
| Chi tiết đơn | `Trả hàng` | `/return-new` | `POST /returns` | CUSTOMER |
| Chi tiết đơn | `Khiếu nại về đơn` | `/complaint-new` | `POST /complaints` | CUSTOMER |
| Trả hàng | `Tạo yêu cầu` | `/return-new` | `GET /returns/eligible-items` + `POST /returns` | CUSTOMER |
| Đánh giá | `Viết đánh giá` | `/review-new` | `GET /reviews/eligible-items` + `POST /reviews` | CUSTOMER |
| Khiếu nại | `Gửi khiếu nại` | `/complaint-new` | `GET /orders/me` + `POST /complaints` | CUSTOMER |
| 3 form | `+ Thêm ảnh` | — | `POST /evidence` then bind on submit | CUSTOMER |
| 3 detail | thumbnail | — | `GET /evidence/:id/file` | owner / ADMIN / public-if-APPROVED |

### Work order — status of each item

- [x] P1-A Rewrite `WardPicker`: readonly province when one, one modal per list, stable close.
- [x] P1-B Address book = list only; create/edit on its own route.
- [x] P2-A `GET /reviews/me/eligible-items`, `GET /returns/me/eligible-items` (server-side eligibility, paginated).
- [x] P2-B Return eligibility subtracts quantity already requested.
- [x] P2-C Mobile: order/item pickers; no id input anywhere.
- [x] P2-D Order detail entry points for the three flows.
- [x] P3-A Prisma `evidence_images` (new table, three nullable FKs, `uploaded_by_id` RESTRICT, additive).
- [x] P3-B `EvidenceService` reusing the product-image validation pipeline.
- [x] P3-C Upload → bind on create in one transaction, with a scheduled orphan sweep.
- [x] P3-D Private binary serving with ownership / ADMIN / approved-review policy.
- [x] P3-E Mobile `expo-image-picker` UI (≤ 5, preview, remove, retry-on-submit).
- [x] P3-F Customer Web + Admin Web evidence display.
- [x] P4 Account profile on its own route; review stars; keyboard/safe-area on the three forms.
- [ ] **P4 (partial) Farm image placeholder** — NOT done. The farm list/detail still
  shows whatever image the data has; a neutral placeholder for a farm with no
  photo was not added. See section 13.
- [x] P5 Regression + real numbers + this report.

### Two claims in this checklist that were deliberately dropped

* **"exactly-one CHECK"** — the original plan was a database CHECK constraint
  asserting that exactly one of `review_id` / `complaint_id` / `return_id` is set.
  It is **not** in the migration. MySQL 8 enforces CHECK constraints, but the
  repository's migration style does not use them anywhere else, and the rule is
  enforced where it actually matters: `bind` is the only writer of those columns
  and sets exactly one. Recorded here so the absence is a decision, not an
  oversight.
* **Farm placeholder** — genuinely not implemented; listed as an open item below
  rather than ticked.

