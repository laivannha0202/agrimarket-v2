/**
 * Checkout conflict semantics against the REAL backend.
 *
 * Answers one question that code reading cannot settle: after the total moves
 * and the customer re-confirms, does the retry succeed — or does the reused
 * idempotency key dead-end them in a permanent 409?
 *
 * It creates nothing. Every request below is rejected on purpose:
 *   - the first checkout sends a deliberately wrong `expectedGrandTotal`, so the
 *     backend refuses and rolls back (no order, no key row);
 *   - the second reuses the SAME key with the corrected total, which is what the
 *     app does after the customer re-confirms.
 *
 * A successful second call would create a real order, so the probe stops short
 * of it: it only proves the key is NOT already burned by the failed attempt.
 *
 * Usage: node scripts/checkout-conflict-probe.mjs <email> <password>
 */

const API = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '');
const email = process.argv[2];
const password = process.argv[3];

let token = null;
async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

const login = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) {
  console.error(`login failed: ${login.status}`);
  process.exit(2);
}
token = login.body.accessToken;
console.log(`signed in as ${email} (role ${login.body.user.role})`);

const addresses = await api('/customers/me/addresses');
const addr = addresses.body[0];
if (!addr) {
  console.error('no address on this account');
  process.exit(2);
}

const before = await api('/orders/me?page=1&limit=100');
const countBefore = before.body.meta.total;
console.log(`orders before: ${countBefore}`);

// A variant that is genuinely in stock and buyable.
const product = await api('/products/42');
const variant = product.body.variants.find((v) => v.inStock);
console.log(`using variant ${variant.id} (${variant.name})`);

const preview = await api('/orders/checkout-preview', {
  method: 'POST',
  body: JSON.stringify({ items: [{ productVariantId: variant.id, quantity: 1 }] }),
});
if (preview.status >= 300) {
  console.error(`preview failed: ${preview.status} ${JSON.stringify(preview.body)}`);
  process.exit(2);
}
const realTotal = preview.body.grandTotal;
console.log(`backend preview total: ${realTotal}`);

const shippingAddress = {
  recipientName: addr.recipientName,
  phone: addr.phone,
  province: addr.province,
  district: addr.district ?? undefined,
  ward: addr.ward ?? undefined,
  village: addr.village ?? undefined,
  detail: addr.detail,
};

const key = `qa-conflict-${Date.now().toString(36)}`;
const base = {
  shippingAddress,
  items: [{ productVariantId: variant.id, quantity: 1 }],
  paymentMethod: 'COD',
  idempotencyKey: key,
};

/* ---- 1. wrong total -> must be refused as a re-price ------------------- */
const wrong = await api('/orders/checkout', {
  method: 'POST',
  body: JSON.stringify({ ...base, expectedGrandTotal: 1 }),
});
console.log('');
console.log(`1. wrong expectedGrandTotal -> HTTP ${wrong.status}`);
console.log(`   message: ${JSON.stringify(wrong.body?.message ?? wrong.body)}`);
const looksLikeReprice = /total changed/i.test(JSON.stringify(wrong.body ?? ''));
console.log(`   ${looksLikeReprice ? 'OK: the app will classify this as "total-changed"' : 'MISMATCH: the app would NOT classify this as a re-price'}`);

const midCount = (await api('/orders/me?page=1&limit=100')).body.meta.total;
console.log(`   orders after refusal: ${midCount} ${midCount === countBefore ? '(nothing created — rolled back)' : '(ORDER CREATED — unexpected!)'}`);

/* ---- 2. same key, corrected total ------------------------------------- */
// If the failed attempt had burned the key, this would 409 "already used with a
// different checkout payload" and the customer could never complete the order.
// We therefore send a STILL-WRONG total: it proves the key is not burned
// (we reach the total check) without creating an order.
const second = await api('/orders/checkout', {
  method: 'POST',
  body: JSON.stringify({ ...base, expectedGrandTotal: 2 }),
});
console.log('');
console.log(`2. same key, different total -> HTTP ${second.status}`);
const msg2 = JSON.stringify(second.body?.message ?? second.body);
console.log(`   message: ${msg2}`);
const keyBurned = /already used with a different checkout payload/i.test(msg2);
const reachedTotalCheck = /total changed/i.test(msg2);
console.log(
  `   ${keyBurned
    ? 'FAIL: the key was burned by the refused attempt — a re-confirmed order would dead-end'
    : reachedTotalCheck
      ? 'OK: the key is reusable — re-confirming with the corrected total can succeed'
      : 'INCONCLUSIVE: neither a key-reuse nor a total-change conflict'}`,
);

const after = await api('/orders/me?page=1&limit=100');
console.log('');
console.log(`orders after: ${after.body.meta.total} (started at ${countBefore})`);
console.log(after.body.meta.total === countBefore ? 'PROBE CREATED NOTHING — safe to run against DEV' : 'WARNING: an order was created');
