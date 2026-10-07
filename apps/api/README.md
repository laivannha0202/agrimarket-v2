# @agrimarket/api

AgriMarket V2 backend — a NestJS + Prisma + MySQL 8.4 API for a multi-partner
agricultural marketplace with full origin traceability.

- Framework: NestJS 12 (ESM, Node 24)
- Database: MySQL 8.4 (utf8mb4) via Prisma 7 + `@prisma/adapter-mariadb`
- Tests: Vitest 4 (unit business rules + HTTP e2e)
- Docs: Swagger UI at `/docs`

All API routes are served under the `/api/v1` prefix. See `docs/API.md`,
`docs/DATABASE.md` and `docs/BUSINESS-RULES.md` at the repository root for the
full reference.

## Requirements

- Node.js >= 20 (developed on 24.x)
- pnpm 12
- A reachable MySQL 8.4 instance

## Setup

```bash
# from the repository root
pnpm install

# 1. Create the databases (needs a privileged MySQL user)
mysql -u <user> -p < scripts/sql/create-databases.sql

# 2. Configure environment
cp apps/api/.env.example apps/api/.env
#   then set DATABASE_URL, TEST_DATABASE_URL and a strong JWT_SECRET

# 3. Generate the Prisma client, apply the migration and load demo data
pnpm --filter @agrimarket/api db:generate
pnpm --filter @agrimarket/api db:deploy
pnpm --filter @agrimarket/api db:seed
```

`db:deploy` applies the committed migration in `prisma/migrations/` without
prompting; use `db:migrate` during local schema development.

## Run

```bash
pnpm --filter @agrimarket/api dev     # watch mode
pnpm --filter @agrimarket/api start   # one-off
```

The server listens on `PORT` (default `3000`):

- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/docs` (click **Authorize** and paste a
  Bearer token from `POST /api/v1/auth/login`)

## Tests

```bash
pnpm --filter @agrimarket/api test        # unit / business rules (no DB needed)
pnpm --filter @agrimarket/api typecheck
pnpm --filter @agrimarket/api lint
pnpm --filter @agrimarket/api test:e2e    # HTTP e2e; needs TEST_DATABASE_URL
```

The e2e suite is skipped automatically when `TEST_DATABASE_URL` is unset, so it
never touches the development database and never hardcodes credentials. When
configured, it runs against that dedicated test database only.

## Demo accounts (after seeding)

| Role     | Email                          | Password      |
| -------- | ------------------------------ | ------------- |
| Admin    | `admin@agrimarket.vn`          | `Admin@12345` |
| Customer | `lan.nguyen@agrimarket.vn`     | `Agri@12345`  |

The seed prints a public traceability URL, e.g.
`GET /api/v1/trace/TRC-000001-CACHU`, on completion.
