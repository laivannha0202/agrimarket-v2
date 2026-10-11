/**
 * Live HTTP acceptance smoke test for the two V2 features.
 *
 * This runs against a REAL API process over the network (not supertest), so it
 * also exercises serialisation, routing and the CORS/global-pipe stack as the
 * browsers and Expo Go will hit them.
 *
 * SAFETY: the caller must start the API with DATABASE_URL pointing at the TEST
 * database. The script creates only `smoke…`-prefixed rows, cancels the order it
 * created, and clears the cart/addresses it made.
 *
 * The script cannot see which database a running API process is connected to
 * over HTTP (the health probe reports only that the DB is reachable), so it
 * does NOT pretend to verify that for you. Instead it refuses to run unless the
 * operator explicitly confirms the target database, and it cross-checks that
 * name against `TEST_DATABASE_URL` in `apps/api/.env` — a mis-typed confirmation
 * or a forgotten `DATABASE_URL` therefore stops the run instead of writing
 * `smoke…` rows into the development database.
 *
 * Usage (from the repository root, API already running):
 *   node scripts/address-auth-smoke.mjs http://127.0.0.1:3111/api/v1 --confirm-test-db=agrimarket_v2_test
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3111/api/v1').replace(/\/+$/, '');
const CONFIRM_FLAG = '--confirm-test-db=';

/** Repository root — this file lives in `<root>/scripts/`. */
function repoRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** Database name from a connection URL, ignoring the query string. */
function databaseNameOf(url) {
  const withoutQuery = String(url).split('?')[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
}

/**
 * Refuses to touch anything unless the operator names the TEST database
 * explicitly AND that name is the one `TEST_DATABASE_URL` points at.
 */
function assertTestTarget() {
  const confirmed = process.argv.find((a) => a.startsWith(CONFIRM_FLAG))?.slice(CONFIRM_FLAG.length);
  if (!confirmed) {
    console.error(
      `FATAL: refusing to run without ${CONFIRM_FLAG}<db>. This script writes real rows\n` +
        '       (a customer account, addresses, a cart and one order). Name the TEST\n' +
        '       database you started the API against, e.g.\n' +
        '       --confirm-test-db=agrimarket_v2_test',
    );
    process.exit(2);
  }
  if (!/test/i.test(confirmed)) {
    console.error(`FATAL: "${confirmed}" does not look like a TEST database — refusing to run`);
    process.exit(2);
  }

  const envPath = join(repoRoot(), 'apps', 'api', '.env');
  if (!existsSync(envPath)) {
    console.error(`FATAL: ${envPath} not found, cannot cross-check the TEST database name`);
    process.exit(2);
  }
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('TEST_DATABASE_URL='));
  if (!line) {
    console.error('FATAL: TEST_DATABASE_URL is not set in apps/api/.env — refusing to run');
    process.exit(2);
  }
  const expected = databaseNameOf(line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''));
  if (expected !== confirmed) {
    console.error(
      `FATAL: you confirmed "${confirmed}" but apps/api/.env TEST_DATABASE_URL points at "${expected}" — refusing to run`,
    );
    process.exit(2);
  }
  console.log(`target: TEST database "${confirmed}" (confirmed and cross-checked)`);
}

async function assertApiUp() {
  let health;
  try {
    health = await call('GET', '/health');
  } catch (error) {
    console.error(
      `FATAL: cannot reach ${BASE}/health — refusing to run blind (${error instanceof Error ? error.message : String(error)})`,
    );
    process.exit(2);
  }
  if (health.status !== 200) {
    console.error(`FATAL: ${BASE}/health returned ${health.status} — refusing to run`);
    process.exit(2);
  }
  if (health.body?.database !== 'up') {
    console.error(`FATAL: API reports database "${health.body?.database}" — refusing to run`);
    process.exit(2);
  }
  console.log(`health: ${health.body.status}, database ${health.body.database}`);
}

let pass = 0;
let fail = 0;

function ok(name, detail = '') {
  pass += 1;
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}

function bad(name, detail) {
  fail += 1;
  console.log(`FAIL ${name} — ${detail instanceof Error ? detail.message : String(detail)}`);
}

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}

const RUN = `smoke${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
const PASSWORD = 'MatKhauSmoke@12345';
const EMAIL = `${RUN}@agrimarket.vn`;
/** Set when the checkout step really created an order, so cleanup can cancel it. */
let createdOrderId = null;

async function main() {
  assertTestTarget();
  await assertApiUp();
  console.log(`BASE=${BASE}`);
  console.log(`RUN=${RUN}\n`);

  // ---------------------------------------------------------------- A. catalogue
  let provinceCode;
  let wardA;
  let wardB;
  try {
    const provinces = await call('GET', '/locations/provinces');
    if (provinces.status !== 200) throw new Error(`status ${provinces.status}`);
    if (!Array.isArray(provinces.body) || provinces.body.length === 0) {
      throw new Error('no provinces returned');
    }
    provinceCode = provinces.body[0].code;
    if (typeof provinceCode !== 'string') throw new Error('province code is not a string');
    ok('catalogue: GET /locations/provinces', `code=${provinceCode} name=${provinces.body[0].fullName}`);
  } catch (error) {
    bad('catalogue: GET /locations/provinces', error);
    return;
  }

  try {
    const wards = await call('GET', `/locations/provinces/${provinceCode}/wards`);
    if (wards.status !== 200) throw new Error(`status ${wards.status}`);
    const { data, meta } = wards.body;
    if (data.length !== meta.total) {
      throw new Error(`page truncated: ${data.length} of ${meta.total}`);
    }
    // The whole point of the feature: the complete 104-unit catalogue in ONE call.
    if (meta.total !== 104) throw new Error(`expected 104 wards, got ${meta.total}`);
    const xa = data.filter((w) => w.type === 'xa').length;
    const phuong = data.filter((w) => w.type === 'phuong').length;
    if (xa !== 93 || phuong !== 11) {
      throw new Error(`expected 93 xã + 11 phường, got ${xa} + ${phuong}`);
    }
    for (const w of data) {
      if (typeof w.code !== 'string' || !/^\d{5}$/.test(w.code)) {
        throw new Error(`ward code ${JSON.stringify(w.code)} is not a 5-char string`);
      }
      if (w.provinceCode !== provinceCode) throw new Error(`ward ${w.code} has foreign province`);
      if ('searchText' in w || 'searchHaystack' in w) throw new Error(`internal field leaked on ${w.code}`);
    }
    wardA = data[0];
    wardB = data[1];
    ok('catalogue: full 104-unit list in one call', `93 xã + 11 phường, string codes, no internal fields`);
  } catch (error) {
    bad('catalogue: full 104-unit list in one call', error);
    return;
  }

  try {
    // Accent-free search must find the accented official name.
    const folded = wardA.fullName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/^(Xa|Phuong)\s+/i, '')
      .trim();
    const byName = await call('GET', `/locations/provinces/${provinceCode}/wards?search=${encodeURIComponent(folded)}`);
    const found = byName.body?.data?.some((w) => w.code === wardA.code);
    if (!found) throw new Error(`"${folded}" did not find ${wardA.code}`);
    ok('catalogue: accent-insensitive search', `"${folded}" → ${wardA.fullName}`);
  } catch (error) {
    bad('catalogue: accent-insensitive search', error);
  }

  try {
    const unknown = await call('GET', `/locations/provinces/${provinceCode}/wards/00000`);
    if (unknown.status !== 404) throw new Error(`expected 404, got ${unknown.status}`);
    ok('catalogue: unknown ward code is a 404');
  } catch (error) {
    bad('catalogue: unknown ward code is a 404', error);
  }

  // ---------------------------------------------------------------- B. register
  let token;
  try {
    const registered = await call('POST', '/auth/register', {
      body: { email: EMAIL, password: PASSWORD, fullName: 'Smoke Người mới', phone: '0933111222' },
    });
    if (registered.status !== 201) {
      throw new Error(`status ${registered.status}: ${registered.text.slice(0, 200)}`);
    }
    if (registered.body.accessToken) throw new Error('registration must not issue a session');
    if (registered.body.passwordHash) throw new Error('passwordHash leaked');
    if (registered.body.role !== 'CUSTOMER') throw new Error(`role is ${registered.body.role}`);
    ok('auth: POST /auth/register creates an ACTIVE CUSTOMER with no session');
  } catch (error) {
    bad('auth: POST /auth/register', error);
    return;
  }

  try {
    const forged = await call('POST', '/auth/register', {
      body: {
        email: `${RUN}-attacker@agrimarket.vn`,
        password: PASSWORD,
        fullName: 'Smoke Kẻ tấn công',
        phone: '0933111333',
        role: 'ADMIN',
      },
    });
    if (forged.status !== 400) throw new Error(`expected 400, got ${forged.status}`);
    ok('auth: forged `role` on register is refused (400), not ignored');
  } catch (error) {
    bad('auth: forged `role` on register is refused', error);
  }

  try {
    const duplicate = await call('POST', '/auth/register', {
      body: { email: EMAIL, password: PASSWORD, fullName: 'Smoke Trùng', phone: '0933111444' },
    });
    if (duplicate.status !== 409) throw new Error(`expected 409, got ${duplicate.status}`);
    ok('auth: duplicate e-mail is a 409');
  } catch (error) {
    bad('auth: duplicate e-mail is a 409', error);
  }

  // ---------------------------------------------------------------- B. login
  try {
    const login = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    if (login.status !== 200) throw new Error(`status ${login.status}`);
    token = login.body.accessToken;
    if (typeof token !== 'string') throw new Error('no accessToken');
    if (login.body.user.role !== 'CUSTOMER') throw new Error(`role ${login.body.user.role}`);
    ok('auth: POST /auth/login issues a CUSTOMER session');
  } catch (error) {
    bad('auth: POST /auth/login', error);
    return;
  }

  // ---------------------------------------------------------------- A. address
  let address;
  try {
    const created = await call('POST', '/customers/me/addresses', {
      token,
      body: {
        recipientName: 'Smoke Người nhận',
        phone: '0912345678',
        // Deliberately wrong text: the backend must overwrite it from the code.
        province: 'Tỉnh Bịa Đặt',
        provinceCode,
        wardCode: wardA.code,
        detail: 'Số 1 đường smoke',
      },
    });
    if (created.status !== 201) throw new Error(`status ${created.status}: ${created.text.slice(0, 200)}`);
    if (created.body.wardName !== wardA.fullName) {
      throw new Error(`wardName is ${created.body.wardName}, expected ${wardA.fullName}`);
    }
    if (created.body.province === 'Tỉnh Bịa Đặt') throw new Error('client province text was trusted');
    if (created.body.district !== null) throw new Error('a code-verified address kept a district');
    address = created.body;
    ok('address: official commune name resolved server-side', `${created.body.wardName}`);
  } catch (error) {
    bad('address: server-side commune resolution', error);
  }

  try {
    const badWard = await call('POST', '/customers/me/addresses', {
      token,
      body: {
        recipientName: 'Smoke Sai',
        phone: '0912345678',
        province: 'Hưng Yên',
        provinceCode,
        wardCode: '00000',
        detail: 'Số 2',
      },
    });
    if (badWard.status !== 400) throw new Error(`expected 400, got ${badWard.status}`);
    if (!String(badWard.body?.message ?? '').includes('Xã/phường không hợp lệ')) {
      throw new Error(`unexpected message: ${badWard.text.slice(0, 200)}`);
    }
    ok('address: an unknown commune code is refused (400)');
  } catch (error) {
    bad('address: an unknown commune code is refused', error);
  }

  try {
    const missingProvince = await call('POST', '/customers/me/addresses', {
      token,
      body: {
        recipientName: 'Smoke Thiếu tỉnh',
        phone: '0912345678',
        province: 'Hưng Yên',
        wardCode: wardA.code,
        detail: 'Số 3',
      },
    });
    if (missingProvince.status !== 400) throw new Error(`expected 400, got ${missingProvince.status}`);
    ok('address: a commune code without its province code is refused (400)');
  } catch (error) {
    bad('address: a commune code without its province code is refused', error);
  }

  try {
    const legacy = await call('POST', '/customers/me/addresses', {
      token,
      body: {
        recipientName: 'Smoke Legacy',
        phone: '0912345679',
        province: 'Hưng Yên',
        district: 'Văn Lâm',
        ward: 'Tân Quang',
        detail: 'Số 4',
      },
    });
    if (legacy.status !== 201) throw new Error(`status ${legacy.status}`);
    if (legacy.body.wardCode !== null) throw new Error('a legacy address was given a code');
    if (legacy.body.district !== 'Văn Lâm') throw new Error('legacy district was not preserved');
    ok('address: a legacy (pre-reorganisation) address is still saveable');

    // Converting it must drop the district.
    const converted = await call('PATCH', `/customers/me/addresses/${legacy.body.id}`, {
      token,
      body: { provinceCode, wardCode: wardB.code },
    });
    if (converted.status !== 200) throw new Error(`status ${converted.status}`);
    if (converted.body.wardName !== wardB.fullName) throw new Error('conversion did not resolve the name');
    if (converted.body.district !== null) throw new Error('the district survived conversion');
    ok('address: editing to a catalogue commune converts it and drops the district');

    await call('DELETE', `/customers/me/addresses/${legacy.body.id}`, { token });
  } catch (error) {
    bad('address: legacy address lifecycle', error);
  }

  // ---------------------------------------------------------------- B. change password
  try {
    const changed = await call('PATCH', '/auth/change-password', {
      token,
      body: { currentPassword: PASSWORD, newPassword: 'MatKhauSmokeMoi@12345' },
    });
    if (changed.status !== 200) throw new Error(`status ${changed.status}: ${changed.text.slice(0, 200)}`);
    const fresh = changed.body.accessToken;
    if (typeof fresh !== 'string') throw new Error('no fresh token returned');

    const oldToken = await call('GET', '/auth/me', { token });
    if (oldToken.status !== 401) throw new Error(`the old token still works (${oldToken.status})`);

    const newToken = await call('GET', '/auth/me', { token: fresh });
    if (newToken.status !== 200) throw new Error(`the fresh token was rejected (${newToken.status})`);

    const oldPassword = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    if (oldPassword.status !== 401) throw new Error(`the old password still works (${oldPassword.status})`);

    ok('auth: change-password signs out other devices and keeps this one');
    token = fresh;
  } catch (error) {
    bad('auth: change-password', error);
  }

  // ---------------------------------------------------------------- B. recovery
  try {
    const known = await call('POST', '/auth/forgot-password', { body: { email: EMAIL } });
    const unknown = await call('POST', '/auth/forgot-password', {
      body: { email: `${RUN}-khong-ton-tai@agrimarket.vn` },
    });
    if (known.status !== 200 || unknown.status !== 200) {
      throw new Error(`statuses ${known.status}/${unknown.status}`);
    }
    if (known.body.message !== unknown.body.message) {
      throw new Error('the response differs for a registered address — enumeration signal');
    }
    if (JSON.stringify(known.body.delivery) !== JSON.stringify(unknown.body.delivery)) {
      throw new Error('the delivery block differs — enumeration signal');
    }
    const mode = known.body.delivery?.mode;
    const delivered = known.body.delivery?.delivered;
    ok(
      'auth: forgot-password answers identically for known and unknown addresses',
      `delivery=${mode} delivered=${delivered}`,
    );
    if (delivered === true) {
      console.log('     NOTE: SMTP is configured, so a real e-mail was sent to', EMAIL);
    } else {
      console.log('     NOTE: transport is NOT real delivery — the reset link was captured in memory only');
    }
  } catch (error) {
    bad('auth: forgot-password neutrality', error);
  }

  try {
    const bogus = await call('POST', '/auth/reset-password', {
      body: { token: 'a'.repeat(64), newPassword: 'MatKhauKhongCo@12345' },
    });
    if (bogus.status !== 400) throw new Error(`expected 400, got ${bogus.status}`);
    if (!String(bogus.body?.message ?? '').includes('không hợp lệ hoặc đã hết hạn')) {
      throw new Error(`unexpected message: ${bogus.text.slice(0, 200)}`);
    }
    ok('auth: an unknown reset token is refused with the generic message');
  } catch (error) {
    bad('auth: an unknown reset token is refused', error);
  }

  // ---------------------------------------------------------------- A. checkout snapshot
  try {
    // Discover a purchasable variant instead of assuming an id: the test
    // database carries the demo catalogue, whose ids are not fixed.
    const products = await call('GET', '/products?status=ACTIVE&limit=20');
    const variant = (products.body?.data ?? [])
      .flatMap((p) => p.variants ?? [])
      .find((v) => v.status === 'ACTIVE');

    if (!variant) {
      console.log('SKIP checkout snapshot — no ACTIVE variant on this database');
    } else {
      const cart = await call('POST', '/carts/me/items', {
        token,
        body: { productVariantId: variant.id, quantity: 1 },
      });
      if (cart.status >= 400) {
        console.log(`SKIP checkout snapshot — cart rejected variant ${variant.id} (${cart.status})`);
      } else {
        const preview = await call('POST', '/orders/checkout-preview', { token, body: {} });
        if (preview.status !== 201 && preview.status !== 200) {
          throw new Error(`preview status ${preview.status}: ${preview.text.slice(0, 200)}`);
        }
        const order = await call('POST', '/orders/checkout', {
          token,
          body: {
            shippingAddress: {
              recipientName: 'Smoke Snapshot',
              phone: '0912345678',
              province: 'Hưng Yên',
              provinceCode,
              wardCode: wardA.code,
              detail: 'Số 9 đường smoke',
            },
            paymentMethod: 'COD',
            expectedGrandTotal: preview.body.grandTotal,
          },
        });
        if (order.status !== 201) {
          throw new Error(`status ${order.status}: ${order.text.slice(0, 200)}`);
        }
        const snap = order.body.shippingAddressSnapshot;
        if (snap.wardName !== wardA.fullName) throw new Error(`snapshot wardName is ${snap.wardName}`);
        if (snap.wardCode !== wardA.code) throw new Error(`snapshot wardCode is ${snap.wardCode}`);
        if (snap.provinceCode !== provinceCode) {
          throw new Error(`snapshot provinceCode is ${snap.provinceCode}`);
        }
        if (snap.province === 'Tỉnh Bịa Đặt') throw new Error('the snapshot kept client province text');
        // `Order.shippingFee` is `Decimal(18,2)` (docs/DATABASE.md), and Prisma
        // serialises a Decimal as an exact string — so the wire type is a string,
        // not a number. Assert the value, not the JS type.
        if (typeof order.body.shippingFee !== 'string') {
          throw new Error(`shippingFee came back as ${typeof order.body.shippingFee}, expected a Decimal string`);
        }
        const fee = Number(order.body.shippingFee);
        if (!Number.isFinite(fee)) throw new Error(`shippingFee "${order.body.shippingFee}" is not numeric`);
        // The charged fee must be exactly the fee the preview showed (both
        // computed server-side), so a client can never influence it.
        if (fee !== Number(preview.body.shippingFee)) {
          throw new Error(`charged ${fee} but the preview showed ${preview.body.shippingFee}`);
        }
        ok(
          'checkout: the order snapshot carries the verified commune',
          `${snap.wardName}, server-computed fee=${fee} (matches preview)`,
        );
        createdOrderId = order.body.id;
        // A wrong code must be refused WITHOUT creating an order. The items are
        // sent explicitly because the successful checkout above emptied the
        // cart: with a cart-based body the request would fail on "No items to
        // checkout" *before* the address was ever looked at, which would make
        // this assertion pass for the wrong reason.
        const before = await call('GET', '/orders/me?limit=100', { token });
        const refused = await call('POST', '/orders/checkout', {
          token,
          body: {
            shippingAddress: {
              recipientName: 'Smoke Sai',
              phone: '0912345678',
              province: 'Hưng Yên',
              provinceCode,
              wardCode: '00000',
              detail: 'Số 10',
            },
            items: [{ productVariantId: variant.id, quantity: 1 }],
            paymentMethod: 'COD',
          },
        });
        if (refused.status !== 400) throw new Error(`expected 400, got ${refused.status}`);
        // The refusal must come from the address check, not from an empty cart.
        if (!String(refused.body?.message ?? '').includes('Xã/phường không hợp lệ')) {
          throw new Error(`refused for the wrong reason: ${refused.text.slice(0, 200)}`);
        }
        const after = await call('GET', '/orders/me?limit=100', { token });
        if (after.body.meta.total !== before.body.meta.total) {
          throw new Error('an order was created for a refused checkout');
        }
        ok('checkout: a bad commune code is refused without creating an order');
      }
    }
  } catch (error) {
    bad('checkout: order snapshot', error);
  }

  // ---------------------------------------------------------------- cleanup
  console.log('');
  try {
    const login = await call('POST', '/auth/login', {
      body: { email: EMAIL, password: 'MatKhauSmokeMoi@12345' },
    });
    const cleanupToken = login.body?.accessToken;
    if (cleanupToken) {
      // Cancel the order this run created, if any, so the test database is not
      // left holding stock for a smoke account. The customer-facing route is
      // `POST /orders/me/:id/cancel`.
      if (createdOrderId !== null) {
        const cancelled = await call('POST', `/orders/me/${createdOrderId}/cancel`, {
          token: cleanupToken,
          body: {},
        });
        if (cancelled.status !== 201 && cancelled.status !== 200) {
          console.log(`cleanup: WARNING order ${createdOrderId} cancel → ${cancelled.status}`);
        } else {
          console.log(`cleanup: order ${createdOrderId} cancelled (${cancelled.status})`);
        }
      }
      const addresses = await call('GET', '/customers/me/addresses', { token: cleanupToken });
      for (const a of addresses.body ?? []) {
        await call('DELETE', `/customers/me/addresses/${a.id}`, { token: cleanupToken });
      }
      const cart = await call('DELETE', '/carts/me', { token: cleanupToken });
      console.log(`cleanup: addresses and cart cleared (cart ${cart.status})`);
    }
    // The account row itself has no self-delete route (correctly), so the
    // `smoke…` user is left for `scripts/purge-smoke-residue.mjs`, which deletes
    // exactly the rows reachable from a `smoke…` account and never the catalogue.
    console.log(`cleanup: account ${EMAIL} is left for scripts/purge-smoke-residue.mjs`);
  } catch (error) {
    console.log('cleanup skipped:', error instanceof Error ? error.message : String(error));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

await main();
