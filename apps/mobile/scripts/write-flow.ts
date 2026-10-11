/**
 * Mobile write-flow against the real API on the TEST database.
 *
 * Runs ONLY when:
 *   AGRIMARKET_TEST_API=1   (operator confirms BASE is the TEST instance)
 *
 * Refuses to run against the DEV port (:3000) by default.
 * Flow: address CRUD → profile PATCH/restore → cart CRUD → preview →
 * COD checkout (expectedGrandTotal + Idempotency-Key) → idempotency replay →
 * 409 guards → admin cross-check → cancel → delivered-order guards →
 * return/complaint/review → voucher negative → cleanup.
 */

// Assertion style below (cond ? ok() : bad()) is intentional for this script.
/* eslint-disable no-unused-expressions */

const BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.AGRIMARKET_TEST_EMAIL ?? "";
const PASSWORD = process.env.AGRIMARKET_TEST_PASSWORD ?? "";
const ADMIN_EMAIL = process.env.AGRIMARKET_ADMIN_EMAIL ?? "admin@agrimarket.vn";
const ADMIN_PASSWORD = process.env.AGRIMARKET_ADMIN_PASSWORD ?? "Admin@12345";

let pass = 0;
let fail = 0;
function ok(name: string, extra = ""): void {
  pass += 1;
  console.log(`PASS ${name}${extra ? ` (${extra})` : ""}`);
}
function bad(name: string, detail: unknown): void {
  fail += 1;
  console.log(`FAIL ${name}: ${detail instanceof Error ? detail.message : String(detail)}`);
}

async function req<T>(method: string, path: string, body?: unknown, token?: string, headers?: Record<string, string>): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : undefined) as T;
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

async function main(): Promise<void> {
  if (process.env.AGRIMARKET_TEST_API !== "1") {
    console.log("REFUSED: set AGRIMARKET_TEST_API=1 to confirm the TEST instance.");
    process.exit(2);
  }
  if (!BASE) {
    console.log("REFUSED: EXPO_PUBLIC_API_BASE_URL is empty.");
    process.exit(2);
  }
  if (BASE.includes(":3000")) {
    console.log(`REFUSED: ${BASE} looks like DEV. Point at the TEST instance (:3100).`);
    process.exit(2);
  }
  if (!EMAIL || !PASSWORD) {
    console.log("REFUSED: set AGRIMARKET_TEST_EMAIL/PASSWORD (seed CUSTOMER).");
    process.exit(2);
  }
  console.log(`BASE=${BASE}`);

  // Login customer
  const login = await req<{ accessToken: string; user: { role: string; phone?: string | null } }>(
    "POST",
    "/auth/login",
    { email: EMAIL, password: PASSWORD },
  );
  if (login.status !== 200 || login.data.user?.role !== "CUSTOMER") {
    bad("login CUSTOMER", login.status);
    process.exit(1);
  }
  const token = login.data.accessToken;
  const originalPhone = login.data.user.phone ?? "";
  ok("login CUSTOMER");

  // Snapshot
  const beforeOrders = await req<{ meta: { total: number } }>("GET", "/orders/me?page=1&limit=1", undefined, token);
  const beforeTotal = beforeOrders.data.meta?.total ?? -1;

  // ---- Address CRUD ----
  const addr0 = await req<{ id: number; isDefault: boolean }[]>("GET", "/customers/me/addresses", undefined, token);
  const origDefault = addr0.data.find((a) => a.isDefault)?.id;
  const created = await req<{ id: number }>(
    "POST",
    "/customers/me/addresses",
    { recipientName: "TEST Mobile", phone: "0900000001", province: "Hưng Yên", detail: "Số 1 TEST, không giao thật" },
    token,
  );
  if (created.status !== 200 && created.status !== 201) bad("address create", created.status);
  else ok("address create", `id=${(created.data as { id: number }).id}`);
  const testAddrId = (created.data as { id: number }).id;
  const upd = await req("PATCH", `/customers/me/addresses/${testAddrId}`, { detail: "Số 2 TEST" }, token);
  upd.status === 200 ? ok("address update") : bad("address update", upd.status);
  const mkDef = await req("PATCH", `/customers/me/addresses/${testAddrId}/default`, undefined, token);
  mkDef.status === 200 ? ok("address set-default") : bad("address set-default", mkDef.status);
  if (origDefault) {
    const restore = await req("PATCH", `/customers/me/addresses/${origDefault}/default`, undefined, token);
    restore.status === 200 ? ok("address restore-default") : bad("address restore-default", restore.status);
  }
  const del = await req("DELETE", `/customers/me/addresses/${testAddrId}`, undefined, token);
  del.status === 200 ? ok("address delete") : bad("address delete", del.status);

  // ---- Profile PATCH + restore ----
  const patch = await req("PATCH", "/customers/me", { phone: "0900000002" }, token);
  patch.status === 200 ? ok("profile update") : bad("profile update", patch.status);
  const restoreProfile = await req("PATCH", "/customers/me", { phone: originalPhone || undefined }, token);
  restoreProfile.status === 200 ? ok("profile restore") : bad("profile restore", restoreProfile.status);

  // ---- Pick an in-stock variant ----
  const list = await req<{ data: { id: number }[] }>("GET", "/products?status=ACTIVE&page=1&limit=10");
  let variantId = 0;
  for (const p of list.data.data ?? []) {
    const d = await req<{ variants: { id: number; inStock: boolean; availableQuantity: number }[] }>(
      "GET",
      `/products/${p.id}`,
    );
    const v = d.data.variants?.find((x) => x.inStock && Number(x.availableQuantity) >= 5);
    if (v) {
      variantId = v.id;
      break;
    }
  }
  if (!variantId) {
    bad("find in-stock variant", "none with avail>=5");
    process.exit(1);
  }
  ok("find in-stock variant", `variant=${variantId}`);

  // ---- Cart CRUD ----
  const add = await req("POST", "/carts/me/items", { productVariantId: variantId, quantity: 2 }, token);
  add.status === 200 || add.status === 201 ? ok("cart add") : bad("cart add", add.status);
  const cart1 = await req<{ items: { id: number; quantity: string }[] }>("GET", "/carts/me", undefined, token);
  const line = cart1.data.items?.find((i) => Number(i.quantity) === 2);
  line ? ok("cart verify qty=2") : bad("cart verify qty=2", JSON.stringify(cart1.data.items));
  const updQ = line
    ? await req("PATCH", `/carts/me/items/${line.id}`, { quantity: 3 }, token)
    : { status: -1 };
  updQ.status === 200 ? ok("cart update qty=3") : bad("cart update qty=3", updQ.status);

  // ---- Preview + checkout ----
  const items = [{ productVariantId: variantId, quantity: 3 }];
  const prev = await req<{ grandTotal: number; shippingFee: number }>(
    "POST",
    "/orders/checkout-preview",
    { items },
    token,
  );
  if ((prev.status !== 200 && prev.status !== 201) || !Number.isFinite((prev.data as { grandTotal: number }).grandTotal)) {
    bad("checkout-preview", prev.status);
    process.exit(1);
  }
  const grandTotal = (prev.data as { grandTotal: number }).grandTotal;
  ok("checkout-preview", `grandTotal=${grandTotal}`);

  const addrList = await req<{ recipientName: string; phone: string; province: string; detail: string; district: string | null; ward: string | null }[]>(
    "GET",
    "/customers/me/addresses",
    undefined,
    token,
  );
  const ship = addrList.data[0];
  if (!ship) {
    bad("load shipping address", "empty address book");
    process.exit(1);
  }
  const payload = {
    shippingAddress: {
      recipientName: ship.recipientName,
      phone: ship.phone,
      province: ship.province,
      district: ship.district ?? undefined,
      ward: ship.ward ?? undefined,
      detail: ship.detail,
    },
    items,
    paymentMethod: "COD",
    note: "TEST mobile write-flow, không giao thật",
    expectedGrandTotal: grandTotal,
  };
  const KEY = `aaaaaaaa-bbbb-4ccc-8ddd-${Date.now().toString(16).padStart(12, "0")}`;
  const co1 = await req<{ id: number; code: string; grandTotal: string; status: string }>(
    "POST",
    "/orders/checkout",
    payload,
    token,
    { "Idempotency-Key": KEY },
  );
  if (co1.status !== 200 && co1.status !== 201) {
    bad("checkout COD", `${co1.status} ${JSON.stringify(co1.data).slice(0, 200)}`);
    process.exit(1);
  }
  const orderId = (co1.data as { id: number }).id;
  const orderCode = (co1.data as { code: string }).code;
  Number((co1.data as { grandTotal: string }).grandTotal) === grandTotal
    ? ok("checkout COD", `${orderCode} total=${grandTotal}`)
    : bad("checkout COD total", JSON.stringify(co1.data));

  // Idempotency replay: same key + same payload -> same order
  const replay = await req<{ id: number }>("POST", "/orders/checkout", payload, token, { "Idempotency-Key": KEY });
  (replay.status === 200 || replay.status === 201) && (replay.data as { id: number }).id === orderId
    ? ok("idempotency replay same order")
    : bad("idempotency replay", `${replay.status} ${JSON.stringify(replay.data).slice(0, 150)}`);

  // Same key + different payload -> 409
  const clash = await req(
    "POST",
    "/orders/checkout",
    { ...payload, note: "different" },
    token,
    { "Idempotency-Key": KEY },
  );
  clash.status === 409 ? ok("idempotency key reuse -> 409") : bad("idempotency key reuse -> 409", clash.status);

  // Wrong expectedGrandTotal -> 409, no order created
  const wrong = await req(
    "POST",
    "/orders/checkout",
    { ...payload, expectedGrandTotal: grandTotal + 1000 },
    token,
    { "Idempotency-Key": `bbbbbbbb-cccc-4ddd-8eee-${Date.now().toString(16).padStart(12, "0")}` },
  );
  wrong.status === 409 ? ok("wrong expectedGrandTotal -> 409") : bad("wrong expectedGrandTotal -> 409", wrong.status);

  // ---- Admin cross-check ----
  const adminLogin = await req<{ accessToken: string; user: { role: string } }>("POST", "/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (adminLogin.status === 200 && adminLogin.data.user?.role === "ADMIN") {
    const found = await req<{ data: { id: number; code: string }[] }>(
      "GET",
      `/orders?search=${encodeURIComponent(orderCode)}`,
      undefined,
      adminLogin.data.accessToken,
    );
    (found.data.data ?? []).some((o) => o.code === orderCode)
      ? ok("admin sees order (Mobile→API→DB→Admin)")
      : bad("admin sees order", JSON.stringify(found.data).slice(0, 150));
  } else {
    bad("admin login", adminLogin.status);
  }

  // ---- Cancel own order ----
  const cancel = await req<{ status: string }>("POST", `/orders/me/${orderId}/cancel`, undefined, token);
  (cancel.status === 200 || cancel.status === 201) && (cancel.data as { status: string }).status === "CANCELLED"
    ? ok("cancel order")
    : bad("cancel order", `${cancel.status} ${JSON.stringify(cancel.data).slice(0, 150)}`);
  const cancelAgain = await req("POST", `/orders/me/${orderId}/cancel`, undefined, token);
  cancelAgain.status >= 400 && cancelAgain.status < 500
    ? ok(`double-cancel rejected (${cancelAgain.status})`)
    : bad("double-cancel rejected", cancelAgain.status);

  // ---- Delivered order guards (order 12679 is pre-existing DELIVERED; read-only + negative cancel) ----
  const meOrders = await req<{ data: { id: number; status: string; code: string }[] }>(
    "GET",
    "/orders/me?page=1&limit=20",
    undefined,
    token,
  );
  const delivered = (meOrders.data.data ?? []).find((o) => o.status === "DELIVERED");
  if (!delivered) {
    console.log("SKIP delivered guards (no DELIVERED order)");
  } else {
    const cancelDel = await req("POST", `/orders/me/${delivered.id}/cancel`, undefined, token);
    cancelDel.status >= 400 && cancelDel.status < 500
      ? ok(`cancel DELIVERED rejected (${cancelDel.status})`)
      : bad("cancel DELIVERED rejected", cancelDel.status);
    const det = await req<{
      partnerOrders: { items: { id: number; quantity: string }[] }[];
    }>("GET", `/orders/me/${delivered.id}`, undefined, token);
    const firstItem = det.data.partnerOrders?.flatMap((p) => p.items)[0];

    if (firstItem) {
      // Return (residue stays on TEST by design — no delete endpoint)
      const ret = await req<{ id: number; status: string }>(
        "POST",
        "/returns",
        { orderItemId: firstItem.id, quantity: 1, reason: "TEST mobile write-flow" },
        token,
      );
      (ret.status === 200 || ret.status === 201)
        ? ok("return create", `id=${(ret.data as { id: number }).id}`)
        : bad("return create", `${ret.status} ${JSON.stringify(ret.data).slice(0, 150)}`);
      // Complaint (residue stays on TEST by design)
      const comp = await req<{ id: number; status: string }>(
        "POST",
        "/complaints",
        { orderId: delivered.id, type: "OTHER", content: "TEST mobile write-flow" },
        token,
      );
      (comp.status === 200 || comp.status === 201)
        ? ok("complaint create", `id=${(comp.data as { id: number }).id}`)
        : bad("complaint create", `${comp.status} ${JSON.stringify(comp.data).slice(0, 150)}`);
      // Review (may already exist from seed -> 400 counts as rule proven)
      const rev = await req("POST", "/reviews", { orderItemId: firstItem.id, rating: 5, content: "TEST" }, token);
      (rev.status === 200 || rev.status === 201)
        ? ok("review create")
        : rev.status === 400
          ? ok("review already-reviewed (rule proven)")
          : bad("review create", rev.status);
    }
  }

  // ---- Voucher negative ----
  // Unknown voucher: backend answers 404 "Voucher not found" (mobile shows the
  // translated message either way).
  const badPrev = await req("POST", "/orders/checkout-preview", { items, voucherCode: "NOPE123" }, token);
  badPrev.status === 400 || badPrev.status === 404
    ? ok(`invalid voucher rejected (${badPrev.status})`)
    : bad("invalid voucher rejected", badPrev.status);

  // ---- Cleanup ----
  const clear = await req("DELETE", "/carts/me", undefined, token);
  clear.status === 200 ? ok("cart cleared") : bad("cart cleared", clear.status);
  const afterOrders = await req<{ meta: { total: number } }>("GET", "/orders/me?page=1&limit=1", undefined, token);
  (afterOrders.data.meta?.total ?? -2) === beforeTotal + 1
    ? ok("orders delta = +1 (CANCELLED test order)")
    : bad("orders delta", `${beforeTotal} -> ${afterOrders.data.meta?.total}`);

  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
