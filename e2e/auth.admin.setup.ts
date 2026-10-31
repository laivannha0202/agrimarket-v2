import { expect, test as setup } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support/api';

/**
 * One real form login per run, then every admin test reuses the session.
 *
 * The API throttles `/auth/login` to 10 attempts per minute per IP+account, so
 * a suite that typed the password before every test started failing with 429 —
 * the app was right and the test harness was wasteful. This setup keeps the
 * login path covered in the browser (it is a genuine form submit, asserted on
 * the dashboard URL) while the rest of the suite only navigates.
 */
setup('admin session', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
