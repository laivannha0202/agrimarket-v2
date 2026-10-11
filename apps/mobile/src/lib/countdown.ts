/**
 * Countdown arithmetic — pure and unit-testable, no React Native imports.
 *
 * WHY THIS EXISTS
 *
 * The flash-sale strip used to render `formatRemaining(sale.endsAt)` once and
 * never update: the label froze at whatever it said when the screen mounted, and
 * a programme that ended while the app was open kept showing a live timer (and
 * its flash prices) until a manual refresh.
 *
 * The deadline always comes from the API (`endsAt`). Nothing here stores a
 * locally computed duration, so a device with a slow clock cannot extend a
 * promotion, and every value is recomputed from the wall clock on each tick.
 */

export interface CountdownState {
  /** Whole seconds until the deadline; 0 once it has passed. */
  remainingSeconds: number;
  expired: boolean;
}

/** How often the UI may re-read the clock. */
export const COUNTDOWN_TICK_MS = 1_000;

/** Countdown to `endsAt`. A missing or unparseable deadline counts as expired. */
export function computeCountdown(
  endsAt: string | null | undefined,
  now: number = Date.now(),
): CountdownState {
  if (!endsAt) return { remainingSeconds: 0, expired: true };
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return { remainingSeconds: 0, expired: true };
  const diff = end - now;
  if (diff <= 0) return { remainingSeconds: 0, expired: true };
  return { remainingSeconds: Math.floor(diff / 1000), expired: false };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `04:05:06`, `05:06` when seconds are hidden, or `2 ngày 04:05:06` for a long
 * window when `withDays` is set.
 *
 * The day count is optional because `formatCountdownLabel` already states it in
 * words: rendering both produced "Còn 26 ngày · 26 ngày 16:40:33", which reads
 * as a mistake. The screen shows the label plus a clock, so the clock carries
 * only hours:minutes:seconds and the label carries the scale.
 */
export function formatCountdown(
  remainingSeconds: number,
  options: { showSeconds?: boolean; withDays?: boolean } = {},
): string {
  const showSeconds = options.showSeconds ?? true;
  const withDays = options.withDays ?? false;
  const empty = showSeconds ? "00:00:00" : "00:00";
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return empty;
  const total = Math.floor(remainingSeconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const clock = showSeconds
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(hours)}:${pad(minutes)}`;
  return withDays && days > 0 ? `${days} ngày ${clock}` : clock;
}

/**
 * Short, honest description of the time left.
 *
 * Shown next to the clock so a long-running programme never reads as urgent:
 * "Còn 26 ngày" is the truthful description of a campaign ending in 26 days, and
 * it is what makes a stale "cuối tuần" (weekend) name visible instead of
 * confusing. The clock keeps the precise value; this label prevents the
 * "is it stuck?" doubt when seconds are hidden.
 */
export function formatCountdownLabel(remainingSeconds: number): string {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return "Đã kết thúc";
  const days = Math.floor(remainingSeconds / 86_400);
  if (days >= 1) return `Còn ${days} ngày`;
  const hours = Math.floor(remainingSeconds / 3_600);
  if (hours >= 1) return `Còn ${hours} giờ`;
  const minutes = Math.floor(remainingSeconds / 60);
  return minutes >= 1 ? `Còn ${minutes} phút` : "Sắp kết thúc";
}

/**
 * Is the programme inside its own window right now?
 *
 * The API also returns a `status`, and the catalog/checkout queries only ever
 * price an `ACTIVE` programme inside its window — this mirrors that rule for the
 * client so an expired sale is not rendered from a stale list.
 */
export function isWithinWindow(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const start = startsAt ? new Date(startsAt).getTime() : Number.NEGATIVE_INFINITY;
  const end = endsAt ? new Date(endsAt).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start && now < end;
}
