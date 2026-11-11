import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE, apiLogin, bearer } from '../support/api';

/**
 * Browser coverage for task 05.3 — the "Chuyển HTX" action on the farm detail
 * page.
 *
 * Writes happen exclusively through the admin API against TEST_DATABASE_URL
 * (the partner E2E runs on the isolated `agrimarket_v2_test` schema). The
 * DOM-driven write-through test
 * and the rejection test each run once, on the 1440px project; the read-only
 * responsive render checks run on 1440 / 768 / 375 px.
 */

const evidenceDir = path.resolve(__dirname, '../../audit-reports/assets/farm-transfer');
mkdirSync(evidenceDir, { recursive: true });

interface FarmRecord {
  id: number;
  partnerId: number;
  status: string;
  partner?: { id: number; code: string; name: string };
}

interface EligiblePartner {
  id: number;
  code: string;
  name: string;
}

const REASON = 'Kiểm thử e2e: điều chỉnh đơn vị quản lý trang trại.';

function expectOk(res: { ok(): boolean; status(): number; url(): string }, what: string) {
  expect(res.ok(), `${what} → HTTP ${res.status()} cho ${res.url()}`).toBe(true);
}

/** Brand-new VERIFIED + ACTIVE partner (the seeded ones are still PENDING). */
async function createVerifiedPartner(request: APIRequestContext, token: string): Promise<EligiblePartner> {
  const headers = bearer(token);
  const unique = Date.now();
  const create = await request.post(`${API_BASE}/partners`, {
    headers,
    data: {
      type: 'COOPERATIVE',
      name: `HTX Nhận chuyển ${unique}`,
      phone: `09${String(unique).slice(-8)}`,
      email: `e2e-transfer-${unique}@example.com`,
      address: 'Xã Phú Cường, huyện Kim Động, Hưng Yên',
      representativeName: 'Đại diện kiểm thử',
      taxCode: `0900${String(unique).slice(-12)}`,
      registrationDocumentUrl: 'https://example.com/partner-registration.pdf',
    },
  });
  expectOk(create, 'create partner fixture');
  const partner = (await create.json()) as EligiblePartner;
  expect(partner.id).toBeGreaterThan(0);

  expectOk(await request.patch(`${API_BASE}/partners/${partner.id}/verification`, {
    headers,
    data: { verificationStatus: 'VERIFIED', reason: 'Hồ sơ pháp lý hợp lệ (kiểm thử e2e).' },
  }), 'verify partner fixture');
  expectOk(await request.patch(`${API_BASE}/partners/${partner.id}/business-status`, {
    headers,
    data: { status: 'ACTIVE', reason: 'Kích hoạt kinh doanh sau xác minh (kiểm thử e2e).' },
  }), 'activate partner fixture');
  return partner;
}

/** Seeded partner code → id (they stay PENDING, never transfer-eligible). */
async function findPendingPartner(request: APIRequestContext, token: string, code: string): Promise<EligiblePartner> {
  const res = await request.get(`${API_BASE}/partners?search=${encodeURIComponent(code)}`, { headers: bearer(token) });
  expectOk(res, `find partner ${code}`);
  const body = (await res.json()) as { data: (EligiblePartner & { verificationStatus: string })[] };
  const partner = body.data.find((row) => row.code === code);
  expect(partner, `partner fixture ${code} exists in the test database`).toBeTruthy();
  return partner!;
}

async function createFarm(
  request: APIRequestContext,
  token: string,
  partnerId: number,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<FarmRecord> {
  const unique = Date.now();
  const res = await request.post(`${API_BASE}/farms`, {
    headers: bearer(token),
    data: {
      partnerId,
      name: `Trang trại kiểm thử chuyển HTX ${unique}`,
      address: 'Thôn Đa Hòa, xã Minh Châu, Hưng Yên',
      description: 'Bàn giao chuyển HTX trước khi có dữ liệu canh tác.',
      status,
    },
  });
  expectOk(res, `create ${status} farm fixture`);
  return (await res.json()) as FarmRecord;
}

const dialog = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Chuyển trang trại sang HTX khác' });

test('renders the blocked transfer action for an ACTIVE farm without overflow', async ({ page, request }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1440;
  const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const partner = await createVerifiedPartner(request, token);
  const farm = await createFarm(request, token, partner.id, 'ACTIVE');

  await page.goto(`/farms/${farm.id}`);
  await expect(page.getByText('Quản lý HTX')).toBeVisible();

  const transferButton = page.getByRole('button', { name: 'Chuyển HTX' });
  await expect(transferButton).toBeVisible();
  await expect(transferButton).toBeDisabled();
  await expect(page.getByText(/chuyển trạng thái trang trại sang INACTIVE trước/i)).toBeVisible();
  await expect(dialog(page)).toBeHidden();

  await page.screenshot({ path: path.join(evidenceDir, `farm-transfer-active-${width}.png`), fullPage: true });

  const measurements = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(measurements.contentWidth, 'active-farm blocking state should not scroll horizontally')
    .toBeLessThanOrEqual(measurements.viewportWidth + 1);
});

test('opens the transfer dialog with current partner and eligibility filtering', async ({ page, request }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1440;
  const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const eligible = await createVerifiedPartner(request, token);
  // INACTIVE farms are drafts: a seeded PENDING partner may hold them.
  const pending = await findPendingPartner(request, token, 'PARTNER-0001');
  const farm = await createFarm(request, token, pending.id, 'INACTIVE');

  await page.goto(`/farms/${farm.id}`);
  const transferButton = page.getByRole('button', { name: 'Chuyển HTX' });
  await expect(transferButton).toBeEnabled();

  await transferButton.click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('HTX hiện tại')).toBeVisible();
  await expect(dialog(page).getByText(`${pending.code} — ${pending.name}`)).toBeVisible();
  await expect(
    dialog(page).getByText('Không chuyển sản phẩm, đơn hàng hoặc lịch sử tài chính.'),
  ).toBeVisible();

  const select = dialog(page).getByLabel('HTX tiếp nhận');
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:visible');
  await expect(dropdown.getByText(`${eligible.code} — ${eligible.name}`)).toBeVisible();
  const currentOwnerOptions = dropdown.locator('.ant-select-item-option').filter({
    hasText: pending.code,
  });
  await expect(currentOwnerOptions).toHaveCount(0);

  // Valid data: pick the only eligible partner, then a mandatory reason.
  await dropdown.getByText(`${eligible.code} — ${eligible.name}`).click();
  await dialog(page).getByLabel('Lý do chuyển').fill(REASON);

  const confirm = dialog(page).getByRole('button', { name: 'Xác nhận chuyển' });
  await expect(confirm).toBeEnabled();

  await page.screenshot({
    path: path.join(evidenceDir, `farm-transfer-dialog-${width}.png`),
    animations: 'disabled',
    fullPage: true,
  });

  // Read-only: dismiss without submitting.
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog(page)).toBeHidden();
  const fresh = await request.get(`${API_BASE}/farms/${farm.id}`, { headers: bearer(token) });
  expectOk(fresh, 'farm unchanged after closing the dialog');
  const freshFarm = (await fresh.json()) as FarmRecord;
  expect(freshFarm.partnerId, 'closing the dialog must not transfer the farm').toBe(pending.id);
});

test('transfers the farm to the selected partner and updates the page', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'farm-transfer-1440', 'Single write-through run on the isolated test database.');
  const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const eligible = await createVerifiedPartner(request, token);
  const pending = await findPendingPartner(request, token, 'PARTNER-0001');
  const farm = await createFarm(request, token, pending.id, 'INACTIVE');

  await page.goto(`/farms/${farm.id}`);
  await page.getByRole('button', { name: 'Chuyển HTX' }).click();
  await expect(dialog(page)).toBeVisible();

  await dialog(page).getByLabel('HTX tiếp nhận').click();
  await page.locator('.ant-select-dropdown:visible').getByText(`${eligible.code} — ${eligible.name}`).click();
  await dialog(page).getByLabel('Lý do chuyển').fill(REASON);
  await dialog(page).getByRole('button', { name: 'Xác nhận chuyển' }).click();

  await expect(page.getByText('Đã chuyển trang trại sang HTX mới.')).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect(
    page.getByText(`${eligible.code} — ${eligible.name}`).first(),
  ).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, 'farm-transfer-success-1440.png'), fullPage: true });

  const verify = await request.get(`${API_BASE}/farms/${farm.id}`, { headers: bearer(token) });
  expectOk(verify, 'farm after transfer');
  const transferred = (await verify.json()) as FarmRecord;
  expect(transferred.partnerId).toBe(eligible.id);
  expect(transferred.status, 'the operation itself must not re-activate the farm').toBe('INACTIVE');
});

test('surfaces the backend rejection when the farm has linked business data', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'farm-transfer-1440', 'Single rejection run on the isolated test database.');
  const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const eligible = await createVerifiedPartner(request, token);

  // Every seeded farm carries certificates/seasons/products, so the backend
  // refuses the move even though the farm is INACTIVE.
  const seeded = await request.get(`${API_BASE}/farms?search=${encodeURIComponent('FARM-0001')}`, {
    headers: bearer(token),
  });
  expectOk(seeded, 'find seeded farm FARM-0001');
  const seededFarm = ((await seeded.json()) as { data: FarmRecord[] }).data.find((row) => row.code === 'FARM-0001');
  expect(seededFarm, 'seeded FARM-0001 exists').toBeTruthy();
  expectOk(await request.patch(`${API_BASE}/farms/${seededFarm!.id}`, {
    headers: bearer(token),
    data: { status: 'INACTIVE' },
  }), 'move seeded farm to INACTIVE (draft rule, admin API)');

  await page.goto(`/farms/${seededFarm!.id}`);
  await page.getByRole('button', { name: 'Chuyển HTX' }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel('HTX tiếp nhận').click();
  await page.locator('.ant-select-dropdown:visible').getByText(`${eligible.code} — ${eligible.name}`).click();
  await dialog(page).getByLabel('Lý do chuyển').fill(REASON);
  await dialog(page).getByRole('button', { name: 'Xác nhận chuyển' }).click();

  await expect(page.getByText('Không thể chuyển trang trại đã có sản phẩm, mùa vụ hoặc chứng nhận liên kết.')).toBeVisible();
  await expect(dialog(page)).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, 'farm-transfer-rejection-1440.png'), fullPage: true });
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();

  const after = await request.get(`${API_BASE}/farms/${seededFarm!.id}`, { headers: bearer(token) });
  expectOk(after, 'farm after rejected transfer');
  const unchanged = (await after.json()) as FarmRecord;
  expect(unchanged.partnerId, 'a rejected transfer keeps the current partner').toBe(seededFarm!.partnerId);
});
