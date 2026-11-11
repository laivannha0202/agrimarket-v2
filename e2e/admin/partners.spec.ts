import { expect, test } from '@playwright/test';
import path from 'node:path';
import { API_BASE, ADMIN_EMAIL, ADMIN_PASSWORD, CUSTOMER_EMAIL, CUSTOMER_PASSWORD, apiLogin, bearer } from '../support/api';

const evidenceDir = path.resolve(__dirname, '../../audit-reports/assets/partners');

test('list, filters and responsive detail render without page overflow', async ({ page, request }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1440;
  const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const response = await request.get(`${API_BASE}/partners?limit=10`, { headers: bearer(token) });
  expect(response.status()).toBe(200);
  const listing = (await response.json()) as { data: { id: number; name: string; phone: string; type: string }[] };
  expect(listing.data.length).toBeGreaterThan(0);

  await page.goto('/partners');
  await expect(page.getByRole('heading', { name: 'Đối tác bán hàng' })).toBeVisible();
  await expect(page.getByRole('link', { name: listing.data[0].name }).first()).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, `partners-list-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: 'Thêm đối tác' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Thêm đối tác' });
  await expect(createDialog).toBeVisible();
  const modalBounds = await createDialog.boundingBox();
  expect(modalBounds).not.toBeNull();
  expect(modalBounds!.x).toBeGreaterThanOrEqual(-1);
  expect(modalBounds!.x + modalBounds!.width).toBeLessThanOrEqual(width + 1);
  await page.screenshot({ path: path.join(evidenceDir, `partners-create-${width}.png`), animations: 'disabled' });
  await createDialog.getByLabel('Số tài khoản').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidenceDir, `partners-create-bottom-${width}.png`), animations: 'disabled' });
  await createDialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(createDialog.getByText('Nhập tên đối tác.')).toBeVisible();
  await createDialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(createDialog).toBeHidden();

  const search = page.getByPlaceholder('Tìm tên, mã đối tác, số điện thoại...');
  await search.fill(listing.data[0].phone);
  await expect(page.getByRole('link', { name: listing.data[0].name }).first()).toBeVisible();
  await search.fill('khong-ton-tai-123456789');
  await expect(page.getByText('Không có đối tác phù hợp')).toBeVisible();
  await page.getByRole('button', { name: 'Đặt lại' }).click();

  if (width === 1440) {
    await page.getByRole('combobox').nth(1).click();
    await page.locator('.ant-select-dropdown:visible').getByText('Đang hoạt động', { exact: true }).click();
    await expect(page.locator('.ant-table-row').first()).toBeVisible();
    await page.getByRole('combobox').nth(2).click();
    await page.locator('.ant-select-dropdown:visible').getByText('Chờ xác minh', { exact: true }).click();
    await expect(page.locator('.ant-table-row').first()).toBeVisible();
    await page.getByRole('button', { name: 'Đặt lại' }).click();
  }

  await page.goto(`/partners/${listing.data[0].id}`);
  await expect(page.getByText('Thông tin pháp lý và xác minh')).toBeVisible();
  await expect(page.getByText('Trang trại liên kết')).toBeVisible();
  await expect(page.getByText('Lịch sử chỉnh sửa và trạng thái')).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, `partners-detail-${width}.png`), fullPage: true });

  const measurements = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(measurements.contentWidth, 'partner detail page should not scroll horizontally').toBeLessThanOrEqual(measurements.viewportWidth + 1);
});

test('admin can create, validate, edit, verify, activate, link a farm and suspend', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'partners-1440', 'Run write-through workflow once on the test database.');

  const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const unique = `${Date.now()}`;
  const name = `HTX E2E ${unique}`;
  const phone = `09${unique.slice(-8)}`;
  const email = `e2e-partner-${unique}@example.com`;
  const headers = bearer(token);

  await page.goto('/partners');
  await page.getByRole('button', { name: 'Thêm đối tác' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm đối tác' });
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog.getByText('Nhập tên đối tác.')).toBeVisible();

  const partnerType = dialog.getByLabel('Loại đối tác');
  await partnerType.click();
  await partnerType.press('Enter');
  await expect(dialog.getByTitle('Hợp tác xã')).toBeVisible();
  await dialog.getByLabel('Tên đối tác').fill(name);
  await dialog.getByLabel('Số điện thoại').fill(phone);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog).toBeHidden();

  const matching = await request.get(`${API_BASE}/partners?search=${encodeURIComponent(name)}`, { headers });
  expect(matching.status()).toBe(200);
  const matches = (await matching.json()) as { data: { id: number; verificationStatus: string; status: string }[] };
  expect(matches.data).toHaveLength(1);
  const partnerId = matches.data[0].id;
  expect(matches.data[0]).toMatchObject({ verificationStatus: 'PENDING', status: 'INACTIVE' });

  const earlyActivation = await request.patch(`${API_BASE}/partners/${partnerId}/business-status`, {
    headers,
    data: { status: 'ACTIVE', reason: 'Test trước xác minh' },
  });
  expect(earlyActivation.status()).toBe(400);

  await page.goto(`/partners/${partnerId}`);
  await page.getByRole('button', { name: 'Chỉnh sửa' }).click();
  const edit = page.getByRole('dialog', { name: 'Chỉnh sửa đối tác' });
  await edit.getByLabel('Người đại diện').fill('Đại diện kiểm thử');
  await edit.getByLabel('Mã số thuế / mã đăng ký').fill(`TAX-${unique}`);
  await edit.getByLabel('Đường dẫn giấy tờ đăng ký (HTTPS)').fill('https://example.com/partner-registration.pdf');
  await edit.getByLabel('Ngân hàng').fill('Ngân hàng kiểm thử');
  await edit.getByLabel('Chủ tài khoản').fill('Tài khoản kiểm thử');
  await edit.getByLabel('Số tài khoản').fill('123456789012');
  await edit.getByRole('button', { name: 'Lưu' }).click();
  await expect(edit).toBeHidden();

  const publicRead = await request.get(`${API_BASE}/partners/${partnerId}`);
  expect(publicRead.status()).toBe(200);
  const publicData = (await publicRead.json()) as Record<string, unknown>;
  for (const field of ['taxCode', 'registrationDocumentUrl', 'bankName', 'bankAccountName', 'bankAccountNumber']) {
    expect(publicData).not.toHaveProperty(field);
  }

  await expect(page.getByText('••••••').first()).toBeVisible();
  await page.getByRole('button', { name: 'Hiện thông tin' }).click();
  await expect(page.getByText('123456789012')).toBeVisible();
  await page.getByRole('button', { name: 'Ẩn thông tin' }).click();
  await expect(page.getByText('123456789012')).toBeHidden();

  await page.getByRole('button', { name: 'Duyệt hồ sơ' }).click();
  const verifyDialog = page.getByRole('dialog', { name: 'Xác minh hồ sơ' });
  await verifyDialog.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(verifyDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Cho phép kinh doanh' })).toBeEnabled();

  await page.getByRole('button', { name: 'Cho phép kinh doanh' }).click();
  const activateDialog = page.getByRole('dialog', { name: 'Cho phép kinh doanh' });
  await activateDialog.getByLabel('Lý do').fill('Đã thẩm định hồ sơ trên môi trường kiểm thử');
  await activateDialog.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(activateDialog).toBeHidden();

  const farmName = `Trang trại E2E ${unique}`;
  const farm = await request.post(`${API_BASE}/farms`, {
    headers,
    data: { partnerId, name: farmName, address: 'Địa chỉ kiểm thử', status: 'ACTIVE' },
  });
  expect(farm.status(), await farm.text()).toBe(201);
  await page.reload();
  await expect(page.getByRole('link', { name: farmName })).toBeVisible();

  await page.getByRole('button', { name: 'Tạm khóa kinh doanh' }).click();
  const suspendDialog = page.getByRole('dialog', { name: 'Tạm khóa kinh doanh' });
  await expect(suspendDialog.getByText(/Trang trại 1/)).toBeVisible();
  await suspendDialog.getByLabel('Lý do').fill('Tạm ngừng hoạt động kiểm thử');
  await suspendDialog.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(suspendDialog).toBeHidden();

  const finalPartner = await request.get(`${API_BASE}/partners/${partnerId}`, { headers });
  expect(finalPartner.status()).toBe(200);
  expect(await finalPartner.json()).toMatchObject({ status: 'INACTIVE', verificationStatus: 'VERIFIED' });
  const impact = await request.get(`${API_BASE}/partners/${partnerId}/impact`, { headers });
  expect(impact.status()).toBe(200);
  expect(await impact.json()).toMatchObject({ farms: 1, activeFarms: 1, activeProducts: 0, openOrders: 0 });
  const history = await request.get(`${API_BASE}/partners/${partnerId}/history`, { headers });
  expect(history.status()).toBe(200);
  const events = (await history.json()) as { action: string; reason?: string }[];
  expect(events.map((entry) => entry.action)).toEqual(expect.arrayContaining([
    'CREATE', 'UPDATE', 'PARTNER_VERIFY_VERIFIED', 'PARTNER_BUSINESS_ACTIVE', 'PARTNER_BUSINESS_INACTIVE',
  ]));
  expect(JSON.stringify(events)).not.toContain('123456789012');

  const customer = await apiLogin(request, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  const forbidden = await request.patch(`${API_BASE}/partners/${partnerId}/verification`, {
    headers: bearer(customer), data: { verificationStatus: 'REJECTED', reason: 'No rights' },
  });
  expect(forbidden.status()).toBe(403);
  expect((await request.get(`${API_BASE}/partners/${partnerId}/history`, { headers: bearer(customer) })).status()).toBe(403);
});
