import { buildReportWorkbook } from '../src/common/export/excel.builder.js';
import { buildReportPdf } from '../src/common/export/pdf.builder.js';
import { date, money, num, text } from '../src/common/export/report-document.js';

const doc = {
  title: 'Báo cáo tổng hợp',
  subtitle: 'Kỳ báo cáo: 01/10/2026 – 31/10/2026',
  meta: [{ label: 'Đơn vị tiền tệ', value: 'Việt Nam Đồng (VND)' }],
  kpis: [
    { label: 'Tổng giá trị đơn hàng', value: '136.000 ₫' },
    { label: 'Doanh thu thực nhận', value: '98.500 ₫' },
  ],
  tables: [
    {
      title: 'Sản phẩm bán chạy',
      columns: [
        { header: 'Sản phẩm', align: 'left' as const },
        { header: 'Số lượng', align: 'right' as const },
        { header: 'Doanh thu', align: 'right' as const },
        { header: 'Ngày', align: 'left' as const },
      ],
      rows: [
        { cells: [text('Cải bó xôi Đà Lạt'), num(12.5), money(136000), date('2026-10-07T00:00:00.000Z')] },
        { cells: [text('Cam sành Hà Giang'), num(3), money(-2500), date('2026-10-08T00:00:00.000Z')] },
      ],
    },
    {
      title: 'Bảng rỗng',
      columns: [{ header: 'A', align: 'left' as const }, { header: 'B', align: 'right' as const }],
      rows: [],
    },
  ],
  generatedAt: new Date('2026-10-08T09:30:00.000Z'),
  footer: 'AgriMarket V2 · Test',
};

const xlsx = await buildReportWorkbook(doc);
const pdf = await buildReportPdf(doc);

// Magic bytes: xlsx is a ZIP (PK\x03\x04), PDF starts with %PDF-
const xlsxMagic = xlsx.subarray(0, 4).toString('latin1');
const pdfMagic = pdf.subarray(0, 5).toString('latin1');
console.log('xlsx bytes:', xlsx.length, 'magic:', JSON.stringify(xlsxMagic));
console.log('pdf  bytes:', pdf.length, 'magic:', JSON.stringify(pdfMagic));
console.log('xlsx is zip:', xlsxMagic === 'PK\x03\x04');
console.log('pdf is pdf:', pdfMagic === '%PDF-');
