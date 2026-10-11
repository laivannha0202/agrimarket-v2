import ExcelJS from 'exceljs';
import type { ReportDocument, ReportCell } from './report-document.js';
import { formatDateTimeVn } from './format.js';

/**
 * Build a real `.xlsx` workbook (Office Open XML, via ExcelJS) from a
 * `ReportDocument`.
 *
 * Numeric cells are written as *numbers* with an explicit number format, so a
 * spreadsheet consumer can sum/filter them — the file is a genuine workbook,
 * not JSON or HTML renamed to `.xlsx`.
 */

const MONEY_FORMAT = '#,##0" ₫"';
const NUMBER_FORMAT = '#,##0.###';
const DATE_FORMAT = 'dd/mm/yyyy';
const PERCENT_FORMAT = '0.0%';

const HEADER_FILL = 'FFE8F2E9';
const TITLE_COLOR = 'FF1F5C33';

function cellToExcel(cell: ReportCell): { value: ExcelJS.CellValue; numFmt?: string } {
  if (cell.value === null || cell.value === '') {
    return { value: null };
  }
  switch (cell.kind) {
    case 'money': {
      const n = Number(cell.value);
      if (!Number.isFinite(n)) return { value: String(cell.value) };
      return { value: Math.round(n), numFmt: MONEY_FORMAT };
    }
    case 'number': {
      const n = Number(cell.value);
      if (!Number.isFinite(n)) return { value: String(cell.value) };
      return { value: n, numFmt: NUMBER_FORMAT };
    }
    case 'date': {
      const d = cell.value instanceof Date ? cell.value : new Date(String(cell.value));
      if (Number.isNaN(d.getTime())) return { value: String(cell.value) };
      return { value: d, numFmt: DATE_FORMAT };
    }
    case 'percent': {
      // The model stores a percentage (12.5 means 12,5%); Excel wants a fraction.
      const n = Number(cell.value);
      if (!Number.isFinite(n)) return { value: String(cell.value) };
      return { value: n / 100, numFmt: PERCENT_FORMAT };
    }
    default:
      return { value: String(cell.value) };
  }
}

export async function buildReportWorkbook(doc: ReportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AgriMarket V2';
  wb.created = doc.generatedAt;

  const ws = wb.addWorksheet('Báo cáo', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });

  // Determine the widest table so the sheet has a stable column count.
  const columnCount = Math.max(1, ...doc.tables.map((t) => t.columns.length));
  ws.columns = Array.from({ length: columnCount }, () => ({ width: 22 }));

  let row = 1;

  // Title + subtitle + meta.
  const titleCell = ws.getCell(row, 1);
  titleCell.value = doc.title;
  titleCell.font = { bold: true, size: 15, color: { argb: TITLE_COLOR } };
  ws.mergeCells(row, 1, row, columnCount);
  row += 1;

  if (doc.subtitle) {
    const c = ws.getCell(row, 1);
    c.value = doc.subtitle;
    c.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
    ws.mergeCells(row, 1, row, columnCount);
    row += 1;
  }
  if (doc.meta && doc.meta.length > 0) {
    for (const m of doc.meta) {
      ws.getCell(row, 1).value = `${m.label}:`;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = m.value;
      if (columnCount > 2) ws.mergeCells(row, 2, row, columnCount);
      row += 1;
    }
  }

  row += 1;

  // KPI band: label/value pairs, two per line.
  if (doc.kpis && doc.kpis.length > 0) {
    for (let i = 0; i < doc.kpis.length; i += 2) {
      const left = doc.kpis[i];
      ws.getCell(row, 1).value = left.label;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = left.value;
      if (doc.kpis[i + 1]) {
        const rightCol = 4;
        ws.getCell(row, rightCol).value = doc.kpis[i + 1].label;
        ws.getCell(row, rightCol).font = { bold: true };
        ws.getCell(row, rightCol + 1).value = doc.kpis[i + 1].value;
      }
      row += 1;
    }
    row += 1;
  }

  // Tables.
  for (const table of doc.tables) {
    if (table.title) {
      const c = ws.getCell(row, 1);
      c.value = table.title;
      c.font = { bold: true, size: 12 };
      row += 1;
    }

    table.columns.forEach((col, idx) => {
      const c = ws.getCell(row, idx + 1);
      c.value = col.header;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      c.alignment = { horizontal: col.align ?? 'left', vertical: 'middle', wrapText: true };
      c.border = {
        top: { style: 'thin', color: { argb: 'FFBBBBBB' } },
        bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } },
        left: { style: 'thin', color: { argb: 'FFBBBBBB' } },
        right: { style: 'thin', color: { argb: 'FFBBBBBB' } },
      };
    });
    row += 1;

    if (table.rows.length === 0) {
      const c = ws.getCell(row, 1);
      c.value = 'Không có dữ liệu';
      c.font = { italic: true, color: { argb: 'FF888888' } };
      row += 2;
      continue;
    }

    for (const r of table.rows) {
      r.cells.forEach((cell, idx) => {
        const col = table.columns[idx];
        const { value, numFmt } = cellToExcel(cell);
        const c = ws.getCell(row, idx + 1);
        c.value = value;
        if (numFmt) c.numFmt = numFmt;
        c.alignment = { horizontal: col?.align ?? 'left', vertical: 'middle', wrapText: false };
      });
      row += 1;
    }
    row += 1;
  }

  // Footer: generation stamp.
  const footer = ws.getCell(row, 1);
  footer.value = `${doc.footer ?? 'AgriMarket V2'} · Xuất lúc ${formatDateTimeVn(doc.generatedAt)}`;
  footer.font = { italic: true, size: 9, color: { argb: 'FF888888' } };
  ws.mergeCells(row, 1, row, columnCount);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
