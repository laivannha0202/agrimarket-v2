# API QA / forensic scripts

One-off, **read-only** scripts kept as evidence for earlier audit rounds. They are
not part of the build, the test suite or the verification gate.

Every script here only runs `SELECT`s against the database named by
`apps/api/.env` (`DATABASE_URL`), except `run-e2e.cmd`, which runs the e2e suite
against `TEST_DATABASE_URL`.

Run them **from `apps/api`** — they resolve `./generated/prisma/client.ts` and
`.env` relative to that directory:

```bash
cd apps/api
npx tsx qa/qa-db-peek.mjs        # real ids/codes for a browser audit
npx tsx qa/qa-audit-final.mjs    # final business audit (round 24)
npx tsx qa/qa-a1-a2-audit.mjs    # lot-balance / missing-OUTBOUND forensic
npx tsx qa/qa-order40-trace.mjs  # deep trace of order #40
```

| Script | Purpose |
|---|---|
| `qa-a1-a2-audit.mjs` | Lot balance drift (A1) and missing OUTBOUND movements (A2) |
| `qa-addr.mjs` | Address/ward shape probe |
| `qa-audit-final.mjs` | Final business audit snapshot |
| `qa-db-conn-probe.mjs` | MariaDB adapter connectivity probe (`allowPublicKeyRetrieval`) |
| `qa-db-peek.mjs` | Reads real ids/codes so a manual audit never invents them |
| `qa-fs-seasons.mjs` | Flash-sale / season mapping dump |
| `qa-order40-audit.mjs` | Audit trail touching order #40 / payment #39 |
| `qa-order40-pay.mjs` | Payment/return trail for orders #14, #15, #18, #40 |
| `qa-order40-trace.mjs` | Full trace of order #40 |
| `run-e2e.cmd` | Runs the API e2e suite into `.tmp-verify/e2e-full.txt` |

Nothing here should be extended for new work: a check that must keep passing
belongs in `apps/api/test` (unit/e2e) or `scripts/db-invariant-audit.mjs`
(invariants).
