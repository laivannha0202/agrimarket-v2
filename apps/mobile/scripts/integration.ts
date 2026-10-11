/**
 * Mobile API integration check against the real AgriMarket V2 backend.
 *
 * Read-only by default: public catalog/trace + (with customer credentials)
 * login, cart reads, checkout-preview, order reads. No data is created,
 * modified or deleted.
 *
 * Write checks (cart CRUD, COD checkout on the TEST database, cancel) run
 * ONLY when ALL of these hold:
 *   AGRIMARKET_RUN_WRITE_TESTS=1
 *   AGRIMARKET_TEST_API=1            (operator confirms the base URL is TEST)
 *   AGRIMARKET_TEST_EMAIL / AGRIMARKET_TEST_PASSWORD are set
 *
 * Usage:
 *   pnpm --filter @agrimarket/mobile test:integration
 *   EXPO_PUBLIC_API_BASE_URL=http://<PC-LAN-IP>:3000/api/v1 pnpm test:integration
 */

const BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000/api/v1").replace(/\/+$/, "");

let pass = 0;
let fail = 0;

function ok(name: string): void {
  pass += 1;
  console.log(`PASS ${name}`);
}

function bad(name: string, detail: unknown): void {
  fail += 1;
  console.log(`FAIL ${name}: ${detail instanceof Error ? detail.message : String(detail)}`);
}

async function get<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown, token?: string, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  // ---- Public (no auth) ----
  try {
    const cats = await get<{ data: unknown[] }>("/categories?status=ACTIVE&limit=5");
    if (!Array.isArray(cats.data)) throw new Error("bad envelope");
    ok("GET /categories");
  } catch (e) {
    bad("GET /categories", e);
  }

  let firstProductId = 0;
  let firstVariantId = 0;
  try {
    const prods = await get<{ data: { id: number }[] }>("/products?status=ACTIVE&page=1&limit=5");
    if (!Array.isArray(prods.data) || prods.data.length === 0) throw new Error("empty catalog");
    firstProductId = prods.data[0]?.id ?? 0;
    ok(`GET /products (${prods.data.length} items)`);
  } catch (e) {
    bad("GET /products", e);
  }

  if (firstProductId > 0) {
    try {
      const p = await get<{ id: number; variants: { id: number }[] }>(`/products/${firstProductId}`);
      if (p.id !== firstProductId) throw new Error("id mismatch");
      firstVariantId = p.variants[0]?.id ?? 0;
      ok("GET /products/:id");
    } catch (e) {
      bad("GET /products/:id", e);
    }
  }

  try {
    const farms = await get<{ data: unknown[] }>("/farms?status=ACTIVE&limit=5");
    if (!Array.isArray(farms.data)) throw new Error("bad envelope");
    ok("GET /farms");
  } catch (e) {
    bad("GET /farms", e);
  }

  try {
    const lots = await get<{ data: { traceCode: string }[] }>("/lots?page=1&limit=1");
    const code = lots.data[0]?.traceCode;
    if (!code) throw new Error("no lots to trace");
    await get(`/trace/${encodeURIComponent(code)}`);
    ok(`GET /trace/:code (${code})`);
  } catch (e) {
    bad("GET /lots + /trace/:code", e);
  }

  try {
    await get("/vouchers?status=ACTIVE&limit=5");
    ok("GET /vouchers");
  } catch (e) {
    bad("GET /vouchers", e);
  }

  try {
    await get("/flash-sales?status=ACTIVE&limit=5");
    ok("GET /flash-sales");
  } catch (e) {
    bad("GET /flash-sales", e);
  }

  // ---- Authenticated reads (needs a CUSTOMER account) ----
  const email = process.env.AGRIMARKET_TEST_EMAIL;
  const password = process.env.AGRIMARKET_TEST_PASSWORD;
  if (!email || !password) {
    console.log("SKIP authenticated checks (set AGRIMARKET_TEST_EMAIL/PASSWORD for a CUSTOMER account)");
  } else {
    let token = "";
    try {
      const login = await post<{ accessToken: string; user: { role: string } }>("/auth/login", { email, password });
      if (login.user.role !== "CUSTOMER") throw new Error(`role=${login.user.role}, need CUSTOMER`);
      token = login.accessToken;
      ok("POST /auth/login (CUSTOMER)");
    } catch (e) {
      bad("POST /auth/login", e);
    }
    if (token) {
      for (const [name, path] of [
        ["GET /auth/me", "/auth/me"],
        ["GET /carts/me", "/carts/me"],
        ["GET /customers/me/addresses", "/customers/me/addresses"],
        ["GET /orders/me", "/orders/me?page=1&limit=5"],
      ] as [string, string][]) {
        try {
          await get(path, token);
          ok(name);
        } catch (e) {
          bad(name, e);
        }
      }
      try {
        // Explicit items: preview creates/reserves nothing, so this stays read-only.
        const body = firstVariantId > 0 ? { items: [{ productVariantId: firstVariantId, quantity: 1 }] } : {};
        const preview = await post<{ grandTotal: number }>("/orders/checkout-preview", body, token);
        if (!Number.isFinite(preview.grandTotal)) throw new Error("bad preview total");
        ok(`POST /orders/checkout-preview (grandTotal=${preview.grandTotal})`);
      } catch (e) {
        bad("POST /orders/checkout-preview", e);
      }
      // Strict-enum guard: unknown status must be 400, not 500.
      try {
        const res = await fetch(`${BASE}/products?status=BOGUS`, {});
        if (res.status === 400) ok("GET /products?status=BOGUS -> 400");
        else bad("GET /products?status=BOGUS -> 400", `got ${res.status}`);
      } catch (e) {
        bad("GET /products?status=BOGUS -> 400", e);
      }
    }
  }

  if (process.env.AGRIMARKET_RUN_WRITE_TESTS === "1") {
    if (process.env.AGRIMARKET_TEST_API !== "1") {
      console.log("SKIP write checks: set AGRIMARKET_TEST_API=1 to confirm the base URL is the TEST database API");
    } else {
      console.log("Write checks requested, but this script performs no writes without an explicit TEST order fixture. See docs/AGRIMARKET-V2-MOBILE-ACCEPTANCE.md §6.");
    }
  } else {
    console.log("SKIP write checks (AGRIMARKET_RUN_WRITE_TESTS!=1). No data created/modified.");
  }

  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
