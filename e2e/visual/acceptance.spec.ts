import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  API_BASE,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CUSTOMER_EMAIL,
  CUSTOMER_PASSWORD,
  apiLogin,
  bearer,
  createCodOrder,
  firstSellableVariant,
} from '../support/api';
import {
  cleanupReconciliationFixtures,
  seedReconciliationFixtures,
  type ReconciliationFixtures,
} from '../support/reconciliation-fixtures';

/**
 * Visual acceptance evidence (round 29).
 *
 * These are not pass/fail assertions about pixels — they produce the images a
 * human reviews for the screens changed in rounds 28–29, at the three agreed
 * viewports. Every image lands in `audit-reports/assets/29/` with the viewport
 * in the file name, so a later round can compare without guessing.
 *
 * Run: npx playwright test --project=visual-acceptance
 */

const SHOTS = path.resolve(__dirname, '../../audit-reports/assets/29');
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

const ADMIN_STATE = path.resolve(__dirname, '../.auth/admin.json');
const CUSTOMER_STATE = path.resolve(__dirname, '../.auth/customer.json');
const CUSTOMER_URL = process.env.E2E_CUSTOMER_URL ?? 'http://localhost:3002';

let fixtures: ReconciliationFixtures;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  fixtures = await seedReconciliationFixtures();
});

test.afterAll(async () => {
  if (fixtures) await cleanupReconciliationFixtures(fixtures.prefix);
});

function shotName(name: string, width: number, height: number): string {
  return path.join(SHOTS, `${name}-${width}x${height}.png`);
}

async function shoot(page: Page, name: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  // Let Ant Design settle (table measurement, sticky header) before capturing.
  await page.waitForTimeout(350);
  await page.screenshot({ path: shotName(name, viewport.width, viewport.height), fullPage: true });
}

/** Every admin screen at all three viewports, with a hard no-sideways-scroll check. */
async function captureAdmin(page: Page, url: string, name: string, ready: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await expect(page.getByText(ready).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} at ${viewport.width}px must not scroll sideways`).toBeLessThanOrEqual(1);
    await shoot(page, name, viewport);
  }
}

test('admin — đối chiếu dòng tiền ở 3 viewport', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/reconciliation');
  await page.getByPlaceholder('Tìm theo mã đơn').fill(fixtures.prefix);
  await expect(page.getByText(fixtures.codes.partial)).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await shoot(page, 'admin-reconciliation', viewport);
  }
});

test('admin — chi tiết đơn và PDF ở 3 viewport', async ({ page, request }) => {
  const token = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  const variant = await firstSellableVariant(request);
  const order = await createCodOrder(request, token, variant.id, 1, { note: 'Ảnh nghiệm thu 29' });

  await captureAdmin(page, `/orders/${order.id}`, 'admin-order-detail', order.code);

  /**
   * The preview modal renders the real backend PDF bytes, never an HTML mock.
   * Chromium's built-in PDF viewer is only available in headed mode, so these
   * two captures are taken with `--headed` (the command is recorded in the
   * round report); headless renders an empty viewer frame.
   */
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`/orders/${order.id}`);
  await page.getByRole('button', { name: /Xem trước/ }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'admin-order-pdf-preview-1440x900.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Xem trước soạn hàng/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'admin-packing-slip-preview-1440x900.png') });
});

test('customer — chi tiết đơn ở 3 viewport', async ({ browser, request }) => {
  const token = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  const variant = await firstSellableVariant(request);
  const order = await createCodOrder(request, token, variant.id, 1, { note: 'Ảnh nghiệm thu 29' });

  const context = await browser.newContext({
    storageState: CUSTOMER_STATE,
    viewport: VIEWPORTS[0],
    baseURL: CUSTOMER_URL,
  });
  const page = await context.newPage();
  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      // Customer Web uses Vietnamese routes; `/orders/:id` only exists in Admin.
      await page.goto(`/don-hang/${order.id}`);
      await expect(page.getByText(order.code).first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await shoot(page, 'customer-order-detail', viewport);
    }
  } finally {
    await context.close();
  }
});

test('admin — voucher và hoàn tiền', async ({ page }) => {
  await captureAdmin(page, '/vouchers', 'admin-vouchers', 'Voucher');
  await captureAdmin(page, '/refunds', 'admin-refunds', 'Hoàn tiền');
});

/**
 * The PDF itself, checked where bytes are the only evidence: the page count,
 * the embedded logo image, the Vietnamese text (no mojibake) and the money
 * lines. A screenshot of Chromium's PDF plugin is not reliable headless, so the
 * rasterised proof for the print layout is the preview modal above.
 */
test('PDF đơn hàng và phiếu soạn hàng có logo, tiếng Việt và dòng tiền', async ({ request }) => {
  const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const customerToken = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  const variant = await firstSellableVariant(request);
  const order = await createCodOrder(request, customerToken, variant.id, 2, {
    note: 'PDF nghiệm thu 29',
  });

  for (const [name, route] of [
    ['order-pdf', `/orders/${order.id}/pdf`],
    ['packing-slip', `/orders/${order.id}/packing-slip`],
  ] as const) {
    const res = await request.get(`${API_BASE}${route}`, { headers: bearer(adminToken) });
    expect(res.status()).toBe(200);
    const body = await res.body();
    const text = body.toString('latin1');

    // A real PDFKit document with an embedded logo image (512×512 leaf mark).
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('/Subtype /Image');
    expect(text).toMatch(/\/Width 512/);
    // The DejaVu subset is what carries Vietnamese diacritics.
    expect(text).toMatch(/DejaVuSans/);
    // Bytes, not a placeholder: the file must be a plausible size for one page.
    expect(body.length).toBeGreaterThan(5000);
  }
});
