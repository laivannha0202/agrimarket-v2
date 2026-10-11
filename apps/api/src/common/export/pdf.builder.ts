import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { ReportDocument, ReportCell } from './report-document.js';
import { formatDateTimeVn } from './format.js';
import { renderCellTextValue } from './cell-text.js';

/**
 * Build a real PDF (via PDFKit) from a `ReportDocument`.
 *
 * A Unicode TrueType font is embedded so Vietnamese diacritics render correctly
 * — the built-in PDF base-14 fonts are Latin-1 only and would mangle "Đồng".
 * The font ships with the `dejavu-fonts-ttf` dependency, so the export does not
 * depend on a font being installed on the host.
 */

const require = createRequire(import.meta.url);

function fontPath(file: string): string {
  const pkgJson = require.resolve('dejavu-fonts-ttf/package.json');
  return join(dirname(pkgJson), 'ttf', file);
}

const PAGE_MARGIN = 40;
const FONT_REGULAR = 'DejaVuSans';
const FONT_BOLD = 'DejaVuSans-Bold';
const HEADER_BG = '#e8f2e9';
const HEADER_TEXT = '#1f5c33';
const LINE_COLOR = '#cccccc';
const MUTED = '#777777';

// A4 portrait fits ~6 columns. Wider tables (the per-order detail has 10)
// switch the whole document to landscape so codes and dates never wrap
// mid-value — a wrapped order code is unreadable and unsearchable.
const PORTRAIT_WIDTH = 595.28;
const PORTRAIT_HEIGHT = 841.89;

/** Column widths (fractions summing to 1) from the header/align hint. */
function columnFractions(count: number, aligns: Array<'left' | 'right' | 'center' | undefined>): number[] {
  // Right-aligned (numeric) columns get a tighter width; the first text column
  // takes the slack. A flat split is the fallback.
  if (count === 1) return [1];
  const weights = aligns.map((a) => (a === 'right' ? 0.8 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => w / total);
}

function drawText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: { align?: 'left' | 'right' | 'center'; bold?: boolean; color?: string; size?: number },
): void {
  doc
    .font(opts.bold ? FONT_BOLD : FONT_REGULAR)
    .fontSize(opts.size ?? 9)
    .fillColor(opts.color ?? '#222222')
    .text(text, x, y, { width, align: opts.align ?? 'left', lineBreak: false, ellipsis: true });
}

/** Measure the wrapped height of a text cell in the given width. */
function measure(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  size = 9,
  bold = false,
): number {
  doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(size);
  return doc.heightOfString(text, { width });
}

export async function buildReportPdf(doc: ReportDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const maxColumns = Math.max(1, ...doc.tables.map((t) => t.columns.length));
      const landscape = maxColumns > 6;
      const PAGE_WIDTH = landscape ? PORTRAIT_HEIGHT : PORTRAIT_WIDTH;
      const PAGE_HEIGHT = landscape ? PORTRAIT_WIDTH : PORTRAIT_HEIGHT;
      const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
      const pdf = new PDFDocument({
        size: 'A4',
        layout: landscape ? 'landscape' : 'portrait',
        margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
        bufferPages: true,
        info: { Title: doc.title, Author: 'AgriMarket V2', Creator: 'AgriMarket V2' },
      });

      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      pdf.registerFont(FONT_REGULAR, fontPath('DejaVuSans.ttf'));
      pdf.registerFont(FONT_BOLD, fontPath('DejaVuSans-Bold.ttf'));

      let y = PAGE_MARGIN;

      const ensureSpace = (needed: number): void => {
        if (y + needed > PAGE_HEIGHT - PAGE_MARGIN) {
          pdf.addPage();
          y = PAGE_MARGIN;
        }
      };

      // ---- Title + subtitle -------------------------------------------------
      pdf.font(FONT_BOLD).fontSize(16).fillColor(HEADER_TEXT);
      pdf.text(doc.title, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
      y = pdf.y + 4;

      if (doc.subtitle) {
        pdf.font(FONT_REGULAR).fontSize(10).fillColor('#555555');
        pdf.text(doc.subtitle, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
        y = pdf.y + 2;
      }

      if (doc.meta && doc.meta.length > 0) {
        pdf.font(FONT_REGULAR).fontSize(9).fillColor('#333333');
        for (const m of doc.meta) {
          pdf.font(FONT_BOLD).text(`${m.label}: `, PAGE_MARGIN, y, { continued: true, width: CONTENT_WIDTH });
          pdf.font(FONT_REGULAR).text(m.value);
          y = pdf.y + 1;
        }
      }

      y += 6;
      pdf.moveTo(PAGE_MARGIN, y).lineTo(PAGE_WIDTH - PAGE_MARGIN, y).strokeColor(LINE_COLOR).stroke();
      y += 8;

      // ---- KPI band ---------------------------------------------------------
      if (doc.kpis && doc.kpis.length > 0) {
        const perRow = 2;
        const colWidth = CONTENT_WIDTH / perRow;
        for (let i = 0; i < doc.kpis.length; i += perRow) {
          ensureSpace(30);
          const rowKpis = doc.kpis.slice(i, i + perRow);
          rowKpis.forEach((k, idx) => {
            const x = PAGE_MARGIN + idx * colWidth;
            drawText(pdf, k.label, x, y, colWidth - 8, { size: 8.5, color: MUTED });
            drawText(pdf, k.value, x, y + 11, colWidth - 8, { size: 12, bold: true, color: '#111111' });
          });
          y += 30;
        }
        y += 4;
      }

      // ---- Tables -----------------------------------------------------------
      for (const table of doc.tables) {
        if (table.title) {
          ensureSpace(22);
          pdf.font(FONT_BOLD).fontSize(11).fillColor('#111111');
          pdf.text(table.title, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
          y = pdf.y + 4;
        }

        const colCount = table.columns.length;
        const fractions = columnFractions(
          colCount,
          table.columns.map((c) => c.align),
        );
        const widths = fractions.map((f) => f * CONTENT_WIDTH);
        // Wide tables: spaceless codes (order/settlement IDs) must never wrap
        // mid-value, so the first column gets a 100pt floor and the rest
        // shrink proportionally; body text drops to 8pt to match.
        const wide = colCount > 6;
        const bodySize = wide ? 8 : 9;
        if (wide && widths[0] < 100) {
          const deficit = 100 - widths[0];
          widths[0] = 100;
          const rest = widths.slice(1).reduce((s, w) => s + w, 0);
          for (let i = 1; i < widths.length; i += 1) {
            widths[i] -= (widths[i] / rest) * deficit;
          }
        }
        const xs: number[] = [];
        let acc = PAGE_MARGIN;
        for (const w of widths) {
          xs.push(acc);
          acc += w;
        }

        const drawHeader = (): void => {
          const headerHeight = 20;
          ensureSpace(headerHeight + 14);
          pdf.rect(PAGE_MARGIN, y, CONTENT_WIDTH, headerHeight).fill(HEADER_BG);
          table.columns.forEach((col, idx) => {
            drawText(pdf, col.header, xs[idx] + 4, y + 6, widths[idx] - 8, {
              align: col.align,
              bold: true,
              color: HEADER_TEXT,
              size: 9,
            });
          });
          y += headerHeight;
        };

        drawHeader();

        if (table.rows.length === 0) {
          ensureSpace(18);
          drawText(pdf, 'Không có dữ liệu', PAGE_MARGIN + 4, y + 4, CONTENT_WIDTH - 8, {
            color: MUTED,
            size: 9,
          });
          y += 20;
        } else {
          for (const r of table.rows) {
            const texts = r.cells.map((cell: ReportCell) => renderCellTextValue(cell));
            const rowHeight =
              Math.max(
                ...texts.map((t, idx) => measure(pdf, t, widths[idx] - 8, bodySize)),
                12,
              ) + 6;

            if (y + rowHeight > PAGE_HEIGHT - PAGE_MARGIN) {
              pdf.addPage();
              y = PAGE_MARGIN;
              drawHeader();
            }

            texts.forEach((t, idx) => {
              drawText(pdf, t, xs[idx] + 4, y + 3, widths[idx] - 8, {
                align: table.columns[idx]?.align,
                size: bodySize,
              });
            });
            y += rowHeight;
            pdf
              .moveTo(PAGE_MARGIN, y)
              .lineTo(PAGE_WIDTH - PAGE_MARGIN, y)
              .strokeColor('#eeeeee')
              .stroke();
          }
        }
        y += 12;
      }

      // ---- Footer on every page --------------------------------------------
      const range = pdf.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        pdf.switchToPage(i);
        const footerText = `${doc.footer ?? 'AgriMarket V2'} · Xuất lúc ${formatDateTimeVn(doc.generatedAt)}`;
        pdf.font(FONT_REGULAR).fontSize(8).fillColor(MUTED);
        pdf.text(footerText, PAGE_MARGIN, PAGE_HEIGHT - PAGE_MARGIN + 10, {
          width: CONTENT_WIDTH - 60,
          lineBreak: false,
        });
        pdf.text(`Trang ${i - range.start + 1}/${range.count}`, PAGE_MARGIN, PAGE_HEIGHT - PAGE_MARGIN + 10, {
          width: CONTENT_WIDTH,
          align: 'right',
          lineBreak: false,
        });
      }

      pdf.end();
    } catch (error) {
      reject(error as Error);
    }
  });
}
