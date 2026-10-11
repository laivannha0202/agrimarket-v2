import { describe, expect, it } from "vitest";
import { discountPercent, formatDate, formatMoney, formatMoneyCompact, formatQuantity, formatWeight, shortPartnerName } from "../format";

describe("format", () => {
  it("formats VND money", () => {
    expect(formatMoney(136000)).toBe("136.000 ₫");
    expect(formatMoney("136000")).toBe("136.000 ₫");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats compact money", () => {
    expect(formatMoneyCompact(136000)).toBe("136.000₫");
  });

  it("formats dates", () => {
    expect(formatDate("2026-10-07T14:35:00.000Z")).toMatch(/07\/10\/2026/);
    expect(formatDate(null)).toBe("—");
  });

  it("formats weights and quantities", () => {
    expect(formatWeight("500", "g")).toBe("500 g");
    expect(formatWeight("2.5", "kg")).toBe("2,5 kg");
    expect(formatQuantity("5.000")).toBe("5");
    expect(formatQuantity("0.500", "kg")).toBe("0,5 kg");
  });

  it("shortens partner names", () => {
    expect(shortPartnerName("HTX Rau quả Minh Châu")).toBe("Rau quả Minh Châu");
  });

  it("computes discount percent", () => {
    expect(discountPercent(100000, 83000)).toBe(17);
    expect(discountPercent(100000, 100000)).toBeNull();
  });
});
