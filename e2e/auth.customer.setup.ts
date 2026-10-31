import { expect, test as setup } from '@playwright/test';
import { CUSTOMER_EMAIL, CUSTOMER_PASSWORD } from './support/api';

/**
 * Customer counterpart of `auth.admin.setup.ts`: one real login, reused by
 * every customer test. The Mantine password field also renders a visibility
 * toggle whose accessible name contains "mật khẩu", so the textbox role is the
 * unambiguous selector.
 */
setup('customer session', async ({ page }) => {
  await page.goto('/dang-nhap');
  await page.getByLabel('Email').fill(CUSTOMER_EMAIL);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(CUSTOMER_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).not.toHaveURL(/\/dang-nhap/);

  await page.context().storageState({ path: 'e2e/.auth/customer.json' });
});
