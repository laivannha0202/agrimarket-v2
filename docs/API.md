# AgriMarket V2 — API Reference

- **Base URL:** `/api/v1`
- **Auth:** JWT Bearer. Obtain a token from `POST /api/v1/auth/login` and send
  it as `Authorization: Bearer <token>`.
- **Interactive docs:** Swagger UI at `/docs` (click **Authorize**).
- **Content type:** `application/json` (requests and responses).

## Conventions

### Authentication & roles

Two roles exist: `ADMIN` and `CUSTOMER`. Every route is protected by a global
`JwtAuthGuard` unless explicitly marked **Public**. `RolesGuard` enforces the
role noted per route:

- **Public** — no token required.
- **CUSTOMER** — a customer token is required.
- **ADMIN** — an admin token is required.

### Pagination & filtering

Every list endpoint accepts the shared pagination parameters:

| Query    | Type   | Notes                                   |
| -------- | ------ | --------------------------------------- |
| `page`   | int    | ≥ 1, default `1`                        |
| `limit`  | int    | ≥ 1, ≤ **100**, default `20`            |
| `search` | string | optional free-text filter               |
| `status` | string | optional status filter (per endpoint)   |

`limit` above 100 is rejected with `400`. The one exception is
`GET /locations/provinces/:code/wards`, whose `limit` is capped at **500**
(default `200`) so the whole 104-unit commune catalogue fits in a single call —
see *Administrative catalogue* below.

**Unknown query parameters are rejected with `400`.** Only the parameters
documented below (plus `page`/`limit`/`search`/`status`) are accepted; anything
else fails validation rather than being silently ignored.

Three endpoints deliberately do **not** accept `search`/`status`, because the
underlying resource has no status of its own and is not searched: `GET /qc`
(the *lot* carries the status), `GET /inventory` and
`GET /inventory/movements`. Sending those params there returns `400` rather
than a `200` that quietly ignores them.

Endpoints with extra filters:

| Endpoint                 | Extra filters                        |
| ------------------------ | ------------------------------------ |
| `GET /products`          | `categoryId`, `partnerId`            |
| `GET /categories`        | —                                    |
| `GET /lots`              | `productId`                          |
| `GET /qc`                | `productLotId` (no `search`/`status`) |
| `GET /inventory`         | `warehouseId`, `productVariantId` (no `search`/`status`) |
| `GET /inventory/movements` | `productLotId` (no `search`/`status`) |
| `GET /warehouse-documents` | `type`                             |
| `GET /customers`         | `role`                               |
| `GET /farms`             | `partnerId`                          |
| `GET /seasons`           | `farmId`                             |
| `GET /certificates`      | `farmId`                             |

`search` is a real server-side filter (name/slug/code/email/phone depending on
the resource) and `status` filters on the endpoint's own status enum. An
unrecognised `status` value — e.g. `GET /settlements?status=BOGUS` — returns
`400` with a validation message; it never reaches the database.

Responses use a paginated envelope:

```json
{
  "data": [ /* items */ ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

### Errors

Errors never leak stack traces or Prisma internals:

```json
{
  "statusCode": 400,
  "error": "BadRequest",
  "message": "…",
  "timestamp": "2026-10-07T09:00:00.000Z"
}
```

Common codes: `400` validation / business rule, `401` missing or invalid token,
`403` insufficient role, `404` not found, `409` duplicate value.

---

## Auth — `/auth`

| Method | Path                | Access   | Description                          |
| ------ | ------------------- | -------- | ------------------------------------ |
| POST   | `/login`            | Public   | Log in, returns `accessToken` + user |
| POST   | `/register`         | Public   | Self-register a CUSTOMER account     |
| POST   | `/forgot-password`  | Public   | Request a password-reset link by e-mail |
| POST   | `/reset-password`   | Public   | Set a new password using the recovery token |
| PATCH  | `/change-password`  | CUSTOMER | Change my password (requires the current one) |
| GET    | `/me`               | Any      | Current authenticated user           |

The user payload is `{ id, email, role, fullName, phone }`. `phone` is included
so the customer profile screen can prefill the field it is allowed to edit; no
password material is ever returned.

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agrimarket.vn","password":"Admin@12345"}'
```

### Self-registration

`POST /auth/register` takes `{ email, password, fullName, phone }` and **always
creates an ACTIVE `CUSTOMER`** — the DTO carries no `role` field, and the global
`ValidationPipe` rejects unknown properties, so `role: "ADMIN"` is a `400` rather
than a privilege escalation. It returns `201` and **no session**: the caller
signs in through `/login`, which keeps one flow for Web and Mobile. A duplicate
e-mail is a `409`.

### Password recovery

Recovery is a real token flow, not a stub:

1. `POST /forgot-password` with `{ email }`. The response is **identical** whether
   or not the address is registered — same message, same `delivery` block — so it
   cannot be used to enumerate accounts. When a link is issued, only the
   SHA-256 **hash** is stored (`password_reset_tokens.token_hash`); the raw token
   exists only in the e-mail. Tokens live 1 hour, are single-use, and requesting
   a new link supersedes the previous one.
2. `POST /reset-password` with `{ token, newPassword }`. Every failure mode
   (unknown, expired, already used) returns the same generic
   `400 Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn`. No session is
   issued; the customer signs in with the new password.

The reset link points at `${CUSTOMER_WEB_URL}/dat-lai-mat-khau?token=<raw>`.

The `delivery` block reports `{ mode, delivered }`. `mode: "smtp"` means a real
e-mail left the machine; `mode: "test"` means the message was captured in memory
and **nothing was sent**. The API reports this honestly so a test transport is
never presented as a delivered e-mail. Transport is chosen from
`MAIL_TRANSPORT` (`smtp` | `test`), falling back to `smtp` when `SMTP_HOST` is
set and `test` otherwise.

### Changing a password

`PATCH /change-password` with `{ currentPassword, newPassword }` returns a fresh
`accessToken`. The change **ends every session issued earlier** — the token
carries a password-version claim (`pwd`) that no longer matches — so other
devices are signed out while the device that made the change stays signed in on
the new token.

### Rate limits

Auth routes are throttled per IP **and** per submitted e-mail/phone, so one client
cannot exhaust another's budget:

| Route              | Limit      |
| ------------------ | ---------- |
| `/login`           | 10 / min   |
| `/register`        | 5 / min    |
| `/forgot-password` | 3 / min    |
| `/reset-password`  | 5 / min    |

Counters are in-memory: correct for protecting individual auth attempts on a
single instance, but a multi-instance deployment would need shared storage.

## Administrative catalogue — `/locations`

The two-level model (tỉnh → xã/phường) that replaced the pre-merger district
model. Only Hưng Yên is seeded, because the storefront ships inside Hưng Yên only.

| Method | Path                              | Access | Description                          |
| ------ | --------------------------------- | ------ | ------------------------------------ |
| GET    | `/provinces`                      | Public | Province list                        |
| GET    | `/provinces/:code`                | Public | One province, `404` when unknown     |
| GET    | `/provinces/:code/wards`          | Public | Communes of a province, optional `search` |
| GET    | `/provinces/:code/wards/:wardCode`| Public | One commune, `404` when unknown      |

**Codes are strings, always.** A commune code is exactly 5 characters
(`"11953"`), never a number, so a leading zero can never be lost.

`search` is accent- and case-insensitive and matches **both** the name and the
code, so `"pho hien"`, `"PHO HIEN"` and `"11953"` all find `Phường Phố Hiến`.

`GET /provinces/:code/wards` is paginated like every other list endpoint **except**
that `limit` is capped at **500** (default `200`) rather than the usual 100, so the
complete 104-unit catalogue comes back in one call. A client should not paginate
this endpoint.

```bash
# The whole Hưng Yên catalogue in one request
curl "$BASE/locations/provinces/33/wards"

# Accent-free search
curl "$BASE/locations/provinces/33/wards?search=duong%20hao"
```

This endpoint is the **single source of truth** for commune names: no client
should ship its own copy of the list.

## Traceability — `/trace`

| Method | Path          | Access | Description                          |
| ------ | ------------- | ------ | ------------------------------------ |
| GET    | `/:traceCode` | Public | Full origin chain for a lot trace code |

Example: `GET /api/v1/trace/TRC-000001-CACHU` returns lot, product, partner,
farm, season, farming events, harvest, QC, valid certificates and public trace
events (see `BUSINESS-RULES.md` §12).

## Catalog

### `/categories`
| Method | Path    | Access | Description                          |
| ------ | ------- | ------ | ------------------------------------ |
| GET    | `/`     | Public | List categories (`search`, `status`) |
| GET    | `/:id`  | Public | Get a category                       |
| POST   | `/`     | ADMIN  | Create a category                    |
| PATCH  | `/:id`  | ADMIN  | Update a category                    |

### `/products`
| Method | Path             | Access | Description                          |
| ------ | ---------------- | ------ | ------------------------------------ |
| GET    | `/`              | Public | List products (`search`, `status`, `categoryId`, `partnerId`) |
| GET    | `/:id`           | Public | Product with variants and images     |
| POST   | `/`              | ADMIN  | Create product (+ optional variants/images). `slug` may be omitted and is generated from the name |
| PATCH  | `/:id`           | ADMIN  | Update a product (slug only changes when explicitly sent) |
| POST   | `/:id/variants`  | ADMIN  | Add a variant to a product           |
| POST   | `/:id/images`    | ADMIN  | Upload an image (`multipart/form-data`, field `file`) |
| POST   | `/:id/images/:imageId/replace` | ADMIN | Replace an image file, keeping order and cover flag |
| PATCH  | `/:id/images/:imageId/primary` | ADMIN | Set the cover image                  |
| PATCH  | `/:id/images/order` | ADMIN | Reorder images (`{ orderedIds: number[] }`, exact set) |
| DELETE | `/:id/images/:imageId` | ADMIN | Delete an image row and its file   |

Image uploads accept JPG, PNG and WebP (extension + magic bytes verified),
≤ 5 MB, 100–6000 px per side, max 6 images per product. Files are optimised
(longest side ≤ 1600 px, quality 82, never enlarged), stored under a random
UUID name in `./uploads/products/` (outside `dist/`, served at
`/uploads/products/...`) and returned as stable absolute URLs shared by Admin,
Customer and Mobile. Image rows keep `mimeType/width/height/sizeBytes`.
A duplicate `slug` is a 409 with a business message.

Each variant in a public catalog response carries `effectivePrice`
(`{ basePrice, unitPrice, discountAmount, source }` where `source` is `NONE`,
`PRODUCT_DISCOUNT` or `FLASH_SALE`), plus `availableQuantity` and `inStock`. The
price is resolved by the same backend code the checkout uses
(flash sale > product discount > base), so a catalog card can never disagree with
what is charged, and availability reflects sellable lots only — a lot that is
PENDING_QC, QUARANTINED, RECALLED or expired is not counted.

### `/partners`
| Method | Path    | Access | Description                        |
| ------ | ------- | ------ | ---------------------------------- |
| GET    | `/`     | Public | List partners (`search`, `status`) |
| GET    | `/:id`  | Public | Get a partner                      |
| POST   | `/`     | ADMIN  | Create a partner                   |
| PATCH  | `/:id`  | ADMIN  | Update a partner                   |

### `/farms`
| Method | Path    | Access | Description                                  |
| ------ | ------- | ------ | -------------------------------------------- |
| GET    | `/`     | Public | List farms (`search`, `status`, `partnerId`) |
| GET    | `/:id`  | Public | Get a farm                                   |
| POST   | `/`     | ADMIN  | Create a farm                                |
| PATCH  | `/:id`  | ADMIN  | Update a farm                                |

### `/seasons` and `/farming-events`
| Method | Path                            | Access | Description                    |
| ------ | ------------------------------- | ------ | ------------------------------ |
| GET    | `/seasons`                      | Public | List seasons (`search`, `status`, `farmId`) |
| GET    | `/seasons/:id`                  | Public | Get a season                   |
| POST   | `/seasons`                      | ADMIN  | Create a season                |
| PATCH  | `/seasons/:id`                  | ADMIN  | Update a season                |
| GET    | `/farming-events/season/:seasonId` | Public | Public farming events of a season |
| POST   | `/farming-events`               | ADMIN  | Add a farming event            |

### `/harvests`
| Method | Path    | Access | Description       |
| ------ | ------- | ------ | ----------------- |
| GET    | `/`     | Public | List harvests     |
| GET    | `/:id`  | Public | Get a harvest     |
| POST   | `/`     | ADMIN  | Create a harvest  |
| PATCH  | `/:id`  | ADMIN  | Update a harvest  |

### `/certificates`
| Method | Path                   | Access | Description                           |
| ------ | ---------------------- | ------ | ------------------------------------- |
| GET    | `/`                    | Public | List certificates (`status`, `farmId`) |
| GET    | `/farm/:farmId/valid`  | Public | Currently valid certs for a farm      |
| GET    | `/:id`                 | Public | Get a certificate                     |
| POST   | `/`                    | ADMIN  | Create a certificate                  |
| PATCH  | `/:id/verify`          | ADMIN  | Verify / reject a certificate         |

## Quality & lots

### `/lots`
| Method | Path           | Access | Description                               |
| ------ | -------------- | ------ | ----------------------------------------- |
| GET    | `/`            | Public | List lots (`search`, `status`, `productId`) |
| GET    | `/:id`         | Public | Lot with QC, trace events, inventory      |
| POST   | `/`            | ADMIN  | Create a lot from a harvest (starts PENDING_QC) |
| POST   | `/:id/recall`  | ADMIN  | Recall a lot (removes from sellable)      |

### `/qc`
| Method | Path    | Access | Description                              |
| ------ | ------- | ------ | ---------------------------------------- |
| GET    | `/`     | Public | List inspections (`productLotId` filter) |
| GET    | `/:id`  | Public | Get an inspection                        |
| POST   | `/`     | ADMIN  | Record inspection; drives lot status     |

## Warehouse & inventory — ADMIN

### `/warehouses`
| Method | Path    | Access | Description        |
| ------ | ------- | ------ | ------------------ |
| GET    | `/`     | Public | List warehouses    |
| GET    | `/:id`  | Public | Get a warehouse    |
| POST   | `/`     | ADMIN  | Create a warehouse |
| PATCH  | `/:id`  | ADMIN  | Update a warehouse |

### `/inventory`
| Method | Path           | Access | Description                                  |
| ------ | -------------- | ------ | -------------------------------------------- |
| GET    | `/`            | ADMIN  | List balances (`warehouseId`, `productVariantId`) |
| GET    | `/movements`   | ADMIN  | List the movement ledger (`productLotId`)    |
| POST   | `/inbound`     | ADMIN  | Inbound stock                                |
| POST   | `/adjust`      | ADMIN  | Signed adjustment (never negative)           |
| POST   | `/reserve`     | ADMIN  | Reserve stock                                |
| POST   | `/release`     | ADMIN  | Release a reservation                        |

### `/warehouse-documents`
| Method | Path            | Access | Description                    |
| ------ | --------------- | ------ | ------------------------------ |
| GET    | `/`             | ADMIN  | List documents (`status`, `type`) |
| GET    | `/:id`          | ADMIN  | Get a document with lines      |
| POST   | `/`             | ADMIN  | Create a document              |
| POST   | `/:id/complete` | ADMIN  | Complete a document            |

## Cart — CUSTOMER

### `/carts`
| Method | Path                | Access   | Description                  |
| ------ | ------------------- | -------- | ---------------------------- |
| GET    | `/me`               | CUSTOMER | Get my cart with items       |
| POST   | `/me/items`         | CUSTOMER | Add an item                  |
| PATCH  | `/me/items/:itemId` | CUSTOMER | Update item quantity         |
| DELETE | `/me/items/:itemId` | CUSTOMER | Remove an item               |
| DELETE | `/me`               | CUSTOMER | Clear my cart                |

## Orders

### `/orders`
| Method | Path             | Access   | Description                                        |
| ------ | ---------------- | -------- | -------------------------------------------------- |
| POST   | `/checkout`      | CUSTOMER | Create order, split by partner, reserve stock      |
| POST   | `/checkout-preview` | CUSTOMER | Backend-computed price, voucher, shipping fee and stock for the current lines (creates nothing) |
| GET    | `/me`            | CUSTOMER | List my orders (`status` filter, server pagination) |
| GET    | `/me/:id`        | CUSTOMER | Get one of my orders (allocated lots + shipment events) |
| POST   | `/me/:id/cancel` | CUSTOMER | Cancel my own order (order state machine, releases reservations) |
| GET    | `/`              | ADMIN    | List all orders (`search`, `status`)               |
| GET    | `/:id`           | ADMIN    | Get an order                                       |
| PATCH  | `/:id/status`    | ADMIN    | Advance status (DELIVERED settles COD)             |

**Checkout money.** `POST /orders/checkout` has no `shippingFee` field: the fee is
decided by the backend (`FLAT_SHIPPING_FEE` in `src/orders/shipping-policy.ts`)
and the global `ValidationPipe` rejects an unknown `shippingFee` with a 400, so a
client cannot influence the total. `POST /orders/checkout-preview` reports the
same numbers before submitting: `items[]` (with `unitPrice`, `priceSource`,
`availableQuantity`, `available`), `subtotal`, `discountTotal`, `voucher`,
`shippingFee` and `grandTotal`. It creates nothing and reserves no stock.

**Idempotency.** Send an `Idempotency-Key` header (or `idempotencyKey` in the
body; the body wins). The key is bound to the customer and to a hash of what the
caller sent (address, voucher, payment method, note, and the explicit `items[]`
when present — a cart-based checkout does not hash server-owned cart state). The
same key with the same payload returns the original order, the same key with a
different payload is a 409, and a retry after a lost response cannot create a
second order: the key is looked up *before* the cart is resolved, so a retry that
arrives after the first request already cleared the cart still replays the order
instead of failing with `No items to checkout`. Omitting the key keeps the
previous behaviour.

**Cancel.** `POST /orders/me/:id/cancel` runs the same state machine as the admin
route: only `PENDING_CONFIRMATION`, `CONFIRMED`, `PREPARING`, `READY_TO_SHIP` and
`SHIPPING` can be cancelled, and a second cancel on a terminal order is a 400.
Stock reservations are released with `RELEASE` movements.

## Shipments — ADMIN

### `/shipments`
| Method | Path           | Access | Description                                        |
| ------ | -------------- | ------ | -------------------------------------------------- |
| GET    | `/`            | ADMIN  | List shipments (`status`)                          |
| GET    | `/:id`         | ADMIN  | Shipment with events                               |
| POST   | `/`            | ADMIN  | Create a shipment for a partner order              |
| PATCH  | `/:id/status`  | ADMIN  | Advance status (DELIVERED settles, RETURNED quarantines) |

## Payments & refunds — ADMIN

### `/payments` and `/refunds`
| Method | Path                   | Access | Description              |
| ------ | ---------------------- | ------ | ------------------------ |
| GET    | `/payments`            | ADMIN  | List payments (`status`) |
| GET    | `/payments/:id`        | ADMIN  | Get a payment            |
| POST   | `/payments`            | ADMIN  | Create a payment         |
| PATCH  | `/payments/:id/status` | ADMIN  | Update payment status    |
| GET    | `/refunds`             | ADMIN  | List refunds             |
| POST   | `/refunds`             | ADMIN  | Create a refund          |

## Promotions

### `/vouchers`, `/product-discounts`, `/flash-sales`
| Method | Path                  | Access | Description               |
| ------ | --------------------- | ------ | ------------------------- |
| GET    | `/vouchers`           | Public | List vouchers (`search`, `status`) |
| POST   | `/vouchers`           | ADMIN  | Create a voucher          |
| GET    | `/product-discounts`  | Public | List product discounts (`status`) |
| POST   | `/product-discounts`  | ADMIN  | Create a product discount |
| GET    | `/flash-sales`        | Public | List flash sales (`status`) |
| POST   | `/flash-sales`        | ADMIN  | Create a flash sale       |

## Reviews, complaints, returns

### `/reviews`
| Method | Path                    | Access   | Description                       |
| ------ | ----------------------- | -------- | --------------------------------- |
| GET    | `/product/:productId`   | Public   | Approved reviews for a product    |
| POST   | `/`                     | CUSTOMER | Review a purchased, delivered item |
| GET    | `/me`                   | CUSTOMER | My own reviews, any status (carries `orderItemId`) |
| GET    | `/`                     | ADMIN    | List reviews (`status`)           |
| PATCH  | `/:id/status`           | ADMIN    | Approve / hide a review           |

### `/complaints`
| Method | Path     | Access   | Description             |
| ------ | -------- | -------- | ----------------------- |
| POST   | `/`      | CUSTOMER | File a complaint        |
| GET    | `/me`    | CUSTOMER | List my complaints (`status`, paginated) |
| GET    | `/me/:id`| CUSTOMER | Get one of my complaints |
| GET    | `/`      | ADMIN    | List complaints (`status`) |
| GET    | `/:id`   | ADMIN    | Get a complaint         |
| PATCH  | `/:id`   | ADMIN    | Update / resolve        |

### `/returns`
| Method | Path      | Access   | Description                    |
| ------ | --------- | -------- | ------------------------------ |
| POST   | `/`       | CUSTOMER | Request a return               |
| GET    | `/me`     | CUSTOMER | List my return requests (`status`, paginated) |
| GET    | `/me/:id` | CUSTOMER | Get one of my return requests  |
| GET    | `/`       | ADMIN    | List return requests (`status`) |
| GET    | `/:id`    | ADMIN    | Get a return request           |
| PATCH  | `/:id`    | ADMIN    | Advance return status          |

Ownership is part of every customer query: another customer's record answers 404,
exactly like a missing one. Customer list/detail responses include the related
`order` (`id`, `code`) and, for returns, the `refund` when one exists — no
settlement, commission or payout data is exposed.

## Customers — `/customers`

| Method | Path                    | Access   | Description                    |
| ------ | ----------------------- | -------- | ------------------------------ |
| PATCH  | `/me`                   | CUSTOMER | Update my profile (`fullName`, `phone`) |
| GET    | `/me/addresses`         | CUSTOMER | List my addresses (default first) |
| POST   | `/me/addresses`         | CUSTOMER | Add an address                 |
| PATCH  | `/me/addresses/:id`     | CUSTOMER | Update one of my addresses     |
| DELETE | `/me/addresses/:id`     | CUSTOMER | Delete one of my addresses     |
| PATCH  | `/me/addresses/:id/default` | CUSTOMER | Make one of my addresses the default |
| GET    | `/`                     | ADMIN    | List customers (`search`, `status`, `role`) |
| GET    | `/:id`                  | ADMIN    | Get a customer                 |
| POST   | `/`                     | ADMIN    | Create a customer              |
| PATCH  | `/:id/deactivate`       | ADMIN    | Deactivate a customer          |
| PATCH  | `/:id/activate`         | ADMIN    | Activate a customer            |

Every address call is scoped to the signed-in customer server-side, and exactly
one address per customer carries `isDefault` (setting a new default clears the
others in the same transaction). `PATCH /customers/me` returns the safe user
projection — email and role are not editable by the customer.

### Two generations of address

The address payload accepts both the new and the legacy model, so an address
saved before the 2025 reorganisation keeps working:

| Generation | Fields | Notes |
| ---------- | ------ | ----- |
| **New** (tỉnh → xã/phường) | `provinceCode` + `wardCode` | Codes from `/locations`. `wardName` is **resolved server-side** and the client's own spelling is discarded. No district level. |
| **Legacy** (free text) | `province`, `district`, `ward` | Accepted as sent and never reinterpreted. Kept so historical addresses survive. |

Rules:

- `wardCode` requires `provinceCode`; sending a commune code without its
  province code is a `400`.
- An unknown code, or one that belongs to a different province, is a `400`
  `Xã/phường không hợp lệ hoặc không thuộc tỉnh đã chọn`.
- Editing a legacy address to a catalogue commune **drops `district`**, because
  the district level no longer exists in the new model.
- `village` (thôn / tổ dân phố) stays free text — no verified list exists, so none
  was invented.

```bash
# Code-verified address: the official name is filled in by the server
curl -X POST "$BASE/customers/me/addresses" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"recipientName":"Nguyễn Thị Lan","phone":"0912345678",
       "provinceCode":"33","wardCode":"11953","detail":"Số 12 Nguyễn Văn Linh"}'
```

**Checkout** snapshots the verified commune into
`orders.shippingAddressSnapshot` the same way, and the snapshot is validated
**before** the transaction opens — so a bad commune code is refused without
claiming a voucher, an order code or any stock. A legacy address is snapshotted
as sent, so an order placed from a pre-reorganisation address still shows exactly
the address the customer chose.

## Finance — ADMIN

### `/commission-rules`, `/settlements`, `/payouts`
| Method | Path                       | Access | Description                       |
| ------ | -------------------------- | ------ | --------------------------------- |
| GET    | `/commission-rules`        | ADMIN  | List commission rules (`status`)  |
| POST   | `/commission-rules`        | ADMIN  | Create a commission rule          |
| GET    | `/settlements`             | ADMIN  | List settlements (`status`)       |
| GET    | `/settlements/:id`         | ADMIN  | Settlement with lines and payouts |
| POST   | `/settlements`             | ADMIN  | Build a settlement for a period   |
| POST   | `/settlements/:id/confirm` | ADMIN  | Confirm a draft settlement        |
| GET    | `/payouts`                 | ADMIN  | List payouts (`status`)           |
| POST   | `/payouts`                 | ADMIN  | Create a payout                   |
| POST   | `/payouts/:id/pay`         | ADMIN  | Mark a payout as paid             |

## Reports — ADMIN

### `/reports/summary`

Full-set aggregates for Tổng quan and Báo cáo. Pass `?from=&to=`, or `?days=7|30`
(default 30 days); the window resolver is **shared with `/reports/daily`**, so a
KPI total and the chart sum reconcile for the same period. Never a capped list:
every figure is a `COUNT`/`SUM` over the filtered set.

- `orders.totalOrderValue`: Σ grandTotal of non-cancelled orders **created** in
  the window (order value, NOT money received). `averageOrderValue` divides by
  non-cancelled orders.
- Revenue is **cash flow**, dated by when money actually moved:
  - `revenue.grossCollected`: Σ amount of collected payments by **`paidAt`**
    (status `PAID` / `PARTIALLY_REFUNDED` / `REFUNDED`). A fully refunded payment
    is still money that was collected, so it stays in gross.
  - `revenue.refundTotal`: Σ COMPLETED refunds by **`completedAt`**.
  - `revenue.netCollected` = gross − refunds ("doanh thu thực nhận"). Each leg is
    counted once; a refund-only period can be negative (correct cash view).
- `commissionRecorded`: Σ partner-order commission of non-cancelled orders.
- Cancelled orders contribute no order value or commission. Money already
  collected on a later-cancelled order is still cash until its refund completes.
- Also: order/return/complaint counts by status, lots (`pendingQc`,
  `sellableExpiring7d`, `sellableExpired`), `inventory.lowStockLines` (count of
  `inventory_balances` rows whose available `on_hand − reserved − blocked` is
  `> 0` and `≤ inventory.lowStockThreshold`), `certificates.pending`, and
  `topProducts` (top 10 by revenue).

### `/reports/daily`

Zero-filled series bucketed by the **Vietnam** calendar day (UTC+7). `?days=7|30`
or an explicit `from`/`to`. `orderCount`/`orderValue` are by order `created_at`;
`grossCollected` is by payment `paid_at`, `refundTotal` is by refund
`completed_at`, and `netCollected` is the difference.

## Quick smoke test

```bash
BASE=http://localhost:3000/api/v1

# 1. Public catalog
curl "$BASE/products?limit=5"

# 2. Public trace
curl "$BASE/trace/TRC-000001-CACHU"

# 3. Login as admin
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agrimarket.vn","password":"Admin@12345"}' | jq -r .accessToken)

# 4. Authenticated admin list
curl "$BASE/orders?status=DELIVERED" -H "Authorization: Bearer $TOKEN"

# 5. Unknown status enum → 400 (not 500)
curl -i "$BASE/settlements?status=BOGUS" -H "Authorization: Bearer $TOKEN"

# 6. Unknown query parameter → 400 (params are whitelisted)
curl -i "$BASE/products?bogusParam=1"
```
