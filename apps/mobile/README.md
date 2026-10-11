# AgriMarket Mobile V2 (Expo Go)

Customer app for AgriMarket V2. Expo Managed + Expo Router + TypeScript,
run **only with Expo Go** (no native builds).
Backend API V2 is the single source of truth (price, stock, FEFO, voucher,
shipping fee, totals, order state).

## Requirements

- Node 20+, pnpm 12, Expo Go app on an Android phone.
- Phone + dev machine on the same Wi-Fi.
- Backend API V2 running (`pnpm dev:api` from the repo root, default port 3000).

## Configure the API address (once, single source)

```bash
cd apps/mobile
cp .env.example .env
```

Edit `.env` — use the **LAN address of this machine**, never `localhost`
(`localhost` on the phone is the phone itself):

```bash
EXPO_PUBLIC_API_BASE_URL=http://<PC-LAN-IP>:3000/api/v1
```

Find the current LAN IP on Windows with `ipconfig` (IPv4 Address on the Wi-Fi
adapter), then restart Expo. When the IP changes, only `.env` needs updating.
The base URL is read only in `src/lib/config.ts` from this variable; when it
is missing or `localhost`, the app shows a configuration notice instead of a
cryptic network error. `.env` is git-ignored (personal config).

Image URLs: stored image URLs that contain `localhost`/`127.0.0.1` are
rewritten to the configured API origin in `resolveImageUrl()` so Expo Go can
load them. For newly uploaded images, set `PUBLIC_API_BASE_URL` on the API
to the same LAN address.

## Run with Expo Go

```bash
pnpm dev:mobile
# or: cd apps/mobile && pnpm dev:lan
```

Scan the QR with **Expo Go** (Android). Prefer `--lan` (default); use
`pnpm dev:tunnel` only when LAN is blocked. (Note: `--tunnel` only tunnels
the Expo dev server — the API address above must still be the phone-reachable
LAN URL.)

No EAS Build, no prebuild, no APK/AAB — Expo Go only.

## Checks

```bash
pnpm --filter @agrimarket/mobile typecheck
pnpm --filter @agrimarket/mobile lint
pnpm --filter @agrimarket/mobile test
```

Integration against the real API (read-only by default):

```bash
pnpm --filter @agrimarket/mobile test:integration
AGRIMARKET_TEST_EMAIL=<customer> AGRIMARKET_TEST_PASSWORD=<pw> pnpm --filter @agrimarket/mobile test:integration
```

Write flow on the TEST instance only (never DEV):

```bash
# Terminal 1: TEST API on :3100 with the TEST database (do not disturb :3000 DEV)
cd apps/api
PORT=3100 DATABASE_URL="mysql://agrimarket:agrimarket_local@127.0.0.1:3306/agrimarket_v2_test" node dist/src/main.js

# Terminal 2: full COD buy → idempotency → 409 guards → admin cross-check →
# cancel → return/complaint/review → cleanup
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3100/api/v1 AGRIMARKET_TEST_API=1 \
  AGRIMARKET_TEST_EMAIL=<seed customer> AGRIMARKET_TEST_PASSWORD=<pw> \
  pnpm --filter @agrimarket/mobile test:write
```

## Scope notes (backend V2 is the contract)

- Auth: login/logout/me only. No public register endpoint exists, so the app
  has no signup screen (accounts are issued by AgriMarket). After login the
  app returns to the screen the customer came from (`redirect` param).
- No change-password endpoint exists → not implemented (documented, BLOCKED).
- No wishlist/favorites/loyalty endpoints exist → not implemented (BLOCKED).
- Payments: COD only. `VNPAY`/`MOCK_ONLINE` exist as enum values but there is
  no gateway flow, so the app never marks unpaid orders as paid.
- Checkout sends `expectedGrandTotal` from `checkout-preview` and one
  `Idempotency-Key` per payload signature; a 409 refreshes the preview and
  asks the customer to re-confirm. The button is disabled while submitting
  (no double-tap double orders).
- Catalog sort applies to the products already loaded (the backend
  `GET /products` has no sort parameter); the screen states this scope.
- QR scan accepts a bare `TRC-…` code, a trace-page URL path, or a URL query
  parameter carrying the code (`src/lib/trace-code.ts`); anything else shows
  an invalid-code message instead of navigating.
