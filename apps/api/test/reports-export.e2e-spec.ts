import type { INestApplication } from '@nestjs/common';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestApp, login } from './helpers/test-app.js';
import { extractPdfText } from './helpers/pdf-text.js';
import {
  cleanupFixtures,
  createFixturePrisma,
  E2E_ADMIN_PASSWORD,
  E2E_CUSTOMER_PASSWORD,
  makeRunId,
  purgeStaleFixtures,
  seedFixtures,
  type E2eFixtures,
} from './helpers/e2e-fixtures.js';

/**
 * Report + settlement export acceptance (e2e, MySQL TEST).
 *
 * Proves `GET /reports/export` and `GET /settlements/:id/export` produce REAL
 * files (ZIP-magic xlsx / %PDF-, not renamed JSON), and that the money in the
 * files reconciles with the API KPIs for the same window:
 *
 * - one row per order (a 2-partner order contributes its grandTotal ONCE);
 * - cash columns use the paidAt/completedAt event-time basis, so
 *   Σ collected − Σ refunded == summary.netCollected exactly;
 * - no 100-row cap (105- and 1000-order windows export every row);
 * - hostile text (`=2+2…`, `+cmd…`) is stored as plain strings, never as
 *   spreadsheet formulas;
 * - the PDF carries extractable Vietnamese text (per-font ToUnicode decode);
 * - auth: 401 without token, 403 for a customer, 400 for a bad format or an
 *   inverted window.
 *
 * Fixtures live in a fixed 2021-03 window the rolling demo seed never
 * occupies; every row is run-tagged and removed in `afterAll`.
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasTestDb = Boolean(TEST_URL);

const RUN_ID = makeRunId('e2eexp');
// Whole Vietnam month of March 2021 as UTC bounds:
// 2021-03-01 00:00 VN == 2021-02-28T17:00Z, 2021-03-31 23:59:59 VN == 2021-03-31T16:59:59Z.
const WINDOW = `from=2021-02-28T17:00:00.000Z&to=2021-03-31T16:59:59.000Z`;

const INJ_PRODUCT = `=2+2 &SUM(A1:A9) ${RUN_ID}`;
const INJ_REASON = `+2+2(cmd|'/c calc'!A0) ${RUN_ID}`;

async function getBytes(
  app: INestApplication,
  token: string | null,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; bytes: Buffer }> {
  let req = request(app.getHttpServer()).get(path);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  const res = await req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k] = String(v);
  return { status: res.status, headers, bytes: res.body as Buffer };
}

async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.read(Readable.from(bytes));
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('xlsx has no worksheet');
  return ws;
}

/**
 * Readable text of an ExcelJS cell. Formula cells (`{ formula }`) can never
 * appear in our exports — the builders only write values — so surfacing one
 * here as JSON keeps a hostile or unexpected cell visible instead of
 * collapsing to `[object Object]`.
 */
function cellText(value: ExcelJS.CellValue | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** Rows of the table whose title cell matches, as raw ExcelJS values. */
function tableRows(ws: ExcelJS.Worksheet, title: string): unknown[][] {
  const rows: unknown[][] = [];
  let capture = false;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const first = row.getCell(1);
    const firstText = cellText(first.value);
    if (firstText === title) {
      capture = true;
      return;
    }
    if (capture) {
      // A subsequent table title is a lone bold size-12 cell (merged across);
      // data and placeholder rows never use that style — stop there.
      const font = first.font ?? {};
      if (firstText !== '' && font.bold === true && (font as { size?: number }).size === 12) {
        capture = false;
        return;
      }
      const vals: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (c) => vals.push(c.value));
      rows.push(vals);
    }
  });
  // Drop the header row (first captured row).
  return rows.slice(1);
}

describe.skipIf(!hasTestDb)('Reports + settlement export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: E2eFixtures;
  let adminToken: string;
  let customerToken: string;

  const O1 = `${RUN_ID}-ORDEXP1`;
  const O2 = `${RUN_ID}-ORDEXP2`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    prisma = createFixturePrisma(TEST_URL!);
    await purgeStaleFixtures(prisma);
    fixtures = await seedFixtures(prisma, RUN_ID);
    app = await createTestApp();
    adminToken = await login(app, fixtures.adminEmail, E2E_ADMIN_PASSWORD);
    customerToken = await login(app, fixtures.customerEmail, E2E_CUSTOMER_PASSWORD);

    // ---- injection-probe product + variant ------------------------------
    const injProduct = await prisma.product.create({
      data: {
        partnerId: fixtures.partnerAId,
        categoryId: fixtures.categoryAId,
        farmId: fixtures.farmAId,
        name: INJ_PRODUCT,
        slug: `${RUN_ID}-inj-sp`,
        status: 'ACTIVE',
      },
    });
    const injVariant = await prisma.productVariant.create({
      data: {
        productId: injProduct.id,
        sku: `${RUN_ID}-INJ`,
        name: 'Gói 1kg',
        saleUnit: 'gói',
        basePrice: 25000,
        status: 'ACTIVE',
      },
    });

    // ---- O1: delivered, TWO partner orders, mixed cash timing ------------
    const o1 = await prisma.order.create({
      data: {
        code: O1,
        customerId: fixtures.customerId,
        shippingAddressSnapshot: { recipientName: 'E2E EXP', phone: '090', province: 'HN', detail: 'x' },
        subtotal: 130000,
        discountTotal: 0,
        shippingFee: 20000,
        grandTotal: 150000,
        status: 'DELIVERED',
        createdAt: new Date('2021-03-05T02:00:00Z'),
      },
    });
    const poA = await prisma.partnerOrder.create({
      data: {
        code: `${RUN_ID}-POA`,
        orderId: o1.id,
        partnerId: fixtures.partnerAId,
        subtotal: 100000,
        discountTotal: 0,
        commissionAmount: 5000,
        payableAmount: 95000,
        status: 'DELIVERED',
      },
    });
    await prisma.partnerOrder.create({
      data: {
        code: `${RUN_ID}-POB`,
        orderId: o1.id,
        partnerId: fixtures.partnerBId,
        subtotal: 50000,
        discountTotal: 0,
        commissionAmount: 2500,
        payableAmount: 47500,
        status: 'DELIVERED',
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        partnerOrderId: poA.id,
        productVariantId: injVariant.id,
        productNameSnapshot: INJ_PRODUCT,
        skuSnapshot: `${RUN_ID}-INJ`,
        unitPriceSnapshot: 25000,
        quantity: 4,
        subtotal: 100000,
        discountAmount: 0,
      },
    });
    const p1 = await prisma.payment.create({
      data: {
        orderId: o1.id,
        method: 'COD',
        amount: 100000,
        status: 'PAID',
        paidAt: new Date('2021-03-06T01:00:00Z'),
      },
    });
    // Collected AFTER the window: must not count.
    await prisma.payment.create({
      data: {
        orderId: o1.id,
        method: 'VNPAY',
        amount: 50000,
        status: 'PAID',
        paidAt: new Date('2021-04-02T01:00:00Z'),
      },
    });
    await prisma.refund.create({
      data: {
        paymentId: p1.id,
        amount: 20000,
        reason: 'e2eexp partial',
        status: 'COMPLETED',
        completedAt: new Date('2021-03-07T01:00:00Z'),
      },
    });
    // Pending refund: must not count.
    await prisma.refund.create({
      data: { paymentId: p1.id, amount: 5000, reason: 'e2eexp pending', status: 'PENDING' },
    });

    // ---- O2: cancelled, no payments — row present, cash zero -------------
    await prisma.order.create({
      data: {
        code: O2,
        customerId: fixtures.customerId,
        shippingAddressSnapshot: { recipientName: 'E2E EXP', phone: '090', province: 'HN', detail: 'x' },
        subtotal: 999000,
        discountTotal: 0,
        shippingFee: 0,
        grandTotal: 999000,
        status: 'CANCELLED',
        createdAt: new Date('2021-03-06T02:00:00Z'),
      },
    });

    await prisma.returnRequest.create({
      data: {
        orderId: o1.id,
        orderItemId: item.id,
        customerId: fixtures.customerId,
        quantity: 1,
        reason: INJ_REASON,
        status: 'REQUESTED',
        createdAt: new Date('2021-03-08T02:00:00Z'),
      },
    });
    await prisma.complaint.create({
      data: {
        customerId: fixtures.customerId,
        orderId: o1.id,
        orderItemId: item.id,
        type: 'PRODUCT_QUALITY',
        content: `Khiếu nại ${RUN_ID}`,
        status: 'OPEN',
        createdAt: new Date('2021-03-09T02:00:00Z'),
      },
    });
  }, 60000);

  afterAll(async () => {
    await cleanupFixtures(prisma, fixtures).catch(() => undefined);
    if (prisma) {
      const leftovers = await prisma.user.count({ where: { email: { startsWith: RUN_ID } } }).catch(() => -1);
      expect(leftovers).toBe(0);
    }
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
  });

  it('exports a real xlsx whose order grain reconciles with the summary KPIs', async () => {
    const summary = await request(app.getHttpServer())
      .get(`/api/v1/reports/summary?${WINDOW}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(summary.body.orders.totalOrderValue).toBe(150000);
    expect(summary.body.revenue.grossCollected).toBe(100000);
    expect(summary.body.revenue.refundTotal).toBe(20000);
    expect(summary.body.revenue.netCollected).toBe(80000);
    expect(summary.body.commissionRecorded).toBe(7500);

    const x = await getBytes(app, adminToken, `/api/v1/reports/export?format=xlsx&${WINDOW}`);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(x.headers['content-disposition']).toContain(
      `AgriMarket_BaoCao_2021-03-01_2021-03-31.xlsx`,
    );
    expect(x.bytes.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

    const ws = await loadWorkbook(x.bytes);
    const rows = tableRows(ws, 'Đơn hàng trong kỳ (mỗi đơn một dòng — tổng tiền không nhân theo số đối tác)');
    const byCode = new Map(rows.map((r) => [String(r[0]), r]));
    // Exactly our two orders — one row each, no partner multiplication.
    expect([...byCode.keys()].filter((c) => c.startsWith(RUN_ID)).sort()).toEqual([O1, O2]);

    const o1 = byCode.get(O1)!;
    expect(o1[7]).toBe(150000); // Tổng phải trả (numeric)
    expect(o1[8]).toBe(100000); // Đã thu trong kỳ (April payment excluded)
    expect(o1[9]).toBe(20000); // Đã hoàn trong kỳ (pending refund excluded)
    expect(String(o1[2])).toContain('2 đối tác');

    const o2 = byCode.get(O2)!;
    expect(o2[7]).toBe(999000);
    expect(o2[8]).toBe(0);
    expect(o2[9]).toBe(0);

    // Grain reconciliation: non-cancelled grandTotal == GMV, cash == net.
    const active = rows.filter((r) => !String(r[2]).includes('hủy'));
    const fileGrand = active
      .filter((r) => String(r[0]).startsWith(RUN_ID))
      .reduce((s, r) => s + Number(r[7]), 0);
    expect(fileGrand).toBe(summary.body.orders.totalOrderValue);
    const fileNet = rows
      .filter((r) => String(r[0]).startsWith(RUN_ID))
      .reduce((s, r) => s + Number(r[8]) - Number(r[9]), 0);
    expect(fileNet).toBe(summary.body.revenue.netCollected);
  });

  it('stores hostile text as plain strings, never formulas', async () => {
    const x = await getBytes(app, adminToken, `/api/v1/reports/export?format=xlsx&${WINDOW}`);
    expect(x.status).toBe(200);
    const ws = await loadWorkbook(x.bytes);

    const top = tableRows(ws, 'Sản phẩm bán chạy');
    const injRow = top.find((r) => String(r[0]).includes(RUN_ID));
    expect(injRow).toBeDefined();
    // A formula cell would be `{ formula: ... }`; a text cell is a string.
    expect(typeof injRow![0]).toBe('string');
    expect(String(injRow![0]).startsWith('=2+2')).toBe(true);

    const returns = tableRows(ws, 'Trả hàng trong kỳ');
    const injReturn = returns.find((r) => String(r[4]).includes(RUN_ID));
    expect(injReturn).toBeDefined();
    expect(typeof injReturn![4]).toBe('string');
  });

  it('exports a real PDF with extractable Vietnamese text', async () => {
    const p = await getBytes(app, adminToken, `/api/v1/reports/export?format=pdf&${WINDOW}`);
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toContain('application/pdf');
    expect(p.headers['content-disposition']).toContain(
      `AgriMarket_BaoCao_2021-03-01_2021-03-31.pdf`,
    );
    expect(p.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const text = extractPdfText(p.bytes);
    const flat = text.replace(/\s+/g, '');
    for (const needle of [
      'Báocáotổnghợp',
      'Tổnggiátrịđơnhàng',
      '150.000',
      'Hoahồngđãghinhận',
      '7.500',
      'Đơnhàngtrongkỳ',
      'Trảhàngtrongkỳ',
      'Khiếunạitrongkỳ',
      O1.replace(/\s+/g, ''),
    ]) {
      expect(flat).toContain(needle);
    }
  });

  it('exports every row past 100 (no list cap)', async () => {
    const N = 105;
    await prisma.order.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        code: `${RUN_ID}-BULK-${String(i).padStart(4, '0')}`,
        customerId: fixtures.customerId,
        shippingAddressSnapshot: { recipientName: 'E2E', phone: '0', province: 'HN', detail: 'x' },
        subtotal: 10000,
        discountTotal: 0,
        shippingFee: 0,
        grandTotal: 10000,
        status: 'DELIVERED' as never,
        createdAt: new Date('2021-03-10T02:00:00Z'),
      })),
    });

    const summary = await request(app.getHttpServer())
      .get(`/api/v1/reports/summary?${WINDOW}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(summary.body.orders.count).toBeGreaterThanOrEqual(N + 2);

    const x = await getBytes(app, adminToken, `/api/v1/reports/export?format=xlsx&${WINDOW}`);
    expect(x.status).toBe(200);
    const ws = await loadWorkbook(x.bytes);
    const rows = tableRows(ws, 'Đơn hàng trong kỳ (mỗi đơn một dòng — tổng tiền không nhân theo số đối tác)');
    const bulk = rows.filter((r) => String(r[0]).startsWith(`${RUN_ID}-BULK-`));
    expect(bulk).toHaveLength(N);
  }, 60000);

  it('returns an empty-but-valid file for a window with no data', async () => {
    const x = await getBytes(
      app,
      adminToken,
      '/api/v1/reports/export?format=xlsx&from=2020-05-31T17:00:00.000Z&to=2020-06-07T16:59:59.000Z',
    );
    expect(x.status).toBe(200);
    const ws = await loadWorkbook(x.bytes);
    const rows = tableRows(ws, 'Đơn hàng trong kỳ (mỗi đơn một dòng — tổng tiền không nhân theo số đối tác)');
    expect(rows).toHaveLength(1);
    expect(String(rows[0][0])).toContain('Không có đơn hàng');
  });

  it('enforces auth and validates the export query', async () => {
    await getBytes(app, null, `/api/v1/reports/export?format=xlsx&${WINDOW}`).then((r) =>
      expect(r.status).toBe(401),
    );
    await getBytes(app, customerToken, `/api/v1/reports/export?format=xlsx&${WINDOW}`).then((r) =>
      expect(r.status).toBe(403),
    );
    await getBytes(app, adminToken, `/api/v1/reports/export?format=csv&${WINDOW}`).then((r) =>
      expect(r.status).toBe(400),
    );
    await getBytes(
      app,
      adminToken,
      '/api/v1/reports/export?format=xlsx&from=2021-03-31T00:00:00.000Z&to=2021-03-01T00:00:00.000Z',
    ).then((r) => expect(r.status).toBe(400));
  });

  it('exports the settlement statement and reflects payout truthfully', async () => {
    const id = fixtures.settlementId;

    /** Every cell's text — meta values live in column 2, KPI values in column 2/5. */
    const sheetText = (ws: ExcelJS.Worksheet): string => {
      const parts: string[] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (c) => parts.push(cellText(c.value)));
      });
      return parts.join(' ');
    };

    /** Value of the meta row whose label cell matches (e.g. 'Trạng thái:'). */
    const metaValue = (ws: ExcelJS.Worksheet, label: string): string | null => {
      let found: string | null = null;
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (cellText(row.getCell(1).value) === label) {
          found = cellText(row.getCell(2).value);
        }
      });
      return found;
    };

    /** Value next to a KPI label in the two-per-line KPI band. */
    const kpiValue = (ws: ExcelJS.Worksheet, label: string): string | null => {
      let found: string | null = null;
      ws.eachRow({ includeEmpty: false }, (row) => {
        // [col1 label, col1 value, col4 label, col4 value]
        const cells = [1, 2, 4, 5].map((i) => cellText(row.getCell(i).value));
        if (cells[0] === label) found = cells[1];
        if (cells[2] === label) found = cells[3];
      });
      return found;
    };

    const x = await getBytes(app, adminToken, `/api/v1/settlements/${id}/export?format=xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml.sheet');
    const ws = await loadWorkbook(x.bytes);
    const flat = sheetText(ws);
    expect(flat).toContain(`Bảng đối soát ${RUN_ID}-SET`);
    expect(metaValue(ws, 'Trạng thái:')).toBe('Nháp');
    expect(kpiValue(ws, 'Đã chi trả')).toBe('0 ₫');
    expect(kpiValue(ws, 'Còn phải trả')).toBe('95.000 ₫');

    // Confirm + pay through the real endpoints, then re-export: paid and
    // outstanding must move, and CONFIRMED must never read as paid.
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const mid = await getBytes(app, adminToken, `/api/v1/settlements/${id}/export?format=xlsx`);
    const wsMid = await loadWorkbook(mid.bytes);
    expect(metaValue(wsMid, 'Trạng thái:')).toBe('Đã xác nhận');
    // Still nothing paid out: the KPI stays 0 and the payout row is pending.
    expect(kpiValue(wsMid, 'Đã chi trả')).toBe('0 ₫');
    expect(kpiValue(wsMid, 'Còn phải trả')).toBe('95.000 ₫');

    await request(app.getHttpServer())
      .post(`/api/v1/payouts/${fixtures.payoutId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const done = await getBytes(app, adminToken, `/api/v1/settlements/${id}/export?format=xlsx`);
    const wsDone = await loadWorkbook(done.bytes);
    expect(metaValue(wsDone, 'Trạng thái:')).toBe('Đã chi trả');
    expect(kpiValue(wsDone, 'Đã chi trả')).toBe('95.000 ₫');
    expect(kpiValue(wsDone, 'Còn phải trả')).toBe('0 ₫');

    const p = await getBytes(app, adminToken, `/api/v1/settlements/${id}/export?format=pdf`);
    expect(p.status).toBe(200);
    expect(p.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(extractPdfText(p.bytes).replace(/\s+/g, '')).toContain('Bảngđốisoát');

    await getBytes(app, customerToken, `/api/v1/settlements/${id}/export?format=xlsx`).then((r) =>
      expect(r.status).toBe(403),
    );
  }, 60000);
});
