import { describe, expect, it } from "vitest";
import {
  computeCountdown,
  formatCountdown,
  formatCountdownLabel,
  isWithinWindow,
} from "../countdown";

/**
 * Countdown arithmetic.
 *
 * The flash-sale strip used to render the remaining time once and never update,
 * so a programme that ended while the app was open kept a live-looking timer and
 * its flash prices on screen. These tests pin the two properties that fix it:
 * the value is derived from `endsAt` and the wall clock, and it reports expiry.
 */

const NOW = new Date("2026-10-10T12:00:00Z").getTime();
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `computeCountdown` and `formatCountdown` both work in SECONDS. */
const SEC = 1;
const MIN = 60;
const HR = 3_600;
const D = 86_400;

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("computeCountdown", () => {
  it("counts down from the API deadline", () => {
    expect(computeCountdown(iso(90 * SECOND), NOW)).toEqual({ remainingSeconds: 90, expired: false });
    expect(computeCountdown(iso(DAY + 2 * HOUR), NOW).remainingSeconds).toBe((DAY + 2 * HOUR) / SECOND);
  });

  it("recomputes from the wall clock, so a resume gap cannot drift", () => {
    const endsAt = iso(10 * MINUTE);
    // Same deadline, five minutes later: the value must follow the clock.
    expect(computeCountdown(endsAt, NOW).remainingSeconds).toBe(600);
    expect(computeCountdown(endsAt, NOW + 5 * MINUTE).remainingSeconds).toBe(300);
  });

  it("reports expiry exactly at the deadline and after it", () => {
    expect(computeCountdown(iso(0), NOW).expired).toBe(true);
    expect(computeCountdown(iso(-1), NOW).expired).toBe(true);
    expect(computeCountdown(iso(1), NOW).expired).toBe(false);
  });

  it("treats a missing or unparseable deadline as expired", () => {
    // Never leave a sale looking live because the payload was malformed.
    expect(computeCountdown(null, NOW).expired).toBe(true);
    expect(computeCountdown(undefined, NOW).expired).toBe(true);
    expect(computeCountdown("", NOW).expired).toBe(true);
    expect(computeCountdown("not-a-date", NOW).expired).toBe(true);
  });

  it("never returns a negative remaining time", () => {
    expect(computeCountdown(iso(-10 * DAY), NOW).remainingSeconds).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("shows a plain clock, so the label can carry the scale", () => {
    // "Còn 26 ngày · 26 ngày 16:40:33" read as a mistake, so the day count is
    // stated once — in the label — and the clock shows the remainder.
    expect(formatCountdown(26 * D + 4 * HR + 5 * MIN + 6 * SEC)).toBe("04:05:06");
    expect(formatCountdownLabel(26 * D + 4 * HR)).toBe("Còn 26 ngày");
  });

  it("can still include the day count when asked", () => {
    expect(formatCountdown(26 * D + 4 * HR + 5 * MIN + 6 * SEC, { withDays: true })).toBe("26 ngày 04:05:06");
    expect(formatCountdown(4 * HR + 5 * MIN + 6 * SEC, { withDays: true })).toBe("04:05:06");
  });

  it("shows a plain clock under a day", () => {
    expect(formatCountdown(4 * HR + 5 * MIN + 6 * SEC)).toBe("04:05:06");
    expect(formatCountdown(5 * MIN + 6 * SEC)).toBe("00:05:06");
  });

  it("can hide seconds without ever implying a frozen clock", () => {
    // The label beside it carries the meaning ("Còn 26 ngày"), which is what
    // stops a seconds-less display from reading as stuck.
    expect(formatCountdown(4 * HR + 5 * MIN + 6 * SEC, { showSeconds: false })).toBe("04:05");
    expect(formatCountdownLabel(26 * D)).toBe("Còn 26 ngày");
  });

  it("renders zero for an expired countdown", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(-5)).toBe("00:00:00");
    expect(formatCountdownLabel(0)).toBe("Đã kết thúc");
  });
});

describe("formatCountdownLabel", () => {
  it("describes the scale truthfully", () => {
    // A 26-day campaign must not read as urgent — this is what makes the
    // "cuối tuần" name of a month-long programme visible instead of confusing.
    expect(formatCountdownLabel(26 * D + 3 * HR)).toBe("Còn 26 ngày");
    expect(formatCountdownLabel(3 * HR + 30 * MIN)).toBe("Còn 3 giờ");
    expect(formatCountdownLabel(30 * MIN)).toBe("Còn 30 phút");
    expect(formatCountdownLabel(30 * SEC)).toBe("Sắp kết thúc");
  });
});

describe("isWithinWindow", () => {
  it("mirrors the backend's window rule (start inclusive, end exclusive)", () => {
    const startsAt = iso(-DAY);
    const endsAt = iso(DAY);
    expect(isWithinWindow(startsAt, endsAt, NOW)).toBe(true);
    expect(isWithinWindow(startsAt, endsAt, NOW + 2 * DAY)).toBe(false);
    expect(isWithinWindow(startsAt, endsAt, NOW - 2 * DAY)).toBe(false);
    expect(isWithinWindow(startsAt, endsAt, NOW + DAY)).toBe(false);
    expect(isWithinWindow(startsAt, endsAt, NOW - DAY)).toBe(true);
  });

  it("handles open-ended and malformed bounds", () => {
    expect(isWithinWindow(null, iso(DAY), NOW)).toBe(true);
    expect(isWithinWindow(iso(-DAY), null, NOW)).toBe(true);
    expect(isWithinWindow("nonsense", iso(DAY), NOW)).toBe(false);
    expect(isWithinWindow(iso(-DAY), "nonsense", NOW)).toBe(false);
  });
});
