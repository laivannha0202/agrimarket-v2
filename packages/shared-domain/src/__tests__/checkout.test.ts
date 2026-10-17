import { describe, expect, it } from "vitest";
import {
  asApiErrorLike,
  buildCheckoutPayload,
  buyNowParam,
  carryPendingTotal,
  checkoutErrorMessage,
  classifyCheckoutConflict,
  classifyCheckoutError,
  needsTotalConfirm,
  parseBuyNowParam,
  translatedMessage,
} from "../checkout";

/** Same shape as both apps' ApiError. */
class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: { message?: string | string[] },
  ) {
    super(message);
  }
}

describe("parseBuyNowParam / buyNowParam", () => {
  it("round-trips a line", () => {
    const parsed = parseBuyNowParam(buyNowParam(12, 3));
    expect(parsed).toEqual([{ productVariantId: 12, quantity: 3 }]);
  });

  it("accepts a fractional quantity", () => {
    expect(parseBuyNowParam("7:0.5")).toEqual([{ productVariantId: 7, quantity: 0.5 }]);
  });

  it("rejects malformed values", () => {
    expect(parseBuyNowParam(undefined)).toBeNull();
    expect(parseBuyNowParam("")).toBeNull();
    expect(parseBuyNowParam("abc:1")).toBeNull();
    expect(parseBuyNowParam("0:1")).toBeNull();
    expect(parseBuyNowParam("-3:1")).toBeNull();
    expect(parseBuyNowParam("12:0")).toBeNull();
    expect(parseBuyNowParam("12:-2")).toBeNull();
    expect(parseBuyNowParam("12")).toBeNull();
  });
});

describe("asApiErrorLike", () => {
  it("accepts both apps' error shape", () => {
    expect(asApiErrorLike(new FakeApiError(409, "boom"))?.status).toBe(409);
    expect(asApiErrorLike({ status: 500, message: "x" })?.status).toBe(500);
  });

  it("rejects everything else", () => {
    expect(asApiErrorLike(null)).toBeNull();
    expect(asApiErrorLike("error")).toBeNull();
    expect(asApiErrorLike(new Error("plain"))).toBeNull();
  });
});

describe("classifyCheckoutConflict", () => {
  it("distinguishes the backend's 409s", () => {
    expect(classifyCheckoutConflict(new FakeApiError(409, "Total changed since preview"))).toBe(
      "total-changed",
    );
    expect(classifyCheckoutConflict(new FakeApiError(409, "This checkout is still being processed, please retry"))).toBe("in-flight");
    expect(
      classifyCheckoutConflict(
        new FakeApiError(409, "This idempotency key was already used with a different checkout payload"),
      ),
    ).toBe("key-reuse");
    expect(
      classifyCheckoutConflict(
        new FakeApiError(409, "The order created for this idempotency key is no longer available"),
      ),
    ).toBe("order-gone");
  });

  it("reads the raw English message out of the body too", () => {
    const err = new FakeApiError(409, "Đã dịch", { message: "Total changed" });
    expect(classifyCheckoutConflict(err)).toBe("total-changed");
  });

  it("is 'other' for a non-409", () => {
    expect(classifyCheckoutConflict(new FakeApiError(400, "total changed"))).toBe("other");
    expect(classifyCheckoutConflict(null)).toBe("other");
  });
});

describe("classifyCheckoutError", () => {
  it("maps status codes first", () => {
    expect(classifyCheckoutError(new FakeApiError(0, ""))).toBe("network");
    expect(classifyCheckoutError(new FakeApiError(401, ""))).toBe("session");
    expect(classifyCheckoutError(new FakeApiError(403, ""))).toBe("session");
  });

  it("maps business messages by cause", () => {
    expect(classifyCheckoutError(new FakeApiError(400, "Insufficient sellable stock for SKU X"))).toBe("stock");
    expect(classifyCheckoutError(new FakeApiError(400, "Voucher không hợp lệ"))).toBe("voucher");
    expect(classifyCheckoutError(new FakeApiError(400, "Xã/phường không hợp lệ"))).toBe("address");
    expect(classifyCheckoutError(new FakeApiError(400, "something else"))).toBe("unknown");
  });

  it("keeps the 409 re-price distinct from other 409s", () => {
    expect(classifyCheckoutError(new FakeApiError(409, "Total changed"))).toBe("total-changed");
    expect(classifyCheckoutError(new FakeApiError(409, "still being processed"))).toBe("unknown");
  });
});

describe("translatedMessage / checkoutErrorMessage", () => {
  it("passes Vietnamese through verbatim", () => {
    const err = new FakeApiError(400, "Số điện thoại chưa hợp lệ");
    expect(translatedMessage(err)).toBe("Số điện thoại chưa hợp lệ");
    expect(checkoutErrorMessage(err, translatedMessage(err))).toBe("Số điện thoại chưa hợp lệ");
  });

  it("never prints raw English at the customer", () => {
    const err = new FakeApiError(400, "Insufficient sellable stock");
    expect(translatedMessage(err)).toBeNull();
    expect(checkoutErrorMessage(err, null)).toContain("không còn đủ hàng");
  });

  it("falls back to the cause sentence otherwise", () => {
    expect(checkoutErrorMessage(new FakeApiError(0, ""), null)).toContain("Không kết nối được máy chủ");
    expect(checkoutErrorMessage(new FakeApiError(401, ""), null)).toContain("đăng nhập lại");
    expect(checkoutErrorMessage(new FakeApiError(409, "Total changed"), null)).toContain("Giá");
    expect(checkoutErrorMessage({}, null)).toContain("thất bại");
  });
});

describe("needsTotalConfirm / carryPendingTotal", () => {
  it("owes no confirmation on a first visit", () => {
    expect(needsTotalConfirm({ grandTotal: 100 }, null)).toBe(false);
    expect(needsTotalConfirm(undefined, 100)).toBe(false);
    expect(needsTotalConfirm({ grandTotal: 100 }, 100)).toBe(true);
  });

  it("keeps the confirmation only while the order input is unchanged", () => {
    expect(carryPendingTotal("a|b", "a|b", 500)).toBe(500);
    expect(carryPendingTotal("a|b", "a|c", 500)).toBeNull();
  });
});

describe("buildCheckoutPayload", () => {
  const verifiedAddress = {
    recipientName: "Lan",
    phone: "0912345678",
    province: "Hưng Yên",
    provinceCode: "33",
    wardCode: "11953",
    district: "Văn Lâm",
    ward: "Tân Quang",
    village: "Thôn 1",
    detail: "Số 12",
  };

  it("sends the verified code pair and official field for a catalogue address", () => {
    const payload = buildCheckoutPayload(verifiedAddress, [{ productVariantId: 1, quantity: 2 }], "SAVE", " ghi chú ", { grandTotal: 50000 }, "CART");
    expect(payload.shippingAddress.provinceCode).toBe("33");
    expect(payload.shippingAddress.wardCode).toBe("11953");
    // Legacy text would contradict the official names the backend resolves.
    expect(payload.shippingAddress.district).toBeUndefined();
    expect(payload.shippingAddress.ward).toBeUndefined();
    expect(payload.items).toEqual([{ productVariantId: 1, quantity: 2 }]);
    expect(payload.voucherCode).toBe("SAVE");
    expect(payload.note).toBe("ghi chú");
    expect(payload.expectedGrandTotal).toBe(50000);
    expect(payload.paymentMethod).toBe("COD");
    // The declared source decides the backend's cart rule, so it must ride along.
    expect(payload.source).toBe("CART");
    // The DTO has no shipping-fee field; the backend owns the fee.
    expect("shippingFee" in payload).toBe(false);
  });

  it("carries the buy-now source so the backend leaves the cart alone", () => {
    const payload = buildCheckoutPayload(
      verifiedAddress,
      [{ productVariantId: 9, quantity: 1 }],
      "",
      "",
      { grandTotal: 1000 },
      "BUY_NOW",
    );
    expect(payload.source).toBe("BUY_NOW");
    expect(payload.items).toEqual([{ productVariantId: 9, quantity: 1 }]);
  });

  it("keeps legacy free text for an address saved before the reorganisation", () => {
    const legacyAddress = {
      recipientName: "Hùng",
      phone: "0987654321",
      province: "Hưng Yên",
      provinceCode: null,
      wardCode: null,
      district: "Văn Lâm",
      ward: "Tân Quang",
      village: null,
      detail: "Số 5",
    };
    const payload = buildCheckoutPayload(legacyAddress, [{ productVariantId: 2, quantity: 1 }], "", "", { grandTotal: 30000 }, "BUY_NOW");
    expect(payload.shippingAddress.provinceCode).toBeUndefined();
    expect(payload.shippingAddress.wardCode).toBeUndefined();
    expect(payload.shippingAddress.district).toBe("Văn Lâm");
    expect(payload.shippingAddress.ward).toBe("Tân Quang");
    expect(payload.shippingAddress.village).toBeUndefined();
    expect(payload.voucherCode).toBeUndefined();
    expect(payload.note).toBeUndefined();
  });
});
