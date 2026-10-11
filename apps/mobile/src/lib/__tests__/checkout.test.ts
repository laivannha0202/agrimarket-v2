import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

const { ApiError } = await import("../api-client");
const {
  buildCheckoutPayload,
  carryPendingTotal,
  checkoutErrorMessage,
  classifyCheckoutConflict,
  classifyCheckoutError,
  needsTotalConfirm,
  parseBuyNowParam,
  translatedMessage,
  validateAddressInput,
} = await import("../checkout");
const { formatAddressLine, isCatalogueAddress, wardMatches, foldForSearch } = await import("../address");

/**
 * A LEGACY address: saved before the 2025 reorganisation, so it has no official
 * code pair and keeps its own free text. `wardName` is null because the backend
 * only fills it from a code.
 */
function legacyAddress() {
  return {
    id: 1,
    customerId: 9,
    recipientName: "Nguyễn Thị Lan",
    phone: "0912345678",
    province: "Hưng Yên",
    provinceCode: null,
    wardCode: null,
    wardName: null,
    district: "Văn Lâm",
    ward: "Tân Quang",
    village: null,
    detail: "Số 12",
    isDefault: true,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  };
}

/** A CATALOGUE address: the official 2025 code pair plus the resolved name. */
function catalogueAddress() {
  return {
    ...legacyAddress(),
    id: 2,
    provinceCode: "33",
    wardCode: "11953",
    wardName: "Phường Phố Hiến",
    district: null,
    ward: null,
  };
}

function preview() {
  return {
    items: [],
    itemCount: 0,
    subtotal: 30000,
    discountTotal: 0,
    voucher: null,
    shippingFee: 20000,
    grandTotal: 50000,
  };
}

describe("checkout helpers", () => {
  it("parses buy-now params and rejects malformed values", () => {
    expect(parseBuyNowParam("12:2")).toEqual([{ productVariantId: 12, quantity: 2 }]);
    expect(parseBuyNowParam("abc")).toBeNull();
    expect(parseBuyNowParam("0:1")).toBeNull();
    expect(parseBuyNowParam("12:0")).toBeNull();
    expect(parseBuyNowParam(undefined)).toBeNull();
  });

  it("builds a COD payload with the backend preview total", () => {
    const payload = buildCheckoutPayload(catalogueAddress(), [{ productVariantId: 5, quantity: 1 }], "SALE10", "", preview());
    expect(payload.paymentMethod).toBe("COD");
    expect(payload.expectedGrandTotal).toBe(50000);
    expect(payload.shippingAddress.province).toBe("Hưng Yên");
    // The client must never compute a fee: the DTO has no such field, and the
    // backend is the only place `calculateShippingFee` runs.
    expect("shippingFee" in payload).toBe(false);
  });

  it("sends the verified province/ward code pair for a catalogue address", () => {
    const payload = buildCheckoutPayload(catalogueAddress(), [{ productVariantId: 5, quantity: 1 }], "", "", preview());
    expect(payload.shippingAddress.provinceCode).toBe("33");
    expect(payload.shippingAddress.wardCode).toBe("11953");
    // A district must never accompany a code pair: the 2025 model has no
    // district level, and the backend clears it when a ward code resolves.
    expect(payload.shippingAddress.district).toBeUndefined();
    expect(payload.shippingAddress.ward).toBeUndefined();
  });

  it("carries a legacy address through unchanged", () => {
    const payload = buildCheckoutPayload(legacyAddress(), [{ productVariantId: 5, quantity: 1 }], "", "", preview());
    expect(payload.shippingAddress.provinceCode).toBeUndefined();
    expect(payload.shippingAddress.wardCode).toBeUndefined();
    expect(payload.shippingAddress.district).toBe("Văn Lâm");
    expect(payload.shippingAddress.ward).toBe("Tân Quang");
    expect(payload.shippingAddress.province).toBe("Hưng Yên");
  });

  it("classifies the 409 re-price conflict", () => {
    expect(
      classifyCheckoutConflict(
        new ApiError(409, "The order total changed from 44000 to 46000. Please review the updated price and confirm again."),
      ),
    ).toBe("total-changed");
    expect(classifyCheckoutConflict(new ApiError(400, "lỗi"))).toBe("other");
    expect(classifyCheckoutConflict(new Error("mạng"))).toBe("other");
  });

  it("does NOT treat every 409 as a re-price", () => {
    // The backend uses 409 for several distinct conditions. Collapsing them all
    // into "total changed" cleared the customer's confirmation and re-priced an
    // order whose total had never moved. Real messages from orders.service.ts.
    expect(
      classifyCheckoutConflict(new ApiError(409, "This checkout is still being processed, please retry")),
    ).toBe("in-flight");

    expect(
      classifyCheckoutConflict(
        new ApiError(409, "This idempotency key was already used with a different checkout payload"),
      ),
    ).toBe("key-reuse");

    expect(
      classifyCheckoutConflict(
        new ApiError(409, "The order created for this idempotency key is no longer available"),
      ),
    ).toBe("order-gone");

    // A Prisma duplicate-value conflict is also a 409, and is not a re-price.
    expect(classifyCheckoutConflict(new ApiError(409, "Duplicate value for: code"))).toBe("other");

    // A 400/500 is never a conflict of any kind, even with matching wording.
    expect(classifyCheckoutConflict(new ApiError(500, "total changed"))).toBe("other");
    expect(classifyCheckoutConflict(new ApiError(400, "The order total changed"))).toBe("other");
  });

  it("requires re-confirm ONLY after the backend re-priced the order", () => {
    // THE REGRESSION THIS GUARDS.
    //
    // The screen used to initialise "confirmed total" to null, so on the very
    // first visit `needsConfirm` was already true: a permanent yellow bar
    // appeared and the only submit button was disabled, which made a normal COD
    // order impossible to place. A preview that has never been contradicted
    // needs NO confirmation.
    expect(needsTotalConfirm(preview(), null)).toBe(false);
    // A 409 re-price sets the pending total: now, and only now, the customer is
    // asked to accept the amount currently displayed.
    expect(needsTotalConfirm(preview(), 50000)).toBe(true);
    expect(needsTotalConfirm(preview(), 49999)).toBe(true);
    // Nothing to confirm while the preview is still loading.
    expect(needsTotalConfirm(undefined, null)).toBe(false);
    expect(needsTotalConfirm(undefined, 50000)).toBe(false);
  });

  it("drops a pending re-price confirmation when the customer edits the order", () => {
    // A 409 sets `pendingTotal` and refetches the preview WITHOUT changing the
    // signature, so the confirmation survives the refetch.
    const signature = "51:2||";
    expect(carryPendingTotal(signature, signature, 92000)).toBe(92000);

    // The customer changes the quantity: the refreshed preview is now THEIR
    // total, so the "price updated" note must not linger — otherwise they are
    // asked to confirm a change they just made themselves.
    expect(carryPendingTotal("51:2||", "51:3||", 92000)).toBeNull();
    // Same for swapping the voucher...
    expect(carryPendingTotal("51:2||", "51:2|HUNGYEN50K|", 92000)).toBeNull();
    // ...or the delivery address.
    expect(carryPendingTotal("51:2||", "51:2||7", 92000)).toBeNull();

    // Nothing pending stays nothing pending.
    expect(carryPendingTotal(signature, signature, null)).toBeNull();
  });

  it("classifies a submit failure by cause", () => {    expect(classifyCheckoutError(new ApiError(0, "Không kết nối được máy chủ."))).toBe("network");
    expect(classifyCheckoutError(new ApiError(401, "Phiên đăng nhập đã hết hiệu lực."))).toBe("session");
    expect(classifyCheckoutError(new ApiError(403, "Không có quyền."))).toBe("session");
    expect(
      classifyCheckoutError(
        new ApiError(409, "The order total changed from 44000 to 46000. Please review the updated price and confirm again."),
      ),
    ).toBe("total-changed");
    // A 409 that is NOT a re-price must never be reported as a price change.
    expect(
      classifyCheckoutError(new ApiError(409, "This checkout is still being processed, please retry")),
    ).toBe("unknown");
    expect(
      classifyCheckoutError(new ApiError(400, "Insufficient sellable stock for variant 7: short by 2")),
    ).toBe("stock");
    expect(
      classifyCheckoutError(new ApiError(400, "Flash sale quota exceeded for variant 42")),
    ).toBe("stock");
    expect(classifyCheckoutError(new ApiError(400, "Voucher usage limit reached"))).toBe("voucher");
    expect(classifyCheckoutError(new ApiError(400, "Voucher is not within its valid period"))).toBe("voucher");
    expect(classifyCheckoutError(new ApiError(400, "Xã/phường không hợp lệ hoặc không thuộc tỉnh đã chọn"))).toBe(
      "address",
    );
    expect(classifyCheckoutError(new Error("boom"))).toBe("unknown");
  });

  it("reads the cause from the raw body when the message was translated", () => {
    // `ApiError.message` is already Vietnamese by the time the screen sees it,
    // so the English patterns only match against `body.message`. Without this
    // the stock/voucher causes would collapse into "unknown".
    const translated = new ApiError(400, "Sản phẩm này không còn đủ hàng để đặt.", {
      statusCode: 400,
      message: "Insufficient sellable stock for variant 7: short by 2",
    });
    expect(classifyCheckoutError(translated)).toBe("stock");

    const conflict = new ApiError(409, "Giá hoặc khuyến mãi vừa thay đổi.", {
      statusCode: 409,
      message: "The order total changed from 44000 to 46000.",
    });
    expect(classifyCheckoutConflict(conflict)).toBe("total-changed");
  });

  it("shows the backend message when translated, else a cause-specific one", () => {
    // A translated backend message names the exact rule, so it wins.
    expect(checkoutErrorMessage(new ApiError(400, "Mã giảm giá đã hết lượt sử dụng."), "Mã giảm giá đã hết lượt sử dụng.")).toBe(
      "Mã giảm giá đã hết lượt sử dụng.",
    );
    // No translated text -> the cause supplies an actionable sentence.
    expect(checkoutErrorMessage(new ApiError(0, ""), null)).toContain("Wi-Fi");
    expect(checkoutErrorMessage(new ApiError(401, ""), null)).toContain("đăng nhập");
    expect(checkoutErrorMessage(new ApiError(400, "Insufficient sellable stock"), null)).toContain("đủ hàng");
    expect(checkoutErrorMessage(new ApiError(400, "Voucher not found"), null)).toContain("giảm giá");
    expect(checkoutErrorMessage(new ApiError(500, ""), null)).toContain("thử lại");
  });

  it("only surfaces a translated message, never raw English", () => {
    expect(translatedMessage(new ApiError(400, "Mã giảm giá không tồn tại."))).toBe("Mã giảm giá không tồn tại.");
    expect(translatedMessage(new ApiError(400, "Insufficient sellable stock for variant 7"))).toBeNull();
    expect(translatedMessage(new ApiError(400, ""))).toBeNull();
    expect(translatedMessage(new Error("x"))).toBeNull();
  });

  it("summarises and validates addresses", () => {
    // Legacy: shows the stored free text, district included.
    expect(formatAddressLine(legacyAddress())).toBe("Số 12, Tân Quang, Văn Lâm, Hưng Yên");
    // Catalogue: shows the official ward name and NO district.
    expect(formatAddressLine(catalogueAddress())).toBe("Số 12, Phường Phố Hiến, Hưng Yên");

    expect(validateAddressInput({ recipientName: "", phone: "09", province: "HY", detail: "x" })).not.toBeNull();
    expect(validateAddressInput({ recipientName: "A", phone: "09", province: "HY", detail: "x" })).toBeNull();
  });

  it("distinguishes a catalogue address from a legacy one", () => {
    expect(isCatalogueAddress(catalogueAddress())).toBe(true);
    expect(isCatalogueAddress(legacyAddress())).toBe(false);
  });

  it("folds accents and matches wards by name or code", () => {
    const ward = { code: "11953", fullName: "Phường Phố Hiến", name: "Phố Hiến" };
    expect(foldForSearch("Phố Hiến")).toBe("pho hien");
    // The whole point of the fold: an unaccented search must find the ward.
    expect(wardMatches(ward, "pho hien")).toBe(true);
    expect(wardMatches(ward, "PHO HIEN")).toBe(true);
    expect(wardMatches(ward, "11953")).toBe(true);
    expect(wardMatches(ward, "hien")).toBe(true);
    expect(wardMatches(ward, "văn lâm")).toBe(false);
    expect(wardMatches(ward, "")).toBe(true);
  });
});
