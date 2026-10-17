import { describe, expect, it } from "vitest";
import {
  buildCheckoutPayload,
  buyNowParam,
  checkoutErrorMessage,
  classifyCheckoutConflict,
  classifyCheckoutError,
  needsTotalConfirm,
  parseBuyNowParam,
  translatedMessage,
} from "@/lib/checkout";

/**
 * Checkout rules through the Web app's own module (`src/lib/checkout.ts`),
 * which re-exports `@agrimarket/shared-domain/checkout`. These tests fail if
 * the re-export breaks, and pin the behaviour the Mobile app shares.
 */

/** What the app sees after `translateApiMessage` ran on an English body. */
function apiError(status: number, message: string, raw?: string) {
  return { status, message, body: raw === undefined ? null : { message: raw } };
}

describe("mua-ngay parameter", () => {
  it("parses <variantId>:<quantity> into exactly one line", () => {
    expect(parseBuyNowParam("12:3")).toEqual([{ productVariantId: 12, quantity: 3 }]);
    // Fractional quantities are legitimate (500 g of a 1 kg sale unit).
    expect(parseBuyNowParam("12:0.5")).toEqual([{ productVariantId: 12, quantity: 0.5 }]);
  });

  it("rejects a malformed parameter instead of silently falling back to the cart", () => {
    expect(parseBuyNowParam(undefined)).toBeNull();
    expect(parseBuyNowParam("")).toBeNull();
    expect(parseBuyNowParam("abc")).toBeNull();
    expect(parseBuyNowParam("12")).toBeNull();
    expect(parseBuyNowParam("12:")).toBeNull();
    expect(parseBuyNowParam("12:0")).toBeNull();
    expect(parseBuyNowParam("12:-1")).toBeNull();
    expect(parseBuyNowParam("0:1")).toBeNull();
    expect(parseBuyNowParam("-2:1")).toBeNull();
    expect(parseBuyNowParam("1.5:1")).toBeNull();
  });

  it("round-trips through buyNowParam — the exact URL the product page builds", () => {
    const raw = buyNowParam(7, 2);
    expect(raw).toBe("7:2");
    expect(parseBuyNowParam(raw)).toEqual([{ productVariantId: 7, quantity: 2 }]);
  });
});

describe("buildCheckoutPayload", () => {
  const verifiedAddress = {
    recipientName: "Nguyễn Văn A",
    phone: "0912345678",
    province: "Hà Nội",
    provinceCode: "01",
    wardCode: "00001",
    district: "Quận Cũ",
    ward: "Phường Cũ",
    detail: "12 Lê Lợi",
  };

  const legacyAddress = {
    recipientName: "Nguyễn Văn A",
    phone: "0912345678",
    province: "Hà Nội",
    provinceCode: null,
    wardCode: null,
    district: "Huyện Cũ",
    ward: "Xã Cũ",
    detail: "12 Lê Lợi",
  };

  it("sends the exact lines it was given — the cart is never read here", () => {
    // "Mua ngay" mode: the caller passes the buy-now line; the payload carries
    // exactly that line, so the ordered products cannot fall back to the cart.
    const payload = buildCheckoutPayload(
      verifiedAddress,
      [{ productVariantId: 42, quantity: 2 }],
      "",
      "",
      { grandTotal: 136000 },
      "BUY_NOW",
    );
    expect(payload.items).toEqual([{ productVariantId: 42, quantity: 2 }]);
    expect(payload.source).toBe("BUY_NOW");
  });

  it("echoes the preview total the customer actually saw", () => {
    const payload = buildCheckoutPayload(verifiedAddress, [], "", "", { grandTotal: 250000 }, "CART");
    expect(payload.expectedGrandTotal).toBe(250000);
    expect(payload.source).toBe("CART");
  });

  it("sends only official codes for a catalogue-verified address", () => {
    const payload = buildCheckoutPayload(verifiedAddress, [], "", "", { grandTotal: 1 }, "CART");
    expect(payload.shippingAddress.provinceCode).toBe("01");
    expect(payload.shippingAddress.wardCode).toBe("00001");
    // The backend re-resolves official names; stale free text must not ride along.
    expect(payload.shippingAddress.district).toBeUndefined();
    expect(payload.shippingAddress.ward).toBeUndefined();
  });

  it("keeps the free text of a legacy address untouched", () => {
    const payload = buildCheckoutPayload(legacyAddress, [], "", "", { grandTotal: 1 }, "CART");
    expect(payload.shippingAddress.district).toBe("Huyện Cũ");
    expect(payload.shippingAddress.ward).toBe("Xã Cũ");
    expect(payload.shippingAddress.provinceCode).toBeUndefined();
    expect(payload.shippingAddress.wardCode).toBeUndefined();
  });

  it("normalises an empty voucher/note to absent and defaults payment to COD", () => {
    const payload = buildCheckoutPayload(verifiedAddress, [], "", "   ", { grandTotal: 1 }, "CART");
    expect(payload.voucherCode).toBeUndefined();
    expect(payload.note).toBeUndefined();
    expect(payload.paymentMethod).toBe("COD");
  });

  it("trims the note when one is present", () => {
    const payload = buildCheckoutPayload(verifiedAddress, [], "GIAM10", "  giao buổi sáng  ", {
      grandTotal: 1,
    }, "CART");
    expect(payload.voucherCode).toBe("GIAM10");
    expect(payload.note).toBe("giao buổi sáng");
  });
});

describe("409 classification", () => {
  it("separates a re-price from an in-flight retry", () => {
    // Both answer 409, but only the first demands a re-confirmation of the
    // new total; the second is the same request still processing.
    expect(
      classifyCheckoutConflict(
        apiError(409, "Giá hoặc tổng tiền vừa thay đổi", "Checkout total changed"),
      ),
    ).toBe("total-changed");
    expect(
      classifyCheckoutConflict(
        apiError(409, "Đơn trước đang xử lý", "A previous checkout is still being processed"),
      ),
    ).toBe("in-flight");
  });

  it("recognises an idempotency key reuse and a vanished order", () => {
    expect(
      classifyCheckoutConflict(
        apiError(409, "", "This idempotency key was already used with a different checkout payload"),
      ),
    ).toBe("key-reuse");
    expect(
      classifyCheckoutConflict(apiError(409, "", "One or more items are no longer available")),
    ).toBe("order-gone");
  });

  it("is 'other' for anything that is not an HTTP 409", () => {
    expect(classifyCheckoutConflict(apiError(500, "Internal error"))).toBe("other");
    expect(classifyCheckoutConflict(new Error("boom"))).toBe("other");
  });
});

describe("classifyCheckoutError", () => {
  it("reads the cause from the status first", () => {
    expect(classifyCheckoutError(apiError(0, "Network request failed"))).toBe("network");
    expect(classifyCheckoutError(apiError(401, "Unauthorized"))).toBe("session");
    expect(classifyCheckoutError(apiError(403, "Forbidden"))).toBe("session");
  });

  it("treats only the re-price conflict as 'total-changed'", () => {
    expect(
      classifyCheckoutError(apiError(409, "", "Checkout total changed")),
    ).toBe("total-changed");
    // In-flight must NOT classify as a price change: no re-confirmation is owed.
    expect(
      classifyCheckoutError(apiError(409, "", "Checkout is still being processed")),
    ).toBe("unknown");
  });

  it("reads stock, voucher and address failures from the backend message", () => {
    expect(classifyCheckoutError(apiError(400, "", "Insufficient sellable stock for variant 42"))).toBe(
      "stock",
    );
    expect(classifyCheckoutError(apiError(400, "Mã giảm giá không còn hiệu lực"))).toBe("voucher");
    expect(classifyCheckoutError(apiError(400, "Xã/phường không thuộc tỉnh/thành phố đã chọn"))).toBe(
      "address",
    );
  });

  it("falls back to 'unknown' for an unmapped failure", () => {
    expect(classifyCheckoutError(apiError(500, "Database is locked"))).toBe("unknown");
    expect(classifyCheckoutError(new Error("boom"))).toBe("unknown");
  });
});

describe("checkoutErrorMessage", () => {
  it("shows the backend's translated message verbatim when there is one", () => {
    expect(checkoutErrorMessage(apiError(400, "Số lượng vượt quá tồn kho"), "Số lượng vượt quá tồn kho")).toBe(
      "Số lượng vượt quá tồn kho",
    );
  });

  it("uses the shared sentence for a network failure (same wording as Mobile)", () => {
    expect(checkoutErrorMessage(apiError(0, ""), null)).toBe(
      "Không kết nối được máy chủ. Vui lòng kiểm tra kết nối mạng rồi thử lại.",
    );
  });

  it("explains a stock failure with a cause-specific sentence", () => {
    expect(checkoutErrorMessage(apiError(400, "", "Insufficient sellable stock"), null)).toBe(
      "Sản phẩm này không còn đủ hàng để đặt. Vui lòng giảm số lượng hoặc chọn sản phẩm khác.",
    );
  });

  it("never prints raw English; unmapped failures get the generic sentence", () => {
    expect(checkoutErrorMessage(apiError(500, "Database is locked"), null)).toBe(
      "Đặt hàng thất bại. Vui lòng thử lại.",
    );
  });
});

describe("translatedMessage", () => {
  it("returns Vietnamese text and refuses everything else", () => {
    expect(translatedMessage(apiError(400, "Mã giảm giá không hợp lệ"))).toBe(
      "Mã giảm giá không hợp lệ",
    );
    expect(translatedMessage(apiError(400, "Voucher invalid"))).toBeNull();
    expect(translatedMessage(apiError(400, "  "))).toBeNull();
    expect(translatedMessage(new Error("boom"))).toBeNull();
  });
});

describe("needsTotalConfirm", () => {
  it("asks for a confirmation only when the backend re-priced after a shown total", () => {
    const preview = { grandTotal: 100 };
    expect(needsTotalConfirm(preview, null)).toBe(false);
    expect(needsTotalConfirm(undefined, 100)).toBe(false);
    expect(needsTotalConfirm(preview, 100)).toBe(true);
  });
});
