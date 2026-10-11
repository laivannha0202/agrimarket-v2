/**
 * A neutral, renderer-agnostic report document.
 *
 * The business layer describes *what* a report contains (title, meta, KPIs and
 * tables); the Excel and PDF builders decide *how* to draw it. Keeping the
 * model free of renderer details is what lets the same report be exported to
 * both formats without a second code path that could drift from the first.
 */

export type CellKind = 'text' | 'number' | 'money' | 'percent' | 'date';

/** One cell. `kind` drives number formatting; default is `text`. */
export interface ReportCell {
  value: string | number | Date | null;
  kind?: CellKind;
}

export interface ReportColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
}

export interface ReportRow {
  cells: ReportCell[];
}

export interface ReportTable {
  /** Optional heading printed above the table. */
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportKpi {
  label: string;
  value: string;
}

export interface ReportMetaItem {
  label: string;
  value: string;
}

export interface ReportDocument {
  title: string;
  subtitle?: string;
  /** Period / partner / code context lines. */
  meta?: ReportMetaItem[];
  /** Highlight figures printed as a band above the tables. */
  kpis?: ReportKpi[];
  tables: ReportTable[];
  generatedAt: Date;
  footer?: string;
}

/** Shorthand for a plain text cell. */
export function text(value: string | number | null | undefined): ReportCell {
  return { value: value === null || value === undefined ? '' : value, kind: 'text' };
}

/** Shorthand for a money cell (rendered with the VND unit). */
export function money(value: string | number | null | undefined): ReportCell {
  return { value: value === null || value === undefined ? 0 : value, kind: 'money' };
}

/** Shorthand for a numeric cell (quantity / count). */
export function num(value: string | number | null | undefined): ReportCell {
  return { value: value === null || value === undefined ? 0 : value, kind: 'number' };
}

/** Shorthand for a date cell. */
export function date(value: string | Date | null | undefined): ReportCell {
  return { value: value === null || value === undefined ? null : value, kind: 'date' };
}
