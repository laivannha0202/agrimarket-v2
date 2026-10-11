import { Injectable } from '@nestjs/common';
import {
  buildExportFile,
  type ExportFormat,
  type ExportedFile,
} from '../common/export/export-file.js';
import { date, money, num, text, type ReportDocument } from '../common/export/report-document.js';
import { formatDateVn } from '../common/export/format.js';
import {
  labelOf,
  PAYOUT_STATUS_LABEL,
  SETTLEMENT_STATUS_LABEL,
} from '../common/export/labels.js';
import { SettlementsService } from './settlements.service.js';

/**
 * A Prisma `Decimal` field rendered as a plain string. The report model takes
 * `string | number`, and a Decimal's `toString()` is the exact stored value, so
 * no precision is lost the way `Number()` could for very large amounts.
 */
function dec(value: { toString(): string } | string | number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : value.toString();
}

/**
 * Builds the "bảng đối soát" (reconciliation statement) export for one
 * settlement.
 *
 * Every figure is read straight from the stored settlement and its lines /
 * payouts — the same rows the detail screen renders — so the downloaded file
 * is a faithful copy of the statement, not a recomputation that could drift.
 */
@Injectable()
export class SettlementExportService {
  constructor(private readonly settlements: SettlementsService) {}

  async buildDocument(id: number): Promise<ReportDocument> {
    const s = await this.settlements.findOne(id);
    const period = `${formatDateVn(s.periodStart)} – ${formatDateVn(s.periodEnd)}`;

    const payable = Number(s.payableAmount);
    const paid = (s.payouts ?? [])
      .filter((p) => p.status === 'PAID')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const outstanding = payable - paid;

    return {
      title: `Bảng đối soát ${s.code}`,
      subtitle: `Đối tác: ${s.partner?.name ?? '—'} · Kỳ: ${period}`,
      meta: [
        { label: 'Mã đối soát', value: s.code },
        { label: 'Đối tác', value: s.partner?.name ?? '—' },
        { label: 'Kỳ đối soát', value: period },
        { label: 'Trạng thái', value: labelOf(SETTLEMENT_STATUS_LABEL, s.status) },
        {
          label: 'Xác nhận lúc',
          value: s.confirmedAt ? formatDateVn(s.confirmedAt) : '—',
        },
      ],
      kpis: [
        { label: 'Doanh thu', value: `${groupVnd(dec(s.grossAmount))} ₫` },
        { label: 'Hoàn tiền', value: `${groupVnd(dec(s.refundAmount))} ₫` },
        { label: 'Hoa hồng', value: `${groupVnd(dec(s.commissionAmount))} ₫` },
        { label: 'Điều chỉnh', value: `${groupVnd(dec(s.adjustmentAmount))} ₫` },
        { label: 'Phải trả đối tác', value: `${groupVnd(dec(s.payableAmount))} ₫` },
        { label: 'Đã chi trả', value: `${groupVnd(paid)} ₫` },
        { label: 'Còn phải trả', value: `${groupVnd(outstanding)} ₫` },
      ],
      tables: [
        {
          title: 'Chi tiết theo đơn đối tác',
          columns: [
            { header: 'Đơn đối tác', align: 'left' },
            { header: 'Doanh thu', align: 'right' },
            { header: 'Hoàn tiền', align: 'right' },
            { header: 'Hoa hồng', align: 'right' },
            { header: 'Phải trả', align: 'right' },
          ],
          rows:
            (s.lines ?? []).length > 0
              ? (s.lines ?? []).map((line) => ({
                  cells: [
                    text(line.partnerOrder?.code ?? `#${line.partnerOrderId}`),
                    money(dec(line.grossAmount)),
                    money(dec(line.refundAmount)),
                    money(dec(line.commissionAmount)),
                    money(dec(line.payableAmount)),
                  ],
                }))
              : [{ cells: [text('Không có dòng đối soát'), money(0), money(0), money(0), money(0)] }],
        },
        {
          title: 'Lệnh chi trả',
          columns: [
            { header: 'Lệnh chi trả', align: 'left' },
            { header: 'Số tiền', align: 'right' },
            { header: 'Trạng thái', align: 'left' },
            { header: 'Chi trả lúc', align: 'left' },
          ],
          rows:
            (s.payouts ?? []).length > 0
              ? (s.payouts ?? []).map((p) => ({
                  cells: [
                    text(p.code),
                    money(dec(p.amount)),
                    text(labelOf(PAYOUT_STATUS_LABEL, p.status)),
                    p.paidAt ? date(p.paidAt) : text('—'),
                  ],
                }))
              : [
                  {
                    cells: [
                      text('Chưa có lệnh chi trả'),
                      num(0),
                      text('—'),
                      text('—'),
                    ],
                  },
                ],
        },
      ],
      generatedAt: new Date(),
      footer: 'AgriMarket V2 · Bảng đối soát',
    };
  }

  async export(id: number, format: ExportFormat): Promise<ExportedFile> {
    const doc = await this.buildDocument(id);
    return buildExportFile(format, doc, `bang-doi-soat-${doc.title.replace(/[^0-9A-Za-z-]+/g, '-')}`);
  }
}

/** Grouped integer VND string (no symbol) for the KPI band. */
function groupVnd(value: string | number): string {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  return `${sign}${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
