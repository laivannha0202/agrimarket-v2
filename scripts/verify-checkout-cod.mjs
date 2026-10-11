/**
 * End-to-end COD checkout verification against the running API.
 *
 * Proves the flow the user could not complete: login → cart → checkout-preview
 * → POST /orders/checkout (COD) → order detail → admin visibility, and the
 * guard rails around it (expectedGrandTotal 409, idempotency, voucher rules,
 * flash-sale pricing).
 *
 * READ-ONLY in intent: it creates ONE real order (which is the point — the user
 * could not create any), and cancels it afterwards to leave no residue.
 *
 * Usage: node scripts/verify-checkout-cod.mjs [--keep]
 */
import { writeFileSync } from "node:fs";

const API = process.env.API_BASE ?? "http://127.0.0.1:3000/api/v1";
const KEEP = process.argv.includes("--keep");

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const address = {
  recipientName: "Nguyễn Thị Lan",
  phone: "0912345601",
  province: "Hưng Yên",
  provinceCode: "33",
  detail: "Số 12, đường Nguyễn Văn Linh",
};

async function main() {
  console.log(`\n=== COD checkout verification against ${API}\n`);

  // ---------------------------------------------------------------- login --
  const login = await call("POST", "/auth/login", {
    body: { email: "lan.nguyen@agrimarket.vn", password: "Agri@12345" },
  });
  record("login as CUSTOMER", login.status === 200 && !!login.body?.accessToken, `HTTP ${login.status}`);
  if (login.status !== 200) throw new Error("cannot continue without a session");
  const token = login.body.accessToken;
  const customerId = login.body.user?.id;

  const adminLogin = await call("POST", "/auth/login", {
    body: { email: "admin@agrimarket.vn", password: "Admin@12345" },
  });
  const adminToken = adminLogin.status === 200 ? adminLogin.body.accessToken : null;
  record("login as ADMIN", adminToken !== null, `HTTP ${adminLogin.status}`);

  // A second customer is used later to price flash items the first customer may
  // have already maxed out, and to find a voucher with headroom.
  const otherLogin = await call("POST", "/auth/login", {
    body: { email: "hung.tran@agrimarket.vn", password: "Agri@12345" },
  });
  const otherToken = otherLogin.status === 200 ? otherLogin.body.accessToken : null;

  // ------------------------------------------------------- find a sellable --
  const products = await call("GET", "/products?limit=50&status=ACTIVE");
  const variants = (products.body?.data ?? []).flatMap((p) =>
    (p.variants ?? [])
      .filter((v) => v.status === "ACTIVE" && Number(v.availableQuantity) > 5)
      .map((v) => ({
        variantId: v.id,
        productName: p.name,
        variantName: v.name,
        basePrice: Number(v.basePrice),
        effective: Number(v.effectivePrice?.unitPrice ?? v.basePrice),
        source: v.effectivePrice?.source ?? "NONE",
        available: Number(v.availableQuantity),
      })),
  );
  record("found sellable variants", variants.length > 0, `${variants.length} variants with stock`);

  // A plain (non-flash) variant for the money-path test, so the assertions are
  // about checkout itself and not about promotion arithmetic.
  const plain = variants.find((v) => v.source === "NONE") ?? variants[0];

  // ------------------------------------------------------------- the cart --
  await call("DELETE", "/carts/me", { token });

  const add = await call("POST", "/carts/me/items", {
    token,
    body: { productVariantId: plain.variantId, quantity: 2 },
  });
  record("add 2 units to cart", add.status === 201 || add.status === 200, `HTTP ${add.status}`);

  const cart = await call("GET", "/carts/me", { token });
  const cartQty = Number(cart.body?.items?.[0]?.quantity ?? 0);
  record("cart reports the quantity that was added", cartQty === 2, `cart quantity = ${cartQty}`);

  // ---------------------------------------------------- checkout-preview --
  const preview = await call("POST", "/orders/checkout-preview", {
    token,
    body: { items: [{ productVariantId: plain.variantId, quantity: 2 }] },
  });
  const p = preview.body;
  record("checkout-preview returns totals", preview.status === 201 || preview.status === 200, `HTTP ${preview.status}`);
  const expectedGrand = Number(p?.grandTotal);
  record(
    "preview total = subtotal - discount + shipping",
    Math.abs(Number(p?.subtotal) - Number(p?.discountTotal) + Number(p?.shippingFee) - expectedGrand) < 0.01,
    `${p?.subtotal} - ${p?.discountTotal} + ${p?.shippingFee} = ${expectedGrand}`,
  );
  record("preview marks the line available", p?.items?.[0]?.available === true, `available=${p?.items?.[0]?.available}`);

  // ------------------------------------- THE ORDER: COD checkout must work --
  const idemKey = uuid();
  const checkout = await call("POST", "/orders/checkout", {
    token,
    headers: { "Idempotency-Key": idemKey },
    body: {
      shippingAddress: address,
      items: [{ productVariantId: plain.variantId, quantity: 2 }],
      paymentMethod: "COD",
      expectedGrandTotal: expectedGrand,
      note: "Xác minh luồng COD (tự động)",
    },
  });
  const order = checkout.body;
  record("POST /orders/checkout creates a COD order", checkout.status === 201 || checkout.status === 200, `HTTP ${checkout.status}`);
  if (!order?.id) {
    console.log("  response:", JSON.stringify(checkout.body).slice(0, 500));
  }
  record("order grandTotal matches the preview", Number(order?.grandTotal) === expectedGrand, `${order?.grandTotal} vs ${expectedGrand}`);

  // The create response does not embed relations, so the payment is read from
  // the order detail endpoint — the same one the app uses.
  const detailEarly = await call("GET", `/orders/me/${order.id}`, { token });
  const payments = detailEarly.body?.payments ?? [];
  const codPending = payments.some((pay) => pay.method === "COD" && pay.status === "PENDING");
  const codNotPaid = payments.every((pay) => pay.method !== "COD" || pay.paidAt === null);
  record("COD payment is PENDING, not PAID", codPending, JSON.stringify(payments.map((x) => `${x.method}:${x.status}`)));
  record("COD payment has no paidAt (money not collected)", codNotPaid, JSON.stringify(payments.map((x) => x.paidAt)));

  // ------------------------------------------------------------ replay --
  const replay = await call("POST", "/orders/checkout", {
    token,
    headers: { "Idempotency-Key": idemKey },
    body: {
      shippingAddress: address,
      items: [{ productVariantId: plain.variantId, quantity: 2 }],
      paymentMethod: "COD",
      expectedGrandTotal: expectedGrand,
      note: "Xác minh luồng COD (tự động)",
    },
  });
  record(
    "same Idempotency-Key replays the SAME order (no duplicate)",
    replay.status === 201 || replay.status === 200 ? replay.body?.id === order?.id : false,
    `replay id ${replay.body?.id} vs original ${order?.id}`,
  );

  // ------------------------------------------------- expectedGrandTotal 409 --
  const stale = await call("POST", "/orders/checkout", {
    token,
    headers: { "Idempotency-Key": uuid() },
    body: {
      shippingAddress: address,
      items: [{ productVariantId: plain.variantId, quantity: 2 }],
      paymentMethod: "COD",
      expectedGrandTotal: expectedGrand - 1,
    },
  });
  record(
    "stale expectedGrandTotal is refused with 409",
    stale.status === 409,
    `HTTP ${stale.status} ${typeof stale.body?.message === "string" ? stale.body.message.slice(0, 90) : ""}`,
  );

  // --------------------------------------------------------- order detail --
  const detail = await call("GET", `/orders/me/${order.id}`, { token });
  record("customer can read the created order", detail.status === 200 && detail.body?.id === order.id, `HTTP ${detail.status}`);

  const inCustomerList = await call("GET", "/orders/me?limit=20", { token });
  const listed = (inCustomerList.body?.data ?? []).some((o) => o.id === order.id);
  record("the order appears in my orders", listed, `HTTP ${inCustomerList.status}`);

  // ------------------------------------------------------------- admin --
  if (adminToken) {
    const adminOrder = await call("GET", `/orders/${order.id}`, { token: adminToken });
    record(
      "ADMIN sees the order with its partner split",
      adminOrder.status === 200 && (adminOrder.body?.partnerOrders?.length ?? 0) > 0,
      `HTTP ${adminOrder.status}, ${adminOrder.body?.partnerOrders?.length ?? 0} partner order(s)`,
    );
    const adminList = await call("GET", `/orders?search=${encodeURIComponent(order.code)}`, { token: adminToken });
    const found = (adminList.body?.data ?? []).some((o) => o.id === order.id);
    record("ADMIN order search finds it by code", found, `code ${order.code}`);
  }

  // ------------------------------------------------------------- cleanup --
  if (!KEEP && order?.id) {
    const cancel = await call("POST", `/orders/me/${order.id}/cancel`, { token });
    record("verification order cancelled (no residue)", cancel.status === 200 || cancel.status === 201, `HTTP ${cancel.status}`);
  }

  // ======================================================================
  // VOUCHERS — HUNGYEN50K: 50.000đ off orders from 300.000đ
  // ======================================================================
  console.log("\n--- vouchers ---");

  const vouchers = await call("GET", "/vouchers?limit=50&status=ACTIVE");
  const hungyen = (vouchers.body?.data ?? []).find((v) => v.code === "HUNGYEN50K");
  record("HUNGYEN50K exists and is ACTIVE", !!hungyen, hungyen ? `min ${hungyen.minOrderAmount}` : "not found");

  if (hungyen) {
    const minOrder = Number(hungyen.minOrderAmount);
    const cheap = variants.find((v) => v.basePrice > 0 && v.basePrice * 2 < minOrder);
    const dear = variants.find((v) => v.basePrice * 2 >= minOrder);

    /**
     * HUNGYEN50K is limited to one redemption per customer, and a previous run
     * may have consumed it for the default account. Rather than mutating the
     * limit, the "applies" case uses whichever seeded customer still has
     * headroom — the rule itself is what is under test, not one account.
     *
     * The probe must clear the MINIMUM first: a one-unit probe on a cheap
     * variant is refused for being below 300.000đ, which would look like
     * headroom and pick the wrong customer.
     */
    const probeVariant = dear ?? cheap;
    const probeQty = Math.max(1, Math.ceil(minOrder / Number(probeVariant.basePrice)));
    const CANDIDATES = [
      ["lan.nguyen@agrimarket.vn", token],
      ["hung.tran@agrimarket.vn", otherToken],
      ["mai.pham@agrimarket.vn", null],
      ["duc.le@agrimarket.vn", null],
      ["hoa.vu@agrimarket.vn", null],
    ];
    let voucherToken = null;
    let voucherEmail = null;
    for (const [email, cached] of CANDIDATES) {
      let t = cached;
      if (!t) {
        const r = await call("POST", "/auth/login", { body: { email, password: "Agri@12345" } });
        t = r.status === 200 ? r.body.accessToken : null;
      }
      if (!t) continue;
      const probe = await call("POST", "/orders/checkout-preview", {
        token: t,
        body: {
          items: [{ productVariantId: probeVariant.variantId, quantity: probeQty }],
          voucherCode: "HUNGYEN50K",
        },
      });
      const refusal = String(probe.body?.message ?? "");
      // Only a PER-CUSTOMER refusal means this account is out; anything else
      // (including a below-minimum subtotal) is a problem with the probe.
      if (!/per-customer|đã dùng hết số lần|already reached/i.test(refusal)) {
        voucherToken = t;
        voucherEmail = email;
        break;
      }
    }
    record(
      "a customer with voucher headroom exists",
      voucherToken !== null,
      voucherEmail ? `using ${voucherEmail}` : "every seeded customer has redeemed it",
    );

    // (a) order BELOW the 300.000đ minimum -> the voucher must be refused.
    if (cheap) {
      const cheapQty = 2;
      // Price the same lines WITHOUT the voucher, so the message can state the
      // real subtotal the refusal was judged against.
      const plainPreview = await call("POST", "/orders/checkout-preview", {
        token,
        body: { items: [{ productVariantId: cheap.variantId, quantity: cheapQty }] },
      });
      const belowPreview = await call("POST", "/orders/checkout-preview", {
        token,
        body: {
          items: [{ productVariantId: cheap.variantId, quantity: cheapQty }],
          voucherCode: "HUNGYEN50K",
        },
      });
      const subtotal = Number(plainPreview.body?.subtotal ?? 0);
      const msg = String(belowPreview.body?.message ?? "");
      record(
        "voucher below the minimum order is refused",
        belowPreview.status >= 400 && /at least|tối thiểu/i.test(msg),
        `HTTP ${belowPreview.status} on a ${subtotal.toFixed(0)}đ order (min ${minOrder}): ${msg.slice(0, 80)}`,
      );
    } else {
      record("voucher below the minimum order is refused", false, "no cheap enough variant to test with");
    }

    // (b) order ABOVE the minimum -> the voucher applies and the discount is
    //     exactly the backend's, never computed by the client.
    if (dear && voucherToken) {
      const qty = Math.ceil(minOrder / dear.basePrice) + 1;
      const abovePreview = await call("POST", "/orders/checkout-preview", {
        token: voucherToken,
        body: { items: [{ productVariantId: dear.variantId, quantity: qty }], voucherCode: "HUNGYEN50K" },
      });
      const a = abovePreview.body;
      const applied = Number(a?.voucher?.discountAmount ?? 0);
      record(
        "voucher at/above the minimum is applied",
        (abovePreview.status === 200 || abovePreview.status === 201) && applied === 50000,
        `HTTP ${abovePreview.status}, discount ${applied}, subtotal ${a?.subtotal}`,
      );
      record(
        "discounted total = subtotal - 50000 + shipping",
        Math.abs(Number(a?.subtotal) - applied + Number(a?.shippingFee) - Number(a?.grandTotal)) < 0.01,
        `${a?.subtotal} - ${applied} + ${a?.shippingFee} = ${a?.grandTotal}`,
      );
      record("preview echoes the applied voucher code", a?.voucher?.code === "HUNGYEN50K", `code=${a?.voucher?.code}`);

      // The discount is the backend's number: an unknown code must be rejected
      // rather than silently ignored.
      const unknown = await call("POST", "/orders/checkout-preview", {
        token: voucherToken,
        body: { items: [{ productVariantId: dear.variantId, quantity: qty }], voucherCode: "KHONG-TON-TAI" },
      });
      record("an unknown voucher code is refused", unknown.status >= 400, `HTTP ${unknown.status}`);
    } else {
      record("voucher at/above the minimum is applied", false, "no variant or no eligible customer");
    }
  }

  // ======================================================================
  // FLASH SALE — the sale's own window, prices and countdown inputs
  // ======================================================================
  console.log("\n--- flash sale ---");

  const flashSales = await call("GET", "/flash-sales?limit=10&status=ACTIVE");
  const sales = flashSales.body?.data ?? [];
  record("GET /flash-sales returns the active programmes", flashSales.status === 200, `HTTP ${flashSales.status}, ${sales.length} sale(s)`);

  const now = Date.now();
  for (const sale of sales) {
    const startsAt = new Date(sale.startsAt).getTime();
    const endsAt = new Date(sale.endsAt).getTime();
    const running = sale.status === "ACTIVE" && startsAt <= now && now < endsAt;
    const daysLeft = (endsAt - now) / 86_400_000;
    record(
      `sale "${sale.name}" is inside its window`,
      running,
      `endsAt ${sale.endsAt} (${daysLeft.toFixed(1)} days left)`,
    );

    for (const item of sale.items ?? []) {
      const flashPrice = Number(item.flashPrice);
      const basePrice = Number(item.productVariant?.basePrice ?? 0);
      const soldOut = item.soldQuantity >= item.quota;
      record(
        `  item ${item.productVariant?.sku}: flash price is below the base price`,
        flashPrice < basePrice,
        `${flashPrice} < ${basePrice}`,
      );
      record(
        `  item ${item.productVariant?.sku}: quota not exceeded`,
        item.soldQuantity <= item.quota,
        `sold ${item.soldQuantity}/${item.quota}, per-customer ${item.perCustomerLimit}`,
      );
      if (soldOut) record(`  item ${item.productVariant?.sku}: sold out is not offered`, false, "quota exhausted");
    }
  }

  // The catalog's `effectivePrice` must agree with the sale's own `flashPrice`
  // for a variant the sale covers — one price, two endpoints.
  //
  // A SECOND customer is used for the price comparison. The first one has
  // already bought up to the per-customer limit of some flash items in earlier
  // orders, and the backend correctly refuses to re-price those for them; that
  // refusal is asserted on its own below.
  for (const sale of sales) {
    for (const item of sale.items ?? []) {
      if (item.soldQuantity >= item.quota) continue;
      const variantId = item.productVariantId;
      const inCatalog = variants.find((v) => v.variantId === variantId);
      if (!inCatalog) continue;
      const flashPrice = Number(item.flashPrice);
      const basePrice = Number(item.productVariant?.basePrice ?? 0);
      // Only assert where the flash price is genuinely the cheapest option.
      if (flashPrice < basePrice) {
        record(
          `catalog effectivePrice matches flashPrice for variant ${variantId}`,
          Math.abs(inCatalog.effective - flashPrice) < 0.01,
          `catalog ${inCatalog.effective} (${inCatalog.source}) vs flash ${flashPrice}`,
        );

        // ...and the checkout preview must quote the same unit price.
        const preview = await call("POST", "/orders/checkout-preview", {
          token: otherToken ?? token,
          body: { items: [{ productVariantId: variantId, quantity: 1 }] },
        });
        const line = preview.body?.items?.[0];
        record(
          `checkout-preview quotes the flash price for variant ${variantId}`,
          line ? Math.abs(Number(line.unitPrice) - flashPrice) < 0.01 : false,
          line
            ? `preview ${line.unitPrice} (${line.priceSource}) vs flash ${flashPrice}`
            : `HTTP ${preview.status}: ${preview.body?.message}`,
        );

        // The per-customer limit is per customer: the first customer's history
        // must not leak into the second customer's price.
        const mineAgain = await call("POST", "/orders/checkout-preview", {
          token,
          body: { items: [{ productVariantId: variantId, quantity: 1 }] },
        });
        if (mineAgain.status >= 400) {
          record(
            `per-customer limit is enforced for the first customer on variant ${variantId}`,
            /per-customer|giới hạn/i.test(String(mineAgain.body?.message ?? "")),
            `HTTP ${mineAgain.status}: ${String(mineAgain.body?.message ?? "").slice(0, 70)}`,
          );
        } else {
          record(
            `first customer is still inside their limit on variant ${variantId}`,
            true,
            `HTTP ${mineAgain.status}, unit ${mineAgain.body?.items?.[0]?.unitPrice}`,
          );
        }
      }
    }
  }

  // -------------------------------------------------------------- report --
  const report = {
    ranAt: new Date().toISOString(),
    api: API,
    orderId: order?.id ?? null,
    orderCode: order?.code ?? null,
    results,
    failures,
  };
  writeFileSync("C:/Users/Admin/AppData/Local/Temp/kilo/checkout-verify.json", JSON.stringify(report, null, 2));

  console.log(`\n=== ${results.length - failures}/${results.length} checks passed`);
  if (order?.id) console.log(`order: ${order.code} (id ${order.id})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verification aborted:", err.message);
  process.exit(2);
});
