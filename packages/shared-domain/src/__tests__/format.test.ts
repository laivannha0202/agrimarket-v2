import { describe, expect, it } from "vitest";
import {
  discountPercent,
  formatMoney,
  formatQuantity,
  formatRemaining,
  formatWeight,
  isRealDiscount,
  variantSpecLabel,
} from "../format";

describe("formatMoney", () => {
  it("renders whole VND with separators", () => {
    expect(formatMoney(136000)).toBe("136.000 ₫");
  });

  it("rounds to whole đồng", () => {
    expect(formatMoney(135999.6)).toBe("136.000 ₫");
  });

  it("accepts the Decimal strings the API returns", () => {
    expect(formatMoney("25000.00")).toBe("25.000 ₫");
  });

  it("shows a dash for missing values", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney("not-a-number")).toBe("—");
  });
});

describe("formatWeight / formatQuantity", () => {
  it("keeps integer weights clean", () => {
    expect(formatWeight("500", "g")).toBe("500 g");
  });

  it("uses a comma for decimal weights", () => {
    expect(formatWeight("2.5", "kg")).toBe("2,5 kg");
  });

  it("returns empty string when the unit is missing", () => {
    expect(formatWeight("500", null)).toBe("");
  });

  it("drops trailing zeros from Decimal quantities", () => {
    expect(formatQuantity("5.000", "bó")).toBe("5 bó");
    expect(formatQuantity("0.500")).toBe("0,5");
  });
});

describe("discountPercent / isRealDiscount", () => {
  it("computes the rounded cut", () => {
    expect(discountPercent(12000, 10000)).toBe(17);
  });

  it("returns null when there is no cut", () => {
    expect(discountPercent(10000, 10000)).toBeNull();
    expect(discountPercent(10000, 12000)).toBeNull();
    expect(discountPercent(null, 12000)).toBeNull();
  });

  it("isRealDiscount only accepts a strictly lower price", () => {
    expect(isRealDiscount(12000, 10000)).toBe(true);
    expect(isRealDiscount(12000, 12000)).toBe(false);
    expect(isRealDiscount(undefined, 10000)).toBe(false);
  });
});

describe("variantSpecLabel (no duplicated weight)", () => {
  it("does not repeat a weight already in the name", () => {
    expect(variantSpecLabel({ name: "Bó 500 g", weight: "500", weightUnit: "g" })).toBe("Bó 500 g");
  });

  it("understands kg vs g equivalence", () => {
    expect(variantSpecLabel({ name: "Túi 1 kg", weight: "1000", weightUnit: "g" })).toBe("Túi 1 kg");
    expect(variantSpecLabel({ name: "Túi 500 g", weight: "0.5", weightUnit: "kg" })).toBe("Túi 500 g");
  });

  it("appends the weight when the name carries none", () => {
    expect(variantSpecLabel({ name: "Loại gia đình", weight: "2", weightUnit: "kg" })).toBe(
      "Loại gia đình · 2 kg",
    );
  });

  it("falls back to whichever half exists", () => {
    expect(variantSpecLabel({ name: "", weight: "500", weightUnit: "g" })).toBe("500 g");
    expect(variantSpecLabel({ name: "Túi 1 kg" })).toBe("Túi 1 kg");
  });
});

describe("formatRemaining", () => {
  const now = new Date("2026-10-07T12:00:00.000Z").getTime();

  it("formats hours/minutes/seconds", () => {
    expect(formatRemaining("2026-10-07T13:30:05.000Z", now)).toBe("01:30:05");
  });

  it("includes days when far away", () => {
    expect(formatRemaining("2026-10-09T16:15:00.000Z", now)).toBe("2 ngày 04:15");
  });

  it("returns null once past", () => {
    expect(formatRemaining("2026-10-07T11:00:00.000Z", now)).toBeNull();
    expect(formatRemaining(null, now)).toBeNull();
  });
});
