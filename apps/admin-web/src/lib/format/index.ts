/**
 * Shared display formatters.
 *
 * Vietnamese conventions:
 *   - date:     07/10/2026
 *   - datetime: 07/10/2026 14:35
 *   - money:    136.000 ₫
 *   - quantity: 2,5 kg  (comma decimal separator, dot thousands)
 */

const EMPTY = "—";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format a numeric/string amount as Vietnamese đồng, e.g. 136.000 ₫. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped} ₫`;
}

/**
 * Format a quantity using the given unit. Trailing zeros are trimmed and the
 * decimal separator is a comma (Vietnamese style): 2,5 kg / 25 gói.
 */
export function formatQuantity(
  value: string | number | null | undefined,
  unit?: string | null,
): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  const trimmed = trimNumber(n);
  return unit ? `${trimmed} ${unit}` : trimmed;
}

/** Format a plain number (no unit) with Vietnamese separators. */
export function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  return trimNumber(n);
}

function trimNumber(n: number): string {
  const fixed = n.toFixed(3).replace(/\.?0+$/, "");
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart ? `${grouped},${decPart}` : grouped;
}

/** Percentage, e.g. 5% or 7,5%. */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  return `${trimNumber(n)}%`;
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
