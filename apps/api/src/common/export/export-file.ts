import type { ReportDocument } from './report-document.js';
import { buildReportWorkbook } from './excel.builder.js';
import { buildReportPdf } from './pdf.builder.js';

/**
 * The two real file formats the reports endpoints can produce.
 *
 * `xlsx` is an Office Open XML workbook (ExcelJS), `pdf` is a PDF (PDFKit with
 * an embedded Unicode font). Neither is JSON or HTML renamed — a caller can
 * open the bytes directly in Excel / a PDF reader.
 */
export type ExportFormat = 'xlsx' | 'pdf';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['xlsx', 'pdf'];

export interface ExportedFile {
  buffer: Buffer;
  contentType: string;
  /** ASCII-safe download name; callers append the extension themselves. */
  filename: string;
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Strip anything that is unsafe in a `Content-Disposition` filename. */
function sanitizeFilename(baseName: string): string {
  const cleaned = baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // drop diacritics
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'export';
}

/**
 * Renders a `ReportDocument` into the requested real file format.
 *
 * This is the single choke point where the neutral document becomes bytes, so
 * both the reports and the settlement endpoints produce byte-identical output
 * for the same document.
 */
export async function buildExportFile(
  format: ExportFormat,
  doc: ReportDocument,
  baseName: string,
): Promise<ExportedFile> {
  const buffer = format === 'xlsx' ? await buildReportWorkbook(doc) : await buildReportPdf(doc);
  return {
    buffer,
    contentType: CONTENT_TYPE[format],
    filename: `${sanitizeFilename(baseName)}.${format}`,
  };
}
