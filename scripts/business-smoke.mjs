#!/usr/bin/env node
/**
 * C-19 business smoke against the BUILT API and an isolated database.
 *
 * The API is started on a loopback port with `DATABASE_URL` pointing at the
 * disposable run schema. The script then drives the real HTTP surface:
 *
 *   - health, public catalog, product detail and public traceability;
 *   - admin/customer login and role boundaries (401/403);
 *   - C-14 farm / season / farming-event / harvest / lot trace audit reads;
 *   - C-08 settlement / recovery / payout reads (no money is moved);
 *   - cart -> checkout preview -> COD checkout -> idempotent replay ->
 *     cancellation, with reservation and allocation checks in MySQL;
 *   - admin/customer consistency for the order created by the smoke;
 *   - Mobile endpoint compatibility against the live OpenAPI document.
 *
 * Nothing is fabricated: every value comes from the seeded/created rows, and a
 * missing trace link is reported by the API rather than filled in.
 *
 * The script never targets `DATABASE_URL`, staging or production. It exits 1
 * on any failed check. Demo credentials are the ones created by the seed and
 * can be overridden with VERIFY_* environment variables.
 *
 *   node scripts/business-smoke.mjs --url <isolated-url> [--port 3100]
 *     [--out <json>] [--log-dir <dir>] [--no-checkout]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_DIR,
  ROOT,
  assertRunDatabase,
  databaseLabel,
  ensureDir,
  httpJson,
  isMain,
  itemsOf,
  loadProjectEnv,
  nowIso,
  parseDatabaseUrl,
  portIsFree,
  queryRows,
  redactText,
  redactUrl,
  startProcess,
  tail,
  waitForHttp,
  writeJson,
} from './lib/verify-common.mjs';

const DEMO = {
  adminEmail: process.env.VERIFY_ADMIN_EMAIL ?? 'admin@agrimarket.vn',
  adminPassword: process.env.VERIFY_ADMIN_PASSWORD ?? 'Admin@12345',
  customerEmail: process.env.VERIFY_CUSTOMER_EMAIL ?? 'lan.nguyen@agrimarket.vn',
  customerPassword: process.env.VERIFY_CUSTOMER_PASSWORD ?? 'Agri@12345',
};

function valueOf(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function normalizePath(path) {
  return path
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/^\/api\/v1/, '')
    .replace(/\/+$/, '') || '/';
}

function mobileRoutePatterns() {
  const file = join(ROOT, 'apps', 'mobile', 'src', 'lib', 'resources.ts');
  if (!existsSync(file)) return { file, paths: [] };
  const source = readFileSync(file, 'utf8');
  const paths = new Set();
  for (const match of source.matchAll(/["'`](\/[^"'`\n]*)["'`]/g)) {
    const raw = match[1].trim();
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;
    paths.add(normalizePath(raw.split('?')[0]));
  }
  return { file, paths: [...paths].sort() };
}

async function openApiPaths(baseUrl) {
  const response = await httpJson(`${baseUrl}/docs-json`);
  if (response.status !== 200 || !response.body?.paths) {
    throw new Error(`OpenAPI document unavailable (HTTP ${response.status})`);
  }
  const paths = new Set();
  for (const path of Object.keys(response.body.paths)) {
    paths.add(normalizePath(path));
  }
  return { paths, count: Object.keys(response.body.paths).length };
}

export async function runBusinessSmoke(url, options = {}) {
  const startedAt = nowIso();
  const parsed = assertRunDatabase(url, '--url');
  const port = Number(options.port ?? 3100);
  const baseUrl = `http://127.0.0.1:${port}`;
  const api = `${baseUrl}/api/v1`;
  const outDir = ensureDir(options.outDir ?? join(ROOT, '.tmp-verify', 'c19', 'business-smoke'));
  const logsDir = ensureDir(options.logDir ?? join(outDir, 'logs'));
  const logFile = join(logsDir, `api-${Date.now().toString(36)}.log`);

  const result = {
    generatedAt: startedAt,
    database: databaseLabel(parsed),
    databaseUrl: redactUrl(url),
    baseUrl,
    mutate: !options.noCheckout,
    checks: [],
    skipped: [],
    warnings: [],
    failures: [],
    result: 'FAIL',
  };
  const check = (name, ok, detail) => {
    result.checks.push({ name, ok, detail: redactText(String(detail ?? '')) });
    if (!ok) result.failures.push(`${name}: ${detail}`);
    return ok;
  };
  const warn = (message) => result.warnings.push(redactText(message));

  if (!(await portIsFree(port))) {
    throw new Error(`Port ${port} is already in use; choose another --port.`);
  }

  const fixtures = await loadFixtures(parsed);
  result.fixtures = fixtures;

  const server = startProcess({
    name: `api (business smoke) on ${port}`,
    command: process.execPath,
    args: [join(API_DIR, 'dist', 'src', 'main.js')],
    cwd: API_DIR,
    env: {
      DATABASE_URL: url,
      PORT: String(port),
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1h',
      MAIL_TRANSPORT: 'test',
      CORS_ORIGIN: 'http://127.0.0.1:3101,http://127.0.0.1:3102',
    },
    logFile,
  });

  let customerToken = null;
  let adminToken = null;
  let createdOrderId = null;
  let reservedBefore = null;
  let variantId = null;

  try {
    await waitForHttp(`${api}/health`, { timeoutMs: 90_000 });
    const health = await httpJson(`${api}/health`);
    check(
      'health',
      health.status === 200 && health.body?.status === 'ok' && health.body?.database === 'up',
      `HTTP ${health.status}, ${health.body?.status ?? 'no status'}/${health.body?.database ?? 'no db'}`,
    );

    // ---- Public catalog and traceability --------------------------------
    const products = await httpJson(`${api}/products?limit=5`);
    const productItems = itemsOf(products.body);
    check(
      'public-products',
      products.status === 200 && productItems.length > 0,
      `HTTP ${products.status}, ${productItems.length} product(s), total=${products.body?.meta?.total ?? '?'}`,
    );
    const product = productItems[0] ?? null;
    const sellableVariant =
      product?.variants?.find(
        (variant) =>
          variant.status === 'ACTIVE' &&
          Number(variant.availableQuantity ?? 0) >= 1 &&
          (variant.effectivePrice?.unitPrice ?? variant.basePrice) !== undefined,
      ) ?? product?.variants?.[0];
    check(
      'public-variant-pricing',
      Boolean(sellableVariant) &&
        sellableVariant.availableQuantity !== undefined &&
        sellableVariant.effectivePrice?.unitPrice !== undefined,
      sellableVariant
        ? `${sellableVariant.sku}: available=${sellableVariant.availableQuantity}, ` +
          `unitPrice=${sellableVariant.effectivePrice?.unitPrice ?? '?'}, ` +
          `basePrice=${sellableVariant.basePrice ?? '?'}`
        : 'no variant returned',
    );

    if (product) {
      const detail = await httpJson(`${api}/products/${product.id}`);
      check(
        'public-product-detail',
        detail.status === 200 && detail.body?.id === product.id,
        `HTTP ${detail.status}, id=${detail.body?.id ?? '?'}`,
      );
    }

    const categories = await httpJson(`${api}/categories?limit=5`);
    check(
      'public-categories',
      categories.status === 200 && itemsOf(categories.body).length > 0,
      `HTTP ${categories.status}, ${itemsOf(categories.body).length} row(s)`,
    );
    const farms = await httpJson(`${api}/farms?limit=5`);
    check(
      'public-farms',
      farms.status === 200 && itemsOf(farms.body).length > 0,
      `HTTP ${farms.status}, ${itemsOf(farms.body).length} row(s)`,
    );
    const partners = await httpJson(`${api}/partners?limit=5`);
    check(
      'public-partners',
      partners.status === 200 && itemsOf(partners.body).length > 0,
      `HTTP ${partners.status}, ${itemsOf(partners.body).length} row(s)`,
    );
    const vouchers = await httpJson(`${api}/vouchers?limit=5`);
    check(
      'public-vouchers',
      vouchers.status === 200,
      `HTTP ${vouchers.status}, ${itemsOf(vouchers.body).length} active row(s)`,
    );
    const flashSales = await httpJson(`${api}/flash-sales?limit=5`);
    check(
      'public-flash-sales',
      flashSales.status === 200,
      `HTTP ${flashSales.status}, ${itemsOf(flashSales.body).length} active row(s)`,
    );
    const discounts = await httpJson(`${api}/product-discounts?limit=5`);
    check(
      'public-product-discounts',
      discounts.status === 200,
      `HTTP ${discounts.status}, ${itemsOf(discounts.body).length} active row(s)`,
    );
    const provinces = await httpJson(`${api}/locations/provinces`);
    check(
      'public-locations',
      provinces.status === 200 && Array.isArray(provinces.body),
      `HTTP ${provinces.status}, ${Array.isArray(provinces.body) ? provinces.body.length : '?'} province(s)`,
    );
    if (Array.isArray(provinces.body) && provinces.body.length === 0) {
      warn(
        'The location catalogue is empty in this schema. Address text still works, but the ' +
          'province/ward picker needs `npm run db:import-wards`.',
      );
    }

    const trace = await httpJson(`${api}/trace/${encodeURIComponent(fixtures.traceCode)}`);
    check(
      'public-trace',
      trace.status === 200 &&
        trace.body?.lot?.traceCode === fixtures.traceCode &&
        Boolean(trace.body?.farm) &&
        Array.isArray(trace.body?.farmingEvents) &&
        Array.isArray(trace.body?.traceEvents),
      `HTTP ${trace.status}, lot=${trace.body?.lot?.code ?? '?'}, ` +
        `farm=${trace.body?.farm?.name ?? '?'}, events=${trace.body?.traceEvents?.length ?? '?'}`,
    );

    // ---- Authentication and RBAC ---------------------------------------
    const anonymous = await httpJson(`${api}/auth/me`);
    check('auth-anonymous-401', anonymous.status === 401, `HTTP ${anonymous.status}`);

    const badLogin = await httpJson(`${api}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: DEMO.adminEmail, password: 'DefinitelyWrong-123' }),
    });
    check('auth-invalid-password-401', badLogin.status === 401, `HTTP ${badLogin.status}`);

    const adminLogin = await login(api, DEMO.adminEmail, DEMO.adminPassword);
    check(
      'auth-admin-login',
      adminLogin.status === 200 &&
        adminLogin.body?.user?.role === 'ADMIN' &&
        typeof adminLogin.body?.accessToken === 'string',
      `HTTP ${adminLogin.status}, role=${adminLogin.body?.user?.role ?? '?'}`,
    );
    adminToken = adminLogin.body?.accessToken ?? null;

    const customerLogin = await login(api, DEMO.customerEmail, DEMO.customerPassword);
    check(
      'auth-customer-login',
      customerLogin.status === 200 &&
        customerLogin.body?.user?.role === 'CUSTOMER' &&
        typeof customerLogin.body?.accessToken === 'string',
      `HTTP ${customerLogin.status}, role=${customerLogin.body?.user?.role ?? '?'}`,
    );
    customerToken = customerLogin.body?.accessToken ?? null;

    if (adminToken && customerToken) {
      const customerOnAdmin = await httpJson(`${api}/orders?limit=1`, { token: customerToken });
      check('rbac-customer-admin-route-403', customerOnAdmin.status === 403, `HTTP ${customerOnAdmin.status}`);
      const adminOnCustomer = await httpJson(`${api}/orders/me?limit=1`, { token: adminToken });
      check('rbac-admin-customer-route-403', adminOnCustomer.status === 403, `HTTP ${adminOnCustomer.status}`);
      const adminCart = await httpJson(`${api}/carts/me`, { token: adminToken });
      check('rbac-admin-cart-403', adminCart.status === 403, `HTTP ${adminCart.status}`);
      const customerFarmWrite = await httpJson(`${api}/farms`, {
        method: 'POST',
        token: customerToken,
        body: JSON.stringify({ partnerId: fixtures.partnerId, code: 'SMOKE-DENIED', name: 'Denied' }),
      });
      check(
        'rbac-customer-write-403',
        customerFarmWrite.status === 403,
        `HTTP ${customerFarmWrite.status}`,
      );
      const anonymousCart = await httpJson(`${api}/carts/me`);
      check('rbac-anonymous-cart-401', anonymousCart.status === 401, `HTTP ${anonymousCart.status}`);
    } else {
      check('rbac-checks', false, 'login did not return both tokens');
    }

    // ---- Admin: C-14 authoring/trace read surface -----------------------
    if (adminToken) {
      const adminReads = [
        ['admin-farms', '/farms?limit=5'],
        ['admin-seasons', '/seasons?limit=5'],
        ['admin-season-detail', `/seasons/${fixtures.seasonId}`],
        ['admin-harvests', '/harvests?limit=5'],
        ['admin-harvest-detail', `/harvests/${fixtures.harvestId}`],
        ['admin-farming-events', `/farming-events/season/${fixtures.seasonId}`],
        ['admin-lots', '/lots?limit=5'],
        ['admin-lot-detail', `/lots/${fixtures.lotId}`],
        ['admin-trace-audit', `/trace/admin/lot/${fixtures.lotId}`],
        ['admin-customers', '/customers?limit=5'],
        ['admin-products', '/products/admin?limit=5'],
        ['admin-orders', '/orders?limit=5'],
        ['admin-shipments', '/shipments?limit=5'],
        ['admin-payments', '/payments?limit=5'],
        ['admin-refunds', '/refunds?limit=5'],
        ['admin-returns', '/returns?limit=5'],
        ['admin-quarantine', '/quarantine-cases?limit=5'],
        ['admin-qc', '/qc?limit=5'],
        ['admin-inventory', '/inventory?limit=5'],
        ['admin-inventory-movements', '/inventory/movements?limit=5'],
        ['admin-warehouses', '/warehouses?limit=5'],
        ['admin-settlements', '/settlements?limit=5'],
        ['admin-settlement-adjustments', '/settlement-adjustments?limit=5'],
        ['admin-settlement-recoveries', '/settlement-recoveries?limit=5'],
        ['admin-payouts', '/payouts?limit=5'],
        ['admin-commission-rules', '/commission-rules?limit=5'],
      ];
      for (const [name, path] of adminReads) {
        const response = await httpJson(`${api}${path}`, { token: adminToken });
        const body = response.body;
        const isArray = Array.isArray(body);
        const isList = Array.isArray(body?.data);
        const isObject = body !== null && typeof body === 'object' && !isArray;
        check(
          name,
          response.status === 200 && (isArray || isList || isObject),
          `HTTP ${response.status}, ${
            isArray
              ? `${body.length} row(s) (array)`
              : isList
                ? `${body.data.length} row(s)`
                : 'object'
          }`,
        );
      }

      const seasonDetail = await httpJson(`${api}/seasons/${fixtures.seasonId}`, {
        token: adminToken,
      });
      check(
        'c14-season-children',
        seasonDetail.status === 200 &&
          Array.isArray(seasonDetail.body?.farmingEvents) &&
          Array.isArray(seasonDetail.body?.harvests),
        `HTTP ${seasonDetail.status}, events=${seasonDetail.body?.farmingEvents?.length ?? '?'}, ` +
          `harvests=${seasonDetail.body?.harvests?.length ?? '?'}`,
      );

      const audit = await httpJson(`${api}/trace/admin/lot/${fixtures.lotId}`, {
        token: adminToken,
      });
      check(
        'c14-trace-audit-report',
        audit.status === 200 &&
          Array.isArray(audit.body?.checks) &&
          typeof audit.body?.complete === 'boolean' &&
          audit.body?.lot?.id === fixtures.lotId,
        `HTTP ${audit.status}, complete=${audit.body?.complete ?? '?'}, ` +
          `missing=${audit.body?.missing ?? '?'}, warnings=${audit.body?.warnings ?? '?'}`,
      );

      const recoveries = await httpJson(`${api}/settlement-recoveries?limit=5`, {
        token: adminToken,
      });
      check(
        'c08-recovery-list-contract',
        recoveries.status === 200 && Array.isArray(recoveries.body?.data),
        `HTTP ${recoveries.status}, ${recoveries.body?.data?.length ?? '?'} row(s)`,
      );
    }

    // ---- Customer reads -------------------------------------------------
    if (customerToken) {
      const addresses = await httpJson(`${api}/customers/me/addresses`, { token: customerToken });
      check(
        'customer-addresses',
        addresses.status === 200 && Array.isArray(addresses.body) && addresses.body.length > 0,
        `HTTP ${addresses.status}, ${Array.isArray(addresses.body) ? addresses.body.length : '?'} address(es)`,
      );
      const myOrders = await httpJson(`${api}/orders/me?limit=5`, { token: customerToken });
      check(
        'customer-orders',
        myOrders.status === 200 && Array.isArray(myOrders.body?.data),
        `HTTP ${myOrders.status}, ${myOrders.body?.data?.length ?? '?'} row(s)`,
      );
      const returnable = await httpJson(`${api}/returns/me/eligible-items`, {
        token: customerToken,
      });
      check(
        'customer-returnable-items',
        returnable.status === 200 && Array.isArray(returnable.body?.data),
        `HTTP ${returnable.status}, ${returnable.body?.data?.length ?? '?'} row(s)`,
      );
      const reviewable = await httpJson(`${api}/reviews/me/eligible-items`, {
        token: customerToken,
      });
      check(
        'customer-reviewable-items',
        reviewable.status === 200 && Array.isArray(reviewable.body?.data),
        `HTTP ${reviewable.status}, ${reviewable.body?.data?.length ?? '?'} row(s)`,
      );
      const myCart = await httpJson(`${api}/carts/me`, { token: customerToken });
      check(
        'cart-read',
        myCart.status === 200 && Array.isArray(myCart.body?.items),
        `HTTP ${myCart.status}, ${myCart.body?.items?.length ?? '?'} line(s)`,
      );
    }

    // ---- Cart -> preview -> checkout -> replay -> cancel ----------------
    if (options.noCheckout) {
      result.skipped.push('cart/checkout/cancel flow (--no-checkout)');
    } else if (!customerToken || !adminToken) {
      check('checkout-flow', false, 'checkout flow needs both customer and admin tokens');
    } else {
      variantId = sellableVariant?.id ?? null;
      if (!variantId) {
        check('checkout-flow', false, 'no sellable variant found');
      } else {
        const cleared = await httpJson(`${api}/carts/me`, { method: 'DELETE', token: customerToken });
        check(
          'cart-clear-before-smoke',
          cleared.status === 200 && cleared.body?.items?.length === 0,
          `HTTP ${cleared.status}, ${cleared.body?.items?.length ?? '?'} line(s)`,
        );

        const added = await httpJson(`${api}/carts/me/items`, {
          method: 'POST',
          token: customerToken,
          body: JSON.stringify({ productVariantId: variantId, quantity: 1 }),
        });
        const addedLine = added.body?.items?.find((item) => item.productVariantId === variantId);
        check(
          'cart-add',
          added.status === 201 && Number(addedLine?.quantity) === 1,
          `HTTP ${added.status}, variant=${variantId}, quantity=${addedLine?.quantity ?? '?'}`,
        );

        const cartPreview = await httpJson(`${api}/orders/checkout-preview`, {
          method: 'POST',
          token: customerToken,
          body: JSON.stringify({}),
        });
        check(
          'checkout-preview-cart',
          (cartPreview.status === 200 || cartPreview.status === 201) &&
            cartPreview.body?.itemCount === 1 &&
            Number(cartPreview.body?.grandTotal) > 0 &&
            cartPreview.body?.items?.[0]?.available === true,
          `HTTP ${cartPreview.status}, items=${cartPreview.body?.itemCount ?? '?'}, ` +
            `grandTotal=${cartPreview.body?.grandTotal ?? '?'}, available=${cartPreview.body?.items?.[0]?.available ?? '?'}`,
        );

        const buyNowPreview = await httpJson(`${api}/orders/checkout-preview`, {
          method: 'POST',
          token: customerToken,
          body: JSON.stringify({ items: [{ productVariantId: variantId, quantity: 1 }] }),
        });
        check(
          'checkout-preview-buy-now',
          (buyNowPreview.status === 200 || buyNowPreview.status === 201) &&
            buyNowPreview.body?.itemCount === 1 &&
            Number(buyNowPreview.body?.grandTotal) === Number(cartPreview.body?.grandTotal),
          `HTTP ${buyNowPreview.status}, grandTotal=${buyNowPreview.body?.grandTotal ?? '?'} ` +
            `(cart ${cartPreview.body?.grandTotal ?? '?'})`,
        );

        const cartAfterPreview = await httpJson(`${api}/carts/me`, { token: customerToken });
        check(
          'preview-does-not-mutate-cart',
          cartAfterPreview.body?.items?.length === 1,
          `${cartAfterPreview.body?.items?.length ?? '?'} line(s) after preview`,
        );

        const [reservedRow] = await queryRows(
          parsed,
          'SELECT COALESCE(SUM(reserved), 0) AS reserved FROM inventory_balances WHERE product_variant_id = ?',
          [variantId],
        );
        reservedBefore = Number(reservedRow?.reserved ?? 0);

        const idempotencyKey = `c19smoke-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const checkoutBody = {
          shippingAddress: {
            recipientName: 'C-19 Smoke Customer',
            phone: '0912345601',
            province: 'Hưng Yên',
            district: 'Văn Lâm',
            ward: 'Tân Quang',
            detail: 'Số 1, đường kiểm thử C-19',
          },
          items: [{ productVariantId: variantId, quantity: 1 }],
          source: 'CART',
          paymentMethod: 'COD',
          expectedGrandTotal: Number(cartPreview.body?.grandTotal ?? 0),
          note: 'C-19 business smoke order; cancelled by the same run.',
        };

        const checkout = await httpJson(`${api}/orders/checkout`, {
          method: 'POST',
          token: customerToken,
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(checkoutBody),
        });
        createdOrderId = checkout.body?.id ?? null;
        check(
          'checkout-cod',
          checkout.status === 201 &&
            Number.isInteger(createdOrderId) &&
            checkout.body?.status === 'PENDING_CONFIRMATION' &&
            Number(checkout.body?.grandTotal) === Number(cartPreview.body?.grandTotal),
          `HTTP ${checkout.status}, order=${checkout.body?.code ?? '?'}, ` +
            `status=${checkout.body?.status ?? '?'}, total=${checkout.body?.grandTotal ?? '?'}`,
        );

        if (createdOrderId) {
          const replay = await httpJson(`${api}/orders/checkout`, {
            method: 'POST',
            token: customerToken,
            headers: { 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(checkoutBody),
          });
          check(
            'checkout-idempotent-replay',
            replay.status === 201 && replay.body?.id === createdOrderId,
            `HTTP ${replay.status}, order id=${replay.body?.id ?? '?'} (first ${createdOrderId})`,
          );

          const allocations = await queryRows(
            parsed,
            `SELECT a.quantity, a.order_item_id
               FROM inventory_allocations a
               JOIN order_items oi ON oi.id = a.order_item_id
               JOIN partner_orders po ON po.id = oi.partner_order_id
              WHERE po.order_id = ?`,
            [createdOrderId],
          );
          check(
            'checkout-allocates-stock',
            allocations.length > 0 &&
              allocations.reduce((sum, row) => sum + Number(row.quantity), 0) === 1,
            `${allocations.length} allocation(s), ` +
              `quantity=${allocations.reduce((sum, row) => sum + Number(row.quantity), 0)}`,
          );

          const [reservedDuringRow] = await queryRows(
            parsed,
            'SELECT COALESCE(SUM(reserved), 0) AS reserved FROM inventory_balances WHERE product_variant_id = ?',
            [variantId],
          );
          const reservedDuring = Number(reservedDuringRow?.reserved ?? 0);
          check(
            'checkout-reserves-stock',
            reservedDuring > reservedBefore,
            `reserved ${reservedBefore} -> ${reservedDuring}`,
          );

          const cartAfterCheckout = await httpJson(`${api}/carts/me`, { token: customerToken });
          check(
            'checkout-consumes-cart',
            cartAfterCheckout.body?.items?.length === 0,
            `${cartAfterCheckout.body?.items?.length ?? '?'} line(s) after checkout`,
          );

          const customerOrder = await httpJson(`${api}/orders/me/${createdOrderId}`, {
            token: customerToken,
          });
          check(
            'customer-order-detail',
            customerOrder.status === 200 &&
              customerOrder.body?.id === createdOrderId &&
              Array.isArray(customerOrder.body?.payments) &&
              customerOrder.body?.payments?.length === 1 &&
              customerOrder.body?.payments?.[0]?.method === 'COD',
            `HTTP ${customerOrder.status}, payments=${customerOrder.body?.payments?.length ?? '?'}, ` +
              `method=${customerOrder.body?.payments?.[0]?.method ?? '?'}`,
          );

          const adminOrders = await httpJson(
            `${api}/orders?search=${encodeURIComponent(checkout.body.code)}&limit=5`,
            { token: adminToken },
          );
          check(
            'admin-customer-sync',
            adminOrders.status === 200 &&
              itemsOf(adminOrders.body).some((order) => order.id === createdOrderId),
            `HTTP ${adminOrders.status}, found=${itemsOf(adminOrders.body).some(
              (order) => order.id === createdOrderId,
            )}`,
          );

          const cancelled = await httpJson(`${api}/orders/me/${createdOrderId}/cancel`, {
            method: 'POST',
            token: customerToken,
          });
          check(
            'order-cancel',
            cancelled.status === 201 && cancelled.body?.status === 'CANCELLED',
            `HTTP ${cancelled.status}, status=${cancelled.body?.status ?? '?'}`,
          );

          const [reservedAfterRow] = await queryRows(
            parsed,
            'SELECT COALESCE(SUM(reserved), 0) AS reserved FROM inventory_balances WHERE product_variant_id = ?',
            [variantId],
          );
          check(
            'cancel-releases-reservation',
            Math.abs(Number(reservedAfterRow?.reserved ?? 0) - reservedBefore) < 0.0005,
            `reserved ${reservedBefore} -> ${reservedAfterRow?.reserved ?? '?'}`,
          );

          const adminOrder = await httpJson(`${api}/orders/${createdOrderId}`, {
            token: adminToken,
          });
          check(
            'admin-sees-cancelled-order',
            adminOrder.status === 200 && adminOrder.body?.status === 'CANCELLED',
            `HTTP ${adminOrder.status}, status=${adminOrder.body?.status ?? '?'}`,
          );
          createdOrderId = null;
        }

        const finalClear = await httpJson(`${api}/carts/me`, {
          method: 'DELETE',
          token: customerToken,
        });
        check(
          'cart-clear-after-smoke',
          finalClear.status === 200 && finalClear.body?.items?.length === 0,
          `HTTP ${finalClear.status}, ${finalClear.body?.items?.length ?? '?'} line(s)`,
        );
      }
    }

    // ---- Mobile endpoint compatibility ---------------------------------
    const docs = await openApiPaths(baseUrl);
    const mobile = mobileRoutePatterns();
    const missingMobileRoutes = mobile.paths.filter((path) => !docs.paths.has(path));
    check(
      'mobile-openapi-compatibility',
      mobile.paths.length > 0 && missingMobileRoutes.length === 0,
      missingMobileRoutes.length
        ? `missing: ${missingMobileRoutes.join(', ')}`
        : `${mobile.paths.length} mobile route(s) present in ${docs.count} OpenAPI path(s)`,
    );

    result.result = result.failures.length === 0 ? 'PASS' : 'FAIL';
  } catch (error) {
    result.failures.push(error.message);
    result.result = 'FAIL';
  } finally {
    if (createdOrderId && customerToken) {
      try {
        await httpJson(`${api}/orders/me/${createdOrderId}/cancel`, {
          method: 'POST',
          token: customerToken,
          timeoutMs: 10_000,
        });
      } catch {
        // Best effort; the order stays visible for investigation.
      }
    }
    if (customerToken) {
      try {
        await httpJson(`${api}/carts/me`, {
          method: 'DELETE',
          token: customerToken,
          timeoutMs: 10_000,
        });
      } catch {
        // Best effort.
      }
    }
    const stopped = await server.stop();
    result.apiExit = stopped;
    result.apiLogTail = tail(readLog(logFile), 30);
    result.logFile = logFile;
    result.completedAt = nowIso();
  }

  return result;
}

async function login(api, email, password) {
  return httpJson(`${api}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    timeoutMs: 20_000,
  });
}

function readLog(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

async function loadFixtures(parsed) {
  const [farm] = await queryRows(
    parsed,
    `SELECT f.id, f.partner_id FROM farms f ORDER BY f.id LIMIT 1`,
  );
  const [season] = await queryRows(
    parsed,
    `SELECT s.id, s.farm_id FROM seasons s ORDER BY s.id LIMIT 1`,
  );
  const [harvest] = await queryRows(
    parsed,
    `SELECT h.id FROM harvests h ORDER BY h.id LIMIT 1`,
  );
  const [lot] = await queryRows(
    parsed,
    `SELECT pl.id, pl.trace_code, pl.product_id
       FROM product_lots pl
      WHERE pl.status = 'SELLABLE' AND pl.trace_code IS NOT NULL
      ORDER BY pl.id LIMIT 1`,
  );
  if (!farm || !season || !harvest || !lot) {
    throw new Error('The run schema is not seeded with demo farm/season/harvest/lot data.');
  }
  return {
    farmId: Number(farm.id),
    partnerId: Number(farm.partner_id),
    seasonId: Number(season.id),
    harvestId: Number(harvest.id),
    lotId: Number(lot.id),
    traceCode: String(lot.trace_code),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/business-smoke.mjs --url <isolated-mysql-url> [options]

Options:
  --url <url>        Disposable, seeded schema (required)
  --port <port>      API port (default: 3100; must be free)
  --out <file>       Write the full result JSON here
  --log-dir <dir>    Directory for the API log
  --no-checkout      Read-only mode: skip cart/checkout/cancel mutations
  --help             Show this help

Environment overrides for the demo accounts:
  VERIFY_ADMIN_EMAIL, VERIFY_ADMIN_PASSWORD
  VERIFY_CUSTOMER_EMAIL, VERIFY_CUSTOMER_PASSWORD

The API is started from apps/api/dist/src/main.js. Run the workspace build
first. The script refuses a URL that is not an isolated *_test/_restore/_drill
schema and never touches DATABASE_URL.`);
    process.exit(0);
  }
  loadProjectEnv();
  const url = valueOf(args, '--url') ?? process.env.VERIFY_DATABASE_URL;
  if (!url) throw new Error('--url (or VERIFY_DATABASE_URL) is required.');
  if (!existsSync(join(API_DIR, 'dist', 'src', 'main.js'))) {
    throw new Error('apps/api/dist/src/main.js is missing; run `npm run build` first.');
  }
  const result = await runBusinessSmoke(url, {
    port: Number(valueOf(args, '--port', '3100')),
    outDir: valueOf(args, '--out-dir', undefined),
    logDir: valueOf(args, '--log-dir', undefined),
    noCheckout: args.includes('--no-checkout'),
  });
  const out = valueOf(args, '--out');
  if (out) writeJson(out, result);

  console.log(`Business smoke: ${result.result}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} - ${check.detail}`);
  }
  for (const skipped of result.skipped) console.log(`  SKIP  ${skipped}`);
  for (const warning of result.warnings) console.log(`  WARN  ${redactText(warning)}`);
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  - ${redactText(failure)}`);
    if (result.apiLogTail) console.error(`\nAPI log tail:\n${result.apiLogTail}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`Business smoke failed: ${redactText(error.message)}`);
    process.exit(1);
  });
}
