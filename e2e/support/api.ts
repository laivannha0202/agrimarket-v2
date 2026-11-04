import { expect, type APIRequestContext } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Shared HTTP helpers for the browser suites (setup + assertions). */
export const API_ORIGIN = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';
export const API_BASE = `${API_ORIGIN}/api/v1`;

export const ADMIN_EMAIL = 'admin@agrimarket.vn';
export const ADMIN_PASSWORD = 'Admin@12345';
export const CUSTOMER_EMAIL = 'lan.nguyen@agrimarket.vn';
export const CUSTOMER_PASSWORD = 'Agri@12345';
export const OTHER_CUSTOMER_EMAIL = 'hung.tran@agrimarket.vn';

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * `/auth/login` is throttled to 10 attempts per minute per IP+account — the
 * guard is correct, but a suite that logs in before every test hits it (the
 * 11th call answers 429 and the test fails for the wrong reason). Tokens are
 * cached per e-mail for the run and only re-minted when the JWT is about to
 * expire. The cache lives in the git-ignored `e2e/.auth/` folder.
 */
const TOKEN_CACHE = path.resolve(__dirname, '..', '.auth', 'api-tokens.json');

function readCache(): Record<string, { token: string; exp: number }> {
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE, 'utf8')) as Record<
      string,
      { token: string; exp: number }
    >;
  } catch {
    return {};
  }
}

function cachedToken(email: string): string | null {
  const entry = readCache()[email];
  if (!entry?.token) return null;
  // Re-mint a minute before expiry so a slow test cannot use a dead token.
  return entry.exp * 1000 - 60_000 > Date.now() ? entry.token : null;
}

function rememberToken(email: string, token: string): void {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: number };
    const cache = readCache();
    cache[email] = { token, exp: payload.exp ?? 0 };
    mkdirSync(path.dirname(TOKEN_CACHE), { recursive: true });
    writeFileSync(TOKEN_CACHE, JSON.stringify(cache, null, 2));
  } catch {
    // A cache write is an optimisation, never a reason to fail a test.
  }
}

export async function apiLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const cached = cachedToken(email);
  if (cached) return cached;
  const res = await request.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(res.status(), `login ${email}`).toBe(200);
  const body = (await res.json()) as { accessToken: string };
  rememberToken(email, body.accessToken);
  return body.accessToken;
}

export interface SellableVariant {
  id: number;
  unitPrice: number;
  available: number;
  productName: string;
}

/** First product variant with real sellable stock, from the public catalogue. */
export async function firstSellableVariant(request: APIRequestContext): Promise<SellableVariant> {
  const res = await request.get(`${API_BASE}/products?limit=30`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    data: {
      name: string;
      variants: {
        id: number;
        basePrice: string | number;
        availableQuantity: number;
        inStock: boolean;
        effectivePrice?: { unitPrice: number };
      }[];
    }[];
  };
  for (const product of body.data ?? []) {
    for (const variant of product.variants ?? []) {
      if (variant.inStock && variant.availableQuantity > 0) {
        return {
          id: variant.id,
          unitPrice: Number(variant.effectivePrice?.unitPrice ?? variant.basePrice),
          available: variant.availableQuantity,
          productName: product.name,
        };
      }
    }
  }
  throw new Error('No sellable product variant found in the seeded catalogue.');
}

export interface CreatedOrder {
  id: number;
  code: string;
  grandTotal: string;
  payments?: { id: number; method: string; status: string; amount: string }[];
}

/** Creates a COD order through the real checkout endpoint. */
export async function createCodOrder(
  request: APIRequestContext,
  token: string,
  variantId: number,
  quantity: number,
  options: { voucherCode?: string; note?: string } = {},
): Promise<CreatedOrder> {
  const res = await request.post(`${API_BASE}/orders/checkout`, {
    headers: bearer(token),
    data: {
      shippingAddress: {
        recipientName: 'Nguyễn Thị Lan',
        phone: '0912345601',
        province: 'Hưng Yên',
        district: 'Văn Lâm',
        ward: 'Tân Quang',
        detail: 'Số 12, đường Nguyễn Văn Linh',
      },
      items: [{ productVariantId: variantId, quantity }],
      paymentMethod: 'COD',
      source: 'BUY_NOW',
      voucherCode: options.voucherCode,
      note: options.note,
      idempotencyKey: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const created = (await res.json()) as CreatedOrder;
  // The checkout response returns the order row, not its payment. The browser
  // tests need the payment id (to record collection / create a refund), so the
  // helper reads the detail endpoint the customer UI also uses.
  // Customers read their own orders through `/orders/me/:id`; `/orders/:id`
  // is the ADMIN route and answers 403 to a customer token.
  const detail = await request.get(`${API_BASE}/orders/me/${created.id}`, {
    headers: bearer(token),
  });
  expect(detail.status()).toBe(200);
  const body = (await detail.json()) as { payments?: CreatedOrder['payments'] };
  return { ...created, payments: body.payments ?? [] };
}

export async function setOrderStatus(
  request: APIRequestContext,
  token: string,
  orderId: number,
  status: string,
): Promise<void> {
  const res = await request.patch(`${API_BASE}/orders/${orderId}/status`, {
    headers: bearer(token),
    data: { status },
  });
  expect(res.status(), await res.text()).toBe(200);
}

export interface CreatedShipment {
  id: number;
  code: string;
  status: string;
}

/**
 * Walk a freshly created order to READY_TO_SHIP through the real admin state
 * machine. DELIVERED is deliberately not in this list: it is only reachable
 * through shipment delivery evidence.
 */
export async function advanceOrderToReadyToShip(
  request: APIRequestContext,
  token: string,
  orderId: number,
): Promise<void> {
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_TO_SHIP']) {
    await setOrderStatus(request, token, orderId, status);
  }
}

/**
 * Deliver an order the only way the backend accepts: create a shipment for
 * every eligible partner order, move them all IN_TRANSIT (the last one rolls
 * the parent order to SHIPPING), then OUT_FOR_DELIVERY → DELIVERED. The final
 * parcel rolls the order up to DELIVERED and consumes its reservations.
 *
 * Creating all parcels before moving any is required for a multi-partner
 * order: delivering one parcel while a sibling is still READY_TO_SHIP is
 * correctly rejected by the shipment state machine.
 */
export async function deliverOrderViaShipment(
  request: APIRequestContext,
  token: string,
  orderId: number,
): Promise<CreatedShipment[]> {
  const eligibleRes = await request.get(`${API_BASE}/shipments/eligible-partner-orders`, {
    headers: bearer(token),
  });
  expect(eligibleRes.status(), await eligibleRes.text()).toBe(200);
  const eligible = (await eligibleRes.json()) as {
    id: number;
    code: string;
    order: { id: number; code: string };
  }[];
  const partnerOrders = eligible.filter((po) => po.order.id === orderId);
  expect(
    partnerOrders.length,
    `order ${orderId} must have a READY_TO_SHIP partner order without an active shipment`,
  ).toBeGreaterThan(0);

  const shipments: CreatedShipment[] = [];
  for (const partnerOrder of partnerOrders) {
    const created = await request.post(`${API_BASE}/shipments`, {
      headers: bearer(token),
      data: {
        partnerOrderId: partnerOrder.id,
        carrier: 'GHN',
        trackingCode: `E2E-${orderId}-${partnerOrder.id}`,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    shipments.push((await created.json()) as CreatedShipment);
  }

  for (const status of ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    for (const shipment of shipments) {
      const updated = await request.patch(`${API_BASE}/shipments/${shipment.id}/status`, {
        headers: bearer(token),
        data: { status },
      });
      expect(updated.status(), await updated.text()).toBe(200);
      shipment.status = status;
    }
  }

  const detail = await request.get(`${API_BASE}/orders/${orderId}`, {
    headers: bearer(token),
  });
  expect(detail.status(), await detail.text()).toBe(200);
  const order = (await detail.json()) as { status: string };
  expect(order.status, 'shipment delivery must roll the order up to DELIVERED').toBe('DELIVERED');
  return shipments;
}

export async function markPaymentPaid(
  request: APIRequestContext,
  token: string,
  paymentId: number,
  reference: string,
): Promise<void> {
  const res = await request.patch(`${API_BASE}/payments/${paymentId}/status`, {
    headers: bearer(token),
    data: { status: 'PAID', transactionReference: reference },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Creates + approves + completes a refund (admin token). */
export async function refundOrder(
  request: APIRequestContext,
  token: string,
  paymentId: number,
  amount: number,
  reference: string,
): Promise<{ id: number }> {
  const created = await request.post(`${API_BASE}/refunds`, {
    // The refund endpoint is idempotent by contract and rejects a request
    // without the key, exactly like the admin UI which always sends one.
    headers: { ...bearer(token), 'Idempotency-Key': `e2e-refund-${paymentId}-${amount}` },
    data: { paymentId, amount, reason: 'E2E hoàn tiền một phần' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const refund = (await created.json()) as { id: number };

  const approved = await request.post(`${API_BASE}/refunds/${refund.id}/approve`, {
    headers: bearer(token),
    data: {},
  });
  expect(approved.status(), await approved.text()).toBe(201);

  const completed = await request.post(`${API_BASE}/refunds/${refund.id}/complete`, {
    headers: bearer(token),
    data: { reference },
  });
  expect(completed.status(), await completed.text()).toBe(201);
  return refund;
}

/** Raw PDF request, used to prove the bytes are a real PDF and are scoped. */
export async function fetchOrderPdf(
  request: APIRequestContext,
  token: string,
  orderId: number,
): Promise<{ status: number; contentType: string; body: Buffer }> {
  const res = await request.get(`${API_BASE}/orders/${orderId}/pdf`, {
    headers: bearer(token),
  });
  return {
    status: res.status(),
    contentType: res.headers()['content-type'] ?? '',
    body: await res.body(),
  };
}
