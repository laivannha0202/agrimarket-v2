/**
 * Display formatting.
 *
 * Money is rendered as `136.000 ₫`, dates as `07/10/2026` and datetimes as
 * `07/10/2026 14:35`. Raw ISO strings and raw Decimal strings never reach the
 * UI.
 */

const VND = "₫";

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `136000` -> `"136.000 ₫"` */
export function formatMoney(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const rounded = Math.round(n);
  return `${rounded.toLocaleString("vi-VN").replace(/\./g, ".")} ${VND}`;
}

/** Compact money for tight badges: `136000` -> `"136.000₫"` */
export function formatMoneyCompact(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${Math.round(n).toLocaleString("vi-VN").replace(/\./g, ".")}${VND}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `2026-10-07T14:35:00.000Z` -> `"07/10/2026"` */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `2026-10-07T14:35:00.000Z` -> `"07/10/2026 14:35"` */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `"500"` + `"g"` -> `"500 g"`, `"2.5"` + `"kg"` -> `"2,5 kg"` */
export function formatWeight(
  weight: string | number | null | undefined,
  unit: string | null | undefined,
): string {
  const n = toNumber(weight);
  if (n === null || !unit) return "";
  const text = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  return `${text} ${unit}`;
}

/**
 * Quantities come back as Decimal strings such as `"5.000"` or `"0.500"`.
 * Trailing zeros are dropped: `"5.000"` -> `"5"`, `"0.500"` -> `"0,5"`.
 */
export function formatQuantity(
  value: string | number | null | undefined,
  unit?: string | null,
): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const text = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  return unit ? `${text} ${unit}` : text;
}

/** `"HTX Rau quả Minh Châu"` -> `"Minh Châu"` (short label for cards). */
export function shortPartnerName(name: string): string {
  const cleaned = name
    .replace(/^HTX\s+(Nông nghiệp\s+)?/i, "")
    .replace(/^Hợp tác xã\s+(Nông nghiệp\s+)?/i, "")
    .replace(/^Công ty\s+(TNHH\s+|Cổ phần\s+)?/i, "")
    .replace(/^Nông sản\s+/i, "")
    .trim();
  return cleaned || name;
}

/** Product code shown to customers: `ORD-20261006-0006` -> `ORD-…0006`. */
export function formatOrderCode(code: string): string {
  return code;
}

/** Percentage saved between two prices, e.g. `-17%`. `null` when not on sale. */
export function discountPercent(
  original: string | number | null | undefined,
  current: string | number | null | undefined,
): number | null {
  const o = toNumber(original);
  const c = toNumber(current);
  if (o === null || c === null || o <= 0 || c >= o) return null;
  return Math.round(((o - c) / o) * 100);
}

/** Whole minutes left until `endsAt`, or `null` when already past. */
export function minutesUntil(endsAt: string | null | undefined, now = Date.now()): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end) || end <= now) return null;
  return Math.floor((end - now) / 60_000);
}

/** Remaining time as `"2 ngày 04:15"`, `"04:15:30"` style compact text. */
export function formatRemaining(endsAt: string | null | undefined, now = Date.now()): string | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return null;
  let diff = end - now;
  if (diff <= 0) return null;

  const days = Math.floor(diff / 86_400_000);
  diff -= days * 86_400_000;
  const hours = Math.floor(diff / 3_600_000);
  diff -= hours * 3_600_000;
  const minutes = Math.floor(diff / 60_000);
  diff -= minutes * 60_000;
  const seconds = Math.floor(diff / 1000);

  if (days > 0) return `${days} ngày ${pad(hours)}:${pad(minutes)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
