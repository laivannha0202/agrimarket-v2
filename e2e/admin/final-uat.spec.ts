import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
  CUSTOMER_EMAIL,
  CUSTOMER_PASSWORD,
  OTHER_CUSTOMER_EMAIL,
  advanceOrderToReadyToShip,
  apiLogin,
  bearer,
  createCodOrder,
  deliverOrderViaShipment,
  firstSellableVariant,
  refundOrder,
} from '../support/api';

/**
 * Final acceptance UAT — real browser, real API, isolated `_test` schema.
 *
 * The scenarios map to the final fix round's acceptance targets:
 *  - six finance figures are the stored values, not a UI re-computation;
 *  - DELIVERED cannot be chosen by hand and needs shipment evidence;
 *  - the shipment picker only offers READY_TO_SHIP partner orders;
 *  - delivery rolls the order up and COD is collected separately;
 *  - a partial refund is reflected on the order and the reconciliation screen;
 *  - role/ownership boundaries hold on the API;
 *  - the screens fit 1440px and 390px without sideways scrolling;
 *  - Ant Design's deprecated `Alert.message` prop is not used.
 */

function vnd(value: string | number): string {
  const n = Math.round(Number(value));
  return `${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

function trackAntdAlertWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && /antd:\s*Alert|Alert\.message/i.test(message.text())) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

async function expectFinanceSummary(page: Page, expected: Record<string, string | number>) {
  for (const [label, value] of Object.entries(expected)) {
    const card = page.locator('.agri-card').filter({ hasText: label }).first();
    await expect(card, `finance card "${label}"`).toBeVisible();
    await expect(card).toContainText(vnd(value));
  }
}

test.describe('Final acceptance UAT', () => {
  test('UAT-01/06 — six finance figures and no deprecated Alert warning', async ({
    page,
    request,
  }, testInfo) => {
    const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const variant = await firstSellableVariant(request);
    const order = await createCodOrder(request, customerToken, variant.id, 1, {
      note: 'UAT tài chính cuối',
    });
    const warnings = trackAntdAlertWarnings(page);

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByRole('heading', { name: `Đơn hàng ${order.code}` })).toBeVisible();

    // The six concepts are distinct; PENDING_CONFIRMATION has collected 0 and
    // the full obligation outstanding. The stored grand total is the source.
    await expectFinanceSummary(page, {
      'Giá trị đơn': order.grandTotal,
      'Công nợ hiệu lực': order.grandTotal,
      'Đã thu': 0,
      'Còn phải thu': order.grandTotal,
      'Đã hoàn tiền': 0,
      'Cần hoàn trả': 0,
    });

    await expect(page.locator('body')).not.toContainText('[object Object]');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `${testInfo.project.name} must not scroll sideways at its viewport`,
    ).toBeLessThanOrEqual(1);

    // Ant Design 6 renamed Alert `message` to `title`; the browser console is
    // where a regression would surface. No application warning is expected.
    expect(warnings).toEqual([]);
  });

  test('UAT-02/04 — delivery is shipment-driven, picker only offers eligible orders', async ({
    page,
    request,
  }, testInfo) => {
    const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const variant = await firstSellableVariant(request);
    const order = await createCodOrder(request, customerToken, variant.id, 1, {
      note: 'UAT vận đơn cuối',
    });
    const pending = await createCodOrder(request, customerToken, variant.id, 1, {
      note: 'UAT đơn chưa đủ điều kiện',
    });

    await advanceOrderToReadyToShip(request, adminToken, order.id);

    // The order screen no longer offers DELIVERED as an operator choice.
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByRole('heading', { name: `Đơn hàng ${order.code}` })).toBeVisible();
    await page.getByRole('button', { name: 'Chuyển trạng thái' }).click();
    await expect(page.getByRole('menuitem', { name: 'Hủy đơn' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Giao hàng|Đã giao|Giao thành công/ })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');

    // The picker is the backend eligibility query: the READY_TO_SHIP order is
    // there, the still-PENDING one is not.
    await page.goto('/shipments');
    await page.getByRole('button', { name: 'Tạo vận đơn' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Tạo vận đơn' });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole('combobox').first().click();
    // AntD duplicates the option into a hidden accessibility list; the visible
    // row is the `.ant-select-item-option` inside the open dropdown.
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await expect(dropdown.getByText(order.code, { exact: false })).toBeVisible();
    await expect(dropdown.getByText(pending.code, { exact: false })).toHaveCount(0);
    await dropdown.locator('.ant-select-item-option').filter({ hasText: order.code }).click();
    await createDialog.getByPlaceholder('VD: GHN, GHTK, Viettel Post').fill('GHN');
    await createDialog
      .getByPlaceholder('Mã tra cứu của đơn vị vận chuyển')
      .fill(`E2E-UI-${order.id}`);
    await createDialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.locator('.ant-message')).toContainText('Đã tạo vận đơn.');

    const shipmentRow = page.locator('tr', { hasText: order.code }).first();
    await expect(shipmentRow).toContainText('Chờ xử lý');
    await expect(shipmentRow).toContainText('GHN');

    // Advance the parcel through the real button. IN_TRANSIT is what rolls the
    // order to SHIPPING.
    await shipmentRow.getByRole('button', { name: 'Cập nhật' }).click();
    const updateDialog = page.getByRole('dialog', { name: 'Cập nhật vận đơn' });
    await expect(updateDialog).toBeVisible();
    await updateDialog.getByRole('combobox').click();
    const statusDropdown = page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .last();
    await statusDropdown
      .locator('.ant-select-item-option')
      .filter({ hasText: 'Bắt đầu vận chuyển' })
      .click();
    await updateDialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.locator('.ant-message')).toContainText('Đã cập nhật vận đơn.');

    const detail = await request.get(`${API_BASE}/orders/${order.id}`, {
      headers: bearer(adminToken),
    });
    expect(detail.status()).toBe(200);
    const shipped = (await detail.json()) as { status: string; partnerOrders: { shipments: unknown[] }[] };
    expect(shipped.status).toBe('SHIPPING');
    expect(shipped.partnerOrders[0].shipments).toHaveLength(1);

    // A manual DELIVERED shortcut is refused: the parcel is still in transit,
    // so there is no delivery evidence yet.
    const manual = await request.patch(`${API_BASE}/orders/${order.id}/status`, {
      headers: bearer(adminToken),
      data: { status: 'DELIVERED' },
    });
    expect(manual.status()).toBe(409);
    const refusal = (await manual.json()) as { message: string };
    expect(refusal.message).toMatch(/bằng chứng/i);

    // The operator must explicitly mark the parcel OUT_FOR_DELIVERY before
    // Giao thành công is offered. Confirm delivery through the real Admin UI.
    await shipmentRow.getByRole('button', { name: 'Cập nhật' }).click();
    await updateDialog.getByRole('combobox').click();
    await statusDropdown.locator('.ant-select-item-option')
      .filter({ hasText: 'Đang giao đến khách' }).click();
    await updateDialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(shipmentRow).toContainText('Đang giao đến khách');

    await shipmentRow.getByRole('button', { name: 'Cập nhật' }).click();
    await updateDialog.getByRole('combobox').click();
    await statusDropdown.locator('.ant-select-item-option')
      .filter({ hasText: 'Giao thành công' }).click();
    await updateDialog.getByRole('button', { name: 'Lưu' }).click();

    const confirmDialog = page.getByRole('dialog', { name: 'Xác nhận giao thành công?' });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('Tiền COD vẫn chờ xác nhận thu riêng');
    await page.screenshot({
      path: testInfo.outputPath('shipment-delivery-confirm-before.png'),
      fullPage: true,
    });
    await confirmDialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await expect(shipmentRow).toContainText('Đã giao');
    await page.screenshot({
      path: testInfo.outputPath('shipment-delivery-confirm-after.png'),
      fullPage: true,
    });

    const deliveredResponse = await request.get(`${API_BASE}/orders/${order.id}`, {
      headers: bearer(adminToken),
    });
    expect(deliveredResponse.status()).toBe(200);
    const delivered = (await deliveredResponse.json()) as {
      status: string;
      payments: { status: string }[];
      partnerOrders: { shipments: { status: string; deliveredAt: string | null }[] }[];
    };
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.partnerOrders[0].shipments[0].status).toBe('DELIVERED');
    expect(delivered.partnerOrders[0].shipments[0].deliveredAt).toBeTruthy();
    expect(delivered.payments[0].status).not.toBe('PAID');

    if (testInfo.project.name === 'admin-small') {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });

  test('UAT-03/05 — delivery evidence, COD collection and partial refund update the books', async ({
    page,
    request,
  }) => {
    const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const variant = await firstSellableVariant(request);
    const order = await createCodOrder(request, customerToken, variant.id, 1, {
      note: 'UAT giao và thu tiền cuối',
    });
    const payment = order.payments?.[0];
    expect(payment).toBeTruthy();

    await advanceOrderToReadyToShip(request, adminToken, order.id);
    await deliverOrderViaShipment(request, adminToken, order.id);

    await page.goto(`/orders/${order.id}`);
    // The order status is a rollup of the delivered shipment.
    await expect(page.getByText('Đã giao').first()).toBeVisible();
    await expectFinanceSummary(page, {
      'Giá trị đơn': order.grandTotal,
      'Công nợ hiệu lực': order.grandTotal,
      'Đã thu': 0,
      'Còn phải thu': order.grandTotal,
      'Đã hoàn tiền': 0,
      'Cần hoàn trả': 0,
    });

    // Delivery evidence is visible on the shipping tab, including deliveredAt.
    // The tab is URL-addressable; opening it by URL is stable at 390px, where
    // AntD puts part of the strip behind an overflow button.
    await page.goto(`/orders/${order.id}?tab=shipping`);
    const shippingPanel = page.getByRole('tabpanel');
    await expect(shippingPanel.getByText('Giao hàng được ghi nhận từ vận đơn')).toBeVisible();
    await expect(shippingPanel.getByText(/^SHP-/).first()).toBeVisible();
    await expect(shippingPanel.getByText('Đã giao').first()).toBeVisible();
    await expect(shippingPanel.getByText('Chưa giao')).toHaveCount(0);

    // COD is still uncollected: delivery proves arrival, not cash.
    await page.goto(`/orders/${order.id}?tab=payment`);
    const paymentPanel = page.getByRole('tabpanel');
    await expect(
      paymentPanel.getByText('Đơn đã giao nhưng tiền COD chưa được ghi nhận thu'),
    ).toBeVisible();

    await paymentPanel.getByText('Ghi nhận thu tiền').click();
    const collectDialog = page.getByRole('dialog', { name: 'Ghi nhận thu tiền COD' });
    await expect(collectDialog).toBeVisible();
    await collectDialog
      .getByPlaceholder('VD: COD-BL-20261012-001')
      .fill(`UAT-COD-${order.id}`);
    await collectDialog.getByRole('button', { name: 'Xác nhận đã thu tiền' }).click();
    await expect(page.locator('.ant-message')).toContainText('Đã ghi nhận thu tiền COD.');
    await expect(paymentPanel.getByText('Đã thanh toán').first()).toBeVisible();
    await expectFinanceSummary(page, {
      'Đã thu': order.grandTotal,
      'Còn phải thu': 0,
    });

    // A partial refund is recorded through the real refund workflow and must
    // move "Đã hoàn tiền" without changing the order's original value.
    await refundOrder(request, adminToken, payment!.id, 10_000, `UAT-RF-${order.id}`);
    await page.reload();
    const refreshed = page.getByRole('tabpanel');
    await expect(refreshed.getByText('Hoàn một phần').first()).toBeVisible();
    await expectFinanceSummary(page, {
      'Giá trị đơn': order.grandTotal,
      'Công nợ hiệu lực': order.grandTotal,
      'Đã thu': order.grandTotal,
      'Còn phải thu': 0,
      'Đã hoàn tiền': 10_000,
      'Cần hoàn trả': 0,
    });
  });

  test('UAT-07 — role and ownership boundaries on the API', async ({ request }) => {
    const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const otherToken = await apiLogin(request, OTHER_CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const variant = await firstSellableVariant(request);
    const order = await createCodOrder(request, customerToken, variant.id, 1);

    const customerFinance = await request.get(`${API_BASE}/finance/reconciliation`, {
      headers: bearer(customerToken),
    });
    expect(customerFinance.status()).toBe(403);

    const customerShipmentPicker = await request.get(
      `${API_BASE}/shipments/eligible-partner-orders`,
      { headers: bearer(customerToken) },
    );
    expect(customerShipmentPicker.status()).toBe(403);

    const customerAdminOrder = await request.get(`${API_BASE}/orders/${order.id}`, {
      headers: bearer(customerToken),
    });
    expect(customerAdminOrder.status()).toBe(403);

    const customerStatusWrite = await request.patch(`${API_BASE}/orders/${order.id}/status`, {
      headers: bearer(customerToken),
      data: { status: 'CONFIRMED' },
    });
    expect(customerStatusWrite.status()).toBe(403);

    const otherCustomerOrder = await request.get(`${API_BASE}/orders/me/${order.id}`, {
      headers: bearer(otherToken),
    });
    expect(otherCustomerOrder.status()).toBe(404);

    const otherCustomerPdf = await request.get(`${API_BASE}/orders/${order.id}/pdf`, {
      headers: bearer(otherToken),
    });
    expect(otherCustomerPdf.status()).toBe(404);

    const anonymousOrder = await request.get(`${API_BASE}/orders/${order.id}`);
    expect(anonymousOrder.status()).toBe(401);

    const adminOrder = await request.get(`${API_BASE}/orders/${order.id}`, {
      headers: bearer(adminToken),
    });
    expect(adminOrder.status()).toBe(200);
  });
});
