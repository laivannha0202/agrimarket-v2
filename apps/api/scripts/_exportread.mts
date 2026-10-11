import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { buildReportWorkbook } from '../src/common/export/excel.builder.js';
import { date, money, num, text } from '../src/common/export/report-document.js';

const doc = {
  title: 'Báo cáo tổng hợp',
  subtitle: 'Kỳ báo cáo: 01/10/2026 – 31/10/2026',
  kpis: [{ label: 'Doanh thu', value: '98.500 ₫' }],
  tables: [
    {
      title: 'Sản phẩm bán chạy',
      columns: [
        { header: 'Sản phẩm', align: 'left' as const },
        { header: 'Số lượng', align: 'right' as const },
        { header: 'Doanh thu', align: 'right' as const },
      ],
      rows: [{ cells: [text('Cải bó xôi Đà Lạt'), num(12.5), money(136000)] }],
    },
  ],
  generatedAt: new Date('2026-10-08T09:30:00.000Z'),
};

const buf = await buildReportWorkbook(doc);
const wb = new ExcelJS.Workbook();
await wb.xlsx.read(Readable.from(Buffer.from(buf)));
const ws = wb.getWorksheet('Báo cáo')!;
console.log('sheet name:', ws.name);
console.log('rowCount:', ws.rowCount);
ws.eachRow({ includeEmpty: false }, (row, n) => {
  const vals = (row.values as unknown[]).slice(1).map((v) => {
    const c = row.getCell(1);
    void c;
    return typeof v === 'object' && v !== null && 'result' in (v as object) ? JSON.stringify(v) : String(v);
  });
  console.log(`r${n}:`, vals.join(' | '));
});
// Confirm the money cell is a NUMBER with a currency number format.
const moneyCell = ws.getCell(8, 3);
console.log('money cell value:', moneyCell.value, 'numFmt:', moneyCell.numFmt, 'type:', typeof moneyCell.value);
const numCell = ws.getCell(8, 2);
console.log('num cell value:', numCell.value, 'numFmt:', numCell.numFmt, 'type:', typeof numCell.value);
