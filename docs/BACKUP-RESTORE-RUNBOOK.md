# Backup and Restore Runbook — AgriMarket V2

Status: scripts and procedure added. **No restore drill has been claimed unless a
dated result is recorded in the Drill Log below.** A dump that has never been
restored is an unverified backup.

## 1. Scope and objectives

| Item | Current target | Notes |
| --- | --- | --- |
| Data covered | MySQL schema (`agrimarket_v2`) | Product images/uploads are **not** in the SQL dump. Back them up separately. |
| Backup type | Daily logical full dump (`mysqldump --single-transaction`), gzip + SHA-256 sidecar | Portable and simple; not point-in-time recovery. |
| RPO (maximum acceptable data loss) | **24 hours** | Requires a successful daily backup. A stricter RPO (for example 15 minutes) requires MySQL binlog shipping/PITR, a separate design and owner approval. |
| RTO (maximum acceptable downtime) | **4 hours** | Assumes a pre-provisioned MySQL server, an offsite dump already downloaded, and the restore steps below. |
| Retention | 30 daily dumps + 12 monthly dumps (recommended) | Final retention is a business/compliance decision. The script only prunes when `--keep-days` is supplied. |
| Encryption | Required before the dump leaves the host | The script produces **gzip, not encryption**. Encrypt with the organisation's approved tool (for example `age` or GPG) or rely on storage-level encryption with owner approval. |
| Offsite copy | Required | At least one copy outside the database host. Object storage should use encryption at rest, versioning/object lock and least-privilege access. |
| Restore verification | Daily backup checksum; monthly restore drill | Drill **must** use an isolated schema (`*_test`, `*_restore`, `*_drill`). |

**Business decisions still required:** final RPO/RTO, retention period,
offsite provider, encryption/key ownership, and whether binlog-based PITR is in
scope. Until those are approved, the values above are engineering defaults, not
a signed SLA.

## 2. Prerequisites

- MySQL 8 client tools (`mysqldump`, `mysql`) on the backup host. Set
  `MYSQLDUMP_PATH` / `MYSQL_PATH` when they are not on `PATH` (on Windows the
  default install is `C:\Program Files\MySQL\MySQL Server 8.0\bin`).
- A dedicated backup account with only the privileges needed by `mysqldump`
  (`SELECT`, `SHOW VIEW`, `TRIGGER`, `EVENT`, `LOCK TABLES`, `PROCESS` as
  required by the server version). Do not use the application account.
- Credentials supplied through the secret manager or a protected environment,
  never on the command line and never committed. The scripts read
  `BACKUP_DATABASE_URL` / `RESTORE_DATABASE_URL` and pass the password through
  `MYSQL_PWD`; they never print it.
- `backups/` is gitignored. Keep dumps out of Git and out of synced personal
  folders.

## 3. Daily backup

PowerShell:

```powershell
$env:BACKUP_DATABASE_URL = '<from secret manager>'
$env:MYSQLDUMP_PATH = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe'
npm run backup:db -- --out D:\backups\agrimarket --keep-days 30
```

Linux:

```bash
export BACKUP_DATABASE_URL='<from secret manager>'
npm run backup:db -- --out /var/backups/agrimarket --keep-days 30
```

The command writes:

- `<database>-<UTC timestamp>.sql.gz` — the dump, without `CREATE DATABASE`/`USE`,
  so it can be restored into a differently named drill schema;
- `<database>-<UTC timestamp>.sql.gz.json` — database, host, timestamp, size,
  SHA-256, tool version and `restoreVerified: false`.

Validate immediately:

```bash
gzip -t /var/backups/agrimarket/<dump>.sql.gz
sha256sum -c <(jq -r '"\(.sha256)  \(.file)"' <dump>.sql.gz.json)  # run in the dump directory
```

Then encrypt the dump and its sidecar, copy both offsite, and record the backup
result (date, size, checksum, destination, operator). A missing or failed daily
backup is an incident: investigate before the next RPO window.

## 4. Restore drill (isolated schema only)

Never restore into `agrimarket_v2`, staging or production as a drill. The
restore script refuses `NODE_ENV=production`, refuses the schema referenced by
`DATABASE_URL`, and requires the target name to end in `_test`, `_restore` or
`_drill`.

```powershell
$env:MYSQL_PATH = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$env:RESTORE_DATABASE_URL = 'mysql://backup_user:<password>@127.0.0.1:3306/agrimarket_v2_restore'
npm run restore:db -- --file D:\backups\agrimarket\<dump>.sql.gz --create-database --dry-run
$env:RESTORE_CONFIRM = 'RESTORE'
npm run restore:db -- --file D:\backups\agrimarket\<dump>.sql.gz --create-database
```

The dry run verifies that the dump exists and that its SHA-256 matches the
sidecar. The real restore streams the dump through `mysql`. Compare at minimum:

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM orders;
SELECT COUNT(*) FROM order_items;
SELECT COUNT(*) FROM payments;
SELECT COUNT(*) FROM refunds;
SELECT COUNT(*) FROM inventory_movements;
SELECT COUNT(*) FROM quarantine_cases;
SELECT COUNT(*) FROM _prisma_migrations;
```

Also run the application against the restored schema with writes disabled (or
on a separate API port), log in with a known test account, open an order and a
traceability page, and confirm totals/balances match the source snapshot. A row
count match alone is not acceptance.

Drop the drill schema only after evidence is captured:

```sql
DROP DATABASE agrimarket_v2_restore;
```

## 5. Production restore (incident only)

1. Declare an incident and name an incident commander. Freeze writes to the
   application (maintenance page / stop API) before restoring.
2. Choose the newest dump whose checksum and drill history are valid. Record the
   intended RPO loss (time between dump and incident).
3. Provision a **new** MySQL schema/server when possible, restore there, and
   verify with the checks above. Do not overwrite the live schema as the first
   step.
4. Obtain explicit owner approval for the cutover. Point the application at the
   verified schema during a maintenance window.
5. Re-enable writes, smoke-test login/order/payment/refund/settlement flows, and
   monitor errors. Keep the old schema read-only until the incident closes.
6. Record actual RTO, data loss, commands and approvals in the incident log.

`restore-db.mjs` is not a production cutover tool. Bypassing its test-name guard
requires `ALLOW_NON_TEST_RESTORE=YES` and an owner-approved change; even then,
the production restore is a separate, reviewed operation.

## 6. Limitations and open decisions

- Logical dumps are not point-in-time recovery. Binlog shipping/PITR is not
  implemented.
- Product images/uploads live on local disk or object storage and need their own
  backup job and restore test.
- Database users/grants and server configuration are not in the schema dump.
  Keep infrastructure configuration in version control or a documented runbook.
- A dump contains personal data. Encrypt it, restrict access, and follow the
  data-retention/deletion policy.
- The backup job itself is not scheduled by this repository. Scheduling,
  alerting (failed/missed backup), offsite replication and cost are deployment
  responsibilities and are **not verified** here.

## 7. Drill log

| Date | Dump | Target schema | Checksum | Row counts | App smoke | Result | Operator |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-23 | `agrimarket_v2_test-20261023T065534Z.sql.gz` (23,275 bytes) | `agrimarket_v2_restore` (isolated) | SHA-256 sidecar verified (`e0d5b066…146f77`) | 10 table counts and 9 table checksums matched source (users 6, orders 6, order_items 9, payments 6, refunds 0, inventory_movements 18, quarantine_cases 0, return_requests 1, shipments 6, migrations 12) | Prisma read-only smoke: counts, paid total 628,000 and latest order/payments read successfully | **PASS (drill only)** | Automated verification |

The drill above restored into a disposable schema and was dropped afterwards. It
proves that the dump can be read by MySQL and queried by the application's
Prisma client. It does **not** verify a production cutover, scheduled backup
execution, offsite copy, encryption or alerting; those remain deployment
responsibilities and are **NOT VERIFIED**.
