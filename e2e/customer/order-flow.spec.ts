import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
  CUSTOMER_EMAIL,
  CUSTOMER_PASSWORD,
  OTHER_CUSTOMER_EMAIL,
  apiLogin,
  bearer,
  createCodOrder,
  fetchOrderPdf,
  firstSellableVariant,
  markPaymentPaid,
  refundOrder,
  setOrderStatus,
} from '../support/api';

/**
 * Customer storefront — real browser against the real API.
 *
 * Covers: login, COD checkout through the buy-now flow, order detail, the
 * backend PDF (view + download), ownership scoping (another customer's
 * document answers 404), voucher rendering, and the refund/payment status the
 * customer is allowed to see.
 */

function vnd(value: string | number): string {
  const n = Math.round(Number(value));
  const grouped = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${grouped} ₫`;
}

test.describe('Customer order flow', () => {
  test('places a COD order and opens/downloads its PDF', async ({ page, request }) => {
    const variant = await firstSellableVariant(request);

    await page.goto(`/thanh-toan?mua-ngay=${variant.id}:1`);
    const placeOrder = page.getByRole('button', { name: /Đặt hàng/ });
    await expect(placeOrder).toBeEnabled({ timeout: 30_000 });
    await placeOrder.click();

    await expect(page).toHaveURL(/\/dat-hang-thanh-cong\/\d+/, { timeout: 30_000 });
    const orderId = Number(page.url().match(/\/dat-hang-thanh-cong\/(\d+)/)?.[1]);
    expect(orderId).toBeGreaterThan(0);

    await page.goto(`/don-hang/${orderId}`);
    // The page header and the breadcrumb both say "Chi tiết đơn"; the main
    // region is the one that matters here.
    await expect(page.getByRole('main').getByText('Chi tiết đơn')).toBeVisible();
    await expect(page.getByText(/^Đặt lúc/)).toBeVisible();
    await expect(page.getByText('Thanh toán khi nhận hàng (COD)')).toBeVisible();

    // The document card fetches the real backend PDF with the session token.
    const pdfResponse = page.waitForResponse(
      (r) => r.url().includes(`/orders/${orderId}/pdf`) && r.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Xem phiếu' }).click();
    const response = await pdfResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    await expect(page.getByRole('dialog')).toBeVisible();
    const frame = page.getByRole('dialog').locator('iframe');
    await expect(frame).toBeVisible();
    expect(await frame.getAttribute('src')).toMatch(/^blob:/);
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải PDF' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const bytes = await readFile(path as string);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // The customer never sees the internal settlement trail.
    await expect(page.locator('body')).not.toContainText('Hoa hồng');
    await expect(page.locator('body')).not.toContainText('Quyết toán');
    await expect(page.locator('body')).not.toContainText('[object Object]');
  });

  test('cannot read another customer document', async ({ request }) => {
    const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const variant = await firstSellableVariant(request);
    const order = await createCodOrder(request, customerToken, variant.id, 1);

    const own = await fetchOrderPdf(request, customerToken, order.id);
    expect(own.status).toBe(200);
    expect(own.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const otherToken = await apiLogin(request, OTHER_CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const other = await fetchOrderPdf(request, otherToken, order.id);
    expect(other.status).toBe(404);
    expect(other.body.toString('utf8')).not.toContain('%PDF');

    const anonymous = await request.get(`${API_BASE}/orders/${order.id}/pdf`);
    expect(anonymous.status()).toBe(401);
  });

  test('shows a voucher once and keeps the snapshot total', async ({ page, request }) => {
    const token = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const variant = await firstSellableVariant(request);
    const quantity = Math.max(1, Math.ceil(300_000 / Math.max(1, variant.unitPrice)) + 1);
    test.skip(
      variant.available < quantity,
      `Not enough stock for a voucher order (need ${quantity}, have ${variant.available}).`,
    );

    const order = await createCodOrder(request, token, variant.id, quantity, {
      voucherCode: 'HUNGYEN50K',
    });

    await page.goto(`/don-hang/${order.id}`);
    // The receipt names the voucher by its code, not by the internal row id:
    // "Mã voucher #3" is meaningless to the customer.
    await expect(page.getByText(/^Mã voucher HUNGYEN50K$/)).toBeVisible();
    await expect(page.getByText('đã tính trong Giảm giá')).toBeVisible();
    await expect(page.getByText(vnd(order.grandTotal)).first()).toBeVisible();
  });

  test('shows a partial refund and the payment status', async ({ page, request }) => {
    const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const variant = await firstSellableVariant(request);
    const order = await createCodOrder(request, customerToken, variant.id, 1);
    const payment = order.payments?.[0];
    expect(payment).toBeTruthy();

    // Walk the real state machine to DELIVERED, then record the COD collection.
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_TO_SHIP', 'SHIPPING', 'DELIVERED']) {
      await setOrderStatus(request, adminToken, order.id, status);
    }
    await markPaymentPaid(request, adminToken, payment!.id, `E2E-COD-${order.id}`);
    await refundOrder(request, adminToken, payment!.id, 10_000, `E2E-RF-${order.id}`);

    await page.goto(`/don-hang/${order.id}`);
    await expect(page.getByText('Hoàn một phần')).toBeVisible();
    await expect(page.getByText('Hoàn tiền', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E hoàn tiền một phần')).toBeVisible();
    await expect(page.getByText(vnd(10_000)).first()).toBeVisible();
  });
});
