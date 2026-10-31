import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
  CUSTOMER_EMAIL,
  CUSTOMER_PASSWORD,
  apiLogin,
  bearer,
  createCodOrder,
  firstSellableVariant,
  type CreatedOrder,
} from '../support/api';

/** Same shape as `apps/admin-web/src/lib/format` — the UI must print exactly this. */
function vnd(value: string | number): string {
  const n = Math.round(Number(value));
  return `${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}

/**
 * Admin order detail — real browser, real API, real PDF bytes.
 *
 * The order is created through the public checkout endpoint so the page always
 * has a deterministic PENDING_CONFIRMATION order to render (the seeded dataset
 * may put every order in a later state).
 */

async function seedOrder(request: APIRequestContext): Promise<CreatedOrder> {
  const token = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  const variant = await firstSellableVariant(request);
  return createCodOrder(request, token, variant.id, 1, { note: 'E2E admin detail' });
}

test.describe('Admin order detail', () => {
  test('renders every section for a real order', async ({ page, request }, testInfo) => {
    const order = await seedOrder(request);

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByRole('heading', { name: `Đơn hàng ${order.code}` })).toBeVisible();
    await expect(page.getByText('Chờ xác nhận').first()).toBeVisible();

    // Five sections, not one long table.
    for (const tab of ['Tổng quan', 'Thanh toán', 'Vận chuyển', 'Tài chính nội bộ']) {
      await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible();
    }

    // The money summary is the one-glance block above the tabs.
    for (const label of ['Tổng thanh toán', 'Đã thu', 'Còn phải thu', 'Đã hoàn tiền']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }

    if (testInfo.project.name === 'admin-small') {
      // A 390px viewport stacks the header/summary and lets Ant Design move the
      // overflowing tabs into its "more" control; the page itself must never
      // scroll horizontally. Tab *content* is identical at both widths and is
      // asserted on desktop below, where the tab strip fits.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      // xs=12 → the four summary cards form a 2×2 grid instead of one row.
      const first = await page.locator('.agri-card').filter({ hasText: 'Tổng thanh toán' }).first().boundingBox();
      const second = await page.locator('.agri-card').filter({ hasText: 'Đã thu' }).first().boundingBox();
      expect(first && second).toBeTruthy();
      expect(Math.abs((first?.y ?? 0) - (second?.y ?? 0))).toBeLessThan(2);
      return;
    }

    await expect(page.getByText('Khách hàng & giao nhận')).toBeVisible();
    await expect(page.getByText('Tổng thanh toán').first()).toBeVisible();

    // Cross-system consistency: the money block must print the stored order
    // snapshot, not a value recomputed in the browser.
    const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const raw = await request.get(`${API_BASE}/orders/${order.id}`, {
      headers: bearer(adminToken),
    });
    expect(raw.status()).toBe(200);
    const stored = (await raw.json()) as { grandTotal: string; subtotal: string };
    await expect(page.getByText(vnd(stored.grandTotal)).first()).toBeVisible();
    await expect(page.getByText(vnd(stored.subtotal)).first()).toBeVisible();

    await page.getByRole('tab', { name: /Sản phẩm/ }).click();
    await expect(page.getByText(/Đối tác:/).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Thanh toán' }).click();
    const paymentPanel = page.getByRole('tabpanel', { name: 'Thanh toán' });
    await expect(paymentPanel.getByText('Tổng hợp thanh toán')).toBeVisible();
    await expect(paymentPanel.getByText('Tổng phải thu')).toBeVisible();
    await expect(paymentPanel.getByText('Còn phải thu')).toBeVisible();
    await expect(paymentPanel.getByText('Lịch sử thanh toán')).toBeVisible();
    await expect(paymentPanel.getByText('Chờ thanh toán').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Vận chuyển' }).click();
    await expect(page.getByText('Chưa tạo vận đơn cho đối tác này.')).toBeVisible();

    await page.getByRole('tab', { name: 'Tài chính nội bộ' }).click();
    await expect(page.getByText('Số liệu nội bộ')).toBeVisible();
    await expect(
      page.getByText('Đơn đối tác này chưa được đưa vào kỳ quyết toán nào.'),
    ).toBeVisible();

    // A rendering bug would surface as a literal object string.
    await expect(page.locator('body')).not.toContainText('[object Object]');
  });

  test('previews and downloads the backend PDF (order + packing slip)', async ({ page, request }) => {
    const order = await seedOrder(request);
    await page.goto(`/orders/${order.id}`);

    const orderPdf = page.waitForResponse(
      (r) => r.url().includes(`/orders/${order.id}/pdf`) && r.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Xem trước phiếu' }).click();
    const orderResponse = await orderPdf;
    expect(orderResponse.status()).toBe(200);
    expect(orderResponse.headers()['content-type']).toContain('application/pdf');

    const modal = page.getByRole('dialog', { name: 'Phiếu xác nhận đơn hàng' });
    await expect(modal).toBeVisible();
    const frame = modal.locator('iframe');
    await expect(frame).toBeVisible();
    expect(await frame.getAttribute('src')).toMatch(/^blob:/);

    // Both the header X and the footer button are named "Đóng".
    await modal.getByRole('button', { name: 'Đóng' }).last().click();
    await expect(modal).toBeHidden();

    const packing = page.waitForResponse(
      (r) => r.url().includes(`/orders/${order.id}/packing-slip`) && r.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Xem trước soạn hàng' }).click();
    const packingResponse = await packing;
    expect(packingResponse.status()).toBe(200);
    expect(packingResponse.headers()['content-type']).toContain('application/pdf');
    const packingModal = page.getByRole('dialog', { name: 'Phiếu soạn hàng (nội bộ)' });
    await expect(packingModal).toBeVisible();
    await packingModal.getByRole('button', { name: 'Đóng' }).last().click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải phiếu PDF' }).click();
    const download = await downloadPromise;
    const file = await download.path();
    expect(file).toBeTruthy();
    const bytes = await readFile(file as string);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  test('shows the error state for 500 and a toast for a forbidden PDF', async ({ page, request }) => {
    const order = await seedOrder(request);

    await page.route(`**/api/v1/orders/${order.id}`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }),
    );
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText('Không tải được đơn hàng.')).toBeVisible();
    await page.unroute(`**/api/v1/orders/${order.id}`);

    await page.getByRole('button', { name: /Thử lại/ }).click();
    await expect(page.getByRole('heading', { name: `Đơn hàng ${order.code}` })).toBeVisible();

    await page.route(`**/api/v1/orders/${order.id}/pdf`, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: '{"statusCode":403,"message":"Forbidden resource"}',
      }),
    );
    await page.getByRole('button', { name: 'Xem trước phiếu' }).click();
    await expect(page.locator('.ant-message')).toBeVisible();
    await expect(page.locator('.ant-modal-content')).toBeHidden();
  });

  test('offers the backend state machine transitions', async ({ page, request }) => {
    const order = await seedOrder(request);
    await page.goto(`/orders/${order.id}`);

    await page.getByRole('button', { name: 'Chuyển trạng thái' }).click();
    await expect(page.getByRole('menuitem', { name: 'Xác nhận đơn' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Hủy đơn' })).toBeVisible();
    // Escape closes the menu; this test must not mutate the order.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Xác nhận đơn' })).toBeHidden();
  });
});
