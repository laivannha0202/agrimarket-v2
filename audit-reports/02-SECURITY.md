# 02 — SECURITY AUDIT

> Repo `Xay-dung-nen-tang-ban-nong-san-tich-hop-truy-xuat-nguon-goc` · branch `main` ·
> commit `90c28de8f773af2b266b96979f9508155e9523fe` · 2026-10-18 · read-only.

## Summary

The security foundation is deliberately conservative and, in the parts verified, correctly
implemented: default-deny guards with role checks on every admin mutation, strong auth
internals (bcrypt, throttling, anti-enumeration, single-use hashed reset tokens, password-version
token invalidation), strict input validation, fail-closed CORS, private evidence serving, and
validated uploads. **No exploitable vulnerability with a plausible attack path was found.**
The findings below are hardening items; the notable one is a fail-open default that could become a
full compromise in a careless production deployment (SEC-01).

| ID | Severity | Class | One-liner |
|---|---|---|---|
| SEC-01 | P2 | SECURITY RISK | `JWT_SECRET` silently defaults to `CHANGE_ME`; no production boot guard |
| SEC-02 | P3 | IMPROVEMENT | No security headers (helmet); Swagger `/docs` always public |
| SEC-03 | P3 | IMPROVEMENT | Rate limiting only on `/auth/*`; no global throttle |
| SEC-04 | P3 | IMPROVEMENT | Admin-web export downloads don't trigger the global 401 handler |
| SEC-05 | P3 | IMPROVEMENT | JWTs in `localStorage` with 7-day default expiry; no CSP in web apps |
| SEC-06 | P3 | HYGIENE | Local DB dump files (`backups/*.sql`) and a broken `node_modules` copy on disk |

---

## SEC-01 — JWT secret fails open to a public constant (P2, SECURITY RISK)

- **Module**: API config/auth · **Affects**: Admin + Customer (server-side)
- **Evidence**: `apps/api/src/config/configuration.ts:24` (`jwtSecret: process.env.JWT_SECRET ?? 'CHANGE_ME'`),
  `apps/api/src/auth/jwt.strategy.ts:32`, `apps/api/src/auth/auth.module.ts:23` (same fallback).
  `apps/api/.env.example` ships `JWT_SECRET="CHANGE_ME"` as the template default.
- **Cause**: no boot-time validation that `JWT_SECRET` is present and non-default.
- **Actual vs expected**: actual — if a production deployment copies the template or forgets the
  variable, every token is signed with the publicly known string `CHANGE_ME`; anyone can forge an
  ADMIN JWT (`sub`, `role`, `passwordVersion` are the claims). Expected — production must refuse
  to start with a missing/default secret.
- **Repro (read-only)**: `grep -n "CHANGE_ME" apps/api/src` → 3 hits; unset `JWT_SECRET` and start
  the API: it boots normally (verified by code path; not executed against production).
- **Impact**: total authentication bypass (token forgery) in a misconfigured deployment.
- **Fix**: in `configuration.ts` (or a `validate` hook for `ConfigModule.forRoot`), throw when
  `NODE_ENV=production` and (`JWT_SECRET` unset or equal to `CHANGE_ME` or shorter than ~32 chars).
  Document rotation procedure. **Tests**: unit test for the validator (prod+default → throw;
  prod+strong secret → pass). **Confidence**: high.

## SEC-02 — No security headers; Swagger exposed in every environment (P3, IMPROVEMENT)

- **Evidence**: `apps/api/src/main.ts:23-60` — no `helmet`; `main.ts:62-72` mounts Swagger at
  `/docs` unconditionally. Web apps have no `Content-Security-Policy` config found.
- **Impact**: API responses lack `X-Content-Type-Options`, `X-Frame-Options` etc.; `/docs`
  discloses the full endpoint/DTO surface in production.
- **Fix**: `app.use(helmet())`; gate Swagger behind `NODE_ENV !== 'production'` or an env flag;
  add CSP/`X-Frame-Options` headers in the two Next apps. **Confidence**: high.

## SEC-03 — Throttling limited to auth endpoints (P3, IMPROVEMENT)

- **Evidence**: `apps/api/src/auth/auth-throttler.guard.ts` applied to `auth.controller.ts`;
  `app.module.ts` registers no `ThrottlerModule`, so other endpoints are unthrottled. Auth
  limiter keys on IP + identifier (verified earlier in `auth.controller.ts` / guard).
- **Impact**: credential-stuffing on `/auth/login` is mitigated; other endpoints (e.g. search,
  checkout, evidence enumeration) can be hammered. Ownership checks make data theft unlikely;
  this is a DoS/abuse surface mainly.
- **Fix**: global IP throttle with per-route overrides for checkout/login. **Confidence**: high.

## SEC-04 — Admin export downloads miss the global 401 handler (P3, IMPROVEMENT)

- **Evidence**: `apps/admin-web/src/lib/api/client.ts:197-204` (`api.download`) does not dispatch
  `agri:unauthorized` (dispatched by `apiFetch` at `:148-150` and `upload` at `:251-253`;
  handled in `auth-provider.tsx:80-91`).
- **Impact**: with an expired token, an export shows an error toast but the app does not bounce to
  login; the user may keep using a dead session until the next normal API call.
- **Fix**: dispatch the same event from `api.download` on 401. Add a client unit test.
  **Confidence**: high (static; subagent-verified).

## SEC-05 — Tokens in localStorage, 7-day expiry, no CSP (P3, IMPROVEMENT, accepted trade-off)

- **Evidence**: `apps/admin-web/src/lib/auth/session.ts:12-13`,
  `apps/customer-web/src/lib/auth/session.ts:17-18` (localStorage);
  `configuration.ts:25` (`JWT_EXPIRES_IN` default `7d`).
- **Impact**: any XSS in either app can exfiltrate a 7-day bearer token; there is no server-side
  revocation list (password change invalidates via `passwordVersion`, verified). The apps render
  user content strictly as text and sanitize error messages, and no XSS sink was found — this is a
  defence-in-depth gap, not an active vulnerability.
- **Fix (choose per risk appetite)**: httpOnly cookie session for admin-web; shorter access token +
  refresh; CSP. **Confidence**: high.

## SEC-06 — Sensitive local artifacts on disk (P3, HYGIENE)

- **Evidence**: repo-root `backups/` contains 7 SQL dumps (`agrimarket_v2-dev-*.sql`,
  `*-pre-seedcheck-*.sql`, dated 2026-10-09…10-16) with real dev data (password hashes, PII);
  `node_modules_pnpm_broken/` is a stale broken dependency copy. `git check-ignore` confirms
  `backups`, `.tmp-verify`, `.kilo`, `node_modules_pnpm_broken` are ignored and **not committed**
  (`git ls-files backups` → 0 files — verified).
- **Impact**: none to the repository; risk is environmental (the folder is zipped/shared → dumps
  travel). Dumps also contain `password_reset_token` hashes and evidence paths.
- **Fix**: move dumps outside the repo tree or encrypt them; delete `node_modules_pnpm_broken`;
  document the backup policy (see PRD-06). **Confidence**: high.

---

## Verified strong controls (no findings)

| Area | Evidence |
|---|---|
| **Default-deny authZ** | `app.module.ts:72-75` global `JwtAuthGuard`+`RolesGuard`; every controller audited: all mutations carry `@Roles('ADMIN')` or customer-scoped service checks (matrix below) |
| **Anti-enumeration** | `forgot-password` responds identically for existing/unknown emails; reset tokens single-use, hashed at rest, TTL `auth.service.ts` (read in earlier pass) |
| **Password handling** | bcrypt hashing; `PATCH /auth/change-password` bumps `passwordVersion` invalidating all existing JWTs (`password-version.ts`); password never logged |
| **Throttling** | auth guard keys by IP + identifier, applies to login/forgot/reset (`auth-throttler.guard.ts`) |
| **Validation** | global `ValidationPipe { whitelist, forbidNonWhitelisted, transform }` (`main.ts:32-39`) |
| **Error hygiene** | `AllExceptionsFilter` strips Prisma/SQL internals (`common/filters/all-exceptions.filter.ts`) |
| **CORS** | exact-origin list, `credentials:false`, fail-closed to dev origins when unset; never `*` (`main.ts:42-60`) |
| **Secrets not committed** | only `apps/api/.env.example` is tracked (`git ls-files`); `.env` ignored (`apps/api/.gitignore`) |
| **Evidence privacy** | per-owner policy; public serving only for product images; orphan evidence unreachable + swept (`evidence-sweep.service.ts`) |
| **Uploads** | size + extension + magic-byte + sharp re-encode (strips payloads); UUID filenames, no traversal (`product-images.service.ts:70-131,295-314`) |
| **IDOR checks** | returns/complaints/orders/reviews all verify ownership (`returns.service.ts:64-75`, `complaints.service.ts:17-41`, `orders.service.ts` findOneForCustomer, `reviews.service.ts:96,210`); addresses looked up by `(id, customerId)` (`users.service.ts:155-157,285-294`) |
| **Traceability gating** | public trace endpoint exposes only `isPublic` events and validity-gated certificates (`traceability.service.ts`, verified earlier) |
| **Rate/DoS on exports** | exports are admin-only, paginated upstream; no unbounded query found in reports/export services |

### Authorisation matrix (per controller: role-decorated methods / public methods)

```
auth(0/4) · carts(5/0) · categories(2/2) · certificates(2/3) · complaints(6/0) · evidence(1/2)
farms(2/2) · finance(11/0) · harvests(2/2) · health(0/1) · inventory(6/0) · warehouse-documents(6/0)
locations(0/4) · lots(2/2) · orders(8/0) · partners(2/2) · payments(6/0) · product-images(1/0)
products(4/2) · promotions(6/3) · quality-control(1/2) · reports(1/0) · returns(7/0) · reviews(5/1)
farming-events(1/1) · seasons(2/2) · shipments(4/0) · traceability(0/1) · users(11/0) · warehouses(2/2)
```

Every non-public mutation was spot-read; admin mutations use `@Roles('ADMIN')` and customer
mutations resolve the resource through the caller's id. No unprotected admin operation found.

## No P0/P1 security findings

No path was found to (a) read/modify another customer's data, (b) invoke an admin operation
without the ADMIN role, (c) inject SQL (Prisma + tagged raw SQL with parameters), (d) execute a
stored payload through uploads, or (e) bypass auth. The single high-consequence item (SEC-01)
requires a misconfigured deployment and is therefore P2, not P1.
