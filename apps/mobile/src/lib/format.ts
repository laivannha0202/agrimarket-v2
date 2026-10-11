/**
 * Display formatting. Port of `apps/customer-web/src/lib/format.ts`.
 * Money `136000` -> `"136.000 ₫"`, dates `dd/mm/yyyy`.
 */

const VND = "₫";

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${Math.round(n).toLocaleString("vi-VN")} ${VND}`;
}

export function formatMoneyCompact(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${Math.round(n).toLocaleString("vi-VN")}${VND}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatWeight(
  weight: string | number | null | undefined,
  unit: string | null | undefined,
): string {
  const n = toNumber(weight);
  if (n === null || !unit) return "";
  const text = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  return `${text} ${unit}`;
}

export function formatQuantity(
  value: string | number | null | undefined,
  unit?: string | null,
): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const text = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  return unit ? `${text} ${unit}` : text;
}

export function shortPartnerName(name: string): string {
  const cleaned = name
    .replace(/^HTX\s+(Nông nghiệp\s+)?/i, "")
    .replace(/^Hợp tác xã\s+(Nông nghiệp\s+)?/i, "")
    .replace(/^Công ty\s+(TNHH\s+|Cổ phần\s+)?/i, "")
    .replace(/^Nông sản\s+/i, "")
    .trim();
  return cleaned || name;
}

export function formatOrderCode(code: string): string {
  return code;
}

export function discountPercent(
  original: string | number | null | undefined,
  current: string | number | null | undefined,
): number | null {
  const o = toNumber(original);
  const c = toNumber(current);
  if (o === null || c === null || o <= 0 || c >= o) return null;
  return Math.round(((o - c) / o) * 100);
}

export function formatRemaining(
  endsAt: string | null | undefined,
  now = Date.now(),
): string | null {
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
