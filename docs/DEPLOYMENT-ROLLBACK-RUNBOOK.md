# Deployment and Rollback Runbook — AgriMarket V2

Status: **local, GitHub-independent procedure.** It documents how to build,
rehearse migrations, deploy and roll back AgriMarket V2 without GitHub Actions,
remote CI, branch protection or any repository setting.

This runbook has been exercised only through the local verification gate
(`npm run verify:local`). No staging or production deployment, cutover or
rollback was performed. Anything below marked **NOT VERIFIED** requires an owner,
a real environment and a maintenance window before it can be claimed as done.

---

## 1. Scope and hard boundaries

| Item | Position |
| --- | --- |
| CI/CD provider | None. No GitHub Actions, no remote pipeline, no repository configuration. The release gate is the local `npm run verify:local`. |
| Artifacts | API (`apps/api/dist`), Admin Web (`.next`), Customer Web (`.next`), Prisma client and the 14 SQL migrations in `apps/api/prisma/migrations`. |
| Database | MySQL 8.0 (verified on 8.0.46). One writer schema. |
| Mobile | Expo Go / JavaScript bundle only. No APK/AAB or native build is part of this runbook. |
| Execution rights | Build and isolated rehearsal: engineering. Production migration/cutover/rollback: named owner approval required. |
| Prohibited | `prisma migrate dev`, `prisma migrate reset` or `db:seed` against a shared/staging/production schema. Restoring a drill into a live schema. Editing settlement history to "repair" a blocked payout. |
| Money safety | No real money movement is tested or performed. C-08 recovery/payout decisions always require a human approval and never rewrite historical settlements. |

The local gate creates and drops a schema named
`agrimarket_v2_c19_<token>_test`, imports the official ward catalogue, and never
writes the application schema referenced by `DATABASE_URL`. See
`scripts/local-verify.mjs`.

---

## 2. Prerequisites

### 2.1. Toolchain

| Component | Verified value | Minimum |
| --- | --- | --- |
| Node.js | v26.12.0 | >= 20 |
| npm | 11.20.0 | >= 10 |
| Prisma | 7.10.1 | Locked by `package-lock.json` |
| Next.js | 16.4.1 | Locked |
| MySQL client/server | 8.0.46 | 8.0 |
| OS used for verification | Windows 11 x64 | Linux is expected to work but was not exercised |

Install and build from the repository root:

```powershell
npm ci
npm run db:generate
npm run build
```

`npm ci` must be used when `package-lock.json` is present so the tested
dependency graph (including the `multer@2.5.0` override) is reproduced. Do not
run `npm install` on a release host unless the lockfile is intentionally being
changed.

### 2.2. API environment

Required at minimum:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | MySQL URL of the target schema. Never a test URL. |
| `JWT_SECRET` | >= 32 characters, high entropy, not a placeholder. The API refuses to start otherwise. |
| `CORS_ORIGIN` | Exact comma-separated browser origins. Never `*`. An empty value falls back to localhost dev origins only. |
| `PORT` | API port (default 3000). |
| `UPLOADS_DIR` | Writable directory for product images. |
| `PUBLIC_API_BASE_URL` | Absolute API origin used to build image URLs. |
| `CUSTOMER_WEB_URL` | Customer Web origin used in password-recovery links. |
| `ORDER_RESERVATION_TTL_MINUTES` | Positive integer; final production value is a business decision. |
| Mail variables | `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` when real delivery is required. Without SMTP the API uses the test transport and does not deliver mail. |

`TEST_DATABASE_URL`, `VERIFY_DATABASE_URL`, test credentials and `.env` files
must never be deployed to a shared environment. Do not print `DATABASE_URL` or
`JWT_SECRET` in build logs or evidence.

### 2.3. Web environment

`NEXT_PUBLIC_API_BASE_URL` is **compiled into the Next.js bundle at build
time**. Changing the API origin requires rebuilding Admin and Customer; changing
it only at runtime has no effect. `NEXT_PUBLIC_TRACE_BASE_URL` is optional and
must be a public HTTPS origin when QR labels are printed.

### 2.4. Database and backup prerequisites

- A dedicated migration account with schema DDL rights. The application account
  should have DML rights only.
- A fresh logical backup of the target schema, checksum-verified, before any
  migration. Follow `docs/BACKUP-RESTORE-RUNBOOK.md`.
- A tested restore of that backup into an isolated `*_restore`/`*_drill` schema.
  A dump that was never restored is not a verified backup.
- Enough disk for the backup, the restored copy and the migration's temporary
  structures.
- A maintenance window and an incident commander for production.

---

## 3. Release gate (local, before any deployment)

Run the full gate on the exact candidate tree:

```powershell
$env:DATABASE_URL = '<application URL>'
npm run verify:local
```

The gate performs, in order:

1. preflight (isolation, tools, MySQL, migration count, Playwright availability);
2. Prisma client generation;
3. typecheck and lint for every workspace;
4. unit/component tests for API, Admin, Customer, Mobile and Shared;
5. production builds for API, Admin and Customer;
6. creation of a disposable schema, all 14 migrations, demo seed and ward import;
7. migration ledger, file checksums, shadow-schema drift, C-08/C-14 schema assertions;
8. read-only database invariant audit (including trace coverage);
9. backup + restore drill into another disposable schema;
10. full API E2E suite;
11. concurrency stress (`CONCURRENCY_ROUNDS=10` by default);
12. business HTTP smoke (RBAC, catalog/trace, cart/checkout/COD, cancellation, Mobile API);
13. final invariants;
14. security guardrails, secret scan and dependency audit;
15. built Admin/Customer route and asset smoke;
16. schema cleanup.

A release candidate is deployable only when `summary.json` says `PASS`, has zero
failed/skipped steps, and the disposable schema was dropped. Preserve the
evidence directory; it is the release record. Do not use an earlier failed run
as evidence.

Useful focused commands (the database-focused commands refuse a non-test schema):

```powershell
npm run verify:migrations -- --url <isolated-test-url>
npm run verify:invariants -- --url <isolated-test-url>
npm run verify:backup -- --url <isolated-test-url>
npm run verify:business -- --url <isolated-test-url>
npm run verify:ui -- --url <isolated-test-url>
npm run verify:security
```

---

## 4. Migration rehearsal (isolated only)

Never rehearse on the application schema. Use a disposable name ending in
`_test`, `_restore` or `_drill`.

### 4.1. Fresh-schema rehearsal

```powershell
$env:MYSQL_PWD = '<migration password>'
mysql -h 127.0.0.1 -u <user> -e "CREATE DATABASE agrimarket_v2_rehearsal_20261024_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Dedicated rehearsal shell: DATABASE_URL points at the disposable schema only
$env:DATABASE_URL = 'mysql://<user>:<password>@127.0.0.1:3306/agrimarket_v2_rehearsal_20261024_test'
npm run db:deploy --workspace @agrimarket/api
```

In a separate shell where `DATABASE_URL` still names the application schema:

```powershell
npm run verify:migrations -- --url 'mysql://<user>:<password>@127.0.0.1:3306/agrimarket_v2_rehearsal_20261024_test'
```

Expected: 14 migrations applied, all file checksums match the ledger, drift
check exits 0, and the C-08/C-14 tables, enum, decimal and index assertions pass.

### 4.2. Restore-then-upgrade rehearsal (required for an existing production schema)

A fresh-schema run does not prove that an existing schema upgrades cleanly.

1. Take a fresh production backup and verify its SHA-256 sidecar.
2. Restore it into `agrimarket_v2_restore_<date>_drill` with
   `scripts/restore-db.mjs`.
3. Run `npm run verify:invariants -- --url <restored-schema-url>` to capture the
   pre-migration baseline.
4. In a dedicated rehearsal shell, point `DATABASE_URL` at the restored schema and
   run `npm run db:deploy --workspace @agrimarket/api`.
5. Run `verify:migrations -- --url <restored-schema-url>` and
   `verify:invariants -- --url <restored-schema-url>` again.
6. Record migration duration, row counts per table, and any drift.
7. Drop the drill schema only after evidence is captured.

The automated backup step in `verify:local` already proves dump integrity,
restore fidelity (all 56 tables and 464 rows in the final C-19 run), migration
ledger replay and a Prisma read smoke. It does **not** measure production
migration duration or locking.

### 4.3. Migration rules

- Migrations are forward-only. There are no down migrations; Prisma does not
  provide a production rollback.
- Apply with `prisma migrate deploy`, never `migrate dev` or `migrate reset`.
- Never edit an already-applied migration file. The checksum ledger will fail
  and the next deployment becomes ambiguous.
- Current C-08/C-14 migrations are additive (new enum, table, columns, indexes),
  so the previous application build can usually keep running during a short
  expand/contract window. Do not rely on that without checking the specific
  migration.
- `db:seed` deletes and recreates demo data. It is for local/demo schemas only.

---

## 5. Deployment procedure

### 5.1. Pre-deployment

1. Confirm the release gate result and record the evidence path.
2. Record the candidate commit, branch, lockfile hash, Node/npm versions and
   build-time `NEXT_PUBLIC_API_BASE_URL`.
3. Confirm the change window and the named owner/incident commander.
4. Take and verify a fresh backup of the target schema.
5. Confirm a restore drill exists for that backup.
6. Check unresolved C-08 recoveries:

```sql
SELECT id, partner_id, adjustment_id, amount, status
FROM settlement_recoveries
WHERE status IN ('PENDING_APPROVAL', 'APPROVED');
```

Any row means payouts may be blocked for that partner. Resolve it through the
Admin recovery workflow (approve/reject/record), not by editing rows.

7. Announce the maintenance window and stop new writes if the migration can lock
   large tables. The current additive migrations are expected to be short, but
   that is environment-dependent.

### 5.2. Apply

```powershell
# From the release artifact, with the production DATABASE_URL already configured
npm run db:deploy --workspace @agrimarket/api
```

Then verify immediately with a read-only SQL client:

```powershell
mysql -h 127.0.0.1 -u <read-only-user> -p <database> -e "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"
```

Compare the applied migration names and checksums with
`apps/api/prisma/migrations`. `verify-migrations.mjs` intentionally refuses the
application `DATABASE_URL`, so do not point it at production.

### 5.3. Start the applications

```powershell
npm run start:prod --workspace @agrimarket/api
npm run start --workspace @agrimarket/admin-web
npm run start --workspace @agrimarket/customer-web
```

Start the API first, wait for a successful Nest bootstrap, then the web apps.
Set `NEXT_PUBLIC_API_BASE_URL` at build time, not only in the runtime shell.

### 5.4. Post-deployment smoke (minimum)

- API `/api/v1` responds; Swagger `/docs` is reachable in non-production.
- Admin login and one RBAC denial (customer token must not reach Admin APIs).
- Customer login, product list, product detail and trace page.
- Cart -> checkout preview -> COD order -> order detail.
- Admin sees the same order (Admin/Customer sync).
- Shipment/COD state transition on a disposable order.
- Inventory balance and reservation unchanged in an unexpected way.
- One return/refund read path and one settlement read path.
- Season/farm/harvest read path and a trace audit that reports, rather than
  fabricates, any gap.
- Mobile API compatibility: the 45 mobile routes are present in the OpenAPI
  document.

`npm run verify:business` covers most of this on an isolated schema; it is not a
production write test. Production smoke should be read-only except for an
explicitly approved disposable order.

### 5.5. Close

Record: migration start/end, backup checksum, smoke results, unresolved
recoveries, rollback decision, operator and owner approval. Keep the previous
artifacts and backup until the change is accepted.

---

## 6. Rollback

### 6.1. Choose the least destructive option

| Situation | Action |
| --- | --- |
| New UI/API is broken, schema is compatible | Roll back the application artifact only. Keep the migrated schema. |
| Migration failed before completion | Stop the API, inspect `_prisma_migrations`, do not edit the ledger blindly; restore the pre-deployment backup into a new schema or apply an owner-approved forward fix. |
| Migration succeeded but behavior is wrong | Prefer a forward fix. Rolling back the schema risks data loss and settlement history. |
| Data corruption or an invalid payout/settlement | Freeze payouts and writes, declare an incident, restore the verified backup into a new schema, reconcile post-backup transactions, then cut over with approval. |
| Security incident | Isolate the service, rotate secrets, preserve logs, follow the security incident process; do not "clean" evidence. |

### 6.2. Application-only rollback

1. Stop the new API and web processes.
2. Deploy the previous tested artifacts (same commit/tag and lockfile).
3. Keep the database migrated. Verify the old build tolerates the additive
   C-08/C-14 tables and columns.
4. Run login/RBAC, catalog/trace, order read, settlement read and Mobile API
   smoke.
5. Keep payouts disabled if any recovery is unresolved or if the old build does
   not understand `settlement_recoveries`.

Rolling back code does **not** undo money already recorded. Never delete
settlement recovery rows, adjustments, payouts or ledger entries to make a
rollback look clean.

### 6.3. Database restore rollback (last resort)

1. Declare an incident and name the commander. Freeze writes and payouts.
2. Select the newest verified backup. Record the expected data loss (RPO is up
   to 24 hours; PITR is not implemented).
3. Restore into a **new** schema, never over the live one first. Verify all
   table counts/checksums, the migration ledger and a Prisma read smoke.
4. Reconcile orders, payments, refunds, inventory movements and settlements
   created after the dump. These need an owner-approved manual process; do not
   silently recreate money.
5. Obtain written owner approval, then cut the application over during the
   maintenance window.
6. Keep the old schema read-only until the incident closes. Record actual RTO,
   data loss and every command.

### 6.4. C-08 recovery and payout precautions

- `DEDUCT_NEXT` creates a `PENDING_APPROVAL` recovery; it is **not** a debit.
- Approval alone still blocks payouts partner-wide until the recovery is
  `RECORDED` (with a real bank/offset reference) or `REJECTED`.
- Confirming a settlement is blocked while an adjustment is `OPEN` or a recovery
  is unresolved.
- A rollback must not bypass these guards. If the previous build lacks them,
  payouts stay disabled until the current build is restored or an owner-approved
  manual control is in place.
- Historical settlements and recovery decisions are never rewritten. Corrections
  are new adjustments/recovery rows with an audit trail.

### 6.5. C-14 trace data precautions

- Seasons, farming events, harvests and trace events are human-authored. A
  deployment or rollback must not backfill missing events to make a trace look
  complete.
- The trace audit reports missing links. If a restore loses C-14 rows, report the
  gap and re-enter verified data with its original evidence; never fabricate
  dates, quantities or certifications.
- Harvest quantities are validated against allocated lots. A partial restore
  can break that ceiling; run the invariant audit before reopening writes.

---

## 7. Verification after rollback

Run, at minimum:

```powershell
npm run verify:security
npm run verify:invariants -- --url <restored-or-isolated-url>
npm run verify:business -- --url <isolated-url>
npm run verify:ui -- --url <isolated-url>
```

Then manually confirm on the rolled-back environment: login/RBAC, products and
trace, cart/buy-now/checkout, orders, shipment, COD, inventory,
quarantine/QC, return/refund, settlement/payout, harvest/farming,
Admin-Customer sync and Mobile API compatibility. Record PASS/FAIL per area.

---

## 8. Known limitations

- No staging/production deployment or rollback has been executed. This runbook
  is a procedure, not evidence of a production cutover.
- No GitHub Actions or remote CI. The only automated gate is local.
- No PITR/binlog shipping. Logical backups give an RPO of up to 24 hours.
- No scheduled backup, offsite replication, encryption or alerting is
  implemented by this repository.
- Playwright is not installed, so the UI gate is HTTP-level route/asset smoke,
  not browser interaction. Login, table and checkout clicks are covered by
  API/business smoke and component tests, not a real browser.
- No Expo native/APK build was performed. Five high-severity Expo build-tooling
  advisories are accepted because they have no runtime bundle path and no patched
  Expo SDK release; this must be re-reviewed when a patched SDK is available.
- `npm dedupe` was used while resolving the multer override. Mobile typecheck,
  lint and unit tests pass, but the native bundle was not rebuilt.
- Production credentials, SMTP delivery, image storage, MySQL grants and server
  configuration are environment responsibilities and are **NOT VERIFIED** here.
