/**
 * Renderer-agnostic formatting helpers shared by the Excel and PDF exporters.
 *
 * These mirror the admin UI's `lib/format` conventions so a number reads the
 * same on screen and in the exported file:
 *   - money:    136.000 ₫   (dot thousands, no decimals)
 *   - quantity: 2,5         (comma decimal, dot thousands, trimmed)
 *   - date:     07/10/2026
 *   - datetime: 07/10/2026 14:35
 *
 * All dates are rendered in Vietnam local time (UTC+7) so an export taken at
 * 23:00 VN never shows the previous UTC day.
 */

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Vietnam-local parts of a UTC instant. */
function vnParts(d: Date): {
  day: string;
  month: string;
  year: number;
  hours: number;
  minutes: number;
} {
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return {
    day: pad(shifted.getUTCDate()),
    month: pad(shifted.getUTCMonth() + 1),
    year: shifted.getUTCFullYear(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

export function formatDateVn(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = vnParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

export function formatDateTimeVn(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = vnParts(d);
  return `${p.day}/${p.month}/${p.year} ${pad(p.hours)}:${pad(p.minutes)}`;
}

/** Group a number with dot thousands separators (Vietnamese style). */
export function groupThousands(n: number): string {
  const sign = n < 0 ? '-' : '';
  const grouped = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}`;
}

/** Trim trailing zeros, keep up to 3 decimals, comma decimal separator. */
export function trimNumberVn(n: number): string {
  const fixed = n.toFixed(3).replace(/\.?0+$/, '');
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decPart ? `${grouped},${decPart}` : grouped;
}

/** Money as a bare grouped string (no currency unit), e.g. `-1.250.000`. */
export function formatMoneyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  return groupThousands(Math.round(n));
}

/** Money with the đồng unit, e.g. `136.000 ₫`. */
export function formatMoney(value: string | number | null | undefined): string {
  return `${formatMoneyValue(value)} ₫`;
}

/** A quantity/plain number, Vietnamese separators, no unit. */
export function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  return trimNumberVn(n);
}
