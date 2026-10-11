import type { ReportCell } from './report-document.js';
import { formatDateVn, formatMoneyValue, formatNumber } from './format.js';

/**
 * Render a report cell as the text a human would read. Shared by the PDF
 * builder (which prints text) and available to tests; the Excel builder keeps
 * numbers as numbers and only uses this for non-numeric kinds.
 */
export function renderCellTextValue(cell: ReportCell): string {
  if (cell.value === null || cell.value === undefined || cell.value === '') return '';
  switch (cell.kind) {
    case 'money':
      return `${formatMoneyValue(cell.value as string | number)} ₫`;
    case 'number':
      return formatNumber(cell.value as string | number);
    case 'date':
      return formatDateVn(cell.value as string | Date);
    default:
      return String(cell.value);
  }
}
