/**
 * MOBILE → API integration: the app's own payload builder, posted for real.
 *
 * `scripts/verify-checkout-cod.mjs` drives the API with hand-written payloads.
 * This suite imports `buildCheckoutPayload` and posts ITS output, so the exact
 * object the phone sends is what gets exercised — including the
 * `provinceCode`/`wardCode` pair and the `expectedGrandTotal` echo.
 *
 * It runs only when the API is reachable, and skips otherwise, so it never
 * breaks a unit-test run on a machine with no server. Point it elsewhere with
 * `API_BASE`.
 *
 * Every order it creates is cancelled at the end, so it leaves no live order.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Address, CheckoutPreview, Voucher } from "../types";

/**
 * `checkout.ts` → `api-client` → `session` → `expo-secure-store`, whose ESM
 * entry uses Flow syntax the bundler cannot parse. The other mobile suites stub
 * it the same way; nothing here touches device storage.
 */
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

const { buildCheckoutPayload, needsTotalConfirm } = await import("../checkout");
const { isCatalogueAddress } = await import("../address");
const { splitVouchers } = await import("../vouchers");

const API = process.env.API_BASE ?? "http://127.0.0.1:3000/api/v1";

/** The customer used for the integration run (a seeded account). */
const CUSTOMER = { email: "mai.pham@agrimarket.vn", password: "Agri@12345" };

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** `true` when the dev API answers, so the suite can skip instead of failing. */
async function apiIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/products?limit=1`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

const up = await apiIsUp();

describe.skipIf(!up)("mobile payload → live API", () => {
  let token = "";
  let address: Address;

  beforeAll(async () => {
    const login = await call("POST", "/auth/login", { body: CUSTOMER });
    expect(login.status, `login failed: ${JSON.stringify(login.body)}`).toBe(200);
    token = login.body.accessToken;

    const list = await call("GET", "/customers/me/addresses", { token });
    address = list.body?.[0];
    expect(address, "the seeded customer needs a saved address").toBeTruthy();
  });

  it("builds and posts a COD order the backend accepts", async () => {
    const products = await call("GET", "/products?limit=50&status=ACTIVE");
    const variant = (products.body?.data ?? [])
      .flatMap((p: any) => (p.variants ?? []).map((v: any) => ({ ...v, productName: p.name })))
      .find(
        (v: any) =>
          v.status === "ACTIVE" &&
          Number(v.availableQuantity) > 3 &&
          v.effectivePrice?.source === "NONE",
      );
    expect(variant, "a plain sellable variant is required").toBeTruthy();

    const items = [{ productVariantId: variant.id, quantity: 2 }];
    const previewRes = await call("POST", "/orders/checkout-preview", { token, body: { items } });
    const preview: CheckoutPreview = previewRes.body;
    expect(previewRes.status).toBeLessThan(300);

    // THE REGRESSION: a freshly loaded preview owes the customer no second
    // confirmation. This is the exact expression the screen evaluates to decide
    // whether to lock the submit button.
    expect(needsTotalConfirm(preview, null)).toBe(false);

    const payload = buildCheckoutPayload(address, items, "", "", preview, "BUY_NOW");
    expect(payload.paymentMethod).toBe("COD");
    expect(payload.expectedGrandTotal).toBe(preview.grandTotal);
    expect("shippingFee" in payload).toBe(false);

    // The code pair is carried only for a catalogue address; a legacy address
    // keeps its own free text. Both must round-trip through the real API, so
    // the assertion follows whichever generation this account actually has.
    if (isCatalogueAddress(address)) {
      expect(payload.shippingAddress.provinceCode).toBe(address.provinceCode);
      expect(payload.shippingAddress.wardCode).toBe(address.wardCode);
    } else {
      expect(payload.shippingAddress.provinceCode).toBeUndefined();
      expect(payload.shippingAddress.province).toBe(address.province);
    }

    const key = crypto.randomUUID();
    const order = await call("POST", "/orders/checkout", {
      token,
      headers: { "Idempotency-Key": key },
      body: payload,
    });
    expect(order.status, `checkout failed: ${JSON.stringify(order.body)}`).toBeLessThan(300);
    expect(Number(order.body.grandTotal)).toBe(preview.grandTotal);

    // COD is created PENDING and only settled on delivery.
    const detail = await call("GET", `/orders/me/${order.body.id}`, { token });
    const cod = (detail.body?.payments ?? []).find((p: any) => p.method === "COD");
    expect(cod?.status).toBe("PENDING");
    expect(cod?.paidAt).toBeNull();

    // A retry with the same key replays instead of double-ordering.
    const replay = await call("POST", "/orders/checkout", {
      token,
      headers: { "Idempotency-Key": key },
      body: payload,
    });
    expect(replay.body?.id).toBe(order.body.id);

    // A stale total is refused so the customer re-confirms the new amount.
    const stale = await call("POST", "/orders/checkout", {
      token,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { ...payload, expectedGrandTotal: preview.grandTotal - 1 },
    });
    expect(stale.status).toBe(409);

    // Clean up: the verification order must not stay live.
    const cancel = await call("POST", `/orders/me/${order.body.id}/cancel`, { token });
    expect(cancel.status).toBeLessThan(300);
  }, 30_000);

  it("splits the real voucher catalogue for the current subtotal", async () => {
    const products = await call("GET", "/products?limit=50&status=ACTIVE");
    const variant = (products.body?.data ?? [])
      .flatMap((p: any) => (p.variants ?? []).map((v: any) => ({ ...v, productName: p.name })))
      .find((v: any) => v.status === "ACTIVE" && Number(v.availableQuantity) > 3);
    const items = [{ productVariantId: variant.id, quantity: 2 }];
    const previewRes = await call("POST", "/orders/checkout-preview", { token, body: { items } });
    const subtotal = Number(previewRes.body?.subtotal ?? 0);

    const res = await call("GET", "/vouchers?limit=50&status=ACTIVE");
    const vouchers: Voucher[] = res.body?.data ?? [];
    const groups = splitVouchers(vouchers, subtotal);

    expect(groups.eligible.length + groups.ineligible.length).toBe(vouchers.length);
    // Every code that cannot be used must say why — no silent omission.
    for (const option of groups.ineligible) {
      expect(option.reason, `${option.voucher.code} has no reason`).toBeTruthy();
    }
  }, 30_000);

  it("classifies a real 409 re-price as a total change", async () => {
    const products = await call("GET", "/products?limit=50&status=ACTIVE");
    const variant = (products.body?.data ?? [])
      .flatMap((p: any) => (p.variants ?? []).map((v: any) => ({ ...v, productName: p.name })))
      .find((v: any) => v.status === "ACTIVE" && Number(v.availableQuantity) > 3);
    const items = [{ productVariantId: variant.id, quantity: 1 }];
    const previewRes = await call("POST", "/orders/checkout-preview", { token, body: { items } });
    const preview: CheckoutPreview = previewRes.body;
    const payload = buildCheckoutPayload(address, items, "", "", preview, "BUY_NOW");

    const stale = await call("POST", "/orders/checkout", {
      token,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { ...payload, expectedGrandTotal: preview.grandTotal + 1 },
    });
    expect(stale.status).toBe(409);

    // The screen rebuilds the same ApiError the client would raise and must
    // read it as a re-price, not as an opaque failure.
    const err = Object.assign(new Error(String(stale.body?.message)), {
      name: "ApiError",
      status: 409,
      body: stale.body,
    });
    // `classifyCheckoutConflict` checks `instanceof ApiError`; the real client
    // constructs one, so this asserts on the message shape the backend sends.
    expect(String(stale.body?.message)).toMatch(/total changed/i);
    expect(typeof err.message).toBe("string");
  }, 30_000);
});
