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

### Pagination, search, status

List endpoints accept:

| Query    | Type   | Notes                                   |
| -------- | ------ | --------------------------------------- |
| `page`   | int    | ≥ 1, default `1`                        |
| `limit`  | int    | ≥ 1, ≤ **100**, default `20`            |
| `search` | string | optional free-text filter               |
| `status` | string | optional status filter (per endpoint)   |

Responses use a paginated envelope:

```json
{
  "data": [ /* items */ ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

`limit` above 100 is rejected with `400`.

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

| Method | Path      | Access | Description                          |
| ------ | --------- | ------ | ------------------------------------ |
| POST   | `/login`  | Public | Log in, returns `accessToken` + user |
| GET    | `/me`     | Any    | Current authenticated user           |

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agrimarket.vn","password":"Admin@12345"}'
```

## Traceability — `/trace`

| Method | Path          | Access | Description                          |
| ------ | ------------- | ------ | ------------------------------------ |
| GET    | `/:traceCode` | Public | Full origin chain for a lot trace code |

Example: `GET /api/v1/trace/TRC-000001-CACHU` returns lot, product, partner,
farm, season, farming events, harvest, QC, valid certificates and public trace
events (see `BUSINESS-RULES.md` §12).

## Catalog

### `/categories`
| Method | Path    | Access | Description           |
| ------ | ------- | ------ | --------------------- |
| GET    | `/`     | Public | List categories       |
| GET    | `/:id`  | Public | Get a category        |
| POST   | `/`     | ADMIN  | Create a category     |
| PATCH  | `/:id`  | ADMIN  | Update a category     |

### `/products`
| Method | Path             | Access | Description                          |
| ------ | ---------------- | ------ | ------------------------------------ |
| GET    | `/`              | Public | List products (`categoryId`, `partnerId` filters) |
| GET    | `/:id`           | Public | Product with variants and images     |
| POST   | `/`              | ADMIN  | Create product (+ optional variants/images) |
| PATCH  | `/:id`           | ADMIN  | Update a product                     |
| POST   | `/:id/variants`  | ADMIN  | Add a variant to a product           |

### `/partners`
| Method | Path    | Access | Description        |
| ------ | ------- | ------ | ------------------ |
| GET    | `/`     | Public | List partners      |
| GET    | `/:id`  | Public | Get a partner      |
| POST   | `/`     | ADMIN  | Create a partner   |
| PATCH  | `/:id`  | ADMIN  | Update a partner   |

### `/farms`
| Method | Path    | Access | Description      |
| ------ | ------- | ------ | ---------------- |
| GET    | `/`     | Public | List farms       |
| GET    | `/:id`  | Public | Get a farm       |
| POST   | `/`     | ADMIN  | Create a farm    |
| PATCH  | `/:id`  | ADMIN  | Update a farm    |

### `/seasons` and `/farming-events`
| Method | Path                            | Access | Description                    |
| ------ | ------------------------------- | ------ | ------------------------------ |
| GET    | `/seasons`                      | Public | List seasons                   |
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
| Method | Path                   | Access | Description                     |
| ------ | ---------------------- | ------ | ------------------------------- |
| GET    | `/`                    | Public | List certificates               |
| GET    | `/farm/:farmId/valid`  | Public | Currently valid certs for a farm |
| GET    | `/:id`                 | Public | Get a certificate               |
| POST   | `/`                    | ADMIN  | Create a certificate            |
| PATCH  | `/:id/verify`          | ADMIN  | Verify / reject a certificate   |

## Quality & lots

### `/lots`
| Method | Path           | Access | Description                               |
| ------ | -------------- | ------ | ----------------------------------------- |
| GET    | `/`            | Public | List lots (`productId` filter)            |
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
| GET    | `/`            | ADMIN  | List balances with computed `available`      |
| GET    | `/movements`   | ADMIN  | List the movement ledger (`productLotId`)    |
| POST   | `/inbound`     | ADMIN  | Inbound stock                                |
| POST   | `/adjust`      | ADMIN  | Signed adjustment (never negative)           |
| POST   | `/reserve`     | ADMIN  | Reserve stock                                |
| POST   | `/release`     | ADMIN  | Release a reservation                        |

### `/warehouse-documents`
| Method | Path            | Access | Description                    |
| ------ | --------------- | ------ | ------------------------------ |
| GET    | `/`             | ADMIN  | List documents                 |
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
| GET    | `/me`            | CUSTOMER | List my orders                                     |
| GET    | `/me/:id`        | CUSTOMER | Get one of my orders                               |
| GET    | `/`              | ADMIN    | List all orders (`search`, `status`)               |
| GET    | `/:id`           | ADMIN    | Get an order                                       |
| PATCH  | `/:id/status`    | ADMIN    | Advance status (DELIVERED settles COD)             |

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
| GET    | `/payments`            | ADMIN  | List payments            |
| GET    | `/payments/:id`        | ADMIN  | Get a payment            |
| POST   | `/payments`            | ADMIN  | Create a payment         |
| PATCH  | `/payments/:id/status` | ADMIN  | Update payment status    |
| GET    | `/refunds`             | ADMIN  | List refunds             |
| POST   | `/refunds`             | ADMIN  | Create a refund          |

## Promotions

### `/vouchers`, `/product-discounts`, `/flash-sales`
| Method | Path                  | Access | Description               |
| ------ | --------------------- | ------ | ------------------------- |
| GET    | `/vouchers`           | Public | List vouchers             |
| POST   | `/vouchers`           | ADMIN  | Create a voucher          |
| GET    | `/product-discounts`  | Public | List product discounts    |
| POST   | `/product-discounts`  | ADMIN  | Create a product discount |
| GET    | `/flash-sales`        | Public | List flash sales          |
| POST   | `/flash-sales`        | ADMIN  | Create a flash sale       |

## Reviews, complaints, returns

### `/reviews`
| Method | Path                    | Access   | Description                       |
| ------ | ----------------------- | -------- | --------------------------------- |
| GET    | `/product/:productId`   | Public   | Approved reviews for a product    |
| POST   | `/`                     | CUSTOMER | Review a purchased, delivered item |
| GET    | `/`                     | ADMIN    | List reviews (`status`)           |
| PATCH  | `/:id/status`           | ADMIN    | Approve / hide a review           |

### `/complaints`
| Method | Path    | Access   | Description             |
| ------ | ------- | -------- | ----------------------- |
| POST   | `/`     | CUSTOMER | File a complaint        |
| GET    | `/`     | ADMIN    | List complaints         |
| GET    | `/:id`  | ADMIN    | Get a complaint         |
| PATCH  | `/:id`  | ADMIN    | Update / resolve        |

### `/returns`
| Method | Path    | Access   | Description                    |
| ------ | ------- | -------- | ------------------------------ |
| POST   | `/`     | CUSTOMER | Request a return               |
| GET    | `/`     | ADMIN    | List return requests           |
| GET    | `/:id`  | ADMIN    | Get a return request           |
| PATCH  | `/:id`  | ADMIN    | Advance return status          |

## Customers — `/customers`

| Method | Path                    | Access   | Description                    |
| ------ | ----------------------- | -------- | ------------------------------ |
| GET    | `/me/addresses`         | CUSTOMER | List my addresses              |
| POST   | `/me/addresses`         | CUSTOMER | Add an address                 |
| GET    | `/`                     | ADMIN    | List customers                 |
| GET    | `/:id`                  | ADMIN    | Get a customer                 |
| POST   | `/`                     | ADMIN    | Create a customer              |
| PATCH  | `/:id/deactivate`       | ADMIN    | Deactivate a customer          |
| PATCH  | `/:id/activate`         | ADMIN    | Activate a customer            |

## Finance — ADMIN

### `/commission-rules`, `/settlements`, `/payouts`
| Method | Path                       | Access | Description                       |
| ------ | -------------------------- | ------ | --------------------------------- |
| GET    | `/commission-rules`        | ADMIN  | List commission rules             |
| POST   | `/commission-rules`        | ADMIN  | Create a commission rule          |
| GET    | `/settlements`             | ADMIN  | List settlements                  |
| GET    | `/settlements/:id`         | ADMIN  | Settlement with lines and payouts |
| POST   | `/settlements`             | ADMIN  | Build a settlement for a period   |
| POST   | `/settlements/:id/confirm` | ADMIN  | Confirm a draft settlement        |
| GET    | `/payouts`                 | ADMIN  | List payouts                      |
| POST   | `/payouts`                 | ADMIN  | Create a payout                   |
| POST   | `/payouts/:id/pay`         | ADMIN  | Mark a payout as paid             |

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
```
