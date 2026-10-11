import { Injectable } from '@nestjs/common';
import {
  buildExportFile,
  type ExportFormat,
  type ExportedFile,
} from '../common/export/export-file.js';
import { date, money, num, text, type ReportDocument } from '../common/export/report-document.js';
import { formatDateVn, formatMoney } from '../common/export/format.js';
import {
  COMPLAINT_STATUS_LABEL,
  COMPLAINT_TYPE_LABEL,
  labelOf,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  RETURN_STATUS_LABEL,
} from '../common/export/labels.js';
import { ReportsService, type ReportsSummary } from './reports.service.js';

const ORDER_STATUS_ORDER = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_TO_SHIP',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
];

const RETURN_STATUS_ORDER = [
  'REQUESTED',
  'APPROVED',
  'RETURNING',
  'RECEIVED',
  'QC_PENDING',
  'REFUNDED',
  'REJECTED',
];

const COMPLAINT_STATUS_ORDER = ['OPEN', 'PROCESSING', 'RESOLVED', 'REJECTED'];

/**
 * Builds the `ReportDocument` for the Báo cáo page export.
 *
 * The figures are taken verbatim from `ReportsService.summary()` — the exact
 * same full-set aggregates the screen shows — so the exported file can never
 * disagree with the UI. A second, independent `daily()` call adds the
 * per-day cash-flow table; its sums equal the summary KPIs by construction
 * (both share `resolveReportWindow`).
 */
@Injectable()
export class ReportsExportService {
  constructor(private readonly reports: ReportsService) {}

  async buildSummaryDocument(
    from?: Date,
    to?: Date,
    days?: number,
  ): Promise<ReportDocument> {
    const summary: ReportsSummary = await this.reports.summary(from, to, days);
    const daily = await this.reports.daily(from, to, days);
    const details = await this.reports.detailRows(from, to, days);

    const periodLabel = `${formatDateVn(summary.from)} – ${formatDateVn(summary.to)}`;

    return {
      title: 'Báo cáo tổng hợp',
      subtitle: `Kỳ báo cáo: ${periodLabel}`,
      meta: [
        { label: 'Đơn vị tiền tệ', value: 'Việt Nam Đồng (VND)' },
        { label: 'Khoảng thời gian', value: periodLabel },
      ],
      kpis: [
        { label: 'Tổng giá trị đơn hàng', value: formatMoney(summary.orders.totalOrderValue) },
        { label: 'Doanh thu thực nhận', value: formatMoney(summary.revenue.netCollected) },
        { label: 'Tiền đã thu', value: formatMoney(summary.revenue.grossCollected) },
        { label: 'Giá trị hoàn tiền', value: formatMoney(summary.revenue.refundTotal) },
        { label: 'Hoa hồng đã ghi nhận', value: formatMoney(summary.commissionRecorded) },
        { label: 'Giá trị đơn trung bình', value: formatMoney(summary.orders.averageOrderValue) },
        { label: 'Tổng số đơn', value: String(summary.orders.count) },
        { label: 'Đơn không hủy', value: String(summary.orders.activeCount) },
        { label: 'Đơn chờ xác nhận', value: String(summary.orders.pendingConfirmation) },
        { label: 'Đơn đang giao', value: String(summary.orders.shipping) },
        {
          label: `Dòng tồn kho sắp hết (≤ ${summary.inventory.lowStockThreshold})`,
          value: String(summary.inventory.lowStockLines),
        },
        { label: 'Lô chờ kiểm định', value: String(summary.lots.pendingQc) },
        { label: 'Lô bán được sắp hết hạn (7 ngày)', value: String(summary.lots.sellableExpiring7d) },
        { label: 'Lô bán được đã hết hạn', value: String(summary.lots.sellableExpired) },
        { label: 'Chứng nhận chờ xác minh', value: String(summary.certificates.pending) },
        { label: 'Yêu cầu trả hàng đang mở', value: String(summary.returns.open) },
        { label: 'Khiếu nại đang mở', value: String(summary.complaints.open) },
      ],
      tables: [
        {
          title: 'Đơn hàng theo trạng thái',
          columns: [
            { header: 'Trạng thái', align: 'left' },
            { header: 'Số đơn', align: 'right' },
          ],
          rows: ORDER_STATUS_ORDER.map((status) => ({
            cells: [
              text(labelOf(ORDER_STATUS_LABEL, status)),
              num(summary.orders.byStatus[status] ?? 0),
            ],
          })),
        },
        {
          title: 'Sản phẩm bán chạy',
          columns: [
            { header: 'Sản phẩm', align: 'left' },
            { header: 'SKU', align: 'left' },
            { header: 'SL đã giao', align: 'right' },
            { header: 'Đơn vị', align: 'left' },
            { header: 'Doanh thu', align: 'right' },
          ],
          rows:
            summary.topProducts.length > 0
              ? summary.topProducts.map((p) => ({
                  cells: [
                    text(p.productName),
                    text(p.sku),
                    num(p.quantity),
                    text(p.unit),
                    money(p.revenue),
                  ],
                }))
              : [
                  {
                    cells: [text('Chưa có dữ liệu bán hàng'), text(''), num(0), text(''), money(0)],
                  },
                ],
        },
        {
          title: 'Trả hàng theo trạng thái',
          columns: [
            { header: 'Trạng thái', align: 'left' },
            { header: 'Số yêu cầu', align: 'right' },
          ],
          rows: RETURN_STATUS_ORDER.map((status) => ({
            cells: [
              text(labelOf(RETURN_STATUS_LABEL, status)),
              num(summary.returns.byStatus[status] ?? 0),
            ],
          })),
        },
        {
          title: 'Khiếu nại theo trạng thái',
          columns: [
            { header: 'Trạng thái', align: 'left' },
            { header: 'Số khiếu nại', align: 'right' },
          ],
          rows: COMPLAINT_STATUS_ORDER.map((status) => ({
            cells: [
              text(labelOf(COMPLAINT_STATUS_LABEL, status)),
              num(summary.complaints.byStatus[status] ?? 0),
            ],
          })),
        },
        {
          title: 'Doanh thu và đơn hàng theo ngày (giờ Việt Nam)',
          columns: [
            { header: 'Ngày', align: 'left' },
            { header: 'Số đơn', align: 'right' },
            { header: 'Giá trị đơn', align: 'right' },
            { header: 'Tiền đã thu', align: 'right' },
            { header: 'Hoàn tiền', align: 'right' },
            { header: 'Thực nhận', align: 'right' },
          ],
          rows: daily.points.map((p) => ({
            cells: [
              date(`${p.date}T00:00:00.000Z`),
              num(p.orderCount),
              money(p.orderValue),
              money(p.grossCollected),
              money(p.refundTotal),
              money(p.netCollected),
            ],
          })),
        },
        {
          title: 'Đơn hàng trong kỳ (mỗi đơn một dòng — tổng tiền không nhân theo số đối tác)',
          columns: [
            { header: 'Mã đơn', align: 'left' },
            { header: 'Ngày tạo', align: 'left' },
            { header: 'Trạng thái', align: 'left' },
            { header: 'Thanh toán', align: 'left' },
            { header: 'Tạm tính', align: 'right' },
            { header: 'Giảm giá', align: 'right' },
            { header: 'Phí ship', align: 'right' },
            { header: 'Tổng phải trả', align: 'right' },
            { header: 'Đã thu (trong kỳ)', align: 'right' },
            { header: 'Đã hoàn (trong kỳ)', align: 'right' },
          ],
          rows:
            details.orders.length > 0
              ? details.orders.map((o) => ({
                  cells: [
                    text(o.code),
                    date(o.createdAt),
                    text(
                      o.partnerCount > 1
                        ? `${labelOf(ORDER_STATUS_LABEL, o.status)} (${o.partnerCount} đối tác)`
                        : labelOf(ORDER_STATUS_LABEL, o.status),
                    ),
                    text(
                      o.paymentMethod
                        ? `${labelOf(PAYMENT_METHOD_LABEL, o.paymentMethod)} · ${labelOf(PAYMENT_STATUS_LABEL, o.paymentStatus)}`
                        : '—',
                    ),
                    money(o.subtotal),
                    money(o.discountTotal),
                    money(o.shippingFee),
                    money(o.grandTotal),
                    money(o.collectedInWindow),
                    money(o.refundedInWindow),
                  ],
                }))
              : [{ cells: [text('Không có đơn hàng trong kỳ'), text(''), text(''), text(''), num(0), num(0), num(0), num(0), num(0), num(0)] }],
        },
        {
          title: 'Trả hàng trong kỳ',
          columns: [
            { header: 'Đơn hàng', align: 'left' },
            { header: 'Ngày yêu cầu', align: 'left' },
            { header: 'Số lượng', align: 'right' },
            { header: 'Trạng thái', align: 'left' },
            { header: 'Lý do', align: 'left' },
          ],
          rows:
            details.returns.length > 0
              ? details.returns.map((r) => ({
                  cells: [
                    text(r.orderCode),
                    date(r.createdAt),
                    num(r.quantity),
                    text(labelOf(RETURN_STATUS_LABEL, r.status)),
                    text(r.reason),
                  ],
                }))
              : [{ cells: [text('Không có yêu cầu trả hàng trong kỳ'), text(''), num(0), text(''), text('')] }],
        },
        {
          title: 'Khiếu nại trong kỳ',
          columns: [
            { header: 'Đơn hàng', align: 'left' },
            { header: 'Ngày tạo', align: 'left' },
            { header: 'Loại', align: 'left' },
            { header: 'Trạng thái', align: 'left' },
          ],
          rows:
            details.complaints.length > 0
              ? details.complaints.map((c) => ({
                  cells: [
                    text(c.orderCode),
                    date(c.createdAt),
                    text(labelOf(COMPLAINT_TYPE_LABEL, c.type)),
                    text(labelOf(COMPLAINT_STATUS_LABEL, c.status)),
                  ],
                }))
              : [{ cells: [text('Không có khiếu nại trong kỳ'), text(''), text(''), text('')] }],
        },
      ],
      generatedAt: new Date(),
      footer: 'AgriMarket V2 · Báo cáo tổng hợp',
    };
  }

  async export(
    format: ExportFormat,
    from?: Date,
    to?: Date,
    days?: number,
  ): Promise<ExportedFile> {
    const doc = await this.buildSummaryDocument(from, to, days);
    // File name carries the report period (Vietnam days), e.g.
    // AgriMarket_BaoCao_2026-10-04_2026-10-10.xlsx.
    const periodTag = periodTagOf(doc);
    return buildExportFile(format, doc, `AgriMarket_BaoCao_${periodTag}`);
  }
}

/** `YYYY-MM-DD_YYYY-MM-DD` from the "Khoảng thời gian" meta (dd/MM/yyyy). */
function periodTagOf(doc: ReportDocument): string {
  const raw = doc.meta?.find((m) => m.label === 'Khoảng thời gian')?.value ?? '';
  const parts = raw.split('–').map((s) => s.trim());
  const toKey = (vn: string): string => {
    const m = vn.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : 'nodate';
  };
  return parts.length === 2 ? `${toKey(parts[0])}_${toKey(parts[1])}` : 'nodate';
}
