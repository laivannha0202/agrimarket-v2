import { describe, expect, it, vi } from 'vitest';
import { OrderDocumentService } from '../../src/orders/order-document.service.js';
import type { OrdersService } from '../../src/orders/orders.service.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { extractPdfRuns, extractPdfText } from '../helpers/pdf-text.js';

/**
 * The PDF is a customer-facing document, so the money on it must reconcile
 * with the order exactly once. `discountTotal` already includes every voucher
 * redemption; printing the redemption amount a second time under "Voucher"
 * subtracted the discount twice — the same defect the web/mobile order detail
 * had. These tests read the rendered bytes back, not the intermediate data.
 */

function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    code: 'ORD-E2E-7',
    createdAt: new Date('2026-10-01T03:00:00.000Z'),
    status: 'PENDING_CONFIRMATION',
    customerId: 11,
    note: 'Giao giờ hành chính',
    subtotal: 200_000,
    discountTotal: 100_000,
    shippingFee: 20_000,
    grandTotal: 120_000,
    shippingAddressSnapshot: {
      recipientName: 'Nguyễn Văn Nhận',
      phone: '0912345678',
      province: 'Hưng Yên',
      district: 'Văn Giang',
      wardName: 'Tân Tiến',
      detail: 'Số 1, đường E2E',
    },
    customer: { id: 11, fullName: 'Nguyễn Văn Mua', email: 'mua@example.vn', phone: '0900000000' },
    partnerOrders: [
      {
        code: 'PORD-E2E-7',
        partner: { id: 3, code: 'P-A', name: 'HTX Rau sạch' },
        items: [
          {
            id: 1,
            productNameSnapshot: 'Cải bó xôi',
            skuSnapshot: 'SKU-CAI',
            quantity: 4,
            unitPriceSnapshot: 50_000,
            subtotal: 200_000,
            productVariant: { saleUnit: 'BÓ', weightUnit: 'KG' },
            allocations: [{ quantity: 4, productLot: { code: 'LOT-01', traceCode: 'TRACE-01', unit: 'KG' } }],
          },
        ],
      },
    ],
    payments: [
      {
        id: 2,
        method: 'COD',
        status: 'PENDING',
        amount: 120_000,
        paidAt: null,
        refunds: [],
      },
    ],
    voucherRedemptions: [{ id: 1, voucherId: 9, discountAmount: 100_000 }],
    ...overrides,
  };
}

function buildService(order: ReturnType<typeof orderFixture>) {
  const findOne = vi.fn().mockResolvedValue(order);
  const service = new OrderDocumentService(
    {} as PrismaService,
    { findOne } as unknown as OrdersService,
  );
  return { service, findOne };
}

/**
 * PDFKit splits a line into runs wherever the font or kerning changes, and the
 * extractor joins runs with a space — "L OT -01", "V oucher #9". Whitespace is
 * therefore not meaningful when asserting content; compare the squashed text.
 */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

describe('OrderDocumentService', () => {
  it('renders a real PDF with the order code and Vietnamese text', async () => {
    const { service, findOne } = buildService(orderFixture());
    const pdf = await service.renderOrderPdf(7, 11);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = squash(extractPdfText(pdf));
    expect(text).toContain('PHIẾUXÁCNHẬNĐƠNHÀNG');
    expect(text).toContain('ORD-E2E-7');
    expect(text).toContain('Cảibóxôi');
    expect(findOne).toHaveBeenCalledWith(7, 11);
  });

  it('prints the voucher as already included instead of deducting it twice', async () => {
    const { service } = buildService(orderFixture());
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));

    expect(text).toContain('Giảmgiá');
    expect(text).toContain('Voucher#9');
    expect(text).toContain('đãtínhtrongGiảmgiá');
    // 200.000 - 100.000 + 20.000: the discount amount appears exactly once.
    expect(text.match(/-100\.000/g)).toHaveLength(1);
    expect(text).toContain('120.000');
  });

  it('renders the packing slip with lot codes for warehouse staff', async () => {
    const { service } = buildService(orderFixture());
    const pdf = await service.renderPackingSlip(7);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = squash(extractPdfText(pdf));
    expect(text).toContain('PHIẾUSOẠNHÀNG');
    expect(text).toContain('LOT-01');
    expect(text).toContain('ORD-E2E-7');
  });

  it('sizes a packing row for every lot code, so the next product does not overlap it', async () => {
    // One line allocated from ten lots: the lot cell wraps over many lines. The
    // row used to be measured from the product name alone, so the wrapped lot
    // codes were drawn on top of the following product row.
    const lots = Array.from({ length: 10 }, (_, index) => ({
      quantity: 1,
      productLot: { code: `LOT-MULTI-${String(index + 1).padStart(2, '0')}`, traceCode: `T-${index}`, unit: 'KG' },
    }));
    const fixture = orderFixture();
    const partnerOrder = (fixture.partnerOrders as Array<Record<string, unknown>>)[0];
    const items = partnerOrder.items as Array<Record<string, unknown>>;
    items[0].allocations = lots;
    items.push({
      id: 2,
      productNameSnapshot: 'Sản phẩm kế tiếp',
      skuSnapshot: 'SKU-NEXT',
      quantity: 1,
      unitPriceSnapshot: 10_000,
      subtotal: 10_000,
      productVariant: { saleUnit: 'TÚI', weightUnit: 'KG' },
      allocations: [{ quantity: 1, productLot: { code: 'LOT-NEXT', traceCode: 'T-NEXT', unit: 'KG' } }],
    });

    const { service } = buildService(fixture);
    const pdf = await service.renderPackingSlip(7);
    const runs = extractPdfRuns(pdf);

    for (const lot of lots) {
      expect(squash(extractPdfText(pdf))).toContain(squash(lot.productLot.code));
    }

    const firstRowY = runs.find((run) => run.text.includes('Cải bó xôi'))?.y;
    const nextRowY = runs.find((run) => run.text.includes('Sản phẩm kế tiếp'))?.y;
    expect(firstRowY).toBeTypeOf('number');
    expect(nextRowY).toBeTypeOf('number');
    // PDF coordinates grow upwards, so the next row sits at a SMALLER y. Ten
    // wrapped lot codes occupy far more than the 30pt a name-only row
    // reserved; the following row must start below all of them.
    expect(Number(firstRowY) - Number(nextRowY)).toBeGreaterThanOrEqual(60);
  });
});

/** Count page objects (`/Type /Page`, not the `/Pages` tree node). */
function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * Document acceptance matrix (report 25, section 4).
 *
 * These render the REAL PDF and read the bytes back — text, page count, image
 * XObject and money lines — because a document that "looks fine" in code but
 * prints a wrong total or a broken page is exactly the defect being audited.
 */
describe('OrderDocumentService — document acceptance matrix', () => {
  it('embeds the official brand logo (512px PNG), not a text placeholder', async () => {
    const { service } = buildService(orderFixture());
    const pdf = await service.renderOrderPdf(7, 11);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/Subtype\s*\/Image/);
    expect(raw).toMatch(/\/Width\s+512/);
    expect(raw).toMatch(/\/Height\s+512/);
  });

  it('single product: prints name, unit, quantity, unit price and line total', async () => {
    const { service } = buildService(orderFixture());
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));
    expect(text).toContain('Cảibóxôi');
    expect(text).toContain('SKU-CAI');
    expect(text).toContain('BÓ');
    expect(text).toContain('4');
    expect(text).toContain('50.000');
    expect(text).toContain('200.000');
  });

  it('multi-partner order: groups lines by partner and totals every line', async () => {
    const fixture = orderFixture({
      subtotal: 450_000,
      discountTotal: 0,
      shippingFee: 0,
      grandTotal: 450_000,
      voucherRedemptions: [],
      payments: [
        { id: 2, method: 'COD', status: 'PAID', amount: 450_000, paidAt: new Date(), refunds: [] },
      ],
      partnerOrders: [
        {
          code: 'PORD-A',
          partner: { id: 3, code: 'P-A', name: 'HTX Rau sạch' },
          items: [
            {
              id: 1,
              productNameSnapshot: 'Cải bó xôi',
              skuSnapshot: 'SKU-CAI',
              quantity: 4,
              unitPriceSnapshot: 50_000,
              subtotal: 200_000,
              productVariant: { saleUnit: 'BÓ' },
              allocations: [],
            },
            {
              id: 2,
              productNameSnapshot: 'Cà chua bi',
              skuSnapshot: 'SKU-CA',
              quantity: 5,
              unitPriceSnapshot: 10_000,
              subtotal: 50_000,
              productVariant: { saleUnit: 'KG' },
              allocations: [],
            },
          ],
        },
        {
          code: 'PORD-B',
          partner: { id: 4, code: 'P-B', name: 'HTX Trái cây' },
          items: [
            {
              id: 3,
              productNameSnapshot: 'Cam đường',
              skuSnapshot: 'SKU-CAM',
              quantity: 10,
              unitPriceSnapshot: 15_000,
              subtotal: 150_000,
              productVariant: { saleUnit: 'KG' },
              allocations: [],
            },
            {
              id: 4,
              productNameSnapshot: 'Ổi lê',
              skuSnapshot: 'SKU-OI',
              quantity: 5,
              unitPriceSnapshot: 10_000,
              subtotal: 50_000,
              productVariant: { saleUnit: 'KG' },
              allocations: [],
            },
          ],
        },
      ],
    });
    const { service } = buildService(fixture);
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));

    expect(text).toContain('HTX Rau sạch'.replace(/\s+/g, ''));
    expect(text).toContain('HTX Trái cây'.replace(/\s+/g, ''));
    for (const name of ['Cải bó xôi', 'Cà chua bi', 'Cam đường', 'Ổi lê']) {
      expect(text).toContain(name.replace(/\s+/g, ''));
    }
    expect(text).toContain('450.000');
  });

  it('unpaid COD: says "Chưa thu tiền" and prints the amount still due', async () => {
    const { service } = buildService(orderFixture());
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));
    expect(text).toContain('Chưathutiền');
    expect(text).toContain('Cònphảithanhtoán');
    expect(text).toContain('120.000');
    expect(text).not.toContain('Đãthanhtoán/đãthu120.000');
  });

  it('partial refund: prints collected, completed refund and net collected', async () => {
    const fixture = orderFixture({
      payments: [
        {
          id: 2,
          method: 'COD',
          status: 'PARTIALLY_REFUNDED',
          amount: 120_000,
          paidAt: new Date(),
          refunds: [
            { id: 1, amount: 20_000, status: 'COMPLETED' },
            // A pending decision must not be presented as money returned.
            { id: 2, amount: 30_000, status: 'PENDING' },
          ],
        },
      ],
    });
    const { service } = buildService(fixture);
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));

    expect(text).toContain('Đãthanhtoán/đãthu120.000');
    expect(text).toContain('Đãhoàntiền20.000');
    expect(text).toContain('Thựcthusauhoàntiền100.000');
    // The PENDING 30.000 refund has not moved money and must not be printed.
    expect(text).not.toContain('30.000');
  });

  it('full refund: collected and refunded are equal, net is zero', async () => {
    const fixture = orderFixture({
      payments: [
        {
          id: 2,
          method: 'COD',
          status: 'REFUNDED',
          amount: 120_000,
          paidAt: new Date(),
          refunds: [{ id: 1, amount: 120_000, status: 'COMPLETED' }],
        },
      ],
    });
    const { service } = buildService(fixture);
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));
    expect(text).toContain('Đãhoàntiền120.000');
    expect(text).toContain('Thựcthusauhoàntiền0₫');
  });

  it('long order: paginates cleanly, repeats the table header and numbers every page', async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({
      id: i + 1,
      productNameSnapshot: `Nông sản hữu cơ dòng ${i + 1} — túi 500g đóng gói ngày thu hoạch`,
      skuSnapshot: `SKU-LONG-${i + 1}`,
      quantity: 2,
      unitPriceSnapshot: 25_000,
      subtotal: 50_000,
      productVariant: { saleUnit: 'TÚI' },
      allocations: [],
    }));
    const fixture = orderFixture({
      subtotal: 3_500_000,
      discountTotal: 0,
      shippingFee: 0,
      grandTotal: 3_500_000,
      voucherRedemptions: [],
      partnerOrders: [
        {
          code: 'PORD-LONG',
          partner: { id: 3, code: 'P-A', name: 'HTX Rau sạch' },
          items,
        },
      ],
      payments: [
        { id: 2, method: 'COD', status: 'PENDING', amount: 3_500_000, paidAt: null, refunds: [] },
      ],
    });
    const { service } = buildService(fixture);
    const pdf = await service.renderOrderPdf(7, 11);
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(2);

    const text = squash(extractPdfText(pdf));
    expect(text).toContain(`Trang1/${pages}`);
    expect(text).toContain(`Trang${pages}/${pages}`);
    expect(text).toContain('Nôngsảnhữucơdòng1—');
    expect(text).toContain('Nôngsảnhữucơdòng70—');
    expect(text).toContain('3.500.000');
  });

  it('never prints "[object Object]" when a snapshot column holds an object', async () => {
    const fixture = orderFixture({
      shippingAddressSnapshot: {
        recipientName: { unexpected: 'object' },
        phone: '0912345678',
        province: 'Hưng Yên',
        detail: 'Số 1',
      },
      partnerOrders: [
        {
          code: 'PORD-OBJ',
          partner: { id: 3, code: 'P-A', name: 'HTX Rau sạch' },
          items: [
            {
              id: 1,
              productNameSnapshot: { nested: true },
              skuSnapshot: { nested: true },
              quantity: 1,
              unitPriceSnapshot: 50_000,
              subtotal: 50_000,
              productVariant: { saleUnit: { nested: true } },
              allocations: [],
            },
          ],
        },
      ],
    });
    const { service } = buildService(fixture);
    const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));
    expect(text).not.toContain('[objectObject]');
    expect(text).toContain('—');
  });

  it('prints the export timestamp (not the order date) in Vietnam time', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
      const { service } = buildService(orderFixture());
      const text = squash(extractPdfText(await service.renderOrderPdf(7, 11)));
      // Order created 01/10/2026; the footer must show the export day.
      // 03:00Z is 10:00 in Vietnam; the export instant is 17:00 on 31/10.
      expect(text).toContain('Ngàyđặt:01/10/202610:00');
      expect(text).toContain('Ngàyxuất:31/10/202617:00');
      expect(text).toContain('Xuấtlúc31/10/202617:00');
    } finally {
      vi.useRealTimers();
    }
  });
});
