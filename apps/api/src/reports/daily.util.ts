/**
 * Helpers for the daily revenue/orders series used by the dashboard chart.
 *
 * The database stores every timestamp in UTC, but the business day is the
 * Vietnam day (UTC+7). A row written at `2026-10-08 20:00 UTC` belongs to
 * `2026-10-09` in Vietnam, so bucketing must shift by +7h before taking the
 * date. These helpers are pure so the bucketing rule is unit-testable without
 * a database; the SQL only supplies the same `DATE(created_at + 7h)` key.
 */

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** The Vietnam calendar date (`YYYY-MM-DD`) of a UTC instant. */
export function vnDayKey(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant of `00:00` Vietnam time on the given `YYYY-MM-DD`. */
export function vnDayStartUtc(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - VN_OFFSET_MS);
}

/** Shift a Vietnam day key by `delta` days (may be negative). */
export function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of Vietnam day keys from `from` to `to` (both `YYYY-MM-DD`). */
export function buildDayKeys(from: string, to: string): string[] {
  const start = vnDayStartUtc(from).getTime();
  const end = vnDayStartUtc(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const keys: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    keys.push(vnDayKey(new Date(t)));
  }
  return keys;
}

/** Window used when neither `from`/`to` nor a valid `days` is supplied. */
export const DEFAULT_REPORT_WINDOW_DAYS = 30;

/**
 * The effective reporting window shared by `summary()` and `daily()`.
 *
 * `from`/`to` win when given. Otherwise the window is the last `days` Vietnam
 * calendar days (default 30) ending at `to`/now: the start is the 00:00 VN
 * boundary of the first day, so the first and last buckets are whole days.
 *
 * Sharing this resolver is what lets a KPI (`summary`) and the chart (`daily`)
 * for the same period reconcile exactly — same bounds, same basis.
 */
export function resolveReportWindow(
  from?: Date,
  to?: Date,
  days?: number,
): { start: Date; end: Date } {
  const end = to ?? new Date();
  if (from) return { start: from, end };
  const span = days && days > 0 ? days : DEFAULT_REPORT_WINDOW_DAYS;
  const start = vnDayStartUtc(shiftDayKey(vnDayKey(end), -(span - 1)));
  return { start, end };
}
