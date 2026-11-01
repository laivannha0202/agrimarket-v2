import { expect, test } from '@playwright/test';
import {
  cleanupReconciliationFixtures,
  seedReconciliationFixtures,
  type ReconciliationFixtures,
} from '../support/reconciliation-fixtures';

/**
 * Admin — đối chiếu dòng tiền (real browser, real API).
 *
 * The report has no write path, so the assertions are about what an operator
 * must be able to see and reach: every money state, the evidence gap, the
 * filter shortcuts, the reason panel, and the links into the order/payment
 * screens. The fixture orders are written to the isolated test schema (see
 * `support/reconciliation-fixtures.ts`) because the demo seed contains no
 * discrepancy at all.
 */

let fixtures: ReconciliationFixtures;

test.describe('Admin — đối chiếu dòng tiền', () => {
  test.beforeAll(async () => {
    fixtures = await seedReconciliationFixtures();
  });

  test.afterAll(async () => {
    if (fixtures) await cleanupReconciliationFixtures(fixtures.prefix);
  });

  const searchForFixtures = async (page: import('@playwright/test').Page) => {
    await page.getByPlaceholder('Tìm theo mã đơn').fill(fixtures.prefix);
    await expect(page.getByText(fixtures.codes.partial)).toBeVisible();
  };

  test('lists every money state with the API-computed numbers', async ({ page }, testInfo) => {
    await page.goto('/reconciliation');
    await expect(page.getByRole('heading', { name: 'Đối chiếu dòng tiền' })).toBeVisible();
    await expect(page.getByText('Chỉ đọc — không điều chỉnh tiền tại đây')).toBeVisible();

    await searchForFixtures(page);

    const partial = page.locator('tr', { hasText: fixtures.codes.partial });
    await expect(partial.getByText('Thu một phần')).toBeVisible();
    await expect(partial.getByText('Thu thiếu')).toBeVisible();
    // 300.000 owed, 120.000 collected → 180.000 outstanding, printed by the API value.
    await expect(partial.getByText('180.000 ₫')).toBeVisible();

    const over = page.locator('tr', { hasText: fixtures.codes.over });
    await expect(over.getByText('Thu vượt').first()).toBeVisible();

    const evidence = page.locator('tr', { hasText: fixtures.codes.evidence });
    await expect(evidence.getByText('Thiếu bằng chứng thu tiền')).toBeVisible();

    // Clean orders are not part of the default worklist.
    await expect(page.getByText(fixtures.codes.clean)).toHaveCount(0);
    await expect(page.getByText(fixtures.codes.refunded)).toHaveCount(0);

    // The period summary counts every finding, not just the filtered page.
    const findingsKpi = page.locator('.agri-kpi-card', { hasText: 'Đơn có chênh lệch' });
    await expect(findingsKpi).toBeVisible();
    const findingsText = (await findingsKpi.locator('.agri-kpi-value').innerText()).replace(/\D/g, '');
    expect(Number(findingsText)).toBeGreaterThanOrEqual(3);

    if (testInfo.project.name === 'admin-small') {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });

  test('widens the list to fully collected orders when the bucket is picked', async ({
    page,
  }) => {
    await page.goto('/reconciliation');
    await searchForFixtures(page);

    // The chip carries the period count; row tags say just "Đã thu đủ".
    await page.getByText(/^Đã thu đủ \(\d+\)$/).click();

    // The clean order and the partially refunded one are fully collected.
    await expect(page.getByText(fixtures.codes.clean)).toBeVisible();
    await expect(page.getByText(fixtures.codes.refunded)).toBeVisible();
    await expect(page.getByText(fixtures.codes.partial)).toHaveCount(0);

    const refunded = page.locator('tr', { hasText: fixtures.codes.refunded });
    await expect(refunded.getByText('Hoàn một phần')).toBeVisible();
    await expect(refunded.getByText('20.000 ₫').first()).toBeVisible();
  });

  test('explains the reason and links into the order and payment screens', async ({ page }) => {
    await page.goto('/reconciliation');
    await searchForFixtures(page);

    const partial = page.locator('tr', { hasText: fixtures.codes.partial });
    await partial.locator('.ant-table-row-expand-icon').click();

    await expect(page.getByText('Nguyên nhân')).toBeVisible();
    await expect(page.getByText(/Số tiền đã thu nhỏ hơn tổng phải thu/)).toBeVisible();
    await expect(page.getByText('Mở chi tiết đơn')).toBeVisible();

    // The payment link lives in the expanded panel (the table itself stays
    // narrow enough to read at 1440px).
    await page.getByRole('link', { name: 'Mở tab thanh toán' }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${fixtures.orders.partialId}\\?tab=payment`));
    // The deep link opens the payment tab, not the default one.
    await expect(page.getByRole('tab', { name: 'Thanh toán' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('shows an empty state for a code that matches nothing', async ({ page }) => {
    await page.goto('/reconciliation');
    await page.getByPlaceholder('Tìm theo mã đơn').fill('KHONG-CO-DON-NAY');

    await expect(page.getByText('Không có đơn nào khớp bộ lọc đối chiếu')).toBeVisible();
  });
});
