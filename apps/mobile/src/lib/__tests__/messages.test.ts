import { describe, expect, it } from "vitest";
import { translateApiMessage } from "../messages";

describe("messages", () => {
  it("translates known backend messages", () => {
    expect(translateApiMessage("Invalid email or password")).toBe("Email hoặc mật khẩu chưa đúng.");
    expect(translateApiMessage("Voucher not found")).toBe("Mã giảm giá không tồn tại.");
  });

  it("strips variant ids from stock/quota messages", () => {
    expect(translateApiMessage("Flash sale quota exceeded for variant 42")).toContain("giảm giá nhanh");
    expect(translateApiMessage("Insufficient sellable stock for variant 7")).toContain("không còn đủ hàng");
  });

  it("translates the 409 re-price message", () => {
    expect(translateApiMessage("The order total changed from 170000 to 175000.")).toContain("xác nhận lại");
  });

  it("returns null for validation noise and unknown text", () => {
    expect(translateApiMessage("rating must not be greater than 5")).toBeNull();
    expect(translateApiMessage("some future backend sentence")).toBeNull();
  });
});
