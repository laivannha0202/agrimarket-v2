import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { OrdersService } from './orders.service.js';
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatMoney } from '../common/export/format.js';
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  labelOf,
} from '../common/export/labels.js';

const _require = createRequire(import.meta.url);
function fontPath(file: string): string {
  const pkgJson = _require.resolve('dejavu-fonts-ttf/package.json');
  return join(dirname(pkgJson), 'ttf', file);
}

const FONT_REGULAR = 'DejaVuSans';
const FONT_BOLD = 'DejaVuSans-Bold';

/**
 * All timestamps are shown in Vietnam time regardless of the server clock, in
 * the `dd/MM/yyyy HH:mm` shape a Vietnamese paper document uses. `vi-VN`'s
 * default `toLocaleString` yields "10:00:00 1/10/2026", which reads like a
 * timestamp glued onto an unformatted date.
 */
function vnDateTime(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

function logoPath(): string | null {
  // `src/orders` when run from sources, `dist/src/orders` after `nest build`;
  // both are two levels below the folder that holds `assets/`.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'assets', 'brand', 'leaf_mark_512.png'),
    join(process.cwd(), 'dist', 'assets', 'brand', 'leaf_mark_512.png'),
    join(here, '..', '..', 'assets', 'brand', 'leaf_mark_512.png'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function addressText(addr: Record<string, unknown> | null): string {
  const a = addr ?? {};
  if (!addr) return '—';
  const commune = asText(a.wardName ?? a.ward, '');
  const hasCatalogueWard = Boolean(addr.wardName);
  const joined = [
    asText(a.detail, ''),
    asText(a.village, ''),
    commune,
    hasCatalogueWard ? '' : asText(a.district, ''),
    asText(a.province, ''),
  ]
    .filter((p) => p)
    .join(', ');
  return joined || '—';
}

/** Snapshot fields are `unknown`: never let an object stringify to "[object Object]". */
function asText(value: unknown, fallback = '—'): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function quantityUnit(item: { productVariant?: { saleUnit?: unknown; weightUnit?: unknown } | null }): string {
  const u = item.productVariant?.saleUnit ?? item.productVariant?.weightUnit;
  return typeof u === 'string' && u.trim() ? u : 'đv';
}

function formatQty(value: unknown, unit?: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return asText(value);
  const trimmed = n.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
  return unit ? `${trimmed} ${unit}` : trimmed;
}

@Injectable()
export class OrderDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  private makeDoc(): { doc: InstanceType<typeof PDFDocument>; done: Promise<Buffer> } {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    doc.registerFont(FONT_REGULAR, fontPath('DejaVuSans.ttf'));
    doc.registerFont(FONT_BOLD, fontPath('DejaVuSans-Bold.ttf'));
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    return { doc, done };
  }

  private drawLogo(doc: InstanceType<typeof PDFDocument>, x: number, y: number, size = 44): void {
    const p = logoPath();
    if (p) {
      try {
        doc.image(readFileSync(p), x, y, { width: size, height: size });
        return;
      } catch {
        // fall through
      }
    }
    // No logo asset available: render brand name text only (no fake icon).
    doc.font(FONT_BOLD).fontSize(16).fillColor('#087A3B').text('AgriMarket', x, y);
  }

  private footer(
    doc: InstanceType<typeof PDFDocument>,
    pageRange: { start: number; count: number },
    generatedAt: Date,
  ): void {
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
      doc.switchToPage(i);
      this.inBottomMargin(doc, () => {
        const y = 841.89 - 30;
        doc.font(FONT_REGULAR).fontSize(8).fillColor('#777777');
        doc.text('Phiếu xác nhận đơn hàng — không phải hóa đơn VAT hợp pháp.', 40, y, { width: 360, lineBreak: false });
        doc.text(`Trang ${i - pageRange.start + 1}/${pageRange.count}`, 40, y, { width: 515, align: 'right', lineBreak: false });
        doc.text(`Xuất lúc ${vnDateTime(generatedAt)}`, 40, y + 10, { width: 515, align: 'right', lineBreak: false });
      });
    }
  }

  /**
   * The footer belongs in the page's bottom margin, but PDFKit starts a new
   * page whenever text is drawn below `page.maxY()` (height − bottom margin).
   * Drawing the footer therefore appended a blank page per line: a 4-page
   * order came out as 16 pages and pages 5+ carried no page number. Lifting the
   * bottom margin for the duration of the footer keeps the text on its page.
   */
  private inBottomMargin(doc: InstanceType<typeof PDFDocument>, draw: () => void): void {
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    try {
      draw();
    } finally {
      doc.page.margins.bottom = bottom;
    }
  }

  async renderOrderPdf(orderId: number, customerId?: number): Promise<Buffer> {
    const order = await this.orders.findOne(orderId, customerId);
    const { doc, done } = this.makeDoc();
    const PAGE_W = 595.28;
    const M = 40;
    const CW = PAGE_W - M * 2;
    let y = M;

    // Header
    this.drawLogo(doc, M, y, 46);
    doc.font(FONT_BOLD).fontSize(15).fillColor('#087A3B').text('AgriMarket', M + 56, y + 4);
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#555555').text('Nông sản sạch, rõ nguồn gốc', M + 56, y + 22);

    doc.font(FONT_BOLD).fontSize(15).fillColor('#111111').text('PHIẾU XÁC NHẬN ĐƠN HÀNG', M, y, { width: CW, align: 'right' });
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#555555').text(`Mã đơn: ${order.code}`, M, y + 20, { width: CW, align: 'right' });
    doc.text(`Ngày đặt: ${vnDateTime(order.createdAt)}`, M, y + 34, { width: CW, align: 'right' });
    doc.text(`Ngày xuất: ${vnDateTime(new Date())}`, M, y + 48, { width: CW, align: 'right' });
    doc.text(`Trạng thái: ${labelOf(ORDER_STATUS_LABEL, order.status)}`, M, y + 62, { width: CW, align: 'right' });

    y += 82;
    doc.moveTo(M, y).lineTo(PAGE_W - M, y).strokeColor('#cccccc').stroke();
    y += 14;

    // Buyer / recipient
    const addr = order.shippingAddressSnapshot as unknown as Record<string, unknown> | null;
    const colW = CW / 2 - 8;
    doc.font(FONT_BOLD).fontSize(11).fillColor('#087A3B').text('Thông tin người mua', M, y);
    doc.font(FONT_BOLD).fontSize(11).fillColor('#087A3B').text('Giao nhận', M + colW + 16, y);
    y += 16;
    const buyerLines = [
      ['Người đặt hàng', order.customer?.fullName ?? '—'],
      ['Email', order.customer?.email ?? '—'],
      ['Số điện thoại', order.customer?.phone ?? '—'],
    ];
    const shipLines = [
      ['Người nhận', asText(addr?.recipientName)],
      ['Số điện thoại', asText(addr?.phone)],
      ['Địa chỉ', addressText(addr)],
      [
        'Phương thức thanh toán',
        order.payments?.[0]
          ? labelOf(PAYMENT_METHOD_LABEL, order.payments[0].method)
          : 'Chưa có thanh toán',
      ],
      [
        'Trạng thái thanh toán',
        order.payments?.[0]
          ? labelOf(PAYMENT_STATUS_LABEL, order.payments[0].status)
          : '—',
      ],
    ];
    let yL = y;
    for (const [k, v] of buyerLines) {
      doc.font(FONT_BOLD).fontSize(9).fillColor('#333333').text(`${k}:`, M, yL, { width: colW, continued: false });
      doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(v, M, yL + 11, { width: colW });
      yL = doc.y + 6;
    }
    let yR = y;
    for (const [k, v] of shipLines) {
      doc.font(FONT_BOLD).fontSize(9).fillColor('#333333').text(`${k}:`, M + colW + 16, yR, { width: colW });
      doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(v, M + colW + 16, yR + 11, { width: colW });
      yR = doc.y + 6;
    }
    y = Math.max(yL, yR) + 8;
    if (order.note) {
      doc.font(FONT_BOLD).fontSize(9).fillColor('#333333').text('Ghi chú giao hàng:', M, y);
      doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(order.note, M, y + 11, { width: CW });
      y = doc.y + 10;
    }

    // Product table
    const cols = [
      { h: 'STT', w: 34, a: 'center' as const },
      { h: 'Sản phẩm', w: CW - 34 - 52 - 74 - 62 - 86, a: 'left' as const },
      { h: 'ĐVT', w: 52, a: 'center' as const },
      { h: 'SL', w: 40, a: 'center' as const },
      { h: 'Đơn giá', w: 74, a: 'right' as const },
      { h: 'Thành tiền', w: 86, a: 'right' as const },
    ];
    // fix widths sum
    cols[1].w = CW - (cols[0].w + cols[2].w + cols[3].w + cols[4].w + cols[5].w);

    const drawHeader = () => {
      const h = 20;
      doc.rect(M, y, CW, h).fill('#e8f2e9');
      let x = M;
      for (const c of cols) {
        doc.font(FONT_BOLD).fontSize(9).fillColor('#1f5c33').text(c.h, x + 3, y + 6, { width: c.w - 6, align: c.a, lineBreak: false });
        x += c.w;
      }
      y += h;
    };
    drawHeader();

    let stt = 0;
    for (const po of order.partnerOrders ?? []) {
      if ((order.partnerOrders?.length ?? 0) > 1) {
        // group header
        if (y + 16 > 801) { doc.addPage(); y = M; drawHeader(); }
        doc.font(FONT_BOLD).fontSize(9).fillColor('#087A3B').text(`Đối tác: ${po.partner?.name ?? po.code}`, M, y + 3, { width: CW });
        y += 16;
      }
      for (const it of po.items ?? []) {
        stt += 1;
        // Snapshots are `unknown` at runtime (old rows, partial backfills):
        // never hand an object to PDFKit — it would throw or print
        // "[object Object]" into a customer-facing document.
        const name = asText(it.productNameSnapshot, '—');
        const sku = asText(it.skuSnapshot, '');
        const unit = quantityUnit(it);
        const qty = formatQty(it.quantity, null);
        const price = formatMoney(Number(it.unitPriceSnapshot));
        const sub = formatMoney(Number(it.subtotal));
        doc.font(FONT_REGULAR).fontSize(9);
        const nameH = doc.heightOfString(name, { width: cols[1].w - 6 });
        const rowH = Math.max(14, nameH) + 6;
        if (y + rowH > 801) {
          doc.addPage();
          y = M;
          drawHeader();
        }
        let x = M;
        doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(String(stt), x + 3, y + 3, { width: cols[0].w - 6, align: 'center', lineBreak: false });
        x += cols[0].w;
        doc.text(name, x + 3, y + 3, { width: cols[1].w - 6 });
        if (sku) {
          doc.font(FONT_REGULAR).fontSize(8).fillColor('#777777').text(`SKU: ${sku}`, x + 3, doc.y + 1, { width: cols[1].w - 6 });
        }
        x += cols[1].w;
        doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(unit, x + 3, y + 3, { width: cols[2].w - 6, align: 'center', lineBreak: false });
        x += cols[2].w;
        doc.text(qty, x + 3, y + 3, { width: cols[3].w - 6, align: 'center', lineBreak: false });
        x += cols[3].w;
        doc.text(price, x + 3, y + 3, { width: cols[4].w - 6, align: 'right', lineBreak: false });
        x += cols[4].w;
        doc.font(FONT_BOLD).text(sub, x + 3, y + 3, { width: cols[5].w - 6, align: 'right', lineBreak: false });
        // row bottom line
        y += rowH;
        doc.moveTo(M, y).lineTo(PAGE_W - M, y).strokeColor('#eeeeee').stroke();
        y += 2;
      }
    }

    // Totals
    y += 6;
    if (y + 120 > 801) { doc.addPage(); y = M; }
    const totals: Array<[string, string, boolean]> = [
      ['Tạm tính', formatMoney(Number(order.subtotal)), false],
    ];
    if (Number(order.discountTotal) > 0) totals.push(['Giảm giá', `-${formatMoney(Number(order.discountTotal))}`, false]);
    // `discountTotal` already contains every voucher redemption, so the voucher
    // rows are informational. Printing the amount again would subtract it twice.
    for (const v of order.voucherRedemptions ?? []) {
      totals.push([`Voucher #${v.voucherId}`, 'đã tính trong Giảm giá', false]);
    }
    totals.push(['Phí giao hàng', formatMoney(Number(order.shippingFee)), false]);
    totals.push(['TỔNG THANH TOÁN', formatMoney(Number(order.grandTotal)), true]);
    const payment = order.payments?.[0];
    // Money was collected for every status except PENDING/FAILED. A
    // PARTIALLY_REFUNDED payment is still a collected payment — printing
    // "Chưa thu tiền" for it would contradict the order detail and the
    // settlement (which books the money as collected).
    const collected =
      payment != null &&
      ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status);
    // Only COMPLETED refunds have moved money. PENDING/APPROVED rows are
    // decisions, and counting them here would overstate what the customer got
    // back.
    const refunded = (payment?.refunds ?? [])
      .filter((r: { status?: string }) => r.status === 'COMPLETED')
      .reduce((s: number, r: { amount: unknown }) => s + Number(r.amount), 0);
    if (payment) {
      totals.push([
        'Đã thanh toán / đã thu',
        collected ? formatMoney(Number(payment.amount)) : 'Chưa thu tiền',
        false,
      ]);
      if (!collected && payment.method === 'COD') {
        totals.push(['Còn phải thanh toán', formatMoney(Number(payment.amount)), false]);
      }
      if (refunded > 0) {
        totals.push(['Đã hoàn tiền', formatMoney(refunded), false]);
        totals.push([
          'Thực thu sau hoàn tiền',
          formatMoney(Number(payment.amount) - refunded),
          false,
        ]);
      }
    }
    const labelX = PAGE_W - M - 260;
    const valueX = PAGE_W - M - 120;
    for (const [label, value, bold] of totals) {
      doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(bold ? 11 : 10).fillColor(bold ? '#087A3B' : '#222222');
      doc.text(label, labelX, y, { width: 140, align: 'left' });
      doc.text(value, valueX, y, { width: 120, align: 'right' });
      y += 16;
      if (bold) {
        doc.moveTo(labelX, y - 2).lineTo(PAGE_W - M, y - 2).strokeColor('#087A3B').stroke();
      }
    }

    y += 8;
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#555555').text(
      'Ghi chú: Phiếu xác nhận đơn hàng, dùng để xác nhận thông tin đơn hàng và giao nhận. Không phải hóa đơn GTGT/hóa đơn điện tử hợp pháp.',
      M, y, { width: CW },
    );
    y = doc.y + 6;
    doc.text('Tra cứu đơn hàng theo mã đơn tại hệ thống AgriMarket.', M, y, { width: CW });

    const range = doc.bufferedPageRange();
    this.footer(doc, range, new Date());
    doc.end();
    return done;
  }

  async renderPackingSlip(orderId: number): Promise<Buffer> {
    // Admin-only route: the controller never passes a customer scope.
    const order = await this.orders.findOne(orderId);
    const { doc, done } = this.makeDoc();
    const PAGE_W = 595.28;
    const M = 40;
    const CW = PAGE_W - M * 2;
    let y = M;

    this.drawLogo(doc, M, y, 40);
    doc.font(FONT_BOLD).fontSize(16).fillColor('#087A3B').text('PHIẾU SOẠN HÀNG', M + 50, y + 4);
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#555555').text('Dùng nội bộ kho / vận chuyển / đóng gói', M + 50, y + 24);
    y += 52;

    const addr = order.shippingAddressSnapshot as unknown as Record<string, unknown> | null;
    const meta: Array<[string, string]> = [
      ['Mã đơn', order.code],
      ['Ngày tạo', vnDateTime(order.createdAt)],
      ['Người nhận', asText(addr?.recipientName)],
      ['Số điện thoại', asText(addr?.phone)],
      ['Địa chỉ giao', addressText(addr)],
    ];
    for (const po of order.partnerOrders ?? []) {
      meta.push(['Đơn đối tác', `${po.code} — ${po.partner?.name ?? ''}`]);
    }
    for (const [k, v] of meta) {
      doc.font(FONT_BOLD).fontSize(9).fillColor('#333333').text(`${k}:`, M, y, { width: 110 });
      doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(v, M + 115, y, { width: CW - 115 });
      y = doc.y + 4;
    }

    y += 8;
    const cols = [
      { h: 'STT', w: 34 },
      { h: 'Sản phẩm / SKU', w: CW - 34 - 70 - 60 - 90 },
      { h: 'ĐVT', w: 70 },
      { h: 'SL soạn', w: 60 },
      { h: 'Lô hàng', w: 90 },
    ];
    cols[1].w = CW - (cols[0].w + cols[2].w + cols[3].w + cols[4].w);

    const drawHeader = () => {
      const h = 20;
      doc.rect(M, y, CW, h).fill('#e8f2e9');
      let x = M;
      for (const c of cols) {
        doc.font(FONT_BOLD).fontSize(9).fillColor('#1f5c33').text(c.h, x + 3, y + 6, { width: c.w - 6, align: 'center', lineBreak: false });
        x += c.w;
      }
      y += h;
    };
    // fix first col left align
    drawHeader();

    let stt = 0;
    for (const po of order.partnerOrders ?? []) {
      if ((order.partnerOrders?.length ?? 0) > 1) {
        if (y + 16 > 801) { doc.addPage(); y = M; drawHeader(); }
        doc.font(FONT_BOLD).fontSize(10).fillColor('#087A3B').text(`Đối tác: ${po.partner?.name ?? po.code} (${po.code})`, M, y + 3, { width: CW });
        y += 18;
      }
      for (const it of po.items ?? []) {
        stt += 1;
        const unit = quantityUnit(it);
        const lots = (it.allocations ?? [])
          .map(
            (a: { productLot?: { code?: unknown } | null; quantity: unknown }) =>
              `${asText(a.productLot?.code, '')} (${formatQty(a.quantity, null)})`,
          )
          .filter(Boolean)
          .join(', ') || '—';
        const name = `${asText(it.productNameSnapshot, '—')}\nSKU: ${asText(it.skuSnapshot, '—')}`;
        doc.font(FONT_REGULAR).fontSize(9);
        const nameH = doc.heightOfString(name, { width: cols[1].w - 6 });
        const rowH = Math.max(16, nameH) + 8;
        if (y + rowH > 801) { doc.addPage(); y = M; drawHeader(); }
        let x = M;
        doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222').text(String(stt), x + 3, y + 3, { width: cols[0].w - 6, align: 'center', lineBreak: false });
        x += cols[0].w;
        doc.text(name, x + 3, y + 3, { width: cols[1].w - 6 });
        x += cols[1].w;
        doc.text(unit, x + 3, y + 3, { width: cols[2].w - 6, align: 'center', lineBreak: false });
        x += cols[2].w;
        doc.font(FONT_BOLD).text(formatQty(it.quantity, null), x + 3, y + 3, { width: cols[3].w - 6, align: 'center', lineBreak: false });
        x += cols[3].w;
        doc.font(FONT_REGULAR).fontSize(8).text(lots, x + 3, y + 3, { width: cols[4].w - 6 });
        y += rowH;
        doc.moveTo(M, y - 2).lineTo(PAGE_W - M, y - 2).strokeColor('#eeeeee').stroke();
        // checkbox
        doc.rect(PAGE_W - M - 16, y - rowH + 4, 12, 12).strokeColor('#999999').stroke();
      }
      y += 6;
    }

    y += 8;
    if (y + 90 > 801) { doc.addPage(); y = M; }
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#222222');
    doc.text('Ghi chú đóng gói: ________________________________________________________________', M, y, { width: CW });
    y += 24;
    const sigY = y;
    for (let i = 0; i < 3; i++) {
      const x = M + i * (CW / 3);
      doc.font(FONT_BOLD).fontSize(9).text(['Người soạn', 'Người kiểm', 'Bàn giao'][i], x, sigY, { width: CW / 3 - 8, align: 'center' });
      doc.font(FONT_REGULAR).fontSize(8).text('Ký và ghi rõ họ tên', x, sigY + 40, { width: CW / 3 - 8, align: 'center' });
      doc.moveTo(x + 10, sigY + 34).lineTo(x + CW / 3 - 18, sigY + 34).strokeColor('#cccccc').stroke();
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      this.inBottomMargin(doc, () => {
        doc.font(FONT_REGULAR).fontSize(8).fillColor('#777777').text(
          `Phiếu soạn hàng — ${order.code} · Trang ${i - range.start + 1}/${range.count}`,
          M, 841.89 - 24, { width: CW, align: 'center', lineBreak: false },
        );
      });
    }
    doc.end();
    return done;
  }
}
