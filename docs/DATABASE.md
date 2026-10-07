# AgriMarket V2 — Database

Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).
Engine: **MySQL 8.4**, charset `utf8mb4`, collation `utf8mb4_unicode_ci`.
Access layer: **Prisma 7** through `@prisma/adapter-mariadb`.

## Conventions

- **Business codes, not UUIDs.** Every user-facing entity carries a human
  readable `code` (or `traceCode`) that is `@unique`. Internal `id` columns are
  autoincrement integers and are never shown in the UI.
- **Money** is always `Decimal(18,2)`. Quantities use `Decimal(18,3)`.
  Percentages use `Decimal(5,2)`. No `Float`/`Double` anywhere.
- **English** for every table, column and enum name. Vietnamese only appears in
  seeded *data* (names, descriptions, notes).
- **Soft status, not hard delete.** Transactional rows are never deleted; they
  move through status enums. Master data uses `RecordStatus` (`ACTIVE` /
  `INACTIVE`).
- **Explicit foreign keys** on every relation, with `@@index` on foreign keys
  and on commonly searched columns (`code`, `name`, `phone`, `status`).
- Table names are snake_case (`@@map`); columns are snake_case (`@map`).

## Code formats

| Entity          | Example                    | Generator                         |
| --------------- | -------------------------- | --------------------------------- |
| Partner         | `PARTNER-0001`             | `buildCode('PARTNER', n)`         |
| Farm            | `FARM-0001`                | `buildCode('FARM', n)`            |
| Warehouse       | `WH-0001`                  | `buildCode('WH', n)`              |
| Product lot     | `LOT-20261007-0001`        | `buildDatedCode('LOT', n)`        |
| Warehouse doc   | `WHD-20261007-0001`        | `buildDatedCode('WHD', n)`        |
| Order           | `ORD-20261007-0001`        | `buildDatedCode('ORD', n)`        |
| Partner order   | `ORD-20261007-0001-P01`    | order code + `-P` + 2-digit index |
| Shipment        | `SHP-20261007-0001`        | `buildDatedCode('SHP', n)`        |
| Settlement      | `SET-0001`                 | `buildCode('SET', n)`             |
| Payout          | `PAY-20261007-0001`        | `buildDatedCode('PAY', n)`        |
| Lot trace code  | `TRC-000001-CACHU`         | `TRC-<seq6>-<product fragment>`   |

Sequence numbers are derived from `count() + 1` inside the write path; the
`@unique` constraint is the safety net against collisions.

## Tables

### A. Users
| Table               | Purpose                                              | Key columns |
| ------------------- | ---------------------------------------------------- | ----------- |
| `users`             | Admin + customer accounts (single table, `role`)     | `email` uq, `password_hash`, `role`, `status` |
| `customer_profiles` | Customer-only data (loyalty points)                  | `user_id` uq |
| `addresses`         | Customer delivery addresses                          | `customer_id`, `is_default` |

### B. Partner & Farm
| Table      | Purpose                              | Key columns |
| ---------- | ------------------------------------ | ----------- |
| `partners` | Supplier organisations (HTX/company) | `code` uq, `tax_code`, bank fields |
| `farms`    | Production sites, **owned by a partner** | `code` uq, `partner_id` |

> **Partner ≠ Farm.** A partner can own many farms; every farm belongs to
> exactly one partner.

### C. Season / Farming log / Harvest
| Table            | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `seasons`        | A crop cycle on a farm                     |
| `farming_events` | Public farming log (watering, fertilizing) |
| `harvests`       | A harvest batch within a season            |

### D. Certificate
| Table          | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `certificates` | VietGAP/GlobalGAP etc., with verification status   |

### E. Catalog
| Table              | Purpose                              |
| ------------------ | ------------------------------------ |
| `categories`       | Product categories (slug)            |
| `products`         | Product owned by a partner, optional farm |
| `product_images`   | Product gallery                      |
| `product_variants` | Sellable SKU with `base_price`       |

### F–H. Lot / QC / Traceability
| Table            | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `product_lots`   | A lot from a harvest, with `expires_at` and `status`   |
| `qc_inspections` | QC results; **the only path to `SELLABLE`**            |
| `trace_events`   | Public origin timeline per lot                         |

### I. Warehouse & inventory
| Table                     | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `warehouses`              | Storage locations                                |
| `inventory_balances`      | `on_hand` / `reserved` / `blocked` per lot+variant |
| `warehouse_documents`     | Inbound/outbound/adjustment/return documents      |
| `warehouse_document_lines`| Document lines                                   |
| `inventory_movements`     | Append-only ledger of every stock change         |

### J. Cart
`carts` (one per customer) and `cart_items` (unique per variant).

### K–L. Order & FEFO allocation
| Table                   | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `orders`                | Customer order, price + address snapshots          |
| `partner_orders`        | One sub-order per partner (multi-partner split)    |
| `order_items`           | Immutable price/name/SKU snapshots                 |
| `inventory_allocations` | Which lot(s) satisfy each order item (FEFO)        |

### M. Fulfillment & shipment
`fulfillments` (per partner order) and `shipments` + `shipment_events`.

### N. Payment & refund
`payments` (COD/VNPAY) and `refunds`.

### O. Promotion (three separate concepts)
| Table              | Purpose                          |
| ------------------ | -------------------------------- |
| `vouchers`         | Order-level discount codes       |
| `voucher_redemptions` | Per-customer voucher usage    |
| `product_discounts`| Auto-applied per-variant discount |
| `flash_sales` / `flash_sale_items` | Time-boxed quota pricing |

> **Voucher ≠ ProductDiscount ≠ FlashSale.** Three distinct tables, three
> distinct pricing behaviours (see `BUSINESS-RULES.md`).

### P–Q. Review / Complaint / Return
`reviews` (one per order item), `complaints`, `return_requests`.

### R. Commission / Settlement / Payout
| Table             | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `commission_rules`| Rate by partner and/or category            |
| `settlements` / `settlement_lines` | Period settlement per partner |
| `payouts`         | Money paid to a partner for a settlement   |

### S. Audit
`audit_logs` — append-only record of significant admin actions
(`entity_type`, `entity_id`, `before_json`, `after_json`, `reason`).

## Enums

`UserRole` (ADMIN, CUSTOMER) · `UserStatus` · `RecordStatus` · `SeasonStatus` ·
`FarmingEventType` · `CertificateVerificationStatus` · `ProductLotStatus`
(PENDING_QC, QUARANTINED, SELLABLE, REJECTED, RECALLED, EXPIRED, LOCKED) ·
`QcResult` · `TraceEventType` · `WarehouseDocumentType/Status` ·
`InventoryMovementType` · `OrderStatus` / `PartnerOrderStatus` ·
`FulfillmentStatus` · `ShipmentStatus` · `PaymentMethod` · `PaymentStatus` ·
`RefundStatus` · `DiscountType` · `ReviewStatus` · `ComplaintType/Status` ·
`ReturnRequestStatus` · `SettlementStatus` · `PayoutStatus`.

## Migrations

The initial migration lives in
`apps/api/prisma/migrations/20260101000000_init_v2/migration.sql` and creates all
45 tables. Apply it with:

```bash
pnpm --filter @agrimarket/api db:deploy     # apply committed migrations
pnpm --filter @agrimarket/api db:migrate    # create a new migration in dev
```

## Databases

| Database              | Purpose                     |
| --------------------- | --------------------------- |
| `agrimarket_v2`       | Development / demo          |
| `agrimarket_v2_test`  | Isolated database for e2e   |

Create them once (needs a privileged MySQL user):

```bash
mysql -u <user> -p < scripts/sql/create-databases.sql
```

Both databases are `utf8mb4` / `utf8mb4_unicode_ci`.
