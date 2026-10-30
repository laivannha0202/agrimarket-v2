import { describe, expect, it } from "vitest";
import { toDateTimeLocal } from "@/lib/format";
import { num, toNumeric } from "@/lib/format/form";

/**
 * Vietnamese decimal entry: coordinates and areas are typed with a comma
 * (`20,9821`), which `Number()` alone turns into NaN — and the field would
 * then be silently dropped, moving the farm or losing its area.
 */
describe("num / toNumeric", () => {
  it("parses dot and comma decimals identically", () => {
    expect(num("20.9821")).toBe(20.9821);
    expect(num("20,9821")).toBe(20.9821);
    expect(num(" 2,5 ")).toBe(2.5);
  });

  it("keeps numbers and drops empty/invalid input", () => {
    expect(num(106.0512)).toBe(106.0512);
    expect(num("")).toBeUndefined();
    expect(num(null)).toBeUndefined();
    expect(num(undefined)).toBeUndefined();
    expect(num("abc")).toBeUndefined();
  });

  it("converts the listed keys, leaving the rest untouched", () => {
    expect(toNumeric({ latitude: "20,9821", name: "X" }, ["latitude"])).toEqual({
      latitude: 20.9821,
      name: "X",
    });
  });
});

describe("toDateTimeLocal", () => {
  it("keeps the author's wall clock instead of shifting it to UTC", () => {
    expect(toDateTimeLocal(new Date(2026, 9, 24, 7, 5))).toBe("2026-10-24T07:05");
    expect(toDateTimeLocal(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01T00:00");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(toDateTimeLocal("not-a-date")).toBe("");
  });
});
