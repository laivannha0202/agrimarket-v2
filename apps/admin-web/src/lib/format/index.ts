/**
 * Display formatters for the Admin console.
 *
 * Money, dates, datetimes and quantities come from
 * `@agrimarket/shared-domain/format`, the same module Customer Web and Mobile
 * render with — so an amount or a date cannot be formatted three different ways
 * in three apps. Only helpers that are genuinely admin-only live here.
 *
 * Vietnamese conventions (unchanged):
 *   - date:     07/10/2026
 *   - datetime: 07/10/2026 14:35
 *   - money:    136.000 ₫
 *   - quantity: 2,5 kg  (comma decimal separator, dot thousands)
 */

import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatQuantity,
} from "@agrimarket/shared-domain/format";

export { formatDate, formatDateTime, formatMoney, formatNumber, formatQuantity };

const EMPTY = "—";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Local-time value for `<input type="datetime-local">` (YYYY-MM-DDTHH:mm).
 * Using the UTC ISO string here would silently shift the author's wall clock by
 * the browser offset, so a log entered "07:30" would be stored as 00:30 UTC.
 */
export function toDateTimeLocal(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Percentage, e.g. 5% or 7,5%. */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  return `${formatNumber(n)}%`;
}

/** Compute a discounted unit price for display only (frontend preview). */
export function applyDiscount(
  basePrice: string | number,
  type: "PERCENT" | "FIXED",
  value: string | number,
): number {
  const base = Number(basePrice);
  const v = Number(value);
  if (!Number.isFinite(base) || !Number.isFinite(v)) return NaN;
  if (type === "PERCENT") return Math.max(0, base * (1 - v / 100));
  return Math.max(0, base - v);
}

export { EMPTY as EMPTY_VALUE };
